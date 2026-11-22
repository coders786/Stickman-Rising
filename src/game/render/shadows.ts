/** Live soles and one distance-faded projection of the solved pose onto the deck.
 * Wet Bridge can reuse the outline without sampling the scene. */
import type { SkelGeom } from '../anim/skeleton'
import type { Probe } from '../lighting/ribbons'
import { ROAD } from '../stage/road-section'
import { deckTopPath, TOP_LANE, type DeckFace } from '../stage/bridge-deck-face'
import type { Platform } from '../stage/route'
import type { ShadowMode } from './graphics'

/** Nominal figure height in world px (the stickman is ~112–124 depending on
 *  pose). Shadows are sized from this, never from a magic number per call site. */
export const FIGURE_H = 118

export interface ShadowTuning {
  /** Longest shadow as a multiple of the figure's height. */
  maxLength: number
  /** Shortest shadow as a multiple of the figure's height. */
  minLength: number
  /** How strongly the projection favours length over reach. */
  lengthGain: number
}

export const SHADOW_TUNING: ShadowTuning = {
  /** Straight under the key: a short blob, barely wider than the feet. */
  minLength: 0.3,
  /** At the far edge of the frame: over twice the body's height. */
  maxLength: 2.05,
  /** The response is CONVEX: the first half of the reach range buys little
   *  length, the second half buys a lot. A linear map makes every figure on
   *  screen cast a mid-length shadow, which reads as a uniform decal — the exact
   *  failure the old ellipse had. */
  lengthGain: 1.6,
}

/** Length of the cast shadow in px. `reach` comes from world/light.ts (0.28 at
 *  the key's foot … 1.25 at the far edge of the frame), so the length is a
 *  direct read of the composition: a figure under the moon casts a short dark
 *  blob, one at the far edge throws a long one across the roof. */
export function shadowLength(height: number, reach: number): number {
  const h = Number.isFinite(height) ? Math.max(1, height) : FIGURE_H
  const r = Number.isFinite(reach) ? Math.max(0, Math.min(1.25, reach)) : 0.6
  const t = r / 1.25 // 0 … 1
  const ease = Math.pow(t, SHADOW_TUNING.lengthGain)
  const mul = SHADOW_TUNING.minLength + (SHADOW_TUNING.maxLength - SHADOW_TUNING.minLength) * ease
  return h * mul
}

/** A jumping fighter leaves a progressively fainter cast on the ground. */
export function shadowAlpha(base: number, feetY: number): number {
  const up = Math.abs(Number.isFinite(feetY) ? feetY : 0)
  // Gone at 200 px up — above anything the game's jumps reach — so no figure can
  // hover without a mark, and no figure keeps a full-strength shadow in mid-air.
  const fade = 1 - Math.min(1, up / 200)
  const a = (Number.isFinite(base) ? base : 0.5) * fade
  return Math.max(0, a)
}

// A little more depth, less horizontal stretch than the old multi-pass casts.
const CAST_DEPTH = .18
export function moonShadowSlope(dir: number, reach: number): number {
  return (dir >= 0 ? 1 : -1) * .68 * shadowLength(1, reach)
}

/** Where a practical dominates, steer the single cast away from it. The
 * ribbon's weight goes to zero at a handoff, so casts return through the key
 * instead of jumping between two lamps. Weak/out-of-cone spill just lights
 * the fighter; it doesn't make another shadow. */
export function steerShadow(keySlope: number, x: number, height: number, probe?: Pick<Probe, 'caster' | 'castW'>): number {
  if (!probe?.caster || probe.castW <= 0) return keySlope
  const { x: lx, y: ly } = probe.caster
  const t = Math.min(1, probe.castW / .68)
  const weight = t * t * (3 - 2 * t)
  const local = Math.max(-1.4, Math.min(1.4, (x - lx) / Math.max(28, height - ly)))
  return keySlope + (local - keySlope) * weight
}

/** The baked prop masks see the same directional key as the fighters. */
export function silhouetteMatrix(dir: number, reach: number): { a: number; b: number; c: number; d: number } {
  return { a: 1, b: 0, c: -moonShadowSlope(dir, reach), d: -CAST_DEPTH }
}

type Point = { x: number; y: number }
type Pose = Pick<
  SkelGeom,
  | 'hip'
  | 'chest'
  | 'headC'
  | 'shoulderR'
  | 'shoulderL'
  | 'elbL'
  | 'elbR'
  | 'handL'
  | 'handR'
  | 'kneeR'
  | 'kneeL'
  | 'ankleR'
  | 'ankleL'
  | 'toeR'
  | 'toeL'
>

export function shadowLinks(g: Pose, detailed: boolean, link: (a: Point, b: Point, r: number, end: number) => void): void {
  link(g.hip, g.chest, 5, 9)
  link(g.chest, g.headC, 4, 3)
  for (const side of ['L', 'R'] as const) {
    if (detailed) {
      link(g.hip, g[`knee${side}`], 4, 3)
      link(g[`knee${side}`], g[`ankle${side}`], 3, 2)
      link(g[`ankle${side}`], g[`toe${side}`], 2, 1.5)
      link(g[`shoulder${side}`], g[`elb${side}`], 3.5, 2.6)
      link(g[`elb${side}`], g[`hand${side}`], 2.6, 2)
    } else {
      // The soft mirror still follows the live pose. At this scale junctions
      // and toes don't need their own polygons; never use this for the body.
      link(g.hip, g[`ankle${side}`], 4, 2.5)
      link(g[`shoulder${side}`], g[`hand${side}`], 3.5, 2)
    }
  }
}

export function shadowOutline(g: Pose, detailed = true, weapon?: readonly [Point, Point], roundJoints = false): Path2D {
  const path = new Path2D()
  const cap = (p: Point, r: number) => { path.moveTo(p.x + r, p.y); path.arc(p.x, p.y, r, 0, Math.PI * 2) }
  // Same winding for every tapered capsule so overlaps form one silhouette,
  // not a stack of translucent joints. No weapon is invented for unarmed poses.
  const link = (a: Point, b: Point, r: number, end: number) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy)
    if (len < 0.01) return
    const nx = -dy / len,
      ny = dx / len
    path.moveTo(a.x + nx * r, a.y + ny * r)
    path.lineTo(a.x - nx * r, a.y - ny * r)
    path.lineTo(b.x - nx * end, b.y - ny * end)
    path.lineTo(b.x + nx * end, b.y + ny * end)
    path.closePath()
    if (roundJoints) { cap(a, r); cap(b, end) }
  }
  shadowLinks(g, detailed, link)
  if (weapon) link(weapon[0], weapon[1], 1.6, 1.0)
  cap(g.headC, 7)
  return path
}

export interface ShadowActor {
  x: number
  y: number
  hipY: number
  floorY?: number
  face: number
  scale: number
  geom: Pose
  bridgeCastWeapon?(): readonly [Point, Point] | undefined
}
export function drawCastShadow(
  ctx: CanvasRenderingContext2D,
  actor: ShadowActor,
  path: Path2D,
  slope: number,
  keyWeight = 1,
): void {
  const floor = actor.floorY ?? ROAD.lane
  const alpha = shadowAlpha(.52, actor.y - floor) * keyWeight
  if (alpha < .005) return
  const { x, y, hipY, face, scale } = actor
  const lift = Math.max(0, floor - y)
  const castEnd = floor === ROAD.lane ? ROAD.front - 3 : 11
  // Fit tall bodies (including the boss) into the deck. The gradient also
  // bounds the receiver for extreme poses, without a per-caster clip or blur.
  const squash = Math.min(CAST_DEPTH, (castEnd - 2) / (FIGURE_H * scale + lift))
  const dy = -squash * scale, oy = floor + 1.5 - squash * hipY
  const tip = Math.min(castEnd, ROAD.lane + 1.5 + squash * (FIGURE_H * scale * 1.06 + lift))
  // Limit the shear of very large silhouettes. A jumping pose still moves
  // away from its takeoff point, but does not drag a long black streak.
  const shear = -slope * Math.min(1, 1.65 / scale)
  ctx.save()
  ctx.transform(face * scale, 0, shear * scale, dy, x + shear * (hipY - y * .4), oy)
  const ramp = ctx.createLinearGradient(0, (floor - oy) / dy, 0, (floor + tip - oy) / dy)
  ramp.addColorStop(0, 'rgba(3,6,10,0)')
  ramp.addColorStop(.07, '#03060a')
  ramp.addColorStop(.35, 'rgba(3,6,10,.75)')
  ramp.addColorStop(.72, 'rgba(3,6,10,.36)')
  ramp.addColorStop(1, 'rgba(3,6,10,0)')
  ctx.fillStyle = ramp
  ctx.globalAlpha *= alpha
  ctx.fill(path)
  ctx.restore()
}

// A unit brush reused at each sole. Canvas gradients follow the draw transform;
// no offscreen backing, per-foot gradient creation or piled solid ovals.
const contactInk = new WeakMap<CanvasRenderingContext2D, CanvasGradient>()
function stampContact(ctx: CanvasRenderingContext2D, x: number, rx: number, ry: number, alpha: number, floor: number): void {
  if (alpha < .006) return
  let ink = contactInk.get(ctx)
  if (!ink) {
    ink = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    ink.addColorStop(0, '#03060a')
    ink.addColorStop(.4, 'rgba(3,6,10,.72)')
    ink.addColorStop(.75, 'rgba(3,6,10,.24)')
    ink.addColorStop(1, 'rgba(3,6,10,0)')
    contactInk.set(ctx, ink)
  }
  ctx.save()
  ctx.transform(rx, 0, 0, ry, x, floor + 1)
  ctx.globalAlpha *= alpha
  ctx.fillStyle = ink
  ctx.fillRect(-1, -1, 2, 2)
  ctx.restore()
}

function soleWeight(ankle: Point, toe: Point, hipY: number, scale: number, lift: number, floor: number): number {
  const soleY = hipY + scale * (Math.max(ankle.y, toe.y) + 2.4)
  const gap = Math.max(0, floor - soleY, lift * .68)
  const proximity = Math.max(0, 1 - gap / 22)
  return proximity * proximity
}

function stampSole(ctx: CanvasRenderingContext2D, actor: ShadowActor, ankle: Point, toe: Point, grip: number, rest: number): void {
  const alpha = grip + rest
  if (alpha < .006) return
  // Blend any faint near-ground body mark into these footprints instead of
  // stacking a third pelvis pass. A raised shoe sheds both opacity and reach.
  const t = grip / alpha
  const centre = ankle.x + (toe.x - ankle.x) * .45
  const radius = .5 * Math.abs(toe.x - ankle.x) + 6.5
  stampContact(ctx, actor.x + centre * actor.face * actor.scale * t,
    (13 + (radius - 13) * t) * actor.scale, (3.8 - .5 * t) * actor.scale, alpha, actor.floorY ?? ROAD.lane)
}

/** Soft grounding on every tier: at most two tiny fills tied to the live soles.
 * Once both feet lift, only a faint, quickly vanishing ground cue remains. */
export function drawContactAO(ctx: CanvasRenderingContext2D, actor: ShadowActor, contact = .65, single = false): void {
  const floor = actor.floorY ?? ROAD.lane
  const lift = Math.max(0, floor - actor.y)
  if (lift >= 52) return
  const { ankleL, toeL, ankleR, toeR } = actor.geom
  const { scale, hipY } = actor
  const left = soleWeight(ankleL, toeL, hipY, scale, lift, floor)
  const right = soleWeight(ankleR, toeR, hipY, scale, lift, floor)
  const rest = (contact > .65 ? .15 : .2) * (1 - lift / 52) ** 2 * (1 - Math.max(left, right)) ** 2
  if (left === 0 && right === 0) {
    stampContact(ctx, actor.x, 13 * scale, 3.8 * scale, rest, floor)
    return
  }
  if (single) {
    const l = ankleL.x * .55 + toeL.x * .45, r = ankleR.x * .55 + toeR.x * .45
    const center = (l * left + r * right) / (left + right)
    const radius = 8.4 + Math.min(13, Math.abs(r - l) * Math.min(left, right) * .5)
    stampContact(ctx, actor.x + center * actor.face * scale, radius * scale, 3.4 * scale,
      contact * Math.max(left, right) + rest, floor)
    return
  }
  // Near overlaps are common in a side-on pose. Don't double-darken them.
  const distance = Math.abs(ankleL.x + .45 * (toeL.x - ankleL.x) - ankleR.x - .45 * (toeR.x - ankleR.x))
  const strength = contact - .2 * Math.min(left, right) * Math.max(0, 1 - distance / 13)
  stampSole(ctx, actor, ankleL, toeL, strength * left, rest * .5)
  stampSole(ctx, actor, ankleR, toeR, strength * right, rest * .5)
}

/** Share the pose anchor between Canvas and SACR. Height is relative to
 * the actual support, including when the leading boot has left it. */
export function bridgeSole(a: ShadowActor, ankle: Point, toe: Point) {
  const floor = a.floorY ?? ROAD.lane, s = a.scale
  return {
    x: a.x + (.55 * ankle.x + .45 * toe.x) * s * a.face,
    radius: (6.8 + .5 * Math.abs(ankle.x - toe.x)) * s,
    lift: Math.max(0, (floor - a.y) * .7, floor - a.hipY - (Math.max(ankle.y, toe.y) + 2.4) * s),
  }
}

/** A compact planted core plus a weak, lift-dependent surround. Limit
 * overlap on a side-on stance so crossing feet don't stamp a black blob. */
export function drawBridgeContact(ctx: CanvasRenderingContext2D, a: ShadowActor, support?: Platform | null, face?: DeckFace): void {
  const floor = a.floorY ?? ROAD.lane
  const raised = floor < ROAD.lane
  if (a.y < floor - 84 || raised && (!support || support.y !== floor || !face)) return
  const anchor = raised && face ? floor + face.returnY * TOP_LANE - 1 : ROAD.lane
  const l = bridgeSole(a, a.geom.ankleL, a.geom.toeL), r = bridgeSole(a, a.geom.ankleR, a.geom.toeR)
  const overlap = Math.max(0, 1 - 2 * Math.abs(l.x - r.x) / (l.radius + r.radius)) * Math.exp(-Math.abs(l.lift - r.lift) / 10)
  const gain = 1 - .37 * overlap
  ctx.save(); ctx.beginPath()
  if (raised && support && face) deckTopPath(ctx, support, face)
  else {
    const l = Math.max(0, a.x - 110)
    ctx.rect(l, ROAD.rear, Math.max(0, a.x + 110 - l), ROAD.front - ROAD.rear)
  }
  ctx.clip()
  for (const s of [l, r]) {
    const spread = 1 + Math.min(.80, s.lift / 95)
    stampContact(ctx, s.x, s.radius * 1.25 * spread, Math.min(7, s.radius * .39 * spread), .30 * gain * Math.exp(-s.lift / 26), anchor)
    const foot = Math.max(0, 1 - Math.max(0, s.lift - 2.6) / 21)
    stampContact(ctx, s.x, s.radius * .78, Math.min(4.1, s.radius * .26), .62 * gain * foot * foot, anchor)
  }
  ctx.restore()
}

/** Which mode a tier gives figures. Kept next to the painters so a caller does
 *  not have to import the whole feature table for one decision. */
export function usesCastShadow(mode: ShadowMode): boolean {
  return mode === 'cast' || mode === 'cast+props'
}

export function usesPropShadows(mode: ShadowMode): boolean {
  return mode === 'cast+props'
}
