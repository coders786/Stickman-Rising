/** Project one low-detail outline of the solved pose onto the roof. A figure
 * builds its path once; the key, practical and bounded penumbra reuse it. */
import type { SkelGeom } from '../anim/skeleton'
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

/** Opacity of a figure's shadow. A body at the apex of a jump does not stop
 *  shadowing the roof — it casts a SMALLER, FAINTER, more offset shadow, because
 *  it is further from the plane. Zero at 200 px up (above any jump the game
 *  makes) so nothing floats without a mark. */
export function shadowAlpha(base: number, feetY: number): number {
  const up = Math.abs(Number.isFinite(feetY) ? feetY : 0)
  // Gone at 200 px up — above anything the game's jumps reach — so no figure can
  // hover without a mark, and no figure keeps a full-strength shadow in mid-air.
  const fade = 1 - Math.min(1, up / 200)
  const a = (Number.isFinite(base) ? base : 0.5) * fade
  return Math.max(0, a)
}

/** How far the shadow's tip slides as the body rises: a jumping fighter's shadow
 *  separates from its feet along the light, which is the cue that reads as
 *  altitude even when the group is small. */
export function airborneOffset(feetY: number, dir: number, reach: number): number {
  const up = Math.abs(Number.isFinite(feetY) ? feetY : 0)
  return dir * up * 0.55 * (0.6 + 0.4 * (Number.isFinite(reach) ? reach : 0.6))
}

/** The shear squash used for prop silhouettes: the outline is flattened onto the
 *  deck and leaned away from the light. Returned as the canvas matrix components
 *  so the caller can `ctx.transform(a, b, c, d, e, f)` with no allocation. */
export function silhouetteMatrix(dir: number, reach: number): { a: number; b: number; c: number; d: number } {
  const r = Number.isFinite(reach) ? Math.max(0, Math.min(1.25, reach)) : 0.6
  // More reach = a longer lean. 0.25 is the lean under the key (almost straight
  // down); 0.95 is a low sun across the roof.
  const shear = 0.22 + 0.6 * r
  return {
    a: 1,
    b: 0,
    // x' = x + c·y with y negative above the deck: c = −dir·shear pushes the top
    // AWAY from the light, which is the projection the eye expects.
    c: -(dir >= 0 ? shear : -shear),
    // d < 1 flattens the silhouette onto the plane. It is not 0: a shadow on a
    // real roof has a little thickness where the surface is not perfectly flat.
    d: -0.14, // the source rises into -y; its projection lands on the deck in +y
  }
}

export const PENUMBRA_CAP = 4

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

export function shadowOutline(g: Pose): Path2D {
  const path = new Path2D()
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
  }
  link(g.hip, g.chest, 5, 9)
  link(g.chest, g.headC, 4, 3)
  for (const side of ['L', 'R'] as const) {
    link(g.hip, g[`knee${side}`], 4, 3)
    link(g[`knee${side}`], g[`ankle${side}`], 3, 2)
    link(g[`ankle${side}`], g[`toe${side}`], 2, 1.5)
    link(g[`shoulder${side}`], g[`elb${side}`], 3.5, 2.6)
    link(g[`elb${side}`], g[`hand${side}`], 2.6, 2)
  }
  path.moveTo(g.headC.x + 7, g.headC.y)
  path.arc(g.headC.x, g.headC.y, 7, 0, Math.PI * 2)
  return path
}

export interface ShadowActor {
  x: number
  y: number
  hipY: number
  face: number
  scale: number
  geom: Pose
}
export function drawCastShadow(
  ctx: CanvasRenderingContext2D,
  actor: ShadowActor,
  path: Path2D,
  slope: number,
  alpha: number,
  penumbra: number,
  ink = '3,6,10',
): void {
  const a = shadowAlpha(alpha, actor.y)
  if (a < 0.005) return
  const passes = Math.min(PENUMBRA_CAP, Math.max(0, Math.floor(penumbra)))
  ctx.save()
  ctx.fillStyle = `rgb(${ink})`
  for (let i = passes; i >= 0; i--) {
    // Divergent rays widen the tip, not the feet. Negative world height
    // projects down-screen onto the deck even when both feet leave it.
    const shear = -slope + (i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 0.03)
    const depth = -0.095 - i * 0.006
    ctx.save()
    ctx.transform(
      actor.face * actor.scale,
      0,
      shear * actor.scale,
      depth * actor.scale,
      actor.x + shear * actor.hipY,
      2 + depth * actor.hipY,
    )
    ctx.globalAlpha *= i ? (a * 0.36) / passes : a * 0.72
    ctx.fill(path)
    ctx.restore()
  }
  ctx.restore()
}

/** Contact ambient occlusion: the soft dark the body makes where it meets the
 *  deck. Drawn on EVERY tier (a figure must never float), one or two fills. */
export function drawContactAO(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  alpha: number,
  passes = 1,
): void {
  const a = alpha * Math.max(0, 1 - Math.abs(y) / 45) ** 2
  if (a <= 0.01) return
  ctx.save()
  ctx.fillStyle = 'rgb(3,6,10)'
  for (let p = Math.max(0, passes); p >= 0; p--) {
    const grow = 1 + p * 0.55
    ctx.globalAlpha = (a * 0.5) / (passes + 1)
    ctx.beginPath()
    ctx.ellipse(x, 1.5, width * 0.52 * grow, width * 0.16 * grow, 0, 0, Math.PI * 2)
    ctx.fill()
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
