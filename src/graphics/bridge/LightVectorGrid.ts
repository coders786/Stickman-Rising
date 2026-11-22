import { softVisibility, staticFalloff, type Blocker, type LightPoint } from './NoirGeometry'
import type { ReceiverLight } from '../sacr/SACRLocalLight'
import { SACR_ACTOR_Z } from '../sacr/SACRMath'
import { SACR_PX_PER_METER } from '../sacr/SACRPacker'

export const VECTOR_W = 128, VECTOR_H = 16, VECTOR_ATLAS_W = 512
export const VECTOR_TOP = -368
export const CAST_RELATIVE_CUTOFF = .14
export const CAST_STRENGTH_MAX = 1.5
export const MOON_CAST_ENERGY = .66
// Neighboring samples of a fixture are close in direction. Opposite depth
// signs (including a near-side combat source) are never a valid match.
export const CAST_DIRECTION_MATCH = .982
export const vectorRow = (y: number) => Math.min(VECTOR_H - 1, Math.max(0, Math.round((y - VECTOR_TOP) / -VECTOR_TOP * (VECTOR_H - 1))))
export const lightLuminance = (r: number, g: number, b: number) => r * .2126 + g * .7152 + b * .0722

export type CastSource = { x: number; y: number; z: number; energy: number; visibility: number; id: number }
export type ShadowChoice = CastSource & { effective: number }

/** Independent reference for the shader's stable two-register selector.
 * Contact is a separate term and cannot be displaced by a bright emitter. */
export function selectShadowLights(lights: readonly CastSource[], maxK: 1 | 2, umbra = 1) {
  const ranked: ShadowChoice[] = []
  for (const l of lights) {
    const effective = Math.max(0, l.energy * l.visibility * umbra)
    if (Number.isFinite(effective) && effective > 0) ranked.push({ ...l, effective })
  }
  ranked.sort((a, b) => b.effective - a.effective)
  const cutoff = (ranked[0]?.effective ?? 0) * CAST_RELATIVE_CUTOFF
  return { contact: 1 as const, directionals: ranked.slice(0, maxK).filter(l => l.effective >= cutoff) }
}

// 5+5 bits of octahedral direction, 6 bits of square-root luminance. Two
// independent sources fit one RGBA8 texel (128 × 16 × 4 = 8192 bytes).
// y is up, z is away from the camera. Zero luminance is the empty sentinel.
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
export function packLightVector(x: number, y: number, z: number, energy: number): number {
  const norm = Math.abs(x) + Math.abs(y) + Math.abs(z)
  if (!(energy > .003 && norm > .001)) return 0
  let u = x / norm, v = y / norm
  if (z < 0) { const a = u; u = (1 - Math.abs(v)) * (a < 0 ? -1 : 1); v = (1 - Math.abs(a)) * (v < 0 ? -1 : 1) }
  const q = (n: number) => Math.round(clamp(n * .5 + .5, 0, 1) * 31)
  return q(u) | q(v) << 5 | Math.max(1, Math.round(Math.sqrt(clamp(energy / CAST_STRENGTH_MAX, 0, 1)) * 63)) << 10
}

export function unpackLightVector(word: number): CastSource {
  let x = (word & 31) * (2 / 31) - 1, y = (word >> 5 & 31) * (2 / 31) - 1
  const z = 1 - Math.abs(x) - Math.abs(y), t = Math.max(-z, 0)
  x += x < 0 ? t : -t; y += y < 0 ? t : -t
  const n = Math.hypot(x, y, z)
  return { x: x / n, y: y / n, z: z / n, energy: (word >>> 10) ** 2 * CAST_STRENGTH_MAX / (63 * 63), visibility: 1, id: -1 }
}

/** CPU counterpart of the shader's cell-center reconstruction. Angular
 * matching keeps an energy rank swap from twisting the cast between lights. */
export function reconstructCastDirections(left: readonly [number, number], right: readonly [number, number], t: number): CastSource[] {
  const a = unpackLightVector(left[0]), b = unpackLightVector(left[1])
  let c = unpackLightVector(right[0]), d = unpackLightVector(right[1])
  const match = (p: CastSource, q: CastSource) => {
    if (!p.energy || !q.energy || p.z * q.z <= 0) return 0
    const dot = p.x * q.x + p.y * q.y + p.z * q.z
    return dot >= CAST_DIRECTION_MATCH ? dot : 0
  }
  let ac = match(a, c), bd = match(b, d)
  const ad = match(a, d), bc = match(b, c)
  if (ad + bc > ac + bd) { const hold = c; c = d; d = hold; ac = ad; bd = bc }
  const blend = (p: CastSource, q: CastSource, matched: number) => {
    if (!matched) { p.energy *= 1 - t; return }
    const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t, z = p.z + (q.z - p.z) * t
    const n = Math.hypot(x, y, z)
    p.x = x / n; p.y = y / n; p.z = z / n
    p.energy += (q.energy - p.energy) * t
    q.energy = 0
  }
  blend(a, c, ac); blend(b, d, bd)
  c.energy *= t; d.energy *= t
  return [a, b, c, d]
}

export function sampleCastDirections(vectors: Uint8Array, u: number, y: number): CastSource[] {
  const s = clamp(u * VECTOR_ATLAS_W - .5, 0, VECTOR_ATLAS_W - 1)
  const i = Math.floor(s), row = vectorRow(y) * VECTOR_ATLAS_W
  const words = (x: number): [number, number] => {
    const k = (row + x) * 4
    return [vectors[k] | vectors[k + 1] << 8, vectors[k + 2] | vectors[k + 3] << 8]
  }
  return reconstructCastDirections(words(i), words(Math.min(i + 1, VECTOR_ATLAS_W - 1)), s - i)
}

export function lightDepth(p: LightPoint): number { return p.z ?? SACR_ACTOR_Z + 1.12 }

export type FixtureLobes = readonly [ReceiverLight, ReceiverLight]

/** Object-space direct light from the lamps that made the baked field.
 * Evaluate at the actual joint/prop, not at the cell-center shadow address.
 * Keep two spectra and directions separate. Baked RGB is for the fixed
 * surfaces and bounce; it is not another direct contribution to this tap. */
export function sampleFixturePair(points: readonly LightPoint[], blockers: readonly Blocker[],
  x: number, y: number, depth: number, out: FixtureLobes): void {
  const [a, b] = out
  for (const p of out) p.r = p.g = p.b = p.strength = 0
  for (const p of points) {
    if (p.kind === 'strip' || (p.kind === 'spot' && p.y >= y)) continue
    const dx = p.x - x, dy = p.y - y, dz = (lightDepth(p) - SACR_ACTOR_Z) * SACR_PX_PER_METER - depth
    // The footprint is the shared finite fixture cookie. Depth changes
    // distance and incidence, but doesn't invent a second light cone.
    const gain = .64 * staticFalloff(p, -dx, -dy) / (1 + dz * dz / (p.reach * p.reach * .24))
    const peak = gain * Math.max(...p.rgb)
    if (peak <= Math.max(.007, b.strength)) continue
    const transmission = softVisibility(x, y, p.x, p.y, p.physicalRadius, blockers)
    const strength = peak * transmission
    if (strength <= Math.max(.007, b.strength)) continue
    const tap = strength > a.strength ? a : b
    if (tap === a) {
      b.r = a.r; b.g = a.g; b.b = a.b; b.strength = a.strength
      b.dx = a.dx; b.dy = a.dy; b.dz = a.dz
    }
    const inv = 1 / Math.max(1, Math.hypot(dx, dy, dz)), e = gain * transmission
    tap.dx = dx * inv; tap.dy = dy * inv; tap.dz = dz * inv; tap.strength = strength
    tap.r = p.rgb[0] * e; tap.g = p.rgb[1] * e; tap.b = p.rgb[2] * e
  }
}

export function bakeLightVectorGrid(left: number, right: number, points: readonly LightPoint[], blockers: readonly Blocker[],
  data = new Uint8Array(VECTOR_W * VECTOR_H * 4)) {
  const step = (right - left) / VECTOR_W
  for (let j = 0; j < VECTOR_H; j++) {
    const y = VECTOR_TOP * (1 - j / (VECTOR_H - 1))
    for (let i = 0; i < VECTOR_W; i++) {
      const x = left + (i + .5) * step
      let first = 0, second = 0, a = 0, b = 0
      for (const p of points) {
        const dx = p.x - x, dy = y - p.y
        if (p.kind === 'strip' || dy < 8) continue
        const strength = staticFalloff(p, -dx, dy) * lightLuminance(...p.rgb)
        if (strength < Math.max(.003, second)) continue
        const e = strength * softVisibility(x, y, p.x, p.y, p.physicalRadius, blockers)
        if (e <= second) continue
        const word = packLightVector(dx, dy, (lightDepth(p) - SACR_ACTOR_Z) * SACR_PX_PER_METER, e)
        if (e > first) { second = first; b = a; first = e; a = word }
        else { second = e; b = word }
      }
      const k = (j * VECTOR_W + i) * 4
      data[k] = a & 255; data[k + 1] = a >>> 8; data[k + 2] = b & 255; data[k + 3] = b >>> 8
    }
  }
  return data
}
