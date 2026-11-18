import { FLOOD, SIGN_FACE, POINT, type LocalShape } from '../lighting/emitters'
/** Stage emitter definitions. Transport and visibility belong to lighting/ribbons. */
/** Which practical a source is. `warm` is the stairwell head-house, `cool` the
 *  failing streetlight, `bulb` a bare bulb on a cable, `neon` a sign, `moon`
 *  reserved for the key (the moon's own light is not in the field: it is a
 *  directional model in world/light.ts and must not be sampled as a point). */
export type LightKind = 'warm' | 'cool' | 'bulb' | 'neon' | 'city'

export interface PointLight {
  readonly id: string
  shape?: LocalShape // legacy and ambient sources default to point
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

/** The two stage practicals, as world x. Exported because they are not
 *  background.ts's private business: the rooftop props must not be placed on top
 *  of them, and the tests assert the roof lamp is somewhere else. */
export const SIGN_Y = -98
export const PRACTICAL_SIGN_X = 1755
export const PRACTICAL_LAMP_X = 830
export const BEACON_X = 1545
export const BEACON_Y = -64

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
  warm: [255, 149, 62],
  cool: [66, 205, 255],
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

/** Three local fixtures on every tier: warning sign, streetlight and beacon. The
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
      // Amber advisory display on the rear maintenance shoulder.
      id: 'stage:warning-sign', shape: SIGN_FACE,
      x: PRACTICAL_SIGN_X,
      y: SIGN_Y,
      kind: 'warm',
      radius: 330,
      gain: 0.72 + 0.5 * warm,
      flicker: 0, // regulated traffic display, not a blinking warning
      flickerHz: 0.9,
      phase: 0.37,
    },
    {
      // The broken streetlight: cool, weak, and failing at its own rate.
      id: 'stage:lamp', shape: FLOOD,
      x: PRACTICAL_LAMP_X,
      y: -256,
      kind: 'cool',
      // A streetlight is dim at the head and generous on the deck — its radius
      // has to reach the ground it is pointing at, or the practical reads as a
      // blue dot on a pole instead of a light you can stand in.
      radius: 340,
      gain: 0.75 + 0.5 * cool,
      flicker: 0.09 + 0.10 * flick,
      flickerHz: 0.85,
      phase: 1.91 + (seed % 97) * 0.01,   // per-run phase: same tube, different night
    },
    {id:'stage:beacon',shape:POINT,kind:'neon',x:BEACON_X,y:BEACON_Y,radius:284,gain:1.03,flicker:0,flickerHz:0,phase:0},
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
