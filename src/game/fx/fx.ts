/** STICKMAN RISING — the FX engine.
 *
 * Everything spectacular lives here: slash-trail ribbons that follow the real
 * blade trajectory, dash afterimages, impact sparks, shockwave rings, ground
 * cracks, damage numbers, dismemberment debris, lightning arcs, screen flash.
 * All pooled — zero allocations during combat.
 */

import { makePose, Pose } from '../anim/pose'
import { PLAYER_SPEC, PLAYER_STYLE } from '../anim/skeleton'
import { makeFighterGeom, solveFighter3D, drawFighter3D } from '../anim/rig3d'
import { rgba, rand, clamp01, TAU } from '../core/utils'
import type { QualityLevel } from '../core/types'
import { LightningSystem, RayOpts, RayWorld } from './lightning'

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

export interface Trail {
  active: boolean
  pts: Float32Array // ring buffer: [bx,by,tx,ty] * N
  head: number
  count: number
  N: number
  age: number
  life: number
  color: string
  color2: string
  width: number
  emitting: boolean
}

interface Afterimage {
  active: boolean
  pose: Pose
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

/** MANGA IMPACT FRAME: a 2-4 frame monochrome inversion beat — hard white
 * flash + black radial spikes punching out of the impact point + a thin
 * accent ring. The classic anime "kill frame" (Berserk / Afro Samurai
 * language) reserved for heavy connects, parries, and executions. */
interface ImpactFrame {
  active: boolean
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
const TRAIL_N = 26
const echoGeom = makeFighterGeom()
const aiPose = makePose()

export class FX {
  private particles: Particle[] = []
  private pFree: Particle[] = []
  /** THE RAY-TRACED LIGHTNING ENGINE (fx/lightning.ts) — bolts that
   *  reflect off enemies/ground with real mirror laws, lose energy per
   *  bounce, restrike their jag and render as halo/mid/core channels. */
  lightning = new LightningSystem()
  private trails: Trail[] = []
  private tFree: Trail[] = []
  private afterimages: Afterimage[] = []
  private aFree: Afterimage[] = []
  private rings: Ring[] = []
  private rFree: Ring[] = []
  private cracks: Crack[] = []
  private cFree: Crack[] = []
  private texts: DmgText[] = []
  private txtFree: DmgText[] = []
  private debris: Debris[] = []
  private dFree: Debris[] = []
  private impactFrames: ImpactFrame[] = []
  /** HDR velocity streaks (dash) */
  private lines: MotionLine[] = []
  private lFree: MotionLine[] = []
  /** ground shadow smears (dash) */
  private smears: ShadowSmear[] = []
  private smFree: ShadowSmear[] = []
  /** point impact flashes (bloom + lens cross) */
  private flashes: Flash[] = []
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
    this.qualityScale = q === 'high' ? 1 : q === 'medium' ? 0.65 : 0.38
  }

  setGore(g: 'energy' | 'blood'): void {
    this.gore = g
  }

  clear(): void {
    // POOL LAW: every live entry returns to its free list exactly once;
    // the live arrays empty completely (no stranded corpses — clear() used
    // to deactivate in place, permanently leaking the slot AND the object)
    for (const p of this.particles) { p.active = false; this.pFree.push(p) }
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
    for (const i of this.impactFrames) i.active = false
    this.impactFrames.length = 0
    // lightning bolts die with the world (pool slots recycle in update)
    this.lightning.clear()
    this.flashAlpha = 0
    this.caIntensity = 0
  }

  /* ---------------- particles ---------------- */

  private nextParticle(): Particle | null {
    let p = this.pFree.pop()
    if (!p) {
      if (this.particles.length >= MAX_PARTICLES) return null
      p = {
        active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1,
        size: 2, color: '#fff', type: 'dot', grav: 0, drag: 0,
        rot: 0, vrot: 0, pts: null,
      }
      this.particles.push(p)
    }
    p.active = true
    return p
  }

  private scaleCount(n: number): number {
    return Math.max(1, Math.round(n * this.qualityScale))
  }

  /** directional spark cone */
  sparks(x: number, y: number, dir: number, spread: number, count: number, color: string, speed = 320, life = 0.4): void {
    const n = this.scaleCount(count)
    for (let i = 0; i < n; i++) {
      const p = this.nextParticle()
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
    const n = this.scaleCount(count)
    for (let i = 0; i < n; i++) {
      const p = this.nextParticle()
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

  /** impact flash + directional sparks + micro ring */
  impact(x: number, y: number, dir: number, heavy: boolean, color: string, accent: string): void {
    this.pointFlash(x, y, color, heavy)
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
      r.squash = 1
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
  private pointFlash(x: number, y: number, color: string, heavy: boolean): void {
    if (this.flashes.length > 6) return
    const f = this.flFree.pop() ?? {
      active: false, x: 0, y: 0, age: 0, life: 0.16, color: '#fff', heavy: false,
    }
    f.active = true
    f.x = x; f.y = y
    f.age = 0; f.life = heavy ? 0.18 : 0.13
    f.color = color
    f.heavy = heavy
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
    }
  }

  /* ---------------- shockwaves / cracks / text ---------------- */

  private nextRing(): Ring | null {
    let r = this.rFree.pop()
    if (!r) {
      r = { active: false, x: 0, y: 0, r0: 0, r1: 0, age: 0, life: 1, color: '#fff', width: 3, squash: 1 }
      this.rings.push(r)
    }
    r.active = true
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
    this.flashAlpha = Math.max(this.flashAlpha, alpha)
    this.flashDecay = decay
  }

  /** register chromatic lens strain (dash launches, heavy connects) */
  chroma(intensity: number): void {
    this.caIntensity = Math.max(this.caIntensity, Math.min(1, intensity))
  }

  /** the anime impact frame: white inversion + black radial spikes */
  impactFrame(x: number, y: number, color: string): void {
    if (this.impactFrames.length > 3) return
    this.impactFrames.push({
      active: true, x, y, age: 0, life: 0.11, color, seed: rand(TAU),
    })
    this.screenFlash('#ffffff', 0.85, 9)
    this.chroma(0.7)
  }

  /* ---------------- afterimages ---------------- */

  afterimage(pose: Pose, x: number, y: number, face: number, color: string, life = 0.34, scale = 1): void {
    if (this.afterimages.length > 40) return
    const a = this.aFree.pop() ?? {
      active: false, pose: makePose(), x: 0, y: 0, face: 1, age: 0, life: 0.3, color: '#fff', scale: 1,
      style: 0 as 0 | 1, dirX: 1, rim: '#ffffff', a0: 0.44,
    }
    a.active = true
    a.pose.set(pose)
    a.x = x; a.y = y
    a.face = face
    a.age = 0; a.life = life
    a.color = color
    a.scale = scale
    a.style = 0
    this.afterimages.push(a)
  }

  /** SHADOW-SILHOUETTE dash ghost: the body captured as a dark figure with
   * a backlit rim leaking around the trailing edge — replaces the old neon
   * ghost + particle clutter on dashes (shadows & light, not confetti).
   * a0 = starting body darkness (0.5 → 0.24 down the trail: each ghost successively darker — HDR value layering). */
  shadowGhost(pose: Pose, x: number, y: number, face: number, dirX: number, rim: string, life = 0.3, scale = 1, a0 = 0.44): void {
    if (this.afterimages.length > 40) return
    const a = this.aFree.pop() ?? {
      active: false, pose: makePose(), x: 0, y: 0, face: 1, age: 0, life: 0.3, color: '#fff', scale: 1,
      style: 0 as 0 | 1, dirX: 1, rim: '#ffffff', a0: 0.44,
    }
    a.active = true
    a.pose.set(pose)
    a.x = x; a.y = y
    a.face = face
    a.age = 0; a.life = life
    a.color = '#03060c'
    a.scale = scale
    a.style = 1
    a.dirX = dirX >= 0 ? 1 : -1
    a.rim = rim
    a.a0 = a0
    this.afterimages.push(a)
  }

  /* ---------------- HDR motion line / ground shadow smear ---------------- */

  /** ONE clean velocity streak along the travel vector (replaces the old
   * 6–10 particle speed-streak train). */
  motionLine(x: number, y: number, dx: number, dy: number, len: number, life: number, color: string): void {
    const l = this.lFree.pop() ?? {
      active: false, x: 0, y: 0, dx: 0, dy: 0, len: 0, age: 0, life: 0.25, color: '#fff',
    }
    l.active = true
    const m = Math.hypot(dx, dy) || 1
    l.x = x; l.y = y
    l.dx = dx / m; l.dy = dy / m
    l.len = len
    l.age = 0; l.life = life
    l.color = color
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
    let t = this.tFree.pop()
    if (!t) {
      t = {
        active: false,
        pts: new Float32Array(TRAIL_N * 4),
        head: 0, count: 0, N: TRAIL_N,
        age: 0, life: 0.3,
        color, color2, width,
        emitting: true,
      }
      this.trails.push(t)
    }
    t.active = true
    t.head = 0
    t.count = 0
    t.age = 0
    t.life = 0.3
    t.color = color
    t.color2 = color2
    t.width = width
    t.emitting = true
    return t
  }

  pushTrail(t: Trail, bx: number, by: number, tx: number, ty: number): void {
    const i = t.head * 4
    t.pts[i] = bx
    t.pts[i + 1] = by
    t.pts[i + 2] = tx
    t.pts[i + 3] = ty
    t.head = (t.head + 1) % t.N
    if (t.count < t.N) t.count++
  }

  /** stop emitting; ribbon fades out */
  endTrail(t: Trail, life = 0.22): void {
    t.emitting = false
    t.age = 0
    t.life = life
  }

  /** a standalone slash arc (ability echoes, cinematic slashes) */
  slashArc(x: number, y: number, angle: number, spread: number, radius: number, color: string, color2: string, width = 1): void {
    const t = this.startTrail(color, color2, width)
    t.life = 0.3
    t.emitting = false
    t.age = 0
    const steps = 9
    for (let i = 0; i <= steps; i++) {
      const a = angle - spread / 2 + (spread * i) / steps
      const r0 = radius * 0.25
      pushPolar(t, x, y, a, r0, radius)
    }
  }

  /* ---------------- update ---------------- */

  /** THE POOL LAW (fixed): an expired entry is SPLICED out of its live
   * array and pushed to the free list exactly ONCE. The old pattern
   * (active=false + push-to-free, no splice) left corpses in the live
   * arrays aging forever, re-pushing to the free list EVERY FRAME, and
   * duplicating objects on every recycle — after ~6 dashes the
   * afterimages array crossed its >40 cap and ALL dash ghosts silently
   * died; particles hit MAX_PARTICLES the same way mid-run. */
  update(dt: number): void {
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
        this.pFree.push(p)
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
      if (!t.emitting) {
        t.age += dt
        if (t.age >= t.life) {
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
      this.flashAlpha -= this.flashDecay * dt
      if (this.flashAlpha < 0) this.flashAlpha = 0
    }
    // chromatic strain decay
    if (this.caIntensity > 0) {
      this.caIntensity = Math.max(0, this.caIntensity - dt * 3.4)
    }
    // impact frames
    for (let i = this.impactFrames.length - 1; i >= 0; i--) {
      const f = this.impactFrames[i]
      f.age += dt
      if (f.age >= f.life) {
        f.active = false
        this.impactFrames.splice(i, 1)
      }
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
      aiPose.set(a.pose)
      solveFighter3D(aiPose, PLAYER_SPEC, echoGeom, PLAYER_SPEC.blade)
      // shadow body — solid dark, source-over (a real cast shadow)
      drawFighter3D(ctx, echoGeom, PLAYER_STYLE, {
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
      drawFighter3D(ctx, echoGeom, PLAYER_STYLE, {
        ghost: a.rim,
        ghostAlpha: 0.07 * k,
      })
      ctx.restore()
      ctx.restore()
    }
    ctx.restore()
  }

  /** additive layer: afterimages, trails, motion lines, particles, rings */
  drawAdditive(ctx: CanvasRenderingContext2D, time: number): void {
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
      aiPose.set(a.pose)
      solveFighter3D(aiPose, PLAYER_SPEC, echoGeom, PLAYER_SPEC.blade)
      drawFighter3D(ctx, echoGeom, PLAYER_STYLE, {
        ghost: a.color,
        ghostAlpha: k * 0.5,
        time,
      })
      ctx.restore()
    }

    // slash trail ribbons
    for (const t of this.trails) {
      if (!t.active || t.count < 2) continue
      const fade = t.emitting ? 1 : 1 - t.age / t.life
      drawTrail(ctx, t, fade)
    }

    // HDR motion lines — one clean streak per dash (not a particle train)
    for (const l of this.lines) {
      if (!l.active) continue
      const k = 1 - l.age / l.life
      const grow = 0.35 + 0.65 * (1 - k) // tail recedes as it dies
      const tx = l.x - l.dx * l.len * grow
      const ty = l.y - l.dy * l.len * grow
      // wide soft bloom band
      const g1 = ctx.createLinearGradient(tx, ty, l.x, l.y)
      g1.addColorStop(0, rgba(l.color, 0))
      g1.addColorStop(0.72, rgba(l.color, 0.38 * k))
      g1.addColorStop(1, rgba(l.color, 0.9 * k))
      ctx.strokeStyle = g1
      ctx.lineWidth = 4.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(l.x, l.y)
      ctx.stroke()
      // white-hot core (the HDR read: saturated band + near-white center)
      const g2 = ctx.createLinearGradient(tx, ty, l.x, l.y)
      g2.addColorStop(0, rgba('#ffffff', 0))
      g2.addColorStop(1, rgba('#ffffff', 0.75 * k))
      ctx.strokeStyle = g2
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(l.x, l.y)
      ctx.stroke()
      // leading glint — the launch-point spark
      ctx.fillStyle = rgba('#ffffff', 0.85 * k)
      ctx.beginPath()
      ctx.arc(l.x, l.y, 2.1, 0, TAU)
      ctx.fill()
    }

    // point impact flashes — radial bloom + lens cross (camera-bloom
    // language, under the sparks so sparks ride on top of the bloom)
    for (const f of this.flashes) {
      if (!f.active) continue
      const k = 1 - f.age / f.life
      const r = (f.heavy ? 46 : 26) * (0.5 + 0.5 * k)
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)
      g.addColorStop(0, rgba('#ffffff', 0.95 * k))
      g.addColorStop(0.35, rgba(f.color, 0.55 * k))
      g.addColorStop(1, rgba(f.color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(f.x, f.y, r, 0, TAU)
      ctx.fill()
      // lens cross — shrinking horizontal/vertical streaks through the core
      const s = (f.heavy ? 30 : 18) * k * k
      ctx.strokeStyle = rgba('#ffffff', 0.5 * k)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(f.x - s, f.y)
      ctx.lineTo(f.x + s, f.y)
      ctx.moveTo(f.x, f.y - s * 0.6)
      ctx.lineTo(f.x, f.y + s * 0.6)
      ctx.stroke()
    }

    // particles
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
    for (const r of this.rings) {
      if (!r.active) continue
      const k = 1 - r.age / r.life
      const rr = r.r0 + (r.r1 - r.r0) * (1 - k * k)
      ctx.strokeStyle = rgba(r.color, k * 0.9)
      ctx.lineWidth = r.width * k + 0.5
      ctx.beginPath()
      ctx.ellipse(r.x, r.y, rr, rr * r.squash, 0, 0, TAU)
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

  /** MANGA IMPACT FRAME pass — draw AFTER the additive layer so the black
   * spikes punch through the glow: white core → black wedges → accent ring.
   * Called by the renderer in world space. */
  drawImpactFrames(ctx: CanvasRenderingContext2D): void {
    for (const f of this.impactFrames) {
      if (!f.active) continue
      const k = 1 - f.age / f.life
      // white inversion core
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = rgba('#ffffff', 0.9 * k)
      ctx.beginPath()
      ctx.arc(f.x, f.y, 34 + (1 - k) * 26, 0, TAU)
      ctx.fill()
      ctx.restore()
      // black radial spikes — alternating long/short, jittered by seed
      ctx.save()
      ctx.fillStyle = rgba('#04060a', 0.96 * k)
      const spikes = 13
      for (let i = 0; i < spikes; i++) {
        const base = f.seed + (i / spikes) * TAU
        const long = i % 2 === 0
        const r0 = 26 * k + 8
        const r1 = (long ? 250 : 140) * (0.55 + 0.45 * k)
        const halfW = (long ? 0.055 : 0.03) * (0.6 + 0.4 * k)
        ctx.beginPath()
        ctx.moveTo(f.x + Math.cos(base - halfW) * r0, f.y + Math.sin(base - halfW) * r0)
        ctx.lineTo(f.x + Math.cos(base) * r1, f.y + Math.sin(base) * r1)
        ctx.lineTo(f.x + Math.cos(base + halfW) * r0, f.y + Math.sin(base + halfW) * r0)
        ctx.closePath()
        ctx.fill()
      }
      // thin accent ring at the shock front
      ctx.strokeStyle = rgba(f.color, 0.85 * k)
      ctx.lineWidth = 2.6
      ctx.beginPath()
      ctx.arc(f.x, f.y, 46 + (1 - k) * 90, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function pushPolar(t: Trail, x: number, y: number, a: number, r0: number, r1: number): void {
  const i = t.head * 4
  t.pts[i] = x + Math.cos(a) * r0
  t.pts[i + 1] = y + Math.sin(a) * r0
  t.pts[i + 2] = x + Math.cos(a) * r1
  t.pts[i + 3] = y + Math.sin(a) * r1
  t.head = (t.head + 1) % t.N
  if (t.count < t.N) t.count++
}

const segA: number[] = [0, 0, 0, 0]
const segB: number[] = [0, 0, 0, 0]

function drawTrail(ctx: CanvasRenderingContext2D, t: Trail, fade: number): void {
  const n = t.count
  const pts = t.pts
  // render oldest → newest
  const start = (t.head - n + t.N + t.N) % t.N

  const seg = (idx: number, out: number[]): void => {
    const i = ((start + idx) % t.N) * 4
    out[0] = pts[i]; out[1] = pts[i + 1]; out[2] = pts[i + 2]; out[3] = pts[i + 3]
  }

  // ---- wide soft halo + mid core ribbon (tapered: wide at the swing
  // head, needle-pointing at the tail — the anime trail dissolve) ----
  for (let layer = 0; layer < 2; layer++) {
    const wide = layer === 0
    const color = wide ? t.color2 : t.color
    const baseAlpha = wide ? 0.3 : 0.55
    for (let i = 0; i < n - 1; i++) {
      seg(i, segA)
      seg(i + 1, segB)
      const headBias = i / Math.max(1, n - 1)
      const alpha = baseAlpha * fade * (0.35 + 0.65 * headBias)
      // width taper along the trail: 0.3 at the oldest point → 1.0 at head
      const taperA = 0.3 + 0.7 * headBias
      const taperB = 0.3 + 0.7 * ((i + 1) / Math.max(1, n - 1))
      const ax = segA[0] + (segA[2] - segA[0]) * (1 - taperA) * 0.5
      const ay = segA[1] + (segA[3] - segA[1]) * (1 - taperA) * 0.5
      const bx = segB[0] + (segB[2] - segB[0]) * (1 - taperB) * 0.5
      const by = segB[1] + (segB[3] - segB[1]) * (1 - taperB) * 0.5
      ctx.fillStyle = rgba(color, alpha)
      // quad between consecutive blade segments
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(segA[2], segA[3])
      ctx.lineTo(segB[2], segB[3])
      ctx.lineTo(bx, by)
      ctx.closePath()
      ctx.fill()
    }
  }

  // ---- hot inner core: thin near-white strip hugging the blade path ----
  // (strided every 2nd segment — plasma-line look at half the fill cost;
  // inset widens toward the tail so the core tapers with the ribbon)
  for (let i = 0; i < n - 1; i += 2) {
    seg(i, segA)
    seg(Math.min(i + 1, n - 1), segB)
    const headBias = i / Math.max(1, n - 1)
    const alpha = 0.5 * fade * (0.3 + 0.7 * headBias)
    const taper = 0.3 + 0.7 * headBias
    const ins = 0.55 + 0.45 * (1 - taper)
    // inset both blade endpoints toward the tip → thin strip near the edge
    const ax = segA[0] + (segA[2] - segA[0]) * ins
    const ay = segA[1] + (segA[3] - segA[1]) * ins
    const bx = segB[0] + (segB[2] - segB[0]) * ins
    const by = segB[1] + (segB[3] - segB[1]) * ins
    ctx.fillStyle = rgba('#ffffff', alpha)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(segA[2], segA[3])
    ctx.lineTo(segB[2], segB[3])
    ctx.lineTo(bx, by)
    ctx.closePath()
    ctx.fill()
  }

  // ---- layered cutting edges along the tip path ----
  if (n >= 2) {
    ctx.beginPath()
    seg(0, segA)
    ctx.moveTo(segA[2], segA[3])
    for (let i = 1; i < n; i++) {
      seg(i, segA)
      ctx.lineTo(segA[2], segA[3])
    }
    // soft colored edge under a hot white edge → layered "energy blade" look
    ctx.strokeStyle = rgba(t.color2, 0.34 * fade)
    ctx.lineWidth = 3.2 * t.width
    ctx.stroke()
    ctx.strokeStyle = rgba('#ffffff', 0.55 * fade)
    ctx.lineWidth = 1.5 * t.width
    ctx.stroke()

    // base-edge sheen — the opposite rim completes the dual-rim energy
    // blade (follows the tapered base so it converges into the tail point)
    ctx.beginPath()
    seg(0, segA)
    {
      const tp = 0.3
      ctx.moveTo(
        segA[0] + (segA[2] - segA[0]) * (1 - tp) * 0.5,
        segA[1] + (segA[3] - segA[1]) * (1 - tp) * 0.5,
      )
    }
    for (let i = 1; i < n; i++) {
      seg(i, segA)
      const tp = 0.3 + 0.7 * (i / Math.max(1, n - 1))
      ctx.lineTo(
        segA[0] + (segA[2] - segA[0]) * (1 - tp) * 0.5,
        segA[1] + (segA[3] - segA[1]) * (1 - tp) * 0.5,
      )
    }
    ctx.strokeStyle = rgba(t.color2, 0.16 * fade)
    ctx.lineWidth = 2 * t.width
    ctx.stroke()
  }

  // ---- tip glint + motion-blur streaks (only while the swing is live) ----
  if (t.emitting && n >= 3) {
    seg(n - 1, segA)
    seg(n - 2, segB)
    const dx = segA[2] - segB[2]
    const dy = segA[3] - segB[3]
    const spd = Math.sqrt(dx * dx + dy * dy)
    if (spd > 3) {
      const ix = 1 / spd
      const nx = -dy * ix // perpendicular
      const ny = dx * ix
      const glint = Math.min(1, spd / 26) * fade
      const gx = segA[2]
      const gy = segA[3]
      const g1 = 4 + t.width * 2.4
      const g2 = g1 * 0.42
      // bloom halo behind the glint — soft radial melt into the weapon color
      const gr = g1 * 1.9
      const bg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
      bg.addColorStop(0, rgba('#ffffff', 0.5 * glint))
      bg.addColorStop(0.4, rgba(t.color, 0.28 * glint))
      bg.addColorStop(1, rgba(t.color, 0))
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.arc(gx, gy, gr, 0, TAU)
      ctx.fill()
      // 4-point star flare at the newest tip
      ctx.strokeStyle = rgba('#ffffff', 0.75 * glint)
      ctx.lineWidth = 1.1
      ctx.beginPath()
      ctx.moveTo(gx - g1, gy)
      ctx.lineTo(gx + g1, gy)
      ctx.moveTo(gx, gy - g1)
      ctx.lineTo(gx, gy + g1)
      ctx.moveTo(gx - g2 * nx, gy - g2 * ny)
      ctx.lineTo(gx + g2 * nx, gy + g2 * ny)
      // 45° diagonal pair — the diamond-sparkle read
      const dg = g2 * 0.9
      const dc = 0.7071
      ctx.moveTo(gx - dg * dc, gy - dg * dc)
      ctx.lineTo(gx + dg * dc, gy + dg * dc)
      ctx.moveTo(gx + dg * dc, gy - dg * dc)
      ctx.lineTo(gx - dg * dc, gy + dg * dc)
      ctx.stroke()
      ctx.fillStyle = rgba(t.color, 0.9 * glint)
      ctx.beginPath()
      ctx.arc(gx, gy, 1.4 + t.width * 0.7, 0, TAU)
      ctx.fill()
      // two faint speed streaks trailing behind the tip
      ctx.strokeStyle = rgba(t.color2, 0.3 * glint)
      ctx.lineWidth = 1
      const off = 2.6 + t.width
      ctx.beginPath()
      ctx.moveTo(gx - nx * off, gy - ny * off)
      ctx.lineTo(gx - dx * 2.4 - nx * off, gy - dy * 2.4 - ny * off)
      ctx.moveTo(gx + nx * off, gy + ny * off)
      ctx.lineTo(gx - dx * 2.4 + nx * off, gy - dy * 2.4 + ny * off)
      ctx.stroke()
    }
  }
}

function drawCrack(ctx: CanvasRenderingContext2D, c: Crack): void {
  if (c.pts.length < 4) return
  ctx.beginPath()
  ctx.moveTo(c.x + c.pts[0], c.y + c.pts[1])
  for (let i = 2; i < c.pts.length; i += 2) {
    ctx.lineTo(c.x + c.pts[i], c.y + c.pts[i + 1])
  }
  ctx.stroke()
}
