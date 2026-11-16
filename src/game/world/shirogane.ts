/* ==========================================================================
 * SHIROGANE HORIZON — the complete "Moonlit Sakura · Endless Horizon"
 * scene (mountain.html) ported into the BackgroundRenderer contract.
 * --------------------------------------------------------------------------
 * Provenance: composition, art recipes and engine patterns come from the
 * attached scene (Shirogane Horizon — four ranges, four skies, one inn).
 * What lives here and why:
 *
 *  · PRE-GENERATED, BOUNDED HORIZON. The source scene streamed horizon
 *    chunks/batches on demand while panning and could hitch exactly when it
 *    generated new things. Here the arena is a FIXED world span
 *    (ARENA_X0..ARENA_X1) and EVERYTHING is baked once in ensure():
 *    mountain range strips over the full camera parallax domain, the deck
 *    plate, the props plate (all chunks), the inn/rack/cherry/hearth
 *    islands, wet plate, sprites. `stats.bakes` only ever changes inside
 *    ensure()/resize() — update() and every draw path are runtime-READ
 *    only. update()-sweeping the clock across hours allocates nothing new.
 *
 *  · MEMORY / "GC". One-shot plates + fixed typed-array fields; the old
 *    chunk/batch LRU eviction problem disappears because the working set is
 *    bounded at bake time (the plan is enumerable: planHorizon()).
 *
 *  · 1D PARTICLES. Ambient life (stars, snow, petals, embers, smoke,
 *    bokeh, meteors) runs on the P1D system from scratch: one scalar phase
 *    per particle, closed-form positions, no integration, no allocation,
 *    one global quality toggle (FULL/LOW/OFF) shared with combat FX.
 *
 *  · FRAME LAWS (kept from the plan work): update() owns every clock
 *    (wind carrier piecewise-integration F05, flicker, birds, meteor
 *    events, moonCover estimate); draw* are pure render functions that may
 *    scratch-paint islands but never advance simulation or consume RNG.
 *
 * Contract notes: everything CSS px; ground plane y = 0 (fighters y ≤ 0,
 * deck band y ∈ [0, DECK_H]); sky layers are screen-space with parallax
 * anchored to the camera-derived horizon line, so the composition keeps
 * mountain.html's HY ≈ .74 framing at the game's camera height.
 * ========================================================================== */

import { StormEngine } from './storm'
import type { BackgroundRenderer, BgCam, Quality } from './background'
import { windAt, buildLunarSurface } from './horizon-strata'
import { Field1D, Burst1D, getParticleLevel } from '../fx/particles1d'

/* ------------------------------- constants ------------------------------- */

const TAU = Math.PI * 2
const ARENA_X0 = -150
const ARENA_X1 = 2750
const ARENA_W = ARENA_X1 - ARENA_X0
const DECK_H = 380
/** The whole static environment (deck back edge, inn, rack, cherry,
 * horizon strips, mist) is drawn ENV_BACK world units BEHIND the play
 * line, so the fighter stands in the MIDDLE of the road — house and
 * trees at the back like mountain.html — instead of glued to the door.
 * Pure draw-time translate: every bake stays exactly as it was. */
const ENV_BACK = 110

/** mountain.html framing: horizon .740, vanishing .565/.340 (kept as
 *  ratios — the game camera reproduces them: ground line ≈ .71–.74 h). */
const HY_R = 0.74
const RACK_H = 0.236 // pole height, fraction of viewport h (source geo)

/** stage dressing anchors (world px) */
const RACK_X = 1700
const INN_X = 2100
const CHERRY_X = 2470
const INN_W = 240 // ≈ .38 · U at 720p reference
/** cherry tree scale — the reference's sakura is a dominant vertical
 *  (crown ≈ half the inn's width, reaching the roofline) */
const CHERRY_SCALE = 1.4

/** camera parallax domain for one-shot bakes (slack beyond the arena) */
const CAM_MIN = -420
const CAM_MAX = 3080

const MOUNTAIN_DEPTHS = [0.1, 0.18, 0.29, 0.42] as const
const MID_DEPTH = 0.06
const CHUNK_W = 560
const N_CHUNKS = Math.ceil(ARENA_W / CHUNK_W) + 1
/** hard caps — the horizon can never grow past these, ever */
export const MAX_HORIZON_CHUNKS = N_CHUNKS
export const MAX_HORIZON_PROPS = N_CHUNKS * 8 + 12

/* -------------------------------- helpers -------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashWorld(i: number, seed = 0): number {
  let n = (Math.imul(i | 0, 1597334677) + Math.imul(seed | 0, 3812015801)) | 0
  n ^= n >>> 16
  n = Math.imul(n, 2246822507)
  n ^= n >>> 13
  return (n >>> 0) / 4294967296
}

function smoothNoise(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hashWorld(i, seed) * (1 - u) + hashWorld(i + 1, seed) * u
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas context unavailable')
  return { c, g }
}

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r)
  for (const [at, col] of stops) grad.addColorStop(at, col)
  g.fillStyle = grad
  g.beginPath()
  g.arc(x, y, r, 0, TAU)
  g.fill()
}

function poly(g: CanvasRenderingContext2D, pts: number[][]): void {
  g.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (i) g.lineTo(p[0], p[1])
    else g.moveTo(p[0], p[1])
  }
  g.closePath()
}

function snowCap(g: CanvasRenderingContext2D, pts: number[][], width = 3): void {
  g.save()
  g.strokeStyle = '#bec8ce'
  g.lineWidth = width
  g.lineJoin = 'round'
  g.lineCap = 'round'
  poly(g, pts)
  g.stroke()
  g.restore()
}

/** release a canvas for real GC (resize rebuilds) */
function discard(c: HTMLCanvasElement | null | undefined): void {
  if (!c) return
  c.width = 1
  c.height = 1
}

/* -------------------------- pure horizon planning ------------------------ */
/* Headless-safe: no document access. Tests enumerate the plan to prove the
 * horizon is fully bounded before a single pixel exists. */

export interface HorizonProp {
  type: string
  x: number // world px
  lane: number // 0..4 depth lane
  scale: number // multiplier on the lane scale
  id: string
}

export interface HorizonPlan {
  chunks: number
  props: HorizonProp[]
}

/** Deterministic, COMPLETE prop layout for the whole arena. Called once at
 *  bake time — the game never asks for a chunk it doesn't already have. */
export function planHorizon(): HorizonPlan {
  const props: HorizonProp[] = []
  const home: [string, number, number, number][] = [
    ['firewood', INN_X - 190, 3, 0.94],
    ['bucket', INN_X - 150, 3, 0.75],
    ['lantern', INN_X - 320, 2, 1],
    ['boulder', INN_X - 380, 2, 0.93],
    ['bench', INN_X + 150, 3, 1.03],
    ['barrel', INN_X + 300, 4, 0.88],
    ['crates', INN_X + 360, 4, 0.89],
    ['bamboo', INN_X + 420, 4, 0.81],
  ]
  const clear = (x: number): boolean =>
    Math.abs(x - INN_X) > 270 && Math.abs(x - RACK_X) > 110 && Math.abs(x - CHERRY_X) > 170
  const add = (type: string, x: number, lane: number, scale: number, id: string): void => {
    if (!clear(x)) return
    if (x < ARENA_X0 - 40 || x > ARENA_X1 + 40) return
    if (props.length >= MAX_HORIZON_PROPS) return
    props.push({ type, x, lane, scale, id })
  }
  // home cluster around the inn (lane 4..2 like the source's home props)
  for (const [type, x, lane, scale] of home) {
    if (props.length < MAX_HORIZON_PROPS) props.push({ type, x, lane, scale, id: 'home:' + type })
  }
  for (let ci = 0; ci < N_CHUNKS; ci++) {
    const base = ARENA_X0 + ci * CHUNK_W
    const seed = hashWorld(ci, 9)
    const pick = <T,>(arr: T[]): T => arr[Math.floor(seed * arr.length) % arr.length]
    add(pick(['firewood', 'cairn']), base + 60 + seed * 60, 3, 0.66 + seed * 0.25, ci + ':0')
    add(pick(['bucket', 'boulder']), base + 250, 3, 0.66 + hashWorld(ci, 2) * 0.22, ci + ':1')
    add(pick(['lantern', 'pine']), base + 40 + seed * 40, 2, 0.81 + hashWorld(ci, 3) * 0.42, ci + ':2')
    add('boulder', base + 20, 2, 0.76 + seed * 0.37, ci + ':3')
    add(pick(['bench', 'cairn']), base + 180 + seed * 40, 3, 0.78 + hashWorld(ci, 4) * 0.36, ci + ':4')
    add(pick(['crates', 'pine']), base + 520, 4, 0.7 + hashWorld(ci, 5) * 0.34, ci + ':5')
    add(pick(['barrel', 'bamboo', 'cairn']), base + 430, 4, 0.76 + hashWorld(ci, 7) * 0.24, ci + ':6')
    add('pine', base + 320, 1, 0.7 + hashWorld(ci, 8) * 0.3, ci + ':7')
  }
  return { chunks: N_CHUNKS, props }
}

/** mountain.html ridge profile — four coherent alpine silhouettes. */
export function ridgeHeight(x: number, k: number, relief: number): number {
  const frequency = 2.15 + k * 0.23
  const cell = Math.floor(x * frequency)
  const shared = smoothNoise(x * 1.7, 931)
  let peak = 0
  for (let i = cell - 1; i <= cell + 1; i++) {
    const cx = (i + 0.22 + hashWorld(i, 811 + k * 43) * 0.54) / frequency
    const width = (0.57 + hashWorld(i, 177 + k * 31) * 0.34) / frequency
    const a = 0.72 + hashWorld(i, 211 + k * 19) * 0.43
    const skew = 0.67 + hashWorld(i, 58 + k * 17) * 0.69
    const flank = (xx: number, center: number, span: number, height: number): number =>
      height * Math.pow(Math.max(0, 1 - Math.abs((xx - center) / (span * (xx < center ? skew : 1.6 - skew * 0.6)))), 0.92)
    peak = Math.max(peak, flank(x, cx, width, a), flank(x, cx - width * 0.43, width * 0.54, a * 0.65), flank(x, cx + width * 0.38, width * 0.54, a * 0.63))
  }
  const crag = (smoothNoise(x * 36.7 + k * 7, 338 + k * 17) - 0.5) * 0.008 + (smoothNoise(x * 91.3, 981 + k * 37) - 0.5) * 0.003
  return (
    0.559 + k * 0.046 +
    relief * ((shared - 0.5) * 0.035 - peak * (0.137 - k * 0.007) + crag * (0.25 + 0.75 * Math.min(1, peak)))
  )
}

/** stable cloud-cell descriptor (same integer hash as the source) */
function cloudRandomCPU(cell: number, family: number): [number, number, number, number] {
  let n = (Math.imul(cell | 0, 1597334677) + Math.imul(family + 31, 3812015801)) | 0
  n ^= n >>> 16
  n = Math.imul(n, 2246822507)
  n ^= n >>> 13
  return [(n & 255) / 255, ((n >>> 8) & 255) / 255, ((n >>> 16) & 255) / 255, ((n >>> 24) & 255) / 255]
}

const CLOUD_LANE = [0.135, 0.475, 0.265, 0.335] as const
const CLOUD_BAND = [0.095, 0.085, 0.155, 0.145] as const
const CLOUD_SPACING = [0.67, 0.91, 0.94, 0.7] as const
const CLOUD_ADV = [0.035, 0.012, 0.02, 0.026] as const
const CLOUD_RX = [0.19, 0.32, 0.25, 0.15] as const
const CLOUD_RY = [0.024, 0.027, 0.08, 0.048] as const

/* --------------------------- prop part geometry -------------------------- */

function propParts(type: string): number[][][] {
  switch (type) {
    case 'lantern':
      return [
        [[-0.049, 0], [0.049, 0], [0.041, -0.018], [-0.041, -0.018]],
        [[-0.017, -0.018], [0.018, -0.018], [0.014, -0.11], [-0.013, -0.11]],
        [[-0.04, -0.105], [0.04, -0.105], [0.04, -0.166], [-0.04, -0.166]],
        [[-0.063, -0.166], [-0.04, -0.184], [-0.009, -0.193], [0.009, -0.193], [0.04, -0.184], [0.063, -0.166]],
        [[-0.012, -0.193], [0.012, -0.193], [0.007, -0.212], [-0.007, -0.212]],
      ]
    case 'bench':
      return [
        [[-0.093, -0.058], [0.097, -0.058], [0.103, -0.041], [-0.099, -0.041]],
        [[-0.08, -0.041], [-0.067, -0.041], [-0.072, 0], [-0.086, 0]],
        [[0.068, -0.041], [0.082, -0.041], [0.089, 0], [0.075, 0]],
        [[-0.06, -0.025], [0.074, -0.025], [0.074, -0.019], [-0.06, -0.019]],
      ]
    case 'firewood':
      return [[[-0.064, 0], [0.065, 0], [0.061, -0.038], [0.039, -0.061], [-0.037, -0.061], [-0.062, -0.038]]]
    case 'bucket':
      return [[[-0.028, -0.052], [0.028, -0.052], [0.021, 0], [-0.022, 0]]]
    case 'barrel':
      return [[[-0.039, 0], [0.038, 0], [0.047, -0.058], [0.037, -0.113], [-0.036, -0.113], [-0.047, -0.058]]]
    case 'crates':
      return [
        [[-0.047, 0], [0.046, 0], [0.046, -0.067], [-0.047, -0.067]],
        [[0.006, -0.067], [0.061, -0.067], [0.061, -0.114], [0.006, -0.114]],
      ]
    case 'bamboo':
      return [
        [[-0.035, 0], [0.035, 0], [0.043, -0.061], [-0.043, -0.061]],
        [[-0.022, -0.059], [-0.018, -0.059], [-0.022, -0.211], [-0.026, -0.211]],
        [[-0.002, -0.06], [0.003, -0.06], [0.011, -0.238], [0.006, -0.238]],
        [[0.018, -0.06], [0.023, -0.06], [0.038, -0.188], [0.033, -0.188]],
      ]
    case 'pine':
      return [
        [[-0.008, 0], [0.009, 0], [0.006, -0.193], [-0.006, -0.193]],
        [[-0.072, -0.04], [0.068, -0.04], [0.022, -0.099], [0.054, -0.099], [0.015, -0.154], [0.036, -0.153], [0, -0.232], [-0.038, -0.153], [-0.018, -0.153], [-0.057, -0.099], [-0.025, -0.099]],
      ]
    case 'cairn':
      return [
        [[-0.058, 0], [0.054, 0], [0.063, -0.021], [0.024, -0.041], [-0.037, -0.034]],
        [[-0.039, -0.034], [0.041, -0.034], [0.034, -0.067], [-0.022, -0.075], [-0.044, -0.053]],
        [[-0.022, -0.066], [0.028, -0.066], [0.023, -0.097], [-0.015, -0.105], [-0.028, -0.086]],
      ]
    default: // boulder
      return [[[-0.047, 0], [0.047, 0], [0.06, -0.023], [0.018, -0.051], [-0.03, -0.039], [-0.061, -0.017]]]
  }
}

function paintProp(g: CanvasRenderingContext2D, type: string): void {
  const parts = propParts(type)
  g.save()
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.lineWidth = 0.0013
  for (let i = 0; i < parts.length; i++) {
    g.fillStyle =
      type === 'lantern' ? (i % 2 ? '#3c5362' : '#536b78')
      : type === 'boulder' ? '#506877'
      : type === 'pine' ? (i ? '#1b3034' : '#293037')
      : type === 'cairn' ? ['#45555e', '#52616b', '#697680'][i % 3]
      : type === 'bamboo' ? (i ? '#243d3b' : '#3e4448')
      : (i % 2 ? '#384249' : '#53606a')
    poly(g, parts[i])
    g.fill()
    g.strokeStyle = '#111e29'
    g.stroke()
    g.strokeStyle = 'rgba(180,209,220,.36)'
    g.beginPath()
    g.moveTo(parts[i][0][0], parts[i][0][1])
    g.lineTo(parts[i][1][0], parts[i][1][1])
    g.stroke()
  }
  if (type === 'pine') {
    g.strokeStyle = '#a2b5bd'
    g.lineWidth = 0.0028
    g.beginPath()
    g.moveTo(-0.028, -0.167)
    g.lineTo(0, -0.229)
    g.lineTo(0.029, -0.168)
    g.stroke()
  } else if (type === 'cairn') {
    g.strokeStyle = '#a2b5bd'
    g.lineWidth = 0.0028
    g.beginPath()
    g.moveTo(-0.021, -0.089)
    g.lineTo(0.019, -0.096)
    g.stroke()
  } else if (type === 'lantern') {
    const grad = g.createLinearGradient(-0.025, -0.154, 0.025, -0.115)
    grad.addColorStop(0, '#f9d6a0')
    grad.addColorStop(0.5, '#e9af66')
    grad.addColorStop(1, '#794e31')
    g.fillStyle = grad
    g.fillRect(-0.025, -0.154, 0.05, 0.037)
    g.fillStyle = '#26323a'
    g.fillRect(-0.002, -0.155, 0.004, 0.041)
    g.fillRect(-0.027, -0.136, 0.054, 0.003)
    snowCap(g, [[-0.06, -0.169], [-0.037, -0.184], [-0.008, -0.193], [0.013, -0.193], [0.042, -0.181]], 0.0045)
  } else if (type === 'barrel') {
    g.strokeStyle = '#83929a'
    g.lineWidth = 0.004
    for (const y of [-0.019, -0.091]) {
      g.beginPath()
      g.moveTo(-0.05, y)
      g.quadraticCurveTo(0, y + 0.006, 0.05, y)
      g.stroke()
    }
    snowCap(g, [[-0.04, -0.113], [0, -0.116], [0.024, -0.113]], 0.004)
  } else if (type === 'crates') {
    g.strokeStyle = '#87959a'
    g.lineWidth = 0.004
    g.strokeRect(-0.047, -0.067, 0.093, 0.067)
    g.strokeRect(0.006, -0.114, 0.055, 0.047)
    snowCap(g, [[0.008, -0.116], [0.06, -0.116]], 0.004)
  } else if (type === 'boulder') {
    g.fillStyle = '#728b99'
    poly(g, [[-0.047, -0.027], [-0.025, -0.039], [0.018, -0.051], [0.055, -0.025], [0.007, -0.031]])
    g.fill()
    snowCap(g, [[-0.04, -0.028], [-0.023, -0.04], [0.018, -0.051], [0.036, -0.039]], 0.005)
  } else if (type === 'bench') {
    g.fillStyle = '#7d8b92'
    g.fillRect(-0.094, -0.059, 0.192, 0.0025)
    g.fillStyle = '#161c22'
    g.fillRect(-0.029, -0.065, 0.074, 0.007)
    g.fillStyle = '#89999f'
    g.beginPath()
    g.ellipse(0.009, -0.076, 0.012, 0.011, 0, 0, TAU)
    g.fill()
  } else if (type === 'firewood') {
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 4 - j; i++) {
        const x = -0.045 + i * 0.031 + j * 0.015
        const y = -0.012 - j * 0.019
        g.fillStyle = '#303a40'
        g.beginPath()
        g.ellipse(x + 0.009, y, 0.016, 0.013, -0.1, 0, TAU)
        g.fill()
        g.fillStyle = '#a1977e'
        g.beginPath()
        g.ellipse(x, y, 0.012, 0.011, 0, 0, TAU)
        g.fill()
      }
    snowCap(g, [[-0.032, -0.058], [0.004, -0.06], [0.038, -0.055]], 0.005)
  } else if (type === 'bamboo') {
    g.fillStyle = '#0d2225'
    g.beginPath()
    g.ellipse(0, -0.06, 0.039, 0.009, 0, 0, TAU)
    g.fill()
    g.strokeStyle = '#7d9c87'
    g.lineWidth = 0.0015
    for (const [x, h] of [[-0.024, 0.205], [0.008, 0.23], [0.035, 0.18]]) {
      g.beginPath()
      g.moveTo(x, -0.067)
      g.lineTo(x + 0.003, -h)
      g.stroke()
    }
    snowCap(g, [[-0.038, -0.065], [-0.014, -0.067]], 0.003)
  } else if (type === 'bucket') {
    g.strokeStyle = '#9ba8ad'
    g.lineWidth = 0.002
    g.beginPath()
    g.arc(0, -0.052, 0.024, Math.PI, 0)
    g.stroke()
  }
  g.restore()
}

/* ================================ class ================================== */

export class ShiroganeHorizonBackground implements BackgroundRenderer {
  readonly storm: StormEngine
  onThunder: (() => void) | null = null
  /** moon disc anchor — screen space, refreshed by drawSky (render telemetry
   *  for the renderer's light rig; the COVER estimate lives in update()) */
  moonX = 0
  moonY = 0
  moonCover = 0
  /** static environment sits this many world units behind the play line */
  readonly envOffset = ENV_BACK

  /* clocks + state (update()-owned) */
  private t = 0
  private w = 1280
  private h = 720
  private q: Quality = 'medium'
  private flicker = 1
  private rackTop = 0.291
  private chSway = 0
  private readonly branches = Array.from({ length: 5 }, () => ({ x0: 0, y0: 0, x1: 0, y1: 0 }))
  /** F05 piecewise wind carrier */
  private readonly windNow = new Float32Array(4)
  private readonly windKey = new Float32Array(4)
  private windInit = false
  private windLastT = 0
  private windLastS = 1
  private windLastF = 0
  private windDispX = 0
  /* birds (update-owned state, world coords) */
  private readonly birds: {
    mode: 'perched' | 'toPerch' | 'moon'
    perch: number
    timer: number
    x: number
    y: number
    sx: number
    sy: number
    cx: number
    cy: number
    tx: number
    ty: number
    ft: number
    duration: number
    wing: number
    glide: number
    scale: number
    facing: number
    seed: number
    vx: number
    vy: number
    draw: boolean
  }[] = []
  /** meteor (spawn decided in update with a dedicated stream, drawn only) */
  private meteor = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, alpha: 0 }
  private readonly eventRng: () => number

  /* baked art (rebuild on resize; never built inside update) */
  private built = false
  private sky!: HTMLCanvasElement
  private moonSpr!: HTMLCanvasElement
  private moonHalo!: HTMLCanvasElement
  private cloudSprites: HTMLCanvasElement[] = []
  private starSprite!: HTMLCanvasElement
  private orbSprite!: HTMLCanvasElement
  private bokehSprite!: HTMLCanvasElement
  private mistSprite!: HTMLCanvasElement
  private glowWarm!: HTMLCanvasElement
  private glowCool!: HTMLCanvasElement
  private glitter!: HTMLCanvasElement
  private strips: (HTMLCanvasElement | null)[] = [null, null, null, null]
  private midStrip!: HTMLCanvasElement
  private deckPlate!: HTMLCanvasElement
  private reflectPlate!: HTMLCanvasElement
  private propsPlate!: HTMLCanvasElement
  private propsFront!: HTMLCanvasElement
  private wetPlate!: HTMLCanvasElement
  private cabin!: HTMLCanvasElement
  private rack!: HTMLCanvasElement
  private cherry!: HTMLCanvasElement
  private canopy!: HTMLCanvasElement
  private smokeSprite!: HTMLCanvasElement
  private smokeBox: { x: number; y: number; w: number; h: number } | null = null
  private lunar: HTMLCanvasElement | null = null
  private lanternXs: { x: number; s: number; y: number }[] = []
  /** plate headroom above the ground line (props tower into the sky band) */
  private plateHead = 240

  /* 1D particle fields (all analytic — zero update cost) */
  private stars = new Field1D({ count: 48, seed: 1337 })
  private snow = new Field1D({ count: 176, seed: 202611 })
  private fgMotes = new Field1D({ count: 24, seed: 2026 })
  private cherryPetals = new Field1D({ count: 18, seed: 31415 })
  private embers = new Field1D({ count: 10, seed: 4040 })
  private smokePuffs = new Field1D({ count: 15, seed: 777 })
  private meteors = new Burst1D(2)

  /** bake telemetry — tests assert it only moves in ensure()/resize() */
  readonly stats = { bakes: 0, propCount: 0, chunkCount: 0, stripPx: 0 }
  private lastCam: BgCam = { x: 1300, y: -150, zoom: 1 }

  /* -------------------------------- lifecycle ---------------------------- */

  constructor(storm = new StormEngine('medium')) {
    this.storm = storm
    this.eventRng = mulberry32(0x51a9c5)
    this.moonX = this.w * 0.66
    this.moonY = this.h * 0.215
    // five birds, like the source (3 perched on rack/cherry, 2 moon-flying)
    const mk = (mode: 'perched' | 'moon', perch: number, timer: number, x: number, y: number, scale: number, facing: number, seed: number): void => {
      this.birds.push({ mode, perch, timer, x, y, sx: x, sy: y, cx: x, cy: y - 80, tx: x + 120, ty: y - 60, ft: 0, duration: 6, wing: 0, glide: 0, scale, facing, seed, vx: 0, vy: 0, draw: false })
    }
    mk('perched', 0, 4.5, RACK_X + 40, -120, 1, 1, 1.1)
    mk('perched', 1, 10, RACK_X + 90, -80, 0.92, -1, 2.7)
    mk('perched', 2, 14.5, CHERRY_X - 60, -150, 1.04, 1, 4.2)
    mk('moon', -1, 0, RACK_X + 220, -320, 0.84, 1, 5.8)
    mk('moon', -1, 0, INN_X + 140, -360, 0.76, 1, 7.4)
  }

  setQuality(q: Quality): void {
    // draw budget only — never a re-bake (see background.ts contract)
    this.q = q
    // per-tier densities tuned against the software-canvas preview: the
    // governor drops to low quickly, and low must actually get cheaper
    this.snow.density = q === 'low' ? 0.35 : q === 'medium' ? 0.55 : q === 'ultra' ? 1 : 0.8
    this.stars.density = q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 0.9
    this.fgMotes.density = q === 'low' ? 0.3 : q === 'medium' ? 0.6 : 0.9
    this.storm.setQuality?.(q)
  }

  resize(w: number, h: number): void {
    const nw = Math.max(1, w)
    const nh = Math.max(1, h)
    if (nw === this.w && nh === this.h && this.built) return
    this.w = nw
    this.h = nh
    this.storm.resize(nw, nh)
    // plates depend on the viewport (mountain strips, deck pitch, islands):
    // drop them for real GC and rebuild once on the next draw. Resize is
    // the ONLY other bake point; play frames never bake.
    this.discardBakes()
  }

  private discardBakes(): void {
    // repaint contexts would otherwise keep pointing at discarded canvases
    this.rackCtx = null
    this.cherryCtx = null
    discard(this.sky)
    discard(this.moonSpr)
    discard(this.moonHalo)
    discard(this.starSprite)
    discard(this.orbSprite)
    discard(this.bokehSprite)
    discard(this.mistSprite)
    discard(this.glowWarm)
    discard(this.glowCool)
    discard(this.glitter)
    discard(this.midStrip)
    discard(this.deckPlate)
    discard(this.propsPlate)
    discard(this.propsFront)
    discard(this.wetPlate)
    discard(this.reflectPlate)
    discard(this.cabin)
    discard(this.rack)
    discard(this.cherry)
    discard(this.canopy)
    discard(this.smokeSprite)
    for (const s of this.strips) discard(s)
    this.cloudSprites = []
    this.strips = [null, null, null, null]
    this.lunar = null
    this.smokeBox = null
    this.built = false
  }

  lightningI(): number {
    return this.storm.intensity
  }
  lightningAz(): number {
    return this.storm.azimuthValue
  }

  /* -------------------------------- update -------------------------------- */

  update(dt: number): void {
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0
    this.t += d
    const t = this.t

    /* F05 — piecewise-constant wind strength integration (unit primitive
     * from bhst carries the 0.85 factor; continuous across strength
     * changes, telescopes to the closed form under constant strength). */
    {
      const s = this.storm.wind
      const F = windAt(t, 1)[2]
      if (!this.windInit) {
        this.windInit = true
        this.windLastT = t
        this.windLastS = s
        this.windLastF = F
        this.windDispX = s * F
      } else if (t !== this.windLastT) {
        this.windDispX += this.windLastS * (F - this.windLastF)
        this.windLastT = t
        this.windLastS = s
        this.windLastF = F
      }
      windAt(t, s, this.windNow)
      this.windNow[2] = this.windDispX
    }

    /* lantern / hearth flicker (same spectral mix as the source) */
    this.flicker = 0.95 + 0.05 * (Math.sin(t * 5.2) * 0.5 + Math.sin(t * 10.7) * 0.3 + Math.cos(t * 17.3) * 0.2)

    /* geometry breathing (consumed by the draw-time island repaints).
     * All branch coords are viewport-normalized: x in [0..1] of w, y
     * NEGATIVE above the ground line, -rackTop leaning with the sway. */
    this.rackTop = 0.291 + Math.sin(t * 0.58) * (0.0028 + 0.0018 * Math.abs(this.windNow[0]))
    this.chSway = Math.sin(t * 0.62 + 0.5) * (0.0024 + 0.0015 * Math.abs(this.windNow[0]))
    {
      const vw = Math.max(1, this.w)
      const U = Math.min(this.h * 0.98, this.w * 0.82)
      for (let i = 0; i < 5; i++) {
        const f = 0.47 + i * 0.12
        const b = this.branches[i]
        b.x0 = 0.305 + (this.rackTop - 0.305) * f
        b.y0 = -RACK_H * f
        b.x1 = b.x0 + Math.max(0.036, (0.056 - i * 0.005) * U) / vw
        b.y1 = b.y0 - 0.031 + Math.sin(t * 0.78 + i * 0.7) * 0.0018
      }
    }

    /* moonCover — analytic cloud estimate over the fixed scene moon anchor
     * (no camera needed; run on the visual clock in update, F14) */
    this.moonCover = this.estimateMoonCover(t)

    /* birds */
    this.updateBirds(d)

    /* meteor spawning — dedicated event stream, decided HERE (draw is pure) */
    if (!this.meteor.active && this.eventRng() < 0.12 * d) {
      this.meteor = {
        active: true,
        x: (0.1 + this.eventRng() * 0.48) * this.w,
        y: (0.04 + this.eventRng() * 0.2) * this.h,
        vx: (0.22 + this.eventRng() * 0.12) * this.w,
        vy: (0.05 + this.eventRng() * 0.05) * this.h,
        life: 0,
        maxLife: 0.8 + this.eventRng() * 0.3,
        alpha: 0,
      }
    }
    if (this.meteor.active) {
      this.meteor.life += d
      if (this.meteor.life >= this.meteor.maxLife) this.meteor.active = false
      else this.meteor.alpha = Math.sin((this.meteor.life / this.meteor.maxLife) * Math.PI) * 0.85
    }

    /* burst retirement (1D pool law) */
    this.meteors.sweep(t)
  }

  /** cheap deterministic cloud-density estimate at the scene moon anchor */
  private estimateMoonCover(t: number): number {
    const aspect = this.w / Math.max(1, this.h)
    const mx = 0.66
    const my = 0.215
    const wind = this.windNow[2]
    let cov = 0
    for (let f = 0; f < 4; f++) {
      const lane = CLOUD_LANE[f]
      const band = CLOUD_BAND[f]
      if (Math.abs(my - lane) > band * 1.2) continue
      const spacing = CLOUD_SPACING[f]
      const adv = CLOUD_ADV[f]
      const wx = (mx + t * 0.02) * aspect - wind * adv * 0.004
      const center = Math.floor(wx / spacing)
      for (let n = -1; n <= 1; n++) {
        const cell = center + n
        const r = cloudRandomCPU(cell, f)
        const cx = (cell + 0.16 + r[0] * 0.67) * spacing
        const rx = CLOUD_RX[f] * (0.68 + r[1] * 0.74)
        const ry = CLOUD_RY[f] * (0.65 + r[2] * 0.75)
        const dx = (wx - cx) / rx
        const dy = (my - lane) / ry
        if (Math.abs(dx) > 1.55 || Math.abs(dy) > 1.5) continue
        const v = Math.exp(-dx * dx * 1.1 - dy * dy * 1.6)
        cov = 1 - (1 - cov) * (1 - v * 0.85)
      }
    }
    return cov < 0 ? 0 : cov > 1 ? 1 : cov
  }

  /* ------------------------------- ensure -------------------------------- */

  private ensure(): void {
    if (this.built) return
    this.built = true
    this.stats.bakes++
    const w = this.w
    const h = this.h
    const U = Math.min(h * 0.98, w * 0.82)
    const relief = Math.min(1, (w * 0.98) / h)
    const r = mulberry32(4242)

    /* --- static sky: gradient + nebula + comet + far stars (one bake) --- */
    {
      const { c, g } = makeCanvas(w, h)
      const grad = g.createLinearGradient(0, 0, 0, h)
      for (const [at, col] of [
        [0, '#000104'], [0.18, '#01050d'], [0.45, '#05101c'], [0.68, '#10212e'], [0.82, '#1d303f'], [1, '#09121a'],
      ] as [number, string][]) grad.addColorStop(at, col)
      g.fillStyle = grad
      g.fillRect(0, 0, w, h)
      const sx = (x: number): number => x * w
      const sy = (y: number): number => y * h
      g.save()
      g.globalCompositeOperation = 'screen'
      const nebulae: [number, number, number, number[], number][] = [
        [0.465, 0.21, 0.18, [24, 232, 212], 0.32],
        [0.49, 0.27, 0.17, [42, 138, 255], 0.32],
        [0.535, 0.16, 0.18, [145, 96, 255], 0.34],
        [0.555, 0.22, 0.15, [55, 190, 240], 0.26],
        [0.635, 0.2, 0.12, [60, 220, 195], 0.22],
        [0.642, 0.19, 0.08, [215, 100, 225], 0.22],
        [0.398, 0.208, 0.09, [235, 118, 210], 0.3],
      ]
      for (const [nx, ny, nr0, col, na] of nebulae) {
        const nr = nr0 * U
        for (let k = 0; k < 15; k++) {
          radial(g, sx(nx) + (r() - 0.5) * nr * 1.45, sy(ny) + (r() - 0.5) * nr * 0.95, nr * (0.28 + r() * 0.65), [
            [0, `rgba(${col[0]},${col[1]},${col[2]},${(na * (0.35 + r() * 0.5)).toFixed(3)})`],
            [0.5, `rgba(${col[0]},${col[1]},${col[2]},${(na * 0.14).toFixed(3)})`],
            [1, 'rgba(0,0,0,0)'],
          ])
        }
      }
      // aurora curtains (baked): soft teal bands sweeping the upper sky —
      // the reference's signature glow, kept low-alpha so it reads as
      // atmosphere rather than a veil
      const curtains: [number, number, number, number][] = [
        [0.155, 0.04, 0.56, 0.085],
        [0.23, 0.12, 0.70, 0.062],
        [0.315, 0.0, 0.44, 0.048],
      ]
      for (const [ay, ax0, ax1, aa] of curtains) {
        for (let i = 0; i < 16; i++) {
          const f = i / 15
          const bx = sx(ax0 + (ax1 - ax0) * f)
          const by = sy(ay + Math.sin(f * 4.6 + ay * 31) * 0.022)
          g.save()
          g.translate(bx, by)
          g.scale(1, 0.20)
          radial(g, 0, 0, 0.075 * U, [
            [0, `rgba(70,224,196,${aa})`],
            [0.5, `rgba(52,186,178,${(aa * 0.42).toFixed(3)})`],
            [1, 'rgba(40,150,160,0)'],
          ])
          g.restore()
        }
      }
      const x0 = sx(0.394), y0 = sy(0.208), x1 = sx(0.455), y1 = sy(0.23)
      const cg = g.createLinearGradient(x0, y0, x1, y1)
      cg.addColorStop(0, 'rgba(255,205,245,.82)')
      cg.addColorStop(0.35, 'rgba(215,125,220,.38)')
      cg.addColorStop(1, 'rgba(80,180,195,0)')
      g.strokeStyle = cg
      g.lineWidth = Math.max(2, 0.012 * U)
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(x0, y0)
      g.quadraticCurveTo((x0 + x1) * 0.5, y0 + 0.016 * U, x1, y1)
      g.stroke()
      radial(g, x0, y0, 0.025 * U, [
        [0, 'rgba(255,250,255,.98)'], [0.35, 'rgba(248,155,230,.72)'], [1, 'rgba(200,90,190,0)'],
      ])
      for (let i = 0; i < 320; i++) {
        const x = sx(r())
        const y = sy(r() * 0.69)
        const sz = 0.4 + Math.pow(r(), 2.8) * 1.4
        const tt = r()
        g.fillStyle = tt < 0.25 ? 'rgba(185,225,255,.78)' : tt < 0.4 ? 'rgba(255,220,195,.75)' : 'rgba(255,255,255,.86)'
        g.beginPath()
        g.arc(x, y, sz, 0, TAU)
        g.fill()
      }
      g.restore()
      this.sky = c
    }

    /* --- sprites --- */
    {
      let { c, g } = makeCanvas(32, 32)
      radial(g, 16, 16, 15, [[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(205,235,255,.65)'], [1, 'rgba(180,220,255,0)']])
      this.starSprite = c
      ;({ c, g } = makeCanvas(64, 64))
      radial(g, 32, 32, 31, [[0, 'rgba(255,252,255,.96)'], [0.22, 'rgba(255,204,230,.62)'], [0.55, 'rgba(255,155,200,.16)'], [1, 'rgba(255,140,190,0)']])
      this.orbSprite = c
      ;({ c, g } = makeCanvas(96, 96))
      radial(g, 48, 48, 46, [[0, 'rgba(255,230,242,.28)'], [0.45, 'rgba(255,178,214,.14)'], [1, 'rgba(240,140,190,0)']])
      g.fillStyle = 'rgba(255,216,235,.18)'
      g.save()
      g.translate(48, 48)
      for (let i = 0; i < 5; i++) {
        g.rotate(TAU / 5)
        g.beginPath()
        g.ellipse(0, -14, 9.5, 14.5, 0, 0, TAU)
        g.fill()
      }
      g.restore()
      this.bokehSprite = c
      ;({ c, g } = makeCanvas(128, 64))
      g.save()
      g.translate(64, 32)
      g.scale(1, 0.5)
      radial(g, 0, 0, 62, [[0, 'rgba(130,165,192,.26)'], [0.55, 'rgba(95,132,162,.09)'], [1, 'rgba(70,100,125,0)']])
      g.restore()
      this.mistSprite = c
      ;({ c, g } = makeCanvas(160, 160))
      radial(g, 80, 80, 78, [[0, 'rgba(255,205,131,.34)'], [0.3, 'rgba(246,173,92,.12)'], [1, 'rgba(220,137,55,0)']])
      this.glowWarm = c
      ;({ c, g } = makeCanvas(160, 160))
      radial(g, 80, 80, 78, [[0, 'rgba(186,214,236,.3)'], [0.3, 'rgba(140,174,210,.1)'], [1, 'rgba(90,120,160,0)']])
      this.glowCool = c
      ;({ c, g } = makeCanvas(128, 128))
      radial(g, 64, 64, 63, [[0, 'rgba(255,250,255,.95)'], [0.4, 'rgba(230,240,255,.5)'], [1, 'rgba(210,228,255,0)']])
      this.glitter = c
      /* moon: halo rings + procedural lunar disc (bhst bake).
       * Sized/dimmed for the game frame: the source's disc was a
       * landscape focal point, but here it sits behind the HUD and feeds
       * the shaft/bloom passes — at 0.148·min it blew the whole sky out. */
      const moonR = Math.max(56, Math.min(140, Math.min(w, h) * 0.125))
      const haloR = moonR * 2.1
      const size = Math.ceil(haloR * 2 + 12)
      ;({ c, g } = makeCanvas(size, size))
      const cx = size * 0.5
      const halo = g.createRadialGradient(cx, cx, moonR * 0.98, cx, cx, haloR)
      for (const [at, col] of [
        [0, 'rgba(235,246,255,.26)'], [0.1, 'rgba(174,214,241,.15)'], [0.31, 'rgba(98,162,215,.07)'],
        [0.5, 'rgba(126,198,177,.046)'], [0.61, 'rgba(218,190,134,.039)'], [0.72, 'rgba(209,131,165,.025)'], [1, 'rgba(60,95,120,0)'],
      ] as [number, string][]) halo.addColorStop(at, col)
      g.fillStyle = halo
      g.beginPath()
      g.arc(cx, cx, haloR, 0, TAU)
      g.fill()
      try {
        this.lunar = buildLunarSurface(512)
        if (this.lunar) g.drawImage(this.lunar, cx - moonR, cx - moonR, moonR * 2, moonR * 2)
      } catch {
        this.lunar = null
        radial(g, cx, cx, moonR, [[0, '#e8eef2'], [0.8, '#b9c6cc'], [1, '#8d9aa2']])
      }
      this.moonHalo = c
      this.moonSpr = c // drawn as one blit (halo + disc share the bake)
      /* cloud sprite families */
      this.cloudSprites = []
      for (let f = 0; f < 4; f++)
        for (let v = 0; v < 4; v++) {
          const { c: cc, g: cg } = makeCanvas(192, 96)
          const cr = mulberry32(4981 + f * 131 + v * 19)
          const lumps = f === 0 ? 8 : f === 1 ? 13 : 19
          for (let i = 0; i < lumps; i++) {
            const x = 28 + cr() * 136
            const y = 32 + cr() * 30
            const rx = f === 0 ? 23 + cr() * 28 : f === 1 ? 22 + cr() * 17 : 15 + cr() * 22
            const ry = f === 0 ? 7 + cr() * 5 : f === 1 ? 9 + cr() * 7 : 16 + cr() * 16
            const alpha = f === 0 ? 0.2 : f === 1 ? 0.21 : f === 2 ? 0.31 : 0.23
            cg.save()
            cg.translate(x, y)
            cg.scale(1, ry / rx)
            radial(cg, 0, 0, rx, [
              [0, `rgba(137,158,176,${alpha})`],
              [0.55, `rgba(101,127,148,${alpha * 0.68})`],
              [1, 'rgba(67,94,119,0)'],
            ])
            cg.restore()
          }
          this.cloudSprites.push(cc)
        }
      /* (the renderer owns the frame vignette — a second scene-level
       * vignette was double-darkening the corners for free cost) */
    }

    /* --- mountain range strips: ONE bake each over the full camera domain
     *     (the pre-generated horizon — never rebaked during play) --- */
    {
      const pad = Math.max(64, Math.ceil(w * 0.05))
      const top = h * 0.35
      const bottom = h * 0.765
      const bandH = bottom - top
      for (let k = 0; k < 4; k++) {
        const pk = MOUNTAIN_DEPTHS[k]
        const travel = (CAM_MAX - CAM_MIN) * pk
        const stripW = Math.ceil(w + pad * 2 + travel)
        const { c, g } = makeCanvas(stripW, Math.ceil(bandH + 12))
        const u0 = (-pad + CAM_MIN * pk) / w
        const pts: number[][] = []
        for (let px = 0; px <= stripW; px += 2) {
          const u = u0 + px / w
          pts.push([px, ridgeHeight(u, k, relief) * h - top])
        }
        const gray = [62, 50, 39, 27][k]
        const grad = g.createLinearGradient(0, 0, 0, bandH)
        grad.addColorStop(0, `rgb(${gray},${gray + 8},${gray + 14})`)
        grad.addColorStop(1, `rgb(${(gray * 0.6) | 0},${(gray * 0.6 + 8) | 0},${(gray * 0.6 + 15) | 0})`)
        g.fillStyle = grad
        poly(g, [[pts[0][0], bandH + 12], ...pts, [pts[pts.length - 1][0], bandH + 12]])
        g.fill()
        g.save()
        poly(g, [[pts[0][0], bandH + 12], ...pts, [pts[pts.length - 1][0], bandH + 12]])
        g.clip()
        const snow = pts.map(([x, y]) => [
          x,
          // snowline sits ABOVE the crest base so only real peaks keep
          // caps — at the old height each range drew a flat-bottomed
          // white band and the four stacked into zebra stripes
          (0.514 + k * 0.046 - relief * 0.04 + relief * 0.03 * (smoothNoise((u0 + x / w) * 39, 439 + k * 19) - 0.5)) * h - top,
        ])
        g.fillStyle = ['#86939f', '#808f9b', '#718390', '#5e7380'][k]
        poly(g, [[pts[0][0], 0], ...snow, [pts[pts.length - 1][0], 0]])
        g.fill()
        g.strokeStyle = `rgba(8,15,23,${0.18 + k * 0.02})`
        g.lineWidth = h * 0.0016
        for (let i = 13; i < pts.length; i += 29) {
          const [x, y] = pts[i]
          g.beginPath()
          g.moveTo(x, y)
          g.bezierCurveTo(x + w * 0.025, y + h * 0.032, x - w * 0.011, y + h * 0.054, x + w * 0.047, y + h * 0.13)
          g.stroke()
        }
        g.restore()
        this.strips[k] = c
        this.stats.stripPx += stripW * Math.ceil(bandH + 12)
      }
      /* mid parallax band (snowfield shelf above the horizon) */
      const pk = MID_DEPTH
      const travel = (CAM_MAX - CAM_MIN) * pk
      const stripW = Math.ceil(w + pad * 2 + travel)
      const bandTop = h * 0.64
      const { c, g } = makeCanvas(stripW, Math.ceil(h - bandTop + 8))
      const y0 = 0.675 * h - bandTop
      const grad = g.createLinearGradient(0, y0, 0, HY_R * h - bandTop)
      grad.addColorStop(0, '#253540')
      grad.addColorStop(1, '#101e29')
      g.fillStyle = grad
      g.fillRect(0, y0, stripW, HY_R * h - bandTop - y0 + 8)
      g.strokeStyle = 'rgba(151,173,185,.13)'
      g.lineWidth = 0.8
      const mr = mulberry32(7301)
      for (let i = 0; i < 60; i++) {
        const yy = y0 + mr() * 0.06 * h
        const x = mr() * stripW
        g.beginPath()
        g.moveTo(x, yy)
        g.lineTo(x + 10 + mr() * 45, yy)
        g.stroke()
      }
      this.midStrip = c
    }

    /* --- deck plate: mountain wood + one-point perspective fan --- */
    {
      const { c, g } = makeCanvas(ARENA_W, DECK_H)
      // MOONLIT deck (target-art law: bright ground, deep shadow) — the
      // light-transport multiply darkens this ~2×, so the albedo must
      // start mid-tone or contact shadows vanish into black
      const grad = g.createLinearGradient(0, 0, 0, DECK_H)
      grad.addColorStop(0, '#5d7183')
      grad.addColorStop(0.35, '#3d4c5a')
      grad.addColorStop(1, '#1a242e')
      g.fillStyle = grad
      g.fillRect(0, 0, ARENA_W, DECK_H)
      const rr = mulberry32(0x33b8)
      // plank grain + seams (wood albedo recipe from the source)
      for (let i = 0; i < 140; i++) {
        const x = rr() * ARENA_W
        const y = rr() * DECK_H
        const len = 60 + rr() * 220
        g.strokeStyle = rr() < 0.5 ? 'rgba(6,10,14,.28)' : 'rgba(120,140,155,.05)'
        g.lineWidth = 0.8 + rr() * 1.4
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + len, y + (rr() - 0.5) * 3)
        g.stroke()
      }
      // one-point perspective fan (proven world-space technique: vanishing
      // point above the deck, seams compress toward the ground line)
      const vpx = ARENA_W * 0.6
      const vpy = -470
      const vpt = -vpy / (DECK_H - 34 - vpy)
      for (let x = -260; x < ARENA_W + 300; x += 74) {
        g.strokeStyle = 'rgba(5,9,13,.55)'
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(vpx + (x - vpx) * vpt, 0)
        g.lineTo(x, DECK_H - 34)
        g.stroke()
        g.strokeStyle = 'rgba(150,176,192,.07)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(vpx + (x + 2 - vpx) * vpt, 0)
        g.lineTo(x + 2, DECK_H - 34)
        g.stroke()
      }
      g.strokeStyle = 'rgba(5,9,13,.34)'
      g.lineWidth = 1.1
      for (const yy of [DECK_H - 34, 252, 196, 152, 118, 92, 72, 57, 46, 38, 31, 26]) {
        g.beginPath()
        g.moveTo(0, yy)
        g.lineTo(ARENA_W, yy)
        g.stroke()
      }
      // stone back lip
      const lip = g.createLinearGradient(0, 0, 0, 26)
      lip.addColorStop(0, '#1a2327')
      lip.addColorStop(1, '#0d1417')
      g.fillStyle = lip
      g.fillRect(0, 0, ARENA_W, 26)
      // contact AO band under the lip — seats figures standing at y=0
      // against the bright horizon instead of letting them float on it
      const ao = g.createLinearGradient(0, 14, 0, 96)
      ao.addColorStop(0, 'rgba(3,6,10,.32)')
      ao.addColorStop(1, 'rgba(3,6,10,0)')
      g.fillStyle = ao
      g.fillRect(0, 14, ARENA_W, 82)
      // snow dusting along the back edge (the scene is a winter night)
      g.strokeStyle = 'rgba(176,192,202,.26)'
      g.lineWidth = 2.2
      g.beginPath()
      for (let x = 0; x <= ARENA_W; x += 40) g.lineTo(x, 6 + Math.sin(x * 0.05) * 2)
      g.stroke()
      // baked moon sheen streaks
      g.globalCompositeOperation = 'screen'
      for (let i = 0; i < 40; i++) {
        const x = rr() * ARENA_W
        const y = 10 + rr() * (DECK_H - 50)
        g.fillStyle = `rgba(150,184,206,${0.03 + rr() * 0.07})`
        g.fillRect(x, y, 90 + rr() * 260, 1 + rr() * 2.2)
      }
      g.globalCompositeOperation = 'source-over'
      this.deckPlate = c
    }

    /* --- horizon props plates: the ENTIRE bounded horizon, baked once ---
     * Two plates: the BACK plate (lanes 0–2) draws with the arena, before
     * entities; the FRONT plate (lanes 3–4) draws AFTER entities via
     * drawFront(), so near dressing occludes fighters — the actor reads as
     * standing between the backdrop and the foreground. Headroom: props
     * rise above the ground line, so each plate carries `plateHead` px of
     * sky band and is blitted at world y = -plateHead. */
    {
      const plan = planHorizon()
      this.stats.propCount = plan.props.length
      this.stats.chunkCount = plan.chunks
      this.plateHead = Math.ceil(U * 0.42)
      // Lanes straddle the play line: back lanes sit between the inn and
      // the fighter, front lanes downstage of him — he is IN the dressing
      // rather than parked at the deck's end (rendered = baked − ENV_BACK)
      const laneY = [0, 35, 70, 145, 220]
      const laneZ = [-0.06, 0, 0.07, 0.16, 0.26]
      const build = (front: boolean): HTMLCanvasElement => {
        const { c, g } = makeCanvas(ARENA_W, DECK_H + this.plateHead)
        g.translate(-ARENA_X0, this.plateHead)
        // draw far lanes first within the plate (smallest y on top order)
        const sorted = plan.props
          .filter((p) => (front ? p.lane >= 3 : p.lane <= 2))
          .sort((a, b) => a.lane - b.lane)
        for (const p of sorted) {
          const z = laneZ[p.lane]
          const persp = 1 / (1 - z)
          // near lanes run slightly larger so their tops reach toward the
          // fighter plane instead of sitting isolated at the frame bottom
          const s = U * 0.62 * persp * p.scale * (front ? 1.15 : 1)
          const y = laneY[p.lane] + 6
          // wet-floor reflection: flipped, squashed copy — props read as
          // standing ON the deck instead of hovering over it
          g.save()
          g.globalAlpha = 0.13
          g.translate(p.x, y + 5)
          g.scale(s, -s * 0.34)
          paintProp(g, p.type)
          g.restore()
          // ground-contact shade
          g.save()
          g.translate(p.x, y + 2)
          g.scale(1, 0.16)
          radial(g, 0, 0, s * 0.08, [[0, 'rgba(2,7,13,.54)'], [1, 'rgba(2,7,13,0)']])
          g.restore()
          g.save()
          g.translate(p.x, y)
          g.scale(s, s)
          paintProp(g, p.type)
          g.restore()
          if (p.type === 'lantern') {
            radial(g, p.x, y - s * 0.136, s * 0.112, [
              [0, 'rgba(255,205,131,.24)'], [0.3, 'rgba(246,173,92,.09)'], [1, 'rgba(220,137,55,0)'],
            ])
            if (this.lanternXs.length < 24) this.lanternXs.push({ x: p.x, s, y })
          }
        }
        return c
      }
      this.lanternXs = []
      this.propsPlate = build(false)
      this.propsFront = build(true)
    }

    /* --- wet plate (reflection band + door column) --- */
    {
      const { c, g } = makeCanvas(ARENA_W, 170)
      const grad = g.createLinearGradient(0, 0, 0, 170)
      grad.addColorStop(0, 'rgba(120,150,175,.16)')
      grad.addColorStop(0.4, 'rgba(60,84,105,.07)')
      grad.addColorStop(1, 'rgba(20,30,42,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, ARENA_W, 170)
      const rr = mulberry32(0x3ee7)
      g.globalCompositeOperation = 'screen'
      for (let i = 0; i < 90; i++) {
        const x = rr() * ARENA_W
        const y = rr() * 160
        g.fillStyle = `rgba(170,198,220,${0.02 + rr() * 0.05})`
        g.fillRect(x, y, 30 + rr() * 120, 1 + rr() * 1.6)
      }
      g.globalCompositeOperation = 'source-over'
      this.wetPlate = c
    }

    /* --- the inn (paintHouse port, baked island) --- */
    {
      const w2 = Math.ceil(INN_W * 2.1 + 36)
      const h2 = Math.ceil(U * 0.28 + 36)
      const { c, g } = makeCanvas(w2, h2)
      const ox = w2 * 0.5
      const oy = h2 - 18
      g.save()
      g.translate(ox, oy)
      g.scale(U, U)
      this.paintHouse(g, { width: INN_W / U, wall: 0.145, roof: 0.098 })
      g.restore()
      this.cabin = c
      this.cabinAnchor = { x: INN_X, y: oy }
    }

    /* --- rack (lantern pole) + cherry tree + canopy + hearth --- */
    {
      const rackW = Math.ceil(w * 0.16 + U * 0.06)
      const rackH = Math.ceil(h * 0.36)
      const { c, g } = makeCanvas(rackW, rackH)
      this.rack = c
      this.rackAnchor = { x: RACK_X, y: 8 }
      const chW = Math.ceil(U * 0.42 + 60)
      const chH = Math.ceil(U * 0.34 + 40)
      const { c: cc, g: cg } = makeCanvas(chW, chH)
      this.cherry = cc
      this.cherryAnchor = { x: CHERRY_X, y: 8 }
      void g
      void cg
      // canopy: mountain.html's blossom CROWN —8 clustered rosette banks
      // arranged around the branch tips (dy −.155..−.222), not one low
      // disk: the blossoms crown the top of the tree and the trunk stays
      // visible below them
      const { c: can, g: cog } = makeCanvas(Math.ceil(0.32 * U), Math.ceil(0.28 * U))
      const br = mulberry32(7731)
      const palette = ['#24182a', '#382740', '#a36884', '#c283a0', '#eab4ca', '#f9d4e4', '#ffeff6', '#fff']
      const clusters: [number, number, number, number, number][] = [
        [-0.072, -0.158, 0.036, 0.025, 28],
        [-0.048, -0.195, 0.042, 0.028, 36],
        [-0.015, -0.220, 0.045, 0.028, 42],
        [0.020, -0.222, 0.044, 0.028, 40],
        [0.052, -0.198, 0.040, 0.026, 34],
        [0.070, -0.165, 0.032, 0.022, 24],
        [-0.028, -0.155, 0.034, 0.020, 22],
        [0.028, -0.158, 0.034, 0.022, 22],
      ]
      // dark blossoms paint first so the lit layers sit on top
      type Blossom = { x: number; y: number; size: number; rot: number; color: string; layer: number }
      const blossoms: Blossom[] = []
      for (const [cx, cy, rx, ry, count] of clusters) {
        for (let i = 0; i < count; i++) {
          const ang = br() * TAU
          const d = Math.sqrt(br())
          const dx = cx + Math.cos(ang) * d * rx
          const dy = cy + Math.sin(ang) * d * ry
          const bias = dx * 5.2 - dy * 3.2 + (br() - 0.5) * 0.5
          const band = bias < -0.22 ? 0 : bias < 0.25 ? 2 : bias < 0.65 ? 4 : 6
          blossoms.push({
            x: 0.16 * U + dx * U * 1.15,
            y: 0.26 * U + dy * U,
            size: (0.0055 + br() * 0.0075) * U,
            rot: br() * TAU,
            color: palette[band + (br() < 0.5 ? 0 : 1)],
            layer: bias < 0 ? 0 : bias < 0.45 ? 1 : 2,
          })
        }
      }
      blossoms.sort((a, b) => a.layer - b.layer)
      for (const b of blossoms) {
        cog.fillStyle = b.color
        cog.save()
        cog.translate(b.x, b.y)
        cog.rotate(b.rot)
        for (let k = 0; k < 5; k++) {
          cog.rotate(TAU / 5)
          cog.beginPath()
          cog.ellipse(0, -b.size * 0.55, b.size * 0.38, b.size * 0.58, 0, 0, TAU)
          cog.fill()
        }
        cog.restore()
      }
      this.canopy = can
      this.hearthAnchor = { x: INN_X + 14, y: U * 0.3 - 6 }
      // chimney smoke sprite
      const { c: sc, g: sg } = makeCanvas(48, 48)
      radial(sg, 24, 24, 23, [[0, 'rgba(158,170,178,.20)'], [0.5, 'rgba(120,138,151,.09)'], [1, 'rgba(76,95,115,0)']])
      this.smokeSprite = sc
      // flue mouth: chimney top ≈ -(0.03·U + 30) world y (house geometry)
      this.smokeBox = { x: INN_X + INN_W * 0.3, y: -(U * 0.03 + 30), w: U * 0.3, h: U * 0.3 }
    }

    /* --- puddle reflections: the wet deck mirrors the inn/rack/cherry
     * (mountain.html's reflection atlas) — baked once into their OWN
     * plate so drawArena can shear it per row into crossing waves every
     * frame (the reference's rippling water), at zero bake cost. The
     * sway islands are painted once here for the mirror; drawArena keeps
     * repainting them live every frame anyway. --- */
    {
      const reflH = Math.ceil(U * 0.30)
      const { c: rc, g: dg } = makeCanvas(ARENA_W, reflH)
      // rest-pose paint of the two scratch islands
      const rw = this.rack.width
      const rh = this.rack.height
      const rg = this.rack.getContext('2d')
      if (rg && rw > 1) {
        rg.setTransform(1, 0, 0, 1, 0, 0)
        rg.clearRect(0, 0, rw, rh)
        rg.save()
        rg.translate(rw * 0.5, rh)
        this.paintRack(rg)
        rg.restore()
      }
      const cw = this.cherry.width
      const ch = this.cherry.height
      const cg = this.cherry.getContext('2d')
      if (cg && cw > 1) {
        cg.setTransform(1, 0, 0, 1, 0, 0)
        cg.clearRect(0, 0, cw, ch)
        cg.save()
        cg.translate(cw * 0.5, ch)
        this.paintCherryWood(cg)
        cg.restore()
      }
      // mirror about the structures' contact line, foreshortened the way
      // a shallow wet floor compresses a reflected silhouette
      dg.save()
      dg.globalAlpha = 0.30
      dg.translate(0, 3)
      dg.scale(1, -0.52)
      if (this.cabin && this.cabin.width > 1) {
        dg.drawImage(this.cabin, INN_X - ARENA_X0 - this.cabin.width * 0.5, -this.cabinAnchor.y)
      }
      if (rw > 1) {
        dg.drawImage(this.rack, RACK_X - ARENA_X0 - rw * 0.5, this.rackAnchor.y - rh)
      }
      if (cw > 1) {
        dg.drawImage(this.cherry, CHERRY_X - ARENA_X0 - cw * 0.5, this.cherryAnchor.y - ch)
        dg.drawImage(
          this.canopy,
          CHERRY_X - ARENA_X0 - 0.16 * U * CHERRY_SCALE,
          this.cherryAnchor.y - U * 0.26 * CHERRY_SCALE,
          0.32 * U * CHERRY_SCALE,
          0.28 * U * CHERRY_SCALE,
        )
      }
      dg.restore()
      // warm door reflection column (waves with the puddle)
      const dgx = INN_X - ARENA_X0 + 24
      const dgr = dg.createLinearGradient(0, 6, 0, 156)
      dgr.addColorStop(0, 'rgba(255,150,80,.32)')
      dgr.addColorStop(0.55, 'rgba(255,130,60,.13)')
      dgr.addColorStop(1, 'rgba(255,120,50,0)')
      dg.fillStyle = dgr
      dg.fillRect(dgx - 46, 6, 92, 150)
      this.reflectPlate = rc
    }

    this.applyQualityToFields()
  }

  private cabinAnchor = { x: INN_X, y: 0 }
  private rackAnchor = { x: RACK_X, y: 0 }
  private cherryAnchor = { x: CHERRY_X, y: 0 }
  private hearthAnchor = { x: INN_X, y: 0 }

  private applyQualityToFields(): void {
    this.setQuality(this.q)
  }

  /* -------------------------- inn painting (port) ------------------------- */

  private paintHouse(
    g: CanvasRenderingContext2D,
    b: { width: number; wall: number; roof: number },
  ): void {
    const w = b.width
    const h = b.wall
    const r = b.roof
    // ground-contact shade
    let grad = g.createRadialGradient(0, 0, w * 0.15, 0, 0, w * 0.66)
    grad.addColorStop(0, 'rgba(0,2,5,.75)')
    grad.addColorStop(1, 'rgba(0,2,5,0)')
    g.save()
    g.scale(1, 0.16)
    g.fillStyle = grad
    g.fillRect(-w * 0.72, -w * 0.7, w * 1.44, w * 1.4)
    g.restore()
    // plinth + steps
    g.fillStyle = '#293843'
    g.fillRect(-w * 0.52, -0.01, w * 1.14, 0.019)
    // plinth joint notches (mountain.html drawHouse — weathered stone)
    const pr = mulberry32(9137)
    g.strokeStyle = '#071018'
    g.lineWidth = 0.0018
    for (let i = 0; i < 9; i++) {
      const nx = -w * 0.5 + i * w * 0.125
      g.beginPath()
      g.moveTo(nx, -0.01 + pr() * 0.001)
      g.lineTo(nx + 0.006, 0.001 + pr() * 0.006)
      g.stroke()
    }
    for (let i = 3; i >= 0; i--) {
      const sw = w * (0.18 + i * 0.028)
      const y = 0.003 + i * 0.0035
      g.fillStyle = i % 2 ? '#52616a' : '#34434d'
      g.fillRect(-sw * 0.5, y, sw, 0.004)
      // lit tread edge (mountain.html front steps)
      g.strokeStyle = 'rgba(165,196,211,.34)'
      g.lineWidth = 0.0008
      g.beginPath()
      g.moveTo(-sw * 0.5 + 0.004, y + 0.0005)
      g.lineTo(sw * 0.5 - 0.004, y + 0.0005)
      g.stroke()
    }
    // walls
    grad = g.createLinearGradient(-w * 0.5, -h, w * 0.6, 0)
    grad.addColorStop(0, '#61717a')
    grad.addColorStop(0.45, '#3d515e')
    grad.addColorStop(1, '#182b39')
    g.fillStyle = grad
    poly(g, [
      [-w * 0.5, 0], [w * 0.5, 0], [w * 0.5, -h], [w * 0.035, -h - r * 0.965], [-w * 0.5, -h],
    ])
    g.fill()
    g.fillStyle = '#152331'
    poly(g, [[w * 0.5, 0], [w * 0.61, -0.013], [w * 0.61, -h - 0.009], [w * 0.5, -h]])
    g.fill()
    // timber framing
    g.strokeStyle = 'rgba(4,12,19,.78)'
    g.lineWidth = 0.0045
    for (const xx of [-0.5, -0.13, 0.14, 0.5]) {
      g.beginPath()
      g.moveTo(w * xx, 0)
      g.lineTo(w * xx, -h)
      g.stroke()
    }
    g.beginPath()
    g.moveTo(-w * 0.5, -h * 0.86)
    g.lineTo(w * 0.5, -h * 0.86)
    g.stroke()
    g.beginPath()
    g.moveTo(-w * 0.5, -h * 0.2)
    g.lineTo(w * 0.5, -h * 0.2)
    g.stroke()
    // wall grain rows (mountain.html — weathered horizontal siding)
    const gr = mulberry32(17000)
    g.strokeStyle = 'rgba(8,19,29,.58)'
    g.lineWidth = 0.0010
    for (let row = 0; row < 11; row++) {
      const gy = -h * 0.19 + row * h * 0.019
      g.beginPath()
      g.moveTo(-w * 0.49, gy)
      g.lineTo(w * 0.49, gy + (gr() - 0.5) * 0.001)
      g.stroke()
    }
    // windows
    for (const [x, y, ww, hh] of [[-w * 0.32, -h * 0.7, w * 0.16, h * 0.39], [w * 0.2, -h * 0.7, w * 0.17, h * 0.39]] as number[][]) {
      g.fillStyle = '#0a0e14'
      g.fillRect(x - 0.004, y - 0.004, ww + 0.008, hh + 0.008)
      grad = g.createLinearGradient(x, y, x + ww, y + hh)
      grad.addColorStop(0, '#fff0b4')
      grad.addColorStop(0.35, '#dcaa64')
      grad.addColorStop(1, '#8d522f')
      g.fillStyle = grad
      g.fillRect(x, y, ww, hh)
      g.fillStyle = '#14232b'
      for (let k = 1; k < 4; k++) g.fillRect(x + (ww * k) / 4 - 0.0008, y, 0.0016, hh)
      g.fillRect(x, y + hh * 0.48, ww, 0.0017)
      // slatted shutters + sill (mountain.html houseWindows)
      g.fillStyle = '#17232c'
      g.fillRect(x - ww * 0.29, y - 0.002, ww * 0.24, hh + 0.004)
      g.fillRect(x + ww + 0.003, y - 0.002, ww * 0.24, hh + 0.004)
      g.strokeStyle = 'rgba(130,156,164,.35)'
      g.lineWidth = 0.0008
      for (let k = 1; k < 6; k++) {
        const ly = y + hh * (k / 6)
        g.beginPath()
        g.moveTo(x - ww * 0.27, ly)
        g.lineTo(x - 0.003, ly)
        g.moveTo(x + ww + 0.005, ly)
        g.lineTo(x + ww * 1.23, ly)
        g.stroke()
      }
      g.fillStyle = '#6d6048'
      g.fillRect(x - 0.005, y + hh, ww + 0.010, 0.0025)
    }
    // roof
    grad = g.createLinearGradient(-w * 0.55, -h - r, w * 0.56, -h + 0.02)
    grad.addColorStop(0, '#122331')
    grad.addColorStop(0.44, '#263f52')
    grad.addColorStop(1, '#648396')
    g.fillStyle = grad
    poly(g, [
      [-w * 0.69, -h + 0.01], [-w * 0.53, -h - 0.005], [-w * 0.12, -h - r * 0.96],
      [w * 0.035, -h - r * 1.05], [w * 0.18, -h - r * 0.91], [w * 0.7, -h + 0.01],
      [w * 0.58, -h + 0.014], [w * 0.04, -h - r * 0.12], [-w * 0.56, -h + 0.015],
    ])
    g.fill()
    g.save()
    poly(g, [
      [-w * 0.69, -h + 0.01], [-w * 0.53, -h - 0.005], [-w * 0.12, -h - r * 0.96],
      [w * 0.035, -h - r * 1.05], [w * 0.18, -h - r * 0.91], [w * 0.7, -h + 0.01],
      [w * 0.58, -h + 0.014], [w * 0.04, -h - r * 0.12], [-w * 0.56, -h + 0.015],
    ])
    g.clip()
    for (let row = 1; row <= 9; row++) {
      const f = row / 9
      const y = -h - r * 1.03 + f * (r * 1.05)
      const left = -w * 0.57 * f
      const right = w * 0.64 * f
      g.strokeStyle = 'rgba(1,9,17,.85)'
      g.lineWidth = 0.0021
      g.beginPath()
      g.moveTo(left, y + 0.0015)
      g.quadraticCurveTo(0, y - 0.003, right, y + 0.0015)
      g.stroke()
      g.strokeStyle = 'rgba(169,205,222,.31)'
      g.lineWidth = 0.0008
      g.beginPath()
      g.moveTo(left, y - 0.0004)
      g.quadraticCurveTo(0, y - 0.004, right, y - 0.0004)
      g.stroke()
      // offset tile channels between the rows
      const n = 4 + row * 2
      for (let k = 0; k < n; k++) {
        const xx = left + ((right - left) * (k + 0.5)) / n
        g.strokeStyle = k % 3 ? 'rgba(5,15,24,.55)' : 'rgba(172,204,217,.29)'
        g.lineWidth = 0.0009
        g.beginPath()
        g.moveTo(xx, y - 0.009)
        g.quadraticCurveTo(xx + 0.002, y - 0.004, xx + 0.004, y)
        g.stroke()
      }
    }
    g.restore()
    g.strokeStyle = '#101d29'
    g.lineWidth = 0.006
    poly(g, [
      [-w * 0.69, -h + 0.01], [-w * 0.53, -h - 0.005], [-w * 0.12, -h - r * 0.96],
      [w * 0.035, -h - r * 1.05], [w * 0.18, -h - r * 0.91], [w * 0.7, -h + 0.01],
      [w * 0.58, -h + 0.014], [w * 0.04, -h - r * 0.12], [-w * 0.56, -h + 0.015],
    ])
    g.stroke()
    g.strokeStyle = 'rgba(180,215,232,.65)'
    g.lineWidth = 0.0016
    g.beginPath()
    g.moveTo(w * 0.035, -h - r * 1.05)
    g.lineTo(w * 0.18, -h - r * 0.91)
    g.lineTo(w * 0.7, -h + 0.01)
    g.stroke()
    // gable timber + barred loft vent (mountain.html — closes the
    // mountain-through-roof gap with structure instead of bare trim)
    g.strokeStyle = '#172a36'
    g.lineWidth = 0.0033
    g.beginPath()
    g.moveTo(w * 0.035, -h - r * 0.87)
    g.lineTo(w * 0.035, -h + 0.003)
    g.moveTo(-w * 0.40, -h)
    g.lineTo(w * 0.035, -h - r * 0.70)
    g.lineTo(w * 0.43, -h)
    g.stroke()
    g.fillStyle = '#142632'
    g.fillRect(-w * 0.047, -h - r * 0.38, w * 0.17, r * 0.16)
    g.fillStyle = '#b6aa7a'
    for (let k = 0; k < 5; k++) g.fillRect(-w * 0.034 + k * w * 0.032, -h - r * 0.36, w * 0.013, r * 0.12)
    // snow on the ridge
    snowCap(g, [
      [-w * 0.65, -h + 0.007], [-w * 0.51, -h - 0.01], [-w * 0.13, -h - r * 0.97],
      [w * 0.035, -h - r * 1.057], [w * 0.18, -h - r * 0.925], [w * 0.67, -h + 0.004],
    ], 0.0034)
    // irregular cool snow on the upper eaves (without burying the tiles)
    g.fillStyle = 'rgba(178,205,216,.40)'
    for (let k = 0; k < 6; k++) {
      const ex = -w * 0.41 + k * w * 0.163
      g.beginPath()
      g.ellipse(ex, -h + 0.012, w * 0.030, 0.0016, 0, 0, TAU)
      g.fill()
    }
    // ridge caps + deep brackets under the eaves
    g.strokeStyle = '#86a4b4'
    g.lineWidth = 0.0038
    g.beginPath()
    g.moveTo(-w * 0.13, -h - r * 0.97)
    g.lineTo(w * 0.035, -h - r * 1.05)
    g.lineTo(w * 0.18, -h - r * 0.92)
    g.stroke()
    g.strokeStyle = '#0b1721'
    g.lineWidth = 0.003
    for (let k = 0; k < 6; k++) {
      const bx = -w * 0.44 + k * w * 0.174
      g.beginPath()
      g.moveTo(bx, -h + 0.008)
      g.lineTo(bx + 0.008, -h + 0.019)
      g.lineTo(bx + 0.016, -h + 0.008)
      g.stroke()
    }
    // chimney: brick courses, flue bands and a snow cap on top
    const top = -h - r * 0.85 - 0.03
    const chimPath: [number, number][] = [
      [w * 0.236, -h - r * 0.38], [w * 0.366, -h - r * 0.4], [w * 0.35, -h - r * 0.53],
      [w * 0.336, top + 0.01], [w * 0.27, top + 0.01], [w * 0.252, -h - r * 0.54],
    ]
    grad = g.createLinearGradient(w * 0.24, 0, w * 0.36, 0)
    grad.addColorStop(0, '#29353e')
    grad.addColorStop(0.62, '#54616a')
    grad.addColorStop(1, '#75838a')
    g.fillStyle = grad
    poly(g, chimPath)
    g.fill()
    g.save()
    poly(g, chimPath)
    g.clip()
    g.lineWidth = 0.0011
    g.strokeStyle = '#1c2933'
    for (let row = 0; row < 8; row++) {
      const by = top + 0.014 + row * 0.007
      g.beginPath()
      g.moveTo(w * 0.24, by)
      g.lineTo(w * 0.37, by)
      g.stroke()
      for (let j = 0; j < 3; j++) {
        const bx = w * (0.245 + j * 0.045 + (row % 2) * 0.022)
        g.beginPath()
        g.moveTo(bx, by)
        g.lineTo(bx, by + 0.007)
        g.stroke()
      }
    }
    g.restore()
    g.strokeStyle = '#13232e'
    g.lineWidth = 0.002
    poly(g, chimPath)
    g.stroke()
    g.fillStyle = '#1b2a35'
    poly(g, [[w * 0.23, -h - r * 0.4], [w * 0.37, -h - r * 0.42], [w * 0.37, -h - r * 0.47], [w * 0.25, -h - r * 0.5]])
    g.fill()
    g.fillStyle = '#08131c'
    g.beginPath()
    g.ellipse(w * 0.302, top + 0.011, w * 0.045, 0.003, 0, 0, TAU)
    g.fill()
    snowCap(g, [
      [w * 0.240, top - 0.001], [w * 0.263, top - 0.011],
      [w * 0.345, top - 0.011], [w * 0.365, top - 0.001],
    ], 0.0028)
    // hanging lantern by the door
    g.strokeStyle = '#121e28'
    g.lineWidth = 0.0022
    g.beginPath()
    g.moveTo(w * 0.53, -h * 0.88)
    g.lineTo(w * 0.63, -h * 0.77)
    g.lineTo(w * 0.61, -h * 0.58)
    g.stroke()
    g.fillStyle = '#d6ab65'
    g.beginPath()
    g.ellipse(w * 0.61, -h * 0.51, w * 0.023, h * 0.075, 0, 0, TAU)
    g.fill()
    // hanging sign board (baked detail, not regenerated per frame)
    g.fillStyle = '#1c2528'
    g.fillRect(w * 0.58, -h * 0.60, w * 0.06, h * 0.025)
    g.fillRect(w * 0.58, -h * 0.44, w * 0.06, h * 0.020)
    // rain gutter down the left eave
    g.fillStyle = '#6b5b3e'
    g.fillRect(-w * 0.57, -h * 0.71, w * 0.05, h * 0.39)
    g.strokeStyle = '#242b29'
    g.lineWidth = 0.0012
    for (let k = 0; k < 3; k++) {
      const gy = -h * 0.65 + k * h * 0.09
      g.beginPath()
      g.moveTo(-w * 0.561, gy)
      g.lineTo(-w * 0.533, gy + 0.004)
      g.moveTo(-w * 0.552, gy - 0.004)
      g.lineTo(-w * 0.548, gy + 0.008)
      g.stroke()
    }
    // door (dark; the hearth glow plate paints the warm interior live)
    g.fillStyle = '#080e15'
    g.fillRect(-w * 0.1, -h * 0.78, w * 0.2, h * 0.78)
  }

  /* -------------------------------- birds --------------------------------- */

  private perchPoints(): { x: number; y: number }[] {
    // six perches on rack branches + cherry limbs (world coords)
    const U = Math.min(this.h * 0.98, this.w * 0.82)
    const rb = this.rackAnchor
    const cb = this.cherryAnchor
    return [
      { x: rb.x - 26, y: rb.y - U * 0.21 },
      { x: rb.x + 18, y: rb.y - U * 0.24 },
      { x: rb.x + 58, y: rb.y - U * 0.22 },
      { x: rb.x + 92, y: rb.y - U * 0.19 },
      { x: cb.x - 40, y: cb.y - U * 0.2 },
      { x: cb.x + 46, y: cb.y - U * 0.17 },
    ]
  }

  private choosePerch(except = -1): number {
    const perches = this.perchPoints()
    let count = 0
    let chosen = -1
    for (let i = 0; i < perches.length; i++) {
      if (i === except) continue
      let free = true
      for (const b of this.birds) if (b.perch === i) { free = false; break }
      if (free && this.eventRng() < 1 / ++count) chosen = i
    }
    return chosen
  }

  private updateBirds(dt: number): void {
    if (dt <= 0) return
    const perches = this.perchPoints()
    for (const b of this.birds) {
      if (b.mode === 'perched') {
        const p = perches[b.perch] ?? { x: b.x, y: b.y }
        b.x = p.x
        b.y = p.y
        b.timer -= dt
        if (b.timer <= 0) {
          const old = b.perch
          b.perch = -1
          b.sx = b.x
          b.sy = b.y
          b.ft = 0
          if (this.eventRng() < 0.55) {
            b.mode = 'moon'
            b.tx = b.sx < this.moonWorldX ? this.moonWorldX + 420 : this.moonWorldX - 420
            b.ty = this.moonWorldY + (this.eventRng() - 0.5) * 90
            b.cx = this.moonWorldX + (this.eventRng() - 0.5) * 60
            b.cy = this.moonWorldY + (this.eventRng() - 0.5) * 60
            b.duration = 8.5 + this.eventRng() * 4.5
          } else {
            const next = this.choosePerch(old)
            b.perch = next < 0 ? old : next
            b.mode = 'toPerch'
            b.cx = (b.sx + perches[b.perch].x) * 0.5 + (this.eventRng() - 0.5) * 120
            b.cy = Math.min(b.sy, perches[b.perch].y) - 70 - this.eventRng() * 50
            b.duration = 4.5 + this.eventRng() * 2.5
          }
        }
      } else {
        b.ft += dt / b.duration
        const f = Math.min(1, b.ft)
        const a = 1 - f
        const target = b.mode === 'toPerch' ? perches[b.perch] ?? { x: b.tx, y: b.ty } : { x: b.tx, y: b.ty }
        const x = a * a * b.sx + 2 * a * f * b.cx + f * f * target.x
        const y = a * a * b.sy + 2 * a * f * b.cy + f * f * target.y
        b.vx = x - b.x
        b.vy = y - b.y
        b.x = x
        b.y = y
        b.facing = b.vx >= 0 ? 1 : -1
        b.glide -= dt
        if (b.glide < -1.8) b.glide = 0.9 + this.eventRng() * 1.4
        b.wing += dt * (b.mode === 'toPerch' && f > 0.78 ? 16 : b.glide > 0 ? 1.5 : 10.5)
        if (b.ft >= 1) {
          if (b.mode === 'toPerch') {
            b.mode = 'perched'
            b.timer = 7 + this.eventRng() * 11
          } else {
            const next = this.choosePerch()
            if (next >= 0 && this.eventRng() < 0.65) {
              b.perch = next
              b.mode = 'toPerch'
              b.ft = 0
              b.sx = this.eventRng() < 0.5 ? this.moonWorldX - 500 : this.moonWorldX + 500
              b.sy = -120 - this.eventRng() * 160
              b.cx = (b.sx + perches[next].x) * 0.5
              b.cy = Math.min(b.sy, perches[next].y) - 80
              b.duration = 5.5 + this.eventRng() * 2.5
            } else {
              b.mode = 'moon'
              b.ft = 0
              const left = this.eventRng() < 0.55
              b.sx = left ? this.moonWorldX - 520 : this.moonWorldX + 520
              b.tx = left ? this.moonWorldX + 520 : this.moonWorldX - 520
              b.sy = this.moonWorldY + (this.eventRng() - 0.5) * 140
              b.ty = this.moonWorldY + (this.eventRng() - 0.5) * 120
              b.cx = this.moonWorldX + (this.eventRng() - 0.5) * 50
              b.cy = this.moonWorldY + (this.eventRng() - 0.5) * 50
              b.duration = 10 + this.eventRng() * 5
            }
            b.x = b.sx
            b.y = b.sy
          }
        }
      }
    }
  }

  /* moon anchor for bird flights — refreshed by drawSky (render telemetry) */
  private moonWorldX = 2400
  private moonWorldY = -420

  /* ------------------------------- drawSky -------------------------------- */

  drawSky(ctx: CanvasRenderingContext2D, cam: BgCam): void {
    this.ensure()
    this.lastCam = cam
    const w = this.w
    const h = this.h
    const t = this.t
    const zoom = Number.isFinite(cam.zoom) && cam.zoom > 0 ? cam.zoom : 1
    const camX = Number.isFinite(cam.x) ? cam.x : 1300
    const camY = Number.isFinite(cam.y) ? cam.y : -150

    /* horizon line: screen y of world y=0 (keeps HY ≈ .71–.74 framing) */
    const hy = h * 0.5 - camY * zoom
    /* the ground composition (ranges, shelf, mist) rides the same
     * ENV_BACK shift as the arena pass so the scene stays rigid */
    const envShift = ENV_BACK * zoom

    /* moon screen anchor (render telemetry for the light rig) — seated in
     * the baked nebula/aurora glow like the reference composition */
    const mx = w * 0.66 - camX * 0.015
    const my = h * 0.215 - (camY + 150) * 0.04
    this.moonX = mx
    this.moonY = my
    this.moonWorldX = camX + (mx - w * 0.5) / zoom
    this.moonWorldY = camY + (my - h * 0.5) / zoom

    ctx.save()
    /* PARALLAX COMPOSITE — every layer is a pre-generated plate baked in
     * ensure(); each frame only evaluates closed-form positions and blits
     * (source-rect crops for the full-camera-domain strips). No re-render,
     * no cache invalidation, no quantized update clock: parallax is
     * sub-pixel smooth at ANY frame rate and the raster cost is a fixed
     * set of blits. (The earlier coherence-gated vault re-rendered whole
     * frames on a 0.22s clock — choppy at high fps and MORE expensive on
     * its dirty frames — so it was deleted.) */
    /* 1 — static sky plate (gradient + nebula + comet + far stars) */
    ctx.drawImage(this.sky, 0, 0, w, h)

    /* 2 — star twinkle + meteor (1D fields; positions closed-form) */
    if (getParticleLevel() > 0) {
      const nStars = this.stars.activeCount()
      for (let i = 0; i < nStars; i++) {
        const sx = ((this.stars.a[i] * w + t * 0.6 - camX * 0.03) % (w + 8) + (w + 8)) % (w + 8)
        const sy = 4 + this.stars.b[i] * h * 0.66
        const tw = 0.32 + 0.3 * Math.sin(t * (0.7 + (i % 3) * 0.23) + i * 2.1)
        const sz = 1 + (i % 5 === 0 ? 1.4 : 0.5)
        ctx.globalAlpha = tw * 0.62
        const d = sz * 4
        ctx.drawImage(this.starSprite, sx - d * 0.5, sy - d * 0.5, d, d)
      }
      ctx.globalAlpha = 1
      if (this.meteor.active) {
        const m = this.meteor
        const len = Math.hypot(m.vx, m.vy) || 1
        const tail = Math.sin((m.life / m.maxLife) * Math.PI) * 0.08 * Math.min(w, h)
        const ex = m.x + m.vx * m.life - (m.vx / len) * tail
        const ey = m.y + m.vy * m.life - (m.vy / len) * tail
        const grad = ctx.createLinearGradient(m.x + m.vx * m.life, m.y + m.vy * m.life, ex, ey)
        grad.addColorStop(0, `rgba(255,250,255,${m.alpha})`)
        grad.addColorStop(1, 'rgba(135,215,255,0)')
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(m.x + m.vx * m.life, m.y + m.vy * m.life)
        ctx.lineTo(ex, ey)
        ctx.stroke()
      }
    }

    /* 3 — the moon (baked halo + lunar disc, one blit) */
    const moonSize = this.moonHalo.width
    ctx.drawImage(this.moonHalo, mx - moonSize * 0.5, my - moonSize * 0.5)

    /* 4 — cloud families (deterministic cells, wind drift, cam parallax) */
    this.drawClouds(ctx, camX, camY, t, mx, my)

    /* 5 — four mountain range strips (pre-generated over the full camera
     *     domain — this frame only translates them). Cropped source-rect
     *     blits: the strips bake ~2400px of camera domain but only the
     *     visible window is rasterized. */
    const blitCropped = (img: HTMLCanvasElement, dx: number, dy: number): void => {
      const sx0 = Math.max(0, Math.ceil(-dx))
      const sx1 = Math.min(img.width, Math.floor(w - dx))
      if (sx1 <= sx0) return
      ctx.drawImage(img, sx0, 0, sx1 - sx0, img.height, dx + sx0, dy, sx1 - sx0, img.height)
    }
    for (let k = 0; k < 4; k++) {
      const strip = this.strips[k]
      if (!strip) continue
      const pk = MOUNTAIN_DEPTHS[k]
      const pad = Math.max(64, Math.ceil(w * 0.05))
      const dx = -pad + CAM_MIN * pk - camX * pk
      const dy = hy - 0.39 * h - (camY + 150) * pk * 0.22 - envShift
      blitCropped(strip, dx, dy)
    }

    /* 6 — mid shelf band: the strip's CONTENT bottom is anchored to the
     *     deck edge (was anchored to the strip's canvas bottom, which
     *     floated the band 0.26h too high — it cut across the range
     *     faces and capped the sakura canopy). */
    {
      const pad = Math.max(64, Math.ceil(w * 0.05))
      const dx = -pad + CAM_MIN * MID_DEPTH - camX * MID_DEPTH
      const bandTop = h * 0.64
      const dy = hy - envShift - (HY_R * h - bandTop) - (camY + 150) * MID_DEPTH * 0.2
      blitCropped(this.midStrip, dx, dy)
    }

    /* 7 — the storm (rain clouds/bolts over the ranges) */
    this.storm.drawSky(ctx)

    /* 8 — drifting mist banks: anchored to the horizon (hy), not the raw
     *     screen — previously they stayed put while the camera swung and
     *     floated up into the sky above the trees. */
    {
      const wind = this.windNow[2]
      ctx.globalAlpha = 0.10 + 0.035 * Math.sin(t * 0.11)
      for (let i = 0; i < 7; i++) {
        const seed = hashWorld(i, 5522)
        const bx = (i / 7 + t * (0.003 + seed * 0.005) + wind * 0.0004) % 1.3
        const x = (((bx + 0.15) % 1.3) + 1.3) % 1.3 - 0.15
        const yy = hy - envShift + h * 0.052 * (seed - 1)
        const rx = (0.11 + hashWorld(i, 77) * 0.14) * w
        const ry = (0.03 + hashWorld(i, 99) * 0.038) * h
        if (x + rx < -40 || x - rx > w + 40) continue
        ctx.drawImage(this.mistSprite, (x * w) - rx, yy - ry, rx * 2, ry * 2)
      }
      ctx.globalAlpha = 1
    }

    ctx.restore()
  }

  private drawClouds(ctx: CanvasRenderingContext2D, camX: number, camY: number, t: number, mx: number, my: number): void {
    const w = this.w
    const h = this.h
    const aspect = w / Math.max(1, h)
    const phase = (camX / Math.max(1, w)) * 0.035
    const wind = this.windNow[2]
    for (let f = 0; f < 4; f++) {
      const lane = CLOUD_LANE[f]
      const band = CLOUD_BAND[f]
      const spacing = CLOUD_SPACING[f]
      const adv = CLOUD_ADV[f]
      const wx0 = phase * aspect - wind * adv * 0.004
      const lo = Math.floor(wx0 / spacing) - 1
      const hi = Math.ceil((wx0 + aspect) / spacing) + 1
      for (let i = lo; i <= hi; i++) {
        const r = cloudRandomCPU(i, f)
        const cx = (i + 0.16 + r[0] * 0.67) * spacing
        const rx = CLOUD_RX[f] * (0.68 + r[1] * 0.74)
        const ry = CLOUD_RY[f] * (0.65 + r[2] * 0.75)
        const cy = lane + (r[3] - 0.5) * band * 0.75 + Math.sin(t * 0.041 + r[0] * 6.28) * 0.004
        const x = ((cx + wind * adv * 0.004) / aspect - phase) * w - camX * 0.012
        const y = cy * h - camY * 0.02
        if (x + rx * 1.55 * w < -60 || x - rx * 1.55 * w > w + 60) continue
        const near = Math.abs(x - mx) < w * 0.5 && Math.abs(y - my) < h * 0.4
        ctx.globalAlpha = f === 2 ? 0.55 : 0.42
        const dw = rx * w * 3.1
        const dh = ry * h * 3
        ctx.drawImage(this.cloudSprites[f * 4 + ((i % 4) + 4) % 4], x - dw * 0.5, y - dh * 0.5, dw, dh)
        if (near && this.q !== 'low') {
          ctx.globalAlpha = 0.06 + 0.10 * (1 - this.moonCover)
          ctx.globalCompositeOperation = 'lighter'
          ctx.drawImage(this.cloudSprites[f * 4 + ((i % 4) + 4) % 4], x - dw * 0.5, y - dh * 0.5, dw, dh)
          ctx.globalCompositeOperation = 'source-over'
        }
      }
    }
    ctx.globalAlpha = 1
  }

  /* ------------------------------- drawArena ------------------------------ */

  drawArena(ctx: CanvasRenderingContext2D): void {
    this.ensure()
    const t = this.t
    const cam = this.lastCam
    const zoom = cam.zoom > 0 ? cam.zoom : 1
    const viewL = cam.x - (this.w / zoom) * 0.6
    const viewR = cam.x + (this.w / zoom) * 0.6

    // Everything static lives ENV_BACK behind the play line: the fighter
    // (drawn by the entity pass at world y=0) stands mid-deck with the
    // inn/trees at the back edge, as in mountain.html. save/restore is
    // REQUIRED: without it this translate leaked into the rest of the
    // world pass and dragged the entities, fog, FX and front plate along,
    // gluing the fighter to the back edge instead of mid-road.
    ctx.save()
    ctx.translate(0, -ENV_BACK)

    /* deck plate (world-space, pre-generated) */
    this.blit(ctx, this.deckPlate, ARENA_X0, 0, viewL, viewR)

    /* PUDDLE + WAVES: the baked structure mirror, sheared per row by two
     * crossing sine trains — the wet floor reads as moving water (the
     * reference's rippling door/canopy reflections), not static glass */
    if (this.reflectPlate) {
      const rp = this.reflectPlate
      const rh = rp.height
      const step = 6
      for (let y = 0; y < rh; y += step) {
        const sh = Math.min(step, rh - y)
        const dx =
          Math.sin(y * 0.085 + t * 1.9) * (1.1 + y * 0.045) +
          Math.sin(y * 0.037 - t * 1.25) * (0.7 + y * 0.028)
        const dxr = Math.round(dx * 10) / 10
        ctx.drawImage(rp, 0, y, ARENA_W, sh, ARENA_X0 + dxr, y, ARENA_W, sh)
        // sliver guards so the shear never opens a gap at the plate ends
        if (dxr > 0.5) ctx.drawImage(rp, 0, y, dxr, sh, ARENA_X0, y, dxr, sh)
        else if (dxr < -0.5) ctx.drawImage(rp, ARENA_W + dxr, y, -dxr, sh, ARENA_X1 + dxr, y, -dxr, sh)
      }
    }

    /* horizon props (the whole pre-generated plate, one blit; the plate's
     * headroom band sits above the ground line) */
    this.blit(ctx, this.propsPlate, ARENA_X0, -this.plateHead, viewL, viewR)

    /* the inn (baked island; base lands on the ground line) */
    if (this.cabin && this.cabin.width > 1) {
      ctx.drawImage(this.cabin, INN_X - this.cabin.width * 0.5, -this.cabinAnchor.y)
    }

    /* hearth door glow (live flicker over the baked plate) */
    const flick = this.flicker
    const hx = this.hearthAnchor.x
    const hy2 = -Math.min(this.h * 0.16, 130)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.30 + 0.10 * flick
    ctx.drawImage(this.glowWarm, hx - 110, hy2 - 95, 220, 190)
    ctx.globalAlpha = 0.16 * flick
    ctx.drawImage(this.glowWarm, hx - 50, -60, 100, 100)
    ctx.restore()
    // door slab (warm amber — stacked additive glows used to saturate it
    // to a white rectangle)
    ctx.fillStyle = `rgba(255,${(172 * flick) | 0},88,${0.55 + 0.18 * flick})`
    ctx.fillRect(hx - 22, -78, 44, 78)
    ctx.fillStyle = '#080e15'
    ctx.fillRect(hx - 26, -84, 52, 8)

    /* embers over the door (analytic 1D) */
    if (getParticleLevel() > 0) {
      const n = this.embers.activeCount()
      ctx.fillStyle = '#ffbe70'
      for (let i = 0; i < n; i++) {
        const age = ((t * 0.5 + this.embers.b[i]) % 1 + 1) % 1
        const ey = -60 - age * 90
        const ex = hx + 6 + (this.embers.a[i] - 0.5) * 30 + Math.sin(t * 1.6 + this.embers.c[i] * 6) * 5
        ctx.globalAlpha = Math.max(0, 1 - age) * 0.78
        ctx.beginPath()
        ctx.arc(ex, ey, 1.6, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    /* chimney smoke (analytic 1D over the flue) */
    if (getParticleLevel() > 0) {
      const sx = this.smokeBox ? this.smokeBox.x : INN_X + 72
      const sy = this.smokeBox ? this.smokeBox.y : -160
      const U = Math.min(this.h * 0.98, this.w * 0.82)
      const n = this.smokePuffs.activeCount()
      for (let i = 0; i < n; i++) {
        const age = ((t * 0.24 + i / Math.max(1, n)) % 1 + 1) % 1
        const size = U * (0.01 + age * 0.064)
        const px = sx + this.windNow[0] * age * age * U * 0.14 + Math.sin(t * 0.7 + i) * age * U * 0.011
        const py = sy - age * U * 0.2
        ctx.globalAlpha = Math.sin(age * Math.PI) * 0.72
        ctx.drawImage(this.smokeSprite, px - size * 0.5, py - size * 0.5, size, size)
      }
      ctx.globalAlpha = 1
    }

    /* the rack — repainted live (sway) into its scratch island */
    {
      const g = this.rack.getContext('2d') ?? null
      const rg = this.rackCtx ?? (this.rackCtx = g)
      if (rg) {
        const rw = this.rack.width
        const rh = this.rack.height
        rg.setTransform(1, 0, 0, 1, 0, 0)
        rg.clearRect(0, 0, rw, rh)
        rg.save()
        // local (0,0) = the anchor point (island bottom-center)
        rg.translate(rw * 0.5, rh)
        this.paintRack(rg)
        rg.restore()
        ctx.drawImage(this.rack, this.rackAnchor.x - rw * 0.5, this.rackAnchor.y - rh)
      }
    }

    /* the cherry tree — trunk repaint + baked canopy + lantern orbs */
    {
      const cg = this.cherryCtx ?? (this.cherryCtx = this.cherry.getContext('2d'))
      if (cg) {
        const cw = this.cherry.width
        const ch = this.cherry.height
        cg.setTransform(1, 0, 0, 1, 0, 0)
        cg.clearRect(0, 0, cw, ch)
        cg.save()
        // local (0,0) = the anchor point (island bottom-center)
        cg.translate(cw * 0.5, ch)
        this.paintCherryWood(cg)
        cg.restore()
        ctx.drawImage(this.cherry, this.cherryAnchor.x - cw * 0.5, this.cherryAnchor.y - ch)
        const U = Math.min(this.h * 0.98, this.w * 0.82) * CHERRY_SCALE
        const sway = this.chSway * U
        // canopy at mountain.html's height: the sprite origin sits at the
        // tree's ground point (−0.26U), so the clustered blossoms crown
        // the branch tips and the trunk reads below them
        ctx.drawImage(this.canopy, this.cherryAnchor.x - 0.16 * U + sway * 0.8, this.cherryAnchor.y - U * 0.26, 0.32 * U, 0.28 * U)
        for (let i = 0; i < 3; i++) {
          const d = U * 0.03 * (0.88 + 0.12 * Math.sin(t * 1.4 + i * 1.7))
          const ox = [-0.052, 0.012, 0.058][i]
          const oy = [0.172, 0.212, 0.18][i]
          ctx.drawImage(this.orbSprite, this.cherryAnchor.x + ox * U + sway - d * 0.5, this.cherryAnchor.y - oy * U - d * 0.5, d, d)
        }
      }
    }

    /* falling cherry petals (world, analytic; land on the deck) */
    if (getParticleLevel() > 0) {
      const n = this.cherryPetals.activeCount()
      ctx.fillStyle = '#ffd8e8'
      for (let i = 0; i < n; i++) {
        const fall = (this.cherryPetals.b[i] * 340 + t * (26 + this.cherryPetals.c[i] * 18)) % 350
        const py = this.cherryAnchor.y - U0(this) * 0.42 + fall
        const px =
          this.cherryAnchor.x + (this.cherryPetals.a[i] - 0.5) * 240 +
          this.windNow[0] * (fall * 0.4) + Math.sin(t * 1.1 + this.cherryPetals.d[i] * 6) * 12
        if (py > 34) continue
        const rot = this.cherryPetals.c[i] * TAU + t * (1 + this.cherryPetals.e[i] * 2)
        const sz = 2 + this.cherryPetals.a[i] * 2.4
        // land-fade over the last 34px instead of popping at the deck
        const fade = py > 0 ? 1 - py / 34 : 1
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(rot)
        ctx.globalAlpha = (0.72 + this.cherryPetals.e[i] * 0.28) * fade
        ctx.beginPath()
        ctx.ellipse(0, 0, sz, sz * 0.56, 0, 0, TAU)
        ctx.fill()
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }

    /* birds (world coords, painted on the sky side of the arena pass) */
    for (const b of this.birds) this.paintBird(ctx, b, t)

    ctx.restore()
  }

  /** FOREGROUND pass (called by the renderer AFTER entities): the near-lane
   *  plate (lanes 3–4) occludes fighters — depth without per-prop sorting,
   *  still fully pre-generated. */
  drawFront(ctx: CanvasRenderingContext2D): void {
    this.ensure()
    const cam = this.lastCam
    const zoom = cam.zoom > 0 ? cam.zoom : 1
    const viewL = cam.x - (this.w / zoom) * 0.6
    const viewR = cam.x + (this.w / zoom) * 0.6
    // scoped: the near-lane shift must not leak into the additive FX and
    // impact frames that draw after this pass
    ctx.save()
    ctx.translate(0, -ENV_BACK)
    this.blit(ctx, this.propsFront, ARENA_X0, -this.plateHead, viewL, viewR)
    ctx.restore()
  }

  private rackCtx: CanvasRenderingContext2D | null = null
  private cherryCtx: CanvasRenderingContext2D | null = null

  private paintRack(g: CanvasRenderingContext2D): void {
    const w = this.w
    const h = this.h
    const U = Math.min(h * 0.98, w * 0.82)
    const x = 0.305 * w
    const y = 0
    const xx = 0.305 * w
    const yy = -this.rackTop * h
    const wb = 0.019 * U
    const wt = 0.015 * U
    // NOTE: painted in rack-island space where (0,0) is the anchor — the
    // caller translated so the pole base sits at the island origin.
    const baseX = 0
    const baseY = 0
    void x; void y
    const grad = g.createLinearGradient(baseX - wb, baseY, baseX + wb, baseY)
    grad.addColorStop(0, '#030508')
    grad.addColorStop(0.72, '#0a1016')
    grad.addColorStop(1, '#63849c')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(baseX - wb * 0.5, baseY)
    g.lineTo(xx * 0 - wt * 0.5, yy)
    g.lineTo(wt * 0.5, yy)
    g.lineTo(baseX + wb * 0.5, baseY)
    g.closePath()
    g.fill()
    // branches
    for (let i = 0; i < 5; i++) {
      const b = this.branches[i]
      const bx0 = (b.x0 - 0.305) * w
      const by0 = b.y0 * h
      const bx1 = (b.x1 - 0.305) * w
      const by1 = b.y1 * h
      g.strokeStyle = '#04070a'
      g.lineWidth = 0.0085 * U
      g.beginPath()
      g.moveTo(bx0, by0)
      g.lineTo(bx1, by1)
      g.stroke()
      g.strokeStyle = 'rgba(195,232,255,.62)'
      g.lineWidth = Math.max(1, 0.0085 * U * 0.22)
      g.beginPath()
      g.moveTo(bx0, by0 - 0.0085 * U * 0.42)
      g.lineTo(bx1, by1 - 0.0085 * U * 0.42)
      g.stroke()
    }
  }

  private paintCherryWood(g: CanvasRenderingContext2D): void {
    const U = Math.min(this.h * 0.98, this.w * 0.82)
    const s = this.chSway * U
    g.save()
    g.scale(CHERRY_SCALE, CHERRY_SCALE)
    g.fillStyle = '#05080b'
    g.beginPath()
    g.moveTo(-0.075 * U, 4)
    g.quadraticCurveTo(-0.032 * U, -0.008 * U, -0.02 * U, -0.045 * U)
    g.quadraticCurveTo(-0.028 * U, -0.085 * U, -0.015 * U + s * 0.4, -0.118 * U)
    g.lineTo(0.016 * U + s * 0.4, -0.118 * U)
    g.quadraticCurveTo(0.022 * U, -0.072 * U, 0.028 * U, -0.028 * U)
    g.quadraticCurveTo(0.042 * U, -0.004 * U, 0.078 * U, 4)
    g.closePath()
    g.fill()
    g.strokeStyle = 'rgba(195,230,252,.68)'
    g.lineWidth = Math.max(1.5, 0.005 * U)
    g.beginPath()
    g.moveTo(0.07 * U, 2)
    g.quadraticCurveTo(0.026 * U, -0.018 * U, 0.015 * U + s * 0.4, -0.112 * U)
    g.stroke()
    const wood: number[][] = [
      [0.002, -0.11, -0.032, -0.132, -0.075, -0.165],
      [-0.035, -0.135, -0.048, -0.165, -0.064, -0.195],
      [0, -0.112, -0.018, -0.16, -0.026, -0.212],
      [0.004, -0.112, 0.02, -0.155, 0.03, -0.215],
      [0.008, -0.108, 0.045, -0.138, 0.076, -0.172],
      [0.038, -0.145, 0.056, -0.17, 0.068, -0.198],
    ]
    g.lineCap = 'round'
    g.strokeStyle = '#05080b'
    for (const b of wood) {
      g.lineWidth = Math.max(1.5, 0.011 * U)
      g.beginPath()
      g.moveTo(b[0] * U + s * 0.4, b[1] * U)
      g.quadraticCurveTo(b[2] * U + s * 0.7, b[3] * U, b[4] * U + s, b[5] * U)
      g.stroke()
    }
    g.restore()
  }

  private paintBird(ctx: CanvasRenderingContext2D, b: { x: number; y: number; mode: string; facing: number; scale: number; wing: number; glide: number; vx: number; vy: number; seed: number; draw: boolean }, t: number): void {
    const zoom = this.lastCam.zoom > 0 ? this.lastCam.zoom : 1
    const sx = (b.x - this.lastCam.x) * zoom + this.w * 0.5
    const sy = (b.y - this.lastCam.y) * zoom + this.h * 0.5
    if (sx < -60 || sx > this.w + 60 || sy < -60 || sy > this.h + 60) return
    const sz = 0.013 * Math.min(this.h * 0.98, this.w * 0.82) * b.scale * zoom
    ctx.save()
    ctx.translate(sx, sy)
    ctx.scale(b.facing, 1)
    if (b.mode === 'perched') {
      ctx.fillStyle = '#04070c'
      ctx.beginPath()
      ctx.moveTo(-sz * 0.25, 0)
      ctx.lineTo(-sz * 0.95, sz * 0.42)
      ctx.lineTo(-sz * 0.82, sz * 0.14)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(0, -sz * 0.22, sz * 0.46, sz * 0.26, -0.35, 0, TAU)
      ctx.fill()
      ctx.save()
      ctx.translate(sz * 0.3, -sz * 0.48)
      ctx.rotate(Math.sin(t * 0.9 + b.seed) * 0.08)
      ctx.beginPath()
      ctx.arc(0, 0, sz * 0.2, 0, TAU)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(sz * 0.14, -sz * 0.04)
      ctx.lineTo(sz * 0.36, 0)
      ctx.lineTo(sz * 0.14, sz * 0.06)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      ctx.strokeStyle = 'rgba(195,232,255,.42)'
      ctx.lineWidth = Math.max(0.8, sz * 0.08)
      ctx.beginPath()
      ctx.arc(0, -sz * 0.22, sz * 0.42, -2.5, -0.6)
      ctx.stroke()
    } else {
      ctx.rotate(clamp(Math.atan2(b.vy, Math.abs(b.vx) + 1e-4), -0.45, 0.45))
      const wy = (b.glide > 0 ? -0.35 : Math.sin(b.wing)) * sz * 0.85
      ctx.fillStyle = '#03060b'
      ctx.beginPath()
      ctx.moveTo(-sz * 0.72, 0)
      ctx.quadraticCurveTo(-sz * 0.15, -sz * 0.14, sz * 0.35, -sz * 0.06)
      ctx.lineTo(sz * 0.55, 0)
      ctx.lineTo(sz * 0.3, sz * 0.09)
      ctx.quadraticCurveTo(-sz * 0.2, sz * 0.14, -sz * 0.72, sz * 0.08)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(-sz * 0.05, -sz * 0.04)
      ctx.quadraticCurveTo(-sz * 0.22, -wy - sz * 0.32, -sz * 0.85, -wy * 0.92 - sz * 0.12)
      ctx.quadraticCurveTo(-sz * 0.32, -wy * 0.45, sz * 0.12, -sz * 0.02)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  /* ------------------------------ drawWeather ----------------------------- */

  drawWeather(ctx: CanvasRenderingContext2D, cam: BgCam): void {
    this.ensure()
    this.storm.setView(cam)
    this.storm.drawRain(ctx)
    const w = this.w
    const h = this.h
    const t = this.t

    /* snow field (1D analytic — closed-form fall + integrated wind) */
    if (getParticleLevel() > 0) {
      const n = this.snow.activeCount()
      const wind = this.windNow[2]
      for (let i = 0; i < n; i++) {
        const j2 = i * 6
        void j2
        const z = this.snow.c[i]
        const speed = 7 + z * 19
        const travel = t * speed
        let x =
          this.snow.a[i] * w - this.lastCam.x * (0.13 + z * 0.32) + wind * (10 + z * 30) +
          Math.sin(t * 0.43 + this.snow.d[i] * TAU) * (4 + z * 8)
        let y = this.snow.b[i] * h + travel
        x = (((x % (w + 32)) + w + 32) % (w + 32)) - 16
        y = (((y % (h + 32)) + h + 32) % (h + 32)) - 16
        const radius = 0.55 + z * 1.25
        ctx.globalAlpha = (0.1 + z * 0.34) * (y > h * 0.87 ? 0.55 : 1)
        ctx.fillStyle = '#c4dbe8'
        ctx.beginPath()
        ctx.ellipse(x, y, radius, radius * (0.58 + 0.2 * Math.cos(t * 0.8 + this.snow.e[i] * TAU)), this.snow.e[i] * TAU + t * 0.13, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      /* foreground bokeh / glow motes (1D, depth-wrapped) */
      const m = this.fgMotes.activeCount()
      const wind0 = this.windNow[0]
      for (let i = 0; i < m; i++) {
        const depth = 1.55 + this.fgMotes.c[i] * 0.45
        let px = this.fgMotes.a[i] * 1.2 + wind0 * 0.0006 * t
        let py = this.fgMotes.b[i] * 1.1 + t * 0.011 * (0.35 + this.fgMotes.c[i])
        px = (((px - 0.1 - this.lastCam.x * 0.0004 * depth) % 1.2) + 1.2) % 1.2 - 0.1
        py = ((py % 1.15) + 1.15) % 1.15 - 0.075
        const sx = px * w
        const sy = py * h
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue
        const orb = i < 6
        const d = orb
          ? (4 + this.fgMotes.d[i] * 4.5) * 4.4 * (0.82 + 0.18 * Math.sin(t * 1.4 + this.fgMotes.e[i] * TAU))
          : (2.8 + this.fgMotes.d[i] * 3.8) * 2
        ctx.globalAlpha = 0.5
        if (orb) ctx.drawImage(this.orbSprite, sx - d * 0.5, sy - d * 0.5, d, d)
        else if (i >= 15) ctx.drawImage(this.bokehSprite, sx - d * 0.5, sy - d * 0.5, d, d)
        else {
          ctx.fillStyle = 'rgba(255,212,230,.74)'
          ctx.beginPath()
          ctx.ellipse(sx, sy, this.fgMotes.d[i] * 3.8 + 2, (this.fgMotes.d[i] * 3.8 + 2) * 0.54, this.fgMotes.c[i] * TAU + t * 0.3, 0, TAU)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }
  }

  /* ------------------------- masks + light rig ---------------------------- */

  /** moon-shaft occlusion source: bright moon, dark silhouettes */
  drawShaftMask(ctx: CanvasRenderingContext2D, cam: BgCam): void {
    this.ensure()
    const w = this.w
    const h = this.h
    const zoom = cam.zoom > 0 ? cam.zoom : 1
    const camX = Number.isFinite(cam.x) ? cam.x : 1300
    const camY = Number.isFinite(cam.y) ? cam.y : -150
    const hy = h * 0.5 - camY * zoom
    const mx = w * 0.66 - camX * 0.015
    const my = h * 0.215 - (camY + 150) * 0.04
    ctx.save()
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    // dim mask source: the shaft smear multiplies this 5–9× additively,
    // so the full-strength halo used to veil the entire sky
    const moonSize = this.moonHalo.width
    ctx.globalAlpha = 0.45
    ctx.drawImage(this.moonHalo, mx - moonSize * 0.5, my - moonSize * 0.5)
    ctx.globalAlpha = 1
    // silhouettes: the strips are already near-black (rgb 31..79) over the
    // black fill — they occlude the moon halo without an extra pass
    for (let k = 0; k < 4; k++) {
      const strip = this.strips[k]
      if (!strip) continue
      const pk = MOUNTAIN_DEPTHS[k]
      const pad = Math.max(64, Math.ceil(w * 0.05))
      ctx.drawImage(strip, -pad + CAM_MIN * pk - camX * pk, hy - 0.39 * h - (camY + 150) * pk * 0.22)
    }
    ctx.restore()
  }

  /** wet-deck roughness plate over the reflection band */
  drawWetMask(ctx: CanvasRenderingContext2D): void {
    this.ensure()
    const cam = this.lastCam
    const zoom = cam.zoom > 0 ? cam.zoom : 1
    const viewL = cam.x - (this.w / zoom) * 0.6
    const viewR = cam.x + (this.w / zoom) * 0.6
    this.blit(ctx, this.wetPlate, ARENA_X0, 8 - ENV_BACK, viewL, viewR)
  }

  /** typed light rig: diffuse key pool, moon glitter, door + lantern practicals */
  drawLightRig(ctx: CanvasRenderingContext2D, moonWorldX: number, _moonWorldY: number): void {
    this.ensure()
    const t = this.t
    const cov = this.moonCover
    const li = this.lightningI()
    const cam = this.lastCam
    const zoom = cam.zoom > 0 ? cam.zoom : 1
    const viewL = cam.x - (this.w / zoom) * 0.6
    const viewR = cam.x + (this.w / zoom) * 0.6

    /* diffuse cool key pool on the deck (ONE live gradient — brightness
     * follows the key: eclipse/lightning modulate, never baked-in) */
    const poolA = (0.3 + 0.5 * Math.min(1, 0.6 + li)) * (1 - 0.85 * cov)
    if (poolA > 0.02) {
      const grad = ctx.createLinearGradient(0, 0, 0, 240)
      grad.addColorStop(0, `rgba(140,168,210,${(0.30 * poolA).toFixed(3)})`)
      grad.addColorStop(0.5, `rgba(118,148,192,${(0.16 * poolA).toFixed(3)})`)
      grad.addColorStop(1, 'rgba(100,130,178,0)')
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = grad
      ctx.fillRect(Math.max(ARENA_X0, viewL - 40), 0, Math.min(ARENA_W, viewR - viewL + 80), 240)
      ctx.globalCompositeOperation = 'source-over'
    }

    /* moon glitter lane (two baked blits, micro-wobble) — kept subtle:
     * at full strength it read as white blobs sitting on the deck */
    ctx.globalCompositeOperation = 'lighter'
    const glA = (0.20 + 0.10 * li) * (1 - 0.7 * cov)
    const w1 = Math.sin(t * 2.1) * 3
    ctx.globalAlpha = glA
    ctx.drawImage(this.glitter, moonWorldX - 120 + w1, 10, 240, 110)
    ctx.globalAlpha = glA * 0.5
    ctx.drawImage(this.glitter, moonWorldX - 120 - w1, 16, 240, 96)

    /* door practical: warm pool + wide bounce (breathing with flicker) —
     * the reference's doorway floods the deck with amber light */
    ctx.globalAlpha = 0.38 + 0.10 * this.flicker
    ctx.drawImage(this.glowWarm, this.hearthAnchor.x - 250, -150 - ENV_BACK, 500, 320)
    ctx.globalAlpha = 0.15
    ctx.drawImage(this.glowWarm, this.hearthAnchor.x - 430, -70 - ENV_BACK, 860, 240)

    /* lantern practicals (bounded: in-view only, sized to the lantern —
     * a fixed 110px halo around a 60px lantern read as a floating orb) */
    ctx.globalAlpha = 0.20
    for (let i = 0; i < this.lanternXs.length; i++) {
      const { x: lx, s, y: ly } = this.lanternXs[i]
      if (lx < viewL - 80 || lx > viewR + 80) continue
      const d = Math.max(56, Math.min(120, s * 0.42))
      const gy = ly - ENV_BACK - s * 0.136
      ctx.drawImage(this.glowWarm, lx - d * 0.5, gy - d * 0.5, d, d)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /* ------------------------------- helpers -------------------------------- */

  private blit(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, worldX: number, worldY: number, viewL: number, viewR: number): void {
    if (!img) return
    const iw = img.width
    if (iw <= 0) return
    const x0 = Math.max(worldX, Math.floor(viewL - 16))
    const x1 = Math.min(worldX + iw, Math.ceil(viewR + 16))
    if (x1 <= x0) return
    ctx.drawImage(img, x0 - worldX, 0, x1 - x0, img.height, x0, worldY, x1 - x0, img.height)
  }
}

function U0(self: ShiroganeHorizonBackground): number {
  const s = self as unknown as { w: number; h: number }
  return Math.min(s.h * 0.98, s.w * 0.82)
}

export default ShiroganeHorizonBackground
