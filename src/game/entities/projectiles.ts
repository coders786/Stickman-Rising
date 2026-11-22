/** STICKMAN RISING — projectiles: bullets (parryable/reflectable), homing
 * missiles, plasma orbs, and the player's inferno fire wave.
 */

import { BRIDGE_LIGHT, type BridgeFrame } from '../render/bridge-frame'
import { WorldRef } from '../core/types'
import { rand, rgba, TAU } from '../core/utils'

export interface ProjectileSpawn {
  kind: 'bullet' | 'missile' | 'orb' | 'firewave'
  x: number
  y: number
  vx: number
  vy: number
  dmg: number
  life: number
  homing?: number
}

export class Projectile {
  active = false
  kind: ProjectileSpawn['kind'] = 'bullet'
  x = 0
  y = 0
  /** render interpolation: sim position one step ago (see Game.frame) */
  px = NaN
  py = NaN
  vx = 0
  vy = 0
  dmg = 5
  life = 2
  age = 0
  homing = 0
  friendly = false
  private hitIds = new Set<number>()
  private trailT = 0

  spawn(p: ProjectileSpawn, friendly = false): void {
    this.kind = p.kind
    this.x = p.x
    this.y = p.y
    // BIRTH RESET (plan M04): a recycled projectile must not keep its
    // previous life's render-interpolation history — alpha-lerp would drag
    // the newborn across the screen toward a ghost position. NaN is the
    // documented "fresh birth" value: lerpRender falls back to the actual
    // position (the fresh-birth negative control).
    this.px = NaN
    this.py = NaN
    this.vx = p.vx
    this.vy = p.vy
    this.dmg = p.dmg
    this.life = p.life
    this.age = 0
    this.homing = p.homing ?? 0
    this.friendly = friendly
    this.hitIds.clear()
    this.trailT = 0
    this.active = true
  }

  /** returns false when the projectile should be released */
  update(dt: number, w: WorldRef): boolean {
    if (!this.active) return false
    this.age += dt
    if (this.age >= this.life) {
      if (this.kind === 'missile') this.explode(w)
      return false
    }

    // homing
    if (this.homing > 0 && !this.friendly) {
      const px = PLAYER_POS.x
      const py = PLAYER_POS.y - 45
      const dx = px - this.x
      const dy = py - this.y
      const d = Math.hypot(dx, dy) || 1
      this.vx += (dx / d) * this.homing * 420 * dt
      this.vy += (dy / d) * this.homing * 420 * dt
      const sp = Math.hypot(this.vx, this.vy)
      const maxSp = 360
      if (sp > maxSp) {
        this.vx = (this.vx / sp) * maxSp
        this.vy = (this.vy / sp) * maxSp
      }
    }

    // Step start (plan M05): collision below sweeps THIS segment, not just
    // the endpoint — a 1 440 px/s reflected bullet crosses a body inside one
    // 50 ms tick and endpoint testing credits zero hits.
    const x0 = this.x
    const y0 = this.y
    this.x += this.vx * dt
    this.y += this.vy * dt
    const x1 = this.x
    const y1 = this.y
    if (w.projectileBlocked?.(x0, x1)) return false

    // trails / element particles
    this.trailT -= dt
    if (this.trailT <= 0) {
      this.trailT = 0.03
      switch (this.kind) {
        case 'missile':
          w.fx.sparks(this.x, this.y, Math.atan2(-this.vy, -this.vx), 0.5, 2, '#ffae2e', 90, 0.3)
          break
        case 'orb':
          w.fx.embers(this.x, this.y, 1, '#35f2ff', 2)
          break
        case 'firewave':
          w.fx.embers(this.x + rand(-24, 24), -rand(4, 46), 3, '#ff7a29', 10)
          w.fx.sparks(this.x, -6, -Math.PI / 2, 0.8, 2, '#ffd27a', 220, 0.4)
          break
        default:
          break
      }
    }

    // firewave damage: sweep enemies
    if (this.kind === 'firewave') {
      for (const e of w.enemies) {
        if (e.dead || e.spawning || this.hitIds.has(e.id)) continue
        if (Math.abs(e.x - this.x) < 64 && e.y > -120) {
          this.hitIds.add(e.id)
          w.hitEnemy(e.id, { bx: this.x - 30, by: -20, tx: this.x + 30, ty: -20 }, {
            id: 'firewave', dmg: this.dmg, heavy: true, stagger: 0.5, kb: 240, kbY: 0,
            launch: 0, juggle: 0, hitstop: 0.05, shake: 0.2, aoe: 0, breakGuard: true, kind: 'ability',
          })
        }
      }
      if (this.x < w.arenaMinX || this.x > w.arenaMaxX) return false
      return true
    }

    // hit player (enemy projectile) — SWEPT (plan M05)
    if (!this.friendly) {
      const rr = this.kind === 'missile' ? 20 : 14
      const body = playerBody()
      const u = sweptCircleHit(x0, y0, x1, y1, body.x0, body.y0, body.x1, body.y1, rr + 16)
      if (u >= 0) {
        const hx = x0 + (x1 - x0) * u
        const hy = y0 + (y1 - y0) * u
        this.x = hx
        this.y = hy
        const res = w.enemyStrikePlayer(this.dmg, Math.sign(this.vx) || 1, this.kind === 'missile', hx)
        if (res) {
          // parried → reflected back at the shooter
          this.friendly = true
          this.vx *= -1.6
          this.vy = this.kind === 'bullet' ? 0 : -this.vy * 0.5
          this.dmg *= 2
          this.life = this.age + 2
          w.audio.play('reflect')
          w.fx.impact(hx, hy, Math.atan2(this.vy, this.vx), true, '#ffffff', '#35f2ff')
          w.cam.zoomPulse(0.08)
          // Remaining travel after the contact runs under the REFLECTED
          // velocity — never a second full dt on top of the swept step.
          const rem = (1 - u) * dt
          this.x += this.vx * rem
          this.y += this.vy * rem
          return true
        }
        if (this.kind === 'missile') this.explode(w)
        return false
      }
    } else {
      // friendly reflected projectile hits enemies — SWEPT, earliest contact
      let bestU = 2
      let bestE: (typeof w.enemies)[number] | null = null
      for (const e of w.enemies) {
        if (e.dead || e.spawning) continue
        const R = 30 * e.scale
        const cx1 = e.x
        const cy1 = e.y - 34 * e.scale
        const cx0 = Number.isFinite(e.px) ? e.px : cx1
        const cy0 = Number.isFinite(e.py) ? e.py - 34 * e.scale : cy1
        const u = sweptCircleHit(x0, y0, x1, y1, cx0, cy0, cx1, cy1, R)
        if (u >= 0 && u < bestU) {
          bestU = u
          bestE = e
        }
      }
      if (bestE) {
        const hx = x0 + (x1 - x0) * bestU
        const hy = y0 + (y1 - y0) * bestU
        this.x = hx
        this.y = hy
        w.hitEnemy(bestE.id, { bx: hx, by: hy, tx: hx + 8, ty: hy }, {
          id: 'reflect', dmg: this.dmg, heavy: true, stagger: 0.4, kb: 300, kbY: 0,
          launch: 0, juggle: 0, hitstop: 0.06, shake: 0.2, aoe: 0, breakGuard: true, kind: 'ability',
        })
        return false
      }
    }

    if (this.x < w.arenaMinX - 60 || this.x > w.arenaMaxX + 60 || this.y < -700 || this.y > 40) {
      return false
    }
    return true
  }

  private explode(w: WorldRef): void {
    w.audio.play('explosion', { volume: 0.7 })
    w.fx.burst(this.x, this.y, 16, '#ffae2e', 380, 0.6, 'spark')
    w.fx.burst(this.x, this.y, 8, '#ffd27a', 200, 0.7, 'ember')
    w.fx.shockwave(this.x, this.y, 70, '#ffae2e', 0.3, 5)
    w.cam.addTrauma(0.2)
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    if (!this.active) return
    ctx.save()
    switch (this.kind) {
      case 'bullet': {
        ctx.globalCompositeOperation = 'lighter'
        const a = Math.atan2(this.vy, this.vx)
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        ctx.strokeStyle = rgba(this.friendly ? '#ffffff' : '#ffe14d', 0.9)
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(this.x - dx * 16, this.y - dy * 16)
        ctx.lineTo(this.x, this.y)
        ctx.stroke()
        ctx.strokeStyle = rgba('#ffffff', 0.9)
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(this.x - dx * 10, this.y - dy * 10)
        ctx.lineTo(this.x, this.y)
        ctx.stroke()
        break
      }
      case 'missile': {
        const a = Math.atan2(this.vy, this.vx)
        ctx.translate(this.x, this.y)
        ctx.rotate(a)
        ctx.fillStyle = '#1a1f28'
        ctx.strokeStyle = '#ffae2e'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(-10, -4)
        ctx.lineTo(8, -3)
        ctx.lineTo(12, 0)
        ctx.lineTo(8, 3)
        ctx.lineTo(-10, 4)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = rgba('#ffae2e', 0.8)
        ctx.beginPath()
        ctx.arc(-12, 0, 3 + Math.sin(time * 40) * 1.5, 0, TAU)
        ctx.fill()
        break
      }
      case 'orb': {
        ctx.globalCompositeOperation = 'lighter'
        const r = 10 + Math.sin(time * 12) * 2
        ctx.strokeStyle = rgba('#35f2ff', 0.7)
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(this.x, this.y, r, 0, TAU)
        ctx.stroke()
        ctx.fillStyle = rgba('#bfefff', 0.85)
        ctx.beginPath()
        ctx.arc(this.x, this.y, r * 0.45, 0, TAU)
        ctx.fill()
        break
      }
      case 'firewave': {
        ctx.globalCompositeOperation = 'lighter'
        const h = 52 + Math.sin(time * 18) * 8
        const grad = ctx.createLinearGradient(0, 0, 0, -h)
        grad.addColorStop(0, rgba('#ff7a29', 0.75))
        grad.addColorStop(0.5, rgba('#ffb347', 0.5))
        grad.addColorStop(1, rgba('#fff3d6', 0.05))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(this.x - 34, 0)
        ctx.quadraticCurveTo(this.x - 26, -h * 0.6, this.x - 10, -h)
        ctx.quadraticCurveTo(this.x, -h * 1.2, this.x + 10, -h)
        ctx.quadraticCurveTo(this.x + 26, -h * 0.6, this.x + 34, 0)
        ctx.closePath()
        ctx.fill()
        break
      }
    }
    ctx.restore()
  }
}

/** injected by Game (avoids circular import) */
export const PLAYER_POS = { x: 400, y: 0 }

/** Player body sweep endpoints for swept projectile collision (plan M05).
 * Game.step records them around player.update: (x0,y0) is the pre-update
 * root, (x1,y1) the post-update root. When a harness never sets them they
 * stay NaN and collision falls back to a static body at PLAYER_POS. */
export const PLAYER_BODY = { x0: NaN, y0: NaN, x1: NaN, y1: NaN }

/** Earliest contact u∈[0,1] of a swept point p0→p1 against a disc moving
 * c0→c1 with radius R, via relative motion q0=u-independent, v=(p1-p0)-(c1-c0):
 * solve |q0 + u·v|² = R². Returns −1 when no contact occurs inside the step.
 * Already-overlapping starts return 0 (contact at the step boundary). */
function sweptCircleHit(
  p0x: number, p0y: number, p1x: number, p1y: number,
  c0x: number, c0y: number, c1x: number, c1y: number,
  R: number,
): number {
  const q0x = p0x - c0x
  const q0y = p0y - c0y
  const vx = (p1x - p0x) - (c1x - c0x)
  const vy = (p1y - p0y) - (c1y - c0y)
  const a = vx * vx + vy * vy
  const rr = R * R
  const c = q0x * q0x + q0y * q0y - rr
  if (c <= 0) return 0 // started inside (or exactly on) the body
  if (a < 1e-12) return -1 // no relative motion and not overlapping
  const b = 2 * (q0x * vx + q0y * vy)
  const disc = b * b - 4 * a * c
  if (disc < 0) return -1
  const u = (-b - Math.sqrt(disc)) / (2 * a)
  return u >= 0 && u <= 1 ? u : -1
}

/** Player body disc (center at root −45, radius rr+16 handled by caller). */
function playerBody(): { x0: number; y0: number; x1: number; y1: number } {
  if (Number.isFinite(PLAYER_BODY.x0) && Number.isFinite(PLAYER_BODY.x1)) {
    return {
      x0: PLAYER_BODY.x0, y0: PLAYER_BODY.y0 - 45,
      x1: PLAYER_BODY.x1, y1: PLAYER_BODY.y1 - 45,
    }
  }
  const cx = PLAYER_POS.x
  const cy = PLAYER_POS.y - 45
  return { x0: cx, y0: cy, x1: cx, y1: cy }
}

export class ProjectilePool {
  private list: Projectile[] = []
  private free: Projectile[] = []

  spawn(p: ProjectileSpawn, friendly = false): void {
    if (this.list.length > 80) return
    const pr = this.free.pop() ?? new Projectile()
    pr.spawn(p, friendly)
    this.list.push(pr)
  }

  update(dt: number, w: WorldRef): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const pr = this.list[i]
      if (!pr.update(dt, w)) {
        pr.active = false
        this.free.push(pr)
        this.list.splice(i, 1)
      }
    }
  }

  /** Render interpolation (Game.frame): snapshot sim positions before a step. */
  recordPrev(): void {
    for (const pr of this.list) {
      if (!pr.active) continue
      pr.px = pr.x
      pr.py = pr.y
    }
  }

  /** Install interpolated render positions (alpha in [0,1]); current values
   *  are stashed in px/py and restored by unlerpRender(). */
  lerpRender(alpha: number): void {
    for (const pr of this.list) {
      if (!pr.active) continue
      const cx = pr.x
      const px = Number.isFinite(pr.px) ? pr.px : pr.x
      pr.x = px + (pr.x - px) * alpha
      pr.px = cx
      const cy = pr.y
      const py = Number.isFinite(pr.py) ? pr.py : pr.y
      pr.y = py + (pr.y - py) * alpha
      pr.py = cy
    }
  }

  /** Restore the true sim positions (px/py hold them after lerpRender). */
  unlerpRender(): void {
    for (const pr of this.list) {
      if (!pr.active) continue
      pr.x = pr.px
      pr.y = pr.py
    }
  }

  bridgeEmitters(frame: BridgeFrame): void {
    let n = 0
    for (const pr of this.list) {
      if (!pr.active) continue
      let lit = false
      if (pr.kind === 'orb') lit = frame.light(BRIDGE_LIGHT.impulse, pr.x, pr.y, 168, '#35f2ff', 3.05, 8.4, pr.x, pr.y, 0, 24)
      else if (pr.kind === 'firewave') lit = frame.light(BRIDGE_LIGHT.impulse, pr.x - 21, -18, 134, '#ff8a37', 2.20, 13, pr.x + 21, -29, 0, 12)
      else if (pr.kind === 'missile') {
        const v = 12 / Math.max(1, Math.hypot(pr.vx, pr.vy))
        lit = frame.light(BRIDGE_LIGHT.impulse, pr.x - pr.vx * v, pr.y - pr.vy * v, 94, '#ffb05f', 1.09, 4)
      }
      if (lit && ++n >= 2) break
    }
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    for (const pr of this.list) pr.draw(ctx, time)
  }

  clear(): void {
    for (const pr of this.list) {
      pr.active = false
      this.free.push(pr)
    }
    this.list.length = 0
  }

  get count(): number {
    return this.list.length
  }
}
