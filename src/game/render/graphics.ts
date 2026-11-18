/** STICKMAN RISING — src/game/render/graphics.ts
 * THE GRAPHICS LEVELS: what each tier actually turns ON.
 * ----------------------------------------------------------------------------
 * Until now "quality" was a word passed around: `background.ts` clustered on it,
 * the storm clustered on it, the DPR governor clustered on it, and the settings
 * screen wrote it into localStorage. Nothing said what a tier *means*. That is
 * how a game ends up with an "ultra" that looks like the default — and with a
 * default that looks cheap.
 *
 * This file is the single table. Every consumer asks `featuresFor(tier)` and
 * gets a set of booleans and small integers; no module invents its own idea of
 * what "high" buys. The table is also the budget document (`06` §4, `07` §11):
 * the cost of a tier is the sum of the effects it enables, and each effect below
 * is bounded to a handful of fills or blits.
 *
 * THE ORDER OF THE LADDER IS FIXED (ultra > high > medium > low) because
 * `render/quality.ts` and every existing consumer already read it.
 *
 * WHAT A TIER MAY NEVER REMOVE (07 §"what a tier may not remove", Rule 10):
 * weather exists on every tier (rain, fog, wind, the front), the moon and its
 * phase, the run identity, contact shadows (a tier may lose *cast* shadow, but a
 * fighter always touches the deck), and the HUD. Those are the game; the rest is
 * fidelity.
 * ==========================================================================*/

export type Tier = 'ultra' | 'high' | 'medium' | 'low'

/** Shadow mode. `contact` is the flat ellipse; `cast` is the projected body;
 *  `cast+props` additionally projects every prop's SILHOUETTE onto the deck. */
export type ShadowMode = 'contact' | 'cast' | 'cast+props'

export interface GraphicsFeatures {
  /** How figures are grounded. */
  shadows: ShadowMode
  /** Softness passes stacked under the hard core: 0 = crisp edge, 3 = soft. */
  penumbra: number
  /** Volumetric cones from the two practicals (2 additive blits). */
  shafts: boolean
  /** Ambient motes drifting in the practicals' cones (one path, ~24 dots). */
  dust: boolean
  /** Reflection band: 0 = off, otherwise the downscale factor (smaller = finer). */
  reflection: number
  /** Device-pixel-ratio cap. This is the single most expensive dial. */
  dprCap: number
  /** Moon glitter on the wet deck. */
  glitter: boolean
  /** The weather front's colour fill over the sky. */
  gradeTint: boolean
  /** The player-keyed rim from the nearest practical. */
  rim: boolean
  /** A second cast shadow from the nearest practical (the multi-light read). */
  practicalShadow: boolean
  /** Prop silhouettes get a moon-side rim edge. */
  propRim: boolean
  /** Rooftop props drawn live on the deck (condensers, tanks, vents, the run's
   *  own bulb). 0 = a bare deck, which is what a tier may choose to lose. */
  roofProps: number
  /** City ANIMATION records drawn per band — the windows that change, the signs
   *  that buzz, the vents that breathe. The city itself is always baked; this is
   *  how much of it is alive. */
  buildingAnims: number
  /** Additive deck pools under the practicals, beyond the player-keyed one. */
  lightPools: number

  /* ------------------------- the ULTRA stack ------------------------- *
   * These four exist ONLY on ultra, and they are what makes ultra a
   * different picture rather than a slightly cleaner one. Each is a
   * screen-space pass with a fixed blit budget (see render/post.ts). */

  /** Screen-space bloom: one downscale of the frame, squared (a cheap luminance
   *  cut-off) and added back at two scales. 6 blits, ultra only. */
  bloom: boolean
  /** Radiated god rays from the practicals: an 8-tap additive smear. 8 blits. */
  /** Radial smear of that same squared buffer away from each practical: at most
   *  8 additive taps, ultra only. */
  godRays: boolean
  /** Directional top-light on a figure (the key from above), not just a side rim. */
  keyTop: boolean
  /** Atmospheric depth on the fighters: haze thickens with distance from the
   *  camera's focus line, so the horde reads as a crowd in air, not a row. */
  depthHaze: boolean
}

/** THE TABLE. Reading it column by column is reading the budget. */
export const GRAPHICS: Readonly<Record<Tier, GraphicsFeatures>> = {
  low: {
    shadows: 'contact',
    penumbra: 0,
    shafts: false,
    dust: false,
    reflection: 0,
    dprCap: 1,
    glitter: false,
    gradeTint: false,
    rim: false,
    practicalShadow: false,
    propRim: false,
    roofProps: 0,
    buildingAnims: 0,
    lightPools: 0,
    bloom: false,
    godRays: false,
    keyTop: false,
    depthHaze: false,
  },
  medium: {
    shadows: 'contact',
    penumbra: 1,
    shafts: false,
    dust: false,
    reflection: 8,
    dprCap: 1.25,
    glitter: true,
    gradeTint: true,
    rim: true,
    practicalShadow: false,
    propRim: false,
    roofProps: 6,
    buildingAnims: 2,
    lightPools: 1,
    bloom: false,
    godRays: false,
    keyTop: false,
    depthHaze: false,
  },
  high: {
    shadows: 'cast',
    penumbra: 2,
    shafts: true,
    dust: false,
    reflection: 6,
    dprCap: 1.5,
    glitter: true,
    gradeTint: true,
    rim: true,
    practicalShadow: true,
    propRim: false,
    roofProps: 12,
    buildingAnims: 4,
    lightPools: 2,
    bloom: false,
    godRays: false,
    keyTop: true,
    depthHaze: false,
  },
  ultra: {
    shadows: 'cast+props',
    penumbra: 4,
    shafts: true,
    dust: true,
    reflection: 3,
    dprCap: 2.25,
    glitter: true,
    gradeTint: true,
    rim: true,
    practicalShadow: true,
    propRim: true,
    roofProps: 22,
    buildingAnims: 8,
    lightPools: 6,
    bloom: true,
    godRays: true,
    keyTop: true,
    depthHaze: true,
  },
} as const

const ORDER: readonly Tier[] = ['low', 'medium', 'high', 'ultra']

export function tierIndex(t: Tier): number {
  const i = ORDER.indexOf(t)
  return i < 0 ? 0 : i
}

/** Features for a tier, with an unknown tier falling back to `low` rather than
 *  to `ultra`: a typo must never silently enable the expensive path. */
export function featuresFor(t: Tier): GraphicsFeatures {
  return GRAPHICS[t] ?? GRAPHICS.low
}

/** Clamp a requested tier into [floor, ceiling]. Used by the governor: a shed
 *  may not go below `low`, and a raise may not exceed the player's choice. */
export function clampTier(t: Tier, ceiling: Tier, floor: Tier = 'low'): Tier {
  const i = tierIndex(t)
  const lo = tierIndex(floor)
  const hi = tierIndex(ceiling)
  return ORDER[Math.max(lo, Math.min(hi, i))]
}

/* -------------------------------------------------------------------------- */
/* DEVICE CLASS                                                               */
/* -------------------------------------------------------------------------- */

export interface DeviceClass {
  /** A mouse/trackpad and no touch: the profile of a desktop. */
  desktop: boolean
  /** Rough pixels to shade per frame; the honest proxy for what a tier costs. */
  megapixels: number
  /** The tier this device should START at. */
  start: Tier
  /** The highest tier this device is offered. */
  ceiling: Tier
}

/** First-run policy, not a GPU benchmark. A pointer desktop starts on Ultra
 * even in a small window. Saved settings and the frame-time governor still win. */
export function classifyDevice(v: {
  width: number
  height: number
  dpr: number
  finePointer: boolean
  touch: boolean
}): DeviceClass {
  const w = Math.max(1, v.width)
  const h = Math.max(1, v.height)
  const dpr = Number.isFinite(v.dpr) && v.dpr > 0 ? v.dpr : 1
  const megapixels = (w * h * dpr * dpr) / 1e6
  const desktop = v.finePointer && !v.touch
  if (desktop && Number.isFinite(v.width * v.height) && v.width > 0 && v.height > 0) {
    return { desktop, megapixels, start: 'ultra', ceiling: 'ultra' }
  }
  // Touch devices: phones and tablets. `high` is offered on big tablets only.
  if (megapixels >= 3.2) return { desktop, megapixels, start: 'medium', ceiling: 'high' }
  return { desktop, megapixels, start: 'low', ceiling: 'medium' }
}

/** A conservative fallback for headless callers (tests, the bench). */
export const HEADLESS_CLASS: DeviceClass = {
  desktop: false,
  megapixels: 0,
  start: 'low',
  ceiling: 'medium',
}
