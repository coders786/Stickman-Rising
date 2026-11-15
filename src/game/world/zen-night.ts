import {StormEngine} from './storm'
import type {BgCam} from './background'
import {keyLightFromStorm} from '../render/lighting'
import {
  SkyVaultCache,blitWorldFrustum,DamageSurface,ShadowFieldSAT,
  buildLunarSurface,windAt,fbm3CPU,
} from './horizon-strata'

/* ==========================================================================
 * MOONLIT SAKURA SANCTUARY — Wind & Water Optics Edition
 * ==========================================================================
 * The zen-night stage, rebuilt on the engine port from
 *   coders786/Optimization-of-Engines---Stickman-Rising
 * (`moonlit-sakura-optimized.html`, `optics-components.js`, `optics-shaders.js`,
 *  `mountain-inn.js`, `evidence-mountains/PLAN.md`).
 *
 * ART DIRECTION (minimalist-mountains revision)
 *   · 4 layered mountain ridges, sparse conifers, snow facets, no village —
 *     the horizon is empty, so the moon and the inn own the composition.
 *   · ONE detailed foreground inn (timber-framed plaster, curved tile roof
 *     with offset channels, warm shoji door at the DOOR_LIGHT anchor).
 *   · Swaying sakura with a 248-blossom rosette canopy, 3 perched birds,
 *     2 flying birds, 16 mist banks, 5 cloud banks, 36 falling petals.
 *   · 640×640 Lommel–Seeliger crater-baked moon, 320-star sky bake with a
 *     nebula field, 120 twinkling stars and a periodic meteor.
 *
 * ENGINE LAW (every claim below is measured — see research/RENDER_PERFORMANCE.md)
 *   1. BAKE ONCE. Sky vault, ridges, inn, canopy, deck, garden, wet plate,
 *      shadow field and every sprite are rasterized exactly once per resize.
 *   2. REUSE FIELDS. Clouds, mist, petals, canopy sway and the water waves all
 *      ride ONE analytic gust carrier (`windAt`), so velocity AND its exact
 *      integral come from the same closed form — no integrator drift, no
 *      per-object clocks.
 *   3. SPLIT DRY FROM WET. The dry engawa bake and the scissored water puddle
 *      are separate passes; the mirror never re-rasterizes the boards.
 *   4. CULL BEFORE COMPUTING. `blitWorldFrustum` clips 2900 px plates to the
 *      camera frustum, prop shadows are complete-footprint tested against a
 *      0/1/2 integer SAT before any 12-tap Poisson evaluation.
 *   5. NEVER DELETE ART TO WIN A BENCHMARK. Low tiers thin particle COUNTS,
 *      never layers.
 */

const TAU = Math.PI * 2
const ARENA_X0 = -150, ARENA_X1 = 2750
const ARENA_W = ARENA_X1 - ARENA_X0
/** NOMINAL camera y — the sky/mask moon twins share this anchor */
const NOMINAL_Y = -170
const DECK_H = 300
/** world-space garden anchors — the inn door and the stone lantern sit exactly
 *  on the shared renderer emitters (DOOR_LIGHT 1755,-120 · STREET_LIGHT 830,-252) */
const DOOR_X = 1755, LANTERN_X = 830, POND_X = 2050, POND_Y = 44, SAKURA_X = 2460, TORII_X = 310
/** inn bake box (world units) */
const INN_X0 = 1544, INN_X1 = 1966, INN_TOP = -334, INN_BOT = 30
/** sakura bake box (world units, bottom-anchored on the deck) */
const SAK_X0 = SAKURA_X - 300, SAK_W = 600, SAK_TOP = -430, SAK_BOT = 26
/** garden bake box (fence / torii / lantern / pond edging) */
const GARDEN_TOP = -304, GARDEN_H = 336

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mixN = (a: number, b: number, t: number) => a + (b - a) * t
/** multiply a #rrggbb by `k` — the cheapest aerial-perspective ramp */
function mid(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * k)
  const g2 = Math.round(((n >> 8) & 255) * k)
  const b = Math.round((n & 255) * k)
  return `rgb(${r},${g2},${b})`
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w | 0)
  c.height = Math.max(1, h | 0)
  const g = c.getContext('2d')
  if (!g) throw Error('2D canvas unavailable')
  return {c, g}
}
function noise(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function poly(g: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]) {
  g.beginPath()
  for (let i = 0; i < pts.length; i++) {
    if (i) g.lineTo(pts[i][0], pts[i][1])
    else g.moveTo(pts[i][0], pts[i][1])
  }
  g.closePath()
}
function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: readonly (readonly [number, string])[]) {
  const q = g.createRadialGradient(x, y, 0, x, y, Math.max(1, r))
  for (const s of stops) q.addColorStop(s[0], s[1])
  g.fillStyle = q
  g.beginPath()
  g.arc(x, y, Math.max(1, r), 0, TAU)
  g.fill()
}

/* ------------------------- 5-bank cloud table --------------------------- */
const CLOUD_Z = new Float32Array([0.16, 0.32, 0.5, 0.7, 0.9])
const CLOUD_BASE = new Float32Array([-0.1, 0.14, 0.44, 0.72, 0.98])
const CLOUD_TINT = ['#3b4f63', '#33475c', '#2b3e53', '#25374b', '#203044']

export class ZenNightBackground {
  readonly storm: StormEngine
  /** this scene paints its own moon shaft fan, so the renderer's generic
   *  occlusion→smear god-ray pass stands down (no double shaft system) */
  readonly ownsMoonShafts = true
  moonX = 0
  moonY = 0
  moonCover = 0

  private w = 1280
  private h = 720
  private t = 0
  private built = false
  private quality: 'low' | 'medium' | 'high' | 'ultra' = 'high'

  /* bakes */
  private staticFar: HTMLCanvasElement | null = null
  private staticMid: HTMLCanvasElement | null = null
  private deckPlate: HTMLCanvasElement | null = null
  private gardenPlate: HTMLCanvasElement | null = null
  private innPlate: HTMLCanvasElement | null = null
  private sakuraPlate: HTMLCanvasElement | null = null
  private wetPlate: HTMLCanvasElement | null = null
  private lunar: HTMLCanvasElement | null = null
  private cloud: HTMLCanvasElement | null = null
  private cloudLit: HTMLCanvasElement | null = null
  private shaft: HTMLCanvasElement | null = null
  private petal: HTMLCanvasElement | null = null
  private petalGlow: HTMLCanvasElement | null = null
  private orb: HTMLCanvasElement | null = null
  private mistSprite: HTMLCanvasElement | null = null
  private deckPool: HTMLCanvasElement | null = null
  private warmPool: HTMLCanvasElement | null = null
  private glitter: HTMLCanvasElement | null = null
  private starSprite: HTMLCanvasElement | null = null
  /** pure radial aureole (no disc): the moon's atmospheric Mie glow */
  private moonGlow: HTMLCanvasElement | null = null
  private skyFx: HTMLCanvasElement | null = null
  private skyFxCtx: CanvasRenderingContext2D | null = null
  private starDmg = new DamageSurface()

  private skyVault = new SkyVaultCache()
  private lastCam: BgCam = {x: 1300, y: NOMINAL_Y, zoom: 1}

  /* shared analytic gust carrier (velocity + exact integral) */
  private wind = new Float32Array(4)
  private windIntegralX = 0

  /* clouds in SCENE coordinates — the same field feeds art and lighting */
  private cloudNx = new Float32Array(5)
  private moonVis = 0.92
  /* Genuine 2-slot temporal bracket for the media transport (plan F03):
   * values A/B are stored WITH their time endpoints t0/t1 and the current
   * bracket is interpolated — the old min(A,B) was a biased sample-and-
   * hold filter, not bracketing. Advanced in update() on the visual clock. */
  private bracketA = 1
  private bracketB = 1
  private bracketT0 = -9
  private bracketT1 = -9

  /* Wind displacement continuity (plan F05): the closed form windAt(t,s)
   * is only an exact integral while strength s is constant. storm.wind
   * varies continuously, so the accumulated displacement is integrated
   * piecewise (constant strength over each update segment) and carried
   * through strength changes without jumps: D += s_prev·(F(t)−F(t_prev)),
   * with F = windAt(t, 1) the unit-strength primitive. */
  private windInit = false
  private windLastT = 0
  private windLastS = 0
  private windLastF = 0
  private windDispX = 0
  private windUnit = new Float32Array(4)

  /* Dedicated deterministic stream for visual event spawns (petal→pond
   * ripples). Rendering/visual events must never consume the global RNG
   * shared with gameplay and audio (plan M08), and their spawn rate must
   * not depend on how often draw happens (plan F14). */
  private rippleRng = noise(0x51a9c4)

  /* petals (screen-space pool) */
  private px = new Float32Array(72)
  private py = new Float32Array(72)
  private pz = new Float32Array(72)
  private pp = new Float32Array(72)
  private pr = new Float32Array(72)

  /* water ripples: 4 slots of [worldX, age, strength] */
  private ripples = new Float32Array(12)
  private rippleHead = 0

  /* two flying birds (screen-space, scene-normalized) */
  private birdT = new Float32Array([0.12, 0.61])

  /* mist banks (scene-normalized, drifting with the gust carrier) */
  private mistN = new Float32Array(16)
  private mistY = new Float32Array(16)
  private mistR = new Float32Array(16)
  private mistA = new Float32Array(16)

  /* prop-shadow certificate */
  private shadowSAT = new ShadowFieldSAT()
  private shadowMask: HTMLCanvasElement | null = null

  get onThunder() {
    return this.storm.onThunder
  }
  set onThunder(v: (() => void) | null) {
    this.storm.onThunder = v
  }

  constructor(storm = new StormEngine('medium')) {
    this.storm = storm
    this.storm.setRainScale(0.42)
    const r = noise(0x51a9c3)
    for (let i = 0; i < 72; i++) {
      this.px[i] = r() * 2200
      this.py[i] = r() * 720
      this.pz[i] = r()
      this.pp[i] = r() * TAU
      this.pr[i] = r() * TAU
    }
    for (let k = 0; k < 5; k++) this.cloudNx[k] = CLOUD_BASE[k]
    for (let i = 0; i < 16; i++) {
      this.mistN[i] = i / 16 + (r() - 0.5) * 0.05
      this.mistY[i] = 0.695 + r() * 0.055
      this.mistR[i] = 0.1 + r() * 0.13
      this.mistA[i] = 0.1 + r() * 0.13
    }
    for (let i = 0; i < 4; i++) this.ripples[i * 3 + 1] = 9
  }

  /** Tier change is a draw-budget change only — never invalidate the bakes. */
  setQuality(q: 'low' | 'medium' | 'high' | 'ultra') {
    this.quality = q
  }
  private get nCloud() {
    return this.quality === 'low' ? 3 : this.quality === 'medium' ? 4 : 5
  }
  private get nPetal() {
    return this.quality === 'low' ? 18 : this.quality === 'medium' ? 26 : 36
  }
  private get nMist() {
    return this.quality === 'low' ? 7 : this.quality === 'medium' ? 11 : 16
  }

  resize(w: number, h: number) {
    const nw = Math.max(1, w | 0), nh = Math.max(1, h | 0)
    // The DPR governor steps pass the SAME css size: never invalidate the
    // bakes for a no-op resize (a re-bake stalls 100-500 ms and resets the
    // browser's frame pacing to half-rate = the 30 fps lock).
    if (nw === this.w && nh === this.h && this.built) return
    this.w = nw
    this.h = nh
    this.storm.resize(nw, nh)
    this.built = false
    this.skyVault.invalidate()
    this.starDmg.resize(nw, nh)
    this.starDmg.invalidate()
  }

  update(dt: number) {
    const d = dt < 0 ? 0 : dt > 0.1 ? 0.1 : dt
    this.t += d
    // ONE gust carrier drives clouds, mist, canopy sway and the water waves
    windAt(this.t, this.storm.wind, this.wind)
    // F05: displacement integrates the piecewise-constant strength law so
    // a changing storm.wind never teleports the accumulated offset. F is
    // the UNIT-strength primitive windAt(t,1) (its 0.85 carrier included),
    // so with constant strength this telescopes to exactly s·F(t) =
    // windAt(t,s) — the old closed form — and across a strength change it
    // stays continuous instead of jumping by Δs·F(t).
    {
      const s = this.storm.wind
      const F = windAt(this.t, 1, this.windUnit)[2]
      if (!this.windInit) {
        this.windInit = true
        this.windLastT = this.t
        this.windLastS = s
        this.windLastF = F
        this.windDispX = s * F
      } else if (this.t !== this.windLastT) {
        this.windDispX += this.windLastS * (F - this.windLastF)
        this.windLastT = this.t
        this.windLastS = s
        this.windLastF = F
      }
      this.windIntegralX = this.windDispX
    }
    // F03/F04: media-transport bracket + moon visibility filter advance on
    // the VISUAL clock here — drawSky used to mutate them per DRAW, so the
    // rate·60 smoothing factor made moon state a function of frame count
    // (6 vs 14 draws of the same 0.1 s gave different results).
    if (this.t - this.bracketT1 >= 1 / 24) {
      this.bracketA = this.bracketB
      this.bracketT0 = this.bracketT1
      this.bracketB = this.sampleTransmission(this.t)
      this.bracketT1 = this.t
    }
    const span = this.bracketT1 - this.bracketT0
    const u = span > 1e-9 ? clamp01((this.t - this.bracketT0) / span) : 1
    const raw = mixN(this.bracketA, this.bracketB, u)
    const target = 0.06 + 0.94 * raw
    const rate = target < this.moonVis ? 0.018 : 0.006
    // a = 1 − exp(−dt/τ) with τ = 1/(rate·60): frame-rate independent and
    // exactly semigroup (10×0.01 s ≡ 1×0.1 s), unlike the old per-draw
    // min(1, rate·60) step. Repeated draws of one frame change nothing.
    this.moonVis += (target - this.moonVis) * (1 - Math.exp(-d * rate * 60))
    this.moonCover = 1 - this.moonVis
    const drift = d * 0.0022
    for (let k = 0; k < 5; k++) {
      this.cloudNx[k] += drift * (0.5 + CLOUD_Z[k])
      if (this.cloudNx[k] > 1.36) this.cloudNx[k] -= 1.62
    }
    for (let i = 0; i < 4; i++) if (this.ripples[i * 3 + 1] < 9) this.ripples[i * 3 + 1] += d
    // F14: petal→pond ripple EVENTS generate here (visual clock, dedicated
    // RNG), not inside drawWeather — a paused/repeated draw can no longer
    // spawn impulses, and spawn rate no longer scales with frame rate.
    // Petal screen-Y is an analytic function of t (same formula as draw).
    if (this.w > 0 && this.h > 0) {
      const h = this.h
      const p = 1 - Math.exp(-0.24 * d) // ≈ old 0.004/draw at 60 fps
      if (p > 0) {
        for (let i = 0; i < 4; i++) {
          const z = this.pz[i]
          const y = (this.py[i] + this.t * (7 + 13 * z)) % (h + 80) - 40
          if (y > h * 0.72 && y <= h * 0.84 && this.rippleRng() < p) {
            const slot = this.rippleHead
            this.rippleHead = (this.rippleHead + 1) % 4
            this.ripples[slot * 3] = POND_X + (this.rippleRng() - 0.5) * 120
            this.ripples[slot * 3 + 1] = 0
          }
        }
      }
    }
    for (let i = 0; i < 2; i++) this.birdT[i] += d * 0.021
  }

  lightningI() {
    return this.storm.intensity
  }
  lightningAz() {
    return this.storm.azimuthValue
  }

  private ensure() {
    if (this.built) return
    this.built = true
    this.bakeSprites()
    this.bakeSky()
    this.bakeWorld()
    this.bakeShadowField()
  }

  /* ===================== 1. SPRITE BAKES (once) ======================== */
  private bakeSprites() {
    // ---- MOON: 640×640 Lommel–Seeliger regolith + 540 craters + corona ----
    if (!this.lunar) this.lunar = buildLunarSurface(640)
    // ---- AUREOLE: a SECOND, glow-only bake ---------------------------------
    // Drawing the lunar bake a second time, scaled up, also scaled up its
    // DISC — a phantom moon behind the real one. The halo therefore gets its
    // own sprite: nothing but a smooth falloff, so it can be drawn at any
    // size without ever inventing a second limb.
    {
      const S = 512
      const {c, g} = canvas(S, S)
      const q = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5)
      q.addColorStop(0, 'rgba(226,240,255,0.5)')
      q.addColorStop(0.22, 'rgba(186,216,246,0.26)')
      q.addColorStop(0.44, 'rgba(140,180,220,0.12)')
      q.addColorStop(0.68, 'rgba(120,152,190,0.045)')
      q.addColorStop(1, 'rgba(100,130,170,0)')
      g.fillStyle = q
      g.fillRect(0, 0, S, S)
      this.moonGlow = c
    }

    // ---- common sprites (star / orb / bokeh-petal / mist / glitter) -------
    {
      const {c, g} = canvas(32, 32)
      radial(g, 16, 16, 15, [[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(205,235,255,.65)'], [1, 'rgba(180,220,255,0)']])
      this.starSprite = c
    }
    {
      const {c, g} = canvas(64, 64)
      radial(g, 32, 32, 31, [[0, 'rgba(255,252,255,.96)'], [0.22, 'rgba(255,204,230,.62)'], [0.55, 'rgba(255,155,200,.16)'], [1, 'rgba(255,140,190,0)']])
      this.orb = c
    }
    {
      const {c, g} = canvas(20, 16)
      g.fillStyle = '#e6b7c8'
      g.beginPath()
      g.moveTo(2, 8)
      g.quadraticCurveTo(8, 0, 18, 5)
      g.quadraticCurveTo(10, 15, 2, 8)
      g.fill()
      g.strokeStyle = 'rgba(255,232,240,.6)'
      g.lineWidth = 0.7
      g.stroke()
      this.petal = c
    }
    {
      const {c, g} = canvas(64, 64)
      radial(g, 32, 32, 30, [[0, 'rgba(255,205,220,.5)'], [0.35, 'rgba(244,172,198,.22)'], [1, 'rgba(226,142,172,0)']])
      this.petalGlow = c
    }
    {
      const {c, g} = canvas(128, 64)
      g.save()
      g.translate(64, 32)
      g.scale(1, 0.5)
      radial(g, 0, 0, 62, [[0, 'rgba(132,166,194,.28)'], [0.55, 'rgba(96,132,162,.1)'], [1, 'rgba(70,100,125,0)']])
      g.restore()
      this.mistSprite = c
    }
    // ---- MOON DIFFUSE POOL: the lit surface the long shadows read against --
    {
      const {c, g} = canvas(512, 128)
      radial(g, 256, 64, 250, [[0, 'rgba(198,224,246,.34)'], [0.45, 'rgba(164,196,226,.16)'], [1, 'rgba(124,162,198,0)']])
      this.deckPool = c
    }
    // ---- PRACTICAL WARM POOL (door / lantern bounce) ----------------------
    {
      const {c, g} = canvas(256, 256)
      radial(g, 128, 128, 126, [[0, 'rgba(255,182,116,.52)'], [0.42, 'rgba(236,136,78,.2)'], [1, 'rgba(182,90,42,0)']])
      this.warmPool = c
    }
    // ---- SPECULAR GLITTER LANE (broken sparkle for the wet mirror) --------
    {
      const {c, g} = canvas(760, 120)
      const r = noise(0x5511)
      for (let i = 0; i < 42; i++) {
        const x = r() * 740 + 10, y = 22 + r() * 76, ln = 12 + r() * 60
        g.fillStyle = `rgba(200,226,242,${0.06 + r() * 0.26})`
        g.fillRect(x, y, ln, 1.2 + r() * 1.6)
      }
      this.glitter = c
    }
    // ---- CLOUD BANKS: shaded cumulus + moonlit silver lining -------------
    {
      const {c, g} = canvas(800, 230)
      const r = noise(318)
      for (let i = 0; i < 15; i++) {
        const x = 45 + r() * 710, y = 64 + r() * 82, rx = 68 + r() * 125, ry = 24 + r() * 38
        g.save()
        g.scale(1, ry / rx)
        const q = g.createRadialGradient(x - rx * 0.3, y - ry * 0.62, 2, x, y, rx)
        q.addColorStop(0, `rgba(104,126,142,${0.26 + r() * 0.1})`)
        q.addColorStop(0.42, `rgba(32,46,62,${0.34 + r() * 0.16})`)
        q.addColorStop(1, 'rgba(5,10,18,0)')
        g.fillStyle = q
        g.beginPath()
        g.arc(x, (y * rx) / ry, rx, 0, TAU)
        g.fill()
        const rim = g.createRadialGradient(x + rx * 0.34, y - ry * 0.9, rx * 0.42, x, y, rx)
        rim.addColorStop(0, 'rgba(182,212,228,0)')
        rim.addColorStop(0.72, `rgba(182,212,228,${0.1 + r() * 0.09})`)
        rim.addColorStop(1, 'rgba(182,212,228,0)')
        g.fillStyle = rim
        g.beginPath()
        g.arc(x, (y * rx) / ry, rx, 0, TAU)
        g.fill()
        g.restore()
      }
      const under = g.createLinearGradient(0, 105, 0, 214)
      under.addColorStop(0, 'rgba(2,6,13,0)')
      under.addColorStop(0.52, 'rgba(2,5,12,.3)')
      under.addColorStop(1, 'rgba(2,5,12,0)')
      g.fillStyle = under
      g.fillRect(0, 90, 800, 124)
      this.cloud = c
    }
    {
      const {c, g} = canvas(800, 230)
      const r = noise(319)
      for (let i = 0; i < 15; i++) {
        const x = 45 + r() * 710, y = 64 + r() * 82, rx = 68 + r() * 125, ry = 24 + r() * 38
        g.save()
        g.scale(1, ry / rx)
        const q = g.createRadialGradient(x + rx * 0.22, y - ry * 0.8, 2, x, y, rx)
        q.addColorStop(0, `rgba(198,226,242,${0.16 + r() * 0.12})`)
        q.addColorStop(0.6, 'rgba(150,186,210,.05)')
        q.addColorStop(1, 'rgba(130,168,196,0)')
        g.fillStyle = q
        g.beginPath()
        g.arc(x, (y * rx) / ry, rx, 0, TAU)
        g.fill()
        g.restore()
      }
      this.cloudLit = c
    }
    // ---- CREPUSCULAR SHAFT FAN (painted once, alpha breathes) ------------
    {
      const {c, g} = canvas(720, 720)
      const ox = 360, oy = 18
      const wedges: readonly (readonly [number, number, number])[] = [
        [-42, 7, 0.1], [-33, 5, 0.13], [-25, 9, 0.09], [-18, 4, 0.14], [-9, 7, 0.1],
        [-1, 3, 0.12], [7, 8, 0.08], [15, 5, 0.1], [24, 6, 0.07],
      ]
      for (const [deg, wid, amp] of wedges) {
        const a = ((deg - 90) * Math.PI) / 180
        for (const [w2, f] of [[wid * 3.2, 0.35], [wid, 1]] as const) {
          const g2 = g.createLinearGradient(ox, oy, ox + Math.cos(a) * 660, oy + Math.sin(a) * 660)
          g2.addColorStop(0, `rgba(198,226,238,${amp * f})`)
          g2.addColorStop(0.55, `rgba(174,206,222,${amp * f * 0.45})`)
          g2.addColorStop(1, 'rgba(150,184,202,0)')
          g.fillStyle = g2
          g.beginPath()
          g.moveTo(ox, oy)
          const hw = (w2 * Math.PI) / 360
          g.arc(ox, oy, 660, a - hw, a + hw)
          g.closePath()
          g.fill()
        }
      }
      this.shaft = c
    }
    // ---- persistent star-FX layer, managed by the damage lattice ---------
    const sw = Math.max(2, Math.round(this.w / 2))
    const sh = Math.max(2, Math.round(this.h * 0.72 / 2))
    if (!this.skyFx || this.skyFx.width !== sw || this.skyFx.height !== sh) {
      const {c, g} = canvas(sw, sh)
      this.skyFx = c
      this.skyFxCtx = g
      this.starDmg.resize(sw, sh)
      this.starDmg.invalidate()
    }
  }

  /* ============ 2. SKY BAKE: nebula, 320 stars, 4 mountain ridges ======== */
  private bakeSky() {
    const w = this.w, h = this.h
    const SS = 1.25 // supersample then downsample once — 1:1 blits ever after
    const W = Math.min(1920, Math.ceil(w * SS)), H = Math.min(1080, Math.ceil(h * SS))
    const {c, g} = canvas(W, H)
    const r = noise(0x2204)

    // ---- deep night gradient (sakura palette, not pure black) ------------
    const sky = g.createLinearGradient(0, 0, 0, H)
    for (const s of [[0, '#000104'], [0.18, '#01050d'], [0.45, '#05101c'], [0.68, '#10212e'], [0.82, '#1d303f'], [1, '#09121a']] as const) {
      sky.addColorStop(s[0], s[1])
    }
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)

    // ---- NEBULA: 7 tinted clusters × 15 lobes, screen-blended -------------
    g.save()
    g.globalCompositeOperation = 'screen'
    const clusters: readonly (readonly [number, number, number, readonly number[], number])[] = [
      [0.465, 0.21, 0.18, [24, 232, 212], 0.3],
      [0.49, 0.27, 0.17, [42, 138, 255], 0.3],
      [0.535, 0.16, 0.18, [145, 96, 255], 0.32],
      [0.555, 0.22, 0.15, [55, 190, 240], 0.24],
      [0.635, 0.2, 0.12, [60, 220, 195], 0.2],
      [0.642, 0.19, 0.08, [215, 100, 225], 0.2],
      [0.398, 0.208, 0.09, [235, 118, 210], 0.28],
    ]
    for (const [nx, ny, nr, col, na] of clusters) {
      const R = nr * Math.min(W, H)
      for (let k = 0; k < 15; k++) {
        const x = nx * W + (r() - 0.5) * R * 1.45
        const y = ny * H + (r() - 0.5) * R * 0.95
        radial(g, x, y, R * (0.28 + r() * 0.65), [
          [0, `rgba(${col[0]},${col[1]},${col[2]},${na * (0.35 + r() * 0.5)})`],
          [0.5, `rgba(${col[0]},${col[1]},${col[2]},${na * 0.14})`],
          [1, 'rgba(0,0,0,0)'],
        ])
      }
    }
    // ---- comet streak + bright head (static celestial structure) ---------
    {
      const x0 = 0.394 * W, y0 = 0.208 * H, x1 = 0.455 * W, y1 = 0.23 * H
      const cg = g.createLinearGradient(x0, y0, x1, y1)
      cg.addColorStop(0, 'rgba(255,205,245,.82)')
      cg.addColorStop(0.35, 'rgba(215,125,220,.38)')
      cg.addColorStop(1, 'rgba(80,180,195,0)')
      g.strokeStyle = cg
      g.lineWidth = Math.max(2, 0.012 * Math.min(W, H))
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(x0, y0)
      g.quadraticCurveTo((x0 + x1) * 0.5, y0 + 0.016 * H, x1, y1)
      g.stroke()
      radial(g, x0, y0, 0.025 * Math.min(W, H), [
        [0, 'rgba(255,250,255,.98)'], [0.35, 'rgba(248,155,230,.72)'], [1, 'rgba(200,90,190,0)'],
      ])
    }
    // ---- 320-FIELD of static stars (the twinkle subset is live) ----------
    for (let i = 0; i < 320; i++) {
      const x = r() * W, y = r() * 0.69 * H
      const sz = (0.4 + Math.pow(r(), 2.8) * 1.4) * SS
      const t = r()
      g.fillStyle = t < 0.25 ? 'rgba(185,225,255,.78)' : t < 0.4 ? 'rgba(255,220,195,.75)' : 'rgba(255,255,255,.86)'
      g.beginPath()
      g.arc(x, y, sz, 0, TAU)
      g.fill()
    }
    g.restore()

    // ---- AERIAL HAZE (BEHIND the ridges) --------------------------------
    // The haze is the air the far range sits IN, so it goes down first: a
    // band painted over the crests would grey every rim light and flatten the
    // whole range into one silhouette — the exact artefact this rewrite is
    // here to remove.
    const hz = g.createLinearGradient(0, H * 0.46, 0, H * 0.68)
    hz.addColorStop(0, 'rgba(84,124,140,0)')
    hz.addColorStop(0.6, 'rgba(108,152,168,.14)')
    hz.addColorStop(1, 'rgba(96,136,152,.03)')
    g.fillStyle = hz
    g.fillRect(0, H * 0.46, W, H * 0.24)
    // ---- 4 MINIMALIST RIDGES: sparse conifers + snow contour facets ------
    // Each ridge is a RIDGED multifractal profile (`1 - |2n-1|`, raised to a
    // power) sampled at ~7 px, so the crest reads as rock: sharp peaks, long
    // shoulders, no sine-wave dunes and no polygonal facets.
    const ridge = (base: number, amp: number, body: string, rim: string, trees: number, snow: number, seed: number) => {
      const rr = noise(seed)
      const step = Math.max(5, Math.round(W / 200))
      const f1 = 3.1 + (seed % 7) * 0.42
      const f2 = 9.7 + (seed % 5) * 0.9
      const peaks: [number, number, number][] = []
      for (let p = 0; p < 5; p++) peaks.push([rr(), 0.55 + rr() * 0.85, 0.07 + rr() * 0.09])
      const crest = (x: number): number => {
        const u = x / W
        // ridged fbm: sharp crest where n crosses 0.5 from either side
        const n1 = fbm3CPU(u * f1 + seed * 0.017, seed * 0.011)
        const n2 = fbm3CPU(u * f2 - 3.7, seed * 0.027)
        const r1 = Math.pow(1 - Math.abs(2 * n1 - 1), 2.1)
        const r2 = Math.pow(1 - Math.abs(2 * n2 - 1), 3.0)
        let h = 0.24 + 0.52 * r1 + 0.24 * r2
        // a handful of named peaks give the range its silhouette landmarks
        for (const [px, ph, pw] of peaks) {
          const d = (u - px) / pw
          if (Math.abs(d) < 1) h += ph * (1 - d * d) * 0.55
        }
        return base * H - h * amp * H
      }
      const pts: [number, number][] = []
      for (let x = -step; x <= W + step; x += step) pts.push([x, crest(x)])
      // ONE gradient fill, not a flat fill + shade overlay: the ridge lifts
      // off the sky at its crest and sinks into its own valley shadow at the
      // base. Two passes would double the fill cost AND band at the seam.
      const bodyGrad = g.createLinearGradient(0, base * H - amp * H * 1.1, 0, base * H + amp * H * 1.2)
      bodyGrad.addColorStop(0, body)
      bodyGrad.addColorStop(0.42, mid(body, 0.7))
      bodyGrad.addColorStop(1, mid(body, 0.32))
      g.fillStyle = bodyGrad
      g.beginPath()
      g.moveTo(-step, H)
      for (const p of pts) g.lineTo(p[0], p[1])
      g.lineTo(W + step, H)
      g.closePath()
      g.fill()
      // rim light: the moon sits upper-right, so the crest catches it
      const rg = g.createLinearGradient(0, 0, W, 0)
      rg.addColorStop(0, 'rgba(255,255,255,0)')
      rg.addColorStop(0.42, rim)
      rg.addColorStop(1, rim)
      g.strokeStyle = rg
      g.lineWidth = 1.5
      g.beginPath()
      for (let i = 0; i < pts.length; i++) {
        if (i) g.lineTo(pts[i][0], pts[i][1])
        else g.moveTo(pts[i][0], pts[i][1])
      }
      g.stroke()
      // sparse conifers: moonlit-edge triangles, never a forest
      for (let i = 0; i < trees; i++) {
        const p = pts[1 + ((rr() * (pts.length - 2)) | 0)]
        const th = (6 + rr() * 11) * SS
        const tw = th * 0.36
        g.fillStyle = 'rgba(2,7,12,.94)'
        g.beginPath()
        g.moveTo(p[0] - tw, p[1] + 2)
        g.lineTo(p[0], p[1] + 2 - th)
        g.lineTo(p[0] + tw, p[1] + 2)
        g.closePath()
        g.fill()
        g.strokeStyle = 'rgba(176,214,240,.3)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(p[0] + tw * 0.2, p[1] + 1)
        g.lineTo(p[0] + tw * 0.06, p[1] + 2 - th * 0.86)
        g.stroke()
      }
      // snow contour facets clinging to the steep moon-facing faces
      for (let i = 0; i < snow; i++) {
        const k = 3 + ((rr() * (pts.length - 6)) | 0)
        const a = pts[k], b = pts[k + 1]
        const slope = (b[1] - a[1]) / Math.max(1, b[0] - a[0])
        if (slope > -0.12) continue // only faces that turn toward the light
        const u = 0.18 + rr() * 0.46
        const px = mixN(a[0], b[0], u), py = mixN(a[1], b[1], u)
        const len = (8 + rr() * 26) * SS
        g.strokeStyle = `rgba(196,228,248,${0.1 + rr() * 0.16})`
        g.lineWidth = 1.1 + rr() * 1.1
        g.beginPath()
        g.moveTo(px, py + 1.5)
        g.lineTo(px + len * 0.34, py + len * slope * 0.5 + len * 0.42)
        g.stroke()
      }
    }
    // The game's deck horizon sits at screen y ≈ 0.736·H, so every ridge base
    // is placed ABOVE it: four visible strata, none hidden behind the engawa.
    ridge(0.604, 0.132, '#31495f', 'rgba(196,232,252,.6)', 14, 16, 0x1a3d)
    ridge(0.664, 0.112, '#22384c', 'rgba(168,212,240,.46)', 18, 20, 0x2b71)
    ridge(0.708, 0.09, '#132434', 'rgba(142,190,222,.34)', 22, 22, 0x3c99)
    ridge(0.742, 0.07, '#0a1622', 'rgba(124,172,208,.24)', 26, 24, 0x4dd3)

    // ---- valley mist pools IN FRONT of the ridge bases -------------------
    for (let i = 0; i < 22; i++) {
      const x = r() * W, y = H * (0.645 + r() * 0.085), rx = 120 + r() * 220, ry = 10 + r() * 17
      g.save()
      g.scale(1, ry / rx)
      radial(g, x, (y * rx) / ry, rx, [[0, `rgba(134,170,184,${0.05 + r() * 0.07})`], [1, 'rgba(110,148,162,0)']])
      g.restore()
    }

    this.staticFar = this.finalize(c)

    // ---- MID BAND: near mountain shoulder + dead tree (parallax 0.28) ----
    {
      const MW = Math.min(1920, Math.ceil(w * SS)), MH = Math.min(1080, Math.ceil(h * SS))
      const {c: mc, g: mg} = canvas(MW, MH)
      const rr = noise(0x77c1)
      const sy = (v: number) => v * MH
      const g0 = mg.createLinearGradient(0, sy(0.62), 0, sy(0.8))
      g0.addColorStop(0, '#1b2f40')
      g0.addColorStop(0.55, '#101d27')
      g0.addColorStop(1, '#070d14')
      mg.fillStyle = g0
      mg.beginPath()
      mg.moveTo(0, MH)
      mg.lineTo(0, sy(0.676))
      mg.bezierCurveTo(MW * 0.08, sy(0.652), MW * 0.18, sy(0.664), MW * 0.27, sy(0.688))
      mg.bezierCurveTo(MW * 0.38, sy(0.7), MW * 0.46, sy(0.666), MW * 0.56, sy(0.678))
      mg.bezierCurveTo(MW * 0.66, sy(0.69), MW * 0.77, sy(0.65), MW * 0.89, sy(0.662))
      mg.lineTo(MW, sy(0.676))
      mg.lineTo(MW, MH)
      mg.closePath()
      mg.fill()
      mg.strokeStyle = 'rgba(150,196,226,.24)'
      mg.lineWidth = 1.6
      mg.beginPath()
      mg.moveTo(0, sy(0.676))
      mg.bezierCurveTo(MW * 0.08, sy(0.652), MW * 0.18, sy(0.664), MW * 0.27, sy(0.688))
      mg.bezierCurveTo(MW * 0.38, sy(0.7), MW * 0.46, sy(0.666), MW * 0.56, sy(0.678))
      mg.bezierCurveTo(MW * 0.66, sy(0.69), MW * 0.77, sy(0.65), MW * 0.89, sy(0.662))
      mg.stroke()
      // near shoulder — a single dark mass in front, no village, no windows
      const kg = mg.createLinearGradient(0, sy(0.632), MW * 0.3, sy(0.78))
      kg.addColorStop(0, '#070e15')
      kg.addColorStop(1, '#12202c')
      mg.fillStyle = kg
      mg.beginPath()
      mg.moveTo(0, MH)
      mg.lineTo(0, sy(0.664))
      mg.quadraticCurveTo(MW * 0.1, sy(0.636), MW * 0.22, sy(0.706))
      mg.quadraticCurveTo(MW * 0.3, sy(0.734), MW * 0.4, sy(0.744))
      mg.lineTo(MW * 0.4, MH)
      mg.closePath()
      mg.fill()
      // dead tree: bare recursive limbs, moon rim on the trunk
      {
        const bx = 0.068 * MW, by = sy(0.648)
        mg.save()
        mg.translate(bx, by)
        mg.strokeStyle = '#05090e'
        mg.lineCap = 'round'
        const branch = (x: number, y: number, len: number, a: number, lw: number, d: number) => {
          const xx = x + Math.cos(a) * len, yy = y + Math.sin(a) * len
          mg.lineWidth = lw
          mg.beginPath()
          mg.moveTo(x, y)
          mg.quadraticCurveTo((x + xx) * 0.5 + Math.sin(d * 2.1) * len * 0.14, (y + yy) * 0.5, xx, yy)
          mg.stroke()
          if (d) {
            branch(xx, yy, len * 0.68, a - 0.36, lw * 0.62, d - 1)
            branch(xx, yy, len * 0.64, a + 0.4, lw * 0.58, d - 1)
          }
        }
        branch(0, 0, 0.092 * Math.min(MW, MH), -Math.PI * 0.52, Math.max(2.2, 0.011 * Math.min(MW, MH)), 3)
        mg.strokeStyle = 'rgba(190,226,248,.22)'
        mg.lineWidth = 1.2
        mg.beginPath()
        mg.moveTo(2, 0)
        mg.quadraticCurveTo(-0.02 * MW, -0.06 * MH, 0.012 * MW, -0.11 * MH)
        mg.stroke()
        mg.restore()
      }
      void rr
      this.staticMid = this.finalize(mc)
    }
  }

  /** pre-downsample a supersampled bake to exact screen size once — every
   *  later per-frame blit becomes a 1:1 copy instead of a bilinear resample */
  private finalize(src: HTMLCanvasElement): HTMLCanvasElement {
    if (src.width === this.w && src.height === this.h) return src
    const {c, g} = canvas(this.w, this.h)
    g.imageSmoothingEnabled = true
    g.drawImage(src, 0, 0, this.w, this.h)
    return c
  }

  /* ================= 3. WORLD BAKES (deck + garden + props) ============= */
  private bakeWorld() {
    this.bakeDeck()
    this.bakeGarden()
    this.bakeInn()
    this.bakeSakura()
    this.bakeWet()
  }

  /** THE ENGawa DECK — dry boards, one-point-perspective seams, moon sheen */
  private bakeDeck() {
    const {c, g} = canvas(ARENA_W, DECK_H)
    const grad = g.createLinearGradient(0, 0, 0, DECK_H)
    grad.addColorStop(0, '#4a5a63')
    grad.addColorStop(0.15, '#38464f')
    grad.addColorStop(0.55, '#212c34')
    grad.addColorStop(1, '#0e1419')
    g.fillStyle = grad
    g.fillRect(0, 0, ARENA_W, DECK_H)
    const r = noise(0x33b8)
    // ONE-POINT PERSPECTIVE FLOOR: board seams fan from a vanishing point
    // above the deck; cross-lines compress toward the horizon.
    const vpx = ARENA_W * 0.6, vpy = -470
    const vpt = -vpy / (DECK_H - 34 - vpy)
    for (let x = -260; x < ARENA_W + 300; x += 74) {
      g.strokeStyle = 'rgba(6,11,15,.5)'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(vpx + (x - vpx) * vpt, 0)
      g.lineTo(x, DECK_H - 34)
      g.stroke()
      g.strokeStyle = 'rgba(160,186,192,.06)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(vpx + (x + 2 - vpx) * vpt, 0)
      g.lineTo(x + 2, DECK_H - 34)
      g.stroke()
    }
    g.strokeStyle = 'rgba(6,11,15,.32)'
    g.lineWidth = 1.1
    for (const yy of [DECK_H - 34, 196, 152, 118, 92, 72, 57, 46, 38, 31, 26]) {
      g.beginPath()
      g.moveTo(0, yy)
      g.lineTo(ARENA_W, yy)
      g.stroke()
    }
    g.strokeStyle = 'rgba(172,194,198,.05)'
    g.lineWidth = 0.8
    for (let i = 0; i < 24; i++) {
      const x = r() * ARENA_W, y = r() * (DECK_H - 40), ln = 120 + r() * 260
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + ln * 0.24, y + ln)
      g.stroke()
    }
    // baked moonlit sheen along the board direction (live pool adds on top)
    g.globalCompositeOperation = 'screen'
    for (let i = 0; i < 30; i++) {
      const x = r() * ARENA_W, y = 8 + r() * (DECK_H - 52), ln = 90 + r() * 260
      g.fillStyle = `rgba(150,184,206,${0.03 + r() * 0.075})`
      g.fillRect(x, y, ln, 1.1 + r() * 2.4)
    }
    g.globalCompositeOperation = 'source-over'
    // stone foundation lip at the back edge
    const lip = g.createLinearGradient(0, 0, 0, 28)
    lip.addColorStop(0, '#1a2327')
    lip.addColorStop(1, '#0d1417')
    g.fillStyle = lip
    g.fillRect(0, 0, ARENA_W, 28)
    // 13 stepping stones sink into the boards between the pond and the inn
    const stones: [number, number, number][] = []
    for (let i = 0; i < 13; i++) stones.push([POND_X - 210 + i * 34, 26 + (i % 3) * 6, 15 + (i % 4)])
    for (const [x, y, rw] of stones) {
      g.fillStyle = 'rgba(58,70,74,.9)'
      g.beginPath()
      g.ellipse(x, y, rw, rw * 0.38, 0, 0, TAU)
      g.fill()
      g.strokeStyle = 'rgba(186,214,224,.22)'
      g.lineWidth = 1.1
      g.beginPath()
      g.ellipse(x, y - 1, rw * 0.92, rw * 0.3, 0, Math.PI * 1.05, Math.PI * 1.95)
      g.stroke()
    }
    this.deckPlate = c
  }

  /** GARDEN: yotsume-gaki fence, torii, stone lantern, pond edging */
  private bakeGarden() {
    const {c, g} = canvas(ARENA_W, GARDEN_H)
    const Y = (wy: number) => wy - GARDEN_TOP
    const r = noise(0x51d0)
    const moonRim = (x: number, y: number, w2: number, h2: number, a: number) => {
      const q = g.createLinearGradient(x + w2, y, x + w2 * 0.2, y)
      q.addColorStop(0, `rgba(158,198,222,${a})`)
      q.addColorStop(1, 'rgba(158,198,222,0)')
      g.fillStyle = q
      g.fillRect(x, y, w2, h2)
    }
    // --- bamboo fence between the props, behind the deck ------------------
    const runs: [number, number][] = [
      [430, LANTERN_X - 120], [LANTERN_X + 110, DOOR_X - 240],
      [DOOR_X + 250, POND_X - 250], [POND_X + 240, SAKURA_X - 250],
      [TORII_X + 90, 700],
    ]
    for (const [x0, x1] of runs) {
      if (x1 - x0 < 60) continue
      g.fillStyle = '#0b1114'
      for (let x = x0; x <= x1; x += 46) {
        g.fillRect(x - 3, Y(-96), 6, 96)
        g.fillStyle = 'rgba(130,160,174,.07)'
        g.fillRect(x + 1, Y(-94), 1.4, 92)
        g.fillStyle = '#0b1114'
      }
      g.fillRect(x0 - 4, Y(-88), x1 - x0 + 8, 7)
      g.fillRect(x0 - 4, Y(-50), x1 - x0 + 8, 7)
    }
    // --- torii gate (world 310) ------------------------------------------
    {
      const px0 = TORII_X - 74, px1 = TORII_X + 74
      g.fillStyle = '#0c1114'
      g.fillRect(px0 - 13, Y(-238), 26, 238)
      g.fillRect(px1 - 13, Y(-238), 26, 238)
      g.beginPath()
      g.moveTo(px0 - 78, Y(-262))
      g.quadraticCurveTo(TORII_X, Y(-274), px1 + 78, Y(-262))
      g.lineTo(px1 + 78, Y(-242))
      g.quadraticCurveTo(TORII_X, Y(-254), px0 - 78, Y(-242))
      g.closePath()
      g.fill()
      g.fillRect(px0 - 22, Y(-176), px1 - px0 + 44, 15)
      moonRim(px1 - 13, Y(-238), 13, 238, 0.2)
      moonRim(TORII_X, Y(-274), 78, 12, 0.16)
      g.strokeStyle = 'rgba(126,156,176,.12)'
      g.lineWidth = 1.4
      for (let i = 0; i < 14; i++) {
        const u = 0.1 + (i / 14) * 0.8
        const y = Y(-238 + u * 20)
        g.beginPath()
        g.moveTo(px0 - 8, y)
        g.lineTo(px0 + 8, y)
        g.stroke()
      }
    }
    // --- tall stone lantern (world 830): the STREET_LIGHT practical ------
    {
      const x = LANTERN_X
      g.fillStyle = '#10171a'
      g.fillRect(x - 50, Y(-28), 100, 28)
      g.fillRect(x - 23, Y(-156), 46, 130)
      g.fillRect(x - 34, Y(-240), 68, 86)
      // stone grain
      g.fillStyle = 'rgba(140,168,180,.06)'
      for (let i = 0; i < 26; i++) g.fillRect(x - 46 + r() * 92, Y(-250) + r() * 220, 2 + r() * 7, 1.6)
      // glowing core window (the practical's own source)
      const core = g.createRadialGradient(x, Y(-198), 4, x, Y(-198), 64)
      core.addColorStop(0, 'rgba(255,216,160,.86)')
      core.addColorStop(0.55, 'rgba(255,176,104,.32)')
      core.addColorStop(1, 'rgba(255,150,80,0)')
      g.fillStyle = core
      g.fillRect(x - 74, Y(-272), 148, 148)
      g.fillStyle = '#0d1215'
      g.fillRect(x - 15, Y(-220), 30, 46)
      g.fillStyle = 'rgba(255,210,152,.92)'
      g.fillRect(x - 11, Y(-216), 22, 38)
      // curved cap + finial
      g.fillStyle = '#10171a'
      g.beginPath()
      g.moveTo(x - 60, Y(-240))
      g.quadraticCurveTo(x, Y(-272), x + 60, Y(-240))
      g.lineTo(x + 42, Y(-230))
      g.lineTo(x - 42, Y(-230))
      g.closePath()
      g.fill()
      g.fillRect(x - 6, Y(-292), 12, 24)
      g.beginPath()
      g.arc(x, Y(-294), 7, 0, TAU)
      g.fill()
      moonRim(x + 22, Y(-240), 13, 86, 0.18)
    }
    // --- pond stone edging (world 2050), no water here: water is live -----
    {
      g.strokeStyle = '#131b1f'
      g.lineWidth = 14
      g.beginPath()
      g.ellipse(POND_X, POND_Y + 40, 196, 60, -0.04, 0, TAU)
      g.stroke()
      g.strokeStyle = 'rgba(142,172,184,.13)'
      g.lineWidth = 2
      g.beginPath()
      g.ellipse(POND_X, POND_Y + 33, 192, 56, -0.04, Math.PI * 1.05, Math.PI * 1.95)
      g.stroke()
      // moss tufts on the near stones
      g.fillStyle = 'rgba(30,52,44,.5)'
      for (let i = 0; i < 18; i++) {
        const a = r() * TAU
        g.beginPath()
        g.ellipse(POND_X + Math.cos(a) * 190, POND_Y + 40 + Math.sin(a) * 56, 8 + r() * 10, 3 + r() * 3, 0, 0, TAU)
        g.fill()
      }
    }
    this.gardenPlate = c
  }

  /** THE INN — the one detailed building (mountain-inn.js `paintHouse`) */
  private bakeInn() {
    const W = INN_X1 - INN_X0, H = INN_BOT - INN_TOP
    const {c, g} = canvas(W, H)
    g.translate(-INN_X0, -INN_TOP)
    g.lineJoin = 'round'
    g.lineCap = 'round'
    const r = noise(17000)
    const L = 1622, R = 1888, wallTop = -188
    const ridgeY = -278, eaveL = 1548, eaveR = 1962

    // ---- stone plinth + recessed stair treads + ground-contact shade ------
    {
      const q = g.createRadialGradient(DOOR_X, 0, 28, DOOR_X, 0, 250)
      q.addColorStop(0, 'rgba(0,2,5,.72)')
      q.addColorStop(1, 'rgba(0,2,5,0)')
      g.save()
      g.scale(1, 0.17)
      g.fillStyle = q
      g.fillRect(DOOR_X - 300, -300, 600, 120)
      g.restore()
    }
    g.fillStyle = '#293843'
    g.fillRect(L - 18, -12, R - L + 36, 22)
    g.strokeStyle = '#071018'
    g.lineWidth = 1.6
    for (let i = 0; i < 11; i++) {
      const x = L - 18 + i * ((R - L + 36) / 11)
      g.beginPath()
      g.moveTo(x, -12)
      g.lineTo(x + 5, 8)
      g.stroke()
    }
    for (let i = 3; i >= 0; i--) {
      const sw = 84 + i * 26, y = 4 + i * 4
      g.fillStyle = i % 2 ? '#52616a' : '#34434d'
      g.fillRect(DOOR_X - sw * 0.5, y, sw, 5)
      g.fillStyle = 'rgba(168,198,212,.3)'
      g.fillRect(DOOR_X - sw * 0.5, y, sw, 1.1)
    }

    // ---- cold plaster walls + visible timber framing ---------------------
    {
      const q = g.createLinearGradient(L, wallTop, R, 0)
      q.addColorStop(0, '#61717a')
      q.addColorStop(0.45, '#3d515e')
      q.addColorStop(1, '#182b39')
      g.fillStyle = q
      g.fillRect(L, wallTop, R - L, -wallTop)
      // recessed side return so the building has depth
      g.fillStyle = '#152331'
      poly(g, [[R, 0], [R + 16, -4], [R + 16, wallTop - 6], [R, wallTop]])
      g.fill()
      // timber posts
      for (const xx of [L, L + 66, L + 200, L + 266, R]) {
        g.fillStyle = '#0c1114'
        g.fillRect(xx - 7, wallTop, 14, -wallTop)
        g.fillStyle = 'rgba(134,164,179,.3)'
        g.fillRect(xx + 5, wallTop, 1.6, -wallTop)
      }
      // rails
      g.fillStyle = '#0c1114'
      g.fillRect(L, -48, R - L, 9)
      g.fillRect(L, wallTop + 24, R - L, 8)
      // plaster grain — vertical weathering, low contrast
      g.strokeStyle = 'rgba(10,22,32,.22)'
      g.lineWidth = 1
      for (let i = 0; i < 46; i++) {
        const x = L + r() * (R - L), y = wallTop + r() * 110, ln = 14 + r() * 44
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + (r() - 0.5) * 4, y + ln)
        g.stroke()
      }
    }

    // ---- warm shoji windows (dim side glazing) --------------------------
    for (const wx of [L + 30, R - 84]) {
      g.fillStyle = '#0a0e14'
      g.fillRect(wx - 3, -160, 60, 70)
      const q = g.createLinearGradient(wx, -160, wx + 54, -90)
      q.addColorStop(0, '#f3d79a')
      q.addColorStop(0.35, '#c99a5c')
      q.addColorStop(1, '#7d4a2c')
      g.fillStyle = q
      g.fillRect(wx, -157, 54, 64)
      g.fillStyle = '#14232b'
      for (let k = 1; k < 4; k++) g.fillRect(wx + (54 * k) / 4 - 0.8, -157, 1.6, 64)
      g.fillRect(wx, -127, 54, 1.7)
      // swung shutters
      g.fillStyle = '#17232c'
      g.fillRect(wx - 16, -162, 14, 72)
      g.fillRect(wx + 56, -162, 14, 72)
      g.strokeStyle = 'rgba(132,158,166,.35)'
      g.lineWidth = 0.9
      for (let k = 1; k < 6; k++) {
        const yy = -162 + (72 * k) / 6
        g.beginPath()
        g.moveTo(wx - 15, yy)
        g.lineTo(wx - 2, yy)
        g.moveTo(wx + 57, yy)
        g.lineTo(wx + 69, yy)
        g.stroke()
      }
      g.fillStyle = '#6d6048'
      g.fillRect(wx - 4, -93, 62, 3)
    }

    // ---- the shoji DOOR — the bright warm practical at DOOR_X -----------
    {
      const dw = 76, dh = 124, dx = DOOR_X - dw / 2
      g.fillStyle = '#080e15'
      g.fillRect(dx - 4, -dh - 4, dw + 8, dh + 8)
      const q = g.createLinearGradient(dx, -dh, dx + dw, 0)
      q.addColorStop(0, '#ffd9a5')
      q.addColorStop(0.55, '#eeb077')
      q.addColorStop(1, '#c98048')
      g.fillStyle = q
      g.fillRect(dx, -dh, dw, dh)
      g.strokeStyle = 'rgba(58,30,14,.6)'
      g.lineWidth = 2
      for (let i = 1; i < 4; i++) {
        g.beginPath()
        g.moveTo(dx + (i * dw) / 4, -dh)
        g.lineTo(dx + (i * dw) / 4, 0)
        g.stroke()
      }
      for (let i = 1; i < 5; i++) {
        g.beginPath()
        g.moveTo(dx, -dh + (i * dh) / 5)
        g.lineTo(dx + dw, -dh + (i * dh) / 5)
        g.stroke()
      }
      // noren curtain over the lintel
      g.fillStyle = 'rgba(36,52,84,.92)'
      g.fillRect(dx - 2, -dh - 6, dw + 4, 26)
      g.strokeStyle = 'rgba(168,190,214,.24)'
      g.lineWidth = 1
      for (let i = 0; i < 3; i++) {
        const x = dx + 4 + (i * (dw - 4)) / 3
        g.beginPath()
        g.moveTo(x, -dh - 4)
        g.lineTo(x, -dh + 20)
        g.stroke()
      }
      const glow = g.createRadialGradient(DOOR_X, -dh + 40, 6, DOOR_X, -dh + 40, 190)
      glow.addColorStop(0, 'rgba(255,190,126,.36)')
      glow.addColorStop(1, 'rgba(255,152,90,0)')
      g.fillStyle = glow
      g.fillRect(DOOR_X - 200, -dh - 96, 400, 340)
      // hearth glow inside the doorway
      const he = g.createLinearGradient(0, -8, 0, -46)
      he.addColorStop(0, 'rgba(255,214,140,.5)')
      he.addColorStop(1, 'rgba(255,150,70,0)')
      g.fillStyle = he
      g.fillRect(dx, -46, dw, 46)
    }

    // ---- overhanging roof: shared silhouette, 9 curved tile rows ---------
    {
      const roofPts: [number, number][] = [
        [eaveL, -178], [L - 40, -206], [L + 30, -250], [DOOR_X - 40, ridgeY - 6],
        [DOOR_X + 60, ridgeY], [R - 20, -252], [R + 44, -208], [eaveR, -178],
        [R - 6, -186], [DOOR_X + 20, -234], [DOOR_X - 30, -236], [L + 4, -186],
      ]
      const q = g.createLinearGradient(L - 60, ridgeY, R + 40, -178)
      q.addColorStop(0, '#122331')
      q.addColorStop(0.44, '#263f52')
      q.addColorStop(1, '#648396')
      g.fillStyle = q
      poly(g, roofPts)
      g.fill()
      g.save()
      poly(g, roofPts)
      g.clip()
      g.fillStyle = 'rgba(1,8,16,.26)'
      poly(g, [[eaveL - 20, -178], [DOOR_X, ridgeY - 30], [DOOR_X + 10, -250], [eaveL - 20, -168]])
      g.fill()
      for (let row = 1; row <= 9; row++) {
        const f = row / 9
        const y = ridgeY + f * (ridgeY * -1 - 178) * -1
        const yy = mixN(ridgeY, -178, f)
        const left = mixN(DOOR_X - 20, eaveL, f), right = mixN(DOOR_X + 70, eaveR, f)
        g.strokeStyle = 'rgba(1,9,17,.85)'
        g.lineWidth = 2.1
        g.beginPath()
        g.moveTo(left, yy + 1.5)
        g.quadraticCurveTo(DOOR_X, yy - 5, right, yy + 1.5)
        g.stroke()
        g.strokeStyle = 'rgba(172,208,224,.3)'
        g.lineWidth = 0.9
        g.beginPath()
        g.moveTo(left, yy - 0.6)
        g.quadraticCurveTo(DOOR_X, yy - 6, right, yy - 0.6)
        g.stroke()
        const n = 4 + row * 2
        for (let k = 0; k < n; k++) {
          const xx = left + ((right - left) * (k + 0.5)) / n
          g.strokeStyle = k % 3 ? 'rgba(5,15,24,.55)' : 'rgba(174,206,218,.28)'
          g.lineWidth = 0.95
          g.beginPath()
          g.moveTo(xx, yy - 10)
          g.quadraticCurveTo(xx + 2, yy - 5, xx + 4, yy)
          g.stroke()
        }
        void y
      }
      g.restore()
      g.strokeStyle = '#101d29'
      g.lineWidth = 6
      poly(g, roofPts)
      g.stroke()
      // moon rim along the moon-facing (right) roof plane
      g.strokeStyle = 'rgba(182,218,236,.66)'
      g.lineWidth = 1.8
      g.beginPath()
      g.moveTo(DOOR_X + 60, ridgeY)
      g.lineTo(R - 20, -252)
      g.lineTo(R + 44, -208)
      g.lineTo(eaveR, -178)
      g.stroke()
      // ridge caps
      g.strokeStyle = '#86a4b4'
      g.lineWidth = 3.6
      g.beginPath()
      g.moveTo(DOOR_X - 40, ridgeY - 4)
      g.lineTo(DOOR_X + 60, ridgeY)
      g.stroke()
      // deep brackets under the eaves
      g.strokeStyle = '#0b1721'
      g.lineWidth = 3
      for (let k = 0; k < 7; k++) {
        const xx = L + 8 + k * ((R - L - 16) / 7)
        g.beginPath()
        g.moveTo(xx, -186)
        g.lineTo(xx + 7, -198)
        g.lineTo(xx + 14, -186)
        g.stroke()
      }
    }

    // ---- chimney with stone courses -------------------------------------
    {
      const x0 = 1844, x1 = 1876, y0 = ridgeY + 4, y1 = -330
      g.fillStyle = '#40515d'
      g.fillRect(x0, y1, x1 - x0, y0 - y1)
      g.strokeStyle = '#0b1822'
      g.lineWidth = 1.8
      for (let i = 0; i < 5; i++) {
        const yy = y1 + 12 + i * ((y0 - y1 - 12) / 5)
        g.beginPath()
        g.moveTo(x0, yy)
        g.lineTo(x1, yy)
        g.stroke()
      }
      g.fillStyle = '#81919a'
      g.fillRect(x0 - 4, y1 - 4, x1 - x0 + 8, 5)
      g.fillStyle = 'rgba(198,220,232,.2)'
      g.fillRect(x1 - 5, y1, 4, y0 - y1)
    }

    // ---- hanging chochin lantern + vertical signboard -------------------
    {
      const lx = 1636
      g.strokeStyle = '#121e28'
      g.lineWidth = 2.4
      g.beginPath()
      g.moveTo(lx, -186)
      g.lineTo(lx, -164)
      g.stroke()
      const cho = g.createRadialGradient(lx, -140, 3, lx, -140, 36)
      cho.addColorStop(0, 'rgba(255,152,92,.92)')
      cho.addColorStop(0.6, 'rgba(180,58,38,.8)')
      cho.addColorStop(1, 'rgba(120,32,20,0)')
      g.fillStyle = cho
      g.beginPath()
      g.ellipse(lx, -140, 18, 26, 0, 0, TAU)
      g.fill()
      g.fillStyle = '#1c2528'
      g.fillRect(lx - 13, -170, 26, 8)
      g.fillRect(lx - 12, -114, 24, 7)
      g.fillStyle = '#6b5b3e'
      g.fillRect(1600, -178, 18, 78)
      g.strokeStyle = '#242b29'
      g.lineWidth = 1.2
      for (let k = 0; k < 4; k++) {
        const yy = -170 + k * 18
        g.beginPath()
        g.moveTo(1601, yy)
        g.lineTo(1617, yy + 2)
        g.stroke()
      }
    }
    this.innPlate = c
  }

  /** THE SAKURA — tapered S-curve limbs + 248-blossom rosette canopy */
  private bakeSakura() {
    const {c, g} = canvas(SAK_W, SAK_BOT - SAK_TOP)
    g.translate(-SAK_X0, -SAK_TOP)
    g.lineCap = 'round'
    const bx = SAKURA_X
    const r = noise(0x8341)
    /** canopy mass centre (world y) — the crown hangs off the upper limbs */
    const CANOPY_Y = -296

    // trunk: a living S-curve with two flared roots
    g.fillStyle = '#080c10'
    g.beginPath()
    g.moveTo(bx - 30, 6)
    g.quadraticCurveTo(bx - 12, -108, bx - 26, -214)
    g.lineTo(bx + 12, -216)
    g.quadraticCurveTo(bx + 26, -106, bx + 34, 6)
    g.closePath()
    g.fill()
    const limb = (x: number, y: number, x2: number, y2: number, w2: number, depth: number) => {
      const cx1 = x + (x2 - x) * 0.28 - w2 * 0.34
      const cy1 = y + (y2 - y) * 0.2
      const cx2 = x + (x2 - x) * 0.74 + w2 * 0.26
      const cy2 = y + (y2 - y) * 0.72
      g.strokeStyle = '#090c0f'
      g.lineWidth = w2
      g.beginPath()
      g.moveTo(x, y)
      g.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2)
      g.stroke()
      // moon rim on the upper-right side of every limb
      g.strokeStyle = 'rgba(140,176,196,.2)'
      g.lineWidth = Math.max(1, w2 * 0.13)
      g.beginPath()
      g.moveTo(x + w2 * 0.26, y)
      g.bezierCurveTo(cx1 + w2 * 0.26, cy1, cx2 + w2 * 0.26, cy2, x2 + w2 * 0.17, y2)
      g.stroke()
      if (depth > 0) {
        // Every child limb is SHORTER than its parent, thick, and curls
        // upward: the skeleton terminates INSIDE the crown, so the blossom
        // mass — never a wire — owns the silhouette. Foliage is what hides
        // a branch tip in real trees; the canopy does the same job here.
        limb(x2, y2, x2 - (30 + depth * 10), y2 - (36 + depth * 12), w2 * 0.64, depth - 1)
        limb(x2, y2, x2 + (32 + depth * 12), y2 - (26 + depth * 14), w2 * 0.6, depth - 1)
      }
    }
    limb(bx - 8, -202, bx - 36, -270, 25, 2)
    limb(bx + 4, -196, bx + 74, -262, 23, 2)
    limb(bx - 2, -168, bx - 118, -226, 20, 1)
    limb(bx + 12, -182, bx + 132, -212, 17, 1)

    // canopy: 248 rosettes in 8 elliptical clusters, three tonal layers so
    // the mass reads as a lit volume (dark underside → blown-out moon side)
    const clusters: readonly (readonly [number, number, number, number, number])[] = [
      [-0.082, -0.146, 0.038, 0.026, 26], [-0.05, -0.196, 0.044, 0.03, 36],
      [-0.014, -0.222, 0.047, 0.03, 42], [0.02, -0.224, 0.046, 0.03, 40],
      [0.054, -0.198, 0.042, 0.028, 34], [0.084, -0.158, 0.034, 0.024, 24],
      [-0.03, -0.152, 0.036, 0.022, 22], [0.03, -0.154, 0.036, 0.024, 22],
      // crown shoulders: two extra clusters so no limb tip can clear the mass
      [-0.098, -0.196, 0.03, 0.022, 18], [0.104, -0.2, 0.03, 0.022, 18],
      [-0.06, -0.232, 0.032, 0.02, 16], [0.066, -0.236, 0.032, 0.02, 16],
    ]
    const rosette = (x: number, y: number, rad: number, a: number) => {
      g.save()
      g.translate(x, y)
      g.rotate(a)
      // 5 petals + a warm stamen dot: at 8-16 world px the rosette reads as
      // a blossom cluster, and the dot keeps the mass from flattening out.
      for (let i = 0; i < 5; i++) {
        g.rotate(TAU / 5)
        g.beginPath()
        g.ellipse(0, -rad * 0.55, rad * 0.38, rad * 0.58, 0, 0, TAU)
        g.fill()
      }
      g.restore()
    }
    for (const [cx, cy, rx, ry, count] of clusters) {
      for (let i = 0; i < count; i++) {
        const ang = r() * TAU
        const d = Math.sqrt(r())
        // Canopy knots: the reference's normalized cluster table maps to a
        // world-space CROWN (≈380 px wide, ≈170 px tall) whose centre sits
        // on the upper limbs. Both axes use the SAME scale (1 400) so the
        // rosettes keep the reference's petal density instead of smearing
        // into a streak — one table, one transform, no per-axis fudge.
        const dx = bx + cx * 1560 + Math.cos(ang) * d * rx * 1560
        const dy = CANOPY_Y + (cy + 0.19) * 1400 + Math.sin(ang) * d * ry * 1560
        const bias = (dx - bx) * 0.0052 - (dy - CANOPY_Y) * 0.0044 + (r() - 0.5) * 0.5
        g.fillStyle = bias < -0.22 ? '#24182a' : bias < 0.25 ? '#a36884' : bias < 0.65 ? '#eab4ca' : '#ffeff6'
        rosette(dx, dy, 5.4 + r() * 7.2, r() * TAU)
      }
    }
    // 3 orb glows where the canopy catches the moon directly
    for (const [ox, oy, os] of [[-104, -34, 8], [26, -74, 7], [118, -22, 8]] as const) {
      const d = os * 3.8
      g.drawImage(this.orb!, bx + ox - d / 2, CANOPY_Y + oy - d / 2, d, d)
    }
    this.sakuraPlate = c
  }

  /** WET-DECK ROUGHNESS plate: matte islands chop the mirror, seams break it */
  private bakeWet() {
    const {c, g} = canvas(ARENA_W, 170)
    const r = noise(0x4ab2)
    for (let i = 0; i < 96; i++) {
      const x = r() * ARENA_W, y = r() * 170, rx = 26 + r() * 90, ry = 6 + r() * 14
      g.fillStyle = `rgba(12,18,22,${0.015 + r() * 0.028})`
      g.beginPath()
      g.ellipse(x, y, rx, ry, r() * 0.6, 0, TAU)
      g.fill()
    }
    for (let x = 0; x < ARENA_W; x += 78) {
      g.strokeStyle = 'rgba(8,13,16,.05)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(x + 10, 0)
      g.lineTo(x + 26, 170)
      g.stroke()
    }
    this.wetPlate = c
  }

  /* ====== 4. PROP-SHADOW CERTIFICATE (complete-footprint 0/1/2 SAT) ===== */
  /**
   * Bake the props' FORESHORTENED ground shadow into a world-space density
   * mask, then compile it into the integer `0 / 1 / 2` prefix SAT. The canopy
   * (foliage) is written into the green channel so `ShadowFieldSAT` classifies
   * those texels as UNCERTAIN — its penumbra is resolved by the 12-tap Poisson
   * disk, while the inn's timber (red channel) certifies as fully umbral.
   */
  private bakeShadowField() {
    const MW = 640, MH = 80
    const KX = MW / ARENA_W
    const KY = MH / 170
    const {c, g} = canvas(MW, MH)
    g.save()
    g.scale(KX, KY)
    g.translate(-ARENA_X0, 10)
    // ground-plane foreshortening: y' = -0.18*y + 2, x' = x + 0.654*y
    g.translate(0, 2)
    g.transform(1, 0, 0.654, -0.18, 0, 0)
    // hard structural occluders (red = certified opaque)
    g.fillStyle = '#f00'
    g.fillRect(1622, -188, 266, 188)
    poly(g, [[1548, -178], [1755, -278], [1962, -178], [1888, -186], [1755, -234], [1610, -186]])
    g.fill()
    g.fillRect(TORII_X - 87, -262, 174, 12)
    g.fillRect(TORII_X - 87, -238, 26, 238)
    g.fillRect(TORII_X + 61, -238, 26, 238)
    g.fillRect(LANTERN_X - 50, -28, 100, 28)
    g.fillRect(LANTERN_X - 23, -156, 46, 130)
    g.fillRect(LANTERN_X - 34, -240, 68, 86)
    // foliage: soft canopy → green channel (uncertain / penumbra)
    g.fillStyle = 'rgba(0,255,0,.72)'
    g.beginPath()
    g.ellipse(SAKURA_X - 10, -212, 210, 96, 0, 0, TAU)
    g.fill()
    g.restore()
    this.shadowMask = c
    this.shadowSAT.buildFromMask(c, [[(SAKURA_X - 220 + ARENA_X0) * KX, 2 * KY, 440 * KX, 260 * KY]], 2, 2)
  }

  /* ============================ 5. DRAW ================================ */
  private viewBounds(): [number, number] {
    const cx = Number.isFinite(this.lastCam.x) ? this.lastCam.x : 1300
    const cz = Number.isFinite(this.lastCam.zoom) && this.lastCam.zoom > 0 ? this.lastCam.zoom : 1
    const hw = this.w / (2 * cz) + 280
    return [cx - hw, cx + hw]
  }

  /**
   * HENYEY–GREENSTEIN MEDIA TRANSPORT (CPU path)
   * The cloud field lives in SCENE coordinates and is sampled at the moon's
   * scene position — the same field the art draws, so lighting can never
   * disagree with the picture. 2-slot temporal bracketing evaluates the field
   * at ~24 Hz and lerps, exactly like the WebGL2 `MEDIA_FS` pair.
   */
  private sampleTransmission(t: number): number {
    const mx = 0.74, my = 0.165
    const g = 0.62 // forward-scattering anisotropy of the moon-lit aerosol
    let tau = 0
    for (let k = 0; k < this.nCloud; k++) {
      const z = CLOUD_Z[k]
      const nx = this.cloudNx[k]
      const ny = my - 0.02 + (z - 0.5) * 0.1
      const cw = 0.3 + z * 0.24
      const ch = 0.075 + z * 0.05
      const dx = (nx + cw * 0.5 - mx) / cw
      const dy = (ny - my) / ch
      const box = 1 - Math.max(Math.abs(dx) - 0.82, 0) * 1.05
      if (box <= 0) continue
      const core = 1 - Math.min(1, (dx * dx + dy * dy) * 0.5)
      const dens = fbm3CPU(nx * 5.1 + t * 0.004, ny * 9.3 - 1.7)
      const d = core * dens * box * (0.66 + 0.28 * z)
      // HG phase for the scatter angle between the cloud and the disc
      const cosT = Math.max(-1, Math.min(1, 1 - Math.abs(dy)))
      const hg = ((1 - g * g) / Math.pow(1 + g * g - 2 * g * cosT, 1.5)) * 0.25
      tau += d * (0.9 + hg)
    }
    // Beer–Lambert extinction through the bank
    return Math.exp(-tau * 1.55)
  }

  drawSky(ctx: CanvasRenderingContext2D, cam: BgCam) {
    this.ensure()
    this.lastCam = cam
    const w = this.w, h = this.h, t = this.t
    const mx = w * 0.74 - cam.x * 0.02
    const my = h * 0.165 - (cam.y + 170) * 0.03

    // Moon screen anchor: a pure function of the camera (kept here; the
    // visibility FILTER itself advanced in update() on the visual clock —
    // see F03/F04 above).
    this.moonX = mx
    this.moonY = my

    const moonR = Math.max(96, Math.min(300, Math.min(w, h) * 0.2))
    const moonSize = moonR * 2

    // ---- CONTINUOUS SKY (plan F02 / CSS): baked invariant plates are
    // blitted LIVE every display frame. The old SkyVaultCache composite
    // hold (dt ≥ 0.22 s ≈ 4.3 Hz) froze cloud drift, shaft breathing, star
    // twinkle and storm motion inside the cache. Invariant artwork stays
    // cached at BAKE time (staticFar/staticMid/cloud/lunar/shaft sprites);
    // only their per-frame transforms run here.
    {
      const g = ctx
      g.save()
      g.drawImage(this.staticFar!, 0, 0, w, h)
      // ---- CLOUD BANKS BEHIND THE DISC (scene coords, shared gust) ------
      // Distant aerosol sits BEHIND the moon, so a bank can never paint a
      // black bar over the brightest object in frame. Only the nearest bank
      // re-crosses the disc (below) to sell the occlusion that the analytic
      // media transport is already measuring.
      const drawn: {x: number; y: number; cw: number; ch: number; z: number; near: number}[] = []
      for (let k = 0; k < this.nCloud; k++) {
        const z = CLOUD_Z[k]
        const cw = (0.4 + z * 0.26) * w
        const ch = (0.11 + z * 0.062) * h
        const x = this.cloudNx[k] * w - cam.x * (0.012 + 0.045 * z) - cw * 0.5
        const y = my - ch * 0.58 + (z - 0.5) * h * 0.09 + Math.sin(t * 0.045 + k * 1.7) * 12
        if (x + cw < -60 || x > w + 60) continue
        g.globalAlpha = 0.16 + 0.12 * z
        g.drawImage(this.cloud!, x, y, cw, ch)
        drawn.push({x, y, cw, ch, z, near: clamp01(1 - Math.abs(x + cw * 0.5 - mx) / (w * 0.55))})
      }
      g.globalAlpha = 1
      // ---- THE MOON: 640×640 crater-baked Lommel–Seeliger disc ----------
      // Two blits of the SAME bake: a 1.9× screen-blend aureole (Mie forward
      // scatter in the thin air) then the crisp disc on top. The reference
      // scene's distinctive glow comes from exactly this trick — one bake,
      // two blits, no second gradient.
      if (this.moonGlow) {
        // THREE concentric aureole blits of ONE glow sprite: tight core
        // bloom, mid halo, and a wide dim veil. Additive, so the corona
        // never muddies the disc's own contrast.
        g.globalCompositeOperation = 'screen'
        for (const [scale, a] of [[1.9, 0.5], [3.1, 0.22], [5.2, 0.1]] as const) {
          const halo = moonSize * scale
          g.globalAlpha = a * (0.3 + 0.7 * this.moonVis)
          g.drawImage(this.moonGlow, mx - halo * 0.5, my - halo * 0.5, halo, halo)
        }
        g.globalAlpha = 1
        g.globalCompositeOperation = 'source-over'
      }
      if (this.lunar) g.drawImage(this.lunar, mx - moonSize * 0.5, my - moonSize * 0.5, moonSize, moonSize)
      // ---- NEAREST BANK CROSSES THE DISC (real occlusion, low alpha) -----
      if (this.nCloud > 2) {
        const k = this.nCloud - 1
        const z = CLOUD_Z[k]
        const cw = (0.4 + z * 0.26) * w
        const ch = (0.11 + z * 0.062) * h
        const x = this.cloudNx[k] * w - cam.x * (0.012 + 0.045 * z) - cw * 0.5
        const y = my - ch * 0.58 + (z - 0.5) * h * 0.09 + Math.sin(t * 0.045 + k * 1.7) * 12
        if (x + cw > mx - moonSize * 0.6 && x < mx + moonSize * 0.6) {
          g.globalAlpha = 0.16
          g.drawImage(this.cloud!, x, y, cw, ch)
          g.globalAlpha = 1
        }
      }
      // ---- MOONLIT LINING: additive re-blit where a bank faces the disc ---
      g.globalCompositeOperation = 'lighter'
      for (const cd of drawn) {
        const a = cd.near * cd.near * (0.1 + 0.26 * this.moonVis) * (0.4 + 0.6 * cd.z)
        if (a > 0.004) {
          g.globalAlpha = a
          g.drawImage(this.cloudLit!, cd.x, cd.y, cd.cw, cd.ch)
        }
      }
      g.globalAlpha = 1
      g.globalCompositeOperation = 'source-over'
      // ---- CREPUSCULAR SHAFT FAN ----------------------------------------
      g.globalCompositeOperation = 'screen'
      const breathe = 1 + 0.04 * Math.sin(t * 0.31)
      g.globalAlpha = clamp01(this.moonVis * 0.46) * breathe
      g.drawImage(this.shaft!, mx - 360, my - 16 * (h / 720), 720 * (h / 720), 720 * (h / 720))
      if (this.moonVis > 0.5) {
        g.globalAlpha = clamp01((this.moonVis - 0.5) * 0.8) * breathe
        g.drawImage(this.shaft!, mx - 360, my - 16 * (h / 720), 720 * (h / 720), 720 * (h / 720))
      }
      g.globalAlpha = 1
      g.globalCompositeOperation = 'source-over'
      // ---- THE STORM ABOVE THE GARDEN -----------------------------------
      this.storm.drawSky(g)
      // ---- MID PARALLAX BAND (mountain shoulder + dead tree) ------------
      const my0 = Math.floor(h * 0.44), mh = h - my0
      const shift = Math.round(-(cam.x * 0.075) % w)
      g.drawImage(this.staticMid!, 0, my0, w, mh, shift, my0, w, mh)
      g.drawImage(this.staticMid!, 0, my0, w, mh, shift + (shift > 0 ? -w : w), my0, w, mh)
      // ---- STAR-FX LAYER (damage-lattice managed, half res) -------------
      this.drawStarField(t)
      if (this.skyFx) {
        g.globalCompositeOperation = 'lighter'
        g.drawImage(this.skyFx, 0, 0, w, h * 0.72)
        g.globalCompositeOperation = 'source-over'
      }
      // ---- LOW-STATURE VALLEY MIST SEAM (the live field is world-space) --
      g.globalAlpha = 0.07 * this.moonVis
      const off = (((t * -2.4 - cam.x * 0.06) % 1024) + 1024) % 1024
      for (let x = off - 1024; x < w; x += 1024) {
        g.drawImage(this.mistSprite!, x, my + h * 0.3, 1024, 240)
      }
      g.globalAlpha = 1
      g.restore()
    }

    // ---- TWO FLYING BIRDS over the sky (screen space, live) -------------
    this.drawBirds(ctx)
  }

  /** 120 twinkling stars + one periodic meteor, on a DamageSurface canvas */
  private drawStarField(t: number) {
    const g = this.skyFxCtx
    const layer = this.skyFx
    if (!g || !layer) return
    const SW = layer.width, SH = layer.height
    const n = this.quality === 'low' ? 48 : this.quality === 'medium' ? 84 : 120
    this.starDmg.begin(g, SW, SH, 1)
    g.globalCompositeOperation = 'source-over'
    // stars are addressed in SCENE space so they drift with the sky vault
    const cam = this.lastCam
    for (let i = 0; i < n; i++) {
      const sx = (((i * 173.3 + t * 0.6 - cam.x * 0.03) % (SW + 8)) + SW + 8) % (SW + 8)
      const sy = 4 + (((i * 97.7) % (SH * 0.92)) as number)
      const tw = 0.32 + 0.3 * Math.sin(t * (0.7 + (i % 3) * 0.23) + i * 2.1)
      const sz = 1 + (i % 5 === 0 ? 1.4 : 0.5)
      this.starDmg.markRect(sx - sz, sy - sz, sz * 2, sz * 2, 3)
      g.globalAlpha = tw * 0.62
      const d = sz * 4
      if (this.starSprite) g.drawImage(this.starSprite, sx - d * 0.5, sy - d * 0.5, d, d)
    }
    // meteor: one every ~7 s, sinusoidal envelope, damage-marked tail
    const period = 7.4
    const ph = t % period
    if (ph < 0.95) {
      const f = ph / 0.95
      const p0x = SW * 0.3, p0y = SH * 0.12
      const vx = SW * 0.36, vy = SH * 0.13
      const sx = p0x + vx * f, sy = p0y + vy * f
      const tail = Math.sin(f * Math.PI) * SW * 0.075
      const ex = sx - (vx / Math.hypot(vx, vy)) * tail
      const ey = sy - (vy / Math.hypot(vx, vy)) * tail
      this.starDmg.markRect(Math.min(sx, ex) - 4, Math.min(sy, ey) - 4, Math.abs(sx - ex) + 8, Math.abs(sy - ey) + 8, 4)
      const lg = g.createLinearGradient(sx, sy, ex, ey)
      const a = Math.sin(f * Math.PI) * 0.9
      lg.addColorStop(0, `rgba(255,250,255,${a})`)
      lg.addColorStop(1, 'rgba(135,215,255,0)')
      g.globalAlpha = 1
      g.strokeStyle = lg
      g.lineWidth = 1.6
      g.beginPath()
      g.moveTo(sx, sy)
      g.lineTo(ex, ey)
      g.stroke()
    }
    g.globalAlpha = 1
  }

  /** 2 flying birds — quadratic arcs across the sky with a flap envelope */
  private drawBirds(ctx: CanvasRenderingContext2D) {
    const w = this.w, h = this.h, t = this.t
    for (let i = 0; i < 2; i++) {
      const f = this.birdT[i] % 1
      const x = -60 + f * (w + 120)
      const y = h * (0.16 + i * 0.07) + Math.sin(f * 6 + i * 2.1) * 30
      const flap = Math.sin(t * (i ? 3.4 : 3.1) + i * 2.2)
      const s = 1 - i * 0.16
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(s, s)
      ctx.strokeStyle = 'rgba(26,38,52,.42)'
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-9, -4 * flap)
      ctx.quadraticCurveTo(-3, 2, 0, 0)
      ctx.quadraticCurveTo(3, 2, 9, -4 * flap)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(154,192,216,.16)'
      ctx.lineWidth = 0.9
      ctx.beginPath()
      ctx.moveTo(-8, -4 * flap - 1)
      ctx.quadraticCurveTo(-3, 1, 0, -0.8)
      ctx.stroke()
      ctx.restore()
    }
  }

  drawArena(ctx: CanvasRenderingContext2D) {
    this.ensure()
    const t = this.t
    const [viewLeft, viewRight] = this.viewBounds()

    // ---- DRY ENGawa: frustum-sliced boards (55% less pixel transport) ----
    blitWorldFrustum(ctx, this.deckPlate!, ARENA_X0, 0, viewLeft, viewRight, DECK_H)

    // ---- CLOUD SHADOWS ON THE GROUND (frustum-culled) -------------------
    {
      ctx.save()
      ctx.globalCompositeOperation = 'multiply'
      ctx.globalAlpha = 0.2
      for (let k = 0; k < this.nCloud; k++) {
        const z = CLOUD_Z[k]
        const cw = (0.4 + z * 0.26) * this.w * 1.4
        const x = (((this.cloudNx[k] * 2.1 * ARENA_W + z * 640 + t * 2.2) % (ARENA_W + 2400)) + ARENA_W + 2400) % (ARENA_W + 2400) - 1400
        if (x > viewRight || x + cw < viewLeft) continue
        ctx.drawImage(this.cloud!, x, -40, cw, 300)
      }
      ctx.restore()
    }

    // ---- GARDEN PROPS (fence / torii / lantern / pond edging) -----------
    blitWorldFrustum(ctx, this.gardenPlate!, ARENA_X0, GARDEN_TOP, viewLeft, viewRight, GARDEN_H)

    // ---- THE INN --------------------------------------------------------
    if (INN_X1 >= viewLeft && INN_X0 <= viewRight) {
      blitWorldFrustum(ctx, this.innPlate!, INN_X0, INN_TOP, viewLeft, viewRight, INN_BOT - INN_TOP)
    }

    // ---- THE SAKURA: canopy sway rides the shared gust carrier ----------
    if (SAKURA_X + SAK_W * 0.5 >= viewLeft && SAKURA_X - SAK_W * 0.5 <= viewRight) {
      const sway = this.wind[0] * 2.4 + Math.sin(t * 0.58) * 1.6
      ctx.save()
      ctx.translate(0, 0)
      blitWorldFrustum(ctx, this.sakuraPlate!, SAK_X0 + sway * 0.35, SAK_TOP, viewLeft, viewRight, SAK_BOT - SAK_TOP)
      ctx.restore()
    }

    // ---- LIVE WATER: 3 analytic gravity-capillary waves + 4 ripple slots -
    if (POND_X + 230 >= viewLeft && POND_X - 230 <= viewRight) this.drawWater(ctx, t)
  }

  /**
   * DRY-DECK + SCISSORED WATER SEPARATION.
   * The puddle is its own pass: a clipped ellipse mirror, three gravity–
   * capillary waves whose phase comes from the shared gust integral, a moon
   * glitter lane, and four ripple slots fed by landing petals. Nothing here
   * touches the dry board bake.
   */
  private drawWater(ctx: CanvasRenderingContext2D, t: number) {
    const gx = POND_X, gy = POND_Y
    const gust = this.wind[0] * 0.5 + this.windIntegralX * 0.02
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(gx, gy + 40, 186, 54, -0.04, 0, TAU)
    ctx.clip()
    // base mirror: the sky, not the deck
    const base = ctx.createLinearGradient(0, gy - 18, 0, gy + 96)
    base.addColorStop(0, 'rgba(10,20,30,.92)')
    base.addColorStop(0.5, 'rgba(16,32,44,.88)')
    base.addColorStop(1, 'rgba(6,14,22,.94)')
    ctx.fillStyle = base
    ctx.fillRect(gx - 200, gy - 20, 400, 124)
    // 3 analytic gravity–capillary waves (k, ω, amplitude) — WAVE_DATA.
    const waves: readonly (readonly [number, number, number, number])[] = [
      [0.055, 1.45, 7.0, 0.5],
      [0.104, 2.35, 4.2, 1.35],
      [0.183, 3.15, 2.4, 2.2],
    ]
    ctx.globalCompositeOperation = 'lighter'
    for (let wi = 0; wi < waves.length; wi++) {
      const [k, w, amp, ph] = waves[wi]
      ctx.strokeStyle = `rgba(${168 + wi * 12},${204 + wi * 10},${224},${0.16 - wi * 0.035})`
      ctx.lineWidth = 1.1
      for (let row = 0; row < 4; row++) {
        ctx.beginPath()
        const y0 = gy + 12 + row * 15
        for (let x = -190; x <= 190; x += 8) {
          const yy = y0 + Math.sin(x * k + t * w + ph + gust * 0.4) * amp * (0.4 + row * 0.16)
          if (x === -190) ctx.moveTo(gx + x, yy)
          else ctx.lineTo(gx + x, yy)
        }
        ctx.stroke()
      }
    }
    // moon glitter lane (the puddle's specular), breathing with the eclipse
    if (this.moonVis > 0.15 && this.glitter) {
      ctx.globalAlpha = this.moonVis * 0.75
      ctx.drawImage(this.glitter!, gx - 190, gy + 4, 380, 74)
      ctx.globalAlpha = 1
    }
    // 4 ripple slots (petals landing)
    for (let i = 0; i < 4; i++) {
      const age = this.ripples[i * 3 + 1]
      if (!(age < 3.2)) continue
      const rx = this.ripples[i * 3]
      const a = 1 - age / 3.2
      for (let ring = 0; ring < 2; ring++) {
        const rr = 6 + (age + ring * 0.5) * 34
        ctx.strokeStyle = `rgba(206,232,244,${a * (0.3 - ring * 0.12)})`
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.ellipse(rx, gy + 44, rr, rr * 0.32, 0, 0, TAU)
        ctx.stroke()
      }
    }
    ctx.restore()
    // near stone lip catches the moonlight
    ctx.strokeStyle = 'rgba(150,182,200,.24)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.ellipse(gx, gy + 40, 186, 54, -0.04, 0, TAU)
    ctx.stroke()
  }

  drawWetMask(ctx: CanvasRenderingContext2D) {
    this.ensure()
    const [viewLeft, viewRight] = this.viewBounds()
    blitWorldFrustum(ctx, this.wetPlate!, ARENA_X0, 10, viewLeft, viewRight, 170)
  }

  drawShaftMask(ctx: CanvasRenderingContext2D, cam: BgCam) {
    this.ensure()
    const cx = Number.isFinite(cam.x) ? cam.x : 0
    const cy = Number.isFinite(cam.y) ? cam.y : NOMINAL_Y
    const mx = this.w * 0.74 - cx * 0.02
    const my = this.h * 0.165 - (cy + 170) * 0.03
    if (this.lunar) {
      const s = Math.max(96, Math.min(300, Math.min(this.w, this.h) * 0.2)) * 2
      ctx.drawImage(this.lunar, mx - s * 0.5, my - s * 0.5, s, s)
    }
    const halo = ctx.createRadialGradient(mx, my, 20, mx, my, 320)
    halo.addColorStop(0, 'rgba(255,255,255,.85)')
    halo.addColorStop(0.4, 'rgba(255,255,255,.32)')
    halo.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = halo
    ctx.fillRect(mx - 330, my - 330, 660, 660)
    ctx.globalAlpha = 0.9
    for (let k = 0, nC = this.nCloud; k < nC; k++) {
      const z = CLOUD_Z[k]
      const cw = (0.4 + z * 0.26) * this.w
      const ch = (0.11 + z * 0.062) * this.h
      const x = this.cloudNx[k] * this.w - cx * (0.012 + 0.045 * z) - cw * 0.5
      const y = my - ch * 0.58 + (z - 0.5) * this.h * 0.09
      ctx.save()
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(this.cloud!, x, y, cw, ch)
      ctx.restore()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(0,0,0,.85)'
    ctx.fillRect(0, this.h * 0.62, this.w, this.h * 0.38)
  }

  /**
   * TYPED LIGHT RIG on the deck. The moon lane is modulated by the
   * complete-footprint SAT certificate: certified-lit ground costs 4 integer
   * lookups, certified-umbral costs the same, and only penumbra texels near
   * the inn/canopy silhouettes run the 12-tap Poisson disk — so the mirror
   * lane genuinely stops in the building's shadow instead of being painted
   * through it.
   */
  drawLightRig(ctx: CanvasRenderingContext2D, moonWorldX: number, _moonWorldY: number) {
    this.ensure()
    const t = this.t, cov = this.moonCover, li = this.lightningI()
    const [viewLeft, viewRight] = this.viewBounds()
    const key = keyLightFromStorm(li, this.lightningAz())

    // ---- MOON DIFFUSE POOL (frustum-clipped, SAT-modulated) -------------
    const poolA = (0.34 + 0.62 * clamp01(key.i)) * (1 - 0.92 * cov)
    if (poolA > 0.012) {
      const x0 = Math.max(ARENA_X0, viewLeft), x1 = Math.min(ARENA_X1, viewRight)
      if (x1 > x0) {
        const lightOnRight = key.dirX < 0
        const bx = lightOnRight ? ARENA_X1 : ARENA_X0, ex = lightOnRight ? ARENA_X0 : ARENA_X1
        const lean = ctx.createLinearGradient(bx, 0, ex, 0)
        lean.addColorStop(0, 'rgba(180,208,238,0.1)')
        lean.addColorStop(0.55, 'rgba(180,208,238,0.032)')
        lean.addColorStop(1, 'rgba(180,208,238,0)')
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = clamp01(key.i) * (1 - 0.92 * cov)
        ctx.fillStyle = lean
        ctx.fillRect(x0, -16, x1 - x0, 190)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
    }

    // ---- MOONLIGHT PATH: perspective specular lane on the wet mirror ----
    ctx.globalCompositeOperation = 'lighter'
    const glintA = clamp01(key.i) * (1 - cov) * 0.52
    if (glintA > 0.01) {
      const KX = 640 / ARENA_W, KY = 80 / 170
      const sat = this.shadowSAT
      const samples = this.quality === 'low' ? 8 : 16
      for (let i = 0; i < 16; i++) {
        const u = i / 15
        const y = -8 + u * u * 268
        const wpath = 26 + u * u * 320
        const jitter = Math.sin(t * 1.9 + i * 2.3) * 18 * (0.25 + u)
        const cx2 = moonWorldX + jitter
        // CERTIFICATE STEP: does this lane parcel fall in a prop shadow?
        let lit = 1
        if (i % (16 / samples) < 1 && sat.w > 0) {
          const sxp = (cx2 - ARENA_X0) * KX
          const syp = (Math.min(150, Math.max(0, y)) + 10) * KY
          lit = sat.sampleFootprint(sxp, syp, 5, 3, i * 0.7)
        }
        ctx.globalAlpha = glintA * (0.2 + 0.62 * u) * (0.74 + 0.26 * Math.sin(t * 1.7 + i * 1.1)) * (0.25 + 0.75 * lit)
        ctx.fillStyle = 'rgba(216,234,246,1)'
        ctx.fillRect(cx2 - wpath / 2, y, wpath, 1.6 + u * 2.2)
      }
    }

    const streak = (sx: number, sw: number, base: number) => {
      for (let k = 0; k < 7; k++) {
        const yy = -18 + k * 40, u = k / 6, wob = Math.sin(t * 1.4 + k * 1.9) * 7
        ctx.globalAlpha = base * (1 - u) * (0.72 + 0.28 * Math.sin(t * 2.1 + k * 2.6))
        ctx.fillStyle = 'rgba(255,180,120,1)'
        ctx.fillRect(sx + wob - (sw * (0.35 + 0.65 * u)) * 0.5, yy, sw * (0.35 + 0.65 * u), 24)
      }
    }
    // ---- DOOR PRACTICAL (frustum-culled) --------------------------------
    if (DOOR_X + 340 >= viewLeft && DOOR_X - 340 <= viewRight) {
      ctx.globalAlpha = 0.24 * (1 - 0.4 * cov) * (0.92 + 0.08 * Math.sin(t * 11.3))
      ctx.drawImage(this.warmPool!, DOOR_X - 330, -150, 660, 330)
      streak(DOOR_X - 30, 78, 0.3)
    }
    // ---- STONE LANTERN practical ----------------------------------------
    if (LANTERN_X + 280 >= viewLeft && LANTERN_X - 280 <= viewRight) {
      ctx.globalAlpha = 0.2 * (1 - 0.4 * cov) * (0.9 + 0.1 * Math.sin(t * 9.1 + 1.7))
      ctx.drawImage(this.warmPool!, LANTERN_X - 270, -370, 540, 420)
      streak(LANTERN_X, 56, 0.24)
    }
    // ---- HEARTH EMBERS rising from the inn doorway ----------------------
    if (DOOR_X + 200 >= viewLeft && DOOR_X - 200 <= viewRight) {
      const f = 0.88 + 0.12 * Math.sin(t * 7.3)
      ctx.globalAlpha = 0.7 * f
      ctx.fillStyle = 'rgba(255,190,112,1)'
      for (let e = 0; e < 9; e++) {
        const ph = (t * (0.32 + e * 0.03) + e * 0.17) % 1
        const ex = DOOR_X + Math.sin(t * 1.6 + e * 1.7) * 16 + (e - 4) * 5
        const ey = -18 - ph * 96
        ctx.globalAlpha = (1 - ph) * 0.62 * f
        ctx.fillRect(ex, ey, 1.8, 1.8)
      }
    }
    // ---- pond glint ------------------------------------------------------
    if (glintA > 0.01 && POND_X + 200 >= viewLeft && POND_X - 200 <= viewRight && this.glitter) {
      ctx.globalAlpha = glintA * 0.85
      ctx.drawImage(this.glitter!, POND_X - 190, POND_Y + 8, 380, 70)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  drawWeather(ctx: CanvasRenderingContext2D, cam: BgCam) {
    this.ensure()
    this.storm.setView(cam)
    this.storm.drawRain(ctx)
    const w = this.w, h = this.h, t = this.t
    const gust = this.windIntegralX

    // ---- GLOWING BLOSSOM PETALS (two-pass: additive glow, then body) ----
    const nP = this.nPetal
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < nP; i++) {
      const z = this.pz[i]
      const x = (((this.px[i] + t * (9 + 17 * z) + Math.sin(t * 0.7 + this.pp[i]) * 22 - gust * (2 + 4 * z)) % (w + 120)) + w + 120) % (w + 120) - 60
      const y = (this.py[i] + t * (7 + 13 * z)) % (h + 80) - 40
      if (y > h * 0.84) continue
      const gs = 5 + 11 * z
      ctx.globalAlpha = 0.24 + 0.5 * z
      ctx.drawImage(this.petalGlow!, x - gs, y - gs, gs * 2, gs * 2)
    }
    ctx.globalCompositeOperation = 'source-over'
    for (let i = 0; i < nP; i++) {
      const z = this.pz[i]
      const x = (((this.px[i] + t * (9 + 17 * z) + Math.sin(t * 0.7 + this.pp[i]) * 22 - gust * (2 + 4 * z)) % (w + 120)) + w + 120) % (w + 120) - 60
      const y = (this.py[i] + t * (7 + 13 * z)) % (h + 80) - 40
      if (y > h * 0.84) continue
      // (petal→pond ripple EVENTS generate in update() on the visual clock
      //  with a dedicated RNG — draw is a pure consumer, plan F14/M08)
      ctx.save()
      ctx.globalAlpha = 0.42 + 0.5 * z
      ctx.translate(x, y)
      ctx.rotate(t * (0.35 + z) + this.pr[i])
      const s = 3 + 7 * z
      ctx.drawImage(this.petal!, -s, -s * 0.55, s * 2, s * 1.1)
      ctx.restore()
    }

    // ---- 16 MIST BANKS (scene coordinates, gust-carried) ---------------
    for (let i = 0; i < this.nMist; i++) {
      const nx = (((this.mistN[i] + t * 0.0035 + this.windIntegralX * 0.0009) % 1.3) + 1.3) % 1.3 - 0.15
      const rx = this.mistR[i]
      const x = (nx - cam.x * 0.0004) * w
      const y = this.mistY[i] * h
      ctx.globalAlpha = this.mistA[i] * Math.min(1.2, 0.5 + this.moonVis)
      ctx.drawImage(this.mistSprite!, x - rx * w, y - rx * w * 0.4, rx * w * 2, rx * w * 0.8)
    }
    ctx.globalAlpha = 1

    // ---- FOREGROUND PARALLAX SILHOUETTES (fastest parallax layer) ------
    {
      const fs = (cam.x * 1.35) % (w + 360)
      ctx.fillStyle = 'rgba(5,10,14,.85)'
      for (let k = 0; k < 9; k++) {
        const x = ((((k * 167 + (k % 3) * 53 - fs) % (w + 360)) + w + 360) % (w + 360)) - 180
        if (k % 3 === 2) {
          const rw = 32 + ((k * 13) % 26)
          ctx.beginPath()
          ctx.ellipse(x, h - 10, rw, rw * 0.5, 0, 0, TAU)
          ctx.fill()
        } else {
          const hh = 68 + ((k * 37) % 86)
          ctx.beginPath()
          ctx.moveTo(x - 16, h)
          ctx.quadraticCurveTo(x - 6, h - hh * 1.25, x + 1, h - hh)
          ctx.quadraticCurveTo(x + 5, h - hh * 0.62, x + 8, h - hh * 0.92)
          ctx.quadraticCurveTo(x + 12, h - hh * 0.5, x + 18, h)
          ctx.fill()
        }
      }
    }
    // NOTE: no scene vignette here — Renderer.drawVignette owns the one
    // universal vignette for every level.
  }
}
