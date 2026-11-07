/** STICKMAN RISING — locomotion & reaction animation clips (keyframed).
 *
 * All poses are authored around the chūdan-no-kamae guard (NEUTRAL in
 * pose.ts): unspecified channels default INTO the guard, so every clip
 * blends guard→guard — the in-between continuity contract.
 */

import { keyframe, makeClip, Clip } from './animator'
import { PoseInput } from './pose'

/** swaps left/right limb channels — used to build the run cycle */
function mirrorPose(src: PoseInput): PoseInput {
  const out: PoseInput = { ...src }
  const pairs: [keyof PoseInput, keyof PoseInput][] = [
    ['hipL', 'hipR'], ['kneeL', 'kneeR'], ['footL', 'footR'],
    ['shL', 'shR'], ['elL', 'elR'], ['wrL', 'wrR'],
  ]
  for (const [l, r] of pairs) {
    const lv = src[l]
    const rv = src[r]
    if (lv !== undefined) out[r] = lv
    if (rv !== undefined) out[l] = rv
  }
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

/* ------------------------------- RUN -------------------------------- */

/* Five-phase gait (Williams, Animator's Survival Kit): CONTACT → LOADING
 * (absorb) → PUSH-OFF → FLIGHT → REACH, mirrored per stride. Every span is
 * eased — never linear: the fall INTO contact accelerates (inQuad), the
 * absorb decelerates (outQuad), the drive is smooth (inOutSine), the launch
 * explodes (outCubic). The hip bob is authored SMALL because the foot-ground
 * lock in player.ts derives hip height from the planted leg — real weight
 * transfer instead of a painted bob. Off-arm pumps in counter-phase; the
 * sword trails low-back in a relaxed guard (sum ≈ 2.2).
 */
const RUN_Q: PoseInput[] = [
  { // CONTACT — lead heel strikes FAR forward, trail toe still down
    rootX: 0, rootY: 0.6, rootRot: 0.3, spine: 0.05, head: -0.17,
    hipR: 0.88, kneeR: -0.08, footR: 0.24,
    hipL: -0.8, kneeL: -0.62, footL: -0.06,
    shR: 0.3, elR: -1.0, wrR: 0.9,
    shL: 0.7, elL: -1.05, wrL: -0.24,
  },
  { // LOADING — weight absorbs over the bending lead leg, big stride split
    rootX: 0, rootY: 2.2, rootRot: 0.33, spine: 0.075, head: -0.24,
    hipR: 0.5, kneeR: -0.72, footR: 0.06,
    hipL: -0.95, kneeL: -0.3, footL: 0.02,
    shR: 0.55, elR: -1.05, wrR: 0.82,
    shL: 0.32, elL: -1.0, wrL: -0.2,
  },
  { // PUSH-OFF — lead leg drives back hard, trail knee punches through high
    rootX: 0, rootY: 1.0, rootRot: 0.3, spine: 0.09, head: -0.28,
    hipR: -0.3, kneeR: -0.38, footR: -0.1,
    hipL: 0.52, kneeL: -1.32, footL: 0.2,
    shR: 0.72, elR: -0.95, wrR: 0.74,
    shL: 0.08, elL: -0.95, wrL: -0.16,
  },
]

const RUN_DUR = 0.5
const runFrames = [
  // stride A — right leg contact (0.0) → absorb (13%) → push (30%) → flight (50%)
  keyframe(0, RUN_Q[0], 'inQuad'),               // fall into contact
  keyframe(RUN_DUR * 0.13, RUN_Q[1], 'outQuad'), // absorb
  keyframe(RUN_DUR * 0.3, RUN_Q[2], 'inOutSine'), // drive
  // stride B — left leg contact (50%) → absorb (63%) → push (80%) → wrap
  keyframe(RUN_DUR * 0.5, mirrorPose(RUN_Q[0]), 'outCubic'), // launch/reach
  keyframe(RUN_DUR * 0.63, mirrorPose(RUN_Q[1]), 'inQuad'),
  keyframe(RUN_DUR * 0.8, mirrorPose(RUN_Q[2]), 'outQuad'),
  keyframe(RUN_DUR, RUN_Q[0], 'inOutSine'),
]

export const RUN_CLIP: Clip = makeClip('run', runFrames, true)

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
