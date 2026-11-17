/** STICKMAN RISING — src/game/world/consumers.ts
 * NO DEAD KNOBS: every profile axis, and the code that actually reads it.
 * ----------------------------------------------------------------------------
 * This file exists because of a bug bounty finding (O-08 in
 * docs/master/22-BUG-BOUNTY.md §2): eight of the profile's axes were computed,
 * documented, tested for spread — and never read by anything that draws. A
 * config knob the picture does not respond to is worse than no knob: it makes a
 * design document lie, and it makes a "procedural" world that the player
 * correctly perceives as a filter.
 *
 * The registry below is data, and `tests/profile-consumption.test.ts` turns it
 * into a gate with two mechanical checks:
 *
 *   1. every axis a profile HAS is listed here (no axis can be added without a
 *      consumer);
 *   2. every listed consumer file actually mentions the field (`grep`-based), so
 *      a refactor that deletes the read and leaves the comment behind FAILS.
 *
 * Check 2 is deliberately shallow — it proves a reference exists, not that the
 * reference is correct. That is the honest limit of a static check, and it still
 * catches the exact failure mode that shipped: a field with no reference at all.
 * ==========================================================================*/

import type { EnvironmentProfile } from './profile'

export interface AxisConsumer {
  /** "moon.phase", "grade.vignette", … */
  axis: string
  /** Repo-relative file that reads it. */
  file: string
  /** How the value reaches the picture, in one clause. */
  how: string
}

/** The complete list. Adding a field to EnvironmentProfile without adding a row
 *  here fails the gate. */
export const PROFILE_CONSUMERS: readonly AxisConsumer[] = [
  // ---- moon (baked plate, GPU or CPU) ----
  { axis: 'moon.phase', file: 'src/gpu/sky.ts', how: 'uPhase pushes the terminator; also gates the glitter gain' },
  { axis: 'moon.size', file: 'src/game/world/background.ts', how: 'draws the plate at MOON_D × size and scales the halo with it' },
  { axis: 'moon.tilt', file: 'src/gpu/sky.ts', how: 'uTilt rotates the key direction, so the crescent leans' },
  { axis: 'moon.tint', file: 'src/gpu/sky.ts', how: 'uTint mixes the palette warm/pop into the regolith' },
  { axis: 'moon.corona', file: 'src/gpu/sky.ts', how: 'uCorona scales the inner and outer scattering' },
  { axis: 'moon.drift', file: 'src/game/world/background.ts', how: 'multiplies the slow orbital wander' },
  // ---- stars ----
  { axis: 'stars.density', file: 'src/gpu/sky.ts', how: 'uDensity sets the acceptance threshold of both star grids' },
  { axis: 'stars.twinkle', file: 'src/gpu/sky.ts', how: 'uTwinkle widens the bloom of bright stars (a baked scintillation proxy)' },
  { axis: 'stars.warmth', file: 'src/gpu/sky.ts', how: 'uWarmth splits the field between blue-white and amber' },
  // ---- clouds ----
  { axis: 'clouds.coverage', file: 'src/game/world/background.ts', how: 'alpha of all three decks AND the presence/opacity of the bank' },
  { axis: 'clouds.altitude', file: 'src/game/world/background.ts', how: 'lifts the decks and the bank against the horizon' },
  { axis: 'clouds.speed', file: 'src/game/world/wind.ts', how: 'becomes the wind: deck drift, cable bow, pennant flutter' },
  { axis: 'clouds.texture', file: 'src/game/world/clouds.ts', how: 'torn = blob count, edge hardness and rim strength' },
  // ---- aurora ----
  { axis: 'aurora.presence', file: 'src/game/world/background.ts', how: 'skips the pass entirely below 0.02, else scales alpha' },
  { axis: 'aurora.hue', file: 'src/game/world/background.ts', how: 'selects the two ribbon colours from the palette' },
  { axis: 'aurora.height', file: 'src/game/world/background.ts', how: 'scales the ribbon tile vertically' },
  // ---- atmosphere ----
  { axis: 'atmosphere.pollution', file: 'src/game/world/background.ts', how: 'scales the horizon light-pollution bloom' },
  { axis: 'atmosphere.fog', file: 'src/game/world/background.ts', how: 'opacity of the parallax fog plane' },
  { axis: 'atmosphere.fogHeight', file: 'src/game/world/background.ts', how: 'vertical placement of that plane' },
  { axis: 'atmosphere.meteors', file: 'src/game/world/background.ts', how: 'divides the shooting-star slot length' },
  // ---- weather ----
  { axis: 'weather.stormBias', file: 'src/game/world/storm.ts', how: 'multiplies the strike interval AND weights the weather front bands (world/weather.ts)' },
  { axis: 'weather.rain', file: 'src/game/world/storm.ts', how: 'setRainScale — rain density, then the front multiplies it per band' },
  { axis: 'weather.cadence', file: 'src/game/world/storm.ts', how: 'divides the interval again: lightning cadence' },
  // ---- grade (baked into the arena plate) ----
  { axis: 'grade.temperature', file: 'src/game/world/background.ts', how: 'bias of the split-tone: warm run vs cool run' },
  { axis: 'grade.contrast', file: 'src/game/world/background.ts', how: 'strength of the split-tone and the black point' },
  { axis: 'grade.saturation', file: 'src/game/world/background.ts', how: 'desaturating pass when below 1, warm overlay above' },
  { axis: 'grade.vignette', file: 'src/game/world/background.ts', how: 'scales the baked vignette plate' },
  { axis: 'grade.grain', file: 'src/game/world/background.ts', how: 'grain count and amplitude of the film plate' },
  // ---- practicals ----
  { axis: 'light.warm', file: 'src/game/world/background.ts', how: 'gain on the stairwell practical' },
  { axis: 'light.cool', file: 'src/game/world/background.ts', how: 'gain on the streetlight practical' },
  { axis: 'light.flicker', file: 'src/game/world/background.ts', how: 'dim-only flicker of the failing tube' },
  { axis: 'light.key', file: 'src/game/world/night.ts', how: 'gain of the moon key rim on the figure' },
  // ---- props ----
  { axis: 'props.density', file: 'src/game/world/props.ts', how: 'concurrent cap of auto-placed props' },
  { axis: 'props.timerJitter', file: 'src/game/world/props.ts', how: 'multiplier on the arrival gap' },
  { axis: 'props.crateBias', file: 'src/game/world/props.ts', how: 'weight multiplier on the two crate kinds' },
] as const

/** Every axis path a profile actually has, derived from a live object so it can
 *  never drift from the schema. */
export function allAxisPaths(p: EnvironmentProfile): string[] {
  const out: string[] = []
  const groups = ['moon', 'stars', 'clouds', 'aurora', 'atmosphere', 'weather', 'grade', 'light', 'props'] as const
  for (const g of groups) {
    const obj = p[g] as unknown as Record<string, number>
    for (const k of Object.keys(obj)) out.push(`${g}.${k}`)
  }
  return out
}

/** Axes in the profile that no consumer claims. Empty means every knob is read. */
export function unclaimedAxes(p: EnvironmentProfile): string[] {
  const claimed = new Set(PROFILE_CONSUMERS.map((c) => c.axis))
  return allAxisPaths(p).filter((a) => !claimed.has(a))
}
