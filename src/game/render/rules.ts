/**
 * UNIVERSAL GRAPHICS RULES — the single mandatory source of truth for
 * every rendering decision in the game.
 *
 * These constants and laws are ported from mountain.html (the reference
 * scene: "Shirogane Horizon — four ranges, four skies, one quiet inn").
 * Every background, light rig, shadow caster and post pass MUST derive
 * from this module — no local magic numbers for anything it covers.
 * Tests enforce consumption (see tests/graphics-rules.test.ts).
 *
 * MANDATORY LAWS
 *  1. Composition — horizon / vanishing point ratios are fixed here.
 *  2. Bake law — everything static is pre-generated once (ensure());
 *     only LIGHTING, SHADOW, WATER WAVES and PARTICLES evaluate per frame.
 *  3. Light transport — falloff is intensity·(1−d/range)^2 with a small
 *     wrap term; no other falloff curve may be introduced.
 *  4. Shadow engine — occluders are boxes [cx, cy, hw, hh, z] standing on
 *     the ground plane; the directional key projects along cot(elevation)
 *     with dirZ = dirY·0.55 (the reference's SH_DIRECTIONAL geometry).
 *  5. Draw order — sky → horizon mist → deck → structures → reflections →
 *     entities → fx → weather → post. Nothing may reorder these.
 */
export const GRAPHICS_RULES = {
  /** composition: mountain.html HY / VPX / VPY and the range skyline */
  composition: {
    HY: 0.74,
    VPX: 0.565,
    VPY: 0.34,
    /** the far range's ridge sits this far below the horizon ratio */
    SKYLINE: 0.35,
    /** screen band the drifting mist banks occupy (relative to horizon) */
    MIST_BAND: 0.052,
  },

  /** parallax: depth per layer and the camera's sway factor */
  depths: {
    near: 0.10,
    rack: 0.088,
    inn: 0.047,
    cherry: 0.032,
    mid: 0.06,
    /** the four mountain ranges, far → near */
    ranges: [0.1, 0.18, 0.29, 0.42] as const,
    camFactor: 0.22,
    /** static environment sits this many world units behind the play line */
    envBack: 110,
  },

  /** light transport (SH_LIGHT_QUAD): the only falloff law allowed */
  light: {
    falloffPower: 2,
    /** wrap term: lights keep a floor near the source */
    wrap: 0.085,
    /** point-light source height above the ground plane (world units) */
    sourceHeight: 40,
  },

  /** shadow engine (SH_DIRECTIONAL / SH_POINT): geometry constants */
  shadow: {
    /** occluder record: base center (cx, cy), half extents (hw, hh), height z */
    format: 'box' as const,
    /** key light dirZ = dirY · this (the reference's 0.55) */
    dirZScale: 0.55,
    /** penumbra feather in world units */
    feather: 6,
  },

  /** the bake law: what may evaluate per frame (everything else is baked) */
  bake: {
    perFrame: ['lighting', 'shadow', 'waterWaves', 'particles', 'lightning'] as const,
  },

  /** mandatory draw order (see the law at the top of this file) */
  order: [
    'sky',
    'horizonMist',
    'deck',
    'structures',
    'reflections',
    'entities',
    'fx',
    'weather',
    'post',
  ] as const,

  /** water (WATER_FS): the wave trains used by the puddle reflections */
  water: {
    /** sin(y·f + t·s) trains: [frequency (1/world-unit), speed] */
    trains: [
      [0.148, 1.9],
      [0.205, 2.6],
      [0.511, 1.1],
    ] as const,
    /** distortion amplitude grows with distance from the contact line */
    ampSlope: 0.05,
  },

  /** palette anchors the reference's night key */
  palette: {
    skyTop: '#05070d',
    skyBottom: '#141a2b',
    deckDark: '#0d141b',
    moonKey: '#dfe9ff',
    doorWarm: '#ff9a4d',
    streetCool: '#b8e4ff',
    blossom: '#f6d9e5',
  },
} as const

export type GraphicsRules = typeof GRAPHICS_RULES
