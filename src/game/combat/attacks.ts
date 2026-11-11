/** STICKMAN RISING — the modular combo moveset, re-authored around REAL
 * swordsmanship (kenjutsu/iai techniques — see the per-attack notes).
 *
 * Design law for this revision:
 *  1. KAMAE CONTINUITY — every clip starts AND ends in chūdan-no-kamae (the
 *     middle guard). Chained attacks blend guard→chamber→cut→guard; the
 *     shared pose base means no snap between animation instances.
 *  2. HASUJI (blade alignment) — blade dir = π/2 − (shR+elR+wrR) in canvas
 *     space (+Y down), so: sum 1.57 → level forward · sum ≈ 3.0 → blade UP
 *     (jōdan) · sum ≈ 0.3 → blade DOWN (follow-through) · sum < 0 → blade
 *     back (waki / sheathed). Cuts sweep through the plane they name:
 *     kesa descends diagonally, gyaku-kesa rises, yoko stays level, kiri
 *     oroshi falls vertically, tsuki spears flat. NO 360° windmills.
 *  3. TEMPO + IN-BETWEENS — every fast span (>1.4 rad) carries an explicit
 *     intermediate "ignition" keyframe, so each frame is a real authored
 *     in-between pose: chamber → ignition → strike → follow → zanshin.
 *  4. The blade is drawn from the SAYA (scabbard at the hip) for iai cuts
 *     (l1, riposte): hand at the hip, blade lying back along the scabbard.
 */

import { Clip, keyframe, makeClip } from '../anim/animator'
import type { SfxName } from '../audio/audio'
// Unarmed command moves (axe/spin-hook/step kick, air twist/elbow, ult palm)
// are authored in moveset.ts — type-only dependency back to this file, so no
// runtime cycle. Registered in ATTACKS below; selection is gated to the
// sheathed (empty-hand) stance inside Player.pickHeavy/pickLight.
import { MOVES, UNARMED_ULT } from './moveset'
import { RONIN_ATTACKS } from './ronin'

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
  /** hit-volume padding in px fattening the blade segment — a katana edge
   * is a plane, not a line; heavies carve a wider corridor than lights */
  pad?: number
  /** DASH THROUGH-CUT corridor: the swept volume behind/ahead of the body
   * along the travel line (px). Defaults live in Player.updateAttack; a
   * wider corridor is a deeper pass — the dual-charged release carves the
   * widest lane in the moveset. Sheathed power strikes (fist/foot) declare
   * their own corridor so the pass tears through the pack too. */
  corridorBack?: number
  corridorFront?: number
  /** corridor band height above the feet (px) — default 55 (chest); the
   * kick release rides lower (~40) as the spear leg drives. */
  corridorY?: number
}

export interface AttackDef {
  /** Empty-hand contact uses the visible forearm/fist, never a hidden blade. */
  strikeHand?: 'left' | 'right'
  /** Which visible limb IS the hitbox: fist (hand), elbow, foot/ankle,
   * knee, or shoulder — resolved in Player.updateBladeWorld. */
  strikeJoint?:'hand'|'elbow'|'foot'|'knee'|'shoulder'
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
  /** Opt-in finite ground drive. Legacy moves remain unchanged until qualified. */
  groundDrive?: {duration:number;acceleration:number}
  moveY?: number
  moveYAt?: number
  requires: 'ground' | 'air' | 'any'
  /** gravity scale while the attack is active (air-combo float) */
  float?: number
  /** AoE + fx fire when the player touches ground mid-attack (slams / dive) */
  slamImpact?: { r: number; dmg: number; launch: number }
  /** two-handed grip weight (0..1): how strongly the off-hand IK takes the
   * tsuka during this attack — real kenjutsu cuts are two-handed */
  grip?: number
  /** 2.8D Z-EXCURSION (0..1): legacy visual-only depth pulse — superseded
   * by `traj` (the real 3D yaw path); still drives the pierce flare for
   * attacks without a declared trajectory */
  zArc?: number
  /** iai snap-draw: spawn the flash-release burst at ignition (blade
   * clearing the saya reads as a 1-frame light event) */
  drawFlash?: boolean
  /** THE 3D TRAJECTORY: the blade's path through real 3D space during the
   * strike. Every attack family gets a genuinely different combination —
   * horizontal cuts carve wide depth arcs, diagonals tilt through depth,
   * thrusts spear the lens, risers reverse the plane. The body follows:
   * hips rotate with the yaw, the chest counter-rotates further. */
  traj?: Traj3D
}

/** Blade path spec (see armarc.ts — the 3D trajectory solver):
 *  a0→a1  pitch: screen-plane blade angle, chamber → contact
 *         (0 = level forward, + = tip down, − = tip up)
 *  y0→y1  yaw: depth-plane rotation, chamber → contact
 *         (− = kissaki behind the body plane, + = toward the camera)
 *  e0→e1  arm extension fraction (coil → drive through)
 *  band   strike height (world px above feet: 14 legs / 48 torso / 78 chest) */
export interface Traj3D {
  a0: number
  a1: number
  y0: number
  y1: number
  e0: number
  e1: number
  band?: number
}

/** Chūdan-no-kamae guard — shared start/end pose for ground chains. */
const GUARD = {
  rootRot: 0.1, spine: 0.05, head: -0.1, rootY: 0,
  hipR: 0.32, kneeR: -0.5, footR: 0.12,
  hipL: -0.3, kneeL: -0.42, footL: 0.12,
  shR: 0.85, elR: -0.5, wrR: 1.15,
  shL: 0.5, elL: -0.85, wrL: -0.3,
}

/* ------------------------------------------------------------------ */
/* GROUND LIGHTS — the five cuts of the chain                          */
/* ------------------------------------------------------------------ */

/** L1 — NUKITSUKE (抜き付け): the iai draw-cut. Sword sheathed at the hip
 * (blade lying back along the saya), one explosive horizontal draw across
 * at chest height, powered by hip rotation + a slide step. */
const l1: AttackDef = {
  id: 'l1', label: 'IAI DRAW', kind: 'light', requires: 'ground',
  clip: makeClip('atk_l1', [
    keyframe(0, {
      ...GUARD,
      rootRot: 0.06,
      // hand resting on the saya mouth — IK-solved onto the REAL mouth
      // position (3,1 local): shR 0.31/elR −0.93 lands the fist exactly
      // there; the blade lies back along the scabbard axis (sum ≈ −1.34 →
      // blade ≈ 166° = the saya line). The old 0.2/−0.3 reached 15+ units
      // behind the mouth with a near-straight elbow.
      shR: 0.31, elR: -0.93, wrR: -0.72,
      shL: 0.35, elL: -0.6,
    }, 'outQuad'),
    // GAP-1 · anticipation: the pre-draw coil — weight sinks, hips counter-
    // wind AWAY from the coming horizontal draw (the whole-body load beat)
    keyframe(0.04, {
      rootRot: 0.02, rootY: 2.2,
      hipR: 0.26, kneeR: -0.58,
      shR: 0.26, elR: -1.0, wrR: -0.78, // hand seats a touch deeper on the saya
      shL: 0.35, elL: -0.6,
      pelvisYaw: -0.14, chestYaw: 0.12,
    }, 'inOutSine'),
    keyframe(0.08, {
      rootRot: 0.1, rootY: 1.2,
      shR: 0.31, elR: -0.93, wrR: -0.72, // grip tightens — stillness beat
      shL: 0.35, elL: -0.6,
    }, 'inOutSine'),
    // ignition: the blade clears the saya mouth, already moving
    keyframe(0.12, {
      rootRot: 0.18, rootY: 0.6,
      hipR: 0.38, kneeR: -0.45,
      shR: 0.72, elR: -0.3, wrR: 0.02,
      shL: 0.45, elL: -0.8,
    }, 'outQuad'),
    keyframe(0.17, {
      rootRot: 0.32, spine: 0.12, head: -0.16, rootY: -0.5,
      hipR: 0.5, kneeR: -0.35, footR: 0.1,
      hipL: -0.55, kneeL: -0.28, footL: 0.14,
      shR: 1.0, elR: -0.3, wrR: 0.62, // blade rips out level, elbow stays flexion-side
      shL: 0.55, elL: -0.95,
      pelvisYaw: 0.18, chestYaw: -0.14, // hips unwind through the draw
    }, 'outExpo'),
    keyframe(0.26, {
      rootRot: 0.38, spine: 0.13, rootY: 0,
      shR: 1.2, elR: -0.25, wrR: 0.3, // follow-through, arm extends (≤14° flexion floor)
      shL: 0.5, elL: -1.1,
      // GAP-2 · follow-through: hips CARRY PAST the draw and the head
      // settles late — momentum bleeds, joints release sequentially
      pelvisYaw: 0.25, chestYaw: -0.19, head: -0.1,
    }, 'outCubic'),
    keyframe(0.35, {
      pelvisYaw: 0.1, chestYaw: -0.06, head: -0.08, // hips settle after the arm arrived
    }, 'outQuad'),
    keyframe(0.44, GUARD, 'inOutCubic'),
    keyframe(0.52, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.14, end: 0.26, dmg: 9, stagger: 0.2, kb: 130, hitstop: 0.045, shake: 0.1, heavy: false, pad: 5 },
  trail: { start: 0.13, end: 0.32 },
  swingSfx: { t: 0.13, name: 'swing' },
  cancel: 0.32,
  chain: ['l2', 'l3', 'h1', 'launcher', 'spin', 'retreat', 'srIai'],
  moveX: 150, moveXAt: 0.13, groundDrive:{duration:.06,acceleration:3000},
  grip: 0.25, // iai draw: left hand holds the SAYA, not the tsuka
  zArc: 0.4, drawFlash: true,
  traj: { // HORIZONTAL DRAW: steel rips from BEHIND the hip through depth
    a0: 2.2, a1: 0.05, y0: -0.55, y1: 0.3, e0: 0.5, e1: 0.85, band: 48,
  },
}

/** L2 — KESA GIRI (袈裟斬り): the diagonal temple-to-hip cut. Wind high
 * (blade up-forward), then cut diagonally DOWN through the kesa line. */
const l2: AttackDef = {
  id: 'l2', label: 'KESA GIRI', kind: 'light', requires: 'ground',
  clip: makeClip('atk_l2', [
    keyframe(0, GUARD, 'outQuad'),
    // GAP-1 · anticipation: weight SINKS before the jōdan rise — the coil
    // that pays for the temple-to-hip cut (crouch-before-cut load beat)
    keyframe(0.04, {
      rootRot: -0.06, rootY: 1.8,
      hipR: 0.2, kneeR: -0.55, footR: 0.14,
      hipL: -0.25, kneeL: -0.5, footL: 0.12,
      shR: 1.2, elR: -0.3, wrR: 0.6,
      shL: 1.1, elL: -0.85,
      pelvisYaw: -0.16, chestYaw: 0.14,
    }, 'outQuad'),
    keyframe(0.09, {
      rootRot: -0.14, spine: -0.05, head: -0.06, rootY: -1.5,
      hipR: -0.1, kneeR: -0.4,
      shR: 1.9, elR: 0.2, wrR: 0.1, // chambered high — blade up-forward
      shL: 1.9, elL: -0.5,
    }, 'outCubic'),
    // ignition: weight commits, blade tips past vertical
    keyframe(0.13, {
      rootRot: 0.05, rootY: 0.5,
      shR: 1.55, elR: 0.1, wrR: 0.4,
      shL: 1.2, elL: -0.7,
    }, 'outQuad'),
    keyframe(0.18, {
      rootRot: 0.38, spine: 0.15, head: -0.18, rootY: 2,
      hipR: 0.6, kneeR: -0.5, footR: 0.16,
      hipL: -0.55, kneeL: -0.3,
      shR: 1.15, elR: -0.05, wrR: -0.2, // blade crossing the descending diagonal
      shL: 0.35, elL: -1.2,
      pelvisYaw: 0.22, chestYaw: -0.18, // hips unwind through the diagonal
    }, 'outQuart'),
    keyframe(0.28, {
      rootRot: 0.42, spine: 0.16, rootY: 1.5,
      shR: 0.85, elR: -0.35, wrR: -0.2, // follow-through low
      shL: 0.3, elL: -1.3,
      // GAP-2 · follow-through: the diagonal's momentum keeps unwinding the
      // hips past contact; head rides late
      pelvisYaw: 0.3, chestYaw: -0.24, head: -0.11,
    }, 'outCubic'),
    keyframe(0.375, {
      pelvisYaw: 0.12, chestYaw: -0.08, head: -0.085, // sequential settle
    }, 'outQuad'),
    keyframe(0.47, GUARD, 'inOutCubic'),
    keyframe(0.55, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.15, end: 0.27, dmg: 9.5, stagger: 0.22, kb: 150, hitstop: 0.05, shake: 0.12, heavy: false, pad: 5 },
  trail: { start: 0.14, end: 0.33 },
  swingSfx: { t: 0.14, name: 'swing' },
  cancel: 0.31,
  chain: ['l3', 'h1', 'h2', 'stabs', 'launcher', 'spin', 'retreat'],
  moveX: 130, moveXAt: 0.14,
  grip: 0.9, // kesa from jōdan — both hands on the tsuka through the diagonal
  zArc: 0.5,
  traj: { // DIAGONAL family: descends temple→hip while the plane TILTS
    a0: -0.9, a1: 0.75, y0: -0.4, y1: 0.28, e0: 0.6, e1: 0.88, band: 48,
  },
}

/** L3 — GYAKU KESA (逆袈裟): the reverse diagonal — hip-to-temple rising
 * cut. Chamber deep in gedan (blade low), then rip UP through the
 * opposite diagonal, legs driving the body upward with the blade. */
const l3: AttackDef = {
  id: 'l3', label: 'GYAKU KESA', kind: 'light', requires: 'ground',
  clip: makeClip('atk_l3', [
    keyframe(0, GUARD, 'outQuad'),
    // GAP-1 · anticipation: the coil deepens — weight loads INTO the legs,
    // hips wind back before the rising diagonal unloads (load beat)
    keyframe(0.05, {
      rootRot: 0.26, rootY: 1.6,
      hipR: 0.45, kneeR: -0.7, footR: 0.12,
      shR: 0.5, elR: -0.5, wrR: 0.7,
      shL: 0.45, elL: -0.95,
      pelvisYaw: -0.14, chestYaw: 0.12,
    }, 'inOutSine'),
    keyframe(0.1, {
      rootRot: 0.2, spine: 0.08, head: -0.08, rootY: 3,
      hipR: 0.55, kneeR: -0.85, footR: 0.14,
      hipL: -0.45, kneeL: -0.8, footL: 0.12,
      shR: 0.35, elR: -0.3, wrR: 0.85, // gedan — blade loaded low
      shL: 0.4, elL: -1.1,
    }, 'inOutSine'),
    // ignition: blade carves up through level as the legs unload
    keyframe(0.14, {
      rootRot: 0.08, rootY: 0,
      hipR: 0.2, kneeR: -0.55,
      shR: 1.05, elR: 0.15, wrR: 0.4,
      shL: 0.3, elL: -1.3,
    }, 'outQuad'),
    keyframe(0.19, {
      rootRot: -0.05, spine: -0.02, head: -0.2, rootY: -3.5,
      hipR: -0.1, kneeR: -0.25,
      hipL: 0.35, kneeL: -0.5,
      shR: 1.75, elR: 0.55, wrR: -0.1, // blade rips up the rising diagonal
      shL: 0.3, elL: -1.4,
      pelvisYaw: 0.18, chestYaw: -0.16, // hips unwind with the riser
    }, 'outExpo'),
    keyframe(0.29, {
      rootRot: -0.08, spine: -0.03, rootY: -3,
      shR: 2.1, elR: 0.55, wrR: -0.05, // follow high
      shL: 0.25, elL: -1.45,
      // GAP-2 · follow-through: the riser's unwind carries past contact
      pelvisYaw: 0.25, chestYaw: -0.21, head: -0.12,
    }, 'outCubic'),
    keyframe(0.39, {
      pelvisYaw: 0.1, chestYaw: -0.07, head: -0.09, // sequential settle
    }, 'outQuad'),
    keyframe(0.49, GUARD, 'inOutCubic'),
    keyframe(0.57, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.11, end: 0.26, dmg: 11, stagger: 0.24, kb: 120, kbY: -140, hitstop: 0.055, shake: 0.14, heavy: false, pad: 5 },
  trail: { start: 0.1, end: 0.33 },
  swingSfx: { t: 0.1, name: 'swing' },
  cancel: 0.33,
  chain: ['l4', 'h1', 'h2', 'stabs', 'launcher', 'retreat'],
  moveX: 110, moveXAt: 0.12,
  grip: 0.9,
  zArc: 0.5,
  traj: { // RISING DIAGONAL family: the plane crosses depth upward
    a0: 0.75, a1: -0.8, y0: 0.22, y1: -0.25, e0: 0.55, e1: 0.9, band: 48,
  },
}

/** L4 — YOKO GIRI (横斬り): level horizontal sweep. Coil into waki (blade
 * back at the hip), then sweep the blade LEVEL through the front plane
 * with a slide step — hasuji keeps the edge flat through the whole arc. */
const l4: AttackDef = {
  id: 'l4', label: 'YOKO GIRI', kind: 'spin', requires: 'ground',
  clip: makeClip('atk_l4', [
    keyframe(0, GUARD, 'outQuad'),
    // GAP-1 · anticipation: hips counter-wind and weight sinks BEFORE the
    // waki coil — the level sweep loads opposite first (whole-body beat)
    keyframe(0.05, {
      rootRot: -0.12, rootY: 1.8,
      hipR: 0.05, kneeR: -0.45, footR: 0.1,
      shR: -0.1, elR: -0.75, wrR: 0.5,
      shL: 0.25, elL: -0.85,
      pelvisYaw: -0.15, chestYaw: 0.12,
    }, 'inOutSine'),
    keyframe(0.1, {
      rootRot: -0.08, spine: -0.03, head: -0.08, rootY: 1,
      shR: -0.35, elR: -0.6, wrR: 0.0, // waki: blade back-down at the hip
      shL: 0.15, elL: -0.9,
    }, 'inOutCubic'),
    // ignition: hips open, blade sweeps through the back quarter
    keyframe(0.14, {
      rootRot: 0.1, rootY: 0,
      shR: 0.3, elR: -0.15, wrR: 0.3,
      shL: 0.3, elL: -1.0,
    }, 'outQuad'),
    keyframe(0.2, {
      rootRot: 0.33, spine: 0.13, head: -0.16, rootY: -0.5,
      hipR: 0.55, kneeR: -0.4, footR: 0.12,
      hipL: -0.5, kneeL: -0.3,
      shR: 1.0, elR: 0.35, wrR: 0.22, // blade sweeps level through the front
      shL: 0.4, elL: -1.15,
      pelvisYaw: 0.2, chestYaw: -0.16, // hips drive the level arc
    }, 'outExpo'),
    keyframe(0.3, {
      rootRot: 0.4, spine: 0.15, rootY: 0,
      shR: 1.5, elR: 0.35, wrR: -0.85, // arc settles forward-low
      shL: 0.3, elL: -1.25,
      // GAP-2 · follow-through: the level sweep's hip drive overshoots and
      // the head catches up late
      pelvisYaw: 0.27, chestYaw: -0.21, head: -0.1,
    }, 'outCubic'),
    keyframe(0.42, {
      pelvisYaw: 0.11, chestYaw: -0.07, head: -0.08, // sequential settle
    }, 'outQuad'),
    keyframe(0.53, GUARD, 'inOutCubic'),
    keyframe(0.61, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.17, end: 0.35, dmg: 6, stagger: 0.16, kb: 190, hitstop: 0.03, shake: 0.08, heavy: false, multiHit: 0.12, pad: 6 },
  trail: { start: 0.15, end: 0.41 },
  swingSfx: { t: 0.16, name: 'swing' },
  cancel: 0.37,
  chain: ['l5', 'h2', 'stabs', 'launcher', 'srCross'],
  moveX: 90, moveXAt: 0.16,
  grip: 0.7,
  zArc: 0.55,
  traj: { // HORIZONTAL family: the blade carves a WIDE depth arc around
    // the body — behind the far shoulder, through the target, out the
    // camera side. The hips drive it (pelvisYaw rides the yaw sweep).
    a0: 2.5, a1: 0.08, y0: -0.85, y1: 0.7, e0: 0.5, e1: 0.92, band: 48,
  },
}

/** L5 — KIRI OROSHI (切り下ろし): the vertical finishing cut. Full jōdan
 * raise over the head, deliberate beat, then the blade falls straight
 * through the center line with a deep passing lunge. */
const l5: AttackDef = {
  id: 'l5', label: 'KIRI OROSHI', kind: 'finisher', requires: 'ground',
  clip: makeClip('atk_l5', [
    keyframe(0, GUARD, 'outQuad'),
    // GAP-1 · anticipation: weight sinks BEFORE the jōdan raise — the coil
    // that pays for the vertical finishing cut (crouch-before-fall beat)
    keyframe(0.05, {
      rootRot: -0.1, rootY: 2,
      hipR: -0.05, kneeR: -0.45, footR: 0.14,
      hipL: 0.1, kneeL: -0.4, footL: 0.12,
      shR: 1.7, elR: -0.15, wrR: 0.5,
      shL: 1.4, elL: -0.55,
      pelvisYaw: -0.16, chestYaw: 0.14,
    }, 'outQuad'),
    keyframe(0.12, {
      rootRot: -0.2, spine: -0.08, head: -0.04, rootY: -2,
      hipR: -0.15, kneeR: -0.35,
      shR: 2.7, elR: 0.15, wrR: 0.15, // full jōdan — blade over the head
      shL: 2.1, elL: -0.4,
    }, 'inOutCubic'),
    // ignition: the beat before the fall — blade tips forward a hair
    keyframe(0.17, {
      rootRot: -0.1, rootY: -1,
      shR: 2.1, elR: 0.1, wrR: 0.2,
      shL: 1.9, elL: -0.45,
    }, 'outQuad'),
    // mid-fall: the blade sweeps down through the high diagonal
    keyframe(0.21, {
      rootRot: 0.15, rootY: 1,
      shR: 1.4, elR: -0.15, wrR: 0.0,
      shL: 1.3, elL: -0.55,
    }, 'outQuad'),
    keyframe(0.25, {
      rootRot: 0.4, spine: 0.16, head: -0.22, rootY: 2,
      hipR: 0.75, kneeR: -0.55, footR: 0.18,
      hipL: -0.6, kneeL: -0.25,
      shR: 0.85, elR: -0.5, wrR: -0.2, // te-no-uchi: hands stay near the
      shL: 0.9, elL: -0.7,              // body — the blade falls through the
      pelvisYaw: 0.2, chestYaw: -0.18,  // hips unwind through the fall
    }, 'outExpo'),                       // front plane, close enough to cut
    keyframe(0.37, {
      rootRot: 0.44, spine: 0.17, rootY: 2.5,
      shR: 0.7, elR: -0.6, wrR: -0.35, // cut finishes low past the target
      shL: 0.7, elL: -0.9,
      // GAP-2 · follow-through: the fall's hip unwind carries past contact;
      // the head settles a beat after the blade stops
      pelvisYaw: 0.27, chestYaw: -0.24, head: -0.13,
    }, 'outCubic'),
    keyframe(0.48, {
      pelvisYaw: 0.11, chestYaw: -0.08, head: -0.09, // sequential settle
    }, 'outQuad'),
    keyframe(0.59, GUARD, 'inOutCubic'),
    keyframe(0.67, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.22, end: 0.35, dmg: 22, stagger: 0.4, kb: 460, hitstop: 0.09, shake: 0.32, heavy: true, breakGuard: true, pad: 8 },
  trail: { start: 0.19, end: 0.41 },
  swingSfx: { t: 0.2, name: 'swingHeavy' },
  cancel: 0.37,
  chain: ['srOnslaught'],
  moveX: 240, moveXAt: 0.2,
  grip: 1, // kiri oroshi — full two-handed vertical
  zArc: 0.65,
  traj: { // VERTICAL family: falls through the center line; a whisper of
    // depth (dips behind the crown at chamber, exits slightly camera-side)
    a0: -1.55, a1: 1.3, y0: -0.18, y1: 0.15, e0: 0.55, e1: 0.93, band: 48,
  },
}

/** Backstep Slash — retreating rising cut (hold back + light): gyaku-kesa
 * on the retreat — real distance management. */
const retreat: AttackDef = {
  id: 'retreat', label: 'BACKSTEP CUT', kind: 'light', requires: 'ground',
  clip: makeClip('atk_retreat', [
    keyframe(0, GUARD, 'outQuad'),
    keyframe(0.08, {
      rootRot: 0.24, spine: 0.1, rootY: 2.5,
      hipR: 0.5, kneeR: -0.75,
      hipL: -0.55, kneeL: -0.5,
      shR: 0.35, elR: -0.3, wrR: 0.85, // chamber low while stepping back
      shL: 0.45, elL: -1.0,
    }, 'inOutSine'),
    keyframe(0.13, {
      rootRot: 0.1, rootY: 1,
      shR: 1.05, elR: 0.15, wrR: 0.4,
      shL: 0.35, elL: -1.25,
    }, 'outQuad'),
    keyframe(0.19, {
      rootRot: -0.12, spine: -0.05, head: -0.2, rootY: -2,
      shR: 1.75, elR: 0.55, wrR: -0.1, // rising diagonal on the retreat
      shL: 0.25, elL: -1.35,
    }, 'outCubic'),
    keyframe(0.31, {
      rootRot: -0.05, spine: -0.02, rootY: -1,
      shR: 2.0, elR: 0.5, wrR: 0.1,
      shL: 0.25, elL: -1.4,
    }, 'outCubic'),
    keyframe(0.51, GUARD, 'outQuad'),
    keyframe(0.59, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.16, end: 0.28, dmg: 10, stagger: 0.22, kb: 90, kbY: -160, hitstop: 0.05, shake: 0.12, heavy: false, pad: 5 },
  trail: { start: 0.15, end: 0.34 },
  swingSfx: { t: 0.14, name: 'swing' },
  cancel: 0.31,
  chain: ['l1', 'l2', 'launcher', 'spin', 'srIai'],
  moveX: -240, moveXAt: 0.05,
  grip: 0.85,
  zArc: 0.45,
  traj: { // retreating riser — the plane crosses depth while stepping back
    a0: 0.7, a1: -0.75, y0: -0.3, y1: 0.25, e0: 0.5, e1: 0.8, band: 48,
  },
}

/** HASSŌ SWEEP (down + light): crouched low horizontal sweep with a
 * counter-pass — a sawing double cut. Replaces the 360° cyclone: real
 * technique cuts ~200° and saws back. */
const spin: AttackDef = {
  id: 'spin', label: 'HASSO SWEEP', kind: 'spin', requires: 'ground',
  clip: makeClip('atk_spin', [
    keyframe(0, {
      rootRot: 0.4, rootY: 7, spine: 0.14, head: -0.24,
      hipR: 0.55, kneeR: -1.15, footR: 0.2,
      hipL: -0.45, kneeL: -1.05, footL: 0.15,
      shR: -0.15, elR: -0.5, wrR: -0.7, // coiled back-low
      shL: 0.3, elL: -0.8,
    }, 'outQuad'),
    keyframe(0.06, {
      rootRot: 0.44, rootY: 6,
      hipR: 0.45, kneeR: -1.1, footR: 0.18,
      hipL: -0.5, kneeL: -1.0, footL: 0.15,
      shR: 0.4, elR: -0.15, wrR: 0.2,
      shL: 0.28, elL: -0.9,
    }, 'outQuad'),
    keyframe(0.11, {
      rootRot: 0.5, rootY: 5, spine: 0.15, head: -0.26,
      hipR: 0.6, kneeR: -1.1, footR: 0.18,
      hipL: -0.5, kneeL: -1.0,
      shR: 1.0, elR: 0.25, wrR: 0.3, // low level sweep through the front
      shL: 0.25, elL: -1.0,
    }, 'outCubic'),
    keyframe(0.23, {
      rootRot: 0.42, rootY: 5.5,
      shR: 1.3, elR: 0.15, wrR: -0.65, // arc settles low
      shL: 0.2, elL: -1.1,
    }, 'outCubic'),
    keyframe(0.35, {
      rootRot: 0.55, rootY: 4.5, spine: 0.16, head: -0.28,
      shR: 0.5, elR: 0.1, wrR: 0.97, // counter-pass: level pull-back (sawing)
      shL: 0.4, elL: -1.0,
    }, 'outCubic'),
    keyframe(0.49, {
      rootRot: 0.3, rootY: 3,
      shR: 0.7, elR: -0.3, wrR: 1.1,
    }, 'outQuad'),
    keyframe(0.65, GUARD, 'outQuad'),
  ]),
  hit: { start: 0.09, end: 0.42, dmg: 5.5, stagger: 0.14, kb: 160, hitstop: 0.028, shake: 0.07, heavy: false, multiHit: 0.11, pad: 6 },
  trail: { start: 0.08, end: 0.46 },
  swingSfx: { t: 0.08, name: 'swing' },
  cancel: 0.4,
  chain: ['l5', 'launcher', 'h2', 'srVortex'],
  grip: 0.75,
  zArc: 0.5,
  traj: { // SPIN family: near-full-circle depth rotation around the body —
    // the kissaki orbits through BEHIND → target plane → camera → behind.
    // The pelvis and chest counter-rotate through the whole sweep.
    a0: 2.6, a1: 0.1, y0: -1.15, y1: 1.1, e0: 0.45, e1: 0.85, band: 14,
  },
}

/** STABS — RENZOKU TSUKI (連続突き): the rapid triple thrust. Chamber the
 * hilt at the hip, then three spearing thrusts with controlled retracts
 * between — a forward-pressure string that pins the target on the point.
 * Reached by holding INTO the enemy during a light-chain window (the
 * forward axis was the only unmapped direction in pickLight). Pose
 * vocabulary is h2's tsuki chamber/ignition/thrust, escalated per thrust
 * (deeper coil, longer lunge) so the string reads as pressure, not spam. */
const stabs: AttackDef = {
  id: 'stabs', label: 'RENZOKU TSUKI', kind: 'light', requires: 'ground',
  clip: makeClip('atk_stabs', [
    keyframe(0, GUARD, 'outQuad'),
    // GAP-1 · anticipation: the chamber deepens — hips counter-wind back,
    // weight sinks, hilt pulls a touch deeper to the hip before the first
    // lunge (the string loads pressure BEFORE it fires)
    keyframe(0.045, {
      rootRot: -0.16, rootY: 1.8,
      hipR: -0.2, kneeR: -0.55, footR: 0.06,
      hipL: -0.3, kneeL: -0.4, footL: 0.1,
      shR: 0.3, elR: -1.15, wrR: 0.3,
      shL: 0.8, elL: -1.1,
      pelvisYaw: -0.2, chestYaw: 0.16,
    }, 'inOutSine'),
    // chamber: hilt pulled to the hip, blade back-level, weight loading back
    keyframe(0.09, {
      rootRot: -0.12, spine: -0.05, head: -0.06, rootY: 1,
      hipR: -0.15, kneeR: -0.5, footR: 0.08,
      hipL: -0.3, kneeL: -0.35, footL: 0.1,
      shR: -0.15, elR: -1.05, wrR: -0.25, // hilt at the hip — h2's chamber
      shL: 0.8, elL: -1.1, // lead hand guards
    }, 'inOutCubic'),
    // ignition 1: blade sweeps level as the first lunge launches
    keyframe(0.13, {
      rootRot: 0.2, rootY: 2,
      hipR: 0.5, kneeR: -0.7,
      shR: 0.7, elR: -0.5, wrR: 0.3,
      shL: 1.1, elL: -0.7,
    }, 'outQuad'),
    // THRUST 1 — level, full extension (sum ≈ 1.57 → blade dead-level)
    keyframe(0.17, {
      rootRot: 0.38, spine: 0.14, head: -0.2, rootY: 2.5,
      hipR: 0.9, kneeR: -0.8, footR: 0.2,
      hipL: -0.8, kneeL: -0.2,
      shR: 1.5, elR: 0.05, wrR: 0.02,
      shL: 1.4, elL: -0.35,
      pelvisYaw: 0.24, chestYaw: -0.2, // hips spear through with the point
    }, 'outQuart'),
    // retract 1 — controlled pull back to the hip, point never drops
    keyframe(0.27, {
      rootRot: -0.08, rootY: 1,
      hipR: -0.1, kneeR: -0.55,
      shR: -0.1, elR: -1.0, wrR: -0.5,
      shL: 0.85, elL: -1.05,
      // GAP-2 · string rhythm: hips stay partially wound between thrusts
      pelvisYaw: 0.1, chestYaw: -0.07,
    }, 'inOutSine'),
    // ignition 2
    keyframe(0.305, {
      rootRot: 0.22, rootY: 2,
      shR: 0.72, elR: -0.48, wrR: 0.28,
      shL: 1.12, elL: -0.68,
      // GAP-2 · re-coil: the retract re-winds the hips past neutral
      pelvisYaw: -0.06, chestYaw: 0.05,
    }, 'outQuad'),
    // THRUST 2 — a touch deeper, chest rotating through
    keyframe(0.35, {
      rootRot: 0.4, spine: 0.15, head: -0.21, rootY: 2.5,
      hipR: 0.92, kneeR: -0.82, footR: 0.21,
      hipL: -0.82, kneeL: -0.18,
      shR: 1.52, elR: 0.04, wrR: 0.01,
      shL: 1.42, elL: -0.34,
      pelvisYaw: 0.26, chestYaw: -0.22, // hips drive the deeper repeat
    }, 'outQuart'),
    // retract 2
    keyframe(0.45, {
      rootRot: -0.1, rootY: 1.5,
      hipR: -0.12, kneeR: -0.58,
      shR: -0.12, elR: -1.02, wrR: -0.52,
      shL: 0.82, elL: -1.08,
      // GAP-2 · string rhythm: partial hip wind carried into the re-coil
      pelvisYaw: 0.11, chestYaw: -0.08,
    }, 'inOutSine'),
    // ignition 3 — deepest coil, back leg loads for the passing lunge
    keyframe(0.5, {
      rootRot: 0.24, rootY: 2,
      hipR: 0.55, kneeR: -0.72,
      shR: 0.75, elR: -0.52, wrR: 0.3,
      shL: 1.15, elL: -0.65,
      // GAP-2 · re-coil deepens with the escalation
      pelvisYaw: -0.07, chestYaw: 0.055,
    }, 'outQuad'),
    // THRUST 3 — deep passing lunge, hips fully open, full penetration
    keyframe(0.555, {
      rootRot: 0.42, spine: 0.16, head: -0.22, rootY: 2.5,
      hipR: 0.95, kneeR: -0.85, footR: 0.22,
      hipL: -0.85, kneeL: -0.15,
      shR: 1.55, elR: 0.05, wrR: 0.0,
      shL: 1.45, elL: -0.35,
      pelvisYaw: 0.28, chestYaw: -0.24, // the passing lunge unwinds hardest
    }, 'outQuart'),
    // penetration beat — the hold sells the depth before recovery
    keyframe(0.63, {
      rootRot: 0.44, spine: 0.16, rootY: 2.2,
      shR: 1.56, elR: 0.06, wrR: 0.0,
      shL: 1.46, elL: -0.36,
      // GAP-2 · hips stay WOUND through the hold (h2's tsuki law)
      pelvisYaw: 0.24, chestYaw: -0.2,
    }, 'inOutSine'),
    keyframe(0.7, {
      pelvisYaw: 0.12, chestYaw: -0.09, // sequential settle after the hold
    }, 'outQuad'),
    keyframe(0.78, GUARD, 'outQuad'),
    keyframe(0.86, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.15, end: 0.58, dmg: 4.5, stagger: 0.12, kb: 70, hitstop: 0.03, shake: 0.06, heavy: false, multiHit: 0.15, pad: 6 },
  trail: { start: 0.12, end: 0.63 },
  swingSfx: { t: 0.13, name: 'swing' },
  cancel: 0.66,
  chain: ['l5', 'h2', 'launcher', 'spin', 'srViper'],
  moveX: 250, moveXAt: 0.13,
  grip: 1, // the string is always two-handed — h2's tsuki law
  zArc: 0.8, // thrusts spear the lens
  traj: { // THRUST family (string variant): the blade re-spears through
    // depth on every beat — chambered back, pierce at the lens, repeat
    a0: -2.8, a1: 0.05, y0: -0.3, y1: 0.5, e0: 0.45, e1: 0.97, band: 78,
  },
}

/* ------------------------------------------------------------------ */
/* GROUND HEAVIES                                                      */
/* ------------------------------------------------------------------ */

/** H1 — heavy KIRI OROSHI: vertical cut with a full beat of anticipation
 * at jōdan. The pause at the top is the tell — then everything drops. */
const h1: AttackDef = {
  id: 'h1', label: 'KIRI OROSHI', kind: 'heavy', requires: 'ground',
  clip: makeClip('atk_h1', [
    keyframe(0, GUARD, 'outQuad'),
    // GAP-1 · anticipation: weight sinks and hips counter-wind BEFORE the
    // jōdan raise — the vertical cut loads the whole body first
    keyframe(0.06, {
      rootRot: -0.26, rootY: 1.6,
      hipR: -0.1, kneeR: -0.4, footR: 0.08,
      hipL: 0.15, kneeL: -0.38, footL: 0.1,
      shR: 1.4, elR: -0.1, wrR: 0.05,
      shL: 1.1, elL: -0.5,
      pelvisYaw: -0.2, chestYaw: 0.16,
    }, 'outQuad'),
    keyframe(0.14, {
      rootRot: -0.22, spine: -0.09, head: -0.02, rootY: -2.5,
      hipR: -0.18, kneeR: -0.3, footR: 0.08,
      hipL: 0.25, kneeL: -0.35, footL: 0.1,
      shR: 2.7, elR: 0.15, wrR: 0.15, // jōdan raise — blade up, both hands high
      shL: 2.1, elL: -0.4,
    }, 'inOutCubic'),
    keyframe(0.22, {
      rootRot: -0.18, spine: -0.07, rootY: -1.5,
      shR: 2.72, elR: 0.15, wrR: 0.13, // hold beat — blade tips forward a hair
      shL: 2.05, elL: -0.42,
    }, 'inOutSine'),
    // ignition: the fall begins
    keyframe(0.24, {
      rootRot: 0.1, rootY: 0,
      shR: 2.0, elR: 0.0, wrR: 0.3,
      shL: 1.7, elL: -0.5,
    }, 'outQuad'),
    // mid-fall: blade sweeps through the high diagonal
    keyframe(0.28, {
      rootRot: 0.25, rootY: 1.2,
      shR: 1.35, elR: -0.2, wrR: 0.05,
      shL: 1.25, elL: -0.6,
    }, 'outQuad'),
    keyframe(0.32, {
      rootRot: 0.42, spine: 0.17, head: -0.24, rootY: 2.5,
      hipR: 0.8, kneeR: -0.6, footR: 0.2,
      hipL: -0.65, kneeL: -0.22,
      shR: 0.85, elR: -0.5, wrR: -0.2, // te-no-uchi vertical fall — hands
      shL: 0.9, elL: -0.7,              // near the body, blade cuts the close plane
      pelvisYaw: 0.22, chestYaw: -0.18, // hips unwind through the drop
    }, 'outExpo'),
    keyframe(0.45, {
      rootRot: 0.46, spine: 0.18, rootY: 3,
      shR: 0.7, elR: -0.6, wrR: -0.35,
      shL: 0.7, elL: -0.9,
      // GAP-2 · follow-through: the heavy fall's unwind carries past
      // contact; head settles after the blade is already buried
      pelvisYaw: 0.3, chestYaw: -0.24, head: -0.13,
    }, 'outCubic'),
    keyframe(0.57, {
      pelvisYaw: 0.12, chestYaw: -0.08, head: -0.09, // sequential settle
    }, 'outQuad'),
    keyframe(0.71, GUARD, 'outQuad'),
    keyframe(0.79, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.28, end: 0.42, dmg: 18, stagger: 0.38, kb: 260, hitstop: 0.08, shake: 0.26, heavy: true, pad: 8 },
  trail: { start: 0.25, end: 0.48 },
  swingSfx: { t: 0.26, name: 'swingHeavy' },
  cancel: 0.43,
  chain: ['h2', 'l1', 'launcher'],
  moveX: 200, moveXAt: 0.24,
  grip: 1, // jōdan raise + vertical fall — both hands, te-no-uchi
  zArc: 0.6,
  traj: { // HEAVY VERTICAL: deeper chamber, harder fall, full extension
    a0: -1.6, a1: 1.35, y0: -0.2, y1: 0.18, e0: 0.5, e1: 0.95, band: 48,
  },
}

/** H2 — TSUKI (突き): the thrust. Hilt chambered back at the hip, then a
 * deep passing lunge spears the blade dead-level into the target. */
const h2: AttackDef = {
  id: 'h2', label: 'TSUKI', kind: 'heavy', requires: 'ground',
  clip: makeClip('atk_h2', [
    keyframe(0, GUARD, 'outQuad'),
    // GAP-1 · anticipation: the tsuki chamber deepens — weight sinks, hips
    // counter-wind back before the passing lunge spears forward
    keyframe(0.05, {
      rootRot: -0.18, rootY: 2.2,
      hipR: -0.2, kneeR: -0.6, footR: 0.06,
      hipL: -0.28, kneeL: -0.42, footL: 0.1,
      shR: 0.3, elR: -1.15, wrR: 0.2, // hilt pulls deeper to the hip
      shL: 0.75, elL: -1.05,
      pelvisYaw: -0.22, chestYaw: 0.18,
    }, 'inOutSine'),
    keyframe(0.12, {
      rootRot: -0.12, spine: -0.05, head: -0.06, rootY: 1,
      hipR: -0.15, kneeR: -0.5, footR: 0.08,
      hipL: -0.3, kneeL: -0.35, footL: 0.1,
      shR: -0.15, elR: -1.05, wrR: -0.55, // hilt pulled to the hip, blade back-level
      shL: 0.8, elL: -1.1, // lead hand guards
    }, 'inOutCubic'),
    // ignition: the lunge launches, blade sweeping through level
    keyframe(0.18, {
      rootRot: 0.2, rootY: 2,
      hipR: 0.5, kneeR: -0.7,
      shR: 0.7, elR: -0.5, wrR: 0.3,
      shL: 1.1, elL: -0.7,
    }, 'outQuad'),
    keyframe(0.24, {
      rootRot: 0.4, spine: 0.16, head: -0.22, rootY: 2.5,
      hipR: 0.95, kneeR: -0.85, footR: 0.22,
      hipL: -0.85, kneeL: -0.15,
      shR: 1.5, elR: 0.05, wrR: 0.02, // blade dead-level, full extension
      shL: 1.4, elL: -0.35, // second hand joins on the tsuka
      pelvisYaw: 0.26, chestYaw: -0.22, // hips unwind into the lunge
    }, 'outQuart'),
    keyframe(0.38, {
      rootRot: 0.42, spine: 0.16, rootY: 2.2,
      shR: 1.52, elR: 0.06, wrR: 0.0, // hold — full penetration beat
      shL: 1.42, elL: -0.36,
      pelvisYaw: 0.2, chestYaw: -0.16, // hips stay wound through the hold
    }, 'inOutSine'),
    keyframe(0.56, {
      rootRot: 0.18, spine: 0.07, rootY: 0.5,
      shR: 1.0, elR: -0.3, wrR: 0.85, // retract under control
      shL: 0.7, elL: -0.8,
      // GAP-2 · retract keeps partial hip wind; settle follows sequentially
      pelvisYaw: 0.1, chestYaw: -0.07,
    }, 'outQuad'),
    keyframe(0.64, {
      pelvisYaw: 0.06, chestYaw: -0.04, // the last joints give back
    }, 'outQuad'),
    keyframe(0.72, GUARD, 'outQuad'),
    keyframe(0.8, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.2, end: 0.34, dmg: 22, stagger: 0.42, kb: 560, hitstop: 0.09, shake: 0.34, heavy: true, breakGuard: true, pad: 10 },
  trail: { start: 0.18, end: 0.4 },
  swingSfx: { t: 0.2, name: 'swingHeavy' },
  cancel: 0.4,
  chain: ['h3', 'stabs', 'l1', 'srViper'],
  moveX: 320, moveXAt: 0.2,
  grip: 1, // tsuki: the thrust is ALWAYS two-handed
  zArc: 0.85, // the thrust SPEARS the camera — full foreshortening
  traj: { // THRUST family: the blade TRANSLATES through depth — chambered
    // back (−0.35), then spears forward through the target plane and AT
    // the lens (+0.55) at near-full arm extension. The kissaki blooms
    // huge as it pierces toward the camera (drawSword depth flare).
    a0: -2.9, a1: 0.05, y0: -0.35, y1: 0.55, e0: 0.45, e1: 0.98, band: 78,
  },
}

/** H3 — Grand Slam: leaping kiri oroshi. Jump to jōdan, hang at apex,
 * then body + blade fall through the center line into the floor. */
const h3: AttackDef = {
  id: 'h3', label: 'GRAND SLAM', kind: 'heavy', requires: 'ground',
  clip: makeClip('atk_h3', [
    keyframe(0, {
      rootY: 6, rootRot: 0.35, spine: 0.12, head: -0.2,
      hipR: 0.55, kneeR: -1.1, footR: 0.2,
      hipL: -0.45, kneeL: -1.0, footL: 0.15,
      shR: 2.6, elR: 0.15, wrR: 0.25, // jōdan held through the crouch
      shL: 2.0, elL: -0.45,
      pelvisYaw: -0.16, chestYaw: 0.12, // GAP-1: hips counter-wind in the crouch
    }, 'outQuad'),
    keyframe(0.15, {
      rootY: -4, rootRot: -0.2, spine: -0.06, head: -0.1,
      hipR: 0.8, kneeR: -1.4, footR: -0.1,
      hipL: 0.5, kneeL: -1.2, footL: 0.1,
      shR: 2.75, elR: 0.15, wrR: 0.1, // apex — blade fully up
      shL: 2.15, elL: -0.4,
    }, 'outCubic'),
    keyframe(0.35, {
      rootY: -5, rootRot: -0.15,
      shR: 2.72, elR: 0.15, wrR: 0.1,
      hipR: 0.7, kneeR: -1.3, hipL: 0.4, kneeL: -1.1,
    }, 'inOutSine'),
    // ignition: the plunge begins
    keyframe(0.42, {
      rootY: -1, rootRot: 0.3,
      shR: 2.2, elR: 0.0, wrR: 0.3,
      hipR: 0.7, kneeR: -0.8,
      // GAP-2 · the unwind BUILDS through the fall (was neutral-held)
      pelvisYaw: 0.1, chestYaw: -0.06,
    }, 'outQuad'),
    keyframe(0.5, {
      rootRot: 0.6, spine: 0.2, head: -0.28, rootY: 3,
      hipR: 0.7, kneeR: -0.4, footR: 0.25,
      hipL: -0.6, kneeL: -0.3, footL: 0.2,
      shR: 0.9, elR: -0.45, wrR: -0.35, // blade plummets through the near plane
      shL: 0.9, elL: -0.6,
      // GAP-2 · hips OPEN at the money frame — the slam gets its hip drive
      pelvisYaw: 0.22, chestYaw: -0.18,
    }, 'outCubic'),
    keyframe(0.64, {
      rootRot: 0.64, rootY: 5, spine: 0.2, head: -0.26,
      hipR: 0.6, kneeR: -0.9, hipL: -0.5, kneeL: -0.8,
      shR: 0.75, elR: -0.5, wrR: -0.45, // blade buried low
      shL: 0.7, elL: -0.85,
      // GAP-2 · settle-carry: unwind decays sequentially into the hold
      pelvisYaw: 0.12, chestYaw: -0.08,
    }, 'outQuad'),
    keyframe(0.9, GUARD, 'outQuad'),
    keyframe(0.98, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.48, end: 0.6, dmg: 30, stagger: 0.5, kb: 380, launch: -320, hitstop: 0.12, shake: 0.5, heavy: true, aoe: 135, breakGuard: true, pad: 10 },
  trail: { start: 0.43, end: 0.63 },
  swingSfx: { t: 0.44, name: 'swingHeavy' },
  cancel: 0.55,
  chain: ['srOmega'],
  moveY: -780, moveYAt: 0.04,
  slamImpact: { r: 135, dmg: 26, launch: -280 },
  grip: 1,
  zArc: 0.7,
  traj: { // SLAM family: overhead apex → ground-shattering fall
    a0: -1.5, a1: 1.6, y0: -0.12, y1: 0.2, e0: 0.5, e1: 0.92, band: 14,
  },
}

/** LAUNCHER — Rising Fang: gedan chamber, then the whole body rips upward
 * and the blade carves a rising diagonal that hurls foes skyward. */
const launcher: AttackDef = {
  id: 'launcher', label: 'RISING FANG', kind: 'launcher', requires: 'ground',
  clip: makeClip('atk_launcher', [
    keyframe(0, {
      rootY: 6, rootRot: 0.32, spine: 0.12, head: -0.14,
      hipR: 0.6, kneeR: -1.2, footR: 0.2,
      hipL: -0.5, kneeL: -1.05, footL: 0.15,
      shR: 0.4, elR: -0.25, wrR: 0.75, // blade loaded low (gedan)
      shL: 0.45, elL: -0.9,
    }, 'outQuad'),
    // GAP-1 · anticipation: the pre-coiled entry SETTLES one unit deeper —
    // weight sinks and hips counter-wind before the legs unload (the
    // visible load beat this launcher was missing)
    keyframe(0.03, {
      rootY: 8, rootRot: 0.26, spine: 0.1, head: -0.1,
      hipR: 0.68, kneeR: -1.3, footR: 0.18,
      hipL: -0.55, kneeL: -0.7, footL: 0.12,
      shR: 0.35, elR: -0.25, wrR: 0.8,
      shL: 0.45, elL: -0.9,
      pelvisYaw: -0.16, chestYaw: 0.12,
    }, 'inOutSine'),
    // ignition: legs unload, blade carves through level
    keyframe(0.06, {
      rootY: 1, rootRot: 0.15,
      hipR: 0.35, kneeR: -0.7,
      shR: 1.05, elR: 0.15, wrR: 0.4,
      shL: 0.35, elL: -1.15,
    }, 'outQuad'),
    keyframe(0.11, {
      rootY: -6, rootRot: -0.28, spine: -0.1, head: -0.24,
      hipR: -0.3, kneeR: -0.35,
      hipL: 0.4, kneeL: -0.45,
      shR: 1.75, elR: 0.55, wrR: -0.1, // rising cut through the front plane
      shL: 0.2, elL: -1.4,
      pelvisYaw: 0.18, chestYaw: -0.14, // hips unwind with the riser
    }, 'outExpo'),
    keyframe(0.23, {
      rootY: -6, rootRot: -0.3, spine: -0.1,
      shR: 2.1, elR: 0.55, wrR: -0.05, // follow high
      shL: 0.15, elL: -1.45,
      // GAP-2 · follow-through: the riser's unwind carries past contact
      pelvisYaw: 0.24, chestYaw: -0.18, head: -0.12,
    }, 'outCubic'),
    keyframe(0.34, {
      pelvisYaw: 0.1, chestYaw: -0.06, head: -0.09, // sequential settle
    }, 'outQuad'),
    keyframe(0.46, GUARD, 'outQuad'),
    keyframe(0.54, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.04, end: 0.12, dmg: 12, stagger: 0.3, kb: 60, launch: -640, hitstop: 0.07, shake: 0.2, heavy: false, pad: 8 },
  trail: { start: 0.03, end: 0.26 },
  swingSfx: { t: 0.05, name: 'swing' },
  cancel: 0.28,
  chain: ['a1', 'a2', 'a3', 'dive'],
  moveX: 170, moveXAt: 0.05,
  moveY: -520, moveYAt: 0.1,
  grip: 0.9,
  zArc: 0.5,
  traj: { // LAUNCHER family: huge riser from a low coil — sweeps upward
    // through depth as the legs drive the body with the blade
    a0: 0.7, a1: -0.8, y0: -0.25, y1: 0.35, e0: 0.5, e1: 0.95, band: 14,
  },
}

/* ------------------------------------------------------------------ */
/* DASH ATTACKS                                                        */
/* ------------------------------------------------------------------ */

/** Dash Slash — PHANTOM CUT: iai through-cut on the pass. Blade chambered
 * back during the dash, then whipped level as the body passes through. */
const dashSlash: AttackDef = {
  id: 'dashSlash', label: 'PHANTOM CUT', kind: 'dash', requires: 'any',
  clip: makeClip('atk_dashslash', [
    keyframe(0, {
      rootRot: 0.5, rootY: 2, spine: 0.12, head: -0.4,
      hipR: 0.9, kneeR: -1.0, footR: 0.15,
      hipL: -0.85, kneeL: -0.7, footL: 0.2,
      shR: -0.2, elR: -0.6, wrR: -0.85, // chambered back-level
      shL: 0.75, elL: -0.5,
    }, 'outQuad'),
    // ignition: blade sweeps through the back quarter
    keyframe(0.06, {
      rootRot: 0.55, rootY: 1.5,
      shR: 0.5, elR: -0.2, wrR: 0.2,
      shL: 0.6, elL: -0.7,
    }, 'outQuad'),
    keyframe(0.102, {
      rootRot: 0.6, rootY: 1, spine: 0.14, head: -0.42,
      hipR: 1.0, kneeR: -0.85,
      hipL: -0.95, kneeL: -0.55,
      shR: 1.35, elR: 0.15, wrR: 0.07, // level through-cut
      shL: 0.5, elL: -0.9,
    }, 'outCubic'),
    keyframe(0.21, {
      rootRot: 0.5, rootY: 0,
      shR: 1.5, elR: 0.4, wrR: -0.6, // settle forward-low
      shL: 0.35, elL: -1.1,
    }, 'outCubic'),
    keyframe(0.35, GUARD, 'outQuad'),
    keyframe(0.43, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.07, end: 0.21, dmg: 12, stagger: 0.26, kb: 220, hitstop: 0.05, shake: 0.16, heavy: false, multiHit: 0.1, pad: 6 },
  trail: { start: 0.05, end: 0.25 },
  swingSfx: { t: 0.06, name: 'swing' },
  cancel: 0.23,
  chain: ['l1', 'l2', 'h1', 'launcher'],
  moveX: 560, moveXAt: 0.02,
  grip: 0.3, // iai through-cut on the pass — one hand, saya hand back
  zArc: 0.6, drawFlash: true,
  traj: { // DASH THROUGH-CUT: level blade carried through the pass
    a0: -2.9, a1: 0.05, y0: -0.2, y1: 0.15, e0: 0.6, e1: 0.95, band: 48,
  },
}

/** Dash Heavy — PIERCING FANG: tsuki from the dash. */
const dashHeavy: AttackDef = {
  id: 'dashHeavy', label: 'PIERCING FANG', kind: 'dash', requires: 'ground',
  clip: makeClip('atk_dashheavy', [
    keyframe(0, {
      rootRot: 0.15, rootY: 2, spine: 0.05, head: -0.1,
      hipR: 0.4, kneeR: -0.7, hipL: -0.4, kneeL: -0.5,
      shR: -0.15, elR: -1.0, wrR: -0.6, // hilt at hip, blade back-level
      shL: 0.7, elL: -1.0,
    }, 'outQuad'),
    // GAP-1 · anticipation: micro-coil — the hilt seats a touch deeper at
    // the hip, hips counter-wind before the dash thrust spears forward
    // (arms bridge toward the ignition: the coil is in body + arm seat)
    keyframe(0.03, {
      rootRot: 0.08, rootY: 2.6,
      hipR: 0.35, kneeR: -0.8,
      shR: 0.28, elR: -0.72, wrR: -0.15,
      shL: 0.85, elL: -0.85,
      pelvisYaw: -0.15, chestYaw: 0.12,
    }, 'inOutSine'),
    keyframe(0.06, {
      rootRot: 0.3, rootY: 2,
      hipR: 0.7, kneeR: -0.72,
      shR: 0.7, elR: -0.45, wrR: 0.3,
      shL: 1.0, elL: -0.7,
    }, 'outQuad'),
    keyframe(0.12, {
      rootRot: 0.6, rootY: 2, spine: 0.2, head: -0.34,
      hipR: 1.05, kneeR: -0.75, footR: 0.2,
      hipL: -1.0, kneeL: -0.4,
      shR: 1.55, elR: 0.08, wrR: -0.06, // full-extension level thrust
      shL: 1.35, elL: -0.4,
      pelvisYaw: 0.2, chestYaw: -0.16, // hips unwind with the spear
    }, 'outQuart'),
    keyframe(0.26, {
      rootRot: 0.58, rootY: 2,
      shR: 1.5, elR: 0.08, wrR: -0.04,
      shL: 1.3, elL: -0.42,
      // GAP-2 · hips stay wound through the hold, then settle late
      pelvisYaw: 0.16, chestYaw: -0.12,
    }, 'inOutSine'),
    keyframe(0.38, {
      pelvisYaw: 0.08, chestYaw: -0.05, // sequential settle
    }, 'outQuad'),
    keyframe(0.5, GUARD, 'outQuad'),
    keyframe(0.58, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.1, end: 0.26, dmg: 24, stagger: 0.45, kb: 540, hitstop: 0.1, shake: 0.3, heavy: true, pad: 10 },
  trail: { start: 0.09, end: 0.3 },
  swingSfx: { t: 0.1, name: 'swingHeavy' },
  cancel: 0.3,
  chain: [],
  moveX: 420, moveXAt: 0.08,
  grip: 1,
  zArc: 0.85, // piercing fang: dead at the lens
  traj: { // THRUST family (dash variant): spears through depth at the lens
    a0: -2.85, a1: 0.05, y0: -0.25, y1: 0.45, e0: 0.5, e1: 0.97, band: 48,
  },
}

/** POWER DASH ATTACK — GALE BREAKER: the dedicated release of a fully
 * charged dash. The startup was already paid during the planted charge, so
 * the strike ignites inside the drive: the chambered steel whips through
 * one committed horizontal arc while the power-dash body carries it
 * THROUGH the pack; follow-through runs past the blade, then the skid
 * catch reclaims the stance. Selected ONLY from a live power dash (or a
 * ready dash-charge release) — never a grounded heavy. */
const powerArc: AttackDef = {
  id: 'powerArc', label: 'GALE BREAKER', kind: 'dash', requires: 'ground',
  clip: makeClip('atk_powerArc', [
    // carried coil — pose-continuous with the charge stance's LOCK beat and
    // POWER_DASH_CLIP's opening stride (the release never re-loads)
    keyframe(0, {
      rootRot: 0.55, rootY: 4, spine: 0.06, head: -0.5,
      hipR: 0.85, kneeR: -1.35, footR: 0.2,
      hipL: -0.75, kneeL: -0.5, footL: -0.05,
      shR: 0.16, elR: -0.75, wrR: -0.62, // blade chambered back-level
      shL: 0.4, elL: -1.2,
    }, 'outQuad'),
    // final micro-load: the last coil before the whip (anticipation beat)
    keyframe(0.05, {
      rootRot: 0.6, rootY: 4.4, spine: 0.07, head: -0.55,
      hipR: 0.92, kneeR: -1.42, footR: 0.22,
      hipL: -0.82, kneeL: -0.45, footL: -0.05,
      shR: -0.05, elR: -1.05, wrR: -0.7,
      shL: 0.45, elL: -1.15,
    }, 'outQuad'),
    // STRIKE: the whole chain uncoils level — hip, spine, arm, blade in one
    // horizontal sweep through the pass (the charged payoff frame)
    keyframe(0.11, {
      rootRot: 0.5, rootY: 3.2, spine: 0.14, head: -0.42,
      hipR: 1.0, kneeR: -1.45, footR: 0.25,
      hipL: -0.9, kneeL: -0.4, footL: -0.02,
      shR: 1.45, elR: 0.12, wrR: 0.05, // level through-cut, full extension
      shL: 0.35, elL: -1.3,
      pelvisYaw: 0.18, chestYaw: -0.2,
    }, 'outQuart'),
    // follow-through: the blade sweeps PAST the target, arm rides across
    keyframe(0.19, {
      rootRot: 0.42, rootY: 3.6, spine: 0.1, head: -0.34,
      hipR: 0.98, kneeR: -1.5, footR: 0.2,
      hipL: -0.78, kneeL: -0.62, footL: 0.05,
      shR: 1.85, elR: 0.45, wrR: -0.5,
      shL: 0.2, elL: -1.35,
      pelvisYaw: 0.1, chestYaw: -0.14,
    }, 'outCubic'),
    // settle: the skid catch reclaims the stance, arms gather
    keyframe(0.28, {
      rootRot: 0.3, rootY: 4.2, spine: 0.05, head: -0.2,
      hipR: 0.9, kneeR: -1.5, footR: 0.18,
      hipL: -0.6, kneeL: -0.9, footL: 0.08,
      shR: 1.0, elR: -0.4, wrR: -0.9,
      shL: 0.5, elL: -1.1,
    }, 'outQuad'),
    keyframe(0.42, GUARD, 'outQuad'),
    keyframe(0.5, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.08, end: 0.2, dmg: 28, stagger: 0.5, kb: 500, hitstop: 0.1, shake: 0.34, heavy: true, multiHit: 0.09, pad: 8 },
  trail: { start: 0.06, end: 0.24 },
  swingSfx: { t: 0.05, name: 'swingHeavy' },
  cancel: 0.3,
  chain: ['l1', 'h1', 'launcher'],
  moveX: 240, moveXAt: 0.02, // assist only — the power-dash motor owns the drive
  grip: 0.35,
  zArc: 0.55,
  traj: { // CHARGED PASS family: a wide level arc carried through the sweep
    a0: -3.0, a1: 0.15, y0: -0.25, y1: 0.2, e0: 0.55, e1: 0.95, band: 52,
  },
}

/** POWER DASH SLASH — RAIJIN ZAN (雷神斬, thunder-god cut): THE DUAL
 * RELEASE. Hold the dash (the planted coil) and HOLD the heavy — the blade
 * chambers the steel back-level along the saya line (DUAL_CHARGE_CLIP) —
 * then release BOTH keys: one committed power-dash drive with the steel
 * ripping its horizontal draw-cut THROUGH the whole pack. The startup was
 * fully paid inside the planted chamber (no windup on the payoff — the
 * first frame IS the detonation), and the move is hyper-armored: the
 * committed body cannot be interrupted, it can only bleed.
 *
 * Choreography (Alan Becker language — squash, lag, smear, follow-through):
 *   SIT (.035) the last compression beat before detonation ·
 *   DETONATION (.08) the legs fire — the body is GONE before the steel
 *     (the blade still chambered: motion leads, the weapon lags) ·
 *   THE CUT (.14) the blade rips through the full horizontal arc as the
 *     hips unwind — full extension, the smear apex ·
 *   CARRY (.21–.30) follow-through whips the blade past the plane while
 *     stride-flight rides the corridor through the pack ·
 *   CATCH (.40) the front leg reaches far ahead and plants the skid ·
 *   ZANSHIN (.52–.70) the settle back to the middle guard.
 * The first keyframe is EXACTLY DUAL_CHARGE_CLIP's TAUT LOCK so the
 * release hands off pose-identically — the chamber detonates, it never
 * re-loads. Selected ONLY from a locked dual charge — never a grounded
 * heavy, never a live dash press. */
const powerSlash: AttackDef = {
  id: 'powerSlash', label: 'RAIJIN ZAN', kind: 'dash', requires: 'ground',
  clip: makeClip('atk_powerSlash', [
    // the dual-chamber TAUT LOCK, verbatim — seamless detonation handoff
    keyframe(0, {
      rootX: 1, rootY: 5.8, rootRot: .46, head: -.42,
      hipL: -.38, kneeL: -.8, hipR: .66, kneeR: -1.32, footR: .16, footL: -.05,
      shR: -.24, elR: -1.04, wrR: -.73, shL: .22, elL: -.95, wrL: -.25,
      pelvisYaw: .2, chestYaw: -.2,
    }, 'outQuad'),
    // THE SIT: one final compression beat — squash before the snap
    keyframe(.035, {
      rootX: .8, rootY: 6.1, rootRot: .5, spine: .07, head: -.46,
      hipL: -.4, kneeL: -.86, hipR: .68, kneeR: -1.4, footR: .16, footL: -.05,
      shR: -.26, elR: -1.08, wrR: -.75, shL: .2, elL: -1.0, wrL: -.25,
      pelvisYaw: .22, chestYaw: -.22,
    }, 'outQuad'),
    // DETONATION: legs fire — the body leaves before the steel (lag beat)
    keyframe(.08, {
      rootX: 3, rootY: 4.6, rootRot: .95, spine: .06, head: -.85,
      hipL: -.7, kneeL: -.55, footL: 0, hipR: .85, kneeR: -1.0, footR: .18,
      shR: -.2, elR: -.9, wrR: -.7, shL: .75, elL: -.9,
      pelvisYaw: .12, chestYaw: -.1,
    }, 'outQuad'),
    // THE CUT: the blade rips through the full horizontal arc — hips
    // unwind through the swing, arm at full extension (the smear apex)
    keyframe(.14, {
      rootX: 5.5, rootY: 4.2, rootRot: 1.1, spine: .1, head: -.8,
      hipL: -.9, kneeL: -.4, footL: .06, hipR: 1.0, kneeR: -1.3, footR: .2,
      shR: 1.5, elR: .15, wrR: .1, shL: .9, elL: -.6,
      pelvisYaw: -.18, chestYaw: .18,
    }, 'outQuart'),
    // CARRY: follow-through whips the blade past the plane; stride-flight
    keyframe(.21, {
      rootX: 8, rootY: 4.0, rootRot: 1.3, spine: .1, head: -.88,
      hipL: -1.0, kneeL: -.32, footL: .1, hipR: 1.12, kneeR: -1.5, footR: .22,
      shR: 1.6, elR: .35, wrR: -.75, shL: 1.0, elL: -.45,
      pelvisYaw: -.12, chestYaw: .1,
    }, 'outCubic'),
    // RIDE: blade extended, trailing the travel line through the pack
    keyframe(.3, {
      rootX: 7.6, rootY: 4.2, rootRot: 1.28, spine: .09, head: -.85,
      hipL: -.8, kneeL: -.5, footL: .08, hipR: 1.05, kneeR: -1.42, footR: .21,
      shR: 1.45, elR: .3, wrR: -.85, shL: .85, elL: -.55,
      pelvisYaw: -.06, chestYaw: .05,
    }, 'inOutSine'),
    // THE CATCH: the front leg reaches far ahead and plants the skid
    keyframe(.4, {
      rootX: 6, rootY: 5.2, rootRot: .6, spine: .05, head: -.5,
      hipL: -.55, kneeL: -1.0, footL: .08, hipR: 1.05, kneeR: -1.5, footR: .25,
      shR: .9, elR: -.1, wrR: -.9, shL: .55, elL: -.8,
      pelvisYaw: -.05, chestYaw: .02,
    }, 'outCubic'),
    // SKID ABSORB: weight sits back, the steel settles low
    keyframe(.52, {
      rootX: 3, rootY: 5.6, rootRot: .3, spine: .05, head: -.2,
      hipL: -.5, kneeL: -.9, footL: .1, hipR: .6, kneeR: -1.35, footR: .18,
      shR: .5, elR: -.4, wrR: -.6, shL: .4, elL: -.7, wrL: -.2,
      pelvisYaw: .02, chestYaw: 0,
    }, 'outQuad'),
    // ZANSHIN: the settle back to the middle guard
    keyframe(.64, GUARD, 'outQuad'),
    keyframe(.7, GUARD, 'inOutCubic'),
  ]),
  hit: { start: .1, end: .44, dmg: 38, stagger: .55, kb: 640, kbY: -70, hitstop: .11, shake: .38, heavy: true, breakGuard: true, multiHit: .13, pad: 10, corridorBack: 150, corridorFront: 88 },
  trail: { start: .07, end: .5 },
  swingSfx: { t: .1, name: 'swingHeavy' },
  cancel: .42,
  chain: ['l1', 'h1', 'launcher'],
  moveX: 240, moveXAt: .02, // assist only — the power-dash motor owns the drive
  grip: .35, // the iai draw rides one hand; the saya hand finished its ride
  zArc: .5,
  drawFlash: true, // the ignition light event when the draw detonates
  traj: { // DUAL-CHARGE PASS family: the deepest gather in the moveset — the
    // steel collects along the saya line, then rips through the whole depth
    // corridor as the body carries it across the pack
    a0: -3.1, a1: .2, y0: -.3, y1: .28, e0: .5, e1: .97, band: 52,
  },
}

/** CHARGED — OVERLOAD SLASH: element-charged kesa. Huge windup with the
 * blade thrown up-back over the shoulder, then a whipping diagonal. */
const charged: AttackDef = {
  id: 'charged', label: 'OVERLOAD SLASH', kind: 'charged', requires: 'ground',
  clip: makeClip('atk_charged', [
    keyframe(0, {
      rootRot: -0.35, spine: -0.12, head: 0.02, rootY: 2,
      hipR: -0.25, kneeR: -0.45, footR: 0.08,
      hipL: 0.3, kneeL: -0.4, footL: 0.1,
      shR: 2.8, elR: 0.2, wrR: 0.3, // blade thrown up-back, chest open
      shL: 1.9, elL: -0.5,
    }, 'outQuad'),
    // ignition: the whip starts
    keyframe(0.1, {
      rootRot: -0.1, rootY: 1,
      shR: 2.3, elR: 0.1, wrR: 0.2,
      shL: 1.5, elL: -0.6,
    }, 'outQuad'),
    keyframe(0.17, {
      rootRot: 0.55, spine: 0.22, head: -0.3, rootY: -1,
      hipR: 0.75, kneeR: -0.5, footR: 0.25,
      hipL: -0.65, kneeL: -0.3, footL: 0.2,
      shR: 1.15, elR: 0.0, wrR: -0.25, // massive diagonal through the kesa line
      shL: 0.4, elL: -1.25,
    }, 'outQuart'),
    keyframe(0.29, {
      rootRot: 0.5, spine: 0.18, head: -0.24, rootY: 0,
      shR: 0.95, elR: -0.3, wrR: -0.25, // follow low-left
      shL: 0.3, elL: -1.3,
    }, 'outCubic'),
    keyframe(0.66, GUARD, 'outQuad'),
    keyframe(0.74, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.15, end: 0.31, dmg: 46, stagger: 0.6, kb: 420, launch: -380, hitstop: 0.14, shake: 0.55, heavy: true, aoe: 150, breakGuard: true, pad: 12 },
  trail: { start: 0.11, end: 0.39 },
  swingSfx: { t: 0.13, name: 'swingHeavy' },
  cancel: 0.41,
  chain: [],
  moveX: 260, moveXAt: 0.1,
  grip: 1, // element-charged kesa — a full-body two-handed diagonal
  zArc: 0.75,
  traj: { // CHARGED family: the widest depth sweep in the moveset — the
    // blade gathers deep behind the body, then rips through the entire
    // depth corridor to the camera side
    a0: -1.75, a1: 0.7, y0: -0.5, y1: 0.5, e0: 0.45, e1: 0.95, band: 48,
  },
}

/** RIPOSTE — JUDGMENT CUT: the counter is a true iai nukitsuke. Perfect
 * stillness with the sword sheathed, then one horizontal draw-cut — and a
 * controlled re-sheath (noto) flourish as the body settles. */
const riposte: AttackDef = {
  id: 'riposte', label: 'JUDGMENT CUT', kind: 'riposte', requires: 'any',
  clip: makeClip('atk_riposte', [
    keyframe(0, {
      rootRot: 0.1, spine: 0.04, head: -0.08, rootY: 1,
      hipR: 0.3, kneeR: -0.55, footR: 0.12,
      hipL: -0.35, kneeL: -0.5, footL: 0.1,
      shR: 0.2, elR: -0.35, wrR: -0.55, // hand on the saya, blade sheathed
      shL: 0.35, elL: -0.6,
    }, 'outQuad'),
    keyframe(0.07, {
      rootRot: 0.06, rootY: 1.4,
      shR: 0.22, elR: -0.37, wrR: -0.6, // breath — stillness before the storm
      shL: 0.35, elL: -0.62,
    }, 'inOutSine'),
    // ignition: blade clears the saya mouth
    keyframe(0.11, {
      rootRot: 0.14, rootY: 0.8,
      shR: 0.6, elR: -0.2, wrR: 0.0,
      shL: 0.4, elL: -0.8,
    }, 'outQuad'),
    keyframe(0.15, {
      rootRot: 0.35, spine: 0.14, head: -0.18, rootY: -0.5,
      hipR: 0.55, kneeR: -0.45, footR: 0.12,
      hipL: -0.55, kneeL: -0.3,
      shR: 1.05, elR: 0.0, wrR: 0.55, // NU KITSUKE — the draw-cut rips out
      shL: 0.5, elL: -1.05,
    }, 'outExpo'),
    keyframe(0.23, {
      rootRot: 0.4, spine: 0.14, rootY: 0,
      shR: 1.25, elR: 0.15, wrR: 0.25, // follow-through, full extension
      shL: 0.45, elL: -1.15,
    }, 'outCubic'),
    keyframe(0.39, {
      rootRot: 0.12, spine: 0.04, rootY: 0.5,
      shR: 0.55, elR: -0.3, wrR: -0.85, // noto — sweeping back toward the saya
      shL: 0.4, elL: -0.7,
    }, 'outQuad'),
    keyframe(0.56, GUARD, 'outQuad'),
    keyframe(0.64, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.11, end: 0.24, dmg: 34, stagger: 0.55, kb: 380, hitstop: 0.12, shake: 0.42, heavy: true, breakGuard: true, pad: 8 },
  trail: { start: 0.1, end: 0.31 },
  swingSfx: { t: 0.1, name: 'swingHeavy' },
  cancel: 0.35,
  chain: [],
  moveX: 200, moveXAt: 0.1,
  grip: 0.5, // iai nukitsuke: draw one-handed, settle two-handed on noto
  zArc: 0.5, drawFlash: true,
  traj: { // IAI family (riposte): draw from the scabbard plane straight
    // through the throat line — deep-behind → camera-side exit
    a0: 2.25, a1: 0.0, y0: -0.6, y1: 0.4, e0: 0.5, e1: 0.9, band: 78,
  },
}

/* ------------------------------------------------------------------ */
/* AIR ATTACKS                                                         */
/* ------------------------------------------------------------------ */

const AIR_LEGS = {
  hipR: 0.5, kneeR: -1.2, footR: -0.05,
  hipL: -0.4, kneeL: -0.9, footL: 0.1,
}

/** A1 — AIR SLASH: descending kesa giri from above. */
const a1: AttackDef = {
  id: 'a1', label: 'AIR KESA', kind: 'air', requires: 'air',
  clip: makeClip('atk_a1', [
    keyframe(0, {
      ...AIR_LEGS, ...GUARD, rootY: 0,
      rootRot: -0.2, spine: -0.06, head: 0,
      shR: 2.0, elR: 0.25, wrR: 0.15, // high chamber — blade up-forward
      shL: 1.8, elL: -0.5,
    }, 'outQuad'),
    // ignition
    keyframe(0.05, {
      ...AIR_LEGS, rootRot: -0.05, rootY: -0.5,
      shR: 1.55, elR: 0.15, wrR: 0.4,
      shL: 1.2, elL: -0.7,
    }, 'outQuad'),
    keyframe(0.09, {
      ...AIR_LEGS, rootRot: 0.35, spine: 0.12, head: -0.16, rootY: -1,
      shR: 1.15, elR: 0.0, wrR: -0.25, // descending diagonal
      shL: 0.4, elL: -1.15,
    }, 'outQuart'),
    keyframe(0.17, {
      ...AIR_LEGS, rootRot: 0.4, rootY: 0,
      shR: 0.9, elR: -0.3, wrR: -0.3, // follow low
      shL: 0.3, elL: -1.25,
    }, 'outCubic'),
    keyframe(0.33, { ...AIR_LEGS }, 'outQuad'),
    keyframe(0.41, { ...AIR_LEGS }, 'outQuad'),
  ]),
  hit: { start: 0.07, end: 0.18, dmg: 9, stagger: 0.22, kb: 110, juggle: -420, hitstop: 0.045, shake: 0.1, heavy: false, pad: 5 },
  trail: { start: 0.06, end: 0.21 },
  swingSfx: { t: 0.06, name: 'swing' },
  cancel: 0.21,
  chain: ['a2', 'a3', 'dive', 'slam'],
  float: 0.42,
  grip: 0.9,
  zArc: 0.45,
  traj: { // AIR DIAGONAL family: descends through a depth-tilted plane
    a0: -0.85, a1: 0.7, y0: -0.3, y1: 0.25, e0: 0.55, e1: 0.9, band: 48,
  },
}

/** A2 — AIR REVERSE: rising gyaku kesa — the follow-up rising diagonal. */
const a2: AttackDef = {
  id: 'a2', label: 'AIR GYAKU KESA', kind: 'air', requires: 'air',
  clip: makeClip('atk_a2', [
    keyframe(0, {
      ...AIR_LEGS, ...GUARD, rootY: 0,
      rootRot: 0.3, spine: 0.1, head: -0.12,
      shR: 0.35, elR: -0.3, wrR: 0.85, // loaded low
      shL: 0.45, elL: -1.0,
    }, 'outQuad'),
    // ignition
    keyframe(0.05, {
      ...AIR_LEGS, rootRot: 0.12, rootY: -0.5,
      shR: 1.05, elR: 0.15, wrR: 0.4,
      shL: 0.35, elL: -1.2,
    }, 'outQuad'),
    keyframe(0.09, {
      ...AIR_LEGS, rootRot: -0.15, spine: -0.05, head: -0.22, rootY: -1.5,
      shR: 1.75, elR: 0.55, wrR: -0.1, // ripping up the reverse diagonal
      shL: 0.25, elL: -1.35,
    }, 'outQuart'),
    keyframe(0.17, {
      ...AIR_LEGS, rootRot: -0.18, rootY: -2,
      shR: 2.1, elR: 0.55, wrR: -0.05, // follow high
      shL: 0.2, elL: -1.4,
    }, 'outCubic'),
    keyframe(0.33, { ...AIR_LEGS }, 'outQuad'),
    keyframe(0.41, { ...AIR_LEGS }, 'outQuad'),
  ]),
  hit: { start: 0.07, end: 0.18, dmg: 9.5, stagger: 0.24, kb: 130, juggle: -460, hitstop: 0.05, shake: 0.12, heavy: false, pad: 5 },
  trail: { start: 0.06, end: 0.21 },
  swingSfx: { t: 0.055, name: 'swing' },
  cancel: 0.21,
  chain: ['a3', 'dive', 'slam'],
  float: 0.42,
  grip: 0.9,
  zArc: 0.45,
  traj: { // AIR RISING DIAGONAL family: reverse plane crossing while airborne
    a0: 0.7, a1: -0.75, y0: 0.25, y1: -0.2, e0: 0.5, e1: 0.88, band: 48,
  },
}

/** A3 — AIR YOKO: level horizontal sweep with a counter-pass — no aerial
 * 360 tumble; the hips drive a ~200° arc and saw back. */
const a3: AttackDef = {
  id: 'a3', label: 'AIR YOKO', kind: 'spin', requires: 'air',
  clip: makeClip('atk_a3', [
    keyframe(0, {
      ...AIR_LEGS, ...GUARD, rootY: 0,
      rootRot: -0.1, spine: -0.03,
      shR: -0.1, elR: -0.45, wrR: -0.55, // chambered back
      shL: 0.2, elL: -0.9,
    }, 'outQuad'),
    // ignition
    keyframe(0.05, {
      ...AIR_LEGS, rootRot: 0.05, rootY: -0.5,
      shR: 0.45, elR: -0.1, wrR: 0.25,
      shL: 0.3, elL: -1.0,
    }, 'outQuad'),
    keyframe(0.1, {
      ...AIR_LEGS, rootRot: 0.25, spine: 0.1, head: -0.16, rootY: -1,
      shR: 1.05, elR: 0.2, wrR: 0.3, // level sweep
      shL: 0.35, elL: -1.1,
    }, 'outQuart'),
    keyframe(0.21, {
      ...AIR_LEGS, rootRot: 0.3, rootY: -1.5,
      shR: 1.4, elR: 0.15, wrR: -0.55, // arc settles forward-low
      shL: 0.25, elL: -1.2,
    }, 'outCubic'),
    keyframe(0.35, {
      ...AIR_LEGS, rootRot: 0.2, rootY: -1,
      shR: 0.5, elR: 0.1, wrR: 0.97, // counter-pass (level sawing pull-back)
      shL: 0.4, elL: -1.05,
    }, 'outCubic'),
    keyframe(0.49, { ...AIR_LEGS }, 'outQuad'),
    keyframe(0.57, { ...AIR_LEGS }, 'outQuad'),
  ]),
  hit: { start: 0.08, end: 0.37, dmg: 6, stagger: 0.16, kb: 150, juggle: -400, hitstop: 0.03, shake: 0.08, heavy: false, multiHit: 0.1, pad: 6 },
  trail: { start: 0.07, end: 0.39 },
  swingSfx: { t: 0.07, name: 'swing' },
  cancel: 0.31,
  chain: ['dive', 'slam', 'a1', 'srMeteor'],
  float: 0.34,
  grip: 0.8,
  zArc: 0.5,
  traj: { // AIR HORIZONTAL family: wide depth arc while airborne
    a0: 2.6, a1: 0.05, y0: -0.7, y1: 0.6, e0: 0.5, e1: 0.9, band: 48,
  },
}

/** DIVE — Falcon Dive: blade-first diagonal plunge, tip locked on the
 * falling diagonal line. */
const dive: AttackDef = {
  id: 'dive', label: 'FALCON DIVE', kind: 'air', requires: 'air',
  clip: makeClip('atk_dive', [
    keyframe(0, {
      rootRot: 0.35, spine: 0.1, head: -0.12, rootY: -2,
      hipR: 0.6, kneeR: -1.3, footR: -0.1,
      hipL: 0.4, kneeL: -1.1, footL: 0.1,
      shR: 2.0, elR: 0.25, wrR: 0.15, // raised — blade up-forward
      shL: 1.2, elL: -0.5,
    }, 'outQuad'),
    // ignition: flipping over into the plunge
    keyframe(0.06, {
      rootRot: 0.55, rootY: 0,
      hipR: 0.45, kneeR: -1.1, footR: -0.1,
      hipL: 0.3, kneeL: -0.9, footL: 0.08,
      shR: 1.6, elR: 0.05, wrR: -0.1,
      shL: 0.5, elL: -0.45,
    }, 'outQuad'),
    keyframe(0.12, {
      rootRot: 0.72, spine: 0.2, head: -0.3, rootY: 2,
      hipR: -0.6, kneeR: -0.4, footR: -0.15,
      hipL: -0.45, kneeL: -0.35, footL: 0.1,
      shR: 1.2, elR: -0.2, wrR: -0.4, // tip locked down-forward
      shL: -0.4, elL: -0.4,
    }, 'outCubic'),
    keyframe(0.5, {
      rootRot: 0.75, rootY: 2,
      shR: 1.2, elR: -0.2, wrR: -0.4,
    }, 'outQuad'),
    keyframe(0.62, { ...GUARD }, 'outQuad'),
  ]),
  hit: { start: 0.1, end: 0.5, dmg: 7, stagger: 0.16, kb: 80, juggle: -260, hitstop: 0.035, shake: 0.09, heavy: false, multiHit: 0.13, pad: 6 },
  trail: { start: 0.08, end: 0.52 },
  swingSfx: { t: 0.09, name: 'swing' },
  cancel: 0.2,
  chain: ['srMeteor'],
  moveY: 620, moveYAt: 0.08,
  moveX: 260, moveXAt: 0.08,
  float: 0.9,
  slamImpact: { r: 80, dmg: 12, launch: -160 },
  grip: 0.6,
  zArc: 0.6,
  traj: { // DIVE family: tip locked down-forward through the plunge
    a0: 0.6, a1: 1.05, y0: 0, y1: 0.1, e0: 0.6, e1: 0.95, band: 48,
  },
}

/** SLAM — Meteor Fall: vertical plunging kiri — the blade points at the
 * floor and the body pitches over it. */
const slam: AttackDef = {
  id: 'slam', label: 'METEOR FALL', kind: 'slam', requires: 'air',
  clip: makeClip('atk_slam', [
    keyframe(0, {
      rootRot: 0.3, spine: 0.08, head: -0.1, rootY: -3,
      hipR: 0.7, kneeR: -1.4, footR: -0.1,
      hipL: 0.5, kneeL: -1.2, footL: 0.1,
      shR: 2.75, elR: 0.15, wrR: 0.1, // blade up
      shL: 2.0, elL: -0.45,
    }, 'outQuad'),
    // ignition: pitching over the blade
    keyframe(0.07, {
      rootRot: 0.55, rootY: -1,
      hipR: 0.3, kneeR: -1.3, footR: -0.15,
      hipL: 0.4, kneeL: -1.1, footL: 0.05,
      shR: 2.1, elR: 0.05, wrR: 0.2,
      shL: 0.8, elL: -0.5,
    }, 'outQuad'),
    keyframe(0.15, {
      rootRot: 0.85, spine: 0.24, head: -0.34, rootY: 2,
      hipR: -0.9, kneeR: -0.4, footR: -0.2,
      hipL: -0.7, kneeL: -0.5, footL: 0.1,
      shR: 1.1, elR: -0.4, wrR: -0.5, // blade driven at the floor
      shL: -0.5, elL: -0.3,
    }, 'outCubic'),
    keyframe(0.45, {
      rootRot: 0.88, rootY: 2,
      shR: 1.1, elR: -0.4, wrR: -0.5,
    }, 'outQuad'),
    keyframe(0.56, {
      rootRot: 0.7, rootY: 6, spine: 0.2, head: -0.26,
      hipR: 0.65, kneeR: -1.3, footR: 0.25,
      hipL: -0.55, kneeL: -1.2, footL: 0.2,
      shR: 1.05, elR: -0.4, wrR: -0.5, // impact crouch, blade buried low
      shL: 0.3, elL: -0.6,
    }, 'outQuart'),
    keyframe(0.78, GUARD, 'outQuad'),
    keyframe(0.86, GUARD, 'inOutCubic'),
  ]),
  hit: { start: 0.14, end: 0.5, dmg: 10, stagger: 0.2, kb: 60, juggle: -180, hitstop: 0.04, shake: 0.12, heavy: false, multiHit: 0.16, pad: 6 },
  trail: { start: 0.12, end: 0.55 },
  swingSfx: { t: 0.12, name: 'swingHeavy' },
  cancel: 0.3,
  chain: [],
  moveY: 1050, moveYAt: 0.1,
  slamImpact: { r: 145, dmg: 26, launch: -300 },
  grip: 1,
  zArc: 0.7,
  traj: { // METEOR family: blade pointed at the floor, body pitched over
    a0: -1.45, a1: 1.4, y0: -0.1, y1: 0.18, e0: 0.5, e1: 0.9, band: 14,
  },
}

/* ------------------------------------------------------------------ */

export const ATTACKS: Record<string, AttackDef> = {
  l1, l2, l3, l4, l5, retreat, spin, stabs,
  h1, h2, h3, launcher,
  dashSlash, dashHeavy, powerArc, powerSlash, charged, riposte,
  a1, a2, a3, dive, slam,
  /* empty-hand command moves — selected ONLY while sheathed
   * (see Player.pickHeavy / Player.pickLight air branch) */
  axeKick: MOVES.axeKick,
  spinHook: MOVES.spinHook,
  stepKick: MOVES.stepKick,
  airTwist: MOVES.airTwist,
  airElbow: MOVES.airElbow,
  ultPalm: UNARMED_ULT,
  /* sheathed power-dash strikes — fired by the dual-hold release
   * (dash hold + heavy hold, both released) with the blade sheathed;
   * alternate punch ↔ kick per armed use (Player.firePowerDashSlash) */
  powerPunch: MOVES.powerPunch,
  powerKick: MOVES.powerKick,
  /* THE SAKUGA SET — the Dark Lord study transcribed 1:1 (clips in
   * combat/sakuga.ts); reached through the empty-hand chain graph */
  sakugaJabCross: MOVES.sakugaJabCross,
  sakugaBarrage: MOVES.sakugaBarrage,
  sakugaDragon: MOVES.sakugaDragon,
  sakugaHammer: MOVES.sakugaHammer,
  sakugaScorpion: MOVES.sakugaScorpion,
  sakugaWrath: MOVES.sakugaWrath,
  /* THE KINETIC-CHAIN SET — the five empty-hand techniques authored to the
   * reference studio's proximal-to-distal beat law (clips in moveset.ts).
   * Chosen by the COMBO DIRECTOR (combat/combo-director.ts) over the
   * authored chain graph; sheathed only. */
  viperPalm: MOVES.viperPalm,
  avalancheElbow: MOVES.avalancheElbow,
  cyclone: MOVES.cyclone,
  ironRoot: MOVES.ironRoot,
  omegaPalm: MOVES.omegaPalm,
  /* THE SHADOW RONIN SET — the dual-blade study transcribed 1:1 (clips in
   * combat/ronin-sakuga.ts); cinematic finisher tier for BOTH stances
   * (empty-hand variants live in MOVES — unarmedAttack swaps by id) */
  ...RONIN_ATTACKS,
}

export function getAttack(id: string): AttackDef | undefined {
  return ATTACKS[id]
}

/** Runtime info passed to the world when a blade connects. */
export interface AttackRuntimeInfo {
  unarmed?:boolean
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
    unarmed:!!def.strikeHand,
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
