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
 * Presets are fixed feature sets. RenderScaleControl can shrink the backing
 * store without changing this table or the current preset.
 *
 * WHAT A TIER MAY NEVER REMOVE (07 §"what a tier may not remove", Rule 10):
 * weather exists on every tier (rain, fog, wind, the front), the moon and its
 * phase, the run identity, contact shadows (a tier may lose *cast* shadow, but a
 * fighter always touches the deck), and the HUD. Those are the game; the rest is
 * fidelity.
 * ==========================================================================*/

export type Tier = 'ultra' | 'high' | 'medium' | 'low'

/** `contact`: soft soles; `cast`: add one graded pose projection;
 *  `cast+props`: also project each visible prop's baked mask once. */
export type ShadowMode = 'contact' | 'cast' | 'cast+props'

export interface GraphicsFeatures {
  /** How figures are grounded. */
  shadows: ShadowMode
  /** Blits per visible practical cone: off, soft, or soft with a focused core. */
  shaftLayers: 0 | 1 | 2
  /** Ambient motes drifting in the practicals' cones (one path, ~24 dots). */
  dust: boolean
  /** Capture-route reflection band: 0 = off, otherwise the downscale divisor. */
  reflection: number
  /** Forward-route mirror. Medium uses a short outline; High reuses its cast path. */
  actorMirror: 'off' | 'coarse' | 'posed'
  /** Small moving highlights per visible curb lens, on either render route. */
  wetGlints: 0 | 5 | 11
  /** Scene render scale at locked fidelity. This is the single most expensive dial. */
  dprCap: number
  /** Moon glitter on the wet deck. */
  glitter: boolean
  /** The player-keyed rim from the nearest practical. */
  rim: boolean
  /** Successive finish on the same visible fixtures: base, contacts, hardware,
   * then moon-facing bevels. The layout, blockers and bulb never change. */
  roofFinish: 0 | 1 | 2 | 3
  /** Fixed city-animation budget per repeating band tile. The city and its
   * visible signs are baked; this is the number of extra animated details. */
  buildingAnims: number
  /** Maximum live remainder blits. All steady pools are baked at every tier. */
  poolModulations: number

  /* Legacy optics for ungraded diagnostic scenes. The authored arenas use
   * fixture-local baked halos at every tier and skip these passes. */

  /** Screen-space bloom: one downscale of the frame, squared (a cheap luminance
   *  cut-off) and added back at two scales. 6 blits, ultra only. */
  bloom: boolean
  /** Radial smear of that same squared buffer away from each practical: at most
   *  8 additive taps, ultra only. */
  godRays: boolean
  /** Directional top-light on a figure (the key from above), not just a side rim. */
  keyTop: boolean
}

/** THE TABLE. Reading it column by column is reading the budget. */
export const GRAPHICS: Readonly<Record<Tier, GraphicsFeatures>> = {
  low: {
    shadows: 'contact',
    shaftLayers: 0,
    dust: false,
    reflection: 0,
    actorMirror: 'off',
    wetGlints: 0,
    dprCap: .75,
    glitter: false,
    rim: false,
    roofFinish: 0,
    buildingAnims: 0,
    poolModulations: 0,
    bloom: false,
    godRays: false,
    keyTop: false,
  },
  medium: {
    shadows: 'contact',
    shaftLayers: 0,
    dust: false,
    reflection: 8,
    actorMirror: 'coarse',
    wetGlints: 0,
    dprCap: 1,
    glitter: true,
    rim: true,
    roofFinish: 1,
    buildingAnims: 2,
    poolModulations: 0,
    bloom: false,
    godRays: false,
    keyTop: false,
  },
  high: {
    shadows: 'cast',
    shaftLayers: 1,
    dust: false,
    reflection: 6,
    actorMirror: 'posed',
    wetGlints: 5,
    dprCap: 1.15,
    glitter: true,
    rim: true,
    roofFinish: 2,
    buildingAnims: 4,
    poolModulations: 1,
    bloom: false,
    godRays: false,
    keyTop: true,
  },
  ultra: {
    shadows: 'cast+props',
    shaftLayers: 2,
    dust: true,
    reflection: 3,
    actorMirror: 'posed',
    wetGlints: 11,
    dprCap: 1.25,
    glitter: true,
    rim: true,
    roofFinish: 3,
    buildingAnims: 8,
    poolModulations: 5,
    bloom: true,
    godRays: true,
    keyTop: true,
  },
} as const

/** Features for a tier, with an unknown tier falling back to `low` rather than
 *  to `ultra`: a typo must never silently enable the expensive path. */
export function featuresFor(t: Tier): GraphicsFeatures {
  return GRAPHICS[t] ?? GRAPHICS.low
}

/** A click is an explicit lock, even when the same preset was adaptive. */
export function lockQualityPreset<T extends { quality: Tier; adaptiveQuality: boolean }>(settings: T, quality: Tier): T {
  return { ...settings, quality, adaptiveQuality: false }
}

export interface DeviceClass {
  /** A mouse/trackpad and no touch: the profile of a desktop. */
  desktop: boolean
  /** Rough pixels to shade per frame; the honest proxy for what a tier costs. */
  megapixels: number
  /** The tier this device should START at. */
  start: Tier
}

/** First-run policy, not a GPU benchmark. A fine pointer says nothing
 * about bandwidth or GPU speed. Start desktops at native scale; saved
 * presets and locks still win. */
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
    return { desktop, megapixels, start: 'medium' }
  }
  // A conservative suggestion for touch. All four presets remain available.
  if (megapixels >= 3.2) return { desktop, megapixels, start: 'medium' }
  return { desktop, megapixels, start: 'low' }
}

/** Public preset names are separate from saved IDs and from renderer admission. */
export const QUALITY_PRESETS = ['low', 'medium', 'high', 'ultra'] as const satisfies readonly Tier[]
export const QUALITY_NAMES: Readonly<Record<Tier, string>> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' }

export type BridgePath = 'master-webgl2' | 'mobile-webgl2' | 'mobile-canvas'
export const RENDERER_NAMES: Readonly<Record<BridgePath, string>> = {
  'master-webgl2': 'WebGL2 HDR',
  'mobile-webgl2': 'WebGL2 Optimized',
  'mobile-canvas': 'Canvas 2D',
}
