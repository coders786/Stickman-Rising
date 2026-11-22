import { BRIDGE_LIGHT, type BridgeFrame } from '../render/bridge-frame'
import { addRibbonSample, newRibbon, paintRibbonRows, RIBBON_LIFETIME, ribbonFade, sampleRibbon, trimRibbon, type Trail, type RibbonSegment } from './ribbon'
import { bridgeTrailTint, type BridgePost } from '../render/bridge-post'
export type { Trail } from './ribbon'
/** STICKMAN RISING — the FX engine.
 *
 * Everything spectacular lives here: slash-trail ribbons that follow the real
 * blade trajectory, dash afterimages, impact sparks, shockwave rings, ground
 * cracks, damage numbers, dismemberment debris, lightning arcs, screen flash.
 * All pooled — zero allocations during combat.
 */

import { makePose, Pose } from '../anim/pose'
import { PLAYER_SPEC, PLAYER_STYLE } from '../anim/skeleton'
import { makeFighterGeom, solveFighter3D, drawFighter3D, type FighterGeom } from '../anim/rig3d'
import { rgba, rand, clamp01, TAU } from '../core/utils'
import type { QualityLevel } from '../core/types'
import { LightningSystem, RayOpts, RayWorld } from './lightning'
import { getParticleLevel } from './particles1d'
import { SurfaceScope, hasPixels } from '../render/ledger'

/* ------------------------------------------------------------------ */

interface Particle {
  active: boolean
  x: number; y: number
  vx: number; vy: number
  age: number; life: number
  size: number
  color: string
  type: PType
  grav: number
  drag: number
  rot: number; vrot: number
  /** for 'arc' type: precomputed bolt polyline (x,y pairs) */
  pts: number[] | null
}

type PType = 'spark' | 'dot' | 'ember' | 'smoke' | 'streak' | 'arc' | 'shard' | 'rock'

interface Afterimage {
  active: boolean
  pose: Pose
  geom: FighterGeom | null
  needsSolve: boolean
  x: number; y: number
  face: number
  age: number; life: number
  color: string
  scale: number
  /** 0 = classic neon ghost (ability echoes); 1 = SHADOW silhouette with
   * rim light — the dash read: solid dark body + backlight leaking around
   * the trailing edge (drawn in drawSilhouettes, NOT the additive pass) */
  style: 0 | 1
  /** world-space travel dir X at capture (rim offset direction) */
  dirX: number
  /** rim highlight color (shadow style) */
  rim: string
  /** starting body alpha (per-ghost darkness — research: successively darker) */
  a0: number
}

interface Ring {
  active: boolean
  x: number; y: number
  r0: number; r1: number
  age: number; life: number
  color: string
  width: number
  squash: number
  /** Rotation of the squash axis, radians. A shockwave thrown by a swing is an
   *  ellipse ALONG the strike — a perfect circle is the single most "this is a
   *  UI element" shape a hit can produce. */
  axis: number
  /** The local light's colour on the wide pass ('': use `color`). See Flash.lit. */
  litColor?: string
}

export const BRIDGE_SPARK_LIMIT = 256, BRIDGE_SHOCKWAVE_LIMIT = 8
/** Only the mixed-type metadata lives in JS; all per-step scalars occupy
 * fixed packed slots. The views are constructed once, never in a fight. */
class SparkSlot implements Particle {
  active = false
  pts = null
  color = '#fff'
  type: PType = 'spark'
  constructor(private readonly data: Float32Array, private readonly offset: number) {}
  get x() { return this.data[this.offset + 0] }
  set x(v: number) { this.data[this.offset + 0] = v }
  get y() { return this.data[this.offset + 1] }
  set y(v: number) { this.data[this.offset + 1] = v }
  get vx() { return this.data[this.offset + 2] }
  set vx(v: number) { this.data[this.offset + 2] = v }
  get vy() { return this.data[this.offset + 3] }
  set vy(v: number) { this.data[this.offset + 3] = v }
  get age() { return this.data[this.offset + 4] }
  set age(v: number) { this.data[this.offset + 4] = v }
  get life() { return this.data[this.offset + 5] }
  set life(v: number) { this.data[this.offset + 5] = v }
  get size() { return this.data[this.offset + 6] }
  set size(v: number) { this.data[this.offset + 6] = v }
  get grav() { return this.data[this.offset + 7] }
  set grav(v: number) { this.data[this.offset + 7] = v }
  get drag() { return this.data[this.offset + 8] }
  set drag(v: number) { this.data[this.offset + 8] = v }
  get rot() { return this.data[this.offset + 9] }
  set rot(v: number) { this.data[this.offset + 9] = v }
  get vrot() { return this.data[this.offset + 10] }
  set vrot(v: number) { this.data[this.offset + 10] = v }
}
class WaveSlot implements Ring {
  active = false
  color = '#fff'
  litColor = ''
  constructor(private readonly data: Float64Array, private readonly offset: number) {}
  get x() { return this.data[this.offset + 0] }
  set x(v: number) { this.data[this.offset + 0] = v }
  get y() { return this.data[this.offset + 1] }
  set y(v: number) { this.data[this.offset + 1] = v }
  get r0() { return this.data[this.offset + 2] }
  set r0(v: number) { this.data[this.offset + 2] = v }
  get r1() { return this.data[this.offset + 3] }
  set r1(v: number) { this.data[this.offset + 3] = v }
  get age() { return this.data[this.offset + 4] }
  set age(v: number) { this.data[this.offset + 4] = v }
  get life() { return this.data[this.offset + 5] }
  set life(v: number) { this.data[this.offset + 5] = v }
  get width() { return this.data[this.offset + 6] }
  set width(v: number) { this.data[this.offset + 6] = v }
  get squash() { return this.data[this.offset + 7] }
  set squash(v: number) { this.data[this.offset + 7] = v }
  get axis() { return this.data[this.offset + 8] }
  set axis(v: number) { this.data[this.offset + 8] = v }
}

interface Crack {
  active: boolean
  x: number; y: number
  pts: number[]
  age: number; life: number
  color: string
}

interface DmgText {
  active: boolean
  x: number; y: number
  vx: number; vy: number
  str: string
  color: string
  size: number
  age: number; life: number
}

interface Debris {
  active: boolean
  x: number; y: number
  vx: number; vy: number
  rot: number; vrot: number
  len: number
  color: string
  age: number; life: number
}

/** Authored punctuation, never inferred from particle count or raw damage. */
export type ImpactBeat = 'guardBreak' | 'perfectParry' | 'execution' | 'bossDefeat'
interface ImpactFrame {
  x: number; y: number
  age: number; life: number
  color: string
  seed: number
}

/** POINT IMPACT FLASH — a pooled radial-gradient bloom + lens cross-flare
 * at the strike point: white-hot core melting into the weapon color, with
 * a shrinking horizontal/vertical lens streak. Additive camera-bloom
 * language layered UNDER the sparks (sparks ride on top of the bloom). */
interface Flash {
  active: boolean
  x: number; y: number
  age: number; life: number
  color: string
  heavy: boolean
  /** The strike's axis, radians. The bloom is thrown ALONG it (it is light
   *  leaving the blade), never as an even circle around the point. */
  axis: number
  /** How strongly this hit is standing in a practical: 0 = unlit, 1 = in the
   *  middle of the door's spill. The bloom takes that light's colour. */
  lit: number
  /** The light's colour as a packed rgb string, or '' when unlit. */
  litColor: string
}

/** HDR MOTION LINE — one clean velocity streak replacing the old particle
 * speed-streak train: a gradient smear along the travel vector with a
 * white-hot core and a leading glint. Deep contrast (transparent tail →
 * near-opaque head), additive — reads like bloom, not confetti. */
interface MotionLine {
  active: boolean
  x: number; y: number
  dx: number; dy: number // unit travel vector
  len: number
  age: number; life: number
  color: string
  tint: number
}

/** GROUND SHADOW SMEAR — the dark streak a dash leaves on the floor:
 * shadow-language grounding (a stretched contact ellipse fading under the
 * travel path), drawn UNDER the entities in source-over. */
interface ShadowSmear {
  active: boolean
  x: number
  w: number
  age: number; life: number
}

/* ------------------------------------------------------------------ */

const MAX_PARTICLES = 1500
function echoGeometry(a: Afterimage): FighterGeom {
  const geom = a.geom ??= makeFighterGeom()
  if (a.needsSolve) {
    solveFighter3D(a.pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
    a.needsSolve = false
  }
  return geom
}

/* ------------------------------------------------------------------ *
 * FLASH GLOW SPRITE CACHE (graphics + GC optimization).
 * Impact flashes used to build a fresh radial gradient per flash per
 * frame (native object + stop parsing). The gradient's shape never
 * changes — only its overall opacity — so each color is baked ONCE
 * into a 64px sprite at k=1 stops and reused via globalAlpha=k. The
 * cache is bounded (FIFO, 32 entries) and evicted canvases are shrunk
 * so the backing store is actually released.
 * ------------------------------------------------------------------ */
/** How much local light it takes for a hit to take that light's colour. The city
 *  bounce sits at ~0.2 and must NOT qualify — otherwise every strike anywhere on
 *  the roof comes out the same amber and the blade's own colour is never seen. */
const LIT_TAKEOVER = 0.35
const FLASH_GLOW_MAX = 32
function paintFlashGlow(g: CanvasRenderingContext2D, color: string, hot: boolean): void {
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  /* A HOT sprite has a white core; a COOL one is pure colour. The lobe of a hit
   * must be the COLOUR OF THE LIGHT IT HAPPENS IN — if every lobe carried its own
   * white core, every hit would read white no matter where it landed, which is
   * exactly the "circle appears" problem. */
  grad.addColorStop(0, hot ? rgba('#ffffff', 0.95) : rgba(color, 0.9))
  grad.addColorStop(hot ? 0.35 : 0.22, rgba(color, hot ? 0.55 : 0.42))
  grad.addColorStop(1, rgba(color, 0))
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
}

export class FX {
  private readonly flashSurfaces = new SurfaceScope('fx')
  private readonly flashGlowCache = new Map<string, HTMLCanvasElement>()

  private flashGlowSprite(color: string, hot = true): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null
    const key = hot ? color : `${color}|cool`
    const cache = this.flashGlowCache
    const hit = cache.get(key)
    if (hasPixels(hit)) return hit
    if (!hit && cache.size >= FLASH_GLOW_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) {
        this.flashSurfaces.release(oldest)
        cache.delete(oldest)
      }
    }
    const c = this.flashSurfaces.acquire(key, 64, 64, 'fx')
    const g = c.getContext('2d')
    if (!g) { this.flashSurfaces.release(key); cache.delete(key); return null }
    paintFlashGlow(g, color, hot)
    cache.set(key, c)
    return c
  }

  dispose(): void {
    this.flashSurfaces.releaseAll()
    this.flashGlowCache.clear()
    this.clear()
  }

  private particles: Particle[] = []
  private pFree: Particle[] = []
  private readonly sparkData = new Float32Array(BRIDGE_SPARK_LIMIT * 11)
  private readonly sparkFree = Array.from({ length: BRIDGE_SPARK_LIMIT }, (_, i) => new SparkSlot(this.sparkData, i * 11))
  private recycleParticle(p: Particle) {
    if (p instanceof SparkSlot) this.sparkFree.push(p)
    else this.pFree.push(p)
  }
  /** THE RAY-TRACED LIGHTNING ENGINE (fx/lightning.ts) — bolts that
   *  reflect off enemies/ground with real mirror laws, lose energy per
   *  bounce, restrike their jag and render as halo/mid/core channels. */
  lightning = new LightningSystem()
  private trails: Trail[] = []
  private tFree: Trail[] = []
  private afterimages: Afterimage[] = []
  private aFree: Afterimage[] = []
  private rings: WaveSlot[] = []
  private readonly waveData = new Float64Array(BRIDGE_SHOCKWAVE_LIMIT * 9)
  private readonly rFree = Array.from({ length: BRIDGE_SHOCKWAVE_LIMIT }, (_, i) => new WaveSlot(this.waveData, i * 9))
  private cracks: Crack[] = []
  private cFree: Crack[] = []
  private texts: DmgText[] = []
  private txtFree: DmgText[] = []
  private debris: Debris[] = []
  private dFree: Debris[] = []
  private beat: ImpactFrame | null = null
  private beatRest = 0
  private screenStrength = 1
  private focusMasks = new WeakMap<CanvasRenderingContext2D, CanvasGradient>()

  setScreenStrength(value: number): void {
    this.screenStrength = clamp01(value)
    if (!this.screenStrength) { this.beat = null; this.flashAlpha = 0 }
  }
  /** HDR velocity streaks (dash) */
  private lines: MotionLine[] = []
  private lFree: MotionLine[] = []
  /** ground shadow smears (dash) */
  private smears: ShadowSmear[] = []
  private smFree: ShadowSmear[] = []
  /** point impact flashes (bloom + lens cross) */
  private flashes: Flash[] = []
  /** WHAT LIGHT IS HERE? Wired once by the game to the background's light field
   *  (world/lightfield.ts). A hit near the stairwell blooms warm, a hit near the
   *  failing tube blooms cool, a hit in the dark stays the blade's own colour —
   *  which is the difference between an effect and a light. Null in tests and in
   *  any headless render, where it degrades to the unlit colour. */
  private lightSampler: ((x: number, y: number) => { color: string; k: number } | null) | null = null

  setLightSampler(fn: ((x: number, y: number) => { color: string; k: number } | null) | null): void {
    this.lightSampler = fn
  }
  private flFree: Flash[] = []

  /** chromatic aberration intensity (0..1) — edge lens strain on dashes
   * and heavy impacts; decays every update */
  caIntensity = 0

  /** screen flash */
  flashColor = '#ffffff'
  flashAlpha = 0
  private flashDecay = 3

  private qualityScale = 1
  private gore: 'energy' | 'blood' = 'energy'

  setQuality(q: QualityLevel): void {
    this.qualityScale = q === 'ultra' ? 1.15 : q === 'high' ? 1 : q === 'medium' ? 0.65 : 0.38
  }

  setGore(g: 'energy' | 'blood'): void {
    this.gore = g
  }

  clear(): void {
    // POOL LAW: every live entry returns to its free list exactly once;
    // the live arrays empty completely (no stranded corpses — clear() used
    // to deactivate in place, permanently leaking the slot AND the object)
    for (const p of this.particles) { p.active = false; this.recycleParticle(p) }
    this.particles.length = 0
    for (const t of this.trails) { t.active = false; this.tFree.push(t) }
    this.trails.length = 0
    for (const a of this.afterimages) { a.active = false; this.aFree.push(a) }
    this.afterimages.length = 0
    for (const r of this.rings) { r.active = false; this.rFree.push(r) }
    this.rings.length = 0
    for (const c of this.cracks) { c.active = false; this.cFree.push(c) }
    this.cracks.length = 0
    for (const t of this.texts) { t.active = false; this.txtFree.push(t) }
    this.texts.length = 0
    for (const d of this.debris) { d.active = false; this.dFree.push(d) }
    this.debris.length = 0
    for (const l of this.lines) { l.active = false; this.lFree.push(l) }
    this.lines.length = 0
    for (const s of this.smears) { s.active = false; this.smFree.push(s) }
    this.smears.length = 0
    for (const f of this.flashes) { f.active = false; this.flFree.push(f) }
    this.flashes.length = 0
    this.beat = null
    this.beatRest = 0
    // lightning bolts die with the world (pool slots recycle in update)
    this.lightning.clear()
    this.flashAlpha = 0
    this.caIntensity = 0
  }

  /* ---------------- particles ---------------- */

  private nextParticle(spark = false): Particle | null {
    // particle toggle (user-facing): OFF rejects every spawn at the gate,
    // so the pools never even grow while particles are disabled
    if (getParticleLevel() === 0 || this.particles.length >= MAX_PARTICLES) return null
    if (spark) {
      const s = this.sparkFree.pop()
      if (!s) return null
      s.active = true; this.particles.push(s)
      return s
    }
    let p = this.pFree.pop()
    if (!p) {
      p = {
        active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1,
        size: 2, color: '#fff', type: 'dot', grav: 0, drag: 0,
        rot: 0, vrot: 0, pts: null,
      }
    }
    // POOL LAW (M02): acquire registers in the LIVE set exactly once. An
    // expired particle was spliced OUT of `particles` into `pFree`; taking
    // it back without re-push left it active yet in neither list — invisible
    // and orphaned (the acquire/expire/reacquire probe witness).
    p.active = true
    this.particles.push(p)
    return p
  }

  private scaleCount(n: number): number {
    return Math.max(1, Math.round(n * this.qualityScale))
  }

  /** directional spark cone */
  sparks(x: number, y: number, dir: number, spread: number, count: number, color: string, speed = 320, life = 0.4): void {
    const n = this.scaleCount(count)
    for (let i = 0; i < n; i++) {
      const p = this.nextParticle(true)
      if (!p) return
      const a = dir + rand(-spread, spread)
      const sp = speed * rand(0.45, 1.25)
      p.x = x; p.y = y
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp
      p.age = 0; p.life = life * rand(0.6, 1.3)
      p.size = rand(1.4, 3.2)
      p.color = color
      p.type = 'spark'
      p.grav = 640
      p.drag = 2.4
      p.rot = 0; p.vrot = 0; p.pts = null
    }
  }

  /** radial burst */
  burst(x: number, y: number, count: number, color: string, speed = 260, life = 0.5, type: PType = 'dot'): void {
    // LOW keeps impact feedback (dot) but drops the dense ambient types
    if (getParticleLevel() === 1 && (type === 'smoke' || type === 'shard' || type === 'ember')) return
    const n = this.scaleCount(count)
    for (let i = 0; i < n; i++) {
      const p = this.nextParticle(type === 'spark')
      if (!p) return
      const a = rand(TAU)
      const sp = speed * rand(0.3, 1.2)
      p.x = x; p.y = y
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp
      p.age = 0; p.life = life * rand(0.7, 1.4)
      p.size = rand(1.6, 3.6)
      p.color = color
      p.type = type
      p.grav = type === 'ember' ? -160 : 420
      p.drag = 2.8
      p.rot = 0; p.vrot = 0; p.pts = null
    }
  }

  /** rising embers / element motes */
  embers(x: number, y: number, count: number, color: string, spread = 40): void {
    if (getParticleLevel() < 2) return // ambient motes: FULL only
    const n = this.scaleCount(count)
    for (let i = 0; i < n; i++) {
      const p = this.nextParticle()
      if (!p) return
      p.x = x + rand(-spread, spread)
      p.y = y + rand(-spread, spread) * 0.6
      p.vx = rand(-24, 24)
      p.vy = rand(-90, -30)
      p.age = 0; p.life = rand(0.5, 1.1)
      p.size = rand(1.2, 2.6)
      p.color = color
      p.type = 'ember'
      p.grav = -60
      p.drag = 0.6
      p.rot = 0; p.vrot = 0; p.pts = null
    }
  }

  /** smoke / dust puff */
  dust(x: number, y: number, count: number, color = '#3a4756', up = -60): void {
    if (getParticleLevel() < 2) return // dense puff: FULL only
    const n = this.scaleCount(count)
    for (let i = 0; i < n; i++) {
      const p = this.nextParticle()
      if (!p) return
      const a = rand(Math.PI) + Math.PI // upper half
      const sp = rand(30, 130)
      p.x = x + rand(-14, 14)
      p.y = y + rand(-4, 4)
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp * 0.6 + up
      p.age = 0; p.life = rand(0.4, 0.9)
      p.size = rand(3, 7)
      p.color = color
      p.type = 'smoke'
      p.grav = -20
      p.drag = 3
      p.rot = 0; p.vrot = 0; p.pts = null
    }
  }

  /** Angular ground fragments thrown opposite the power dash, never toward it. */
  groundShatter(x:number,dir:number,count:number):void {
    const n=this.scaleCount(count),back=dir>=0?-1:1
    for(let i=0;i<n;i++){
      const p=this.nextParticle();if(!p)return
      p.x=x+rand(-6,6);p.y=-rand(1,5)
      p.vx=back*rand(100,390);p.vy=-rand(100,310)
      p.age=0;p.life=rand(.45,.9);p.size=rand(2.5,6)
      p.color=i%2?'#80909a':'#52606a';p.type='rock'
      p.grav=900;p.drag=.35;p.rot=rand(TAU);p.vrot=rand(-12,12);p.pts=null
    }
  }

  /** horizontal speed streaks (dashes) */
  speedStreaks(x: number, y: number, dx: number, count: number, color: string): void {
    const n = this.scaleCount(count)
    for (let i = 0; i < n; i++) {
      const p = this.nextParticle()
      if (!p) return
      p.x = x + rand(-26, 26)
      p.y = y + rand(-46, 6)
      p.vx = dx * rand(0.4, 1.1)
      p.vy = 0
      p.age = 0; p.life = rand(0.14, 0.3)
      p.size = rand(8, 26)
      p.color = color
      p.type = 'streak'
      p.grav = 0; p.drag = 0.5
      p.rot = 0; p.vrot = 0; p.pts = null
    }
  }

  /** jagged lightning bolt between two points — thin wrapper over the
   * ray-traced renderer (decorative arc, no reflectors) */
  lightningArc(x0: number, y0: number, x1: number, y1: number, color: string, segments = 6): void {
    void segments
    this.lightning.arc(x0, y0, x1, y1, color)
    // spark burst at both ends
    this.sparks(x1, y1, Math.atan2(y1 - y0, x1 - x0), 0.7, 5, color, 240, 0.3)
  }

  /** RAY-TRACED LIGHTNING: cast a reflecting bolt into the world. The
   * ray bounces off enemy bodies (damage per impact, scaled by remaining
   * energy) and the wet ground, chains with intent (reflection candidates
   * are scored against the next live target), and dies on energy/bounce
   * budget — every bounce stamps a white-hot contact node. */
  lightningCast(w: RayWorld, x: number, y: number, dx: number, dy: number, opts: RayOpts): void {
    this.lightning.cast(w, x, y, dx, dy, opts)
  }

  /** TESLA CRAWL: micro-arcs snapping along the blade steel while the
   * thunder sword charges — grip → monouchi, restriking at ~15Hz */
  lightningCrawl(bx: number, by: number, tx: number, ty: number, color: string): void {
    this.lightning.crawl(bx, by, tx, ty, color)
  }

  /** Read-only packet: emit from confirmed hit cores and live lightning
   * geometry, not from the luminance of a rendered pixel. */
  bridgeEmitters(frame: BridgeFrame): void {
    for (let i = this.flashes.length - 1, n = 0; i >= 0 && n < 3; i--) {
      const f = this.flashes[i], shine = Math.pow(Math.max(0, 1 - f.age / Math.min(.126, f.life)), 1.3)
      if (frame.light(BRIDGE_LIGHT.impulse, f.x, f.y, f.heavy ? 212 : 148, f.litColor || f.color, shine * (f.heavy ? 3.4 : 2.2), f.heavy ? 5 : 3)) n++
    }
    this.lightning.bridgeEmitters(frame)
    for (let i = this.trails.length - 1, n = 0; i >= 0 && n < 3; i--) {
      const t = this.trails[i], arc = t.opticalArc, fade = ribbonFade(t)
      if (!arc || !t.active || t.age > .126 || fade < .14) continue
      frame.strikeArc(arc.x, arc.y, arc.radius, arc.angle, arc.sweep, t.color, fade * 3.4, Math.max(1.5, t.width * 4.5))
      n++
    }
  }

  /** impact flash + directional sparks + micro ring */
  impact(x: number, y: number, dir: number, heavy: boolean, color: string, accent: string): void {
    this.pointFlash(x, y, color, heavy, dir)
    this.sparks(x, y, dir, heavy ? 0.9 : 0.6, heavy ? 16 : 9, color, heavy ? 480 : 340, heavy ? 0.55 : 0.35)
    this.sparks(x, y, dir, 0.4, heavy ? 6 : 3, '#ffffff', heavy ? 620 : 420, 0.2)
    const r = this.nextRing()
    if (r) {
      r.x = x; r.y = y
      r.r0 = heavy ? 8 : 5
      r.r1 = heavy ? 78 : 40
      r.age = 0; r.life = heavy ? 0.3 : 0.2
      r.color = heavy ? color : accent
      r.width = heavy ? 5 : 3
      // Squashed along the swing, and squashed more the heavier the hit: a
      // heavy connecting blow throws a flat, fast wave, a light one a rounder
      // blip.
      r.squash = heavy ? 0.62 : 0.78
      r.axis = dir
      // The wave in the air is lit BY THE ROOM: inside the stairwell's spill the
      // ring is warm, out in the dark it is the blade's own colour.
      const ls = this.lightSampler ? this.lightSampler(x, y) : null
      r.litColor = ls && ls.k > LIT_TAKEOVER ? ls.color : ''
    }
    if (heavy) {
      this.burst(x, y, 8, accent, 200, 0.4, 'shard')
    }
    // motion-blur streaks: short HDR velocity lines shrapneling out of the
    // hit (bright outer head, fade back toward the core — reads as the
    // shockwave's fast debris, reuses the dash motion-line renderer)
    const streaks = this.scaleCount(heavy ? 4 : 2)
    for (let i = 0; i < streaks; i++) {
      const a = dir + rand(-0.85, 0.85)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const L = rand(14, heavy ? 34 : 22)
      this.motionLine(x + ca * L, y + sa * L, ca, sa, L, rand(0.12, 0.2), i % 2 === 0 ? '#ffffff' : accent)
    }
  }

  /** pooled point bloom + lens cross at the strike point (drawn in drawAdditive) */
  private pointFlash(x: number, y: number, color: string, heavy: boolean, axis: number): void {
    if (this.flashes.length > 6) return
    const f = this.flFree.pop() ?? {
      active: false, x: 0, y: 0, age: 0, life: 0.16, color: '#fff', heavy: false,
      axis: 0, lit: 0, litColor: '',
    }
    f.active = true
    f.x = x; f.y = y
    f.age = 0; f.life = heavy ? 0.18 : 0.13
    f.color = color
    f.heavy = heavy
    f.axis = axis
    // ASK THE FIELD. A flash that ignores the place it happens in is the reason
    // hit feedback read as "a circle appears": the colour was always the
    // weapon's, even when the strike landed inside a lit doorway.
    const s = this.lightSampler ? this.lightSampler(x, y) : null
    f.lit = s ? Math.max(0, Math.min(1, s.k)) : 0
    f.litColor = s && s.k > LIT_TAKEOVER ? s.color : ''
    this.flashes.push(f)
  }

  /** dismemberment: spinning limb debris + gore burst */
  dismember(x: number, y: number, dir: number, bodyColor: string, accent: string): void {
    const gore = this.gore === 'blood'
    const n = this.scaleCount(6)
    for (let i = 0; i < n; i++) {
      const d = this.dFree.pop() ?? {
        active: false, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, len: 10, color: '#fff', age: 0, life: 1,
      }
      d.active = true
      d.x = x; d.y = y - rand(0, 40)
      const a = dir + rand(-0.9, 0.9)
      const sp = rand(220, 560)
      d.vx = Math.cos(a) * sp
      d.vy = -rand(120, 420)
      d.rot = rand(TAU)
      d.vrot = rand(-16, 16)
      d.len = rand(9, 22)
      d.color = i % 3 === 0 ? accent : bodyColor
      d.age = 0; d.life = rand(1.2, 2.2)
      this.debris.push(d)
    }
    this.burst(x, y - 20, gore ? 18 : 14, gore ? '#c31432' : accent, 380, 0.7, gore ? 'dot' : 'spark')
    if (!gore) this.burst(x, y - 20, 10, '#ffffff', 300, 0.4, 'spark')
  }

  /** Execution breakup: 8–12 compact silhouette sections separate along the
   * recorded alternating cut normals. Unlike dismember(), this is a delayed
   * controlled slide first, then gravity—not a radial grenade burst. */
  executionPieces(x:number,y:number,dir:number,bodyColor:string,accent:string,count=10):void {
    const gore=this.gore==='blood'
    const n=this.scaleCount(Math.max(8,Math.min(12,count)))
    for(let i=0;i<n;i++){
      const d=this.dFree.pop()??{active:false,x:0,y:0,vx:0,vy:0,rot:0,vrot:0,len:10,color:'#fff',age:0,life:1}
      const row=i%5, side=i%2===0?-1:1
      d.active=true
      d.x=x+side*(3+Math.floor(i/5)*5)
      d.y=y-14-row*13
      // Alternating plane normals preserve the cross-hatched cut map.
      d.vx=dir*side*(70+row*18)
      d.vy=-35-row*16
      d.rot=(side*.18)+(row-2)*.06
      d.vrot=side*(2.2+row*.55)
      d.len=12+(i%3)*5
      d.color=i%4===0?accent:bodyColor
      d.age=0;d.life=1.35+(i%4)*.13
      this.debris.push(d)
    }
    this.burst(x,y-38,gore?14:8,gore?'#c31432':accent,190,.52,gore?'dot':'spark')
  }

  /** enemy death dissolve */
  dissolve(x: number, y: number, color: string, accent: string): void {
    this.burst(x, y - 30, 16, color, 260, 0.6, 'ember')
    this.burst(x, y - 30, 10, accent, 320, 0.45, 'spark')
    const r = this.nextRing()
    if (r) {
      r.x = x; r.y = y - 30
      r.r0 = 6; r.r1 = 60
      r.age = 0; r.life = 0.34
      r.color = accent
      r.width = 4
      r.squash = 1
      r.axis = 0
    }
  }

  /* ---------------- shockwaves / cracks / text ---------------- */

  private nextRing(): Ring | null {
    const r = this.rFree.pop()
    if (!r) return null
    r.axis = 0; r.litColor = ''
    // POOL LAW (M02): recycled rings rejoin the live set (see nextParticle).
    r.active = true
    this.rings.push(r)
    return r
  }

  shockwave(x: number, y: number, radius: number, color: string, life = 0.42, width = 6): void {
    const r = this.nextRing()
    if (!r) return
    r.x = x; r.y = y
    r.r0 = 10; r.r1 = radius
    r.age = 0; r.life = life
    r.color = color
    r.width = width
    r.squash = 0.32 // ground ring
    // debris flecks
    this.sparks(x, y - 4, -Math.PI / 2, 1.2, 10, color, 300, 0.5)
    this.dust(x, y, 10)
  }

  groundCrack(x: number, y: number, size: number, color = '#0b0f14'): void {
    const c = this.cFree.pop() ?? {
      active: false, x: 0, y: 0, pts: [] as number[], age: 0, life: 1, color: '#0b0f14',
    }
    c.active = true
    c.x = x; c.y = y
    c.age = 0; c.life = 5
    c.color = color
    const pts: number[] = [0, 0]
    const branches = 3
    for (let b = 0; b < branches; b++) {
      let a = rand(TAU)
      if (b === 0) a = 0
      if (b === 1) a = Math.PI
      let px = 0, py = 0
      const segs = 3
      for (let s = 0; s < segs; s++) {
        a += rand(-0.5, 0.5)
        px += Math.cos(a) * size * rand(0.24, 0.4)
        py += Math.sin(a) * size * rand(0.08, 0.16)
        pts.push(px, py)
      }
    }
    c.pts = pts
    this.cracks.push(c)
  }

  text(x: number, y: number, str: string, color: string, size = 15): void {
    if (this.texts.length > 60) return
    const t = this.txtFree.pop() ?? {
      active: false, x: 0, y: 0, vx: 0, vy: 0, str: '', color: '#fff', size: 15, age: 0, life: 1,
    }
    t.active = true
    t.x = x + rand(-6, 6); t.y = y
    t.vx = rand(-30, 30)
    t.vy = rand(-150, -100)
    t.str = str
    t.color = color
    t.size = size
    t.age = 0; t.life = 0.85
    this.texts.push(t)
  }

  screenFlash(color: string, alpha: number, decay = 3): void {
    this.flashColor = color
    this.flashAlpha = Math.max(this.flashAlpha, Math.min(0.16, alpha) * this.screenStrength)
    this.flashDecay = decay
  }

  /** register chromatic lens strain (dash launches, heavy connects) */
  chroma(intensity: number): void {
    this.caIntensity = Math.max(this.caIntensity, Math.min(1, intensity))
  }

  /** A second contact in the same cleave/combo cannot restart or queue a pulse. */
  impactFrame(x: number, y: number, color: string, kind: ImpactBeat): boolean {
    if (!this.screenStrength || this.beatRest > 0) return false
    const finale = kind === 'execution' || kind === 'bossDefeat'
    this.beat = { x, y, color, age: 0, life: finale ? 0.20 : 0.16, seed: rand(TAU) }
    this.beatRest = finale ? 2.4 : 1.6
    return true
  }

  /* ---------------- afterimages ---------------- */

  private captureEcho(pose: Pose, x: number, y: number, face: number, life: number, scale: number): Afterimage | null {
    if (this.afterimages.length > 40) return null
    const a: Afterimage = this.aFree.pop() ?? {
      active: false, pose: makePose(), geom: null, needsSolve: true,
      x: 0, y: 0, face: 1, age: 0, life: 0.3, color: '#fff', scale: 1,
      style: 0, dirX: 1, rim: '#ffffff', a0: 0.44,
    }
    a.active = true
    a.pose.set(pose)
    // Freeze this pose at emission; solve at its first paint, not once per
    // frame or at the expense of the action step that launched the dash.
    a.needsSolve = true
    a.x = x; a.y = y
    a.face = face
    a.age = 0; a.life = life
    a.scale = scale
    this.afterimages.push(a)
    return a
  }

  afterimage(pose: Pose, x: number, y: number, face: number, color: string, life = 0.34, scale = 1): void {
    const a = this.captureEcho(pose, x, y, face, life, scale)
    if (!a) return
    a.color = color
    a.style = 0
  }

  /** SHADOW-SILHOUETTE dash ghost: the body captured as a dark figure with
   * a backlit rim leaking around the trailing edge — replaces the old neon
   * ghost + particle clutter on dashes (shadows & light, not confetti).
   * a0 = starting body darkness (0.5 → 0.24 down the trail: each ghost successively darker — HDR value layering). */
  shadowGhost(pose: Pose, x: number, y: number, face: number, dirX: number, rim: string, life = 0.3, scale = 1, a0 = 0.44): void {
    const a = this.captureEcho(pose, x, y, face, life, scale)
    if (!a) return
    a.color = '#03060c'
    a.style = 1
    a.dirX = dirX >= 0 ? 1 : -1
    a.rim = rim
    a.a0 = a0
  }

  /* ---------------- HDR motion line / ground shadow smear ---------------- */

  /** ONE clean velocity streak along the travel vector (replaces the old
   * 6–10 particle speed-streak train). */
  motionLine(x: number, y: number, dx: number, dy: number, len: number, life: number, color: string): void {
    const l = this.lFree.pop() ?? {
      active: false, x: 0, y: 0, dx: 0, dy: 0, len: 0, age: 0, life: 0.25, color: '#fff', tint: 0,
    }
    l.active = true
    const m = Math.hypot(dx, dy) || 1
    l.x = x; l.y = y
    l.dx = dx / m; l.dy = dy / m
    l.len = len
    l.age = 0; l.life = life
    l.color = color; l.tint = bridgeTrailTint(color)
    this.lines.push(l)
  }

  /** dark contact streak on the ground under a dash path */
  shadowSmear(x: number, w: number, life = 0.5): void {
    const s = this.smFree.pop() ?? { active: false, x: 0, w: 0, age: 0, life: 0.5 }
    s.active = true
    s.x = x
    s.w = w
    s.age = 0; s.life = life
    this.smears.push(s)
  }

  /* ---------------- slash trails ---------------- */

  startTrail(color: string, color2: string, width: number): Trail {
    const t = this.tFree.pop() ?? newRibbon()
    t.active = t.emitting = true
    t.head = t.count = t.age = t.clock = 0
    t.life = RIBBON_LIFETIME
    t.color = color
    t.color2 = color2
    t.width = width
    t.opticalArc = undefined
    this.trails.push(t)
    return t
  }

  pushTrail(t: Trail, bx: number, by: number, tx: number, ty: number): void {
    addRibbonSample(t, bx, by, tx, ty)
  }

  endTrail(t: Trail, life = RIBBON_LIFETIME): void {
    if (!t.active || !t.emitting) return
    t.emitting = false
    t.age = 0
    t.life = Math.min(life, RIBBON_LIFETIME)
  }

  /** Echoed and cinematic slashes use the same small curved ribbon. */
  slashArc(x: number, y: number, angle: number, spread: number, radius: number, color: string, color2: string, width = 1): void {
    const t = this.startTrail(color, color2, width)
    t.opticalArc = { x, y, angle, sweep: spread, radius }
    const steps = 9
    for (let i = 0; i <= steps; i++) {
      const a = angle - spread * .5 + spread * i / steps
      const dx = Math.cos(a) * radius, dy = Math.sin(a) * radius
      this.pushTrail(t, x + dx * .25, y + dy * .25, x + dx, y + dy)
    }
    this.endTrail(t)
  }

  /* ---------------- update ---------------- */

  /** THE POOL LAW (fixed): an expired entry is SPLICED out of its live
   * array and pushed to the free list exactly ONCE. The old pattern
   * (active=false + push-to-free, no splice) left corpses in the live
   * arrays aging forever, re-pushing to the free list EVERY FRAME, and
   * duplicating objects on every recycle — after ~6 dashes the
   * afterimages array crossed its >40 cap and ALL dash ghosts silently
   * died; particles hit MAX_PARTICLES the same way mid-run. */
  update(dt: number, realDt = dt): void {
    // ray-traced lightning (restrike timers + lifetimes)
    this.lightning.update(dt)
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      if (!p.active) continue
      p.age += dt
      if (p.age >= p.life) {
        p.active = false
        this.particles.splice(i, 1)
        this.recycleParticle(p)
        continue
      }
      p.vy += p.grav * dt
      const dr = 1 - p.drag * dt
      p.vx *= dr > 0 ? dr : 0
      p.vy *= dr > 0 ? dr : 0
      p.x += p.vx * dt
      p.y += p.vy * dt
      if(p.type==='rock'){
        p.rot+=p.vrot*dt
        if(p.y>0){p.y=0;p.vy=-Math.abs(p.vy)*.25;p.vx*=.7}
      }
    }
    // trails
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i]
      if (!t.active) continue
      trimRibbon(t, realDt)
      if (!t.emitting) {
        t.age += realDt
        if (t.age >= t.life || t.count === 0) {
          t.active = false
          this.trails.splice(i, 1)
          this.tFree.push(t)
        }
      }
    }
    // afterimages
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const a = this.afterimages[i]
      if (!a.active) continue
      a.age += dt
      if (a.age >= a.life) {
        a.active = false
        this.afterimages.splice(i, 1)
        this.aFree.push(a)
      }
    }
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      if (!r.active) continue
      r.age += dt
      if (r.age >= r.life) {
        r.active = false
        this.rings.splice(i, 1)
        this.rFree.push(r)
      }
    }
    // cracks
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i]
      if (!c.active) continue
      c.age += dt
      if (c.age >= c.life) {
        c.active = false
        this.cracks.splice(i, 1)
        this.cFree.push(c)
      }
    }
    // texts
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]
      if (!t.active) continue
      t.age += dt
      if (t.age >= t.life) {
        t.active = false
        this.texts.splice(i, 1)
        this.txtFree.push(t)
        continue
      }
      t.vy += 320 * dt
      t.x += t.vx * dt
      t.y += t.vy * dt
    }
    // debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]
      if (!d.active) continue
      d.age += dt
      if (d.age >= d.life) {
        d.active = false
        this.debris.splice(i, 1)
        this.dFree.push(d)
        continue
      }
      d.vy += 900 * dt
      d.x += d.vx * dt
      d.y += d.vy * dt
      d.rot += d.vrot * dt
      if (d.y > 0) {
        d.y = 0
        d.vy *= -0.42
        d.vx *= 0.6
        d.vrot *= 0.5
        if (Math.abs(d.vy) < 40) d.vy = 0
      }
    }
    // flash
    if (this.flashAlpha > 0) {
      this.flashAlpha -= this.flashDecay * realDt
      if (this.flashAlpha < 0) this.flashAlpha = 0
    }
    // chromatic strain decay
    if (this.caIntensity > 0) {
      this.caIntensity = Math.max(0, this.caIntensity - dt * 3.4)
    }
    // Presentation uses real seconds: hitstop must not hold a screen effect.
    this.beatRest = Math.max(0, this.beatRest - realDt)
    if (this.beat) {
      this.beat.age += realDt
      if (this.beat.age >= this.beat.life) this.beat = null
    }
    // point impact flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      if (!f.active) continue
      f.age += dt
      if (f.age >= f.life) {
        f.active = false
        this.flashes.splice(i, 1)
        this.flFree.push(f)
      }
    }
    // HDR motion lines
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i]
      if (!l.active) continue
      l.age += dt
      if (l.age >= l.life) {
        l.active = false
        this.lines.splice(i, 1)
        this.lFree.push(l)
      }
    }
    // ground shadow smears
    for (let i = this.smears.length - 1; i >= 0; i--) {
      const s = this.smears[i]
      if (!s.active) continue
      s.age += dt
      if (s.age >= s.life) {
        s.active = false
        this.smears.splice(i, 1)
        this.smFree.push(s)
      }
    }
  }

  /* ---------------- draw passes ---------------- */

  /** ground layer: cracks + debris + shadow smears (under entities) */
  drawUnder(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    // shadow smears — the dash's dark trail on the floor
    for (const s of this.smears) {
      if (!s.active) continue
      const k = 1 - s.age / s.life
      ctx.fillStyle = rgba('#010308', 0.32 * k)
      ctx.beginPath()
      ctx.ellipse(s.x, 3.5, s.w * (0.62 + 0.38 * k), 5 * k + 1.6, 0, 0, TAU)
      ctx.fill()
      // dense contact core
      ctx.fillStyle = rgba('#010308', 0.3 * k)
      ctx.beginPath()
      ctx.ellipse(s.x, 3.5, s.w * 0.34, 2.8 * k + 1.1, 0, 0, TAU)
      ctx.fill()
    }
    // cracks
    for (const c of this.cracks) {
      if (!c.active) continue
      const a = 1 - c.age / c.life
      ctx.strokeStyle = rgba('#000000', a * 0.5)
      ctx.lineWidth = 3
      drawCrack(ctx, c)
      ctx.strokeStyle = rgba('#39505f', a * 0.4)
      ctx.lineWidth = 1.2
      drawCrack(ctx, c)
    }
    // Solid, spinning stone chips, drawn in the ground layer rather than
    // as glowing sparks. They bounce and settle on the same floor plane.
    if (getParticleLevel() > 0)
    for(const p of this.particles){
      if(!p.active||p.type!=='rock')continue
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot)
      ctx.fillStyle=rgba(p.color,1-p.age/p.life);ctx.beginPath()
      ctx.moveTo(-p.size,-p.size*.25);ctx.lineTo(-p.size*.35,-p.size)
      ctx.lineTo(p.size*.8,-p.size*.65);ctx.lineTo(p.size,p.size*.25)
      ctx.lineTo(-p.size*.25,p.size*.6);ctx.closePath();ctx.fill();ctx.restore()
    }
    // debris
    ctx.lineCap = 'round'
    for (const d of this.debris) {
      if (!d.active) continue
      const a = 1 - d.age / d.life
      ctx.strokeStyle = rgba(d.color, a)
      ctx.lineWidth = 3.4
      const c = Math.cos(d.rot) * d.len / 2
      const s = Math.sin(d.rot) * d.len / 2
      ctx.beginPath()
      ctx.moveTo(d.x - c, d.y - s)
      ctx.lineTo(d.x + c, d.y + s)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** SHADOW SILHOUETTES — the dash afterimage pass: solid dark figures
   * (source-over, so they genuinely DARKEN the scene like cast shadows)
   * with a backlit rim leaking around the trailing edge (additive crescent).
   * Drawn AFTER the entities, BEFORE the additive layer — the player runs
   * ahead of their own shadow trail. */
  drawSilhouettes(ctx: CanvasRenderingContext2D): void {
    let any = false
    for (const a of this.afterimages) {
      if (a.active && a.style === 1) { any = true; break }
    }
    if (!any) return
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const a of this.afterimages) {
      if (!a.active || a.style !== 1) continue
      const k = 1 - a.age / a.life
      ctx.save()
      ctx.translate(a.x, a.y)
      ctx.scale(a.face * a.scale, a.scale)
      const geom = echoGeometry(a)
      // shadow body — solid dark, source-over (a real cast shadow)
      drawFighter3D(ctx, geom, PLAYER_STYLE, {
        ghost: '#02050b',
        ghostAlpha: (a.a0 ?? 0.44) * k,
      })
      // backlight rim — the bright crescent on the trailing edge: the same
      // silhouette offset opposite the travel vector (local x mirrors by
      // face; world px → local units via the transform scale)
      const rimLocal = (-a.dirX * a.face * 2.3) / a.scale
      ctx.globalCompositeOperation = 'lighter'
      ctx.save()
      ctx.translate(rimLocal, 0)
      drawFighter3D(ctx, geom, PLAYER_STYLE, {
        ghost: a.rim,
        ghostAlpha: 0.07 * k,
      })
      ctx.restore()
      ctx.restore()
    }
    ctx.restore()
  }

  /** additive layer: afterimages, trails, motion lines, particles, rings */
  drawAdditive(ctx: CanvasRenderingContext2D, time: number, blade?: RibbonSegment & { trail: Trail }, hdr = false,
    post?: BridgePost, field?: BridgeFrame): void {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    // RAY-TRACED LIGHTNING — halo/mid/core channels + bounce nodes +
    // branches, restriking at ~15Hz (drawn under the sparks so the node
    // impact bursts ride ON the channel)
    this.lightning.draw(ctx, time)

    // afterimages (ghost stickmen) — style 0 only; shadow silhouettes live
    // in drawSilhouettes (they must darken, not add)
    for (const a of this.afterimages) {
      if (!a.active || a.style !== 0) continue
      const k = 1 - a.age / a.life
      ctx.save()
      ctx.translate(a.x, a.y)
      ctx.scale(a.face * a.scale, a.scale)
      drawFighter3D(ctx, echoGeometry(a), PLAYER_STYLE, {
        ghost: a.color,
        ghostAlpha: k * 0.5,
        time,
      })
      ctx.restore()
    }

    // Sample each world-space ribbon only once. Latest first when the
    // bounded native mesh fills; Canvas consumes the same scratch rows.
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i], rows = sampleRibbon(t, t === blade?.trail ? blade : undefined)
      if (hdr && field) field.ribbon(t, rows)
      paintRibbonRows(ctx, t, rows, hdr)
    }

    // Local shutter trails, not ghosts of previous screen frames. A single
    // atlas blit carries the feather, color and core. Keep a sharp cue for
    // reduced motion or if the optional surface could not be reserved.
    if (!field) {
      // Other arenas keep their existing look. The cached, bounded shutter
      // treatment below belongs only to the Bridge route.
      for (const l of this.lines) {
        if (!l.active) continue
        const k = 1 - l.age / l.life, grow = .35 + .65 * (1 - k)
        const tx = l.x - l.dx * l.len * grow, ty = l.y - l.dy * l.len * grow
        const band = ctx.createLinearGradient(tx, ty, l.x, l.y)
        band.addColorStop(0, rgba(l.color, 0)); band.addColorStop(.72, rgba(l.color, .38 * k)); band.addColorStop(1, rgba(l.color, .9 * k))
        ctx.strokeStyle = band; ctx.lineWidth = 4.6; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(l.x, l.y); ctx.stroke()
        ctx.strokeStyle = rgba('#ffffff', .5 * k); ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(tx + (l.x - tx) * .4, ty + (l.y - ty) * .4); ctx.lineTo(l.x, l.y); ctx.stroke()
        ctx.fillStyle = rgba('#ffffff', .85 * k); ctx.beginPath(); ctx.arc(l.x, l.y, 2.1, 0, TAU); ctx.fill()
      }
    } else {
      const view = field.view
      for (let i = this.lines.length - 1, drawn = 0; i >= 0 && drawn < 16; i--) {
        const l = this.lines[i]
        if (!l.active) continue
        const k = clamp01(1 - l.age / l.life)
        if (k <= .015) continue
        const len = Math.min(190, l.len * (1 - .57 * k))
        const tx = l.x - l.dx * len, ty = l.y - l.dy * len
        if (Math.max(l.x, tx) + 22 < view.left || Math.min(l.x, tx) - 22 > view.right ||
            Math.max(l.y, ty) + 22 < view.top || Math.min(l.y, ty) - 22 > view.bottom) continue
        drawn++
        if (!field.quiet && post?.streak(ctx, l.tint, l.x, l.y, l.dx, l.dy, len, k)) continue
        ctx.globalAlpha = .55 * k
        ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo((tx + l.x) * .5, (ty + l.y) * .5); ctx.lineTo(l.x, l.y); ctx.stroke()
      }
    }
    ctx.globalAlpha = 1

    // point impact flashes — radial bloom + lens cross (camera-bloom
    // language, under the sparks so sparks ride on top of the bloom).
    // The bloom is a cached sprite blit (k=1 stops baked, alpha = k) —
    // no per-flash gradient allocation.
    for (const f of this.flashes) {
      if (!f.active) continue
      const k = 1 - f.age / f.life
      const r = (f.heavy ? 46 : 26) * (0.5 + 0.5 * k)
      /* A HIT IS A LIGHT, NOT A STICKER.
       *
       * The old bloom was one circular blit at the impact point, identical in
       * every situation, which reads exactly as what it is: a circle appearing.
       * Three things make it read as light:
       *
       *   1. DIRECTION. Light leaves the blade along the strike axis. The bloom
       *      is therefore an ELLIPSE stretched along `axis` (1.75 : 0.72) — a
       *      forward lobe into the target, a short tail back toward the sword.
       *   2. COLOUR FROM THE PLACE. Inside a practical it takes that light's
       *      colour (`lit`), because the hit is happening IN that light.
       *   3. A HOT CORE. A small round sprite at 0.5 r on top of the lobe: real
       *      light has a core much harder than its falloff, and without one an
       *      elongated blob just looks like a smear.
       *
       * Still two cached blits, no gradient, no allocation. */
      // 0.35, not 0.15: the CITY BOUNCE is always present (~0.2) and if it
      // qualified, every hit anywhere on the roof would come out the same amber
      // and the blade's own colour would never be seen. Only standing in an
      // actual practical changes what colour the hit is.
      const coreColor = f.litColor || f.color
      /* LOCAL EXPOSURE. Your eye (and a camera) barely registers a new light in a
       * place that is already bright — and additively, a full-strength bloom on
       * top of a lit doorway just clips to white, which is the "grey circle"
       * everybody reads as an effect. So the flash is DIMMED by the light it
       * happens in: full strength in the dark, ~55 % inside a practical. */
      const expo = 1 - 0.45 * Math.min(1, f.lit)
      const lobe = this.flashGlowSprite(coreColor, false)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.translate(f.x, f.y)
      if (f.axis) ctx.rotate(f.axis)
      ctx.scale(2.15, 0.5)
      if (lobe) {
        ctx.globalAlpha = k * 0.62 * expo
        ctx.drawImage(lobe, -r, -r, r * 2, r * 2)
      }
      // The CORE takes the light's colour too when the hit is in one: a hot
      // filament in a warm room is warm-white, not cyan. Out in the dark the
      // blade's own colour is the only light there is, so it keeps it.
      const core = this.flashGlowSprite(f.litColor || f.color)
      if (core) {
        ctx.globalAlpha = k * expo
        const cr = r * 0.38
        // undo the scale so the core stays round in world space
        ctx.scale(1 / 2.15, 1 / 0.5)
        ctx.drawImage(core, -cr, -cr, cr * 2, cr * 2)
      }
      ctx.restore()
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      // LENS CROSS — along the strike axis, not screen-horizontal: a flare
      // through a lens is perpendicular to the camera's, and this one belongs to
      // the hit, so it follows the swing.
      const s = (f.heavy ? 30 : 18) * k * k
      const ca = f.axis || 0
      const cx = Math.cos(ca) * s
      const cy = Math.sin(ca) * s
      ctx.strokeStyle = rgba('#ffffff', 0.45 * k)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(f.x - cx, f.y - cy)
      ctx.lineTo(f.x + cx, f.y + cy)
      ctx.moveTo(f.x + cy * 0.6, f.y - cx * 0.6)
      ctx.lineTo(f.x - cy * 0.6, f.y + cx * 0.6)
      ctx.stroke()
    }

    // particles + rings — gated by the particle toggle (OFF skips both;
    // they die in update() and the pools recycle as usual)
    const pLevel = getParticleLevel()
    if (pLevel > 0)
    for (const p of this.particles) {
      if (!p.active) continue
      const k = 1 - p.age / p.life
      switch (p.type) {
        case 'rock': break // rendered as solid chips in the ground layer
        case 'spark': {
          ctx.strokeStyle = rgba(p.color, k)
          ctx.lineWidth = p.size * 0.8
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03)
          ctx.stroke()
          break
        }
        case 'streak': {
          ctx.strokeStyle = rgba(p.color, k * 0.5)
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * 0.08, p.y)
          ctx.stroke()
          break
        }
        case 'ember': {
          const fl = 0.6 + 0.4 * Math.sin(p.age * 30 + p.x)
          ctx.fillStyle = rgba(p.color, k * fl)
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * (0.7 + k * 0.5), 0, TAU)
          ctx.fill()
          break
        }
        case 'smoke': {
          ctx.fillStyle = rgba(p.color, k * 0.24)
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, TAU)
          ctx.fill()
          break
        }
        case 'shard': {
          ctx.strokeStyle = rgba(p.color, k)
          ctx.lineWidth = 2
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.age * 9)
          ctx.beginPath()
          ctx.moveTo(-p.size, 0)
          ctx.lineTo(p.size, 0)
          ctx.stroke()
          ctx.restore()
          break
        }
        case 'arc': {
          if (p.pts) {
            const fl = k * (0.7 + 0.3 * Math.sin(time * 60 + p.x))
            ctx.strokeStyle = rgba(p.color, fl)
            ctx.lineWidth = p.size
            ctx.beginPath()
            ctx.moveTo(p.pts[0], p.pts[1])
            for (let i = 2; i < p.pts.length; i += 2) {
              ctx.lineTo(p.pts[i], p.pts[i + 1])
            }
            ctx.stroke()
            ctx.strokeStyle = rgba('#ffffff', fl * 0.8)
            ctx.lineWidth = 1
            ctx.stroke()
          }
          break
        }
        default: {
          ctx.fillStyle = rgba(p.color, k)
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, TAU)
          ctx.fill()
        }
      }
    }

    // rings
    if (pLevel > 0)
    for (const r of this.rings) {
      if (!r.active) continue
      const k = 1 - r.age / r.life
      const rr = r.r0 + (r.r1 - r.r0) * (1 - k * k)
      // Two passes of the same ellipse: a wide faint one (the wave in the air)
      // and a thin bright one (its leading edge). One stroke alone reads as a
      // drawn circle; two read as a shockwave.
      ctx.strokeStyle = rgba(r.litColor || r.color, k * 0.12)
      ctx.lineWidth = (r.width * k + 0.5) * 2
      ctx.beginPath()
      ctx.ellipse(r.x, r.y, rr, rr * r.squash, r.axis || 0, 0, TAU)
      ctx.stroke()
      // Inside a practical the whole wave is that light's colour: a white ring
      // in a warm doorway reads as a UI circle, which is exactly the complaint.
      ctx.strokeStyle = rgba(r.litColor || r.color, k * 0.6)
      ctx.lineWidth = r.width * k + 0.5
      ctx.beginPath()
      ctx.ellipse(r.x, r.y, rr, rr * r.squash, r.axis || 0, 0, TAU)
      ctx.stroke()
      ctx.strokeStyle = rgba('#ffffff', k * 0.5)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.ellipse(r.x, r.y, rr * 0.92, rr * 0.92 * r.squash, 0, 0, TAU)
      ctx.stroke()
    }

    // damage numbers (crisp, non-additive, on top of the glow layers)
    ctx.globalCompositeOperation = 'source-over'
    ctx.textAlign = 'center'
    for (const t of this.texts) {
      if (!t.active) continue
      const k = 1 - t.age / t.life
      const pop = t.age < 0.09 ? 1 + (0.09 - t.age) * 4 : 1
      ctx.save()
      ctx.translate(t.x, t.y)
      ctx.scale(pop, pop)
      ctx.font = `900 ${t.size}px "Arial Black", Arial, sans-serif`
      ctx.lineWidth = 3
      ctx.strokeStyle = rgba('#04060a', Math.min(1, k * 1.4))
      ctx.strokeText(t.str, 0, 0)
      ctx.fillStyle = rgba(t.color, Math.min(1, k * 1.6))
      ctx.fillText(t.str, 0, 0)
      ctx.restore()
    }

    ctx.restore()
  }

  /** screen-space flash overlay */
  drawFlash(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.flashAlpha <= 0.01) return
    ctx.save()
    ctx.fillStyle = rgba(this.flashColor, clamp01(this.flashAlpha))
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  /** Short tapered ink marks at contact. No full-screen inversion or white disc. */
  drawImpactFrames(ctx: CanvasRenderingContext2D): void {
    const f = this.beat
    if (!f) return
    const t = f.age / f.life, k = (1 - t) ** 2
    ctx.save()
    ctx.translate(f.x, f.y)
    ctx.rotate(f.seed)
    ctx.globalAlpha *= k * this.screenStrength * 0.72
    ctx.fillStyle = f.color
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6, x = Math.cos(a), y = Math.sin(a)
      const inner = 11 + 14 * t, outer = inner + (i % 2 ? 12 : 25) * (1 - t)
      ctx.moveTo(x * inner - y, y * inner + x)
      ctx.lineTo(x * outer, y * outer)
      ctx.lineTo(x * inner + y, y * inner - x)
      ctx.closePath()
    }
    ctx.fill()
    ctx.restore()
  }

  /** Dim only the periphery for one beat. World contact follows the live camera;
   * HUD and the centre of the fight keep their original contrast. */
  drawImpactFocus(ctx: CanvasRenderingContext2D, w: number, h: number,
    cam: {x:number; y:number; offX:number; offY:number; rot:number; zoom:number}): void {
    const f = this.beat
    if (!f) return
    const dx = (f.x - cam.x - cam.offX) * cam.zoom, dy = (f.y - cam.y - cam.offY) * cam.zoom
    const c = Math.cos(cam.rot), s = Math.sin(cam.rot)
    const x = w/2 + c*dx - s*dy, y = h/2 + s*dx + c*dy
    if (x < 0 || x > w || y < 0 || y > h) return
    let mask = this.focusMasks.get(ctx)
    const r = Math.max(1, Math.min(w,h)*0.85)
    ctx.save()
    ctx.translate(x,y); ctx.scale(r,r)
    if (!mask) {
      mask = ctx.createRadialGradient(0,0,0.14,0,0,1)
      mask.addColorStop(0,'rgba(5,9,18,0)'); mask.addColorStop(1,'#050912')
      this.focusMasks.set(ctx,mask)
    }
    const t = f.age / f.life
    ctx.globalAlpha *= this.screenStrength * 0.21 * Math.sin(Math.PI*t) ** 2
    ctx.fillStyle = mask
    ctx.fillRect(-x/r,-y/r,w/r,h/r)
    ctx.restore()
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function drawCrack(ctx: CanvasRenderingContext2D, c: Crack): void {
  if (c.pts.length < 4) return
  ctx.beginPath()
  ctx.moveTo(c.x + c.pts[0], c.y + c.pts[1])
  for (let i = 2; i < c.pts.length; i += 2) {
    ctx.lineTo(c.x + c.pts[i], c.y + c.pts[i + 1])
  }
  ctx.stroke()
}
