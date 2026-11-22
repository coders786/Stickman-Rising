import { SACR_PX_PER_METER } from '../sacr/SACRPacker'

export const GLASS_EYE_Z = -4.8
export const GLASS_IOR = 1.52
export const GLASS_THICKNESS_M = .006
// Neutral fit for clear float glass (roughly 90% visible transmission
// head-on). This is not a measured spectral curve or a selective coating.
export const GLASS_EXTINCTION = 4.2
export const GLASS_FAR_Z = -35
export const GLASS_ENV_TOP = -962, GLASS_ENV_BOTTOM = 360
export const GLASS_CITY_TOP = -518, GLASS_CITY_BOTTOM = -48
export const GLASS_ENV_W = 896, GLASS_ENV_H = 180
export const GLASS_PROFILES = [.17, .24] as const
export const GLASS_ATLAS_H = GLASS_ENV_H * GLASS_PROFILES.length * 4
export const GLASS_PLATE = 'shop-return-v2'

export const GLASS_TILE_W = 320, GLASS_TILE_H = 112, SHOP_FRONT_LIMIT = 3
// The GL half of the WebP and the scratch RGB channel carry numeric linear
// radiance, normalized by this range. Alpha is geometric coverage only.
export const GLASS_RADIANCE_RANGE = 1.5
export type GlassField = {
  canvas: HTMLCanvasElement
  count: number
  bounds: Float32Array<ArrayBuffer>
  distance: Float32Array<ArrayBuffer>
}

/** Incoherent uncoated parallel slab. Sum each polarization's round trips
 * before averaging. Snell gives the path length d/cos(theta_t); Beer gives
 * its attenuation. The missing R + T energy is absorbed, never added back. */
export function glassSlab(cosine: number, extinction = GLASS_EXTINCTION): readonly [r: number, t: number] {
  const c = Math.max(0, Math.min(1, cosine)), n = GLASS_IOR
  const ct = Math.sqrt(1 - (1 - c * c) / (n * n))
  const a = Math.exp(-extinction * GLASS_THICKNESS_M / ct)
  const s = ((c - n * ct) / (c + n * ct)) ** 2, p = ((n * c - ct) / (n * c + ct)) ** 2
  const ds = Math.max(1e-8, 1 - (s * a) ** 2), dp = Math.max(1e-8, 1 - (p * a) ** 2)
  const ts = (1 - s) ** 2 * a / ds, tp = (1 - p) ** 2 * a / dp
  return [(s + p + a * (ts * s + tp * p)) * .5, (ts + tp) * .5]
}

export const glassEyeDistance = (z: number) => (z - GLASS_EYE_Z) * SACR_PX_PER_METER
export const glassIncidence = (distance: number, dx: number, dy: number) => distance / Math.hypot(distance, dx, dy)

/** Reflect about glass Z, then intersect eye -> virtual source with the
 * pane. Equal-depth points share one affine map in world XY. Larger source Z
 * (below glass Z) is closer to the pane and occludes more distant sources. */
export function glassLayer(z: number, eye: { x: number; y: number }, sourceZ: number) {
  if (sourceZ >= z || z <= GLASS_EYE_Z) return null
  const scale = (z - GLASS_EYE_Z) / (2 * z - GLASS_EYE_Z - sourceZ)
  return { scale, x: (1 - scale) * eye.x, y: (1 - scale) * eye.y }
}

// Roughness controls angular spread (not R). The bake uses a normalized core
// and wing. A nearer finite lens keeps its own size plus angular spread.
export const glassLobe = (roughness: number) => .094 * roughness ** 2
export const glassDistance = (z: number, sourceZ: number) => (2 * z - GLASS_EYE_Z - sourceZ) * SACR_PX_PER_METER
export const glassEnvironmentRow = (profile: number, open: boolean, linear: boolean) =>
  GLASS_ENV_H * (profile * 2 + +open + (linear ? 0 : GLASS_PROFILES.length * 2))

export function glassLens(z: number, sourceZ: number, roughness: number, physicalRadius: number) {
  const spread = 2.2 * glassLobe(roughness) * glassDistance(z, sourceZ)
  const radius = Math.hypot(physicalRadius, spread)
  return { radius, peak: (physicalRadius / radius) ** 2 }
}

/** Canvas' display-space fallback uses the same projected radiance and R/T.
 * Applying this small neutral loss before source-over yields exactly T as
 * the room weight, without darkening the reflection or reweighting its lamps. */
export const canvasGlassLoss = (r: number, t: number) => r < 1 ? Math.max(0, 1 - t / (1 - r)) : 0
