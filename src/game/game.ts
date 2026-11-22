import { graphicsTrace, traceStart, traceEnd } from '../debug/graphics-trace'
import { markBoot } from '../lib/boot-timing'
import { bridgeCityPlatesSettled, bridgeOpeningPlatesSettled, bridgePlate, discardPendingBridgePlates } from './stage/bridge-webp'
import { visiblePlateIndices } from './stage/bridge-plate-paint'
import { bridgeSkyBasisSettled, discardPendingBridgeSky } from '../graphics/bridge/SkyBasis'
import { ART_GRADES, BRIDGE_ART, type SceneArtOptions } from './world/art-grade'
import { FLAT_LANE } from './stage/flat-lane'
import {resolveEnemyHit,missedHit,parriedHit,rewardsConfirmedHit,type HitResolution} from './combat/hit-resolution'
/** STICKMAN RISING — the Game orchestrator: loop, timing (hitstop/slow-mo),
 * combat resolution, combo & score, executions, ultimates, waves, events.
 */

import { Camera, PLAY_ZOOM } from './core/camera'
import { Input } from './core/input'
import { advanceSimClock, MAX_FRAME_DT } from './core/sim-clock'
import { DEFAULT_SETTINGS, GameEvent, GamePhase, GameSettings, RunStats, WorldRef, type RunPreparationStage } from './core/types'
import { clamp, clamp01, fmt, rand } from './core/utils'
import { AudioEngine } from './audio/audio'
import { FX } from './fx/fx'
import { CyberBackground, type BackgroundRenderer } from './world/background'
import { PropField, type PropHooks } from './world/props'
import { MOOD_PALETTES, moodIndexForSeed } from './world/mood'
import { cycleParticleLevel, getParticleLevel } from './fx/particles1d'
import {StormEngine} from './world/storm'
import { WaveDirector } from './world/waves'
import { EncounterDirector, isThreat, type EncounterSpawn } from './world/encounters'
import { BridgeRoute, ROUTE_START, SECTOR_LENGTH, biomeAt, sectorAt, travelledMetres, WORLD_UNITS_PER_METRE } from './stage/route'
import { SERVICE_HP, SERVICE_SHIELD, SERVICE_HOLD, ServiceTerminal } from './world/service'
import { RunPickups } from './world/run-pickups'
import { separateCrowd, type CrowdActor } from './combat/crowd-spacing'
import { FlowTracker } from './combat/style'
import { Enemy, EnemyKind, PLAYER_X_REF } from './entities/enemy'
import { Player } from './entities/player'
import { PLAYER_BODY, PLAYER_POS, ProjectilePool } from './entities/projectiles'
import { ATTACKS, AttackRuntimeInfo } from './combat/attacks'
import { SWORDS, SwordId, SWORD_ORDER, swordTier, upgradedSword } from './combat/swords'
import { crossedExecutionCuts, executionRoot, executionTimeline } from './combat/execution'
import { MOVES } from './combat/moveset'
import { EXECUTE_POSE_CLIP } from './anim/clips'
import { installQA } from './debug/animQA'
import { HUD, HudState } from './render/hud'
import { Renderer, RenderWorld } from './render/renderer'
import { RenderScaleControl } from './render/render-scale'
import { BridgePresentation } from './render/bridge-presentation'
import type { BridgeAdmission } from './render/bridge-finish'
import { OPENING_MAX_GAP_MS, OpeningPace } from './render/opening-pace'
import { advancePaint, OPENING_PAINT_SLICE_MS } from './render/paint-slices'
import { worldBounds, type ViewBounds } from './world/exposed-weather'
import { LIGHT_HEX } from './world/lightfield'
import { FAR_DIVISOR, HordeGrid, planTicks, type TickPlan } from './combat/horde'
import { FrameLog } from './render/frameLog'
import { gameLedger } from './render/ledger'
import { disposeVolumeBrushes } from './lighting/volume'
import type { EnvironmentProfile } from './world/profile'
import type { NightLayer } from './world/night'
import { Inspect, InspectMode } from './debug/inspect'

const { left: ARENA_MIN, right: ARENA_MAX, entryX: ENTRY_X } = FLAT_LANE
// Bound an unsatisfied opening without waiving dependencies or lowering
// the grade just because a transfer/driver is slow. No minimum.
const OPENING_TOTAL_BUDGET_MS = 25_000
const OPENING_GL_FALLBACK_MS = 12_000

/* ------------------------------------------------------------------ */

interface Banner {
  title: string
  sub: string
  t: number
  dur: number
  color: string
}

interface RunRequest {
  readonly sword: SwordId
  readonly seed: number
  readonly returnTo: 'attract' | 'gameover'
  needsPaint: boolean
  initialized?: boolean
  stage: RunPreparationStage
  activeMs: number
  frameAt?: number
  presented: boolean
  pace: OpeningPace
  backdropMarked?: boolean
  rendererMarked?: boolean
  warmed?: boolean
  cut?: { id: number; done: boolean }
  opening?: { width: number; height: number; lit?: boolean; visible: number[] }
  preparation?: {
    abort: AbortController
    night: NightLayer | null
    startedAt: number
    ready: boolean
  }
}

interface PaintDraft {
  ctx: CanvasRenderingContext2D
  world: RenderWorld
  steps?: Generator<void>
}

interface WorldSubmit {
  id: number
  layer: string
  hud: 'layer' | 'world' | 'off'
  kind: 'title' | 'starter' | 'canvas' | 'webgl' | 'emergency'
  seed: number | undefined
  time: number
  hp: number
  threats: number
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
  touchControls = false
  private hudCtx: CanvasRenderingContext2D | null = null
  private mountCanvas: HTMLCanvasElement | null = null
  private get canvas(): HTMLCanvasElement | null { return this.ctx?.canvas ?? this.mountCanvas }
  private ctx: CanvasRenderingContext2D | null = null
  private coverage: BridgePresentation | null = null
  private worldSubmit: WorldSubmit | null = null
  private presentationHeld = false
  private presentationFaults = 0
  private viewport: HTMLElement | null = null
  private raf = 0
  // --- render interpolation ("fix your timestep"): the sim advances in
  // fixed 1/60 steps (the tested configuration) into an accumulator; the
  // render samples motion BETWEEN the last two sim states so every display
  // frame advances smoothly at any refresh rate. Physics and sprite frames
  // are untouched — only the drawn position/time are sampled continuously.
  private simAccum = 0
  /** seconds of gameplay time explicitly dropped under overload (M03
   *  telemetry — requested vs simulated time is never silently mixed) */
  overloadDropped = 0
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
  /** HORDE SCHEDULER (combat/horde.ts): a fixed-step counter and one reused
   *  plan. Far enemies tick 1-in-FAR_DIVISOR with dt×FAR_DIVISOR, so their
   *  average behaviour is unchanged and the horde's CPU is not linear in its
   *  off-screen population. */
  private hordeTick = 0
  private hordePlan: TickPlan = { near: [], far: [], saved: 0 }
  private hordeGrid = new HordeGrid(220)
  private hordeQuery: number[] = []
  private loadout: SwordId[] = ['katana']

  input = new Input()
  audio = new AudioEngine()
  cam = new Camera()
  fx = new FX()
  readonly storm = new StormEngine(DEFAULT_SETTINGS.quality)
  bg: BackgroundRenderer
  /** THE HIT LIGHT — one closure, wired once. `fx.impact()` asks this at the
   *  strike point, so a blade that lands inside the stairwell's spill blooms
   *  warm and one that lands under the failing tube blooms cool. Without it a
   *  hit flash is a white circle that could be happening anywhere. */
  private hitLight = (x: number, y: number): { color: string; k: number } | null => {
    const s = this.bg.lightAt?.(x, y)
    if (!s || !s.best) return null
    const k = Math.min(1, Math.max(s.warm, s.cool, s.neon))
    if (k <= 0.12) return null
    // HEX, not 'r,g,b': `rgba()` in core/utils parses '#rrggbb' and silently
    // produces a garbage colour from a triple (that bug is why the first version
    // of this bloom came out blue in a warm doorway).
    return { color: LIGHT_HEX[s.best.kind], k }
  }
  /** Explicit art overrides are for the isolated lighting/replay fixtures. */
  private readonly sceneArt: SceneArtOptions
  private environmentAccum = 0
  private reducedMotion = false
  private clearMotionPreference?: () => void
  /* ambient storm audio: a soft distant crackle each time the sky strikes */
  private wireHitLight(): void {
    this.fx.setLightSampler(this.hitLight)
  }

  private thunderCb = (): void => {
    this.audio.play('lightning', { volume: 0.22 })
  }
  hud = new HUD()
  private renderer = new Renderer()
  private desktopPacing = false
  private readonly scaleControl = new RenderScaleControl(DEFAULT_SETTINGS.quality, DEFAULT_SETTINGS.adaptiveQuality)
  private diagnosticScale: number | null = null
  private insets = { top: 0, right: 0, bottom: 0, left: 0 }
  /** Rolling frame statistics for the debug overlay and the bug-bounty report.
   *  Ring-buffered: sampling allocates nothing. */
  readonly frameLog = new FrameLog()
  player = new Player()
  /** animation inspection lab (skeleton viz / contact sheets / QA) */
  inspect!: Inspect
  /** QA harness mode: suppresses wave spawning + death→gameover so
   * scripted sequences run in a controlled empty arena */
  qaMode = false
  enemies: Enemy[] = []
  projectiles = new ProjectilePool()
  /** procedurally placed destructible props — a fresh lane every run */
  readonly props: PropField
  waves: WaveDirector
  combo = new FlowTracker()
  route: BridgeRoute | null = null
  encounters: EncounterDirector | null = null
  service = new ServiceTerminal()
  private pickups: RunPickups | null = null
  private readonly crowd: CrowdActor[] = []
  private actions = { overdrive: false, service: false, execute: false }
  private readonly continuous: boolean

  time = 0
  timeScale = 1
  private slowmoT = 0
  private slowmoScale = 1
  private hitstopT = 0
  private streamQuiet = true

  private exec: ExecState | null = null
  private ult: UltState | null = null
  private banner: Banner | null = null

  /* ---- PERFORMANCE GOVERNOR (the "hangs when enemies appear" fix) ----
   * Frame cost must NOT grow when the frame rate falls. Three defenses:
   *   1. frame delta is clamped to 50ms and substeps are capped (2 × 1/60,
   *      see core/sim-clock.ts) — a slow frame simulates at most ~33ms in
   *      FIXED steps; excess backlog is counted and dropped explicitly.
   *   2. visual systems (weather, particles, camera) tick ONCE per frame,
   *      not per substep — rain never integrates at 450Hz
   *   3. render resolution (DPR) auto-scales to the measured frame rate */
  private jsMs = 0
  private frameMs = 16.7
  private waitMs = 0
  private lastGapAt = 0
  /** Wall clock (rAF seconds), used only for presentation sampling. */
  private wall = 0
  /** Last run's seed — re-applied if the scene is rebuilt mid-run. */
  private lastRunSeed = 0
  /** Wall-clock cost of the run's plate bake (0 = not measured yet). */
  bakeMs = 0
  /** Cached frame percentiles for the readout (see the draw path comment). */
  private sampledFps = 60
  private snapAt = -1
  private autoQuality = true // deterministic QA can suspend the governor without changing DPR policy

  stats: RunStats = { score: 0, kills: 0, maxCombo: 0, wave: 0, timeAlive: 0, bestRank: '' }
  private runTime = 0
  private fps = 60
  private pendingRun: RunRequest | null = null
  private paintDraft?: PaintDraft
  private readonly dirtyWork = new WeakSet<CanvasRenderingContext2D>()
  private openingCut = false
  private cutId = 0
  private attractNeedsPaint = true
  private attractAssets = -1
  private awaitingFirstStep = false
  private readonly openingView: ViewBounds = { left: 0, right: 0, top: 0, bottom: 0 }

  private listeners: ((e: GameEvent) => void)[] = []
  private destroyed = false
  private visibilityBound: (() => void) | null = null
  // Keep the opaque scene in place while the separate HUD can still pulse.
  private retainPausedScene = true // QA can compare against full paused repaint
  private pausedSceneDirty = true
  private readonly invalidatePresentation = (): void => {
    this.pausedSceneDirty = this.attractNeedsPaint = true
    this.restartOpeningDraw()
    if (this.phase === 'playing' || this.phase === 'paused') {
      if (!this.bridgeFrameLive()) this.holdPresentation(true)
    }
  }
  private readonly contextLost = (event: Event): void => {
    // Do not preventDefault on a 2D loss: by default it can restore itself.
    this.coverage?.invalidate(event.target)
    if (event.target === this.hudCtx?.canvas) this.hud.invalidateLayer()
    this.invalidatePresentation()
  }
  private readonly contextRestored = (event: Event): void => {
    if (event.target === this.hudCtx?.canvas) this.hud.invalidateLayer()
    this.resize()
  }
  /** F9 inspect-view cycle listener (pose editor / diagnostics) */
  private f9ViewBound: ((e: KeyboardEvent) => void) | null = null

  constructor(diagnosticArt?: SceneArtOptions, diagnosticMode?: 'combined-run') {
    this.continuous = !diagnosticArt
    this.sceneArt = diagnosticArt ?? BRIDGE_ART
    this.props = new PropField(!this.sceneArt.finish, this.continuous)
    this.bg = new CyberBackground(DEFAULT_SETTINGS.quality, this.storm, this.sceneArt,
      this.continuous ? 'continuous-run' : diagnosticMode)
    this.renderer.setQuality(this.settings.quality)
    this.fx.setQuality(this.settings.quality)
    // The default background exists before any settings are applied; wire the
    // hit light to it here as well, so the very first swing in the very first
    // frame already knows what light it happens in.
    this.wireHitLight()
    this.waves = new WaveDirector({
      spawnEnemy: (kind, x, scale) => this.spawnEnemy(kind, x, scale),
      onWaveStart: (wave, boss) => this.onWaveStart(wave, boss),
      onWaveClear: (wave) => this.onWaveClear(wave),
      getPlayerX: () => this.player.x,
    })
    this.resetRoute(0x51a2c9)
    this.player.reset(this.entryX)
    this.cam.startOnRoad(this.entryX)
    this.props.reset(0x51a2c9)
    this.props.setMood(moodIndexForSeed(0x51a2c9))
    const grade = this.artLabel()
    if (grade) this.hud.setMoodLabel(grade)
  }

  private get entryX(): number { return this.continuous ? ROUTE_START : ENTRY_X }

  private resetRoute(seed: number): void {
    this.cam.setTravelFraming(this.continuous)
    if (!this.continuous) {
      this.cam.setArena(ARENA_MIN, ARENA_MAX)
      return
    }
    const route = this.route = new BridgeRoute(seed)
    this.bg.setRoute?.(route)
    this.renderer.retireBridgeRoute()
    this.encounters = new EncounterDirector(route)
    this.service = new ServiceTerminal()
    this.pickups = new RunPickups(route)
    this.cam.setArena(0, Infinity)
    this.worldRef.arenaMinX = 0
    this.worldRef.arenaMaxX = Infinity
    this.worldRef.platformAt = x => route.platformAt(x)
    this.worldRef.isSheltered = x => !!route.shelterAt(x)
    this.worldRef.wetFootfall = (x, y, strength, vx, landing) => { if (!this.reducedMotion) this.bg.routeFootfall?.(x, y, strength, vx, landing) }
    this.worldRef.bridgeWind = (x, t) => {
      const pulse = this.ult ? Math.max(0, 1 - this.ult.t * 5) * .9 * Math.sin(t * 28 + x * .08) : 0
      return (this.bg.routeWindAt?.(x) ?? 0) + pulse
    }
    this.worldRef.enemyTravel = (from, to) => route.stopAtCover(from, to, 12)
    this.worldRef.projectileBlocked = (from, to) => !!route.shelterAt(from) || !!route.shelterAt(to) || route.stopAtCover(from, to) !== to
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
    if (p !== this.phase) {
      // PHASE-BOUNDARY EDGE RESET (intentional, documented): edges or combo
      // buffers accepted in one phase must never leak into the next run
      // (e.g. a 'pause' press during game-over firing on the first step of
      // a new run). Hold states are untouched; this is a deliberate
      // gesture cancel at a state boundary, not a lost command.
      this.input.clearEdges()
    }
    if (p !== this.phase) this.scaleControl.interrupt()
    this.phase = p
    this.emit({ type: 'phase', phase: p })
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                            */
  /* ------------------------------------------------------------------ */

  mount(canvas: HTMLCanvasElement, hudLayer?: HTMLCanvasElement | null, finishLayer?: HTMLCanvasElement | null,
    workLayer?: HTMLCanvasElement | null): void {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    this.applyMotionPreference(preference?.matches ?? false)
    if (preference) {
      const change = () => this.applyMotionPreference(preference.matches)
      preference.addEventListener?.('change', change)
      this.clearMotionPreference = () => preference.removeEventListener?.('change', change)
    }
    this.desktopPacing = window.matchMedia?.('(pointer: fine)').matches === true
    this.renderer.setDesktopLighting(this.desktopPacing)
    this.mountCanvas = canvas
    if (this.continuous) bridgePlate('props-v2')
    // Normal compositor synchronization, not a front-buffer canvas that
    // might expose an in-progress clear. GL samples the hidden work surface.
    this.ctx = canvas.getContext('2d')
    if (!this.ctx) throw new Error('Your browser could not initialize the game canvas.')
    this.viewport = canvas.parentElement
    if (this.continuous && workLayer) {
      const work = workLayer.getContext('2d')
      if (!work) throw new Error('Your browser could not initialize the arena work surface.')
      this.coverage = new BridgePresentation(this.ctx, work)
    }
    this.hudCtx = hudLayer?.getContext('2d') ?? null
    if (finishLayer && this.coverage) this.renderer.attachWorldOutput(finishLayer, this.invalidatePresentation)
    for (const layer of this.coverage?.contexts().map(c => c.canvas) ?? [canvas]) {
      layer.addEventListener('contextlost', this.contextLost)
      layer.addEventListener('contextrestored', this.contextRestored)
    }
    this.hudCtx?.canvas.addEventListener('contextlost', this.contextLost)
    this.hudCtx?.canvas.addEventListener('contextrestored', this.contextRestored)
    this.input.attach()
    this.resize()
    this.visibilityBound = () => {
      this.lastGapAt = 0 // never sample across a visibility transition
      this.scaleControl.interrupt()
      this.lastFrame = performance.now()
      if (this.pendingRun) { this.pendingRun.frameAt = undefined; this.pendingRun.pace.reset() }
      if (!document.hidden) return
      this.frameLog.markGap()
      if (this.phase === 'playing') this.pause()
      if (this.pendingRun) this.pendingRun.needsPaint = true
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
    this.graphicsObserver = undefined
    if (this.destroyed) return
    this.destroyed = true
    this.discardRunPreparation()
    cancelAnimationFrame(this.raf)
    this.input.detach()
    for (const c of this.coverage?.contexts() ?? [this.ctx]) {
      if (!c) continue
      c.canvas.removeEventListener('contextlost', this.contextLost)
      c.canvas.removeEventListener('contextrestored', this.contextRestored)
      disposeVolumeBrushes(c)
    }
    this.holdPresentation(false)
    this.hudCtx?.canvas.removeEventListener('contextlost', this.contextLost)
    this.hudCtx?.canvas.removeEventListener('contextrestored', this.contextRestored)
    if (this.coverage) {
      this.coverage.dispose()
      if (this.hudCtx) this.hudCtx.canvas.width = this.hudCtx.canvas.height = 0
      this.worldSubmit = null
    }
    if (this.visibilityBound) document.removeEventListener('visibilitychange', this.visibilityBound)
    this.clearMotionPreference?.()
    this.audio.destroy()
    this.bg.dispose?.()
    this.props.dispose()
    this.hud.dispose()
    this.renderer.dispose()
    this.fx.dispose()
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
    this.pausedSceneDirty = true
    this.attractAssets = -1
    const parent = this.canvas.parentElement
    const w = parent?.clientWidth ?? window.innerWidth
    const h = parent?.clientHeight ?? window.innerHeight
    const changed = this.cssW !== w || this.cssH !== h
    this.cssW = Math.max(1, w)
    this.cssH = Math.max(1, h)
    this.restartOpeningDraw()
    if (parent) {
      const style = getComputedStyle(parent)
      for (const edge of ['top', 'right', 'bottom', 'left'] as const)
        this.insets[edge] = parseFloat(style.getPropertyValue(`--sr-inset-${edge}`)) || 0
    }
    this.dpr = this.diagnosticScale ?? this.scaleControl.value
    const bw = Math.max(1, Math.floor(this.cssW * this.dpr))
    const bh = Math.max(1, Math.floor(this.cssH * this.dpr))
    // Keep the last complete backing scaled by CSS until the other canvas
    // can be painted at the new size. BridgeFinish sizes only that target.
    if (!this.coverage) {
      if (this.canvas.width !== bw) this.canvas.width = bw
      if (this.canvas.height !== bh) this.canvas.height = bh
    }
    this.cam.setViewport(this.cssW, this.cssH)
    if (changed && this.pendingRun?.initialized) this.cam.startOnRoad(this.player.x)
    this.bg.resize(this.cssW, this.cssH)
  }

  private graphicsObserver: ((sample: GraphicsFrameSample) => void) | undefined

  /** Subscribers get real foreground world+HUD submits, never idle rAFs or
   * the paused HUD-only path. Nothing is clocked or allocated when unused. */
  observeGraphicsFrames(observer: (sample: GraphicsFrameSample) => void): () => void {
    this.graphicsObserver = observer
    return () => { if (this.graphicsObserver === observer) this.graphicsObserver = undefined }
  }

  get renderConfig() {
    return { preset: this.settings.quality.toUpperCase(), adaptiveEnabled: this.settings.adaptiveQuality,
      renderScale: this.diagnosticScale ?? this.scaleControl.value, showFPS: this.settings.showFps }
  }

  /** Software GL is for reproducible shader QA, never the public default. */
  preferDiagnosticMobile(): void { this.renderer.setDiagnosticMobile() }
  graphicsPresentation() {
    return { ...this.renderer.bridgeReceipt(), frame: this.worldSubmit, held: this.presentationHeld,
      faults: this.presentationFaults, fallbackLayer: this.coverage?.fallbackLayer ?? null,
      fallbackReady: this.coverage?.fallbackReady ?? false, coverageBytes: this.coverage?.backingBytes ?? 0 }
  }

  private holdPresentation(hold: boolean): void {
    if (hold === this.presentationHeld) return
    this.presentationHeld = hold
    this.viewport?.toggleAttribute('data-bridge-recovering', hold)
    this.input.clearEdges()
    this.input.endRenderFrame()
  }

  private bridgeFrameLive(): boolean {
    if (!this.coverage) return true
    const f = this.worldSubmit
    if (!f || f.kind === 'title' || f.seed !== this.route?.seed || (f.hud === 'layer' && !this.hudUsable)) return false
    return f.kind === 'webgl' ? this.renderer.bridgeFrameLive : this.coverage.fallbackReady
  }
  private get hudUsable(): boolean {
    return !!this.hudCtx && !this.hudCtx.isContextLost?.()
  }
  allowDiagnosticMaster(): void { this.renderer.allowDiagnosticMaster() }

  /** Fixed backing for matched replay tooling; never set by a player preference. */
  setDiagnosticRenderScale(scale: number): void {
    if (!(scale > 0 && scale <= 2.25)) throw new RangeError('Invalid replay scale')
    this.diagnosticScale = scale
    this.resize()
  }

  private govern(dt: number): void {
    if (!this.autoQuality || this.phase !== 'playing' || this.diagnosticScale !== null ||
      this.inspect?.mode === 'edit' || document.hidden) return
    if (this.scaleControl.frame(dt * 1000)) {
      this.resize()
      this.emit({ type: 'quality', active: this.settings.quality, scale: this.dpr })
    }
  }

  applySettings(s: GameSettings): void {
    const quality = s.quality, qualityChanged = quality !== this.settings.quality
    const modeChanged = s.adaptiveQuality !== this.settings.adaptiveQuality
    const showFpsChanged = s.showFps !== this.settings.showFps
    if (qualityChanged || modeChanged) this.scaleControl.configure(quality, s.adaptiveQuality)
    this.settings = { ...s }
    if (showFpsChanged) this.snapAt = -Infinity
    this.pausedSceneDirty = true
    this.fx.setQuality?.(quality)
    this.applyMotionPreference(this.reducedMotion)
    this.fx.setGore(s.gore)
    this.renderer.setQuality(quality)
    this.audio.setSfxVolume(s.sfxVolume)
    this.audio.setMusicVolume(s.musicVolume)
    this.audio.setMuted(s.muted)
    // A tier only changes admission and the output canvas. It cannot reseed
    // the climate, change exposure, or warm a new stage kit.
    if (qualityChanged) {
      this.storm.setQuality(quality)
      this.bg.setQuality(quality)
    }
    if (qualityChanged || modeChanged) this.resize()
    if (qualityChanged || modeChanged) this.emit({ type: 'quality', active: quality, scale: this.renderConfig.renderScale })
  }

  private applyMotionPreference(reduced: boolean): void {
    this.reducedMotion = reduced
    const { shake, shakeIntensity } = this.settings
    this.fx.setScreenStrength(shake && !reduced ? shakeIntensity : 0)
    this.cam.setShakeEnabled(shake && !reduced, shakeIntensity)
    this.bg.setReducedMotion?.(reduced)
    this.restartOpeningDraw()
    this.pausedSceneDirty = true
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

  /** Tonights' sky, for the results screen: the run-identity line and the
   *  seed both come from the baked profile, so the card cannot disagree with
   *  what the player just looked at for two minutes. */
  runIdentity(): { label: string; id: string } {
    const prof = this.bg.getProfile?.()
    return { label: prof?.label ?? 'CLEAR NIGHT', id: prof?.id ?? '0000' }
  }

  private artLabel(): string | undefined {
    return this.sceneArt.grade ? ART_GRADES[this.sceneArt.grade].palette.name : undefined
  }

  private syncSceneMood(seed: number): void {
    // Novelty selection can resolve to a different profile than the initial
    // seed. Label and dress the scene the background actually baked.
    const mood = this.bg.getProfile?.()?.mood ?? MOOD_PALETTES[moodIndexForSeed(seed)]
    this.props.setMood(MOOD_PALETTES.indexOf(mood))
    this.hud.setMoodLabel(this.artLabel() ?? mood.name)
  }

  /** Accept a UI gesture without baking in the event handler. The single
   * frame loop owns the request; there is no timer that can start a stale run. */
  requestRun(sword: SwordId): boolean {
    if (this.destroyed || this.pendingRun || (this.phase !== 'attract' && this.phase !== 'gameover')) return false
    this.discardPaintDraft()
    this.audio.stopMusic() // Retry must not keep the Results loop going under the loader.
    this.audio.stopRainAmbience()
    this.audio.resume() // unlock on the actual gesture, not the deferred bake
    this.input.setEnabled(false)
    graphicsTrace?.event('run-request', this.phase === 'gameover' ? 'retry' : 'engage')
    this.pendingRun = { sword, seed: (Math.random() * 0xffffffff) >>> 0, returnTo: this.phase, stage: 'opening',
      needsPaint: true, activeMs: 0, presented: false, pace: new OpeningPace() }
    if (this.continuous) this.renderer.beginBridgeOpening()
    this.setPhase('preparing')
    if (this.continuous) {
      // Start the transfers on the same gesture that mounts the veil.
      bridgeOpeningPlatesSettled()
      bridgeSkyBasisSettled()
    }
    return true
  }

  /** Only the DOM game has a cut. Benchmarks and pose tools don't need an
   * animation or a second owner to complete a run request. */
  enableOpeningCut(): void { this.openingCut = true }

  finishOpeningCut(id: number): void {
    const cut = this.pendingRun?.cut
    if (cut?.id === id) cut.done = true
  }

  private discardPaintDraft(): void {
    const draft = this.paintDraft
    this.paintDraft = undefined
    if (!draft) return
    draft.steps?.return(undefined)
    // No partially drawn surface was visible. Reset its state before its
    // next use, not inside a Cancel/resize/input event.
    this.dirtyWork.add(draft.ctx)
    if (draft.world.opening) this.dirtyWork.add(draft.world.opening.actors)
  }

  private restartOpeningDraw(): void {
    this.discardPaintDraft()
    this.renderer.discardBridgeOpeningFrame()
    const request = this.pendingRun
    if (!request) return
    request.pace.reset()
    request.warmed = false
    if (!request.cut) return
    request.cut = undefined
    request.stage = 'frame'
    this.emit({ type: 'runPreparing', stage: request.stage, presented: request.presented })
  }

  private discardRunPreparation(): RunRequest | null {
    const request = this.pendingRun
    this.pendingRun = null
    this.discardPaintDraft()
    if (request && this.continuous) this.renderer.endBridgeOpening()
    request?.preparation?.abort.abort()
    if (!request?.initialized) request?.preparation?.night?.dispose()
    return request
  }

  cancelRunPreparation(): void {
    const request = this.discardRunPreparation()
    if (!request) return
    graphicsTrace?.event('run-cancelled', `stage=${request.stage}`)
    if (request.presented) {
      // A complete replacement world has already been composed under the
      // veil. Until that point Cancel retains the exact old Results backing.
      this.quitToMenu()
      return
    }
    if (request.initialized && this.continuous) {
      this.bg.bridgeStream?.()?.dispose()
      this.renderer.retireBridgeRoute()
    }
    this.lastFrame = performance.now()
    this.holdPresentation(false)
    // No submitted frame belongs to a cancelled attempt. Results keep the
    // previous run's backing, even if this request had allocated sim state.
    this.pausedSceneDirty = request.returnTo === 'attract'
    this.setPhase(request.returnTo)
  }

  private preparationStage(request: RunRequest, stage: RunPreparationStage): void {
    if (request.stage === stage) return
    request.stage = stage
    graphicsTrace?.state('opening-stage', stage)
    this.emit({ type: 'runPreparing', stage, presented: request.presented })
  }

  private prepareRunFrame(now: number): void {
    const request = this.pendingRun
    this.lastFrame = now
    if (!request) return
    if (document.hidden) { graphicsTrace?.state('opening-wait', 'document-hidden'); request.needsPaint = true; request.frameAt = undefined; request.pace.reset(); return }
    const started = performance.now()
    request.activeMs += Math.max(0, now - (request.frameAt ?? now))
    request.frameAt = now
    // Start Bridge I/O and seed the worker before the first overlay paint.
    // Give that paint a chance before touching the driver or drawing layers.
    const yieldDraw = request.needsPaint
    request.needsPaint = false
    if (yieldDraw && !this.continuous) return
    try {
      if (request.activeMs >= OPENING_TOTAL_BUDGET_MS) {
        graphicsTrace?.event('opening-timeout', `stage=${request.stage} activeMs=${Math.round(request.activeMs)}`)
        if (this.continuous) {
          discardPendingBridgePlates()
          discardPendingBridgeSky()
          this.renderer.resetBridgeOpening()
        }
        this.cancelRunPreparation()
        markBoot('run-failed')
        this.emit({ type: 'runUnavailable' })
        return
      }
      if (!request.preparation) {
        const startedAt = performance.now()
        // The legacy sky is a dependency only of finite diagnostic scenes.
        const night = this.continuous ? null : this.bg.createNightForSeed?.(request.seed) ?? null
        const prep = { abort: new AbortController(), night, startedAt, ready: !night }
        request.preparation = prep
        if (night) {
          void night.warmDeferred(prep.abort.signal).then(() => {
            if (this.pendingRun === request) prep.ready = true
          }, error => {
            if (this.pendingRun === request) this.failRunPreparation(error)
          })
          this.preparationStage(request, 'background')
          return
        }
      }
      if (!request.preparation.ready) return
      if (!request.initialized) {
        const initStart = traceStart()
        this.beginRun(request.sword, request)
        traceEnd('opening.beginRun', initStart)
        request.initialized = true
        markBoot('run-initialized')
      }
      // ResizeObserver can run after rAF. Don't commit/release a frame for
      // the old aperture if CSS already changed during preparation.
      const viewport = this.viewport
      if (viewport && (Math.max(1, viewport.clientWidth) !== this.cssW || Math.max(1, viewport.clientHeight) !== this.cssH)) {
        this.resize()
        return
      }
      if (request.cut) {
        graphicsTrace?.state('opening-wait', 'reveal-cut')
        // The compositor owns this brief transition. Keep the complete
        // scene and HUD resident; do not render, stream or advance combat.
        if (!this.bridgeFrameLive()) this.restartOpeningDraw()
        else if (!yieldDraw && request.cut.done) this.completePreparedRun()
        return
      }
      const plan = this.continuous ? this.planBridgeOpening(request) : undefined
      if (yieldDraw) return
      const opening = this.paintDraft ? this.paintDraft.world.opening : plan ? this.prepareBridgeOpening(request, plan) : undefined
      if (opening === false || document.hidden) { request.pace.reset(); return }
      const path = opening ? opening.tier === 'master' ? 'master-webgl2' : 'mobile-webgl2' : 'mobile-canvas'
      if (request.presented && (!this.bridgeFrameLive() || this.renderer.bridgePath !== path)) request.pace.reset()
      if (this.continuous && request.pace.ready(now, performance.now()) && performance.now() - started < OPENING_MAX_GAP_MS) {
        graphicsTrace?.event('opening-paced', request.pace.slowFallback ? 'slow-complete-frame-fallback' : 'paced')
        markBoot('run-settled')
        if (this.openingCut) {
          const cut = request.cut = { id: ++this.cutId, done: false }
          markBoot('run-cut')
          this.emit({ type: 'runRevealing', id: cut.id })
        } else this.completePreparedRun()
        return
      }
      // A cold preparation tick may already have allocated or uploaded a
      // backing. Don't stack the first draw on top of that expensive task.
      if (!request.warmed && performance.now() - started >= OPENING_PAINT_SLICE_MS) { graphicsTrace?.state('opening-wait', 'paint-slice-budget'); return }
      if (!request.presented && request.stage !== 'surface') this.preparationStage(request, 'frame')
      if (this.paint(0, false, false, opening)) {
        graphicsTrace?.state('opening-wait', 'frame-pacing')
        request.warmed = true
        if (!request.presented) { request.presented = true; graphicsTrace?.event('opening-first-submit'); markBoot('run-submit') }
        if (this.continuous) {
          // Present real world + HUD frames under the opaque veil. A staged
          // upload or an idle callback can't satisfy the pacing check.
          request.pace.submitted(now, performance.now())
          this.preparationStage(request, 'settling')
        } else {
          this.pendingRun = null
          this.openCombat()
        }
      } else if (!this.paintDraft && !this.renderer.hasBridgeOpeningFrame && !document.hidden) {
        request.pace.reset()
        this.preparationStage(request, 'surface')
        this.holdPresentation(true)
      }
    } catch (error) {
      this.failRunPreparation(error)
    } finally {
      if (graphicsTrace) graphicsTrace.duration('opening.tickJS', performance.now() - started)
      // No loading time, including the handoff itself, is simulation debt.
      this.lastFrame = performance.now()
    }
  }

  private completePreparedRun(): void {
    graphicsTrace?.event('run-input-unlocked')
    this.pendingRun = null
    this.renderer.endBridgeOpening()
    this.openCombat()
  }

  private planBridgeOpening(request: RunRequest): NonNullable<RunRequest['opening']> {
    const stream = this.bg.bridgeStream?.(), route = this.route!
    const { cssW: width, cssH: height } = this
    let opening = request.opening
    if (!opening || width !== opening.width || height !== opening.height) {
      const view = worldBounds(this.openingView, width, height, this.cam)
      stream?.requestWindow(view.left, view.right, this.cam.x)
      const visible = visiblePlateIndices(route, view, [])
      if (!opening) markBoot('run-workers')
      request.opening = opening = { width, height, visible }
    }
    return opening
  }

  private prepareBridgeOpening(request: RunRequest, opening: NonNullable<RunRequest['opening']>): BridgeAdmission | null | false {
    const plates = bridgeOpeningPlatesSettled(), sky = bridgeSkyBasisSettled()
    const stream = this.bg.bridgeStream?.(), route = this.route!
    const { width, height } = opening
    const gpu = this.renderer.advanceBridgeOpening(width, height, this.dpr, this.hudUsable && this.inspect.mode === 'off',
      stream?.openingWindow() ?? null, route.seed, sky && bridgeCityPlatesSettled())
    // A pending GPU setup cannot hold a working Canvas fallback forever.
    // This cannot interrupt a synchronous driver call already on the stack.
    if (!request.presented && request.activeMs >= OPENING_GL_FALLBACK_MS &&
        (gpu === 'device' || gpu === 'renderer' || gpu === 'lighting')) {
      graphicsTrace?.event('opening-gl-fallback', `waiting=${gpu}`)
      this.renderer.fallbackBridgeOpening()
      this.preparationStage(request, 'background')
      return false
    }
    // The transport window is already baking. Don't occupy the only
    // raster lane with an albedo draft until adapter discovery completes.
    if (gpu === 'device') { graphicsTrace?.state('opening-gates', 'gpu=device'); this.preparationStage(request, 'renderer'); return false }
    // Start the visible plate lane while programs link. Re-plan for a lit
    // Canvas plate only if admission actually resolves to Canvas.
    const lit = gpu === null
    if (lit !== opening.lit) {
      stream?.planPlates(route.at(this.cam.x).index, opening.visible, lit, true, false)
      opening.lit = lit
    }
    const streamSettled = !stream || stream.openingSettled(opening.visible)
    const backdrop = plates && sky && streamSettled
    graphicsTrace?.state('opening-gates', `gpu=${gpu === null ? 'canvas' : typeof gpu === 'string' ? gpu : gpu.tier} plates=${plates} sky=${sky} stream=${streamSettled} window=${!!stream?.openingWindow()}`)
    if (backdrop && !request.backdropMarked) { request.backdropMarked = true; markBoot('run-backdrop-ready') }
    if (gpu === 'renderer' || !backdrop || gpu === 'lighting') {
      this.preparationStage(request, gpu === 'renderer' ? gpu : !backdrop ? 'background' : 'lighting')
      return false
    }
    if (!request.rendererMarked) { request.rendererMarked = true; markBoot('run-renderer-ready') }
    return gpu
  }

  private failRunPreparation(error: unknown): void {
    graphicsTrace?.event('opening-error', String(error).slice(0, 400))
    this.discardRunPreparation()
    console.error('Preparing the arena failed', error)
    this.input.setEnabled(false)
    this.bg.dispose?.()
    this.props.dispose()
    this.audio.stopMusic()
    this.audio.stopRainAmbience()
    this.emit({ type: 'error' })
  }

  /** Synchronous entry for scripted pose/replay tools, not the menu click. */
  startRun(swordId: SwordId): void {
    if (this.destroyed || this.pendingRun) return
    this.discardPaintDraft()
    this.audio.resume()
    this.beginRun(swordId)
    this.openCombat()
  }

  private beginRun(swordId: SwordId, request?: RunRequest): void {
    if (!this.loadout.includes(swordId)) this.setLoadout([swordId])
    this.equipProgressedSword(this.loadout.includes(swordId) ? swordId : this.loadout[0])
    this.player.reset(this.entryX)
    // Sky, route sockets and traffic each get their own seeded stream.
    const runSeed = request?.seed ?? ((Math.random() * 0xffffffff) >>> 0)
    this.lastRunSeed = runSeed
    let initPart = traceStart()
    this.resetRoute(runSeed)
    traceEnd('opening.resetRoute', initPart)
    const prep = request?.preparation
    initPart = traceStart()
    this.bg.setRunSeed?.(runSeed, prep?.night ?? undefined)
    traceEnd('opening.setRunSeed', initPart)
    initPart = traceStart()
    const worldBakeMs = this.bg.warm?.() ?? 0
    traceEnd('opening.backgroundWarm', initPart)
    this.bakeMs = prep ? performance.now() - prep.startedAt : worldBakeMs
    this.props.reset(runSeed)
    if (this.route) this.props.setRoute(this.route, this.entryX, Infinity)
    // The prop lane inherits the run's density axes: 2–5 auto-placed props on
    // a jittered timer, so the rooftop is dressed differently every run.
    const prof = this.bg.getProfile?.()
    if (prof) this.props.setRunDensity(prof.props.density, prof.props.timerJitter, prof.props.crateBias)
    this.syncSceneMood(runSeed)
    if (request && !this.continuous) this.props.warm()
    this.enemies.length = 0
    this.projectiles.clear()
    this.fx.clear()
    this.hud.reset()
    this.combo.reset()
    this.fps = this.sampledFps = 60
    this.snapAt = -Infinity
    this.hordeTick = 0
    this.waves.reset(runSeed)
    this.stats = { score: 0, kills: 0, maxCombo: 0, wave: 0, timeAlive: 0, bestRank: '' }
    this.runTime = 0
    this.worldRef.time = this.time = 0
    this.prevStepTime = 0
    this.simAccum = 0
    this.environmentAccum = 0
    this.overloadDropped = 0
    this.timeScale = 1
    this.slowmoT = 0
    this.hitstopT = 0
    this.exec = null
    this.ult = null
    this.banner = null
    this.cam.startOnRoad(this.player.x)
    this.awaitingFirstStep = !!request
    this.renderTime = 0
    this.streamQuiet = true
    if (this.encounters && !this.qaMode) this.spawnRoadTraffic(0)
  }

  private openCombat(): void {
    this.audio.startMusic()
    this.audio.setMusicIntensity(0.55)
    this.input.setEnabled(true)
    this.emit({ type: 'runStarted' })
    this.setPhase('playing')
    this.publishActions()
    this.audio.play('uiConfirm')
  }

  pause(): void {
    if (this.phase !== 'playing') return
    this.pausedSceneDirty = true
    this.lastGapAt = 0
    this.service.cancel()
    this.setPhase('paused')
    this.input.setEnabled(false)
    this.audio.play('uiClick')
    this.audio.setMusicIntensity(0.2)
    this.audio.setRainAmbience(0)
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.setPhase('playing')
    this.input.setEnabled(true)
    this.lastFrame = performance.now()
    this.lastGapAt = 0
    this.audio.setMusicIntensity(0.55)
    this.audio.play('uiConfirm')
  }

  quitToMenu(): void {
    this.discardRunPreparation()
    this.enemies.length = 0
    this.projectiles.clear()
    this.fx.clear()
    const menuSeed = (Math.random() * 0xffffffff) >>> 0
    this.props.reset(menuSeed)
    this.lastRunSeed = menuSeed
    this.resetRoute(menuSeed)
    if (this.route) this.props.setRoute(this.route, this.entryX, Infinity)
    this.bg.setRunSeed?.(menuSeed)
    this.syncSceneMood(menuSeed)
    this.waves.reset(menuSeed)
    this.player.reset(this.entryX)
    this.combo.reset()
    this.exec = null
    this.ult = null
    this.banner = null
    this.timeScale = 1
    this.hitstopT = 0
    this.audio.stopMusic()
    this.audio.stopRainAmbience()
    this.input.setEnabled(false)
    this.attractNeedsPaint = true
    this.attractAssets = -1
    this.viewport?.removeAttribute('data-title-ready')
    this.holdPresentation(false)
    this.setPhase('attract')
    this.cam.startOnRoad(this.entryX)
  }

  private gameOver(): void {
    this.setPhase('gameover')
    this.input.setEnabled(false)
    this.audio.setMusicIntensity(0.1)
    this.audio.setRainAmbience(0)
    this.audio.play('deathHeavy', { volume: 0.9 })
    this.addSlowmo(0.25, 2)
    this.stats.wave = this.route ? Math.floor((this.stats.distanceMetres ?? 0) * WORLD_UNITS_PER_METRE / SECTOR_LENGTH) + 1 : this.waves.wave
    this.stats.maxCombo = this.combo.best
    this.stats.bestRank = this.combo.bestRank || '—'
    this.stats.timeAlive = this.runTime
    this.emit({ type: 'gameover', stats: { ...this.stats } })
  }

  /* ------------------------------------------------------------------ */
  /* main loop                                                            */
  /* ------------------------------------------------------------------ */

  /** Consecutive frames that threw. A render exception is almost always
   *  transient (a plate released under the draw, a context lost for a moment),
   *  and the OLD policy — stop the loop on the first throw — turned a single bad
   *  blit into a dead session with a black screen, which is a P1 the player
   *  cannot recover from. The policy now is:
   *
   *   · a throw is COUNTED and the loop keeps going;
   *   · two clean frames in a row reset the count (so a one-off cannot accumulate);
   *   · only a PERSISTENT failure (120 consecutive ≈ 2 s) stops the game — at that
   *     point it is not transient and continuing would burn the battery for nothing.
   *
   *  This is the "for good" part of the canvas fix: `hasPixels()` stops the known
   *  cause, and the loop survives any unknown one. */
  private frameErrors = 0
  private cleanStreak = 0

  private loop = (now: number): void => {
    try {
      const inactive = this.phase === 'preparing' || this.phase === 'paused'
      const t0 = performance.now()
      this.frame(now)
      if (graphicsTrace && !inactive && this.phase === 'playing' && !document.hidden) graphicsTrace.duration('frame.js', performance.now() - t0)
      this.cleanStreak++
      if (this.cleanStreak >= 2) this.frameErrors = 0
      if (inactive || this.phase === 'paused' || document.hidden) {
        // Prep, pause and hidden intervals don't describe gameplay pacing.
        this.lastGapAt = 0
        if (!this.destroyed) this.raf = requestAnimationFrame(this.loop)
        return
      }
      const js = performance.now() - t0
      this.jsMs += (js - this.jsMs) * 0.12
      const gap = this.lastGapAt ? Math.max(0, now - this.lastGapAt) : 0
      this.lastGapAt = now
      // Foreground percentiles keep visible hitches. Visibility events, not
      // the length of an interval, identify which samples cross tab switches.
      this.frameLog.sample(gap)
      if (graphicsTrace && this.phase === 'playing' && gap > 0) graphicsTrace.duration('frame.interval', gap)
      if (gap > 0) {
        this.frameMs += (gap - this.frameMs) * 0.1
        // Residual, NOT a GPU measurement. Most of it is vsync idle on a
        // healthy frame; keep it honest so it cannot fake a bottleneck.
        this.waitMs += (Math.max(0, gap - js) - this.waitMs) * 0.1
      }
      // EXACTLY ONE pending frame is owned by `loop`. `frame()` used to schedule
      // its own successor, which made the error path double-schedule (two loops,
      // double speed) if it ever tried to recover.
      if (!this.destroyed) this.raf = requestAnimationFrame(this.loop)
      return
    } catch (error) {
      this.frameErrors++
      this.cleanStreak = 0
      // Log ONCE per run of failures, not 60 times a second: a console flooded
      // with the same stack is how the original InvalidStateError got missed.
      if (this.frameErrors === 1) {
        console.error('Frame failed; continuing (will stop after ~2s of failures)', error)
      }
      if (this.frameErrors < 120) {
        this.raf = requestAnimationFrame(this.loop)
        return
      }
      console.error('Game loop stopped: 120 consecutive failed frames', error)
      cancelAnimationFrame(this.raf)
      this.input.setEnabled(false)
      this.audio.destroy()
      this.emit({ type: 'error' })
    }
  }

  private frame(now: number): void {
    if (this.destroyed) return
    if (this.phase === 'preparing') {
      this.prepareRunFrame(now)
      return
    }
    let dtRaw = (now - this.lastFrame) / 1000
    this.lastFrame = now
    if (document.hidden) return
    if (this.phase === 'attract') {
      // Paint the menu before its cold backdrop. Engage can go straight to
      // the run preparation path if the player beats the attract bake.
      if (this.attractNeedsPaint) { this.attractNeedsPaint = false; return }
      this.bg.warmAttract?.()
      if (this.continuous && this.inspect?.mode === 'off') {
        // A quiet title needs one frame per asset arrival or resize, not
        // repeated full-frame submissions behind interactive menu controls.
        // Don't bake a provisional skyline and immediately bake it again
        // over the menu's first interaction. The CSS fallback is already up.
        const city = bridgeCityPlatesSettled(), sky = bridgeSkyBasisSettled()
        if (!city || !sky) return
        const assets = this.bg.titleAssets?.() ?? 0
        if (assets !== this.attractAssets || this.pausedSceneDirty) {
          const first = this.attractAssets < 0
          if (this.paint(0, false)) {
            this.attractAssets = assets; this.pausedSceneDirty = false
            if (first) markBoot('title-submit')
          }
        }
        return
      }
    }
    // The transition into Results already paints the final pose. Retain it
    // even across resize: a cancelled Retry can have initialized new sim
    // state that must never be rendered beneath the old score card.
    if (this.continuous && this.phase === 'gameover' && this.inspect?.mode === 'off') return
    // Preserve the raw gap for pacing telemetry; clamp only the time fed into
    // simulation and visuals so a long frame cannot trigger unbounded work.
    const frameGap = dtRaw
    dtRaw = clamp(dtRaw, .0001, MAX_FRAME_DT)
    this.wall = now / 1000
    this.renderTime = this.time // frozen/paused frames render the sim time
    const pausedAtStart = this.phase === 'paused'
    if (this.phase === 'playing' && this.inspect.mode !== 'edit') {
      // Ignore sub-millisecond resume edges, but include visible slow frames.
      if (frameGap >= .002) {
        this.fps = .9 * this.fps + .1 / frameGap
        this.govern(frameGap)
      }
      if (this.settings.showFps && this.wall - this.snapAt >= .25) {
        this.snapAt = this.wall
        this.sampledFps = Math.round(this.fps)
      }
    }
    // Weather has its own real visual clock, independent of combat hitstop.
    // The pose editor freezes the whole frame for authoring.
    const editFrozen = this.inspect.mode === 'edit'
    if (this.phase !== 'paused' && !editFrozen && !this.bg.advanceActiveTicks && !this.sceneArt.clean) {
      this.storm.update(dtRaw)
    }
    if (editFrozen) this.audio.setRainAmbience(0)

    if (!this.ctx) return
    if (this.phase === 'playing' && (this.presentationHeld || !this.bridgeFrameLive())) {
      // No combat debt during loss. Publish a fresh, current-seed pose
      // first; the next callback may step again, never this recovery tick.
      this.simAccum = this.environmentAccum = 0
      this.recordPrev()
      this.holdPresentation(!this.paint(0, editFrozen, true))
      this.lastFrame = performance.now()
      return
    }

    // particle toggle (B): OFF → LOW → FULL — raw physical edge, consumed
    // once per render (cleared by endRenderFrame at the bottom of frame())
    if (this.input.rawPressed('KeyB')) {
      cycleParticleLevel()
      this.pausedSceneDirty = true
    }

    if (this.phase === 'paused' || editFrozen) {
      // frozen frame, HUD still drawn (edit = pose-editor authoring freeze).
      // FROZEN FRAMES DISCARD GAMEPLAY EDGES: no simulation step will ever
      // consume them, so keeping them would fire stale presses on resume.
      // (Pause additionally disables/resets input; this covers edit-freeze
      // and any phase where input stays enabled.) Raw editor edges keep
      // their per-render lifetime via endRenderFrame below.
      this.input.endFrame(0)
    } else {
      // --- timing: hitstop & slow-mo ---
      const frozen = Math.min(this.hitstopT, dtRaw)
      this.hitstopT = Math.max(0, this.hitstopT - dtRaw)
      const liveDt = dtRaw - frozen
      let simDt = liveDt
      if (liveDt === 0) {
        this.timeScale = 0
      } else if (this.slowmoT > 0) {
        this.slowmoT -= liveDt
        simDt = liveDt * this.slowmoScale
        this.timeScale = this.slowmoScale
        if (this.slowmoT <= 0) this.timeScale = 1
      } else {
        this.timeScale = 1
      }

      // --- cinematics run on real time ---
      if (liveDt > 0) this.updateCinematics(liveDt)
      if (this.hitstopT > 0) simDt = 0

      // --- FIXED-TIMESTEP SCHEDULER (plan M03) ---
      // The sim advances only in exact 1/60 steps (the tested, tuned
      // configuration at EVERY frame rate). Backlog above the bounded cap
      // is DROPPED EXPLICITLY and counted in `overloadDropped` — never
      // disguised as a variable-size catch-up tick (a 50 ms "step" is a
      // different simulation than 1/60). Work per render is bounded at
      // maxSteps fixed updates, so a slow machine cannot enter the death
      // spiral (raster slows → more substeps → slower → freeze).
      const adv = advanceSimClock(this.simAccum, simDt)
      this.simAccum = adv.acc
      this.overloadDropped += adv.dropped
      const substeps = adv.steps
      let caughtUp = adv.dropped > 0
      for (let i = 0; i < substeps; i++) {
        this.recordPrev()
        this.step(adv.stepDt)
        // EDGE LIFETIME = ONE SUBSTEP. pressed()/released() edges must be
        // visible to exactly ONE simulation step: clearing them only once
        // per RENDERED frame let a single jump press fire doJump in BOTH
        // substeps of a slow frame (jump then airJump in the same frame —
        // the −950 impulse was stomped to −820 mid-rise and the leap clip
        // was overwritten by airJump). Input events can only arrive BETWEEN
        // rAF callbacks, so no press is ever missed; presses that land while
        // a state ignores them are still caught by the combo BUFFER, which
        // is pressTime-based and deliberately spans substeps and frames.
        // A render that runs ZERO substeps must NOT clear edges (M01): the
        // press survives to the next legal simulation opportunity.
        this.input.endFrame(adv.stepDt)
        if (this.hitstopT > 0 && i + 1 < substeps) {
          this.overloadDropped += (substeps - i - 1) * adv.stepDt
          caughtUp = true
          break
        }
      }
      if (caughtUp) {
        // collapse the interpolation history onto the frontier: the last
        // fixed step is shown on this frame (the display was hitched anyway)
        // and the NEXT frames interpolate strictly forward from here —
        // never rewind.
        this.recordPrev()
      }
      // --- visual systems tick ONCE per frame (never per substep) ---
      this.streamQuiet = frozen <= 0 && this.hitstopT <= 0
      this.fx.update(frozen > 0 || this.hitstopT > 0 ? dtRaw : simDt, dtRaw)
      this.bg.update(simDt)
      // --- sample the render between the last two sim states ---
      // alpha sweeps 0..1 as the leftover accumulator fills toward the next
      // step, so motion advances a little EVERY display frame instead of
      // jumping at sim steps (the "90fps feel": smooth at 60/90/120/144Hz
      // and through timing jitter). On a hitch catch-up frame the frontier
      // state is shown directly (alpha=1) — no duplicate frame.
      const alpha = caughtUp || frozen > 0 || this.hitstopT > 0 ? 1 : Math.min(1, Math.max(0, this.simAccum * 60))
      if (this.phase === 'playing' && this.bg.advanceActiveTicks) {
        // Independent fixed clock: short hitstop/slow-mo cannot stall the
        // front. Use the same debt cap as play, never hidden/time-in-menu debt.
        const env = advanceSimClock(this.environmentAccum, dtRaw)
        this.environmentAccum = env.acc
        this.bg.advanceActiveTicks(env.steps, env.dropped ? 1 : env.acc / env.stepDt)
        this.audio.setRainAmbience(this.bg.rainAudioAt?.(this.player.x) ?? 0)
      }
      this.renderTime = this.prevStepTime + alpha * (this.time - this.prevStepTime)
      this.installRenderLerp(alpha)
      this.updateCamera(simDt)
      this.bg.syncCutaway?.(this.player.x, this.player.y, dtRaw)
    }

    const hud = this.hudCtx
    if (this.retainPausedScene && pausedAtStart && hud && hud.canvas !== this.canvas &&
        !this.pausedSceneDirty && this.bridgeFrameLive() && !this.presentationHeld &&
        (!this.coverage || this.worldSubmit?.hud === 'layer') && this.inspect.mode === 'off') {
      // Advance vitals even with a frozen world. Keep the HUD backing too
      // when nothing visible changed; an easing bar still paints as before.
      this.hud.drawLayer(hud, this.cssW, this.cssH, this.buildHudState(), dtRaw, window.devicePixelRatio)
    } else {
      const first = this.awaitingFirstStep && this.phase === 'playing'
      const submitted = this.paint(dtRaw, editFrozen)
      if (!submitted && this.coverage && (this.phase === 'playing' || this.phase === 'paused')) this.holdPresentation(true)
      if (submitted && first && this.time > 0) { this.awaitingFirstStep = false; graphicsTrace?.event('first-simulation-submit'); markBoot('first-step') }
      // Inspection paints onto the scene. Leaving it needs a fresh world.
      // A pause fired by a substep still gets one draw at the frozen sim pose.
      this.pausedSceneDirty = !submitted || this.inspect.mode !== 'off' || (!pausedAtStart && this.phase === 'paused')
    }

    // Clear raw editor-key edges only. On a zero-step render the next legal
    // sim step still owns any pending gameplay edge.
    this.input.endRenderFrame()
  }

  private paint(dt: number, editFrozen: boolean, provisional = false, opening?: BridgeAdmission | null): boolean {
    const draft = this.paintDraft
    const ctx = draft?.ctx ?? this.coverage?.work() ?? this.ctx
    const w = this.cssW, h = this.cssH
    try {
      if (!ctx || ctx.isContextLost?.()) { this.discardPaintDraft(); return false }
      // Don't clear/resize the HUD on a failed scene build. If its context
      // is unavailable, ordinary Canvas can paint vitals into the work plate.
      const hudCtx = this.hudUsable ? this.hudCtx : null
      const world: RenderWorld = draft?.world ?? {
        renderScale: this.dpr, provisional, opening,
        streamQuiet: this.streamQuiet && this.hitstopT <= 0 && this.player.state !== 'parry',
        hudCtx: this.inspect.mode === 'off' ? hudCtx : null,
        cam: this.cam,
        fx: this.fx,
        bg: this.bg,
        enemies: this.enemies,
        player: this.player,
        projectiles: this.projectiles,
        props: this.props,
        hud: this.hud,
        hudState: this.buildHudState(),
        routeState: this.route ? { route: this.route, gate: this.encounters?.gate, clearedGate: this.encounters?.previousGate, pickups: this.pickups,
          service: this.service, active: this.phase !== 'attract' && this.inspect.mode === 'off', quiet: this.reducedMotion,
          opticalPulse: Math.max(0, 1 - (this.ult?.t ?? this.exec?.t ?? 1) / .12) } : undefined,
        time: this.renderTime,
      }
      const observe = this.phase === 'playing' && !document.hidden && this.inspect.mode === 'off' ? this.graphicsObserver : undefined
      const start = observe || graphicsTrace ? performance.now() : 0
      let kind: WorldSubmit['kind'] = this.phase === 'attract' ? 'title' : provisional && world.routeState?.active ? 'starter' : 'canvas'
      try {
        if (this.dirtyWork.has(ctx)) this.cleanWorkContext(ctx)
        if (opening && this.dirtyWork.has(opening.actors)) this.cleanWorkContext(opening.actors)
        if (draft || (this.coverage && (this.phase === 'attract' || (opening !== undefined && !this.pendingRun?.warmed)))) {
          const job = draft ?? (this.paintDraft = { ctx, world, steps: this.renderer.drawSteps(ctx, world, w, h, dt) })
          const sliceStart = traceStart()
          const completed = !job.steps || advancePaint(job.steps)
          traceEnd('paint.draftSlice', sliceStart)
          if (!completed) return false
          job.steps = undefined
        } else if (!opening || !this.renderer.hasBridgeOpeningFrame) {
          const drawStart = traceStart()
          this.renderer.draw(ctx, world, w, h, dt)
          traceEnd('paint.drawTotal', drawStart)
        }
        if (ctx.isContextLost?.() || !ctx.canvas.width || !ctx.canvas.height) throw new Error('Arena surface unavailable')
        if (opening && !this.renderer.bridgeOpeningFrameReady()) { graphicsTrace?.state('opening-wait', 'gpu-fence'); return false }
        if (opening !== undefined) {
          if (document.hidden) return false
          this.renderer.drawHud(ctx, world, w, h, 0)
        }
        if (world.hudCtx?.isContextLost?.()) throw new Error('HUD surface unavailable')
        if (editFrozen) this.inspect.editorFrame(this, dt)
        this.inspect.draw(ctx, this, this.renderTime)
        if (opening) { this.renderer.publishBridgeOpening(opening); kind = 'webgl' }
        else if (opening === undefined && this.renderer.bridgePath !== 'mobile-canvas') kind = 'webgl'
      } catch (error) {
        if (!this.coverage) throw error
        this.discardPaintDraft()
        this.presentationFaults++
        if (opening !== null) this.renderer.abortBridgeFrame(`Scene paint: ${String(error).slice(0, 400)}`)
        if (ctx.isContextLost?.()) return false
        try {
          // A throw can strand clips, transforms and a save stack. Reset
          // only the hidden surface, never the last committed canvas.
          this.cleanWorkContext(ctx)
          // An emergency painter can repair a live loss, but it must never
          // satisfy an opening that promises the full lighting/effects.
          if (opening !== undefined) return false
          if (!this.hudUsable) world.hudCtx = null
          this.renderer.drawBridgeEmergency(ctx, world, w, h, dt)
          if (world.hudCtx?.isContextLost?.()) return false
          if (ctx.isContextLost?.() || !ctx.canvas.width || !ctx.canvas.height) return false
          if (!world.hudState.attract) kind = 'emergency'
        } catch {
          // Roll back the work surface, not the simulation. The frame loop
          // now retries with no further combat updates until one succeeds.
          return false
        }
      }
      this.paintDraft = undefined
      const hud = world.hudState.attract ? 'off' : world.hudCtx ? 'layer' : 'world'
      this.viewport?.toggleAttribute('data-bridge-hud-inline', hud === 'world')
      if (kind !== 'webgl') this.coverage?.commit(ctx)
      if (opening === null) this.renderer.publishBridgeOpening(null)
      this.ctx = ctx
      if (kind === 'title' || this.worldSubmit?.kind === 'title') this.viewport?.toggleAttribute('data-title-ready', kind === 'title')
      this.worldSubmit = { id: (this.worldSubmit?.id ?? 0) + 1,
        layer: kind === 'webgl' ? 'finish' : ctx.canvas.dataset.renderLayer ?? 'scene',
        kind, hud, seed: this.route?.seed, time: this.time, hp: this.player.hp, threats: world.hudState.enemiesLeft }
      this.holdPresentation(false)
      if (observe) {
        const now = performance.now()
        observe({ now, submitMs: now - start, config: this.renderConfig, fpsInk: this.hud.lastFpsDraw,
          size: [ctx.canvas.width, ctx.canvas.height], presentation: this.renderer.bridgeReceipt() })
      }
      return true
    } finally {
      // ALWAYS hand the sim its true positions back (crash-safe)
      this.uninstallRenderLerp()
    }
  }

  private cleanWorkContext(ctx: CanvasRenderingContext2D): void {
    if (typeof ctx.reset === 'function') ctx.reset()
    else ctx.canvas.width = ctx.canvas.width
    this.dirtyWork.delete(ctx)
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
        if (!this.isRunning) return
      }
      const dashSequence = this.player.dashSequence
      this.player.update(dt, this.worldRef)
      if (this.route) {
        if (this.player.dashSequence !== dashSequence && this.service.buff === 'Chain Lightning Dash') this.chainDash()
        this.props.setRoute(this.route, this.player.x, this.worldRef.arenaMaxX)
        if (!this.qaMode && !this.player.isDead) this.collectPickup()
        this.stats.distanceMetres = Math.max(this.stats.distanceMetres ?? 0, travelledMetres(this.player.x))
      }
      this.props.update(dt, this.worldRef, this.propHooks, this.player)
      /* THE HORDE, SCHEDULED. Near enemies at full rate; far ones at 1/3 rate
       * with 3× dt (same average, coarser sampling). `hordeTick` counts STEPS,
       * not frames, so the schedule is a pure function of the simulation. */
      this.hordeTick++
      const plan = planTicks(this.enemies, this.player.x, this.hordeTick, this.hordePlan)
      for (let i = 0; i < plan.near.length; i++) {
        const e = this.enemies[plan.near[i]]
        if (e) e.update(dt, this.worldRef)
      }
      for (let i = 0; i < plan.far.length; i++) {
        const e = this.enemies[plan.far[i]]
        if (e) e.update(dt * FAR_DIVISOR, this.worldRef)
      }
      if (this.route) {
        separateCrowd(this.enemies, dt, 16, this.worldRef.arenaMaxX - 16, this.crowd, this.worldRef.enemyTravel)
        // A moving formation must not strand old marksmen or hold the cap
        // from two spans behind. A gate boss is never retired by distance.
        if (!this.qaMode) for (const e of this.enemies) {
          if (e.gate === undefined && Math.abs(e.x - this.player.x) > 1020) e.dead = true
        }
      }
      // purge dead
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        if (this.enemies[i].dead) this.enemies.splice(i, 1)
      }
      // Player body sweep endpoints for swept projectile collision (M05):
      // pre-step root (PLAYER_POS, set above) → post-movement root.
      PLAYER_BODY.x0 = PLAYER_POS.x
      PLAYER_BODY.y0 = PLAYER_POS.y
      PLAYER_BODY.x1 = this.player.x
      PLAYER_BODY.y1 = this.player.y
      this.projectiles.update(dt, this.worldRef)

      if (this.phase === 'playing') {
        if (this.encounters) {
          if (!this.qaMode && !this.player.isDead) this.spawnRoadTraffic(dt)
          this.updateService(dt)
          const holding = !!this.route?.shelterAt(this.player.x) || !this.enemies.some(e =>
            isThreat(e, this.player.x) && Math.abs(e.x - this.player.x) < 260 && Math.abs(e.y - this.player.y) < 185 &&
            this.route?.stopAtCover(this.player.x, e.x) === e.x)
          this.combo.update(dt, holding)
        } else {
          if (!this.qaMode) this.waves.update(dt, this.enemies.reduce((n, e) => n + Number(!e.dead), 0))
          this.combo.update(dt)
        }
        this.publishActions()
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
      this.props.update(dt, this.worldRef, this.propHooks, this.player)
      this.cam.focus(this.player.x + Math.sin(this.time * 0.14) * 140, this.player.y, 0, 0)
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
      if (this.route && !this.exec) {
        for (const e of this.enemies) {
          if (isThreat(e, p.x) && Math.abs(e.x - p.x) < 235 && e.state === 'launched') ty = Math.min(ty, e.y)
        }
      }
      // The Bridge is a continuous physical road. Lock horizontal framing
      // to the player root even in a gate fight, and never vary the scale
      // with enemy population. Explicit execution/ultimate shots may zoom.
      let zoom: number = PLAY_ZOOM
      if (this.exec || this.ult) zoom = 1.3
      else if (!this.route) {
        const n = this.enemies.length
        if (n > 10) zoom = .94
        if (n > 18) zoom = .88
      }
      const prev = this.encounters?.previousGate?.x, next = this.encounters?.gate.x
      const gateX = prev !== undefined && p.x < prev + 26 ? prev : next
      this.cam.focus(this.route ? p.x : tx, ty, vx, vy, gateX)
      this.cam.setZoom(zoom)
    }
    this.cam.update(dt)
    if (this.route && this.phase === 'playing') {
      const p = this.player, s = p.scale
      const head = p.hipY + (p.geom.headC.y - 10) * s
      const point = p.swordDrawn ? p.hipY + (p.geom.tip.y - 4) * s : head
      const upper = Math.min(head, point), lower = Math.max(p.y + 5, p.hipY + 13 * s)
      this.cam.fitTravelBody(upper, lower, this.touchControls ? 160 : 128, this.touchControls ? 165 : 45)
    }
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
    if (this.input.pressed('ult') && this.canOverdrive()) {
      this.startUlt()
    }
    // execution
    if (this.input.pressed('execute') && !this.serviceAvailable()) {
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

  private spawnEnemy(kind: EnemyKind, x: number, waveScale: number, routeSpawn?: EncounterSpawn): void {
    if (this.enemies.length > 42) return
    const enemy = new Enemy(kind, x, waveScale)
    if (routeSpawn) {
      enemy.arriveOnRoute(x > this.player.x ? -1 : 1, routeSpawn.platform)
      enemy.gate = routeSpawn.gate
    } else {
      this.fx.burst(x, -420, 6, '#8fb4c8', 120, 0.6, 'dot')
    }
    this.enemies.push(enemy)
    if (kind === 'boss') {
      this.emit({ type: 'bossSpawn' })
    }
  }

  private spawnRoadTraffic(dt: number): void {
    const d = this.encounters
    if (!d) return
    const half = this.cssW / (2 * this.cam.zoom), p = this.player
    const order = d.update(dt, { x: p.x, vx: p.vx, facing: p.face, left: this.cam.x - half, right: this.cam.x + half }, this.enemies)
    this.worldRef.arenaMaxX = d.limit
    if (order) {
      if (order.kind === 'boss') this.onWaveStart(d.patrol, true)
      this.spawnEnemy(order.kind, order.x, order.scale, order)
    }
  }

  private canOverdrive(): boolean {
    return this.phase === 'playing' && !this.route?.shelterAt(this.player.x) && this.player.meter >= 100 && !this.player.isDead && !this.exec && !this.ult && this.player.state !== 'scripted'
  }

  private serviceAvailable(): boolean {
    const { x, y } = this.player
    return !this.player.isDead && this.service.available(this.route?.shelterAt(x) ?? null, x, y)
  }

  private publishActions(): void {
    const overdrive = this.canOverdrive(), service = this.serviceAvailable()
    const execute = !service && !!this.findExecuteTarget()
    if (overdrive === this.actions.overdrive && service === this.actions.service && execute === this.actions.execute) return
    this.actions = { overdrive, service, execute }
    this.emit({ type: 'actions', ...this.actions })
  }

  private updateService(dt: number): void {
    const p = this.player
    if (p.isDead || this.exec || this.ult) { this.service.cancel(); return }
    const buff = this.service.update(dt, this.route?.shelterAt(p.x) ?? null, p.x, p.y,
      this.input.down('execute'), this.input.pressed('service'))
    if (!buff) return
    this.combo.clear()
    p.hp = Math.min(p.maxHp, p.hp + SERVICE_HP)
    p.shield = SERVICE_SHIELD
    p.maintainSword()
    this.audio.play('heal')
    this.fx.burst(p.x, p.y - 34, 12, '#f2c28a', 125, .52, 'ember')
  }

  private collectPickup(): void {
    const p = this.player
    const kind = this.pickups?.take(p.x, p.y, type => type === 'repair' ? p.hp < p.maxHp : p.meter < 100)
    if (!kind) return
    if (kind === 'repair') p.hp = Math.min(p.maxHp, p.hp + 14)
    else p.meter = Math.min(100, p.meter + 22)
    this.audio.play('heal', { pitch: kind === 'repair' ? 1 : 1.24 })
    this.fx.burst(p.x, -32, 9, kind === 'repair' ? '#81f1bd' : '#7fcffa', 140, .46, 'spark')
  }

  private chainDash(): void {
    const p = this.player
    let x = p.x, y = p.y - 38
    const hit = new Set<Enemy>()
    for (let i = 0; i < 3; i++) {
      let target: Enemy | undefined, best = i === 0 ? 340 : 200
      for (const e of this.enemies) {
        if (!isThreat(e, p.x) || hit.has(e) || this.worldRef.enemyTravel?.(x, e.x) !== e.x) continue
        const d = Math.hypot(e.x - x, e.y - 40 - y)
        if (d < best) { target = e; best = d }
      }
      if (!target) break
      hit.add(target)
      const tx = target.x, ty = target.y - 40
      this.fx.lightningCast({ enemies: [], minX: 0, maxX: this.worldRef.arenaMaxX }, x, y, tx - x, ty - y,
        { color: '#b2e8ff', energy: .75, width: 2.4, maxLen: best, bounces: 0, dmg: 0 })
      this.hitEnemy(target.id, { bx: x, by: y, tx, ty }, {
        id: 'service-chain', dmg: 12 - i * 2, heavy: false, stagger: .2, kb: 40, kbY: 0,
        launch: 0, juggle: 0, hitstop: .01, shake: .03, aoe: 0, breakGuard: false, kind: 'ability',
      })
      x = tx; y = ty
    }
  }

  private onWaveStart(wave: number, boss: boolean): void {
    if (!this.route) this.stats.wave = wave
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
    }
    this.banner = { title: 'WAVE CLEAR', sub: `+${fmt(bonus)} BONUS — SYSTEMS RESTORED`, t: 0, dur: 2.2, color: '#46ffb4' }
    this.audio.play('heal')
    this.fx.burst(this.player.x, this.player.y - 50, 10, '#46ffb4', 200, 0.8, 'ember')
  }

  /* ------------------------------------------------------------------ */
  /* combat resolution (WorldRef)                                         */
  /* ------------------------------------------------------------------ */

  /** prop effects that only the Game can own (HP, score, combo, physics) */
  private propHooks: PropHooks = {
    heal: (n) => {
      const before = this.player.hp
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + n)
      this.fx.text(this.player.x, this.player.y - 108, `+${Math.round(this.player.hp - before)} HP`, '#5cffb4', 15)
    },
    launch: (vy) => {
      this.player.vy = vy
      this.player.grounded = false
    },
    score: (n) => { this.stats.score += Math.round(n * this.combo.mult) },
    comboHit: () => this.combo.onHit(),
  }

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
    strikeProps: (blade, atk, px) => this.props.strike(blade, atk, px, this.worldRef, this.propHooks),
    enemyStrikePlayer: (dmg, dir, heavy, sourceX) => this.enemyStrikePlayer(dmg, dir, heavy, sourceX),
    spawnProjectile: (p) => this.projectiles.spawn(p),
    addHitstop: (t, zoom) => this.addHitstop(t, zoom),
    addSlowmo: (scale, t) => this.addSlowmo(scale, t),
    screenFlash: (color, alpha, t) => this.fx.screenFlash(color, alpha, 4),
    onEnemyKilled: (e) => this.onEnemyKilled(e),
  }

  private hitEnemy(enemyId: number, blade: { bx: number; by: number; tx: number; ty: number }, atk: AttackRuntimeInfo): HitResolution {
    const e = this.enemies.find((en) => en.id === enemyId)
    if (!e || e.dead || e.spawning || this.route?.shelterAt(this.player.x) || this.route?.shelterAt(e.x) ||
        (this.route && this.route.stopAtCover(this.player.x, e.x) !== e.x)) return missedHit(enemyId)
    if (this.service.buff === 'Guard-Crush Heavy' && atk.heavy && !atk.breakGuard) atk = { ...atk, breakGuard: true }
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
    const rankUp = this.combo.onHit()
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo.hits)
    if (rankUp) {
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
        // A heavy connection still pauses the blades. Only a broken defence
        // earns the screen treatment; a whole cleave gets at most one beat.
        const accent = res === 'guardBreak' && this.fx.impactFrame(ex, ey, sword.colors.glow, 'guardBreak')
        if (res === 'guardBreak') {
          this.fx.text(ex, ey - 48, 'BREAK', '#ffd193', 14)
        }
        this.addHitstop(res === 'guardBreak' ? .048 : atk.hitstop, accent ? .045 : 0)
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
      this.addHitstop(0.08)
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
    if (e.gate !== undefined && this.encounters?.openGate(e.gate)) this.worldRef.arenaMaxX = Infinity
    this.audio.play('explosion', { volume: 1 })
    this.audio.play('deathHeavy', { volume: 1, pitch: 0.6 })
    this.addSlowmo(0.2, 1.6)
    const accent = this.fx.impactFrame(e.x, e.y - 60, '#ffae2e', 'bossDefeat')
    this.addHitstop(0.16, accent ? 0.08 : 0)
    this.cam.addTrauma(1)
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
    if (this.phase !== 'playing' || this.route?.shelterAt(this.player.x) ||
        (this.route && this.route.stopAtCover(sourceX, this.player.x) !== this.player.x)) return false
    if (this.player.parryWindowOpen) {
      this.player.onParrySuccess(this.worldRef, sourceX, this.player.parryWindowPerfect)
      return true
    }
    this.player.takeDamage(this.worldRef, dmg, dir, heavy)
    return false
  }

  addHitstop(t: number, zoomPulse = 0): void {
    this.hitstopT = Math.max(this.hitstopT, t)
    if (zoomPulse > 0 && (!this.route || this.exec || this.ult)) this.cam.zoomPulse(zoomPulse)
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
    const p = this.player
    if (this.phase !== 'playing' || p.isDead || this.exec || this.ult || this.route?.shelterAt(p.x)) return null
    let best: Enemy | null = null, distance = 146
    for (const e of this.enemies) {
      if (e.dead || e.spawning || e.hp <= 0 || e.kind === 'boss' || e.hp > e.maxHp * .5) continue
      if (e.state !== 'stun' && e.state !== 'launched' && e.state !== 'down') continue
      if (this.route && this.route.stopAtCover(p.x, e.x) !== e.x) continue
      const d = Math.hypot(e.x - p.x, e.y - p.y)
      if (d <= 146 && (!best || d < distance)) { best = e; distance = d }
    }
    return best
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
      if (ex.step === 0 && e.dead) { this.player.exitScripted(); this.exec = null; return }
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
      const root = clamp(executionRoot(ex.t, timeline, e.x, ex.side), this.worldRef.arenaMinX + 20, this.worldRef.arenaMaxX - 20)
      this.player.x = this.route?.stopAtCover(this.player.x, root, 12) ?? root
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
        const accent = this.fx.impactFrame(e.x,e.y-42,sword.mundane?'#c7ccc9':sword.colors.accent,'execution')
        this.fx.executionPieces(e.x,e.y,this.player.face,e.cfg.style.body,
          this.settings.gore==='blood'?'#c31432':sword.mundane?'#737a76':sword.colors.glow,
          sword.form==='greatblade'?8:sword.id==='katana'?12:10)
        if(sword.mundane){this.fx.dust(e.x,e.y,6);this.fx.burst(e.x,e.y-40,6,'#aeb3af',140,.24,'spark')}
        this.cam.addTrauma(sword.form==='greatblade'?.72:.48)
        this.addHitstop(.052, accent ? .06 : 0)
        this.onEnemyExecuted(e)
        const hp = this.player.hp
        this.player.hp = Math.min(this.player.maxHp, hp + (this.service.buff === 'Vampiric Execute' ? 38 : 22))
        this.player.energy=Math.min(this.player.maxEnergy,this.player.energy+40)
        this.player.meter=Math.min(100,this.player.meter+18)
        this.stats.score+=Math.round(300*this.combo.mult)
        this.fx.text(e.x,e.y-96,profile.name,sword.mundane?'#d0d4d1':sword.colors.accent,16)
        if (this.player.hp > hp) this.fx.text(e.x, e.y - 72, `+${Math.round(this.player.hp - hp)} VITALITY`, '#a5e9b7', 12)
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
                { enemies: this.enemies, minX: this.worldRef.arenaMinX, maxX: this.worldRef.arenaMaxX },
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
    this.addHitstop(rapid ? .008 : final ? .05 : .038)
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

  private project(x: number, y: number): { x: number; y: number } {
    const cam = this.cam, c = Math.cos(cam.rot), s = Math.sin(cam.rot)
    const dx = x - cam.x - cam.offX, dy = y - cam.y - cam.offY
    return { x: this.cssW / 2 + (dx * c - dy * s) * cam.zoom,
      y: this.cssH / 2 + (dx * s + dy * c) * cam.zoom }
  }

  private buildHudState(): HudState {
    const p = this.player
    const boss = this.enemies.find(e => e.kind === 'boss' && !e.dead && !e.spawning)
    const target = this.findExecuteTarget()
    const shelter = this.route?.shelterAt(p.x) ?? null
    const terminal = this.phase === 'playing' && this.serviceAvailable() ? shelter : null
    const gate = this.encounters?.gate
    const remaining = gate ? Math.max(0, gate.x - 420 - p.x) : 0
    const telemetry = this.route ? {
      metres: travelledMetres(p.x), sector: sectorAt(p.x) + 1, biome: biomeAt(p.x),
      safe: shelter ? (shelter.kind === 'service' ? 'SERVICE BAY' : 'TRANSIT COVER') : null,
      gate: gate ? { locked: gate.state === 'locked', distance: remaining / WORLD_UNITS_PER_METRE,
        eta: p.vx > 40 && gate.state === 'ahead' ? remaining / p.vx : null } : null,
    } : undefined
    return {
      hp: p.hp,
      maxHp: p.maxHp,
      shield: p.shield,
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
      wave: Math.max(1, this.encounters?.patrol ?? this.waves.wave),
      enemiesLeft: this.enemies.reduce((n, e) => n + Number(isThreat(e, p.x)), 0),
      route: telemetry,
      kills: this.stats.kills,
      score: this.stats.score,
      boss: boss ? { hp: boss.hp, maxHp: boss.maxHp, name: 'GEMINI MK-II' } : null,
      banner: this.banner,
      executePrompt: target ? this.project(target.x + target.face * target.scale * target.geom.headC.x,
        target.hipY + target.scale * (target.geom.headC.y - 15)) : null,
      terminal: terminal ? { ...this.project(terminal.terminal, -135), progress: this.service.progress / SERVICE_HOLD, buff: terminal.buff } : undefined,
      buff: this.service.buff ? { name: this.service.buff, seconds: Math.ceil(this.service.remaining) } : undefined,
      ultReady: this.canOverdrive(),
      abilityReady: p.energy >= p.sword.ability.cost,
      fps: this.sampledFps,
      touch: this.touchControls,
      showFps: this.settings.showFps,
      insets: this.insets,
      particleLevel: getParticleLevel(),
      runTime: this.runTime,
      attract: this.phase === 'attract',
    }
  }

  get isRunning(): boolean {
    return this.phase === 'playing'
  }

  /** Read-only diagnostics for canvas lifetime verification. Not on the frame path. */
  resourceSnapshot() { return { ...gameLedger.stats(), entries: gameLedger.list(), presentation: this.renderer.bridgeReceipt() } }

  /** debug/testing helper */
  debugSpawn(kind: EnemyKind, x: number): void {
    this.enemies.push(new Enemy(kind, x, 1))
  }
}

export interface GraphicsFrameSample {
  now: number
  submitMs: number
  config: Game['renderConfig']
  fpsInk: string | null
  size: readonly [number, number]
  presentation: ReturnType<Renderer['bridgeReceipt']>
}
