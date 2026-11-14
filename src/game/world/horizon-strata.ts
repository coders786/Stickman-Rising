/**
 * Horizon-Strata bridge for world backgrounds (`ZenNightBackground` & `CyberBackground`).
 * Re-exports BHST viewport coherence cache, world-frustum sub-rect blitter,
 * and Moonlit Sakura Sanctuary optics/shadow/damage-lattice engine primitives.
 */
export {
  SkyVaultCache,
  blitWorldFrustum,
  shallowFog,
  DamageSurface,
  ShadowFieldSAT,
  POISSON_12,
  NOISE_BYTES,
  hashCPU,
  fbm3CPU,
  windAt,
  buildLunarSurface,
} from '../render/bhst'

