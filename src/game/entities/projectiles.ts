/** STICKMAN RISING — projectiles: bullets (parryable/reflectable), homing
 * missiles, plasma orbs, and the player's inferno fire wave.
 */

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

    this.x += this.vx * dt
    this.y += this.vy * dt

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

    // hit player (enemy projectile)
    if (!this.friendly) {
      const px = PLAYER_POS.x
      const py = PLAYER_POS.y - 45
      const rr = this.kind === 'missile' ? 20 : 14
      if (Math.hypot(px - this.x, py - this.y) < rr + 16) {
        const res = w.enemyStrikePlayer(this.dmg, Math.sign(this.vx) || 1, this.kind === 'missile', this.x)
        if (res) {
          // parried → reflected back at the shooter
          this.friendly = true
          this.vx *= -1.6
          this.vy = this.kind === 'bullet' ? 0 : -this.vy * 0.5
          this.dmg *= 2
          this.life = this.age + 2
          w.audio.play('reflect')
          w.fx.impact(this.x, this.y, Math.atan2(this.vy, this.vx), true, '#ffffff', '#35f2ff')
          w.cam.zoomPulse(0.08)
          return true
        }
        if (this.kind === 'missile') this.explode(w)
        return false
      }
    } else {
      // friendly reflected projectile hits enemies
      for (const e of w.enemies) {
        if (e.dead || e.spawning) continue
        if (Math.hypot(e.x - this.x, e.y - 34 * e.scale - this.y) < 30 * e.scale) {
          w.hitEnemy(e.id, { bx: this.x, by: this.y, tx: this.x + 8, ty: this.y }, {
            id: 'reflect', dmg: this.dmg, heavy: true, stagger: 0.4, kb: 300, kbY: 0,
            launch: 0, juggle: 0, hitstop: 0.06, shake: 0.2, aoe: 0, breakGuard: true, kind: 'ability',
          })
          return false
        }
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
