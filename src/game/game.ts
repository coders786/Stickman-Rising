/** STICKMAN RISING — the Game orchestrator: loop, timing (hitstop/slow-mo),
 * combat resolution, combo & score, executions, ultimates, waves, events.
 */

import { Camera } from './core/camera'
import { Input } from './core/input'
import { DEFAULT_SETTINGS, GameEvent, GamePhase, GameSettings, RunStats, WorldRef } from './core/types'
import { clamp, clamp01, damp, fmt, rand } from './core/utils'
import { AudioEngine } from './audio/audio'
import { FX } from './fx/fx'
import { CyberBackground } from './world/background'
import { WaveDirector } from './world/waves'
import { Enemy, EnemyKind, PLAYER_X_REF } from './entities/enemy'
import { Player } from './entities/player'
import { PLAYER_POS, ProjectilePool } from './entities/projectiles'
import { ATTACKS, AttackRuntimeInfo } from './combat/attacks'
import { SWORDS, SwordId, SWORD_ORDER } from './combat/swords'
import { HUD, HudState, rankForHits } from './render/hud'
import { Renderer, RenderWorld } from './render/renderer'
import { Inspect, runQA, InspectMode } from './debug/inspect'

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
  private lastFrame = 0
  private cssW = 1280
  private cssH = 720
  private dpr = 1

  phase: GamePhase = 'attract'
  settings: GameSettings = { ...DEFAULT_SETTINGS }
  unlocked: SwordId[] = ['katana']

  input = new Input()
  audio = new AudioEngine()
  cam = new Camera()
  fx = new FX()
  bg = new CyberBackground('high')
  /* ambient storm audio: a soft distant crackle each time the sky strikes */
  private thunderCb = (): void => {
    this.audio.play('lightning', { volume: 0.22 })
  }
  hud = new HUD()
  private renderer = new Renderer()
  player = new Player()
  /** animation inspection lab (skeleton viz / contact sheets / QA) */
  inspect: Inspect
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
  private dprTarget = 1.25
  private fpsAvg = 60
  private govT = 0
  private govCool = 0
  private autoQuality = true

  stats: RunStats = { score: 0, kills: 0, maxCombo: 0, wave: 0, timeAlive: 0, bestRank: '' }
  private runTime = 0
  private fps = 60

  private listeners: ((e: GameEvent) => void)[] = []
  private destroyed = false
  private visibilityBound: (() => void) | null = null

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
    this.ctx = canvas.getContext('2d', { alpha: false })
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
    // ANIMATION INSPECTION LAB (spec §12): skeleton viz, contact sheets,
    // state readout + scripted QA harness
    this.inspect = new Inspect()
    const srAny = window as unknown as Record<string, unknown>
    srAny.__srInspect = {
      setView: (m: InspectMode) => this.inspect.setMode(m),
      toggleBones: () => this.inspect.toggleBones(),
      get mode() { return this.inspect.mode },
    }
    srAny.__srQA = { run: () => runQA(this) }
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.input.detach()
    if (this.visibilityBound) document.removeEventListener('visibilitychange', this.visibilityBound)
    this.audio.stopMusic()
  }

  resize(): void {
    if (!this.canvas) return
    const parent = this.canvas.parentElement
    const w = parent?.clientWidth ?? window.innerWidth
    const h = parent?.clientHeight ?? window.innerHeight
    this.cssW = Math.max(320, w)
    this.cssH = Math.max(240, h)
    const cap = this.settings.quality === 'high' ? 1.5 : this.settings.quality === 'medium' ? 1.25 : 1
    this.dpr = Math.min(this.dprTarget, cap)
    this.canvas.width = Math.floor(this.cssW * this.dpr)
    this.canvas.height = Math.floor(this.cssH * this.dpr)
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
    const cap = this.settings.quality === 'high' ? 1.5 : this.settings.quality === 'medium' ? 1.25 : 1
    if (this.fpsAvg < 44 && this.dprTarget > 1) {
      this.dprTarget = Math.max(1, this.dprTarget - 0.25)
      this.govCool = 1.6
      this.resize()
    } else if (this.fpsAvg < 36 && this.dprTarget <= 1) {
      // resolution floor reached and still drowning → drop a quality tier
      const order: GameSettings['quality'][] = ['high', 'medium', 'low']
      const i = order.indexOf(this.settings.quality)
      if (i < order.length - 1) {
        this.applySettings({ ...this.settings, quality: order[i + 1] })
        this.govCool = 4
      }
    } else if (this.fpsAvg > 57 && this.dprTarget < cap) {
      this.dprTarget = Math.min(cap, this.dprTarget + 0.25)
      this.govCool = 3
      this.resize()
    }
  }

  applySettings(s: GameSettings): void {
    const qualityChanged = s.quality !== this.settings.quality
    this.settings = { ...s }
    this.fx.setQuality(s.quality)
    this.fx.setGore(s.gore)
    this.cam.setShakeEnabled(s.shake, s.shakeIntensity)
    this.audio.setSfxVolume(s.sfxVolume)
    this.audio.setMusicVolume(s.musicVolume)
    this.audio.setMuted(s.muted)
    if (qualityChanged) {
      this.bg = new CyberBackground(s.quality)
      this.bg.onThunder = this.thunderCb
      this.bg.resize(this.cssW, this.cssH)
      this.resize()
    }
  }

  setUnlocked(list: SwordId[]): void {
    this.unlocked = list
  }

  /* ------------------------------------------------------------------ */
  /* run control                                                          */
  /* ------------------------------------------------------------------ */

  startRun(swordId: SwordId): void {
    this.audio.resume()
    this.audio.startMusic()
    this.audio.setMusicIntensity(0.55)
    this.player.setSword(swordId)
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
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.loop)
    let dtRaw = (now - this.lastFrame) / 1000
    this.lastFrame = now
    if (dtRaw > 0.05) dtRaw = 0.05
    if (dtRaw <= 0) dtRaw = 0.0001
    this.fps = damp(this.fps, 1 / dtRaw, 3, dtRaw)
    this.fpsAvg = damp(this.fpsAvg, 1 / dtRaw, 1.2, dtRaw)
    this.govern(dtRaw)

    const ctx = this.ctx
    if (!ctx) return

    if (this.phase === 'paused') {
      // frozen frame, HUD still drawn
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

      // --- capped substeps for stable physics (NO death spiral: cost of a
      // frame is bounded no matter how slow the machine runs) ---
      let remaining = simDt
      let substeps = 0
      while (remaining > 1e-6 && substeps < 3) {
        const stepDt = Math.min(remaining, 1 / 60)
        this.step(stepDt)
        remaining -= stepDt
        substeps++
      }
      if (remaining > 1e-6) {
        // very slow frame: consume the backlog as one clamped catch-up tick
        // so the world keeps roughly real-time without multiplying cost
        this.step(Math.min(remaining, 0.05))
      }
      // --- visual systems tick ONCE per frame (never per substep) ---
      this.fx.update(simDt)
      this.bg.update(simDt)
      this.updateCamera(simDt)
    }

    // --- render ---
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
      time: this.time,
    }
    this.renderer.draw(ctx, world, this.cssW, this.cssH, dtRaw)
    // inspection overlay (solo/sheet views + state readout)
    this.inspect.draw(ctx, this, this.time)

    this.input.endFrame(dtRaw)
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
    const swordIds: SwordId[] = ['katana', 'inferno', 'thunder', 'void', 'gravity', 'phantom']
    const swordActions = ['sword1', 'sword2', 'sword3', 'sword4', 'sword5', 'sword6'] as const
    for (let i = 0; i < 6; i++) {
      if (this.input.pressed(swordActions[i])) {
        this.trySwitchSword(swordIds[i])
      }
    }
    if (this.input.pressed('cycleSword')) {
      const idx = SWORD_ORDER.indexOf(this.player.sword.id)
      for (let i = 1; i <= 6; i++) {
        const next = SWORD_ORDER[(idx + i) % 6]
        if (this.unlocked.includes(next)) {
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
    if (!this.unlocked.includes(id)) return
    if (this.player.sword.id === id) return
    if (this.player.state === 'dead' || this.player.state === 'scripted') return
    const colors = SWORDS[id].colors
    this.player.setSword(id)
    this.audio.play('swordSwitch')
    this.fx.dissolve(this.player.x, this.player.y - 40, colors.core, colors.glow)
    this.fx.burst(this.player.x, this.player.y - 50, 12, colors.glow, 260, 0.5, 'spark')
    this.fx.text(this.player.x, this.player.y - 90, SWORDS[id].name, colors.accent, 13)
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

  private hitEnemy(enemyId: number, blade: { bx: number; by: number; tx: number; ty: number }, atk: AttackRuntimeInfo): void {
    const e = this.enemies.find((en) => en.id === enemyId)
    if (!e || e.dead) return
    const sword = this.player.sword
    const dir = Math.sign(blade.tx - blade.bx) || this.player.face
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
      return
    }

    const res = e.takeHit(atk, dir, this.player.x)

    // combo & score
    this.combo.onHit()
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo.hits)
    if (this.combo.rankUpT > 0.6) {
      this.audio.play('rankup', { pitch: 1 + this.combo.hits * 0.002 })
      this.emit({ type: 'rank', rank: this.combo.lastRank })
    }
    this.stats.score += Math.round(atk.dmg * this.combo.mult * 0.8)

    switch (res) {
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
        const dmgShown = Math.round(atk.dmg * (e.vulnerableT > 0 ? 2 : 1) * (e.kind === 'heavy' || e.kind === 'boss' ? 0.72 : 1))
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
      this.player.onParrySuccess(this.worldRef, sourceX, true)
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
    this.exec = { enemy: target, t: 0, step: 0 }
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
      const midX = (this.player.x + e.x) / 2
      const midY = (this.player.y + e.y) / 2 - 40
      if (ex.step === 0 && ex.t >= 0.16) {
        ex.step = 1
        this.execSlash(midX, midY, sword.colors.trail, 0)
        this.player.playClip(ATTACKS.l1.clip, 1.7)
      } else if (ex.step === 1 && ex.t >= 0.38) {
        ex.step = 2
        this.execSlash(midX, midY, sword.colors.trail, 1)
        this.player.playClip(ATTACKS.l2.clip, 1.7)
      } else if (ex.step === 2 && ex.t >= 0.6) {
        ex.step = 3
        this.execSlash(midX, midY, sword.colors.accent, 2)
        this.player.playClip(ATTACKS.l5.clip, 1.4)
      } else if (ex.step === 3 && ex.t >= 0.82) {
        ex.step = 4
        // final blow
        this.audio.play('explosion', { volume: 0.8 })
        this.audio.play('deathHeavy', { volume: 1 })
        this.fx.impactFrame(e.x, e.y - 40, sword.colors.accent) // the kill frame
        this.fx.screenFlash('#ffffff', 0.4, 3)
        this.fx.dismember(e.x, e.y, this.player.face, e.cfg.style.body, this.settings.gore === 'blood' ? '#c31432' : sword.colors.glow)
        this.fx.shockwave(e.x, e.y - 30, 140, sword.colors.glow, 0.5, 8)
        this.cam.addTrauma(0.6)
        this.addHitstop(0.12, 0.12)
        this.onEnemyKilled(e)
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 22)
        this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 40)
        this.player.meter = Math.min(100, this.player.meter + 18)
        this.stats.score += Math.round(300 * this.combo.mult)
        this.fx.text(e.x, e.y - 96, 'EXECUTED', '#ff2a4a', 16)
        this.fx.text(e.x, e.y - 72, '+22 HP', '#46ffb4', 12)
      } else if (ex.step === 4 && ex.t >= 1.15) {
        this.player.exitScripted()
        this.exec = null
        this.timeScale = 1
        this.slowmoT = 0
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
            case 'thunder':
              this.fx.lightningArc(ex + rand(-80, 80), ey - 120, ex, ey, sword.colors.trail)
              break
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

  private execSlash(x: number, y: number, color: string, index: number): void {
    const ang = -0.6 + index * 0.7
    this.fx.slashArc(x, y, ang, 2.8, 110, color, '#ffffff', 1.6)
    this.fx.impact(x, y, ang, true, color, '#ffffff')
    this.audio.play('swingHeavy', { pitch: 1.2 + index * 0.15, volume: 0.9 })
    this.cam.addTrauma(0.25)
    this.addHitstop(0.05)
  }

  private startUlt(): void {
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
      meter: p.meter,
      swordName: p.sword.name,
      swordColor: p.sword.colors.accent,
      abilityName: p.sword.ability.name,
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
