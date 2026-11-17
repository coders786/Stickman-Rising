/** STICKMAN RISING — src/game/render/shadows.ts
 * THE SHADOW SYSTEM: a body, not a puddle.
 * ----------------------------------------------------------------------------
 * The old grounding was one ellipse under each figure, two fills, pushed away
 * from the moon. It was *correct* (the direction answered the key light) and it
 * still looked cheap, for a reason that is worth writing down: **an ellipse is
 * not a shadow, it is a stain.** A shadow is the silhouette of a body projected
 * onto the plane it stands on — it is long when the light is low, it is shaped
 * like the thing that cast it, and its edge is soft in proportion to how far the
 * light is from a point. Nothing about an ellipse says any of that, so the eye
 * reads it as decal and the scene stays flat no matter how good the sky is.
 *
 * WHAT REPLACES IT
 *
 *  1. **A projected body.** A tapered polygon from the feet along the light
 *     direction, long by `shadowLength`, with a head lobe at the tip and a blade
 *     sliver for the arm. Three lobes, one path, one fill per pass.
 *  2. **A penumbra stack.** The same path is filled under itself at growing
 *     scale and falling alpha. Three cheap fills read as a soft edge — which is
 *     the difference between "vector art" and "photograph". `ctx.filter: blur()`
 *     would be the other way and costs 3–8 ms on mobile software raster; this
 *     costs three fills.
 *  3. **A second light.** The practicals (streetlight, stairwell) are light
 *     sources, so figures standing in their reach cast a SECOND, tinted shadow in
 *     the practical's own direction. Two shadows from two lights is the cheapest
 *     honest way to say "multiple sources" — and it makes the door and the lamp
 *     feel like they emit rather than glow.
 *  4. **True silhouettes for props.** A prop is a static sprite, so its shadow
 *     can be its actual outline: a silhouette mask baked once, blitted through a
 *     shear matrix that lands it flat on the deck. One drawImage per prop.
 *
 * COST, PER FIGURE, PER TIER (`render/graphics.ts`): contact = 1 fill; cast = up
 * to (penumbra + 2) fills; practical second shadow adds (penumbra + 2) more and
 * is high/ultra only. The heaviest tier is ~10 path fills for the player and ~6
 * per visible enemy, which is still cheaper than one `shadowBlur`.
 * ==========================================================================*/

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
  minLength: 0.30,
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
    d: 0.14,
  }
}

export interface CastShadowOpts {
  x: number
  /** Feet position (world y). The shadow is drawn on the deck at `y`. */
  y: number
  height: number
  width: number
  /** +1 the shadow falls to the right, −1 to the left. */
  dir: number
  reach: number
  alpha: number
  /** Extra soft passes. 0 = crisp, 3 = very soft (ultra). */
  penumbra: number
  /** rgb triple ("4,7,11") — a practical's shadow is tinted by the practical. */
  ink?: string
  /** Superellipse squeeze: a shorter, fatter shadow for an airborne figure. */
  airborne?: boolean
}

/** Draw one projected body shadow. Pure Canvas2D, no state leaks: the caller's
 *  transform and alpha are restored. */
export function drawCastShadow(ctx: CanvasRenderingContext2D, o: CastShadowOpts): void {
  const ink = o.ink ?? '3,6,10'
  const len = shadowLength(o.height, o.reach)
  const dir = o.dir >= 0 ? 1 : -1
  const slide = airborneOffset(o.y, dir, o.reach)
  const w = Math.max(6, o.width)
  const a = shadowAlpha(o.alpha, o.y)
  if (a <= 0.005 || len <= 1) return
  const bx = o.x + slide // base of the shadow (under the feet, slid when airborne)
  const tipX = bx + dir * len
  const baseHalf = w * 0.26
  const tipHalf = w * 0.15
  const headR = Math.max(3, o.height * 0.085)

  ctx.save()
  // PENUMBRA FIRST, widest and faintest, so the core lands on top of it. Each
  // pass is the same geometry scaled about the base point: the union of the
  // alphas is a soft gradient without a single blur.
  const passes = Math.max(0, Math.min(3, Math.floor(o.penumbra)))
  for (let p = passes; p >= 1; p--) {
    const grow = 1 + p * 0.22
    ctx.globalAlpha = (a * 0.5) / (passes + 1)
    ctx.fillStyle = `rgb(${ink})`
    ctx.beginPath()
    bodyPath(ctx, bx, o.y, dir, len * grow, baseHalf * grow, tipHalf * grow, headR * grow)
    ctx.fill()
  }
  // CORE
  ctx.globalAlpha = a * 0.62
  ctx.fillStyle = `rgb(${ink})`
  ctx.beginPath()
  bodyPath(ctx, bx, o.y, dir, len, baseHalf, tipHalf, headR)
  ctx.fill()
  // BLADE ARM — a thin sliver angled forward from the shoulder line. Only on the
  // core: a soft blade reads as a smudge.
  ctx.globalAlpha = a * 0.34
  ctx.beginPath()
  ctx.ellipse(bx + dir * len * 0.42, o.y + 1.5, len * 0.26, Math.max(1.6, w * 0.075), dir * 0.16, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** The tapered body polygon + head lobe, as one path. */
function bodyPath(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  dir: number,
  len: number,
  baseHalf: number,
  tipHalf: number,
  headR: number,
): void {
  const tipX = bx + dir * len
  // Slight curve along the spine: a body is not a cone, it narrows at the waist
  // and widens again at the shoulders. Two quadratics carry that, and it is the
  // detail that stops the silhouette reading as a traffic cone.
  ctx.moveTo(bx - baseHalf, by + 1)
  ctx.quadraticCurveTo(bx + dir * len * 0.35, by - baseHalf * 0.42, tipX - tipHalf, by - 1)
  ctx.lineTo(tipX + tipHalf, by - 1)
  ctx.quadraticCurveTo(bx + dir * len * 0.35, by + baseHalf * 0.5, bx + baseHalf, by + 1)
  ctx.closePath()
  // head: the far end of the projection, sitting just past the shoulders
  ctx.moveTo(tipX + headR, by)
  ctx.ellipse(tipX, by, headR, headR * 0.46, 0, 0, Math.PI * 2)
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
  const a = shadowAlpha(alpha, y)
  if (a <= 0.01) return
  ctx.save()
  ctx.fillStyle = 'rgb(3,6,10)'
  for (let p = Math.max(0, passes); p >= 0; p--) {
    const grow = 1 + p * 0.55
    ctx.globalAlpha = (a * 0.5) / (passes + 1)
    ctx.beginPath()
    ctx.ellipse(x, y + 1.5, width * 0.52 * grow, width * 0.16 * grow, 0, 0, Math.PI * 2)
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
