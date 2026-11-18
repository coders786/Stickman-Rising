/** STICKMAN RISING — src/game/world/lightfield.ts
 * A LIGHT FIELD, NOT A LIGHT BULB.
 * ----------------------------------------------------------------------------
 * Before this file the stage had "the practicals": two hard-coded x positions
 * and a linear `1 - d/300` used in exactly one place (the player's rim). The
 * consequence is easy to see and hard to name: you could stand in the stairwell
 * light and the light did not touch you — no pool on the deck, no warm face, no
 * shadow thrown by the door instead of by the moon. A light that only rim-lights
 * one sprite is a filter, not a light.
 *
 * So the stage now owns a FIELD: a small array of point sources, each with a
 * position, a radius, a colour kind, a gain and a flicker. Everything that wants
 * to know "how lit is this spot" asks `sampleLight()` and gets one answer:
 *
 *   · the deck pools (background.drawLightPools),
 *   · the second cast shadow (renderer.shade → bg.practicalShadow),
 *   · the figure wash + rim (background.drawFigureLighting),
 *   · the motes' source (background.drawMotes),
 *   · the roof lamp the procedural rooftop props generate (world/roofprops.ts).
 *
 * ONE FALL-OFF, STATED ONCE. `falloff()` is a smoothstep squared: 1 at the
 * source, 0 exactly at the radius, C¹ at both ends. The old linear ramp has a
 * corner at the radius — the eye reads that corner as a ring, and a ring is the
 * single most "programmer art" artifact in 2-D lighting. Smoothstep also fixes
 * the second problem: a linear ramp puts too much energy far from the source, so
 * two nearby lights sum to a washed-out blob. This curve keeps energy where the
 * light is.
 *
 * NO CLOCK, NO RANDOM, NO ALLOCATION IN THE SAMPLE PATH. `sampleLight` takes `t`
 * and returns into a caller-owned object, because it runs per figure per frame.
 * Flicker is a deterministic function of `t` and the source's phase — a failing
 * tube that fails the same way on every replay is a character, not noise.
 * ==========================================================================*/

/** Which practical a source is. `warm` is the stairwell head-house, `cool` the
 *  failing streetlight, `bulb` a bare bulb on a cable, `neon` a sign, `moon`
 *  reserved for the key (the moon's own light is not in the field: it is a
 *  directional model in world/light.ts and must not be sampled as a point). */
export type LightKind = 'warm' | 'cool' | 'bulb' | 'neon' | 'city'

export interface PointLight {
  readonly id: string
  /** World x of the emitter. */
  x: number
  /** World y of the emitter: the deck is y = 0, so emitters hang ABOVE it. */
  y: number
  kind: LightKind
  /** Distance at which the contribution reaches exactly 0, px. */
  radius: number
  /** Profile gain, 0–1.4. Above 1 is the "blazing" end of the profile axis. */
  gain: number
  /** 0 = steady, 1 = fully failing. */
  flicker: number
  /** Flicker speed, Hz. Two nearby tubes at the same Hz read as one object. */
  flickerHz: number
  /** Phase offset, so a row of lights never blinks in lockstep. */
  phase: number
}

export interface LightSample {
  /** Σ warm-family weight at the point (0 … ~1.6 when two overlap). */
  warm: number
  /** Σ cool-family weight. */
  cool: number
  /** Σ neon-family weight (signs — colour, deliberately weak). */
  neon: number
  /** Σ city-bounce weight: the light coming up off the street below the roof.
   *  Always present, never enough to fight a practical. */
  city: number
  /** The strongest single source, for direction and ink. `null` = unlit. */
  best: PointLight | null
  /** That source's weight at the point. */
  bestW: number
  /** Which way a shadow falls from the strongest source: away from it. */
  dir: -1 | 1
}

/** The two stage practicals, as world x. Exported because they are not
 *  background.ts's private business: the rooftop props must not be placed on top
 *  of them, and the tests assert the roof lamp is somewhere else. */
export const PRACTICAL_DOOR_X = 1755
export const PRACTICAL_LAMP_X = 830

/** A practical's shadow is a COLOURED absence — the light it blocks is coloured.
 *  Warm blocked is a brown shadow, cool blocked is a blue one. These are the
 *  inks the cast-shadow painter takes. */
export const LIGHT_INK: Readonly<Record<LightKind, string>> = {
  warm: '16,8,4',
  cool: '4,7,14',
  bulb: '14,10,2',
  neon: '8,4,14',
  // CITY BOUNCE — light pollution coming UP from the street below the roof.
  // Its shadow is a warm-grey absence, never black: it is the dimmest source in
  // the field and the one that is always there.
  city: '13,10,7',
}

/** Body-wash tint per kind: what a lit surface picks up. Kept dim on purpose —
 *  an additive wash that is visible as a colour is a filter, not light. */
export const LIGHT_TINT: Readonly<Record<LightKind, readonly [number, number, number]>> = {
  warm: [255, 168, 92],
  cool: [126, 190, 255],
  bulb: [255, 214, 150],
  neon: [196, 120, 255],
  // sodium street lighting and window spill, seen from a roof: amber, slightly
  // green, and never strong enough to cast a hard shadow of its own.
  city: [255, 186, 120],
}

const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')

/** The same tints as '#rrggbb'. Two formats exist in this codebase for a good
 *  reason and mixing them is a real bug: `rgbaConst()` takes "r,g,b" (the draw
 *  path's cached strings and the shadow inks), while `rgba()` in core/utils takes
 *  '#rrggbb' — feeding it an "r,g,b" triple silently parses garbage ("255,168,92"
 *  becomes rgb(37,81,146), a BLUE). The FX hit light needs the hex form. */
export const LIGHT_HEX: Readonly<Record<LightKind, string>> = {
  warm: `#${hex2(LIGHT_TINT.warm[0])}${hex2(LIGHT_TINT.warm[1])}${hex2(LIGHT_TINT.warm[2])}`,
  cool: `#${hex2(LIGHT_TINT.cool[0])}${hex2(LIGHT_TINT.cool[1])}${hex2(LIGHT_TINT.cool[2])}`,
  bulb: `#${hex2(LIGHT_TINT.bulb[0])}${hex2(LIGHT_TINT.bulb[1])}${hex2(LIGHT_TINT.bulb[2])}`,
  neon: `#${hex2(LIGHT_TINT.neon[0])}${hex2(LIGHT_TINT.neon[1])}${hex2(LIGHT_TINT.neon[2])}`,
  city: `#${hex2(LIGHT_TINT.city[0])}${hex2(LIGHT_TINT.city[1])}${hex2(LIGHT_TINT.city[2])}`,
}

/** Smoothstep-squared fall-off. 1 at the source, 0 at and beyond `radius`,
 *  monotone in between, flat at both ends so no ring forms at the cut-off. */
export function falloff(distance: number, radius: number): number {
  if (!(radius > 0)) return 0
  const d = Math.abs(distance)
  if (!(d < radius)) return 0
  const u = 1 - d / radius
  return u * u * (3 - 2 * u)
}

/** A source's live gain at time `t`. Flicker only ever DIMS: an additive
 *  flicker that brightens is a strobe, which is a medical consideration as much
 *  as a taste one. */
export function liveGain(l: PointLight, t: number): number {
  if (l.flicker <= 0) return l.gain
  // Two incommensurate sines: one tube, two failure modes (a ballast buzz and a
  // loose contact). Still a pure function of t, so a replay flickers identically.
  const a = 0.5 + 0.5 * Math.sin(t * l.flickerHz * 6.283 + l.phase)
  const b = 0.5 + 0.5 * Math.sin(t * l.flickerHz * 2.31 + l.phase * 1.7)
  return Math.max(0, l.gain * (1 - l.flicker * (0.55 * a + 0.45 * b)))
}

/** THE QUERY. Fill `out` (reused by callers) and return it. */
export function sampleLight(
  lights: readonly PointLight[],
  x: number,
  y: number,
  t: number,
  out: LightSample,
): LightSample {
  out.warm = 0
  out.cool = 0
  out.neon = 0
  out.city = 0
  out.best = null
  out.bestW = 0
  out.dir = 1
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i]
    const dx = x - l.x
    // A source hanging 60 px above the deck lights the deck under it, so the
    // vertical term is deliberately soft: half the horizontal weight, not none.
    const dy = (y - l.y) * 0.5
    const d = Math.sqrt(dx * dx + dy * dy)
    const f = falloff(d, l.radius)
    if (f <= 0) continue
    const w = f * liveGain(l, t)
    if (w <= 0) continue
    if (l.kind === 'warm' || l.kind === 'bulb') out.warm += w
    else if (l.kind === 'cool') out.cool += w
    else if (l.kind === 'city') out.city += w
    else out.neon += w
    if (w > out.bestW) {
      out.bestW = w
      out.best = l
      out.dir = dx >= 0 ? 1 : -1
    }
  }
  return out
}

/** A fresh sample object. Callers that sample per frame keep ONE of these. */
export function newSample(): LightSample {
  return { warm: 0, cool: 0, neon: 0, city: 0, best: null, bestW: 0, dir: 1 }
}

/** THE STAGE'S FIXED SOURCES. Two practicals, always, on every tier: the
 *  stairwell and the streetlight are the place, not a fidelity feature. The
 *  profile decides how strong and how steady each one is. */
export function makeStageLights(profile: {
  light: { warm: number; cool: number; flicker: number }
} | null, seed: number): PointLight[] {
  const K = profile ? profile.light : null
  const warm = K ? K.warm : 1
  const cool = K ? K.cool : 1
  const flick = K ? K.flicker : 0
  const out: PointLight[] = [
    {
      // The stairwell door head-house: a warm, steady interior spilling out.
      id: 'stage:door',
      x: PRACTICAL_DOOR_X,
      y: -150,
      kind: 'warm',
      radius: 330,
      gain: 0.72 + 0.5 * warm,
      flicker: flick * 0.12,      // a doorway barely flickers: the room behind it is big
      flickerHz: 0.9,
      phase: 0.37,
    },
    {
      // The broken streetlight: cool, weak, and failing at its own rate.
      id: 'stage:lamp',
      x: PRACTICAL_LAMP_X,
      y: -250,
      kind: 'cool',
      // A streetlight is dim at the head and generous on the deck — its radius
      // has to reach the ground it is pointing at, or the practical reads as a
      // blue dot on a pole instead of a light you can stand in.
      radius: 340,
      gain: 0.75 + 0.5 * cool,
      flicker: 0.25 + 0.6 * flick,
      flickerHz: 2.7,
      phase: 1.91 + (seed % 97) * 0.01,   // per-run phase: same tube, different night
    },
  ]
  /* CITY BOUNCE — THE ROOF IS NOT LIT ONLY BY ITS OWN TWO LAMPS.
   *
   * A rooftop over a neon city sits in a pool of light that has no single
   * source: sodium street lighting, shop fronts, sign spill and window glow
   * coming UP past the parapet. Three wide, very dim, slow-flickering sources
   * stand in for it, placed along the deck from the run seed. They are
   * deliberately weak (gain 0.14–0.26 against the door's ~1.2) and deliberately
   * wide (radius 420–560) — the effect is not a pool you can point at, it is
   * that nothing on the roof is ever quite black.
   */
  const cityN = 3
  for (let i = 0; i < cityN; i++) {
    // Spread across the arena's walkable span, jittered per seed, and pushed
    // away from the two practicals so the field never reads as four lamps.
    const t = (i + 0.5) / cityN
    const jitter = ((seed >>> (i * 5)) % 200) / 200 - 0.5
    const x = 1290 + (t - 0.5) * 2100 + jitter * 320
    out.push({
      id: `city:${i}`,
      x,
      // Below the deck line: this light comes up over the parapet.
      y: 0 + 60,
      kind: 'city',
      radius: 420 + ((seed >>> (i * 3 + 1)) % 140),
      gain: 0.14 + ((seed >>> (i * 7 + 2)) % 12) * 0.01,
      flicker: 0.1,
      // Signs and windows do not flicker in sync; 0.2–0.5 Hz reads as a city
      // breathing rather than a lamp failing.
      flickerHz: 0.2 + i * 0.11,
      phase: ((seed >>> (i * 9 + 3)) % 628) / 100,
    })
  }
  return out
}
