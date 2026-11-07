/** STICKMAN RISING — the FX engine.
 *
 * Everything spectacular lives here: slash-trail ribbons that follow the real
 * blade trajectory, dash afterimages, impact sparks, shockwave rings, ground
 * cracks, damage numbers, dismemberment debris, lightning arcs, screen flash.
 * All pooled — zero allocations during combat.
 */

import { makePose, Pose } from '../anim/pose'
import { makeSkelGeom, solveSkeleton, PLAYER_SPEC, SkelGeom, drawStick, PLAYER_STYLE } from '../anim/skeleton'
import { rgba, rand, clamp01, TAU } from '../core/utils'
import type { QualityLevel } from '../core/types'

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

type PType = 'spark' | 'dot' | 'ember' | 'smoke' | 'streak' | 'arc' | 'shard'

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

/* ------------------------------------------------------------------ */

const MAX_PARTICLES = 1500
const TRAIL_N = 26
const scrashGeom: SkelGeom = makeSkelGeom()
const aiPose = makePose()

export class FX {
  private particles: Particle[] = []
  private pFree: Particle[] = []
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
    for (const p of this.particles) p.active = false
    for (const t of this.trails) t.active = false
    for (const a of this.afterimages) a.active = false
    for (const r of this.rings) r.active = false
    for (const c of this.cracks) c.active = false
    for (const t of this.texts) t.active = false
    for (const d of this.debris) d.active = false
    this.flashAlpha = 0
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

  /** jagged lightning bolt between two points */
  lightningArc(x0: number, y0: number, x1: number, y1: number, color: string, segments = 6): void {
    const p = this.nextParticle()
    if (!p) return
    const pts: number[] = [x0, y0]
    for (let i = 1; i < segments; i++) {
      const t = i / segments
      const jitter = 14 * (1 - Math.abs(t - 0.5) * 2 + 0.2)
      pts.push(
        x0 + (x1 - x0) * t + rand(-jitter, jitter),
        y0 + (y1 - y0) * t + rand(-jitter, jitter),
      )
    }
    pts.push(x1, y1)
    p.x = x0; p.y = y0
    p.vx = 0; p.vy = 0
    p.age = 0; p.life = 0.22
    p.size = 2.4
    p.color = color
    p.type = 'arc'
    p.grav = 0; p.drag = 0
    p.rot = 0; p.vrot = 0
    p.pts = pts
    // spark burst at both ends
    this.sparks(x1, y1, Math.atan2(y1 - y0, x1 - x0), 0.7, 5, color, 240, 0.3)
  }

  /** impact flash + directional sparks + micro ring */
  impact(x: number, y: number, dir: number, heavy: boolean, color: string, accent: string): void {
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

  /* ---------------- afterimages ---------------- */

  afterimage(pose: Pose, x: number, y: number, face: number, color: string, life = 0.34, scale = 1): void {
    if (this.afterimages.length > 40) return
    const a = this.aFree.pop() ?? {
      active: false, pose: makePose(), x: 0, y: 0, face: 1, age: 0, life: 0.3, color: '#fff', scale: 1,
    }
    a.active = true
    a.pose.set(pose)
    a.x = x; a.y = y
    a.face = face
    a.age = 0; a.life = life
    a.color = color
    a.scale = scale
    this.afterimages.push(a)
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

  update(dt: number): void {
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      if (!p.active) continue
      p.age += dt
      if (p.age >= p.life) {
        p.active = false
        this.pFree.push(p)
        continue
      }
      p.vy += p.grav * dt
      const dr = 1 - p.drag * dt
      p.vx *= dr > 0 ? dr : 0
      p.vy *= dr > 0 ? dr : 0
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    // trails
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i]
      if (!t.active) continue
      if (!t.emitting) {
        t.age += dt
        if (t.age >= t.life) {
          t.active = false
          this.tFree.push(t)
        }
      }
    }
    // afterimages
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const a = this.afterimages[i]
      a.age += dt
      if (a.age >= a.life) {
        a.active = false
        this.aFree.push(a)
      }
    }
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.age += dt
      if (r.age >= r.life) {
        r.active = false
        this.rFree.push(r)
      }
    }
    // cracks
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i]
      c.age += dt
      if (c.age >= c.life) {
        c.active = false
        this.cFree.push(c)
      }
    }
    // texts
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]
      t.age += dt
      if (t.age >= t.life) {
        t.active = false
        this.txtFree.push(t)
      }
      t.vy += 320 * dt
      t.x += t.vx * dt
      t.y += t.vy * dt
    }
    // debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]
      d.age += dt
      if (d.age >= d.life) {
        d.active = false
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
  }

  /* ---------------- draw passes ---------------- */

  /** ground layer: cracks + debris + afterimages (under entities) */
  drawUnder(ctx: CanvasRenderingContext2D): void {
    ctx.save()
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

  /** additive layer: afterimages, trails, particles, rings */
  drawAdditive(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    // afterimages (ghost stickmen)
    for (const a of this.afterimages) {
      const k = 1 - a.age / a.life
      ctx.save()
      ctx.translate(a.x, a.y)
      ctx.scale(a.face * a.scale, a.scale)
      aiPose.set(a.pose)
      solveSkeleton(aiPose, PLAYER_SPEC, scrashGeom)
      drawStick(ctx, scrashGeom, PLAYER_STYLE, {
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

    // particles
    for (const p of this.particles) {
      if (!p.active) continue
      const k = 1 - p.age / p.life
      switch (p.type) {
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

  // ---- wide soft halo + mid core ribbon ----
  for (let layer = 0; layer < 2; layer++) {
    const wide = layer === 0
    const color = wide ? t.color2 : t.color
    const baseAlpha = wide ? 0.3 : 0.55
    for (let i = 0; i < n - 1; i++) {
      seg(i, segA)
      seg(i + 1, segB)
      const headBias = i / Math.max(1, n - 1)
      const alpha = baseAlpha * fade * (0.35 + 0.65 * headBias)
      ctx.fillStyle = rgba(color, alpha)
      // quad between consecutive blade segments
      ctx.beginPath()
      ctx.moveTo(segA[0], segA[1])
      ctx.lineTo(segA[2], segA[3])
      ctx.lineTo(segB[2], segB[3])
      ctx.lineTo(segB[0], segB[1])
      ctx.closePath()
      ctx.fill()
    }
  }

  // ---- hot inner core: thin near-white strip hugging the blade path ----
  // (strided every 2nd segment — plasma-line look at half the fill cost)
  for (let i = 0; i < n - 1; i += 2) {
    seg(i, segA)
    seg(Math.min(i + 1, n - 1), segB)
    const headBias = i / Math.max(1, n - 1)
    const alpha = 0.5 * fade * (0.3 + 0.7 * headBias)
    // inset both blade endpoints 45% toward the tip → thin strip near the edge
    const ax = segA[0] + (segA[2] - segA[0]) * 0.55
    const ay = segA[1] + (segA[3] - segA[1]) * 0.55
    const bx = segB[0] + (segB[2] - segB[0]) * 0.55
    const by = segB[1] + (segB[3] - segB[1]) * 0.55
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
      // 4-point star flare at the newest tip
      const gx = segA[2]
      const gy = segA[3]
      const g1 = 4 + t.width * 2.4
      const g2 = g1 * 0.42
      ctx.strokeStyle = rgba('#ffffff', 0.75 * glint)
      ctx.lineWidth = 1.1
      ctx.beginPath()
      ctx.moveTo(gx - g1, gy)
      ctx.lineTo(gx + g1, gy)
      ctx.moveTo(gx, gy - g1)
      ctx.lineTo(gx, gy + g1)
      ctx.moveTo(gx - g2 * nx, gy - g2 * ny)
      ctx.lineTo(gx + g2 * nx, gy + g2 * ny)
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
