/** STICKMAN RISING — src/game/world/light.ts
 * ONE KEY LIGHT, THREE CONSUMERS (docs/master §T4.1).
 * ----------------------------------------------------------------------------
 * The stage has exactly one light that comes from outside: the moon. Every
 * "lit" thing in the frame is a claim ABOUT that moon —
 *
 *   · where the moon is drawn (the sky pass),
 *   · which side the contact shadows fall on (render/grow),
 *   · which edge of the figure takes the rim (world/night),
 *   · which way the cables' rim is offset (world/rigging),
 *   · where the wet deck sparkles (world/night.drawGlitter).
 *
 * Before this file each of those answered the question itself, and they
 * disagreed: shadows were hard-coded lower-left, the cable rim was hard-coded
 * right, and the moon itself sat at a fixed `w * 0.87`. Five sources of truth
 * for one light is five chances to be wrong, and a player reads the disagreement
 * long before they can name it — light that does not agree with itself is the
 * single most common reason a stylised scene looks cheap.
 *
 * So: one model, derived from the profile, no state, no clock.
 *
 * WHY THE MOON'S POSITION IS AN AXIS NOW. `moon.tilt` was documented as "the key
 * direction" but only reached the shader's crescent rotation — the actual light
 * never moved. Mapping tilt → screen azimuth makes the key direction a per-run
 * identity: a run whose moon hangs near the middle throws short cross-shadows
 * and rims both sides of a silhouette; a run with the moon far right throws long
 * left-falling shadows and one hard rim. Same art, different photograph.
 *
 * THE COMPOSITION CONSTRAINT, STATED SO IT CANNOT BE VIOLATED BY ACCIDENT: the
 * moon never leaves the right 56–88 % of the frame. Lower is where the HUD and
 * the title live, and the moon sitting dead centre puts the brightest object in
 * the game exactly where the player's eyes should be on the fight (03 §"awe is
 * a direction, not a brightness"). `moonCentreX` is the ONLY function allowed to
 * apply that mapping; tests assert the band for every tilt and every camera.
 * ==========================================================================*/

import type { EnvironmentProfile } from './profile'

export interface KeyLight {
  type: 'directional'
  /** −1 = the light comes from the far left … +1 = far right. */
  azimuth: number
  /** 0 = on the horizon … 1 = at the zenith. The stage composes the moon high,
   *  so this is a constant — but it is a constant EVERY consumer reads, not a
   *  number five files each remember differently. */
  elevation: number
  /** 0 = cold silver … 1 = warm amber. Reads `moon.tint`. */
  warmth: number
}

/** The authored height of the key. One number, one owner. */
export const STAGE_ELEVATION = 0.78
/** Where the moon may sit, as a fraction of frame width. See the header. */
export const MOON_X_MIN = 0.56
export const MOON_X_MAX = 0.88

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo * 0.5 + hi * 0.5
}

/** The whole model. Pure, allocation-free, and cheap enough for a draw path. */
export function keyLightFor(p: EnvironmentProfile): KeyLight {
  return {
    type: 'directional',
    // tilt ∈ [−34, 34] — ±34° is the authored limit of the crescent's lean, and
    // it doubles as the authored limit of the key's swing.
    azimuth: clamp(p.moon.tilt / 34, -1, 1),
    elevation: STAGE_ELEVATION,
    warmth: clamp(p.moon.tint, 0, 1),
  }
}

/** Screen x of the moon's CENTRE, in px, for a frame of width `w`.
 *  `parallax` is the sky layer's scroll offset (the moon is not on the same
 *  plane as the city), `t` the ambient clock and `drift` the profile's orbital
 *  speed. The ±46 px wander is the existing authored drift and is preserved:
 *  a perfectly still moon reads as a sticker. */
export function moonCentreX(light: KeyLight, w: number, parallax: number, t: number, drift = 1): number {
  const span = MOON_X_MAX - MOON_X_MIN
  const base = w * (MOON_X_MIN + span * 0.5 * (1 + light.azimuth))
  // The sky plane does scroll, but a light that slides out of frame on a narrow
  // phone is a bug, not parallax. The offset is capped at 5 % of the frame, so
  // the composition band above survives any camera the stage can produce.
  const cap = w * 0.05
  const par = Number.isFinite(parallax) ? Math.max(-cap, Math.min(cap, parallax)) : 0
  // The wander is authored in PIXELS but must be a FRACTION of the frame: 46 px
  // is a gentle drift on a 1280-wide desktop frame and a 14 % shove on a 320 px
  // phone frame, which would break the composition band. Cap it at 3.5 %.
  const wander = Math.min(46, w * 0.035)
  return base - par + Math.sin(t * 0.021 * drift) * wander
}

/** Which way a figure at world/screen x casts its contact shadow: away from the
 *  key. A figure standing under the moon casts nearly straight down; the caller
 *  handles that with `shadowReach`. */
export function shadowDirection(x: number, moonX: number): -1 | 1 {
  return x < moonX ? -1 : 1
}

/** How far that shadow is thrown, as a multiple of the figure's width, given the
 *  horizontal distance to the key AS A FRACTION OF FRAME WIDTH (so it does not
 *  change with resolution or DPR). Under the key: ~0.35 (straight down). At the
 *  far edge of a phone frame: ~1.2. */
export function shadowReach(elevation: number, distanceFraction: number): number {
  const e = Number.isFinite(elevation) ? Math.max(0, Math.min(1, elevation)) : STAGE_ELEVATION
  const d = Math.abs(distanceFraction)
  // Distance alone is not the whole story: a high key (elevation → 1) throws a
  // SHORTER shadow at the same horizontal distance than a low one, because the
  // ray leaves steeper. The factor keeps the model honest if the stage ever
  // lowers the moon for a sunrise/sunset look.
  const lift = 0.55 + 0.45 * (1 - e)
  return clamp((0.35 + d * 1.9) * lift, 0.28, 1.25)
}

/** Which side takes the rim: +1 right, −1 left. Same rule as the shadows, from
 *  the same numbers — this function exists so callers cannot disagree. */
export function rimDirection(moonX: number, frameW: number): -1 | 1 {
  return moonX < frameW * 0.5 ? -1 : 1
}

/** Gain for anything that is a *reflection* of the key (glitter, wet deck,
 *  mirror band). A low, warm moon smears more; a high, cold one sparkles harder.
 *  Range ≈ 0.7–1.3, deliberately narrow — a reflection that pumps reads as a
 *  bug, not as light. */
export function reflectionGain(light: Pick<KeyLight,'warmth'|'elevation'|'azimuth'>): number {
  const low = 1 - light.elevation // 0.22 at the authored height
  return 0.78 + 0.5 * low + 0.22 * (1 - light.warmth) + 0.12
}

/** Parallel moon rays: moving the camera cannot move a world-space shadow. */
export function directionalProjection(light:Pick<KeyLight,'azimuth'|'elevation'>){
  const horizontal=.64+.25*light.azimuth
  return {dir:-1 as const,reach:shadowReach(light.elevation,horizontal),keyX:horizontal}
}
