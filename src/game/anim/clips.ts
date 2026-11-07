/** STICKMAN RISING — locomotion & reaction animation clips (keyframed). */

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

/* Asymmetric breath: quicker inhale, slower settling exhale, with a faint
 * wrist/shoulder micro-shift so the sword hand never feels frozen. */
export const IDLE_CLIP: Clip = makeClip('idle', [
  keyframe(0, {}, 'inOutCubic'),
  keyframe(1.25, {
    rootY: -1.7, rootRot: 0.055, spine: 0.08, head: -0.12,
    shR: 0.62, elR: -0.47, wrR: 1.78,
    shL: 0.17, elL: -0.4, wrL: -0.19,
    hipL: 0.26, hipR: -0.27,
  }, 'inOutCubic'),
  keyframe(1.8, {
    rootY: -1.6, rootRot: 0.05, spine: 0.075, head: -0.11,
    shR: 0.6, elR: -0.46, wrR: 1.75,
    shL: 0.16, elL: -0.38, wrL: -0.18,
    hipL: 0.26, hipR: -0.27,
  }, 'inOutCubic'),
  keyframe(2.6, {
    rootY: -0.9, rootRot: 0.055, spine: 0.05, head: -0.09,
    shR: 0.57, elR: -0.48, wrR: 1.72,
    shL: 0.15, elL: -0.39, wrL: -0.2,
    hipL: 0.25, hipR: -0.26,
  }, 'inOutSine'),
  keyframe(3.6, {}, 'inOutSine'),
], true)

/* ------------------------------- RUN -------------------------------- */

/* Secondary motion notes:
 * - head counter-balances the vertical bob (body low → head lifts, and vice versa)
 * - spine pulses slightly with the weight absorption at the passing pose
 * - feet roll heel → toe through each stride (foot channel)
 * - sword wrist bobs a touch with the stride; off-hand counter-swings
 */
const RUN_Q: PoseInput[] = [
  {
    rootX: 0, rootY: -1.5, rootRot: 0.3, spine: 0.05, head: -0.17,
    hipR: 0.66, kneeR: -0.12, footR: 0.18,
    hipL: -0.6, kneeL: -0.5, footL: 0.14,
    shR: -0.5, elR: -0.75, wrR: 1.38,
    shL: 0.55, elL: -0.7, wrL: -0.26,
  },
  {
    rootX: 0, rootY: 1.5, rootRot: 0.33, spine: 0.075, head: -0.24,
    hipR: 0.3, kneeR: -0.45, footR: 0.06,
    hipL: -0.75, kneeL: -0.85, footL: 0.04,
    shR: -0.25, elR: -0.8, wrR: 1.52,
    shL: 0.35, elL: -0.75, wrL: -0.22,
  },
  {
    rootX: 0, rootY: 2.5, rootRot: 0.3, spine: 0.09, head: -0.28,
    hipR: -0.05, kneeR: -0.55, footR: -0.16,
    hipL: -0.25, kneeL: -1.5, footL: -0.22,
    shR: 0, elR: -0.7, wrR: 1.62,
    shL: 0.1, elL: -0.65, wrL: -0.18,
  },
  {
    rootX: 0, rootY: 0, rootRot: 0.28, spine: 0.06, head: -0.21,
    hipR: -0.4, kneeR: -0.35, footR: -0.04,
    hipL: 0.3, kneeL: -0.85, footL: 0.05,
    shR: 0.3, elR: -0.7, wrR: 1.56,
    shL: -0.2, elL: -0.7, wrL: -0.24,
  },
]

const RUN_DUR = 0.5
const runFrames = [
  keyframe(0, RUN_Q[0], 'linear'),
  keyframe(RUN_DUR * 0.125, RUN_Q[1], 'linear'),
  keyframe(RUN_DUR * 0.25, RUN_Q[2], 'linear'),
  keyframe(RUN_DUR * 0.375, RUN_Q[3], 'linear'),
  keyframe(RUN_DUR * 0.5, mirrorPose(RUN_Q[0]), 'linear'),
  keyframe(RUN_DUR * 0.625, mirrorPose(RUN_Q[1]), 'linear'),
  keyframe(RUN_DUR * 0.75, mirrorPose(RUN_Q[2]), 'linear'),
  keyframe(RUN_DUR * 0.875, mirrorPose(RUN_Q[3]), 'linear'),
  keyframe(RUN_DUR, RUN_Q[0], 'linear'),
]

export const RUN_CLIP: Clip = makeClip('run', runFrames, true)

/* ------------------------------- JUMP / FALL / LAND ---------------- */

export const JUMP_CLIP: Clip = makeClip('jump', [
  keyframe(0, {
    rootRot: 0.2, rootY: 2,
    hipR: 0.5, kneeR: -1.0, footR: 0.15,
    hipL: -0.3, kneeL: -0.9, footL: 0.1,
    shR: 0.3, elR: -0.7, wrR: 1.4,
    shL: -0.2, elL: -0.5,
  }, 'outQuad'),
  keyframe(0.12, {
    rootRot: 0.24, rootY: -3,
    hipR: -0.35, kneeR: -0.5, footR: -0.2,
    hipL: 0.4, kneeL: -0.35, footL: 0.3,
    shR: -0.55, elR: -0.5, wrR: 1.95,
    shL: 0.6, elL: -0.45,
  }, 'outCubic'),
  keyframe(0.4, {
    rootRot: 0.15, rootY: -2,
    hipR: -0.5, kneeR: -0.65, footR: -0.15,
    hipL: 0.45, kneeL: -0.55, footL: 0.2,
    shR: -0.25, elR: -0.5, wrR: 1.7,
    shL: 0.3, elL: -0.5,
  }, 'inOutCubic'),
])

export const FALL_CLIP: Clip = makeClip('fall', [
  keyframe(0, {
    rootRot: 0.1, spine: 0.08, head: -0.12, rootY: -2,
    hipR: -0.45, kneeR: -0.6, footR: -0.15,
    hipL: 0.4, kneeL: -0.5, footL: 0.25,
    shR: -0.15, elR: -0.55, wrR: 1.6,
    shL: 0.3, elL: -0.5, wrL: -0.4,
  }, 'inOutCubic'),
  keyframe(0.45, {
    rootRot: 0.12, spine: 0.08, head: -0.14, rootY: -3.4,
    hipR: -0.5, kneeR: -0.5, footR: -0.12,
    hipL: 0.45, kneeL: -0.65, footL: 0.22,
    shR: -0.05, elR: -0.6, wrR: 1.65,
    shL: 0.4, elL: -0.45, wrL: -0.35,
  }, 'inOutCubic'),
  keyframe(0.9, {
    rootRot: 0.1, spine: 0.08, head: -0.12, rootY: -2,
    hipR: -0.45, kneeR: -0.6, footR: -0.15,
    hipL: 0.4, kneeL: -0.5, footL: 0.25,
    shR: -0.15, elR: -0.55, wrR: 1.6,
    shL: 0.3, elL: -0.5, wrL: -0.4,
  }, 'inOutCubic'),
], true)

export const LAND_CLIP: Clip = makeClip('land', [
  keyframe(0, {
    rootY: 7, rootRot: 0.38, spine: 0.12, head: -0.2,
    hipR: 0.6, kneeR: -1.35, footR: 0.25,
    hipL: -0.5, kneeL: -1.25, footL: 0.2,
    shR: 0.75, elR: -0.9, wrR: 1.1,
    shL: 0.5, elL: -0.8,
  }, 'outQuad'),
  keyframe(0.26, {
    rootY: 1.5, rootRot: 0.16, spine: 0.05, head: -0.1,
    hipR: 0.35, kneeR: -0.5, footR: 0.12,
    hipL: -0.3, kneeL: -0.45, footL: 0.1,
    shR: 0.5, elR: -0.55, wrR: 1.6,
    shL: 0.2, elL: -0.5,
  }, 'outCubic'),
])

/* ------------------------------- DASH ------------------------------- */

export const DASH_CLIP: Clip = makeClip('dash', [
  keyframe(0, {
    rootRot: 0.5, rootY: 3, spine: 0.1, head: -0.38,
    hipR: 0.9, kneeR: -1.1, footR: 0.15,
    hipL: -0.85, kneeL: -0.65, footL: 0.2,
    shR: -0.9, elR: -0.35, wrR: -0.5,
    shL: 0.75, elL: -0.55,
  }, 'outCubic'),
  keyframe(0.18, {
    rootRot: 0.62, rootY: 4, spine: 0.12, head: -0.44,
    hipR: 1.05, kneeR: -0.9, footR: 0.1,
    hipL: -0.95, kneeL: -0.8, footL: 0.25,
    shR: -1.05, elR: -0.3, wrR: -0.72,
    shL: 0.85, elL: -0.5,
  }, 'outQuad'),
])

export const DASH_AIR_CLIP: Clip = makeClip('dashAir', [
  keyframe(0, {
    rootRot: 0.45, rootY: 0, spine: 0.1, head: -0.35,
    hipR: 0.9, kneeR: -1.6, footR: -0.1,
    hipL: 0.7, kneeL: -1.5, footL: 0.1,
    shR: -0.8, elR: -0.3, wrR: -0.4,
    shL: 0.6, elL: -0.5,
  }, 'outCubic'),
  keyframe(0.2, {
    rootRot: 0.55, rootY: 1, spine: 0.12, head: -0.4,
    hipR: 1.0, kneeR: -1.5, footR: -0.1,
    hipL: 0.8, kneeL: -1.4, footL: 0.1,
    shR: -0.95, elR: -0.25, wrR: -0.5,
    shL: 0.7, elL: -0.45,
  }, 'outQuad'),
])

/* ------------------------------- PARRY / HURT / CHARGE -------------- */

export const PARRY_CLIP: Clip = makeClip('parry', [
  keyframe(0, {
    rootRot: -0.2, spine: -0.06, head: -0.02, rootY: 2,
    hipR: 0.35, kneeR: -0.65, footR: 0.15,
    hipL: -0.4, kneeL: -0.55, footL: 0.1,
    shR: 1.35, elR: -1.15, wrR: 1.3,
    shL: 0.9, elL: -0.95, wrL: -0.3,
  }, 'outCubic'),
  keyframe(0.3, {
    rootRot: -0.16, spine: -0.04, head: -0.04, rootY: 1.5,
    shR: 1.3, elR: -1.1, wrR: 1.35,
    shL: 0.85, elL: -0.9, wrL: -0.28,
  }, 'outQuad'),
])

export const HURT_CLIP: Clip = makeClip('hurt', [
  keyframe(0, {
    rootRot: -0.32, spine: -0.12, head: -0.28, rootY: 2,
    hipR: 0.15, kneeR: -0.7, footR: 0.1,
    hipL: -0.5, kneeL: -0.45, footL: 0.15,
    shR: -0.45, elR: -0.75, wrR: 1.1,
    shL: -0.55, elL: -0.6,
  }, 'outBack'),
  keyframe(0.34, {
    rootRot: -0.04, spine: 0.02, head: -0.1, rootY: 0.5,
    shR: 0.45, elR: -0.5, wrR: 1.6,
    shL: 0.15, elL: -0.45,
  }, 'outCubic'),
])

export const CHARGE_CLIP: Clip = makeClip('charge', [
  keyframe(0, {
    rootY: 6, rootRot: 0.34, spine: 0.1, head: -0.18,
    hipR: 0.55, kneeR: -1.15, footR: 0.2,
    hipL: -0.45, kneeL: -1.05, footL: 0.15,
    shR: -0.75, elR: -0.6, wrR: -0.9,
    shL: 0.6, elL: -0.7, wrL: -0.2,
  }, 'linear'),
  keyframe(0.3, {
    rootY: 6.9, rootRot: 0.36, spine: 0.11, head: -0.2,
    hipR: 0.58, kneeR: -1.2, footR: 0.2,
    hipL: -0.42, kneeL: -1.0, footL: 0.15,
    shR: -0.7, elR: -0.65, wrR: -0.95,
    shL: 0.62, elL: -0.68, wrL: -0.22,
  }, 'linear'),
  keyframe(0.6, {
    rootY: 6, rootRot: 0.34, spine: 0.1, head: -0.18,
    hipR: 0.55, kneeR: -1.15, footR: 0.2,
    hipL: -0.45, kneeL: -1.05, footL: 0.15,
    shR: -0.75, elR: -0.6, wrR: -0.9,
    shL: 0.6, elL: -0.7, wrL: -0.2,
  }, 'linear'),
], true)

/* ------------------------------- EXECUTE IDLE POSE ------------------ */

export const EXECUTE_POSE_CLIP: Clip = makeClip('execPose', [
  keyframe(0, {
    rootRot: 0.1, spine: 0.06, head: -0.12, rootY: 0,
    hipR: 0.3, kneeR: -0.55, footR: 0.15,
    hipL: -0.35, kneeL: -0.5, footL: 0.12,
    shR: 0.4, elR: 0.35, wrR: -0.9,
    shL: 0.25, elL: -0.4,
  }, 'outCubic'),
])
