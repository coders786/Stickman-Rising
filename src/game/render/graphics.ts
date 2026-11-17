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
  /** How many slices the mirror band is drawn in (each is one blit). */
  reflectionSlices: number
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
}

/** THE TABLE. Reading it column by column is reading the budget. */
export const GRAPHICS: Readonly<Record<Tier, GraphicsFeatures>> = {
  low: {
    shadows: 'contact',
    penumbra: 0,
    shafts: false,
    dust: false,
    reflection: 0,
    reflectionSlices: 0,
    dprCap: 1,
    glitter: false,
    gradeTint: false,
    rim: false,
    practicalShadow: false,
    propRim: false,
  },
  medium: {
    shadows: 'contact',
    penumbra: 1,
    shafts: false,
    dust: false,
    reflection: 8,
    reflectionSlices: 2,
    dprCap: 1.25,
    glitter: true,
    gradeTint: true,
    rim: true,
    practicalShadow: false,
    propRim: false,
  },
  high: {
    shadows: 'cast',
    penumbra: 2,
    shafts: true,
    dust: false,
    reflection: 6,
    reflectionSlices: 3,
    dprCap: 1.5,
    glitter: true,
    gradeTint: true,
    rim: true,
    practicalShadow: true,
    propRim: false,
  },
  ultra: {
    shadows: 'cast+props',
    penumbra: 3,
    shafts: true,
    dust: true,
    reflection: 4,
    reflectionSlices: 4,
    dprCap: 2,
    glitter: true,
    gradeTint: true,
    rim: true,
    practicalShadow: true,
    propRim: true,
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

/**
 * Classify from facts the browser will actually tell us.
 *
 * We do NOT sniff the GPU string: 14 §2 measured that renderer strings are
 * blocked, spoofed or missing often enough that a tier chosen from them is a
 * coin flip. `pointer: fine` + no touch + a large viewport is a *behavioural*
 * fact, and it is the one that correlates with "there is a discrete GPU and a
 * wall socket here".
 *
 * The thresholds are provisional and labelled: 2.3 MP is a 1440×900 CSS viewport
 * at DPR 1.3. The governor can still shed from `start` — this only decides where
 * the player begins, which is the first impression and therefore the thing the
 * "it looks cheap" complaint was actually about.
 */
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
  // A big, pointer-driven screen is the only place `ultra` is offered. It is
  // still a choice: the governor sheds out of it in one window if the frame
  // budget says the GPU disagrees with the viewport.
  // 1080p at DPR 1 is 2.07 MP and is the canonical desktop: the bar has to sit
  // below it or the machine the feature is FOR never gets offered it.
  if (desktop && megapixels >= 1.9) return { desktop, megapixels, start: 'high', ceiling: 'ultra' }
  if (desktop) return { desktop, megapixels, start: 'medium', ceiling: 'high' }
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
