/** STICKMAN RISING — the modular combo moveset.
 *
 * Each attack = a keyframed clip (anticipation → strike → follow-through →
 * recovery) + hitbox window (the physical blade sweep is the hitbox) + trail
 * window + cancel window + legal follow-up chain. Directional inputs,
 * dash-cancels and buffers are resolved by the Player combo machine.
 *
 * Angle conventions (see pose.ts): arm angles measured from straight-down,
 * positive swings toward facing. Blade direction = π/2 − (shR+elR+wrR).
 */

import { Clip, keyframe, makeClip } from '../anim/animator'
import type { SfxName } from '../audio/audio'

export type AttackKind =
  | 'light' | 'heavy' | 'launcher' | 'air' | 'slam' | 'dash'
  | 'spin' | 'charged' | 'riposte' | 'finisher' | 'ability'

export interface AttackHit {
  start: number
  end: number
  dmg: number
  stagger: number
  kb: number
  kbY?: number
  launch?: number
  juggle?: number
  hitstop: number
  shake: number
  heavy: boolean
  aoe?: number
  multiHit?: number
  breakGuard?: boolean
}

export interface AttackDef {
  id: string
  label: string
  kind: AttackKind
  clip: Clip
  hit: AttackHit
  trail: { start: number; end: number }
  swingSfx: { t: number; name: SfxName }
  cancel: number
  chain: string[]
  moveX?: number
  moveXAt?: number
  moveY?: number
  moveYAt?: number
  requires: 'ground' | 'air' | 'any'
  /** gravity scale while the attack is active (air-combo float) */
  float?: number
  /** AoE + fx fire when the player touches ground mid-attack (slams / dive) */
  slamImpact?: { r: number; dmg: number; launch: number }
}

/* ------------------------------------------------------------------ */
/* GROUND LIGHTS                                                       */
/* ------------------------------------------------------------------ */

/** L1 — Cross Slash: horizontal sweep, back-high → front-low */
const l1: AttackDef = {
  id: 'l1', label: 'CROSS SLASH', kind: 'light', requires: 'ground',
  clip: makeClip('atk_l1', [
    keyframe(0, {
      rootRot: -0.28, spine: -0.1, head: 0.02, rootY: 1,
      hipR: -0.3, kneeR: -0.35, footR: 0.1,
      hipL: 0.35, kneeL: -0.3, footL: 0.1,
      shR: -1.15, elR: -0.35, wrR: -0.6,
      shL: 0.45, elL: -0.55,
    }, 'outQuad'),
    keyframe(0.07, {
      rootRot: 0.45, spine: 0.18, head: -0.2, rootY: -1,
      hipR: 0.6, kneeR: -0.45, footR: 0.1,
      hipL: -0.55, kneeL: -0.3, footL: 0.15,
      shR: 1.2, elR: -0.1, wrR: -0.2,
      shL: -0.3, elL: -0.45,
    }, 'outExpo'),
    keyframe(0.14, {
      rootRot: 0.3, spine: 0.1, head: -0.12, rootY: 0,
      hipR: 0.45, kneeR: -0.5, footR: 0.1,
      hipL: -0.45, kneeL: -0.35, footL: 0.12,
      shR: 0.55, elR: 0.35, wrR: -0.9,
      shL: -0.15, elL: -0.4,
    }, 'outCubic'),
    keyframe(0.34, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.07, end: 0.17, dmg: 9, stagger: 0.2, kb: 130, hitstop: 0.045, shake: 0.1, heavy: false },
  trail: { start: 0.05, end: 0.2 },
  swingSfx: { t: 0.055, name: 'swing' },
  cancel: 0.2,
  chain: ['l2', 'l3', 'h1', 'launcher', 'spin', 'retreat'],
  moveX: 190, moveXAt: 0.06,
}

/** L2 — Reverse Slash: backhand cut sweeping up-forward */
const l2: AttackDef = {
  id: 'l2', label: 'REVERSE SLASH', kind: 'light', requires: 'ground',
  clip: makeClip('atk_l2', [
    keyframe(0, {
      rootRot: 0.32, spine: 0.12, head: -0.1, rootY: 0,
      hipR: 0.45, kneeR: -0.5, footR: 0.1,
      hipL: -0.45, kneeL: -0.35, footL: 0.12,
      shR: 0.5, elR: 0.4, wrR: -0.85,
      shL: -0.15, elL: -0.4,
    }, 'outQuad'),
    keyframe(0.07, {
      rootRot: -0.12, spine: -0.06, head: -0.14, rootY: -1,
      hipR: 0.3, kneeR: -0.45, footR: 0.1,
      hipL: -0.4, kneeL: -0.4, footL: 0.12,
      shR: 0.9, elR: 0.3, wrR: 1.4,
      shL: 0.3, elL: -0.5,
    }, 'outExpo'),
    keyframe(0.14, {
      rootRot: -0.22, spine: -0.08, head: -0.16, rootY: -2,
      shR: 0.25, elR: -0.2, wrR: 2.0,
      shL: 0.4, elL: -0.45,
    }, 'outCubic'),
    keyframe(0.32, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.06, end: 0.16, dmg: 9.5, stagger: 0.22, kb: 150, hitstop: 0.05, shake: 0.12, heavy: false },
  trail: { start: 0.045, end: 0.19 },
  swingSfx: { t: 0.05, name: 'swing' },
  cancel: 0.19,
  chain: ['l3', 'h1', 'h2', 'launcher', 'spin', 'retreat'],
  moveX: 170, moveXAt: 0.05,
}

/** L3 — Rising Cross: low crouch cut that rakes upward */
const l3: AttackDef = {
  id: 'l3', label: 'RISING CROSS', kind: 'light', requires: 'ground',
  clip: makeClip('atk_l3', [
    keyframe(0, {
      rootRot: 0.3, spine: 0.1, head: -0.08, rootY: 4,
      hipR: 0.5, kneeR: -0.9, footR: 0.15,
      hipL: -0.4, kneeL: -0.8, footL: 0.1,
      shR: 0.35, elR: 0.5, wrR: -1.2,
      shL: 0.5, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.08, {
      rootRot: -0.18, spine: -0.08, head: -0.22, rootY: -3,
      hipR: -0.35, kneeR: -0.5, footR: -0.1,
      hipL: 0.45, kneeL: -0.4, footL: 0.2,
      shR: -1.5, elR: -0.3, wrR: -0.3,
      shL: 0.7, elL: -0.4,
    }, 'outExpo'),
    keyframe(0.16, {
      rootRot: -0.24, spine: -0.1, head: -0.24, rootY: -4,
      shR: -1.7, elR: -0.25, wrR: -0.35,
      shL: 0.75, elL: -0.4,
    }, 'outCubic'),
    keyframe(0.36, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.07, end: 0.18, dmg: 11, stagger: 0.24, kb: 120, kbY: -140, hitstop: 0.055, shake: 0.14, heavy: false },
  trail: { start: 0.055, end: 0.21 },
  swingSfx: { t: 0.06, name: 'swing' },
  cancel: 0.21,
  chain: ['l4', 'h1', 'h2', 'launcher', 'retreat'],
  moveX: 120, moveXAt: 0.06,
}

/** L4 — Whirlwind: full 360° blade cyclone, multi-hit */
const l4: AttackDef = {
  id: 'l4', label: 'WHIRLWIND', kind: 'spin', requires: 'ground',
  clip: makeClip('atk_l4', [
    keyframe(0, {
      rootRot: -0.2, spine: -0.05, head: -0.05, rootY: 2,
      hipR: 0.2, kneeR: -0.55, footR: 0.1,
      hipL: -0.3, kneeL: -0.5, footL: 0.1,
      shR: -1.2, elR: -0.3, wrR: -0.4,
      shL: 0.6, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.08, {
      rootRot: 0.25, rootY: 0,
      shR: 1.57, elR: -0.05, wrR: 0.02,
      shL: -0.3, elL: -0.5,
    }, 'outCubic'),
    keyframe(0.18, {
      rootRot: 0.3, rootY: -1,
      shR: 3.14, elR: -0.02, wrR: 0,
      shL: 0.5, elL: -0.6,
    }, 'linear'),
    keyframe(0.28, {
      rootRot: 0.25, rootY: 0,
      shR: 4.71, elR: -0.05, wrR: 0.02,
      shL: -0.3, elL: -0.5,
    }, 'linear'),
    keyframe(0.38, {
      rootRot: 0.2, rootY: 1,
      shR: 6.28, elR: -0.05, wrR: 0,
      shL: 0.5, elL: -0.6,
    }, 'outCubic'),
    keyframe(0.52, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.08, end: 0.4, dmg: 6, stagger: 0.16, kb: 190, hitstop: 0.03, shake: 0.08, heavy: false, multiHit: 0.11 },
  trail: { start: 0.07, end: 0.42 },
  swingSfx: { t: 0.07, name: 'swing' },
  cancel: 0.3,
  chain: ['l5', 'h2', 'launcher'],
}

/** L5 — Cleave Finisher: colossal 260° arcing cut with massive knockback */
const l5: AttackDef = {
  id: 'l5', label: 'CLEAVE FINISHER', kind: 'finisher', requires: 'ground',
  clip: makeClip('atk_l5', [
    keyframe(0, {
      rootRot: -0.38, spine: -0.14, head: 0.06, rootY: 2.5,
      hipR: -0.25, kneeR: -0.4, footR: 0.1,
      hipL: 0.3, kneeL: -0.35, footL: 0.1,
      shR: 3.4, elR: 0.4, wrR: 0.37,
      shL: 1.2, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.1, {
      rootRot: 0.55, spine: 0.2, head: -0.26, rootY: -2,
      hipR: 0.7, kneeR: -0.5, footR: 0.2,
      hipL: -0.6, kneeL: -0.3, footL: 0.15,
      shR: 0.55, elR: 0.1, wrR: 0.25,
      shL: 0.3, elL: -0.3,
    }, 'outQuart'),
    keyframe(0.2, {
      rootRot: 0.6, spine: 0.22, head: -0.28, rootY: 1,
      shR: 0.2, elR: -0.1, wrR: 0.1,
      shL: 0.2, elL: -0.3,
    }, 'outCubic'),
    keyframe(0.5, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.1, end: 0.21, dmg: 22, stagger: 0.4, kb: 460, hitstop: 0.09, shake: 0.32, heavy: true, breakGuard: true },
  trail: { start: 0.07, end: 0.26 },
  swingSfx: { t: 0.08, name: 'swingHeavy' },
  cancel: 0.3,
  chain: [],
  moveX: 260, moveXAt: 0.08,
}

/** Backstep Slash — retreating rising cut (hold back + light) */
const retreat: AttackDef = {
  id: 'retreat', label: 'BACKSTEP SLASH', kind: 'light', requires: 'ground',
  clip: makeClip('atk_retreat', [
    keyframe(0, {
      rootRot: 0.3, spine: 0.1, head: -0.08, rootY: 1,
      shR: 1.1, elR: 0.2, wrR: -1.0,
      shL: 0.4, elL: -0.5,
      hipR: 0.4, kneeR: -0.5, hipL: -0.35, kneeL: -0.45,
    }, 'outQuad'),
    keyframe(0.08, {
      rootRot: -0.3, spine: -0.1, head: -0.2, rootY: -2,
      shR: 1.0, elR: 0.5, wrR: 1.1,
      shL: 0.6, elL: -0.6,
      hipR: 0.15, kneeR: -0.4, hipL: -0.5, kneeL: -0.5,
    }, 'outExpo'),
    keyframe(0.36, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.07, end: 0.17, dmg: 10, stagger: 0.22, kb: 90, kbY: -160, hitstop: 0.05, shake: 0.12, heavy: false },
  trail: { start: 0.05, end: 0.2 },
  swingSfx: { t: 0.06, name: 'swing' },
  cancel: 0.2,
  chain: ['l1', 'l2', 'launcher', 'spin'],
  moveX: -240, moveXAt: 0.05,
}

/** Cyclone — down + light: low multi-hit spin */
const spin: AttackDef = {
  id: 'spin', label: 'CYCLONE', kind: 'spin', requires: 'ground',
  clip: makeClip('atk_spin', [
    keyframe(0, {
      rootRot: 0.4, rootY: 7, spine: 0.14, head: -0.24,
      hipR: 0.55, kneeR: -1.15, footR: 0.2,
      hipL: -0.45, kneeL: -1.05, footL: 0.15,
      shR: -0.9, elR: -0.25, wrR: -0.3,
      shL: 0.6, elL: -0.6,
    }, 'outQuad'),
    keyframe(0.1, {
      rootRot: 0.5, rootY: 5,
      shR: 1.45, elR: -0.05, wrR: 0,
      shL: -0.2, elL: -0.5,
    }, 'outCubic'),
    keyframe(0.22, {
      rootRot: 0.55, rootY: 4,
      shR: 3.0, elR: -0.03, wrR: 0,
    }, 'linear'),
    keyframe(0.34, {
      rootRot: 0.5, rootY: 5,
      shR: 4.6, elR: -0.05, wrR: 0.02,
    }, 'linear'),
    keyframe(0.46, {
      rootRot: 0.42, rootY: 6,
      shR: 6.1, elR: -0.05, wrR: 0,
    }, 'outCubic'),
    keyframe(0.62, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.1, end: 0.48, dmg: 5.5, stagger: 0.14, kb: 160, hitstop: 0.028, shake: 0.07, heavy: false, multiHit: 0.1 },
  trail: { start: 0.09, end: 0.5 },
  swingSfx: { t: 0.09, name: 'swing' },
  cancel: 0.36,
  chain: ['l5', 'launcher', 'h2'],
}

/* ------------------------------------------------------------------ */
/* GROUND HEAVIES                                                      */
/* ------------------------------------------------------------------ */

/** H1 — Skull Splitter: overhead with strong anticipation */
const h1: AttackDef = {
  id: 'h1', label: 'SKULL SPLITTER', kind: 'heavy', requires: 'ground',
  clip: makeClip('atk_h1', [
    keyframe(0, {}, 'outQuad'),
    keyframe(0.12, {
      rootRot: -0.4, spine: -0.15, head: 0.1, rootY: 2.5,
      hipR: -0.25, kneeR: -0.4, footR: 0.1,
      hipL: 0.3, kneeL: -0.35, footL: 0.1,
      shR: 3.4, elR: 0.5, wrR: 0.37,
      shL: 1.4, elL: -0.4,
    }, 'inOutCubic'),
    keyframe(0.2, {
      rootRot: 0.5, spine: 0.2, head: -0.25, rootY: -1,
      hipR: 0.65, kneeR: -0.55, footR: 0.2,
      hipL: -0.55, kneeL: -0.3, footL: 0.15,
      shR: 0.5, elR: 0.15, wrR: 0.25,
      shL: 0.2, elL: -0.5,
    }, 'outExpo'),
    keyframe(0.3, {
      rootRot: 0.55, spine: 0.22, head: -0.26, rootY: 1,
      shR: 0.3, elR: 0.05, wrR: 0.1,
      shL: 0.15, elL: -0.5,
    }, 'outCubic'),
    keyframe(0.55, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.19, end: 0.3, dmg: 18, stagger: 0.38, kb: 260, hitstop: 0.08, shake: 0.26, heavy: true },
  trail: { start: 0.16, end: 0.34 },
  swingSfx: { t: 0.17, name: 'swingHeavy' },
  cancel: 0.34,
  chain: ['h2', 'l1', 'launcher'],
  moveX: 140, moveXAt: 0.17,
}

/** H2 — Quake Fang: rising re-slam with ground shockwave */
const h2: AttackDef = {
  id: 'h2', label: 'QUAKE FANG', kind: 'heavy', requires: 'ground',
  clip: makeClip('atk_h2', [
    keyframe(0, {
      rootRot: -0.3, rootY: 1,
      shR: 2.6, elR: 0.5, wrR: 0.5,
      shL: 1.2, elL: -0.45,
    }, 'outQuad'),
    keyframe(0.1, {
      rootRot: -0.38, spine: -0.14, head: 0.08, rootY: 2.5,
      shR: 3.3, elR: 0.45, wrR: 0.4,
      shL: 1.35, elL: -0.42,
    }, 'outCubic'),
    keyframe(0.17, {
      rootRot: 0.6, spine: 0.22, head: -0.28, rootY: 2,
      hipR: 0.7, kneeR: -0.6, footR: 0.2,
      hipL: -0.6, kneeL: -0.35, footL: 0.15,
      shR: 0.4, elR: 0.1, wrR: 0.15,
      shL: 0.2, elL: -0.5,
    }, 'outExpo'),
    keyframe(0.28, {
      rootRot: 0.62, rootY: 3,
      shR: 0.3, elR: 0.05, wrR: 0.1,
    }, 'outCubic'),
    keyframe(0.6, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.16, end: 0.27, dmg: 22, stagger: 0.42, kb: 300, hitstop: 0.09, shake: 0.34, heavy: true, aoe: 80, breakGuard: true },
  trail: { start: 0.13, end: 0.31 },
  swingSfx: { t: 0.14, name: 'swingHeavy' },
  cancel: 0.36,
  chain: ['h3', 'l1'],
  moveX: 160, moveXAt: 0.15,
}

/** H3 — Grand Slam: leaping crash with arena-shaking shockwave */
const h3: AttackDef = {
  id: 'h3', label: 'GRAND SLAM', kind: 'heavy', requires: 'ground',
  clip: makeClip('atk_h3', [
    keyframe(0, {
      rootY: 6, rootRot: 0.4, spine: 0.12, head: -0.2,
      hipR: 0.55, kneeR: -1.1, footR: 0.2,
      hipL: -0.45, kneeL: -1.0, footL: 0.15,
      shR: 0.6, elR: 0.3, wrR: -0.4,
      shL: 0.5, elL: -0.6,
    }, 'outQuad'),
    keyframe(0.15, {
      rootY: -4, rootRot: -0.2, spine: -0.06, head: -0.1,
      hipR: 0.8, kneeR: -1.4, footR: -0.1,
      hipL: 0.5, kneeL: -1.2, footL: 0.1,
      shR: 3.4, elR: 0.5, wrR: 0.37,
      shL: 1.3, elL: -0.4,
    }, 'outCubic'),
    keyframe(0.35, {
      rootY: -5, rootRot: -0.15,
      shR: 3.5, elR: 0.45, wrR: 0.3,
      hipR: 0.7, kneeR: -1.3, hipL: 0.4, kneeL: -1.1,
    }, 'inOutCubic'),
    keyframe(0.5, {
      rootRot: 0.7, spine: 0.24, head: -0.3, rootY: 3,
      hipR: 0.7, kneeR: -0.4, footR: 0.25,
      hipL: -0.6, kneeL: -0.3, footL: 0.2,
      shR: 0.45, elR: 0.1, wrR: 0.2,
      shL: 0.25, elL: -0.5,
    }, 'outQuart'),
    keyframe(0.64, {
      rootRot: 0.72, rootY: 5,
      shR: 0.3, elR: 0.05, wrR: 0.1,
      hipR: 0.6, kneeR: -0.9, hipL: -0.5, kneeL: -0.8,
    }, 'outQuad'),
    keyframe(0.9, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.48, end: 0.6, dmg: 30, stagger: 0.5, kb: 380, launch: -320, hitstop: 0.12, shake: 0.5, heavy: true, aoe: 135, breakGuard: true },
  trail: { start: 0.42, end: 0.62 },
  swingSfx: { t: 0.44, name: 'swingHeavy' },
  cancel: 0.55,
  chain: [],
  moveY: -780, moveYAt: 0.04,
  slamImpact: { r: 135, dmg: 26, launch: -280 },
}

/** LAUNCHER — Rising Fang: uppercut slash that hurls foes skyward */
const launcher: AttackDef = {
  id: 'launcher', label: 'RISING FANG', kind: 'launcher', requires: 'ground',
  clip: makeClip('atk_launcher', [
    keyframe(0, {
      rootY: 6, rootRot: 0.35, spine: 0.12, head: -0.14,
      hipR: 0.6, kneeR: -1.2, footR: 0.2,
      hipL: -0.5, kneeL: -1.1, footL: 0.15,
      shR: -0.4, elR: -0.05, wrR: 0.05,
      shL: 0.5, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.1, {
      rootY: -5, rootRot: -0.3, spine: -0.12, head: -0.24,
      hipR: -0.4, kneeR: -0.8, footR: -0.15,
      hipL: 0.5, kneeL: -0.4, footL: 0.25,
      shR: 2.9, elR: -0.05, wrR: -0.1,
      shL: 0.9, elL: -0.6,
    }, 'outExpo'),
    keyframe(0.2, {
      rootY: -6, rootRot: -0.34,
      shR: 3.2, elR: -0.1, wrR: -0.3,
    }, 'outCubic'),
    keyframe(0.45, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.09, end: 0.2, dmg: 12, stagger: 0.3, kb: 60, launch: -640, hitstop: 0.07, shake: 0.2, heavy: false },
  trail: { start: 0.07, end: 0.24 },
  swingSfx: { t: 0.08, name: 'swing' },
  cancel: 0.26,
  chain: ['a1', 'a2', 'a3', 'dive'],
  moveX: 170, moveXAt: 0.07,
  moveY: -520, moveYAt: 0.08,
}

/* ------------------------------------------------------------------ */
/* DASH ATTACKS                                                        */
/* ------------------------------------------------------------------ */

/** Dash Slash — pass-through phantom cut (works ground & air) */
const dashSlash: AttackDef = {
  id: 'dashSlash', label: 'PHANTOM CUT', kind: 'dash', requires: 'any',
  clip: makeClip('atk_dashslash', [
    keyframe(0, {
      rootRot: 0.55, rootY: 2, spine: 0.12, head: -0.4,
      hipR: 0.9, kneeR: -1.0, footR: 0.15,
      hipL: -0.85, kneeL: -0.7, footL: 0.2,
      shR: -0.8, elR: -0.4, wrR: 0.2,
      shL: 0.75, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.08, {
      rootRot: 0.62, rootY: 1,
      shR: 1.1, elR: 0.15, wrR: 0.05,
      shL: 0.6, elL: -0.4,
    }, 'outExpo'),
    keyframe(0.18, {
      rootRot: 0.5, rootY: 0,
      shR: 1.8, elR: 0.3, wrR: 0.1,
      shL: 0.3, elL: -0.4,
    }, 'outCubic'),
    keyframe(0.32, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.06, end: 0.2, dmg: 12, stagger: 0.26, kb: 220, hitstop: 0.05, shake: 0.16, heavy: false, multiHit: 0.1 },
  trail: { start: 0.04, end: 0.24 },
  swingSfx: { t: 0.05, name: 'swing' },
  cancel: 0.2,
  chain: ['l1', 'l2', 'h1', 'launcher'],
  moveX: 560, moveXAt: 0.02,
}

/** Dash Heavy — lunging piercing stab */
const dashHeavy: AttackDef = {
  id: 'dashHeavy', label: 'PIERCING FANG', kind: 'dash', requires: 'ground',
  clip: makeClip('atk_dashheavy', [
    keyframe(0, {
      rootRot: 0.2, rootY: 2,
      shR: -1.4, elR: -0.5, wrR: 0.3,
      shL: 0.4, elL: -0.5,
      hipR: 0.4, kneeR: -0.7, hipL: -0.4, kneeL: -0.5,
    }, 'outQuad'),
    keyframe(0.12, {
      rootRot: 0.62, rootY: 2, spine: 0.2, head: -0.34,
      hipR: 1.1, kneeR: -0.3, footR: 0.2,
      hipL: -1.0, kneeL: -0.5, footL: 0.1,
      shR: 1.2, elR: 0.35, wrR: -0.2,
      shL: -0.8, elL: -0.3,
    }, 'outExpo'),
    keyframe(0.24, {
      rootRot: 0.6, rootY: 2,
      shR: 1.1, elR: 0.35, wrR: -0.2,
    }, 'outCubic'),
    keyframe(0.5, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.11, end: 0.24, dmg: 24, stagger: 0.45, kb: 540, hitstop: 0.1, shake: 0.3, heavy: true },
  trail: { start: 0.08, end: 0.28 },
  swingSfx: { t: 0.1, name: 'swingHeavy' },
  cancel: 0.3,
  chain: [],
  moveX: 420, moveXAt: 0.08,
}

/** CHARGED — Overload Slash: colossal 320° element-charged arc */
const charged: AttackDef = {
  id: 'charged', label: 'OVERLOAD SLASH', kind: 'charged', requires: 'ground',
  clip: makeClip('atk_charged', [
    keyframe(0, {
      rootRot: -0.45, spine: -0.16, head: 0.08, rootY: 3,
      hipR: -0.25, kneeR: -0.45, footR: 0.1,
      hipL: 0.3, kneeL: -0.4, footL: 0.1,
      shR: 3.6, elR: 0.5, wrR: 0.3,
      shL: 1.4, elL: -0.4,
    }, 'outQuad'),
    keyframe(0.16, {
      rootRot: 0.6, spine: 0.24, head: -0.3, rootY: -2,
      hipR: 0.75, kneeR: -0.5, footR: 0.25,
      hipL: -0.65, kneeL: -0.3, footL: 0.2,
      shR: -1.0, elR: -0.5, wrR: 0.3,
      shL: 0.2, elL: -0.4,
    }, 'outQuart'),
    keyframe(0.28, {
      rootRot: 0.5, spine: 0.18, head: -0.24, rootY: 0,
      shR: -1.6, elR: -0.5, wrR: 0.1,
      shL: 0.4, elL: -0.5,
    }, 'outCubic'),
    keyframe(0.65, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.14, end: 0.3, dmg: 46, stagger: 0.6, kb: 420, launch: -380, hitstop: 0.14, shake: 0.55, heavy: true, aoe: 150, breakGuard: true },
  trail: { start: 0.1, end: 0.38 },
  swingSfx: { t: 0.12, name: 'swingHeavy' },
  cancel: 0.4,
  chain: [],
  moveX: 220, moveXAt: 0.12,
}

/** RIPOSTE — Judgment Cut: iai-draw counter after a parry */
const riposte: AttackDef = {
  id: 'riposte', label: 'JUDGMENT CUT', kind: 'riposte', requires: 'any',
  clip: makeClip('atk_riposte', [
    keyframe(0, {
      rootRot: 0.12, spine: 0.04, head: -0.06, rootY: 1,
      hipR: 0.3, kneeR: -0.55, footR: 0.12,
      hipL: -0.35, kneeL: -0.5, footL: 0.1,
      shR: 0.4, elR: 0.1, wrR: -0.2,
      shL: 0.25, elL: -0.45,
    }, 'outQuad'),
    keyframe(0.14, {
      rootRot: -0.2, spine: -0.08, head: -0.22, rootY: -3,
      hipR: -0.3, kneeR: -0.4, footR: -0.1,
      hipL: 0.4, kneeL: -0.3, footL: 0.2,
      shR: 2.4, elR: 0.3, wrR: 0.2,
      shL: 0.8, elL: -0.5,
    }, 'outExpo'),
    keyframe(0.32, {
      rootRot: -0.16, rootY: -3,
      shR: 2.5, elR: 0.25, wrR: 0.25,
    }, 'outCubic'),
    keyframe(0.55, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.12, end: 0.24, dmg: 34, stagger: 0.55, kb: 380, hitstop: 0.12, shake: 0.42, heavy: true, breakGuard: true },
  trail: { start: 0.1, end: 0.3 },
  swingSfx: { t: 0.11, name: 'swingHeavy' },
  cancel: 0.34,
  chain: [],
  moveX: 200, moveXAt: 0.1,
}

/* ------------------------------------------------------------------ */
/* AIR ATTACKS                                                         */
/* ------------------------------------------------------------------ */

const AIR_LEGS = {
  hipR: 0.5, kneeR: -1.2, footR: -0.05,
  hipL: -0.4, kneeL: -0.9, footL: 0.1,
}

/** A1 — Air Slash */
const a1: AttackDef = {
  id: 'a1', label: 'AIR SLASH', kind: 'air', requires: 'air',
  clip: makeClip('atk_a1', [
    keyframe(0, {
      ...AIR_LEGS, rootRot: -0.24, spine: -0.08, head: 0, rootY: 0,
      shR: -1.15, elR: -0.35, wrR: -0.6,
      shL: 0.45, elL: -0.55,
    }, 'outQuad'),
    keyframe(0.07, {
      ...AIR_LEGS, rootRot: 0.4, spine: 0.14, head: -0.18, rootY: -1,
      shR: 1.2, elR: -0.1, wrR: -0.2,
      shL: -0.3, elL: -0.45,
    }, 'outExpo'),
    keyframe(0.14, {
      ...AIR_LEGS, rootRot: 0.28, rootY: 0,
      shR: 0.55, elR: 0.35, wrR: -0.9,
    }, 'outCubic'),
    keyframe(0.32, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.06, end: 0.16, dmg: 9, stagger: 0.22, kb: 110, juggle: -420, hitstop: 0.045, shake: 0.1, heavy: false },
  trail: { start: 0.05, end: 0.19 },
  swingSfx: { t: 0.05, name: 'swing' },
  cancel: 0.19,
  chain: ['a2', 'a3', 'dive', 'slam'],
  float: 0.42,
}

/** A2 — Air Reverse Slash */
const a2: AttackDef = {
  id: 'a2', label: 'AIR REVERSE', kind: 'air', requires: 'air',
  clip: makeClip('atk_a2', [
    keyframe(0, {
      ...AIR_LEGS, rootRot: 0.3, rootY: 0,
      shR: 0.5, elR: 0.4, wrR: -0.85,
      shL: -0.15, elL: -0.4,
    }, 'outQuad'),
    keyframe(0.07, {
      ...AIR_LEGS, rootRot: -0.14, spine: -0.06, head: -0.14, rootY: -1,
      shR: 0.9, elR: 0.3, wrR: 1.4,
      shL: 0.3, elL: -0.5,
    }, 'outExpo'),
    keyframe(0.14, {
      ...AIR_LEGS, rootRot: -0.22, rootY: -2,
      shR: 0.25, elR: -0.2, wrR: 2.0,
    }, 'outCubic'),
    keyframe(0.32, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.06, end: 0.16, dmg: 9.5, stagger: 0.24, kb: 130, juggle: -460, hitstop: 0.05, shake: 0.12, heavy: false },
  trail: { start: 0.045, end: 0.19 },
  swingSfx: { t: 0.05, name: 'swing' },
  cancel: 0.19,
  chain: ['a3', 'dive', 'slam'],
  float: 0.42,
}

/** A3 — Air Rondo: spinning multi-hit */
const a3: AttackDef = {
  id: 'a3', label: 'AIR RONDO', kind: 'spin', requires: 'air',
  clip: makeClip('atk_a3', [
    keyframe(0, {
      ...AIR_LEGS, rootRot: -0.15, rootY: 0,
      shR: -1.0, elR: -0.3, wrR: -0.3,
      shL: 0.5, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.08, {
      ...AIR_LEGS, rootRot: 0.2, rootY: -1,
      shR: 1.5, elR: -0.05, wrR: 0,
    }, 'outCubic'),
    keyframe(0.17, {
      ...AIR_LEGS, rootRot: 0.22,
      shR: 3.1, elR: -0.02, wrR: 0,
    }, 'linear'),
    keyframe(0.26, {
      ...AIR_LEGS, rootRot: 0.2,
      shR: 4.7, elR: -0.05, wrR: 0.02,
    }, 'linear'),
    keyframe(0.35, {
      ...AIR_LEGS, rootRot: 0.15,
      shR: 6.28, elR: -0.05, wrR: 0,
    }, 'outCubic'),
    keyframe(0.48, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.08, end: 0.36, dmg: 6, stagger: 0.16, kb: 150, juggle: -400, hitstop: 0.03, shake: 0.08, heavy: false, multiHit: 0.1 },
  trail: { start: 0.07, end: 0.38 },
  swingSfx: { t: 0.07, name: 'swing' },
  cancel: 0.28,
  chain: ['dive', 'slam', 'a1'],
  float: 0.34,
}

/** DIVE — Falcon Dive: diagonal plunging multi-cut */
const dive: AttackDef = {
  id: 'dive', label: 'FALCON DIVE', kind: 'air', requires: 'air',
  clip: makeClip('atk_dive', [
    keyframe(0, {
      rootRot: 0.2, spine: 0.06, head: -0.1, rootY: -2,
      hipR: 0.6, kneeR: -1.3, footR: -0.1,
      hipL: 0.4, kneeL: -1.1, footL: 0.1,
      shR: 2.8, elR: 0.4, wrR: 0.3,
      shL: 0.9, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.12, {
      rootRot: 0.75, spine: 0.2, head: -0.3, rootY: 2,
      hipR: -0.6, kneeR: -0.4, footR: -0.15,
      hipL: -0.45, kneeL: -0.35, footL: 0.1,
      shR: 0.6, elR: 0.15, wrR: 0.15,
      shL: -0.4, elL: -0.4,
    }, 'outExpo'),
    keyframe(0.5, {
      rootRot: 0.78, rootY: 2,
      shR: 0.5, elR: 0.15, wrR: 0.15,
    }, 'outQuad'),
    keyframe(0.62, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.1, end: 0.5, dmg: 7, stagger: 0.16, kb: 80, juggle: -260, hitstop: 0.035, shake: 0.09, heavy: false, multiHit: 0.13 },
  trail: { start: 0.08, end: 0.52 },
  swingSfx: { t: 0.09, name: 'swing' },
  cancel: 0.2,
  chain: [],
  moveY: 620, moveYAt: 0.08,
  moveX: 260, moveXAt: 0.08,
  float: 0.9,
  slamImpact: { r: 80, dmg: 12, launch: -160 },
}

/** SLAM — Meteor Fall: plunging blade-first crash */
const slam: AttackDef = {
  id: 'slam', label: 'METEOR FALL', kind: 'slam', requires: 'air',
  clip: makeClip('atk_slam', [
    keyframe(0, {
      rootRot: 0.3, spine: 0.08, head: -0.1, rootY: -3,
      hipR: 0.7, kneeR: -1.4, footR: -0.1,
      hipL: 0.5, kneeL: -1.2, footL: 0.1,
      shR: -0.7, elR: -0.35, wrR: 0.12,
      shL: 0.6, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.15, {
      rootRot: 0.85, spine: 0.24, head: -0.34, rootY: 2,
      hipR: -0.9, kneeR: -0.4, footR: -0.2,
      hipL: -0.7, kneeL: -0.5, footL: 0.1,
      shR: -0.15, elR: 0.05, wrR: 0.1,
      shL: -0.5, elL: -0.3,
    }, 'outCubic'),
    keyframe(0.45, {
      rootRot: 0.88, rootY: 2,
      shR: -0.15, elR: 0.05, wrR: 0.1,
    }, 'outQuad'),
    keyframe(0.56, {
      rootRot: 0.7, rootY: 6, spine: 0.2, head: -0.26,
      hipR: 0.65, kneeR: -1.3, footR: 0.25,
      hipL: -0.55, kneeL: -1.2, footL: 0.2,
      shR: 0.2, elR: 0.1, wrR: 0.05,
      shL: 0.3, elL: -0.6,
    }, 'outQuart'),
    keyframe(0.78, {}, 'inOutCubic'),
  ]),
  hit: { start: 0.14, end: 0.5, dmg: 10, stagger: 0.2, kb: 60, juggle: -180, hitstop: 0.04, shake: 0.12, heavy: false, multiHit: 0.16 },
  trail: { start: 0.12, end: 0.55 },
  swingSfx: { t: 0.12, name: 'swingHeavy' },
  cancel: 0.3,
  chain: [],
  moveY: 1050, moveYAt: 0.1,
  slamImpact: { r: 145, dmg: 26, launch: -300 },
}

/* ------------------------------------------------------------------ */

export const ATTACKS: Record<string, AttackDef> = {
  l1, l2, l3, l4, l5, retreat, spin,
  h1, h2, h3, launcher,
  dashSlash, dashHeavy, charged, riposte,
  a1, a2, a3, dive, slam,
}

export function getAttack(id: string): AttackDef | undefined {
  return ATTACKS[id]
}

/** Runtime info passed to the world when a blade connects. */
export interface AttackRuntimeInfo {
  id: string
  dmg: number
  heavy: boolean
  stagger: number
  kb: number
  kbY: number
  launch: number
  juggle: number
  hitstop: number
  shake: number
  aoe: number
  breakGuard: boolean
  kind: AttackKind
}

export function makeRuntimeInfo(def: AttackDef, dmgMult: number): AttackRuntimeInfo {
  return {
    id: def.id,
    dmg: def.hit.dmg * dmgMult,
    heavy: def.hit.heavy,
    stagger: def.hit.stagger,
    kb: def.hit.kb,
    kbY: def.hit.kbY ?? 0,
    launch: def.hit.launch ?? 0,
    juggle: def.hit.juggle ?? 0,
    hitstop: def.hit.hitstop,
    shake: def.hit.shake,
    aoe: def.hit.aoe ?? 0,
    breakGuard: def.hit.breakGuard ?? false,
    kind: def.kind,
  }
}
