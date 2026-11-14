import {resolveEnemyHit,missedHit,parriedHit,rewardsConfirmedHit,type HitResolution} from './combat/hit-resolution'
/** STICKMAN RISING — the Game orchestrator: loop, timing (hitstop/slow-mo),
 * combat resolution, combo & score, executions, ultimates, waves, events.
 */

import { Camera } from './core/camera'
import { Input } from './core/input'
import { DEFAULT_SETTINGS, GameEvent, GamePhase, GameSettings, LevelId, RunStats, WorldRef } from './core/types'
import { clamp, clamp01, damp, fmt, rand } from './core/utils'
import { AudioEngine } from './audio/audio'
import { FX } from './fx/fx'
import { CyberBackground, type BackgroundRenderer } from './world/background'
import { ZenNightBackground } from './world/zen-night'
import {StormEngine} from './world/storm'
import { WaveDirector } from './world/waves'
import { Enemy, EnemyKind, PLAYER_X_REF } from './entities/enemy'
import { Player } from './entities/player'
import { PLAYER_POS, ProjectilePool } from './entities/projectiles'
import { ATTACKS, AttackRuntimeInfo } from './combat/attacks'
import { SWORDS, SwordId, SWORD_ORDER, swordTier, upgradedSword } from './combat/swords'
import { crossedExecutionCuts, executionRoot, executionTimeline } from './combat/execution'
import { MOVES } from './combat/moveset'
import { EXECUTE_POSE_CLIP } from './anim/clips'
import { installQA } from './debug/animQA'
import { HUD, HudState, rankForHits } from './render/hud'
import { Renderer, RenderWorld } from './render/renderer'
import { Inspect, InspectMode } from './debug/inspect'

const ARENA_MIN = -60
const ARENA_MAX = 2560

/* ------------------------------------------------------------------ */

class ComboTracker {
  hits = 0
  timer = 0
  timerMax = 2.6
  mult = 1
  best = 0
  bestRank = ''
  rankUpT = 0
  lastRank = ''

  onHit(): void {
    this.hits++
    this.timer = this.timerMax
    this.mult = Math.min(1 + Math.floor(this.hits / 5) * 0.5, 5)
    if (this.hits > this.best) this.best = this.hits
    const { rank } = rankForHits(this.hits)
    if (rank && rank !== this.lastRank) {
      this.lastRank = rank
      if (rank.length > this.bestRank.length) this.bestRank = rank
      this.rankUpT = 0.7
    }
  }

  update(dt: number): void {
    this.rankUpT = Math.max(0, this.rankUpT - dt)
    if (this.hits > 0) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.hits = 0
        this.mult = 1
        this.lastRank = ''
      }
    }
  }

  reset(): void {
    this.hits = 0
    this.timer = 0
    this.mult = 1
    this.best = 0
    this.bestRank = ''
    this.rankUpT = 0
    this.lastRank = ''
  }
}

interface Banner {
  title: string
  sub: string
  t: number
  dur: number
  color: string
}

interface ExecState {
  enemy: Enemy
  t: number
  step: number
  sheathed: boolean
  startX: number
  side: 1 | -1
}

type ExecutionProfile = {
  name:string; beats:readonly [number,number,number];
  clips:readonly [keyof typeof ATTACKS,keyof typeof ATTACKS,keyof typeof ATTACKS]
  angles:readonly [number,number,number]; material:'steel'|'embers'|'spark'|'shard'|'dust'|'echo'
}

/** Every blade family finishes with its own cadence and geometry. Elemental
 * punctuation remains material-bound; the body/weapon route does the work. */
const EXECUTIONS:Record<SwordId,ExecutionProfile>={
  katana:{name:'SHEATHED CROSS',beats:[.17,.43,.72],clips:['riposte','l1','retreat'],angles:[-.18,.72,-.86],material:'steel'},
  wakizashi:{name:'CLOSE QUARTERS',beats:[.12,.29,.51],clips:['stabs','spin','l5'],angles:[0,.95,-.55],material:'steel'},
  chokuto:{name:'THREE GATES',beats:[.16,.39,.69],clips:['stabs','h1','dashSlash'],angles:[0,-.38,.28],material:'steel'},
  saber:{name:'CAVALRY TURN',beats:[.13,.34,.59],clips:['spin','dashSlash','retreat'],angles:[.85,-.72,.42],material:'steel'},
  nodachi:{name:'FIELD HARVEST',beats:[.24,.58,.93],clips:['h1','powerArc','h2'],angles:[-.78,.18,.92],material:'steel'},
  greatblade:{name:'IRON VERDICT',beats:[.29,.66,1.02],clips:['launcher','powerArc','powerSlash'],angles:[-1.05,.12,.86],material:'dust'},
  inferno:{name:'CINDER CREMATION',beats:[.18,.43,.75],clips:['stormFront','powerArc','powerSlash'],angles:[-.65,.7,.08],material:'embers'},
  thunder:{name:'CIRCUIT BREAK',beats:[.11,.28,.5],clips:['dashSlash','stabs','stormFront'],angles:[0,.82,-.7],material:'spark'},
  frost:{name:'COLD FRACTURE',beats:[.2,.49,.82],clips:['h2','risingGale','powerArc'],angles:[-.55,.3,.9],material:'shard'},
  gale:{name:'CROSSWIND END',beats:[.12,.31,.56],clips:['dashHeavy','spin','stormFront'],angles:[.7,-.68,.15],material:'dust'},
  earth:{name:'FAULT SENTENCE',beats:[.28,.63,.98],clips:['powerArc','launcher','powerSlash'],angles:[-.9,.05,.82],material:'dust'},
  void:{name:'BLIND-SIDE END',beats:[.15,.37,.64],clips:['retreat','dashSlash','riposte'],angles:[-.2,.88,-.75],material:'echo'},
  gravity:{name:'WEIGHT OF JUDGMENT',beats:[.25,.59,.94],clips:['risingGale','launcher','powerArc'],angles:[.35,-.85,.72],material:'dust'},
  phantom:{name:'MIRROR FUNERAL',beats:[.1,.27,.49],clips:['blenderCharge','spin','dashHeavy'],angles:[.9,-.5,.28],material:'echo'},
}

interface UltState {
  t: number
  step: number
}

/* ------------------------------------------------------------------ */

export class Game {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private raf = 0
  // --- render interpolation ("fix your timestep"): the sim advances in
  // fixed 1/60 steps (the tested configuration) into an accumulator; the
  // render samples motion BETWEEN the last two sim states so every display
  // frame advances smoothly at any refresh rate. Physics and sprite frames
  // are untouched — only the drawn position/time are sampled continuously.
  private simAccum = 0
  private prevStepTime = 0
  private renderTime = 0
  private interpInstalled = false
  private lastFrame = 0
  private cssW = 1280
  private cssH = 720
  private dpr = 1

  phase: GamePhase = 'attract'
  settings: GameSettings = { ...DEFAULT_SETTINGS }
  unlocked: SwordId[] = ['katana']
  private lifetimeKills = 0
  private loadout: SwordId[] = ['katana']

  input = new Input()
  audio = new AudioEngine()
  cam = new Camera()
  fx = new FX()
  readonly storm=new StormEngine('high')
  bg:BackgroundRenderer = DEFAULT_SETTINGS.level==='zen-night' ? new ZenNightBackground(this.storm) : new CyberBackground('high',this.storm)
  /** which level the current bg was built for — applySettings rebuilds on
   *  mismatch, so the saved/default stage actually loads at startup (the
   *  old levelChanged check compared settings-to-settings and silently
   *  kept CyberBackground for a zen-night save) */
  private bgLevel:LevelId = DEFAULT_SETTINGS.level
  /* ambient storm audio: a soft distant crackle each time the sky strikes */
  private thunderCb = (): void => {
    this.audio.play('lightning', { volume: 0.22 })
  }
  hud = new HUD()
  private renderer = new Renderer()
  player = new Player()
  /** animation inspection lab (skeleton viz / contact sheets / QA) */
  inspect!: Inspect
  /** QA harness mode: suppresses wave spawning + death→gameover so
   * scripted sequences run in a controlled empty arena */
  qaMode = false
  enemies: Enemy[] = []
  projectiles = new ProjectilePool()
  waves: WaveDirector
  combo = new ComboTracker()

  time = 0
  timeScale = 1
  private slowmoT = 0
  private slowmoScale = 1
  private hitstopT = 0

  private exec: ExecState | null = null
  private ult: UltState | null = null
  private banner: Banner | null = null

  /* ---- PERFORMANCE GOVERNOR (the "hangs when enemies appear" fix) ----
   * Frame cost must NOT grow when the frame rate falls. Three defenses:
   *   1. substeps are CAPPED (3 × 1/60) — a slow frame simulates at most
   *      50ms of world, never 5× full-cost steps (the old death spiral:
   *      raster slows → more substeps → slower → more substeps → freeze)
   *   2. visual systems (weather, particles, camera) tick ONCE per frame,
   *      not per substep — rain never integrates at 450Hz
   *   3. render resolution (DPR) auto-scales to the measured frame rate */
  private dprTarget = 1
  /** perf readout: JS frame cost vs the leftover inter-frame gap (a raster/
   * compositor/present ESTIMATE) — the bottleneck, shown instead of hidden. */
  private jsMs = 0
  private rastMs = 0
  private lastGapAt = 0
  /** session resolution ceiling — pinned DOWN the moment a raise proves
   * unstable. Without this, the governor's raise-on-calm path gambles
   * repeatedly: calm 60fps → raise DPR → next wave spawns → frame-cost
   * cliff → seconds of 20fps → slow drop → calm → raise again… the exact
   * "it hangs when the enemies appear" report. */
  private dprCeil = 1.5
  private fpsAvg = 60
  private govT = 0
  private govCool = 0
  /** wall clock (rAF seconds) — governor memory, immune to run resets */
  private wall = 0
  private lastDropAt = -60
  private lastRaiseAt = -60
  /** consecutive over-budget frames (the cliff detector's run counter) */
  private overRun = 0
  private autoQuality = true

  stats: RunStats = { score: 0, kills: 0, maxCombo: 0, wave: 0, timeAlive: 0, bestRank: '' }
  private runTime = 0
  private fps = 60

  private listeners: ((e: GameEvent) => void)[] = []
  private destroyed = false
  private visibilityBound: (() => void) | null = null
  /** F9 inspect-view cycle listener (pose editor / diagnostics) */
  private f9ViewBound: ((e: KeyboardEvent) => void) | null = null

  constructor() {
    this.waves = new WaveDirector({
      spawnEnemy: (kind, x, scale) => this.spawnEnemy(kind, x, scale),
      onWaveStart: (wave, boss) => this.onWaveStart(wave, boss),
      onWaveClear: (wave) => this.onWaveClear(wave),
      getPlayerX: () => this.player.x,
    })
    this.cam.setArena(ARENA_MIN, ARENA_MAX)
    this.player.reset(1300)
    this.cam.snapTo(1300, -150)
  }

  on(cb: (e: GameEvent) => void): () => void {
    this.listeners.push(cb)
    return () => {
      const i = this.listeners.indexOf(cb)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  private emit(e: GameEvent): void {
    for (const cb of this.listeners) cb(e)
  }

  private setPhase(p: GamePhase): void {
    this.phase = p
    this.emit({ type: 'phase', phase: p })
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                            */
  /* ------------------------------------------------------------------ */

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!this.ctx) throw new Error('Your browser could not initialize the game canvas.')
    this.input.attach()
    this.resize()
    this.visibilityBound = () => {
      if (document.hidden && this.phase === 'playing') this.pause()
    }
    document.addEventListener('visibilitychange', this.visibilityBound)
    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame(this.loop)
    this.input.setEnabled(false)
    this.bg.onThunder = this.thunderCb
    // debug/testing handle (harmless in production)
    ;(window as unknown as Record<string, unknown>).__sr = this
    // the compiled empty-hand table, for sheet capture/automation
    ;(window as unknown as Record<string, unknown>).__srMoves = MOVES
    // ANIMATION INSPECTION LAB (spec §12): skeleton viz, contact sheets,
    // state readout + scripted QA harness
    this.inspect = new Inspect()
    const srAny = window as unknown as Record<string, unknown>
    const inspect = this.inspect
    srAny.__srInspect = {
      setView: (m: InspectMode | number) => inspect.setView(m),
      toggleBones: () => inspect.toggleBones(),
      cycleView: () => inspect.cycleView(),
      scrubBy: (frames: number) => inspect.scrubBy(frames),
      scrubTo: (t: number) => inspect.scrubTo(t),
      selectChannel: (i: number | string) => inspect.selectChannel(i),
      nudge: (delta: number) => inspect.nudge(delta),
      mirror: () => inspect.mirror(),
      resetOverrides: () => inspect.resetOverrides(),
      exportPose: () => inspect.exportPose(),
      savePreset: (name?: string) => inspect.savePreset(name),
      loadPreset: (key: string | number) => inspect.loadPreset(key),
      listPresets: () => inspect.listPresets(),
      get editorInfo() { return inspect.editorInfo },
      get mode() { return inspect.mode },
    }
    srAny.__srPoseLib = {
      save: (name: string) => inspect.savePreset(name),
      load: (key: string | number) => inspect.loadPreset(key),
      list: () => inspect.listPresets(),
      delete: (name: string) => inspect.poseLib.delete(name),
      detail: (key: string | number) =>
        typeof key === 'number' ? inspect.poseLib.get(key) : inspect.poseLib.find(key),
    }
    // Live scripted QA harness (checks A–I: NaN, foot penetration, pose
    // continuity, deadlocks, frame-rate invariance, FX pools, PAVE
    // micro-motion, afterimage hygiene, escalation table) — installs the
    // window.__srQA handle { run(), last }.
    installQA(this)
    // F9 cycles the inspect views (off → solo → sheet → edit). A dedicated
    // listener (not the Input action map) so it works even while the
    // gameplay input layer is disabled on menus.
    this.f9ViewBound = (e: KeyboardEvent) => {
      if (e.code === 'F9') {
        e.preventDefault()
        inspect.cycleView()
      }
    }
    window.addEventListener('keydown', this.f9ViewBound)
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.input.detach()
    if (this.visibilityBound) document.removeEventListener('visibilitychange', this.visibilityBound)
    this.audio.destroy()
    this.listeners.length = 0
    const debug = window as unknown as Record<string, unknown>
    if (debug.__sr === this) {
      delete debug.__sr
      delete debug.__srInspect
      delete debug.__srPoseLib
      delete debug.__srQA
    }
    if (this.f9ViewBound) window.removeEventListener('keydown', this.f9ViewBound)
  }

  resize(): void {
    if (!this.canvas) return
    const parent = this.canvas.parentElement
    const w = parent?.clientWidth ?? window.innerWidth
    const h = parent?.clientHeight ?? window.innerHeight
    this.cssW = Math.max(320, w)
    this.cssH = Math.max(240, h)
    const cap = this.settings.quality === 'ultra' ? 2 : this.settings.quality === 'high' ? 1.5 : this.settings.quality === 'medium' ? 1.25 : 1
    this.dpr = Math.min(this.dprTarget, cap)
    const bw = Math.floor(this.cssW * this.dpr)
    const bh = Math.floor(this.cssH * this.dpr)
    // canvas.width assignment = a GPU buffer realloc + a frame-pacing reset —
    // never do it for a no-op (the dpr governor was thrashing this).
    if (this.canvas.width !== bw) this.canvas.width = bw
    if (this.canvas.height !== bh) this.canvas.height = bh
    this.canvas.style.width = `${this.cssW}px`
    this.canvas.style.height = `${this.cssH}px`
    this.cam.setViewport(this.cssW, this.cssH)
    this.bg.resize(this.cssW, this.cssH)
  }

  /** resolution governor: every 0.8s of PLAYING, compare the damped frame
   * rate against thresholds and step the render DPR down (or back up) with
   * hysteresis. If DPR 1 still can't hold ~40fps, fall a quality tier
   * (rain/mote/fog/mist/reflection density all scale with tier). */
  private govern(dt: number): void {
    if (!this.autoQuality || this.phase !== 'playing') return
    this.govT += dt
    this.govCool = Math.max(0, this.govCool - dt)
    if (this.govT < 0.8) return
    this.govT = 0
    if (this.govCool > 0) return
    const cap = Math.min(
      this.settings.quality === 'ultra' ? 2 : this.settings.quality === 'high' ? 1.5 : this.settings.quality === 'medium' ? 1.25 : 1,
      this.dprCeil,
    )
    if (this.fpsAvg < 44 && this.dprTarget > 0.8) {
      this.dprTarget = Math.max(0.8, this.dprTarget - 0.25)
      this.lastDropAt = this.wall
      this.govCool = 2.2 // pacing needs seconds to climb back from a realloc
      this.resize()
    } else if (this.fpsAvg < 36 && this.dprTarget <= 0.81 && this.settings.quality !== 'ultra') {
      // resolution floor reached and still drowning → drop a quality tier
      const order: GameSettings['quality'][] = ['ultra','high', 'medium', 'low']
      const i = order.indexOf(this.settings.quality)
      if (i < order.length - 1) {
        this.applySettings({ ...this.settings, quality: order[i + 1] })
        this.govCool = 4
      }
    } else if (
      this.fpsAvg > 57
      && this.dprTarget < cap
      && this.wall - this.lastDropAt > 12 // respect every drop for 12s
      && this.wall - this.lastRaiseAt > 3 // one raise at a time
      && this.enemies.length < 3          // never raise into a wave
    ) {
      this.dprTarget = Math.min(cap, this.dprTarget + 0.25)
      this.lastRaiseAt = this.wall
      this.govCool = 3
      this.resize()
    }
  }

  /** CLIFF DETECTOR — the hang killer. rAF is vsync-quantized (16.7 /
   * 33.3 / 49.9ms steps), so the damped fpsAvg reacts sluggishly: by the
   * time the 0.8s polling cadence notices, the player has already eaten
   * 2–5 seconds of 20fps. A real cliff instead shows as a RUN of frames at
   * ≥1.5× the 60Hz budget — react within ~0.15s by stepping the render DPR
   * down immediately. If the cliff lands within 6s of a raise, that raise
   * proved the level unstable on this display: pin the session ceiling at
   * the pre-raise DPR so the governor stops gambling on it. */
  private detectCliff(dtRaw: number): void {
    if (this.phase === 'paused' || document.visibilityState !== 'visible') {
      this.overRun = 0
      return
    }
    if (dtRaw > 0.025) this.overRun++
    else if (dtRaw < 0.019) this.overRun = 0
    if (this.overRun < 8) return
    this.overRun = 0
    if (this.dprTarget <= 1) return
    if (this.wall - this.lastRaiseAt < 6) {
      // the recent raise was the cause → pin the ceiling at the pre-raise level
      this.dprCeil = Math.max(1, this.dprTarget - 0.25)
    }
    this.dprTarget = Math.max(1, this.dprTarget - 0.25)
    this.lastDropAt = this.wall
    this.govCool = Math.max(this.govCool, 1)
    this.resize()
  }

  applySettings(s: GameSettings): void {
    const qualityChanged = s.quality !== this.settings.quality
    const levelChanged = s.level !== this.bgLevel
    this.settings = { ...s }
    this.fx.setQuality(s.quality)
    this.fx.setGore(s.gore)
    this.renderer.setQuality(s.quality) // grain cadence follows the tier
    this.cam.setShakeEnabled(s.shake, s.shakeIntensity)
    this.audio.setSfxVolume(s.sfxVolume)
    this.audio.setMusicVolume(s.musicVolume)
    this.audio.setMuted(s.muted)
    if (qualityChanged || levelChanged) {
      this.storm.setQuality(s.quality)
      this.bg = s.level==='zen-night' ? new ZenNightBackground(this.storm) : new CyberBackground(s.quality,this.storm)
      ;(this.bg as {setQuality?: (q: GameSettings['quality']) => void}).setQuality?.(s.quality)
      this.bgLevel = s.level
      this.bg.onThunder = this.thunderCb
      this.bg.resize(this.cssW, this.cssH)
      this.resize()
    }
  }

  setUnlocked(list: SwordId[], totalKills = this.lifetimeKills): void {
    this.unlocked = list
    this.lifetimeKills = totalKills
  }

  private equipProgressedSword(id: SwordId): void {
    this.player.setSword(id, swordTier(id, this.lifetimeKills))
  }

  setLoadout(ids: SwordId[]): void {
    const legal = [...new Set(ids)].filter((id) => this.unlocked.includes(id)).slice(0, 3)
    const heavenly = legal.includes('katana') && swordTier('katana', this.lifetimeKills) === 2
    // Heavenly Steel is intentionally self-sufficient: choosing it closes
    // the other scabbard slots for this round.
    this.loadout = heavenly ? ['katana'] : legal.length ? legal : ['katana']
  }

  /* ------------------------------------------------------------------ */
  /* run control                                                          */
  /* ------------------------------------------------------------------ */

  startRun(swordId: SwordId): void {
    this.audio.resume()
    this.audio.startMusic()
    this.audio.setMusicIntensity(0.55)
    if (!this.loadout.includes(swordId)) this.setLoadout([swordId])
    this.equipProgressedSword(this.loadout.includes(swordId) ? swordId : this.loadout[0])
    this.player.reset(1300)
    this.enemies.length = 0
    this.projectiles.clear()
    this.fx.clear()
    this.hud.reset()
    this.combo.reset()
    this.waves.reset()
    this.stats = { score: 0, kills: 0, maxCombo: 0, wave: 0, timeAlive: 0, bestRank: '' }
    this.runTime = 0
    this.time = 0
    this.prevStepTime = 0
    this.simAccum = 0
    this.timeScale = 1
    this.slowmoT = 0
    this.hitstopT = 0
    this.exec = null
    this.ult = null
    this.banner = null
    this.cam.snapTo(this.player.x, -150)
    this.cam.setZoom(1)
    this.input.setEnabled(true)
    this.setPhase('playing')
    this.audio.play('uiConfirm')
  }

  pause(): void {
    if (this.phase !== 'playing') return
    this.setPhase('paused')
    this.input.setEnabled(false)
    this.audio.play('uiClick')
    this.audio.setMusicIntensity(0.2)
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.setPhase('playing')
    this.input.setEnabled(true)
    this.lastFrame = performance.now()
    this.audio.setMusicIntensity(0.55)
    this.audio.play('uiConfirm')
  }

  quitToMenu(): void {
    this.enemies.length = 0
    this.projectiles.clear()
    this.fx.clear()
    this.waves.reset()
    this.player.reset(1300)
    this.combo.reset()
    this.exec = null
    this.ult = null
    this.banner = null
    this.timeScale = 1
    this.hitstopT = 0
    this.audio.stopMusic()
    this.input.setEnabled(false)
    this.setPhase('attract')
    this.cam.snapTo(1300, -150)
    this.cam.setZoom(0.95)
  }

  private gameOver(): void {
    this.setPhase('gameover')
    this.input.setEnabled(false)
    this.audio.setMusicIntensity(0.1)
    this.audio.play('deathHeavy', { volume: 0.9 })
    this.addSlowmo(0.25, 2)
    this.stats.wave = this.waves.wave
    this.stats.maxCombo = this.combo.best
    this.stats.bestRank = this.combo.bestRank || 'D'
    this.stats.timeAlive = this.runTime
    this.emit({ type: 'gameover', stats: { ...this.stats } })
  }

  /* ------------------------------------------------------------------ */
  /* main loop                                                            */
  /* ------------------------------------------------------------------ */

  private loop = (now: number): void => {
    try {
      const t0 = performance.now()
      this.frame(now)
      const js = performance.now() - t0
      this.jsMs += (js - this.jsMs) * 0.12
      const gap = this.lastGapAt ? Math.max(0, now - this.lastGapAt) : 0
      this.lastGapAt = now
      if (gap > 0) this.rastMs += (Math.max(0, gap - js) - this.rastMs) * 0.1
    } catch (error) {
      console.error('Game loop stopped after an unexpected error', error)
      cancelAnimationFrame(this.raf)
      this.input.setEnabled(false)
      this.audio.destroy()
      this.emit({ type: 'error' })
    }
  }

  private frame(now: number): void {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.loop)
    let dtRaw = (now - this.lastFrame) / 1000
    this.lastFrame = now
    // NO FPS FLOOR: the old 0.05 clamp made every slow frame read as exactly
    // 20fps (a fake plateau). Only guard true stalls; report TRUE frame rate.
    if (dtRaw > 0.25) dtRaw = 0.25
    if (dtRaw <= 0) dtRaw = 0.0001
    this.fps = damp(this.fps, 1 / dtRaw, 10, dtRaw)
    this.fpsAvg = damp(this.fpsAvg, 1 / dtRaw, 2.2, dtRaw)
    this.wall = now / 1000
    this.renderTime = this.time // frozen/paused frames render the sim time
    this.govern(dtRaw)
    this.detectCliff(dtRaw)
    // Weather has its own real visual clock, independent of combat hitstop.
    // The pose editor freezes the whole frame for authoring.
    const editFrozen = this.inspect.mode === 'edit'
    if(this.phase!=='paused' && !editFrozen)this.storm.update(dtRaw)

    const ctx = this.ctx
    if (!ctx) return

    if (this.phase === 'paused' || editFrozen) {
      // frozen frame, HUD still drawn (edit = pose-editor authoring freeze)
    } else {
      // --- timing: hitstop & slow-mo ---
      let simDt = dtRaw
      if (this.hitstopT > 0) {
        this.hitstopT -= dtRaw
        simDt = dtRaw * 0.05
        this.timeScale = 0.05 // world consumers (blade impact deflection) must SEE the freeze
      } else if (this.slowmoT > 0) {
        this.slowmoT -= dtRaw
        simDt = dtRaw * this.slowmoScale
        this.timeScale = this.slowmoScale
        if (this.slowmoT <= 0) this.timeScale = 1
      } else {
        this.timeScale = 1
      }

      // --- cinematics run on real time ---
      this.updateCinematics(dtRaw)

      // --- fixed-timestep substeps + accumulator (render interpolation):
      // the sim always advances in exact 1/60 steps (the tested, tuned
      // configuration at EVERY frame rate) and the leftover time carries
      // over. NO death spiral: at most 3 steps + one clamped catch-up tick
      // per frame, so the cost of a frame stays bounded on slow machines.
      this.simAccum += simDt
      let substeps = 0
      let caughtUp = false
      while (this.simAccum >= 1 / 60 && substeps < 3) {
        this.recordPrev()
        this.step(1 / 60)
        // EDGE LIFETIME = ONE SUBSTEP. pressed()/released() edges must be
        // visible to exactly ONE simulation step: clearing them only once
        // per RENDERED frame let a single jump press fire doJump in BOTH
        // substeps of a slow frame (jump then airJump in the same frame —
        // the −950 impulse was stomped to −820 mid-rise and the leap clip
        // was overwritten by airJump). Input events can only arrive BETWEEN
        // rAF callbacks, so no press is ever missed; presses that land while
        // a state ignores them are still caught by the combo BUFFER, which
        // is pressTime-based and deliberately spans substeps and frames.
        this.input.endFrame(1 / 60)
        this.simAccum -= 1 / 60
        substeps++
      }
      if (this.simAccum >= 1 / 60) {
        // very slow frame: consume the backlog as one clamped catch-up tick
        // so the world keeps roughly real-time without multiplying cost
        this.recordPrev()
        this.step(Math.min(this.simAccum, 0.05))
        this.input.endFrame(0.05)
        this.simAccum = 0
        caughtUp = true
        // collapse the interpolation history onto the frontier: the jump is
        // shown on this frame (the display froze anyway) and the NEXT frames
        // interpolate strictly forward from here — never rewind.
        this.recordPrev()
      }
      // --- visual systems tick ONCE per frame (never per substep) ---
      this.fx.update(simDt)
      this.bg.update(simDt)
      // --- sample the render between the last two sim states ---
      // alpha sweeps 0..1 as the leftover accumulator fills toward the next
      // step, so motion advances a little EVERY display frame instead of
      // jumping at sim steps (the "90fps feel": smooth at 60/90/120/144Hz
      // and through timing jitter). On a hitch catch-up frame the frontier
      // state is shown directly (alpha=1) — no duplicate frame.
      const alpha = caughtUp ? 1 : Math.min(1, Math.max(0, this.simAccum * 60))
      this.renderTime = this.prevStepTime + alpha * (this.time - this.prevStepTime)
      this.installRenderLerp(alpha)
      this.updateCamera(simDt)
    }

    // --- render ---
    try {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      const world: RenderWorld = {
        cam: this.cam,
        fx: this.fx,
        bg: this.bg,
        enemies: this.enemies,
        player: this.player,
        projectiles: this.projectiles,
        hud: this.hud,
        hudState: this.buildHudState(),
        time: this.renderTime,
      }
      this.renderer.draw(ctx, world, this.cssW, this.cssH, dtRaw)
      // pose editor tick (keys + preview + solve) while its freeze is active;
      // MUST run before endFrame so raw editor key edges survive one frame
      if (editFrozen) this.inspect.editorFrame(this, dtRaw)
      // inspection overlay (solo/sheet/edit views + state readout)
      this.inspect.draw(ctx, this, this.renderTime)
      // PERF READOUT — the bottleneck, SHOWN live: JS frame cost vs the
      // leftover inter-frame gap (raster/present estimate), the bound class,
      // and the governor's active levers. "Something is bottlenecked but not
      // shown" — now it is shown.
      {
        const bound = this.rastMs > this.jsMs * 1.5 ? 'GPU' : this.jsMs > this.rastMs * 1.5 ? 'CPU' : 'MIX'
        const locked = this.fpsAvg > 25 && this.fpsAvg < 35 && this.jsMs < 12 ? ' · 30Hz-lock? (browser throttle: battery-saver / iframe / vsync-half)' : ''
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
        ctx.font = '10px ui-monospace,monospace'
        ctx.fillStyle = 'rgba(190,220,232,.55)'
        ctx.textAlign = 'right'
        ctx.fillText(`${Math.round(this.fpsAvg)}fps · js ${this.jsMs.toFixed(1)}ms · gpu~${this.rastMs.toFixed(1)}ms · ${bound}-bound · dpr ${this.dpr} · ${this.settings.quality}${locked}`, this.cssW - 12, 62)
      }
    } finally {
      // ALWAYS hand the sim its true positions back (crash-safe)
      this.uninstallRenderLerp()
    }

    this.input.endFrame(dtRaw)
  }

  /** Snapshot sim positions before a step (render interpolation). */
  private recordPrev(): void {
    this.prevStepTime = this.time
    const p = this.player
    p.px = p.x
    p.py = p.y
    for (const e of this.enemies) {
      e.px = e.x
      e.py = e.y
    }
    this.projectiles.recordPrev()
  }

  /** Install interpolated render positions (swap trick: px/py hold the true
   *  sim values until uninstallRenderLerp restores them). */
  private installRenderLerp(alpha: number): void {
    const p = this.player
    {
      const cx = p.x
      const px = Number.isFinite(p.px) ? p.px : p.x
      p.x = px + (p.x - px) * alpha
      p.px = cx
      const cy = p.y
      const py = Number.isFinite(p.py) ? p.py : p.y
      p.y = py + (p.y - py) * alpha
      p.py = cy
    }
    for (const e of this.enemies) {
      const cx = e.x
      const px = Number.isFinite(e.px) ? e.px : e.x
      e.x = px + (e.x - px) * alpha
      e.px = cx
      const cy = e.y
      const py = Number.isFinite(e.py) ? e.py : e.y
      e.y = py + (e.y - py) * alpha
      e.py = cy
    }
    this.projectiles.lerpRender(alpha)
    this.interpInstalled = true
  }

  /** Restore the true sim positions after the frame has been drawn. */
  private uninstallRenderLerp(): void {
    if (!this.interpInstalled) return
    this.interpInstalled = false
    const p = this.player
    p.x = p.px
    p.y = p.py
    for (const e of this.enemies) {
      e.x = e.px
      e.y = e.py
    }
    this.projectiles.unlerpRender()
  }

  private step(dt: number): void {
    this.time += dt
    this.worldRef.time = this.time
    this.worldRef.timeScale = this.timeScale
    this.worldRef.quality = this.settings.quality
    this.worldRef.gore = this.settings.gore
    PLAYER_X_REF.x = this.player.x
    PLAYER_X_REF.y = this.player.y
    PLAYER_POS.x = this.player.x
    PLAYER_POS.y = this.player.y

    if (this.phase === 'playing' || this.phase === 'gameover') {
      if (this.phase === 'playing') {
        this.handleMetaInput()
      }
      this.player.update(dt, this.worldRef)
      for (const e of this.enemies) {
        e.update(dt, this.worldRef)
      }
      // purge dead
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        if (this.enemies[i].dead) this.enemies.splice(i, 1)
      }
      this.projectiles.update(dt, this.worldRef)

      if (this.phase === 'playing') {
        if (!this.qaMode) this.waves.update(dt, this.enemies.length)
        this.combo.update(dt)
        this.runTime += dt
        this.stats.timeAlive = this.runTime
        // death → game over
        if (!this.qaMode && this.player.isDead && this.player.deadTime > 1.4) {
          this.gameOver()
        }
      }
    } else if (this.phase === 'attract') {
      // idle hero breathing on the rooftop (framed below the title logo)
      this.player.update(dt, this.worldRef)
      this.cam.focus(this.player.x + Math.sin(this.time * 0.14) * 140, this.player.y - 110, 0, 0)
    }
  }

  private updateCamera(dt: number): void {
    if (this.phase === 'playing' || this.phase === 'gameover') {
      const p = this.player
      let tx = p.x
      let ty = p.y
      let vx = p.vx
      let vy = p.vy
      // during execution / ult, focus the action
      if (this.exec) {
        tx = (p.x + this.exec.enemy.x) / 2
        ty = (p.y + this.exec.enemy.y) / 2 - 30
        vx = 0
        vy = 0
      }
      this.cam.focus(tx, ty, vx, vy)
      // dynamic zoom: pull back when many enemies, punch in during cinematics
      let zoom = 1.04
      const n = this.enemies.length
      if (n > 10) zoom = 0.94
      if (n > 18) zoom = 0.88
      if (this.exec || this.ult) zoom = 1.3
      this.cam.setZoom(zoom)
    }
    this.cam.update(dt)
  }

  private handleMetaInput(): void {
    // pause
    if (this.input.pressed('pause')) {
      this.pause()
      return
    }
    // sword switching
    const swordIds: SwordId[] = SWORD_ORDER.slice(0, 6)
    const swordActions = ['sword1', 'sword2', 'sword3', 'sword4', 'sword5', 'sword6'] as const
    for (let i = 0; i < 6; i++) {
      if (this.input.pressed(swordActions[i])) {
        this.trySwitchSword(swordIds[i])
      }
    }
    if (this.input.pressed('cycleSword')) {
      const idx = SWORD_ORDER.indexOf(this.player.sword.id)
      for (let i = 1; i <= SWORD_ORDER.length; i++) {
        const next = SWORD_ORDER[(idx + i) % SWORD_ORDER.length]
        if (this.loadout.includes(next)) {
          this.trySwitchSword(next)
          break
        }
      }
    }
    // ultimate
    if (this.input.pressed('ult') && this.player.meter >= 100 && !this.ult && !this.exec) {
      this.startUlt()
    }
    // execution
    if (this.input.pressed('execute') && !this.exec && !this.ult) {
      const target = this.findExecuteTarget()
      if (target) this.startExecution(target)
    }
  }

  trySwitchSword(id: SwordId): void {
    if (!this.unlocked.includes(id) || !this.loadout.includes(id)) return
    if (this.player.sword.id === id) return
    if (this.player.state === 'dead' || this.player.state === 'scripted') return
    const evolved = upgradedSword(id, swordTier(id, this.lifetimeKills))
    const colors = evolved.colors
    this.equipProgressedSword(id)
    this.audio.play('swordSwitch')
    this.fx.dissolve(this.player.x, this.player.y - 40, colors.core, colors.glow)
    this.fx.burst(this.player.x, this.player.y - 50, 12, colors.glow, 260, 0.5, 'spark')
    this.fx.text(this.player.x, this.player.y - 90, evolved.name, colors.accent, 13)
  }

  /* ------------------------------------------------------------------ */
  /* waves                                                                */
  /* ------------------------------------------------------------------ */

  private spawnEnemy(kind: EnemyKind, x: number, waveScale: number): void {
    if (this.enemies.length > 42) return
    this.enemies.push(new Enemy(kind, x, waveScale))
    // spawn fx: sky drop marker
    this.fx.burst(x, -420, 6, '#8fb4c8', 120, 0.6, 'dot')
    if (kind === 'boss') {
      this.emit({ type: 'bossSpawn' })
    }
  }

  private onWaveStart(wave: number, boss: boolean): void {
    this.stats.wave = wave
    this.cam.addTrauma(0.2)
    if (boss) {
      this.banner = { title: 'WARNING', sub: 'GEMINI MK-II DEPLOYED', t: 0, dur: 2.6, color: '#ff2a4a' }
      this.audio.play('bossAlert', { volume: 0.8 })
      this.fx.screenFlash('#ff2a4a', 0.22, 2.5)
    } else {
      this.banner = { title: `WAVE ${wave}`, sub: 'HOSTILES INBOUND', t: 0, dur: 2.2, color: '#ffae2e' }
      this.audio.play('wave', { volume: 0.6 })
    }
    this.audio.setMusicIntensity(clamp(0.45 + wave * 0.04, 0.45, 1))
    this.emit({ type: 'wave', wave, boss })
  }

  private onWaveClear(wave: number): void {
    const bonus = 100 * wave
    this.stats.score += bonus
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 18)
    this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 25)
    if (this.player.sword.mundane) {
      this.player.maintainSword()
      this.fx.text(this.player.x, this.player.y - 88, 'BLADE WIPED · EDGE CHECKED', '#d7dcda', 10)
    }
    this.banner = { title: 'WAVE CLEAR', sub: `+${fmt(bonus)} BONUS — SYSTEMS RESTORED`, t: 0, dur: 2.2, color: '#46ffb4' }
    this.audio.play('heal')
    this.fx.burst(this.player.x, this.player.y - 50, 10, '#46ffb4', 200, 0.8, 'ember')
  }

  /* ------------------------------------------------------------------ */
  /* combat resolution (WorldRef)                                         */
  /* ------------------------------------------------------------------ */

  private worldRef: WorldRef = {
    fx: this.fx,
    audio: this.audio,
    cam: this.cam,
    input: this.input,
    enemies: this.enemies,
    projectiles: this.projectiles,
    time: 0,
    timeScale: 1,
    arenaMinX: ARENA_MIN,
    arenaMaxX: ARENA_MAX,
    quality: 'high',
    gore: 'energy',
    hitEnemy: (id, blade, atk) => this.hitEnemy(id, blade, atk),
    enemyStrikePlayer: (dmg, dir, heavy, sourceX) => this.enemyStrikePlayer(dmg, dir, heavy, sourceX),
    spawnProjectile: (p) => this.projectiles.spawn(p),
    addHitstop: (t, zoom) => this.addHitstop(t, zoom),
    addSlowmo: (scale, t) => this.addSlowmo(scale, t),
    screenFlash: (color, alpha, t) => this.fx.screenFlash(color, alpha, 4),
    onEnemyKilled: (e) => this.onEnemyKilled(e),
  }

  private hitEnemy(enemyId: number, blade: { bx: number; by: number; tx: number; ty: number }, atk: AttackRuntimeInfo): HitResolution {
    const e = this.enemies.find((en) => en.id === enemyId)
    if (!e || e.dead) return missedHit(enemyId)
    const sword = this.player.sword
    const dir = atk.unarmed?this.player.face:Math.sign(blade.tx - blade.bx) || this.player.face
    const hx = (blade.bx + blade.tx) / 2
    const hy = (blade.by + blade.ty) / 2
    const ex = e.x
    // impact FX at the blade's actual contact height, clamped to the visual
    // body (head-top ≈ 88u … feet ≈ 10u) — sparks appear where the edge
    // crossed the silhouette, not at a fixed belly point
    const ey = clamp(hy, e.y - 86 * e.scale, e.y - 10 * e.scale)

    // elite parry: occasionally deflects light strikes
    if (e.kind === 'elite' && !atk.heavy && Math.random() < 0.16 && e.state !== 'stun' && e.state !== 'launched') {
      this.audio.play('clang')
      this.fx.impact(ex, ey, Math.atan2(ey - hy, ex - hx), true, '#ffffff', '#ff5c7a')
      this.fx.sparks(ex, ey, -Math.PI / 2, 1.4, 12, '#ffffff', 420, 0.4)
      this.addHitstop(0.05)
      this.cam.addTrauma(0.15)
      this.fx.text(ex, ey - 50, 'PARRY!', '#ff5c7a', 12)
      return parriedHit(enemyId)
    }

    const resolution=resolveEnemyHit(e,atk,dir,this.player.x)
    const res=resolution.outcome

    // Contact is not automatically a hit-confirm (block/chip/parry earn none).
    if(rewardsConfirmedHit(resolution)){
    this.combo.onHit()
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo.hits)
    if (this.combo.rankUpT > 0.6) {
      this.audio.play('rankup', { pitch: 1 + this.combo.hits * 0.002 })
      this.emit({ type: 'rank', rank: this.combo.lastRank })
    }
    this.stats.score += Math.round(resolution.actualDamage * this.combo.mult * 0.8)
    }

    switch (res) {
      case 'miss':break
      case 'killed': {
        this.onEnemyKilled(e)
        break
      }
      case 'blocked': {
        this.audio.play('clang', { pitch: 0.9 })
        this.fx.impact(ex, ey, Math.atan2(ey - hy, ex - hx), false, '#ffffff', '#46ffb4')
        this.fx.text(ex, ey - 46, 'BLOCK', '#46ffb4', 11)
        this.addHitstop(0.03)
        this.cam.addTrauma(0.06)
        break
      }
      case 'armored': {
        this.audio.play('clang', { pitch: 0.6, volume: 0.8 })
        this.fx.sparks(ex, ey, Math.atan2(ey - hy, ex - hx), 0.9, 8, '#ffae2e', 320, 0.35)
        this.fx.text(ex, ey - 46, 'ARMOR', '#ffae2e', 11)
        this.addHitstop(0.02)
        break
      }
      default: {
        // solid hit
        this.audio.play(atk.heavy ? 'hitHeavy' : 'hit', {
          volume: clamp(0.55 + atk.dmg * 0.01, 0.55, 1),
          pitch: rand(0.94, 1.08),
          intensity: clamp01(atk.dmg / 30),
        })
        this.fx.impact(ex, ey, Math.atan2(ey - hy, ex - hx), atk.heavy, sword.colors.glow, sword.colors.accent)
        const dmgShown = Math.round(resolution.actualDamage)
        this.fx.text(ex, ey - 46, `${dmgShown}`, atk.heavy ? sword.colors.accent : '#f4f9fc', atk.heavy ? 17 : 13)
        // crash-zoom punch on heavies (Z-axis push-pull) + impact frames on
        // the big connects — the anime kill-frame language
        this.addHitstop(atk.hitstop, atk.heavy ? 0.09 : 0)
        if (atk.heavy && atk.dmg >= 15) {
          this.fx.impactFrame(ex, ey, sword.colors.glow)
        } else if (atk.heavy) {
          this.fx.chroma(0.45)
        }
        this.cam.addTrauma(atk.shake)
        if (e.vulnerableT > 0) this.fx.text(ex, ey - 70, 'WEAK POINT', '#ffe14d', 11)
        break
      }
    }
    return resolution
  }

  private onEnemyKilled(e: Enemy): void {
    const sword = this.player.sword
    const gore = this.settings.gore
    this.stats.kills++
    this.stats.score += Math.round(e.cfg.score * this.combo.mult)
    e.dead = true

    // death spectacle
    if (e.kind === 'boss') {
      this.bossDeath(e)
      return
    }
    const heavyDeath = this.combo.hits % 10 === 0 || e.kind === 'elite' || e.kind === 'heavy'
    if (heavyDeath) {
      this.fx.dismember(e.x, e.y, Math.sign(e.x - this.player.x) || 1, e.cfg.style.body, gore === 'blood' ? '#c31432' : sword.colors.glow)
      this.audio.play('deathHeavy', { volume: 0.8, pitch: e.kind === 'heavy' ? 0.7 : 1 })
      this.fx.screenFlash(sword.colors.trail, 0.1, 4)
      this.addHitstop(0.08, 0.08)
      this.cam.addTrauma(0.3)
    } else {
      this.fx.dissolve(e.x, e.y - 30, e.cfg.style.body, gore === 'blood' ? '#c31432' : e.cfg.style.glow)
      this.audio.play('death', { volume: 0.6, pitch: rand(0.9, 1.15) })
      this.cam.addTrauma(0.12)
    }
    // zandatsu-style restore
    const heal = 3
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal)
    this.player.meter = Math.min(100, this.player.meter + 4)
    this.fx.text(e.x, e.y - 80, `+${heal}`, '#46ffb4', 11)
  }

  /** Execution owns its breakup, audio and rewards. Routing it through the
   * generic death spectacle duplicated dissolve/dismember debris and healing. */
  private onEnemyExecuted(e:Enemy):void {
    if(e.dead)return
    this.stats.kills++
    this.stats.score+=Math.round(e.cfg.score*this.combo.mult)
    e.dead=true
  }

  private bossDeath(e: Enemy): void {
    this.audio.play('explosion', { volume: 1 })
    this.audio.play('deathHeavy', { volume: 1, pitch: 0.6 })
    this.addSlowmo(0.2, 1.6)
    this.addHitstop(0.16, 0.15)
    this.cam.addTrauma(1)
    this.fx.impactFrame(e.x, e.y - 60, '#ffae2e')
    this.fx.screenFlash('#ffffff', 0.5, 1.6)
    for (let i = 0; i < 6; i++) {
      const ex = e.x + rand(-90, 90)
      const ey = e.y - rand(20, 160)
      this.fx.burst(ex, ey, 16, '#ffae2e', 380, 0.8, 'spark')
      this.fx.shockwave(ex, ey, 90, '#ffae2e', 0.5, 6)
    }
    this.fx.dismember(e.x, e.y, 1, e.cfg.style.body, '#ff2a4a')
    this.fx.groundCrack(e.x, 0, 180)
    this.stats.score += 2500
    this.banner = { title: 'TARGET DESTROYED', sub: 'GEMINI MK-II ELIMINATED', t: 0, dur: 2.8, color: '#ffae2e' }
  }

  private enemyStrikePlayer(dmg: number, dir: number, heavy: boolean, sourceX: number): boolean {
    if (this.phase !== 'playing') return false
    if (this.player.parryWindowOpen) {
      this.player.onParrySuccess(this.worldRef, sourceX, this.player.parryWindowPerfect)
      return true
    }
    this.player.takeDamage(this.worldRef, dmg, dir, heavy)
    return false
  }

  addHitstop(t: number, zoomPulse = 0): void {
    this.hitstopT = Math.max(this.hitstopT, t)
    if (zoomPulse > 0) this.cam.zoomPulse(zoomPulse)
  }

  addSlowmo(scale: number, t: number): void {
    this.slowmoScale = scale
    this.slowmoT = Math.max(this.slowmoT, t)
    this.timeScale = scale
  }

  /* ------------------------------------------------------------------ */
  /* execution finisher                                                   */
  /* ------------------------------------------------------------------ */

  private findExecuteTarget(): Enemy | null {
    for (const e of this.enemies) {
      if (e.dead || e.spawning || e.kind === 'boss') continue
      if (e.hp > e.maxHp * 0.5) continue
      if (e.state !== 'stun' && e.state !== 'launched' && e.state !== 'down') continue
      if (Math.abs(e.x - this.player.x) < 170 && Math.abs(e.y - this.player.y) < 190) return e
    }
    return null
  }

  private startExecution(target: Enemy): void {
    const sheathed = !this.player.swordDrawn
    const side=(target.x>this.player.x?1:-1) as 1|-1
    this.exec = { enemy: target, t: 0, step: 0, sheathed, startX:this.player.x, side }
    this.player.enterScripted()
    this.player.face = (target.x > this.player.x ? 1 : -1) as 1 | -1
    this.addSlowmo(0.16, 1.15)
    this.audio.play('execute', { volume: 0.9 })
    this.fx.screenFlash('#ffffff', 0.3, 2)
    this.cam.zoomPulse(0.3)
  }

  private updateCinematics(dt: number): void {
    if (this.banner) {
      this.banner.t += dt
      if (this.banner.t >= this.banner.dur) this.banner = null
    }
    if (this.exec) {
      const ex = this.exec
      ex.t += dt
      const e = ex.enemy
      const sword = this.player.sword
      const profile = EXECUTIONS[sword.id]
      const midY = e.y - 43 * e.scale
      const timeline=executionTimeline(sword.form,profile.beats[0])
      const cuts=timeline.cuts
      const finalT=timeline.finalCut

      // Target-relative 3D stage projected onto the side-view floor. Smooth
      // root arcs carry the real player around the victim; cuts never occur
      // from a stationary effects emitter.
      const q=clamp01(ex.t/Math.max(.01,finalT))
      this.player.x=executionRoot(ex.t,timeline,e.x,ex.side)
      this.player.face=(q<.52?ex.side:-ex.side) as 1|-1

      // Consume every crossed beat: low frame rates may cross two 50ms rapid
      // cuts in one render frame, but may never silently delete one.
      for(const i of crossedExecutionCuts(ex.step,ex.t,timeline)){
        ex.step=i+1
        if(i===0&&ex.sheathed)this.player.swordDrawn=true
        const rapid=i>=4&&i<9
        const final=i===cuts.length-1
        const base=profile.angles[i%3]
        const cross=(i%2===0?1:-1)*(.22+Math.min(i,6)*.1)
        const ang=final?profile.angles[2]:base+cross
        const y=midY+(i%5-2)*9
        const color=sword.mundane?(i%2?'#68716d':'#89918d'):(final?sword.colors.accent:sword.colors.trail)
        this.execSlash(e.x,y,color,ang,profile.material,rapid,final)
        const key=i===0&&ex.sheathed?'riposte':profile.clips[i%3]
        // Cinematic timeline uses real time while the world is slowed. Cancel
        // that scale for the animator or a 50ms beat would only expose 8ms of
        // pose and every restart would remain trapped in anticipation.
        const cinematicComp=1/Math.max(.12,this.timeScale)
        this.player.playClip(ATTACKS[key].clip,(rapid?2.25:final?1.15:1.65)*cinematicComp)
      }

      // False ending: the target remains intact while the player catches the
      // blade. Only after the quiet hold do recorded cross-planes separate.
      if(ex.step===cuts.length&&ex.t>=timeline.separateAt){
        ex.step++
        this.audio.play('deathHeavy',{volume:.9,pitch:.82})
        this.fx.impactFrame(e.x,e.y-42,sword.mundane?'#c7ccc9':sword.colors.accent)
        this.fx.executionPieces(e.x,e.y,this.player.face,e.cfg.style.body,
          this.settings.gore==='blood'?'#c31432':sword.mundane?'#737a76':sword.colors.glow,
          sword.form==='greatblade'?8:sword.id==='katana'?12:10)
        if(sword.mundane){this.fx.dust(e.x,e.y,6);this.fx.burst(e.x,e.y-40,6,'#aeb3af',140,.24,'spark')}
        this.cam.addTrauma(sword.form==='greatblade'?.72:.48)
        this.addHitstop(.1,.08)
        this.onEnemyExecuted(e)
        this.player.hp=Math.min(this.player.maxHp,this.player.hp+22)
        this.player.energy=Math.min(this.player.maxEnergy,this.player.energy+40)
        this.player.meter=Math.min(100,this.player.meter+18)
        this.stats.score+=Math.round(300*this.combo.mult)
        this.fx.text(e.x,e.y-96,profile.name,sword.mundane?'#d0d4d1':sword.colors.accent,16)
        this.fx.text(e.x,e.y-72,'+22 HP','#46ffb4',12)
        this.player.playClip(EXECUTE_POSE_CLIP,1)
      }else if(ex.step>cuts.length&&ex.t>=timeline.releaseAt){
        this.player.exitScripted()
        this.exec=null
        this.timeScale=1
        this.slowmoT=0
      }
    }
    if (this.ult) {
      const u = this.ult
      u.t += dt
      const sword = this.player.sword
      if (u.t < 1.6 && u.t > u.step * 0.095) {
        u.step++
        // strike a random living enemy with sword-specific spectacle
        const alive = this.enemies.filter((e) => !e.dead && !e.spawning)
        if (alive.length > 0) {
          const e = alive[(Math.random() * alive.length) | 0]
          const ex = e.x
          const ey = e.y - 48 * e.scale // torso height — ult slashes cross the chest
          const ang = rand(Math.PI * 2)
          switch (sword.id) {
            case 'inferno':
              this.fx.burst(ex, ey, 10, sword.colors.trail, 300, 0.6, 'ember')
              break
            case 'thunder': {
              // SKY-STRIKE: the bolt falls from the storm onto the target,
              // then RAY-TRACES onward — reflections hopping body→ground→
              // body with intent, small chain damage on each contact
              this.fx.lightningCast(
                { enemies: this.enemies, minX: ARENA_MIN, maxX: ARENA_MAX },
                ex + rand(-30, 30), ey - 280, rand(-0.12, 0.12), 1,
                {
                  color: sword.colors.trail, energy: 1, bounces: 2, dmg: 6,
                  width: 3, maxLen: 640,
                  hit: (re, d) => {
                    if (re.id === undefined || re.id === e.id) return
                    this.hitEnemy(re.id, { bx: re.x - 12, by: re.y - 40, tx: re.x + 12, ty: re.y - 40 }, {
                      id: 'ultchain', dmg: d * sword.stats.dmg, heavy: false, stagger: 0.15,
                      kb: 60, kbY: 0, launch: 0, juggle: 0, hitstop: 0.01, shake: 0.05,
                      aoe: 0, breakGuard: true, kind: 'ability',
                    })
                  },
                },
              )
              break
            }
            case 'void':
              this.fx.burst(ex, ey, 8, sword.colors.core, 200, 0.5, 'shard')
              break
            case 'gravity':
              this.fx.shockwave(ex, ey, 90, sword.colors.glow, 0.35, 5)
              break
            case 'phantom':
              this.fx.afterimage(this.player.pose, ex - 60, this.player.hipY, 1, sword.colors.trail, 0.4, 1.32)
              break
            default:
              break
          }
          this.fx.slashArc(ex, ey, ang, 2.6, 80, sword.colors.trail, sword.colors.trail2, 1.4)
          this.fx.impact(ex, ey, ang, true, sword.colors.glow, sword.colors.accent)
          this.hitEnemy(e.id, { bx: ex - 20, by: ey, tx: ex + 20, ty: ey }, {
            id: 'ult', dmg: 13 * sword.stats.dmg, heavy: true, stagger: 0.4, kb: 140, kbY: 0,
            launch: -240, juggle: -300, hitstop: 0.02, shake: 0.1, aoe: 0, breakGuard: true, kind: 'ability',
          })
          this.audio.play('swing', { pitch: rand(1.15, 1.4), volume: 0.7 })
        }
      }
      if (u.step >= 16 && u.t >= 1.65 && u.step < 99) {
        u.step = 99
        // final detonation
        this.audio.play('explosion', { volume: 1 })
        this.fx.screenFlash('#ffffff', 0.55, 2)
        this.fx.shockwave(this.player.x, 0, 900, sword.colors.glow, 0.8, 14)
        this.cam.addTrauma(0.9)
        this.addHitstop(0.14, 0.14)
        for (const e of this.enemies) {
          if (e.dead || e.spawning) continue
          this.hitEnemy(e.id, { bx: e.x - 20, by: e.y - 30, tx: e.x + 20, ty: e.y - 30 }, {
            id: 'ult', dmg: 30 * sword.stats.dmg, heavy: true, stagger: 0.6, kb: 300, kbY: 0,
            launch: -380, juggle: -400, hitstop: 0.03, shake: 0.2, aoe: 0, breakGuard: true, kind: 'ability',
          })
        }
        this.banner = { title: sword.ult.name, sub: 'OVERDRIVE COMPLETE', t: 0, dur: 1.8, color: sword.colors.accent }
      }
      if (u.t >= 2.1) {
        this.player.exitScripted()
        this.ult = null
        this.timeScale = 1
        this.slowmoT = 0
      }
    }
  }

  private execSlash(x:number,y:number,color:string,ang:number,material:ExecutionProfile['material'],rapid=false,final=false):void {
    const mundane=this.player.sword.mundane
    // Rapid links are narrow photographed-steel persistence; only the entry
    // and final receive broad readable silhouettes and meaningful hitstop.
    const spread=rapid?.72:final?1.35:1.05
    const radius=rapid?58:final?104:76
    this.fx.slashArc(x,y,ang,spread,radius,color,mundane?'#343938':'#ffffff',mundane?(rapid?.24:.42):rapid?.72:1.25)
    this.fx.impact(x,y,ang,final&&!mundane,color,mundane?'#aeb4b0':'#ffffff')
    if(material==='dust')this.fx.dust(x,y+35,5)
    else if(material==='embers')this.fx.burst(x,y,7,color,170,.32,'ember')
    else if(material==='spark')this.fx.burst(x,y,5,color,190,.22,'spark')
    else if(material==='shard')this.fx.burst(x,y,7,color,180,.3,'shard')
    else if(material==='echo')this.fx.afterimage(this.player.pose,this.player.x-this.player.face*12,this.player.hipY,this.player.face,color,.18,1.32)
    else this.fx.burst(x,y,3,'#aeb3af',100,.18,'spark')
    this.audio.play(rapid?'swing':'swingHeavy',{pitch:(rapid?1.35:1.05)+Math.abs(ang)*.12,volume:rapid?.56:.82})
    if(!rapid)this.cam.addTrauma(final?(mundane?.22:.42):(mundane?.1:.2))
    this.addHitstop(rapid?.008:final?.075:mundane?.03:.045)
  }

  private startUlt(): void {
    if(!this.player.swordDrawn){this.player.startUnarmedFinisher(this.worldRef,true);return}

    this.player.meter = 0
    this.ult = { t: 0, step: 0 }
    this.player.enterScripted()
    this.addSlowmo(0.35, 2)
    this.audio.play('energyFull', { volume: 1 })
    this.audio.play('execute', { volume: 0.8, pitch: 0.9 })
    this.fx.screenFlash(this.player.sword.colors.trail, 0.35, 2)
    this.cam.zoomPulse(0.25)
    this.banner = { title: this.player.sword.ult.name, sub: 'BLADE MODE ENGAGED', t: 0, dur: 1.6, color: this.player.sword.colors.accent }
  }

  /* ------------------------------------------------------------------ */
  /* HUD state assembly                                                   */
  /* ------------------------------------------------------------------ */

  private buildHudState(): HudState {
    const p = this.player
    const boss = this.enemies.find((e) => e.kind === 'boss' && !e.dead)
    let execPrompt: { x: number; y: number } | null = null
    if (this.phase === 'playing' && !this.exec && !this.ult) {
      const target = this.findExecuteTarget()
      if (target) {
        const zoom = this.cam.zoom
        execPrompt = {
          x: (target.x - this.cam.x - this.cam.offX) * zoom + this.cssW / 2,
          y: (target.y - 120 - this.cam.y - this.cam.offY) * zoom + this.cssH / 2,
        }
      }
    }
    return {
      hp: p.hp,
      maxHp: p.maxHp,
      energy: p.energy,
      maxEnergy: p.maxEnergy,
      stamina: p.stamina,
      maxStamina: p.maxStamina,
      dashCharge: p.dashChargeProgress,
      slashCharge: p.slashChargeProgress,
      swordDrawn: p.swordDrawn,
      fistStrike: p.fistStrikeNext,
      staminaCooldown: p.staminaCooldown,
      meter: p.meter,
      swordName: p.swordDrawn?p.sword.name+' / DRAWN':'EMPTY HAND / SHEATHED',
      swordColor: p.sword.colors.accent,
      abilityName: p.swordDrawn?p.sword.ability.name:'FOCUSED PALM',
      abilityCost: p.sword.ability.cost,
      combo: {
        hits: this.combo.hits,
        mult: this.combo.mult,
        rank: this.combo.lastRank,
        timer: this.combo.timer,
        timerMax: this.combo.timerMax,
        rankUpT: this.combo.rankUpT,
        lastHitT: 0,
      },
      wave: Math.max(1, this.waves.wave),
      enemiesLeft: this.enemies.filter((e) => !e.dead).length + this.waves.enemiesRemaining,
      kills: this.stats.kills,
      score: this.stats.score,
      boss: boss ? { hp: boss.hp, maxHp: boss.maxHp, name: 'GEMINI MK-II' } : null,
      banner: this.banner,
      executePrompt: execPrompt,
      ultReady: p.meter >= 100,
      abilityReady: p.energy >= p.sword.ability.cost,
      fps: this.fps,
      showFps: this.settings.showFps,
      runTime: this.runTime,
      attract: this.phase === 'attract',
    }
  }

  get isRunning(): boolean {
    return this.phase === 'playing'
  }

  /** debug/testing helper */
  debugSpawn(kind: EnemyKind, x: number): void {
    this.enemies.push(new Enemy(kind, x, 1))
  }
}
