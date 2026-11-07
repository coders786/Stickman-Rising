/** STICKMAN RISING — locomotion & reaction animation clips (keyframed).
 *
 * All poses are authored around the chūdan-no-kamae guard (NEUTRAL in
 * pose.ts): unspecified channels default INTO the guard, so every clip
 * blends guard→guard — the in-between continuity contract.
 *
 * LOCOMOTION LIBRARY — six genuinely distinct movement systems (each
 * authored from gait-cycle reference: contact / loading / passing /
 * push-off / flight phases per Williams' Animator's Survival Kit, with
 * stride, cadence, lean, COG height, knee-drive and arm mechanics that
 * differ per style — never a playback-rate rescale of one cycle):
 *
 *   WALK     relaxed civilian carry: upright, double-support stance,
 *            heel-to-toe roll, modest stride, sword hanging low
 *   RUN      5-phase gait, flight phase, counter arm pump, sword trail
 *   SPRINT   explosive: aggressive lean, deep COG, heel-to-butt recovery,
 *            knee punch-through, big arm drive, sword tucked back
 *   COMBAT   low quick shuffle, knees always flexed, live chūdan guard
 *   BACKPEDAL guarded retreat: toe-first back-steps, COG back, guard up
 *   BRAKE    one-shot hard stop: lean-back brace, dust, settle to guard
 */

import { keyframe, makeClip, Clip } from './animator'
import { PoseInput } from './pose'

/** swaps left/right LEG channels only — the arms keep their authored
 * channels (the sword stays in the right hand across both strides). */
function mirrorLegs(src: PoseInput): PoseInput {
  const out: PoseInput = { ...src }
  const pairs: [keyof PoseInput, keyof PoseInput][] = [
    ['hipL', 'hipR'], ['kneeL', 'kneeR'], ['footL', 'footR'],
  ]
  for (const [l, r] of pairs) {
    const lv = src[l]
    const rv = src[r]
    if (lv !== undefined) out[r] = lv
    if (rv !== undefined) out[l] = rv
  }
  return out
}

/** STRIDE MIRROR for bipedal cycles: legs swap, the SWORD ARM (right)
 * keeps the exact same carry across both strides (a held weapon does not
 * teleport between arms / change carry mid-cycle), and the off-arm
 * negates its swing so the contralateral counter-phase survives. */
function mirrorStride(src: PoseInput): PoseInput {
  const out = mirrorLegs(src)
  if (src.shL !== undefined) out.shL = -src.shL
  return out
}

/* ------------------------------- IDLE ------------------------------- */

/* Chūdan breathing: the sword hand drifts with the breath cycle, the off
 * hand hovers near the tsuka, weight settles between the feet. The blade
 * stays trained on the enemy's throat — a live guard, never frozen. */
export const IDLE_CLIP: Clip = makeClip('idle', [
  keyframe(0, {}, 'inOutCubic'),
  keyframe(1.25, {
    rootY: -1.7, rootRot: 0.09, spine: 0.07, head: -0.12,
    shR: 0.88, elR: -0.46, wrR: 1.1,
    shL: 0.52, elL: -0.82, wrL: -0.28,
    hipR: 0.34, hipL: -0.31,
  }, 'inOutCubic'),
  keyframe(1.8, {
    rootY: -1.6, rootRot: 0.085, spine: 0.065, head: -0.11,
    shR: 0.87, elR: -0.47, wrR: 1.12,
    shL: 0.51, elL: -0.83, wrL: -0.29,
    hipR: 0.33, hipL: -0.31,
  }, 'inOutCubic'),
  keyframe(2.6, {
    rootY: -0.9, rootRot: 0.095, spine: 0.05, head: -0.09,
    shR: 0.83, elR: -0.51, wrR: 1.19,
    shL: 0.49, elL: -0.86, wrL: -0.31,
    hipR: 0.32, hipL: -0.3,
  }, 'inOutSine'),
  keyframe(3.6, {}, 'inOutSine'),
], true)

/* ------------------------------- WALK -------------------------------- */

/* Relaxed open-space walking (Condition A): upright posture, ~2 steps/s,
 * DOUBLE-SUPPORT stance (both feet grounded between strides — the walk
 * signature no other gait has), heel-to-toe roll, small stride, pelvis
 * settling over the support leg, arms swinging low and easy. The katana
 * carries in a steep down-BACK diagonal (wrR ≡ −0.95 mod 2π → blade ≈ 138°:
 * hand forward at the hip, kissaki sweeping behind the heel — the only
 * down-pointing orientation where a 56-unit blade clears the ground plane
 * from a hip-level hand).
 *
 * WINDING CONVENTION: locomotion carries are authored UP-WOUND (wrR + 2π
 * where needed) so every carry-to-carry crossfade sweeps the blade through
 * the UP hemisphere — never through straight-down, which would drive the
 * kissaki through the floor for ~10 blend frames. */
const WALK_Q: PoseInput[] = [
  { // CONTACT-R — right heel strikes forward; left toe still planted
    rootRot: 0.07, rootY: 0.5, spine: 0.04, head: -0.08,
    hipR: 0.34, kneeR: -0.06, footR: 0.12,
    hipL: -0.26, kneeL: -0.34, footL: -0.04,
    shR: 0.55, elR: -0.45, wrR: 5.33,
    shL: -0.28, elL: -0.38,
  },
  { // LOAD-R — weight accepts onto the bending right leg (double support)
    rootRot: 0.085, rootY: 1.1, spine: 0.05, head: -0.09,
    hipR: 0.14, kneeR: -0.32, footR: 0.08,
    hipL: -0.3, kneeL: -0.44, footL: -0.06,
    shR: 0.57, elR: -0.45, wrR: 5.36,
    shL: -0.05, elL: -0.42,
  },
  { // PASSING — left knee lifts through; right leg extends under the hip
    rootRot: 0.075, rootY: 0.8, spine: 0.045, head: -0.08,
    hipR: -0.08, kneeR: -0.12, footR: 0.06,
    hipL: 0.12, kneeL: -0.62, footL: 0.1,
    shR: 0.53, elR: -0.44, wrR: 5.3,
    shL: 0.22, elL: -0.5,
  },
  { // TOE-OFF-R — right calf pushes; left reaches for its contact
    rootRot: 0.08, rootY: 1.0, spine: 0.05, head: -0.09,
    hipR: -0.3, kneeR: -0.3, footR: -0.14,
    hipL: 0.3, kneeL: -0.12, footL: 0.12,
    shR: 0.5, elR: -0.42, wrR: 5.28,
    shL: 0.3, elL: -0.44,
  },
]

const WALK_DUR = 1.0
export const WALK_CLIP: Clip = makeClip('walk', [
  keyframe(0, WALK_Q[0], 'outQuad'),
  keyframe(WALK_DUR * 0.12, WALK_Q[1], 'inOutCubic'),
  keyframe(WALK_DUR * 0.26, WALK_Q[2], 'inOutCubic'),
  keyframe(WALK_DUR * 0.4, WALK_Q[3], 'inOutSine'),
  keyframe(WALK_DUR * 0.5, mirrorStride(WALK_Q[0]), 'inQuad'),
  keyframe(WALK_DUR * 0.62, mirrorStride(WALK_Q[1]), 'inOutCubic'),
  keyframe(WALK_DUR * 0.76, mirrorStride(WALK_Q[2]), 'inOutCubic'),
  keyframe(WALK_DUR * 0.9, mirrorStride(WALK_Q[3]), 'inOutSine'),
  keyframe(WALK_DUR, WALK_Q[0], 'inOutCubic'),
], true)

/* ------------------------------- RUN -------------------------------- */

/* Five-phase gait (Williams, Animator's Survival Kit): CONTACT → LOADING
 * (absorb) → PUSH-OFF → FLIGHT → REACH, mirrored per stride. Every span is
 * eased — never linear: the fall INTO contact accelerates (inQuad), the
 * absorb decelerates (outQuad), the drive is smooth (inOutSine), the launch
 * explodes (outCubic). The hip bob is authored SMALL because the foot-ground
 * lock in player.ts derives hip height from the planted leg — real weight
 * transfer instead of a painted bob. Off-arm pumps in counter-phase (the
 * stride mirror negates it); the sword trails in a deep down-back diagonal
 * (wrR ≡ −0.25 mod 2π → blade ≈ 144°: kissaki sweeping well behind the
 * heel, clearing the ground by ~15 local units even with the wrist-lag
 * sway — up-wound per the clips.ts winding convention). */
const RUN_Q: PoseInput[] = [
  { // CONTACT — lead heel strikes FAR forward, trail toe still down
    rootX: 0, rootY: 0.6, rootRot: 0.34, spine: 0.05, head: -0.19,
    hipR: 0.88, kneeR: -0.08, footR: 0.24,
    hipL: -0.8, kneeL: -0.62, footL: -0.06,
    shR: 0.3, elR: -1.0, wrR: 6.03,
    shL: 0.7, elL: -1.05, wrL: -0.24,
  },
  { // LOADING — weight absorbs over the bending lead leg, big stride split
    rootX: 0, rootY: 2.2, rootRot: 0.37, spine: 0.075, head: -0.26,
    hipR: 0.5, kneeR: -0.72, footR: 0.06,
    hipL: -0.95, kneeL: -0.3, footL: 0.02,
    shR: 0.55, elR: -1.05, wrR: 6.0,
    shL: 0.32, elL: -1.0, wrL: -0.2,
  },
  { // PUSH-OFF — lead leg drives back hard, trail knee punches through high
    rootX: 0, rootY: 1.0, rootRot: 0.34, spine: 0.09, head: -0.3,
    hipR: -0.3, kneeR: -0.38, footR: -0.1,
    hipL: 0.52, kneeL: -1.32, footL: 0.2,
    shR: 0.72, elR: -0.95, wrR: 6.06,
    shL: 0.08, elL: -0.95, wrL: -0.16,
  },
]

const RUN_DUR = 0.5
const runFrames = [
  // stride A — right leg contact (0.0) → absorb (13%) → push (30%) → flight (50%)
  keyframe(0, RUN_Q[0], 'inQuad'),               // fall into contact
  keyframe(RUN_DUR * 0.13, RUN_Q[1], 'outQuad'), // absorb
  keyframe(RUN_DUR * 0.3, RUN_Q[2], 'inOutSine'), // drive
  // stride B — left leg contact: legs mirrored, off-arm counter-negated,
  // sword arm keeps the SAME carry (a held weapon never swaps arms)
  keyframe(RUN_DUR * 0.5, mirrorStride(RUN_Q[0]), 'outCubic'), // launch/reach
  keyframe(RUN_DUR * 0.63, mirrorStride(RUN_Q[1]), 'inQuad'),
  keyframe(RUN_DUR * 0.8, mirrorStride(RUN_Q[2]), 'outQuad'),
  keyframe(RUN_DUR, RUN_Q[0], 'inOutSine'),
]

export const RUN_CLIP: Clip = makeClip('run', runFrames, true)

/* ------------------------------- SPRINT ------------------------------ */

/* Condition C — maximum-effort sprint. NOT a faster run: a different
 * mechanical system entirely (acceptance-review rework):
 *  · torso pitch ~30° (rootRot ≈ 0.52) — visibly deeper than the run's 0.3
 *  · COG swings 1.8 → 4.8 local (lowest at load absorb) — dropped hips
 *  · HEEL-TO-BUTT recovery: the swing shin folds past −1.6 rad under a
 *    back-swing thigh — the heel physically approaches the glutes
 *  · KNEE PUNCH-THROUGH: hip swings to 1.3 rad (74°, thigh nearly
 *    horizontal) before the next overstriding toe-up contact
 *  · big bent-elbow arm drive, katana tucked back (sum ≈ 0.4 — the MGR
 *    Raiden sprint carry). Cadence ≈ 5.5 steps/s. */
const SPRINT_Q: PoseInput[] = [
  { // CONTACT — right foot strikes FAR forward, toe UP (dorsiflexed)
    rootRot: 0.52, rootY: 2.6, spine: 0.11, head: -0.5,
    hipR: 1.18, kneeR: -0.08, footR: 0.34,
    hipL: -0.95, kneeL: -0.45, footL: -0.12,
    shR: -0.42, elR: -0.7, wrR: 2.05,
    shL: 1.05, elL: -1.15,
  },
  { // SCISSOR — weight absorbs (COG LOWEST); trail heel kicks INTO the butt
    rootRot: 0.55, rootY: 4.8, spine: 0.12, head: -0.52,
    hipR: 0.22, kneeR: -1.05, footR: 0.06,
    hipL: -0.85, kneeL: -1.7, footL: 0.3,
    shR: -0.3, elR: -0.6, wrR: 2.0,
    shL: 0.7, elL: -1.05,
  },
  { // TOE-OFF — full hip extension behind; left knee PUNCHES through HIGH
    rootRot: 0.52, rootY: 3.0, spine: 0.11, head: -0.5,
    hipR: -0.72, kneeR: -0.4, footR: -0.18,
    hipL: 1.38, kneeL: -1.15, footL: 0.12,
    shR: -0.26, elR: -0.55, wrR: 2.04,
    shL: 0.34, elL: -0.95,
  },
  { // FLIGHT — right leg recovery-curls; left reaches for the next strike
    rootRot: 0.48, rootY: 1.8, spine: 0.1, head: -0.46,
    hipR: -0.35, kneeR: -1.15, footR: -0.06,
    hipL: 1.05, kneeL: -0.75, footL: 0.32,
    shR: -0.36, elR: -0.66, wrR: 2.02,
    shL: 0.88, elL: -1.1,
  },
]

const SPRINT_DUR = 0.36
const SPH = SPRINT_DUR / 2 // one stride
export const SPRINT_CLIP: Clip = makeClip('sprint', [
  // stride A — right contact → scissor → toe-off → flight
  keyframe(0, SPRINT_Q[0], 'inQuad'),
  keyframe(SPH * 0.28, SPRINT_Q[1], 'outQuad'),
  keyframe(SPH * 0.5, SPRINT_Q[2], 'inOutSine'),
  keyframe(SPH * 0.78, SPRINT_Q[3], 'outCubic'),
  // stride B — left contact (mirrored legs + counter-negated off-arm pump,
  // same tucked sword carry)
  keyframe(SPH, mirrorStride(SPRINT_Q[0]), 'inQuad'),
  keyframe(SPH + SPH * 0.28, mirrorStride(SPRINT_Q[1]), 'outQuad'),
  keyframe(SPH + SPH * 0.5, mirrorStride(SPRINT_Q[2]), 'inOutSine'),
  keyframe(SPH + SPH * 0.78, mirrorStride(SPRINT_Q[3]), 'outCubic'),
  keyframe(SPRINT_DUR, SPRINT_Q[0], 'inOutSine'),
], true)

/* ------------------------------- COMBAT STEP ------------------------- */

/* Condition B — combat-ready shuffle while enemies are near. COG lowered
 * (rootY ≈ 3.6), knees always flexed, torso coiled over the hips, short
 * quick steps (no flight phase), and the blade NEVER leaves the chūdan
 * guard: it stays level at the enemy's throat through the entire cycle.
 * The off-hand balances forward. This is how you circle a threat. */
const COMBAT_Q: PoseInput[] = [
  { // STEP-R — right foot plants forward under the guard
    rootRot: 0.18, rootY: 3.4, spine: 0.08, head: -0.14,
    hipR: 0.48, kneeR: -0.6, footR: 0.18,
    hipL: -0.38, kneeL: -0.52, footL: 0.12,
    shR: 0.8, elR: -0.5, wrR: 1.1,
    shL: 0.55, elL: -0.55, wrL: -0.3,
  },
  { // PASS — feet pass close under the hips, quick weight transfer
    rootRot: 0.19, rootY: 3.8, spine: 0.085, head: -0.14,
    hipR: 0.3, kneeR: -0.75, footR: 0.1,
    hipL: -0.1, kneeL: -0.7, footL: 0.1,
    shR: 0.82, elR: -0.5, wrR: 1.12,
    shL: 0.5, elL: -0.6, wrL: -0.28,
  },
]

const COMBAT_DUR = 0.44
export const COMBAT_STEP_CLIP: Clip = makeClip('combatStep', [
  keyframe(0, COMBAT_Q[0], 'inOutCubic'),
  keyframe(COMBAT_DUR * 0.28, COMBAT_Q[1], 'inOutSine'),
  keyframe(COMBAT_DUR * 0.55, mirrorLegs(COMBAT_Q[0]), 'inOutCubic'),
  keyframe(COMBAT_DUR * 0.83, mirrorLegs(COMBAT_Q[1]), 'inOutSine'),
  keyframe(COMBAT_DUR, COMBAT_Q[0], 'inOutCubic'),
], true)

/* ------------------------------- BACKPEDAL --------------------------- */

/* Guarded retreat — moving backward while still facing the threat. Legs
 * reach BACK toe-first (hip negative = leg back), knees stay bent and
 * loaded, COG sits back slightly (rootRot ≈ −0.05) but the guard NEVER
 * drops. Short quick steps, ~3.5 steps/s. */
const BACK_Q: PoseInput[] = [
  { // TOE-CONTACT-R — right toe reaches back, heel high
    rootRot: -0.05, rootY: 2.6, spine: 0.02, head: -0.05,
    hipR: -0.5, kneeR: -0.55, footR: 0.25,
    hipL: 0.3, kneeL: -0.5, footL: 0.1,
    shR: 0.85, elR: -0.5, wrR: 1.05,
    shL: 0.5, elL: -0.6, wrL: -0.3,
  },
  { // LOAD — weight accepts onto the rear leg, front foot lightens
    rootRot: -0.04, rootY: 3.0, spine: 0.025, head: -0.06,
    hipR: -0.25, kneeR: -0.8, footR: 0.12,
    hipL: 0.1, kneeL: -0.75, footL: 0.08,
    shR: 0.83, elR: -0.52, wrR: 1.08,
    shL: 0.48, elL: -0.62, wrL: -0.28,
  },
]

const BACK_DUR = 0.56
export const BACKPEDAL_CLIP: Clip = makeClip('backpedal', [
  keyframe(0, BACK_Q[0], 'inOutCubic'),
  keyframe(BACK_DUR * 0.25, BACK_Q[1], 'inOutSine'),
  keyframe(BACK_DUR * 0.55, mirrorLegs(BACK_Q[0]), 'inOutCubic'),
  keyframe(BACK_DUR * 0.8, mirrorLegs(BACK_Q[1]), 'inOutSine'),
  keyframe(BACK_DUR, BACK_Q[0], 'inOutCubic'),
], true)

/* ------------------------------- BRAKE ------------------------------- */

/* One-shot hard stop from sprint/run (input reversal or release at speed):
 * the body pitches BACK over the braking leg, arms fly up for balance,
 * the sword swings up to counter the momentum — then settles into the
 * guard. Dust + skid FX fire from player.ts on the same trigger. */
export const BRAKE_CLIP: Clip = makeClip('brake', [
  keyframe(0, {
    rootRot: -0.18, rootY: 4.5, spine: -0.02, head: 0.1,
    hipR: 0.55, kneeR: -0.85, footR: 0.3,
    hipL: -0.35, kneeL: -0.6, footL: -0.05,
    shR: 0.5, elR: -0.6, wrR: 1.3,
    shL: 1.0, elL: -0.9,
  }, 'outQuad'),
  keyframe(0.12, {
    rootRot: 0.02, rootY: 3.4, spine: 0.03, head: -0.05,
    hipR: 0.4, kneeR: -0.7, footR: 0.2,
    hipL: -0.3, kneeL: -0.55, footL: 0.05,
    shR: 0.7, elR: -0.55, wrR: 1.2,
    shL: 0.7, elL: -0.7,
  }, 'inOutCubic'),
  keyframe(0.24, {
    rootRot: 0.1, rootY: 2.5, spine: 0.05, head: -0.1,
    hipR: 0.3, kneeR: -0.5, footR: 0.12,
    hipL: -0.28, kneeL: -0.45, footL: 0.1,
    shR: 0.8, elR: -0.5, wrR: 1.15,
    shL: 0.5, elL: -0.8,
  }, 'outCubic'),
])

/* ------------------------------- JUMP / FALL / LAND ---------------- */

export const JUMP_CLIP: Clip = makeClip('jump', [
  keyframe(0, {
    rootRot: 0.2, rootY: 2,
    hipR: 0.5, kneeR: -1.0, footR: 0.15,
    hipL: -0.3, kneeL: -0.9, footL: 0.1,
    shR: 0.7, elR: -0.55, wrR: 1.3,
    shL: -0.2, elL: -0.5,
  }, 'outQuad'),
  keyframe(0.12, {
    rootRot: 0.24, rootY: -3,
    hipR: -0.35, kneeR: -0.5, footR: -0.2,
    hipL: 0.4, kneeL: -0.35, footL: 0.3,
    shR: 1.15, elR: -0.4, wrR: 0.7,
    shL: 0.6, elL: -0.45,
  }, 'outCubic'),
  keyframe(0.4, {
    rootRot: 0.15, rootY: -2,
    hipR: -0.5, kneeR: -0.65, footR: -0.15,
    hipL: 0.45, kneeL: -0.55, footL: 0.2,
    shR: 0.75, elR: -0.5, wrR: 1.1,
    shL: 0.3, elL: -0.5,
  }, 'inOutCubic'),
])

export const FALL_CLIP: Clip = makeClip('fall', [
  keyframe(0, {
    rootRot: 0.1, spine: 0.08, head: -0.12, rootY: -2,
    hipR: -0.45, kneeR: -0.6, footR: -0.15,
    hipL: 0.4, kneeL: -0.5, footL: 0.25,
    shR: 0.6, elR: -0.55, wrR: 1.25,
    shL: 0.3, elL: -0.5, wrL: -0.4,
  }, 'inOutCubic'),
  keyframe(0.45, {
    rootRot: 0.12, spine: 0.08, head: -0.14, rootY: -3.4,
    hipR: -0.5, kneeR: -0.5, footR: -0.12,
    hipL: 0.45, kneeL: -0.65, footL: 0.22,
    shR: 0.65, elR: -0.6, wrR: 1.2,
    shL: 0.4, elL: -0.45, wrL: -0.35,
  }, 'inOutCubic'),
  keyframe(0.9, {
    rootRot: 0.1, spine: 0.08, head: -0.12, rootY: -2,
    hipR: -0.45, kneeR: -0.6, footR: -0.15,
    hipL: 0.4, kneeL: -0.5, footL: 0.25,
    shR: 0.6, elR: -0.55, wrR: 1.25,
    shL: 0.3, elL: -0.5, wrL: -0.4,
  }, 'inOutCubic'),
], true)

export const LAND_CLIP: Clip = makeClip('land', [
  keyframe(0, {
    rootY: 7, rootRot: 0.38, spine: 0.12, head: -0.2,
    hipR: 0.6, kneeR: -1.35, footR: 0.25,
    hipL: -0.5, kneeL: -1.25, footL: 0.2,
    shR: 0.4, elR: -0.7, wrR: 1.45,
    shL: 0.5, elL: -0.8,
  }, 'outQuad'),
  keyframe(0.26, {
    rootY: 1.5, rootRot: 0.16, spine: 0.05, head: -0.1,
    hipR: 0.35, kneeR: -0.5, footR: 0.12,
    hipL: -0.3, kneeL: -0.45, footL: 0.1,
    shR: 0.75, elR: -0.55, wrR: 1.2,
    shL: 0.5, elL: -0.85,
  }, 'outCubic'),
])

/* ------------------------------- DASH ------------------------------- */

export const DASH_CLIP: Clip = makeClip('dash', [
  keyframe(0, {
    rootRot: 0.5, rootY: 3, spine: 0.1, head: -0.38,
    hipR: 0.9, kneeR: -1.1, footR: 0.15,
    hipL: -0.85, kneeL: -0.65, footL: 0.2,
    shR: 0.3, elR: -0.5, wrR: 1.5,
    shL: 0.75, elL: -0.55,
  }, 'outCubic'),
  keyframe(0.18, {
    rootRot: 0.62, rootY: 4, spine: 0.12, head: -0.44,
    hipR: 1.05, kneeR: -0.9, footR: 0.1,
    hipL: -0.95, kneeL: -0.8, footL: 0.25,
    shR: 0.25, elR: -0.45, wrR: 1.55,
    shL: 0.85, elL: -0.5,
  }, 'outQuad'),
])

export const DASH_AIR_CLIP: Clip = makeClip('dashAir', [
  keyframe(0, {
    rootRot: 0.45, rootY: 0, spine: 0.1, head: -0.35,
    hipR: 0.9, kneeR: -1.6, footR: -0.1,
    hipL: 0.7, kneeL: -1.5, footL: 0.1,
    shR: 0.4, elR: -0.4, wrR: 1.4,
    shL: 0.6, elL: -0.5,
  }, 'outCubic'),
  keyframe(0.2, {
    rootRot: 0.55, rootY: 1, spine: 0.12, head: -0.4,
    hipR: 1.0, kneeR: -1.5, footR: -0.1,
    hipL: 0.8, kneeL: -1.4, footL: 0.1,
    shR: 0.35, elR: -0.35, wrR: 1.45,
    shL: 0.7, elL: -0.45,
  }, 'outQuad'),
])

/* ------------------------------- PARRY / HURT / CHARGE -------------- */

/* Parry: the blade snaps up into a high deflection plane (sum ≈ 2.3 —
 * edge angled to slip the incoming blow sideways, like a real uke-nagashi
 * receiving parry). */
export const PARRY_CLIP: Clip = makeClip('parry', [
  keyframe(0, {
    rootRot: -0.2, spine: -0.06, head: -0.02, rootY: 2,
    hipR: 0.35, kneeR: -0.65, footR: 0.15,
    hipL: -0.4, kneeL: -0.55, footL: 0.1,
    shR: 1.75, elR: -0.8, wrR: 1.35,
    shL: 1.2, elL: -0.85, wrL: -0.3,
  }, 'outCubic'),
  keyframe(0.3, {
    rootRot: -0.16, spine: -0.04, head: -0.04, rootY: 1.5,
    shR: 1.7, elR: -0.8, wrR: 1.4,
    shL: 1.15, elL: -0.85, wrL: -0.28,
  }, 'outQuad'),
])

export const HURT_CLIP: Clip = makeClip('hurt', [
  keyframe(0, {
    rootRot: -0.32, spine: -0.12, head: -0.28, rootY: 2,
    hipR: 0.15, kneeR: -0.7, footR: 0.1,
    hipL: -0.5, kneeL: -0.45, footL: 0.15,
    shR: 0.2, elR: -0.6, wrR: 1.5,
    shL: -0.55, elL: -0.6,
  }, 'outBack'),
  keyframe(0.34, {
    rootRot: -0.04, spine: 0.02, head: -0.1, rootY: 0.5,
    shR: 0.7, elR: -0.5, wrR: 1.2,
    shL: 0.15, elL: -0.45,
  }, 'outCubic'),
])

/* Charge: the blade held high in a trembling jōdan gather (sum ≈ 3.0 —
 * blade UP) while energy condenses on the edge. */
export const CHARGE_CLIP: Clip = makeClip('charge', [
  keyframe(0, {
    rootY: 6, rootRot: 0.34, spine: 0.1, head: -0.18,
    hipR: 0.55, kneeR: -1.15, footR: 0.2,
    hipL: -0.45, kneeL: -1.05, footL: 0.15,
    shR: 2.6, elR: 0.15, wrR: 0.25,
    shL: 1.85, elL: -0.5, wrL: -0.2,
  }, 'linear'),
  keyframe(0.3, {
    rootY: 6.9, rootRot: 0.36, spine: 0.11, head: -0.2,
    hipR: 0.58, kneeR: -1.2, footR: 0.2,
    hipL: -0.42, kneeL: -1.0, footL: 0.15,
    shR: 2.65, elR: 0.15, wrR: 0.2,
    shL: 1.9, elL: -0.5, wrL: -0.22,
  }, 'linear'),
  keyframe(0.6, {
    rootY: 6, rootRot: 0.34, spine: 0.1, head: -0.18,
    hipR: 0.55, kneeR: -1.15, footR: 0.2,
    hipL: -0.45, kneeL: -1.05, footL: 0.15,
    shR: 2.6, elR: 0.15, wrR: 0.25,
    shL: 1.85, elL: -0.5, wrL: -0.2,
  }, 'linear'),
], true)

/* ------------------------------- EXECUTE IDLE POSE ------------------ */

/* Execution stance: the blade hanging low behind (sum ≈ -0.1 — a relaxed
 * otōshi-yō wrist position) while the target is pinned. */
export const EXECUTE_POSE_CLIP: Clip = makeClip('execPose', [
  keyframe(0, {
    rootRot: 0.1, spine: 0.06, head: -0.12, rootY: 0,
    hipR: 0.3, kneeR: -0.55, footR: 0.15,
    hipL: -0.35, kneeL: -0.5, footL: 0.12,
    shR: 0.75, elR: 0.15, wrR: -1.0,
    shL: 0.25, elL: -0.4,
  }, 'outCubic'),
])
