import type { SkelGeom } from '../anim/skeleton'

type Point = { x: number; y: number }
type Rig = Pick<SkelGeom, 'hip' | 'hipPtL' | 'hipPtR' | 'waist' | 'chest' | 'neckTop' | 'headC' |
  'shoulderL' | 'shoulderR' | 'elbL' | 'elbR' | 'handL' | 'handR' |
  'kneeL' | 'kneeR' | 'ankleL' | 'ankleR' | 'toeL' | 'toeR'>
export interface GPUActorInput { x: number; hipY: number; face: number; scale: number; geom: Rig }
export interface GPUActorWeaponSegment { a: Point; b: Point; r0: number; r1: number }
export const GPU_ACTOR_STRIDE = 10
export const GPU_ACTOR_CAPACITY = 512

/** Experimental presentation data, independent of the SACR reflection UBO.
 * A capsule approximation, not a replacement for the authored Canvas art. */
export class GPUActorBatch {
  readonly data = new Float32Array(GPU_ACTOR_CAPACITY * GPU_ACTOR_STRIDE)
  count = 0
  overflow = false
  private cameraX = 0
  private x = 0
  private y = 0
  private sx = 1
  private sy = 1
  private r = 0
  private g = 0
  private b = 0
  private alpha = 1

  begin(cameraX: number): void { this.cameraX = cameraX; this.count = 0; this.overflow = !Number.isFinite(cameraX) }

  private segment(a: Point, b: Point, r0: number, r1: number): void {
    if (this.overflow) return
    const ax = this.x + a.x * this.sx, ay = this.y + a.y * this.sy
    const bx = this.x + b.x * this.sx, by = this.y + b.y * this.sy
    if (this.count >= GPU_ACTOR_CAPACITY || !Number.isFinite(ax + ay + bx + by + r0 + r1 + this.alpha) || this.sy <= 0) { this.overflow = true; return }
    const i = this.count++ * GPU_ACTOR_STRIDE, d = this.data
    d[i] = ax; d[i + 1] = ay; d[i + 2] = bx; d[i + 3] = by
    d[i + 4] = Math.max(.5, r0 * this.sy); d[i + 5] = Math.max(.5, r1 * this.sy)
    d[i + 6] = this.r; d[i + 7] = this.g; d[i + 8] = this.b; d[i + 9] = this.alpha
  }

  actor(actor: GPUActorInput, tint: number, alpha = 1, weapon?: readonly GPUActorWeaponSegment[], enemyLineWidth?: number): void {
    this.x = actor.x - this.cameraX; this.y = actor.hipY; this.sx = actor.face * actor.scale; this.sy = actor.scale
    this.r = ((tint >>> 16) & 255) / 255; this.g = ((tint >>> 8) & 255) / 255; this.b = (tint & 255) / 255
    this.alpha = Math.max(0, Math.min(1, alpha))
    const g = actor.geom
    // Approximate the two actual painters separately: the player uses the
    // lean humanoid profile; enemies use drawStick's round stroked limbs.
    // Neither path yet represents the authored contours or material shading.
    const enemy = enemyLineWidth !== undefined
    const limb = enemy ? enemyLineWidth / 2 : 4.2
    const calf = enemy ? limb : 2.75
    const wrist = enemy ? limb : 1.9
    this.segment(g.hipPtL, g.kneeL, limb, limb); this.segment(g.kneeL, g.ankleL, calf, enemy ? calf : 1.9)
    this.segment(g.ankleL, g.toeL, enemy ? limb * .72 : 2, enemy ? limb * .72 : 1.35)
    this.segment(g.shoulderL, g.elbL, limb, limb); this.segment(g.elbL, g.handL, enemy ? limb : 3.1, wrist)
    this.segment(g.hip, g.waist, enemy ? limb * 1.42 : 5.2, enemy ? limb * 1.42 : 4.5)
    this.segment(g.waist, g.chest, enemy ? limb * 1.42 : 4.5, enemy ? limb * 1.42 : 9.6)
    this.segment(g.chest, g.neckTop, enemy ? limb : 3.5, enemy ? limb : 2.7)
    this.segment(g.hipPtR, g.kneeR, limb, limb); this.segment(g.kneeR, g.ankleR, calf, enemy ? calf : 1.9)
    this.segment(g.ankleR, g.toeR, enemy ? limb * .72 : 2, enemy ? limb * .72 : 1.35)
    this.segment(g.shoulderR, g.elbR, limb, limb); this.segment(g.elbR, g.handR, enemy ? limb : 3.1, wrist)
    this.segment(g.headC, g.headC, 8, 8)
    if (weapon) {
      this.r = .57; this.g = .62; this.b = .64
      for (const s of weapon) this.segment(s.a, s.b, s.r0, s.r1)
    }
  }
}
