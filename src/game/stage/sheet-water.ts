import { clamp, smoothstep } from '../core/utils'
import { ROAD } from './road-section'

/** One world-anchored water height field. The wide drainage basins and the
 * shallower cross-ruts decide where exposed aggregate becomes smooth water.
 * `basin` is the viaduct's seeded, interpolated longitudinal depression. */
export const crossPhase = (x: number, phase: number): number => x * .008 + .78 * Math.sin(x * .017 + phase)
export const rutPhase = (x: number, phase: number): number => phase - x * .036

export function filmDepth(v: number, basin: number, cross: number, rut: number): number {
  const flow = .5 + .5 * Math.cos(v * 6.3 + cross)
  const ruts = .5 + .5 * Math.sin(v * 13.1 + rut)
  const bank = Math.min(1, 9 * v, 9 * (1 - v))
  return clamp(.04 + (.48 * basin + .40 * flow + .23 * ruts - .03) * (.64 + .36 * bank), .04, .94)
}

/** Dry aggregate and a thin film still take diffuse light; only pooled water
 * has enough continuous surface to carry a recognizable virtual image. */
export const pooled = (depth: number): number => smoothstep((depth - .26) / .39)

/** Shallow camera angle = stronger specular sky return. A ruffled normal
 * both distorts the fixtures and catches light on the upwind edge. */
export const waterFresnel = (v: number): number => .02 + .98 * (1 - (.20 + .38 * v)) ** 5
export const waterSlope = (x: number, y: number): number =>
  .64 * Math.sin(y * 1.16 + 2.1 * Math.sin(x * .027 + y * .092) + .8 * Math.sin(x * .067 - y * .13)) +
  .36 * Math.sin(y * 2.71 - x * .083 + 1.9 * Math.sin(x * .039 + y * .14))

/** Paint-time input only: pixels of the exact body/lens sprite above this
 * pavement, plus its world x. No scene framebuffer or camera is involved. */
export interface WetFixture {
  readonly left: number
  readonly image: ImageData
}

const VIRTUAL_RANGE = 118
const NEAR_PLANE = 131
const REFLECTION_ORIGIN = ROAD.rear + 6

/** Perspective squash: project height above a fixture's foot to water depth.
 * References the same footing as the visible sprite. The bounded depth also
 * leaves the bridge fascia out of the image. */
export function fixtureMirrorY(height: number): number {
  return REFLECTION_ORIGIN + VIRTUAL_RANGE * height / (height + NEAR_PLANE)
}

/** Resolve a rough reflected pixel in premultiplied RGBA. Two offset taps
 * integrate across the sloped surface: thin bright lenses survive where a
 * point sample would drop them. The caller reuses a four-number accumulator. */
export function sampleWetFixture(fixture: WetFixture, x: number, y: number, slope: number, out: Float64Array): void {
  const { width, height, data } = fixture.image
  const depth = y - REFLECTION_ORIGIN
  if (depth < 0 || y > fixtureMirrorY(height) + 1) return
  const remaining = VIRTUAL_RANGE - depth
  const sy = height - NEAR_PLANE * depth / remaining
  const spread = .9 + 1.5 * depth / VIRTUAL_RANGE
  const sx = x - fixture.left + slope * spread * 2.3
  if (sx < -3 || sx > width + 3) return
  for (let tap = -1; tap <= 1; tap += 2) {
    const ix = Math.floor(sx + tap * spread * .58)
    const iy = Math.floor(sy + tap * (NEAR_PLANE * VIRTUAL_RANGE / (remaining * remaining)) * .36 + slope * .6)
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue
    const k = 4 * (iy * width + ix), weight = data[k + 3] / 510
    out[0] += data[k] * weight
    out[1] += data[k + 1] * weight
    out[2] += data[k + 2] * weight
    out[3] += weight
  }
}
