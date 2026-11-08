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
 * negates its swing so the contralateral counter-phase survives.
 * DEPTH channels mirror with the stride: pelvis/chest yaw negate (the
 * opposite hip now drives), the off-arm's depth swing negates — while the
 * sword-side channels (armRz, bladeYaw) carry unchanged, like the arm. */
function mirrorStride(src: PoseInput): PoseInput {
  const out = mirrorLegs(src)
  if (src.shL !== undefined) out.shL = -src.shL
  if (src.pelvisYaw !== undefined) out.pelvisYaw = -src.pelvisYaw
  if (src.chestYaw !== undefined) out.chestYaw = -src.chestYaw
  if (src.armLz !== undefined) out.armLz = -src.armLz
  // the off FOREARM's own depth yaw negates WITH its upper arm — leaving
  // it un-mirrored desyncs the elbow's depth plane on stride B (the
  // "forearm flips against the upper arm" depth incoherence)
  if (src.foreLz !== undefined) out.foreLz = -src.foreLz
  if (src.armRz !== undefined) out.armRz = src.armRz
  if (src.bladeYaw !== undefined) out.bladeYaw = src.bladeYaw
  return out
}

/* ------------------------------- IDLE ------------------------------- */

/* Upright Shadow Ronin standing: proud posture, naturally aligned spine,
 * hand resting on the tsuka at the hip, off-hand resting on the saya,
 * tucked elbows. Gentle diaphragmatic breathing cycle. */
export const IDLE_CLIP: Clip = makeClip('idle', [
  keyframe(0, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
    hipR: 0.10, kneeR: -0.14, footR: 0.04,
    hipL: -0.10, kneeL: -0.14, footL: 0.04,
    pelvisYaw: 0.04, chestYaw: -0.02,
  }, 'inOutSine'),
  keyframe(1.6, { // subtle diaphragmatic breathing inhale: gentle chest expansion, quiet poise
    rootY: -0.45, rootRot: 0.005, spine: 0.012, head: 0.008,
    shR: 0.11, elR: -0.53, wrR: 1.19,
    shL: 0.03, elL: -0.44, wrL: -0.15,
    hipR: 0.10, kneeR: -0.12, footR: 0.04,
    hipL: -0.10, kneeL: -0.12, footL: 0.04,
    pelvisYaw: 0.03, chestYaw: -0.015,
  }, 'inOutSine'),
  keyframe(3.2, { // exhale and settle smoothly
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
    hipR: 0.10, kneeR: -0.14, footR: 0.04,
    hipL: -0.10, kneeL: -0.14, footL: 0.04,
    pelvisYaw: 0.04, chestYaw: -0.02,
  }, 'inOutSine'),
], true)

/* ------------------------------- IDLE FLOURISHES --------------------- */

/** Flourish 1: Tsuba Thumb-Pop (Iai ready check). */
export const FLOURISH_TSUBA_POP_CLIP: Clip = makeClip('flourishTsubaPop', [
  keyframe(0, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
    hipR: 0.10, kneeR: -0.14, footR: 0.04,
    hipL: -0.10, kneeL: -0.14, footL: 0.04,
  }, 'inOutSine'),
  keyframe(0.25, {
    rootY: 0.1, rootRot: 0.015, spine: 0.01, head: 0.02,
    shR: 0.14, elR: -0.55, wrR: 1.22,
    shL: 0.08, elL: -0.55, wrL: -0.05,
    pelvisYaw: 0.08, chestYaw: -0.04,
  }, 'outQuad'),
  keyframe(0.45, {
    rootY: 0.15, rootRot: 0.02, spine: 0.015, head: 0.03,
    shR: 0.20, elR: -0.62, wrR: 1.30, bladeZ: 1.8,
    shL: 0.06, elL: -0.52, wrL: -0.08,
    pelvisYaw: 0.10, chestYaw: -0.05,
  }, 'outCubic'),
  keyframe(0.65, {
    rootY: 0.05, rootRot: 0.01, spine: 0.005, head: 0.01,
    shR: 0.14, elR: -0.54, wrR: 1.20, bladeZ: 0,
    shL: 0.05, elL: -0.47, wrL: -0.12,
    pelvisYaw: 0.06, chestYaw: -0.03,
  }, 'inOutCubic'),
  keyframe(0.95, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
    hipR: 0.10, kneeR: -0.14, footR: 0.04,
    hipL: -0.10, kneeL: -0.14, footL: 0.04,
  }, 'inOutSine'),
])

/** Flourish 2: Hilt Spin / Grip Readjustment. */
export const FLOURISH_HILT_SPIN_CLIP: Clip = makeClip('flourishHiltSpin', [
  keyframe(0, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
  }, 'inOutSine'),
  keyframe(0.3, {
    rootY: -0.2, rootRot: -0.01, spine: 0.01, head: -0.02,
    shR: 0.16, elR: -0.65, wrR: 1.55, foreRz: 0.22,
    shL: 0.03, elL: -0.43, wrL: -0.16,
  }, 'inOutCubic'),
  keyframe(0.65, {
    rootY: -0.1, rootRot: 0.0, spine: 0.005, head: 0.0,
    shR: 0.13, elR: -0.56, wrR: 1.25, foreRz: 0.08,
    shL: 0.04, elL: -0.45, wrL: -0.15,
  }, 'outCubic'),
  keyframe(1.1, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
  }, 'inOutSine'),
])

/** Flourish 3: Collar / Scarf Adjustment. */
export const FLOURISH_SCARF_ADJUST_CLIP: Clip = makeClip('flourishScarfAdjust', [
  keyframe(0, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
  }, 'inOutSine'),
  keyframe(0.35, {
    rootY: -0.3, rootRot: -0.02, spine: 0.02, head: -0.04,
    shL: 0.85, elL: -1.75, wrL: 0.45, armLz: 0.25,
    shR: 0.10, elR: -0.50, wrR: 1.18,
  }, 'outQuad'),
  keyframe(0.7, {
    rootY: -0.2, rootRot: -0.01, spine: 0.015, head: -0.02,
    shL: 0.92, elL: -1.65, wrL: 0.25, armLz: 0.20,
    shR: 0.11, elR: -0.51, wrR: 1.18,
  }, 'inOutCubic'),
  keyframe(1.0, {
    rootY: -0.1, rootRot: 0.0, spine: 0.005, head: 0.0,
    shL: 0.35, elL: -0.85, wrL: -0.05, armLz: 0.08,
    shR: 0.12, elR: -0.52, wrR: 1.18,
  }, 'inOutSine'),
  keyframe(1.3, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
  }, 'inOutSine'),
])

/** Flourish 4: Martial Stance Settle / Ground Tap. */
export const FLOURISH_STANCE_SETTLE_CLIP: Clip = makeClip('flourishStanceSettle', [
  keyframe(0, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
    hipR: 0.10, kneeR: -0.14, footR: 0.04,
    hipL: -0.10, kneeL: -0.14, footL: 0.04,
  }, 'inOutSine'),
  keyframe(0.3, {
    rootY: 0.4, rootRot: 0.02, spine: 0.01, head: 0.01,
    hipR: 0.18, kneeR: -0.22, footR: 0.15,
    hipL: -0.14, kneeL: -0.18, footL: 0.02,
    shR: 0.13, elR: -0.54, wrR: 1.19,
    shL: 0.05, elL: -0.46, wrL: -0.15,
  }, 'outQuad'),
  keyframe(0.6, {
    rootY: 0.6, rootRot: 0.01, spine: 0.005, head: 0.0,
    hipR: 0.12, kneeR: -0.18, footR: 0.05,
    hipL: -0.12, kneeL: -0.16, footL: 0.03,
    shR: 0.12, elR: -0.53, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
  }, 'inOutCubic'),
  keyframe(1.0, {
    rootY: 0, rootRot: 0.0, spine: 0.0, head: 0.0,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45, wrL: -0.15,
    hipR: 0.10, kneeR: -0.14, footR: 0.04,
    hipL: -0.10, kneeL: -0.14, footL: 0.04,
  }, 'inOutSine'),
])

/* ------------------------------- WALK -------------------------------- */

/* Relaxed martial walking: upright posture, natural pendular swing,
 * katana stabilized securely at the hip with tucked elbows. */
const WALK_Q: PoseInput[] = [
  { // CONTACT-R
    rootRot: 0.02, rootY: 0.3, spine: 0.01, head: -0.01,
    hipR: 0.28, kneeR: -0.06, footR: 0.10,
    hipL: -0.24, kneeL: -0.28, footL: -0.04,
    shR: 0.14, elR: -0.48, wrR: 1.18,
    shL: -0.12, elL: -0.42, wrL: -0.15,
    pelvisYaw: 0.08, chestYaw: -0.04,
  },
  { // LOAD-R
    rootRot: 0.025, rootY: 0.7, spine: 0.015, head: -0.015,
    hipR: 0.12, kneeR: -0.24, footR: 0.06,
    hipL: -0.26, kneeL: -0.38, footL: -0.06,
    shR: 0.15, elR: -0.49, wrR: 1.18,
    shL: 0.02, elL: -0.46, wrL: -0.15,
    pelvisYaw: 0.04, chestYaw: -0.02,
  },
  { // PASSING
    rootRot: 0.02, rootY: 0.4, spine: 0.01, head: -0.01,
    hipR: -0.06, kneeR: -0.10, footR: 0.04,
    hipL: 0.10, kneeL: -0.52, footL: 0.08,
    shR: 0.13, elR: -0.48, wrR: 1.18,
    shL: 0.14, elL: -0.52, wrL: -0.15,
    pelvisYaw: -0.04, chestYaw: 0.02,
  },
  { // TOE-OFF-R
    rootRot: 0.022, rootY: 0.5, spine: 0.012, head: -0.012,
    hipR: -0.24, kneeR: -0.24, footR: -0.12,
    hipL: 0.24, kneeL: -0.10, footL: 0.10,
    shR: 0.12, elR: -0.47, wrR: 1.18,
    shL: 0.18, elL: -0.55, wrL: -0.15,
    pelvisYaw: -0.08, chestYaw: 0.04,
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

/* Athletic martial run: controlled core, tucked elbows, sword stabilized at hip. */
const RUN_Q: PoseInput[] = [
  { // CONTACT
    rootX: 1.5, rootY: 0.4, rootRot: 0.08, spine: 0.02, head: -0.04,
    hipR: 0.72, kneeR: -0.08, footR: 0.20,
    hipL: -0.65, kneeL: -0.52, footL: -0.06,
    shR: 0.08, elR: -0.72, wrR: 1.20,
    shL: 0.45, elL: -0.85, wrL: -0.15,
    pelvisYaw: 0.16, chestYaw: -0.10, armLz: 0.20, foreLz: 0.08,
  },
  { // LOADING
    rootX: 3.2, rootY: 1.6, rootRot: 0.09, spine: 0.025, head: -0.045,
    hipR: 0.40, kneeR: -0.58, footR: 0.05,
    hipL: -0.78, kneeL: -0.26, footL: 0.02,
    shR: 0.12, elR: -0.75, wrR: 1.20,
    shL: 0.22, elL: -0.78, wrL: -0.15,
    pelvisYaw: 0.05, chestYaw: -0.03, armLz: 0.08, foreLz: 0.04,
  },
  { // PUSH-OFF
    rootX: 5.0, rootY: 0.8, rootRot: 0.08, spine: 0.03, head: -0.04,
    hipR: -0.25, kneeR: -0.32, footR: -0.08,
    hipL: 0.45, kneeL: -1.15, footL: 0.16,
    shR: 0.18, elR: -0.76, wrR: 1.20,
    shL: -0.24, elL: -0.72, wrL: -0.15,
    pelvisYaw: -0.14, chestYaw: 0.08, armLz: -0.18, foreLz: -0.08,
  },
]

const RUN_DUR = 0.5
const runB = (q: PoseInput, shR: number, elR: number): PoseInput => ({
  ...mirrorStride(q), shR, elR,
})
const runFrames = [
  keyframe(0, RUN_Q[0], 'inQuad'),
  keyframe(RUN_DUR * 0.13, RUN_Q[1], 'outQuad'),
  keyframe(RUN_DUR * 0.3, RUN_Q[2], 'inOutSine'),
  keyframe(RUN_DUR * 0.5, runB(RUN_Q[0], 0.18, -0.74), 'outCubic'),
  keyframe(RUN_DUR * 0.63, runB(RUN_Q[1], 0.14, -0.75), 'inQuad'),
  keyframe(RUN_DUR * 0.8, runB(RUN_Q[2], 0.08, -0.72), 'outQuad'),
  keyframe(RUN_DUR, RUN_Q[0], 'inOutSine'),
]

export const RUN_CLIP: Clip = makeClip('run', runFrames, true)

/* ------------------------------- SPRINT ------------------------------ */

/* High-speed shinobi sprint: aerodynamic forward drive, tucked trailing blade. */
const SPRINT_Q: PoseInput[] = [
  { // CONTACT — right foot strikes forward, aerodynamic lean, tucked arms
    rootX: 3.5, rootRot: 0.18, rootY: 2.0, spine: 0.05, head: -0.08,
    hipR: 0.75, kneeR: -0.20, footR: 0.22,
    hipL: -0.55, kneeL: -0.60, footL: -0.08,
    shR: -0.25, elR: -0.85, wrR: 1.25,
    shL: 0.50, elL: -1.05,
    pelvisYaw: 0.18, chestYaw: -0.20, armLz: 0.18, armRz: -0.06, bladeYaw: -0.28,
  },
  { // SCISSOR — weight absorbs, trail heel recovers
    rootX: 4.8, rootRot: 0.19, rootY: 3.2, spine: 0.055, head: -0.085,
    hipR: 0.20, kneeR: -0.75, footR: 0.05,
    hipL: -0.35, kneeL: -1.25, footL: 0.20,
    shR: -0.20, elR: -0.82, wrR: 1.25,
    shL: 0.35, elL: -0.98,
    pelvisYaw: 0.06, chestYaw: -0.08, armLz: 0.08, armRz: -0.05, bladeYaw: -0.24,
  },
  { // TOE-OFF — hip extension behind, knee drive
    rootX: 6.2, rootRot: 0.18, rootY: 2.4, spine: 0.05, head: -0.08,
    hipR: -0.45, kneeR: -0.28, footR: -0.12,
    hipL: 0.70, kneeL: -0.80, footL: 0.10,
    shR: -0.18, elR: -0.80, wrR: 1.25,
    shL: 0.05, elL: -0.90,
    pelvisYaw: -0.18, chestYaw: 0.20, armLz: -0.16, armRz: -0.04, bladeYaw: -0.20,
  },
  { // FLIGHT — legs scissor-extended
    rootX: 5.0, rootRot: 0.17, rootY: 0.5, spine: 0.045, head: -0.075,
    hipR: -0.30, kneeR: -0.50, footR: -0.06,
    hipL: 0.65, kneeL: -0.38, footL: 0.20,
    shR: -0.22, elR: -0.84, wrR: 1.25,
    shL: -0.45, elL: -1.02,
    pelvisYaw: -0.08, chestYaw: 0.10, armLz: -0.08, armRz: -0.05, bladeYaw: -0.26,
  },
]

const SPRINT_DUR = 0.42
const SPH = SPRINT_DUR / 2
export const SPRINT_CLIP: Clip = makeClip('sprint', [
  keyframe(0, SPRINT_Q[0], 'inQuad'),
  keyframe(SPH * 0.28, SPRINT_Q[1], 'outQuad'),
  keyframe(SPH * 0.55, SPRINT_Q[2], 'inOutSine'),
  keyframe(SPH * 0.82, SPRINT_Q[3], 'outCubic'),
  keyframe(SPH, mirrorStride(SPRINT_Q[0]), 'inQuad'),
  keyframe(SPH + SPH * 0.28, mirrorStride(SPRINT_Q[1]), 'outQuad'),
  keyframe(SPH + SPH * 0.55, mirrorStride(SPRINT_Q[2]), 'inOutSine'),
  keyframe(SPH + SPH * 0.82, mirrorStride(SPRINT_Q[3]), 'outCubic'),
  keyframe(SPRINT_DUR, SPRINT_Q[0], 'inOutSine'),
], true)

/* ------------------------------- COMBAT STEP ------------------------- */

/* Disciplined combat shuffle: bladed profile, knees flexed, hand poised on tsuka/saya. */
const COMBAT_Q: PoseInput[] = [
  {
    rootRot: 0.04, rootY: 2.2, spine: 0.015, head: -0.015,
    hipR: 0.35, kneeR: -0.46, footR: 0.14,
    hipL: -0.28, kneeL: -0.40, footL: 0.10,
    shR: 0.16, elR: -0.62, wrR: 1.25,
    shL: 0.08, elL: -0.75, wrL: -0.20,
    pelvisYaw: 0.22, chestYaw: -0.12,
  },
  {
    rootRot: 0.045, rootY: 2.4, spine: 0.02, head: -0.015,
    hipR: 0.22, kneeR: -0.56, footR: 0.08,
    hipL: -0.08, kneeL: -0.52, footL: 0.08,
    shR: 0.16, elR: -0.62, wrR: 1.25,
    shL: 0.08, elL: -0.75, wrL: -0.20,
    pelvisYaw: 0.18, chestYaw: -0.10,
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

/* ------------------------------- COMBAT IDLE ------------------------- */

/* Coiled Iai / Battō ready stance: bladed profile, knees spring-loaded,
 * right hand gripped on tsuka, left locking the saya mouth. Zero zombie reach. */
export const COMBAT_IDLE_CLIP: Clip = makeClip('combatIdle', [
  keyframe(0, {
    rootRot: 0.03, rootY: 2.0, spine: 0.015, head: -0.01,
    hipR: 0.24, kneeR: -0.44, footR: 0.10,
    hipL: -0.22, kneeL: -0.38, footL: 0.08,
    shR: 0.16, elR: -0.62, wrR: 1.25,
    shL: 0.08, elL: -0.75, wrL: -0.20,
    pelvisYaw: 0.22, chestYaw: -0.12, armRz: 0.10, armLz: -0.08,
  }, 'inOutSine'),
  keyframe(0.9, { // subtle coiled weight shift onto rear leg
    rootRot: 0.025, rootY: 2.3, spine: 0.012, head: -0.01,
    hipR: 0.20, kneeR: -0.48, footR: 0.08,
    hipL: -0.25, kneeL: -0.35, footL: 0.06,
    shR: 0.15, elR: -0.63, wrR: 1.24,
    shL: 0.07, elL: -0.76, wrL: -0.20,
    pelvisYaw: 0.20, chestYaw: -0.10,
  }, 'inOutSine'),
  keyframe(1.8, { // return smoothly
    rootRot: 0.03, rootY: 2.0, spine: 0.015, head: -0.01,
    hipR: 0.24, kneeR: -0.44, footR: 0.10,
    hipL: -0.22, kneeL: -0.38, footL: 0.08,
    shR: 0.16, elR: -0.62, wrR: 1.25,
    shL: 0.08, elL: -0.75, wrL: -0.20,
    pelvisYaw: 0.22, chestYaw: -0.12, armRz: 0.10, armLz: -0.08,
  }, 'inOutSine'),
], true)

/* ------------------------------- BACKPEDAL --------------------------- */

/* Guarded retreat — moving backward while maintaining the iai ready guard. */
const BACK_Q: PoseInput[] = [
  {
    rootRot: -0.02, rootY: 2.0, spine: 0.01, head: 0.0,
    hipR: -0.40, kneeR: -0.42, footR: 0.20,
    hipL: 0.24, kneeL: -0.40, footL: 0.08,
    shR: 0.16, elR: -0.60, wrR: 1.22,
    shL: 0.08, elL: -0.72, wrL: -0.20,
    pelvisYaw: 0.20, chestYaw: -0.10,
  },
  {
    rootRot: -0.015, rootY: 2.3, spine: 0.01, head: 0.0,
    hipR: -0.20, kneeR: -0.62, footR: 0.10,
    hipL: 0.08, kneeL: -0.58, footL: 0.06,
    shR: 0.16, elR: -0.60, wrR: 1.22,
    shL: 0.08, elL: -0.72, wrL: -0.20,
    pelvisYaw: 0.16, chestYaw: -0.08,
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

/* One-shot hard stop: deceleration sinks into knees, posture recovers to upright. */
export const BRAKE_CLIP: Clip = makeClip('brake', [
  keyframe(0, {
    rootRot: -0.08, rootY: 3.2, spine: -0.01, head: 0.04,
    hipR: 0.45, kneeR: -0.68, footR: 0.22,
    hipL: -0.28, kneeL: -0.48, footL: -0.04,
    shR: 0.18, elR: -0.65, wrR: 1.25,
    shL: 0.10, elL: -0.78,
  }, 'outQuad'),
  keyframe(0.12, {
    rootRot: -0.01, rootY: 2.2, spine: 0.01, head: 0.0,
    hipR: 0.32, kneeR: -0.52, footR: 0.14,
    hipL: -0.22, kneeL: -0.42, footL: 0.04,
    shR: 0.15, elR: -0.58, wrR: 1.20,
    shL: 0.06, elL: -0.62,
  }, 'inOutCubic'),
  keyframe(0.24, {
    rootRot: 0.0, rootY: 1.0, spine: 0.0, head: 0.0,
    hipR: 0.18, kneeR: -0.28, footR: 0.08,
    hipL: -0.16, kneeL: -0.26, footL: 0.06,
    shR: 0.12, elR: -0.52, wrR: 1.18,
    shL: 0.04, elL: -0.45,
  }, 'outCubic'),
])

/* ------------------------------- JUMP / FALL / LAND ---------------- */

/* THE AIRBORNE FAMILY — HANDS-ONLY choreography: both arms move as free
 * hands (momentum throws, balance spreads, the mid-air redirect slap) —
 * NO sword choreography, no wrist flourishes, no spin. The blade simply
 * rides the sword hand in a fixed neutral carry (wrR wound into the
 * locomotion family region ≈ 5.0–7.0) so it trails clear of the legs
 * through every pose, and the animator's shortest-path wrist crossfade
 * guarantees carry→carry blends never sweep the long way around.
 *
 * The family is CONDITIONED (player.ts doJump):
 *   · JUMP      the standing vertical — triple extension, hands thrown high
 *   · LEAP      initiated from a run: momentum long-jump, hands swept
 *               down-back, trail leg fully extended (Ninja Gaiden leap)
 *   · AIR JUMP  the mid-air redirect: coil → leg scissor + both hands
 *               SLAP down past the hips (the boost read) → fall spread
 *   · FALL      opens from the apex tuck — one continuous arc
 *   · LAND      deep squat absorb, both hands reaching down past the knees
 * Jump velocity (JUMP_V in player.ts) clears ≈ 2.5× hip height — a REAL
 * athletic jump. */
export const JUMP_CLIP: Clip = makeClip('jump', [
  keyframe(0, { // TAKEOFF — triple extension: BOTH HANDS thrown high
    rootRot: 0.3, rootY: -2, spine: 0.1, head: -0.24,
    hipR: 0.85, kneeR: -1.55, footR: 0.32,
    hipL: -0.55, kneeL: -0.25, footL: -0.1,
    shR: 2.75, elR: -0.25, wrR: 6.95,
    shL: 2.55, elL: -0.3,
    pelvisYaw: 0.08,
  }, 'outQuad'),
  keyframe(0.16, { // RISE — arms sweep out toward the balance spread
    rootRot: 0.18, rootY: -3, spine: 0.06, head: -0.18,
    hipR: 0.55, kneeR: -1.5, footR: 0.18,
    hipL: 0.32, kneeL: -1.05, footL: 0.22,
    shR: 2.15, elR: -0.2, wrR: 6.98,
    shL: 1.95, elL: -0.25, armLz: 0.45,
  }, 'outCubic'),
  keyframe(0.34, { // APEX — knees tuck high, hands level at the shoulders
    rootRot: 0.12, rootY: -3.6, spine: 0.05, head: -0.14,
    hipR: 0.6, kneeR: -1.9, footR: 0.1,
    hipL: 0.45, kneeL: -1.75, footL: 0.16,
    shR: 1.75, elR: -0.35, wrR: 7.02,
    shL: 1.6, elL: -0.4, armLz: 0.3,
  }, 'inOutCubic'),
])

/** running leap — initiated from a run: the momentum long-jump. Torso
 * drives forward over the boarding leg, trail leg sweeps back to FULL
 * extension, both hands swept down-back (airfoil drag) then flaring wide
 * at the arc top. */
export const JUMP_LEAP_CLIP: Clip = makeClip('jumpLeap', [
  keyframe(0, { // BOARDING — momentum converts through the drive leg
    rootRot: 0.5, rootY: -1.5, spine: 0.14, head: -0.3,
    hipR: 1.0, kneeR: -0.9, footR: 0.28,
    hipL: -0.85, kneeL: -0.2, footL: -0.18,
    shR: -0.5, elR: -0.4, wrR: 5.05,
    shL: -0.35, elL: -0.5,
    pelvisYaw: 0.14, chestYaw: -0.08,
  }, 'outQuad'),
  keyframe(0.2, { // FLIGHT — the long horizontal body, hands flat down-back
    rootRot: 0.62, rootY: -2.6, spine: 0.12, head: -0.34,
    hipR: 1.25, kneeR: -0.5, footR: 0.3,
    hipL: -1.05, kneeL: -0.15, footL: -0.22,
    shR: -0.65, elR: -0.35, wrR: 5.1,
    shL: -0.5, elL: -0.45,
    pelvisYaw: 0.1, chestYaw: -0.06,
  }, 'outCubic'),
  keyframe(0.42, { // ARC TOP — hands flare wide, lead knee reaches for landing
    rootRot: 0.5, rootY: -3, spine: 0.1, head: -0.26,
    hipR: 0.9, kneeR: -0.85, footR: 0.2,
    hipL: -0.7, kneeL: -0.5, footL: -0.1,
    shR: 1.4, elR: -0.3, wrR: 5.4,
    shL: 1.2, elL: -0.4, armLz: 0.4,
  }, 'inOutCubic'),
])

/** air jump (double jump) — the mid-air redirect: the body COILS, then the
 * legs scissor (lead kicks forward, trail stamps down = the boost) while
 * BOTH HANDS slap down past the hips — Ghost of Tsushima / DMC flip read
 * without the flip. */
export const AIR_JUMP_CLIP: Clip = makeClip('airJump', [
  keyframe(0, { // COIL — everything folds in the air
    rootRot: 0.16, rootY: -2.5, spine: 0.06, head: -0.14,
    hipR: 0.6, kneeR: -1.8, footR: 0.12,
    hipL: 0.45, kneeL: -1.65, footL: 0.16,
    shR: 2.3, elR: -0.3, wrR: 6.95,
    shL: 2.1, elL: -0.35,
  }, 'outQuad'),
  keyframe(0.12, { // BOOST — leg scissor + the two-hand DOWN-slap
    rootRot: 0.22, rootY: -2.8, spine: 0.08, head: -0.16,
    hipR: 1.05, kneeR: -0.45, footR: 0.25,
    hipL: -0.6, kneeL: -0.25, footL: -0.15,
    shR: 0.55, elR: -0.25, wrR: 6.4,
    shL: 0.4, elL: -0.3,
  }, 'outCubic'),
  keyframe(0.32, { // SETTLE — arms flare into the fall spread
    rootRot: 0.14, rootY: -3, spine: 0.05, head: -0.12,
    hipR: 0.75, kneeR: -1.15, footR: 0.18,
    hipL: -0.2, kneeL: -0.9, footL: 0.2,
    shR: 1.85, elR: -0.3, wrR: 6.85,
    shL: 1.7, elL: -0.35, armLz: 0.35,
  }, 'inOutCubic'),
])

export const FALL_CLIP: Clip = makeClip('fall', [
  keyframe(0, { // opens FROM the apex tuck (continuity with the jump family)
    rootRot: 0.12, rootY: -3, spine: 0.06, head: -0.15,
    hipR: 0.55, kneeR: -1.7, footR: 0.14,
    hipL: 0.42, kneeL: -1.55, footL: 0.18,
    shR: 1.8, elR: -0.3, wrR: 6.9,
    shL: 1.65, elL: -0.35, armLz: 0.35,
  }, 'inOutCubic'),
  keyframe(0.4, { // DESCEND — hands spread WIDE, legs reaching for the ground
    rootRot: 0.16, rootY: -2.4, spine: 0.07, head: -0.12,
    hipR: 0.2, kneeR: -0.7, footR: 0.1,
    hipL: -0.32, kneeL: -0.6, footL: 0.18,
    shR: 1.95, elR: -0.2, wrR: 6.55,
    shL: 1.8, elL: -0.25, armLz: 0.5,
  }, 'inOutCubic'),
  keyframe(0.9, { // long-fall hold — slow leg cycle, hands riding the air
    rootRot: 0.13, rootY: -2.7, spine: 0.06, head: -0.12,
    hipR: 0.35, kneeR: -0.95, footR: 0.12,
    hipL: -0.12, kneeL: -0.8, footL: 0.16,
    shR: 1.85, elR: -0.25, wrR: 6.7,
    shL: 1.7, elL: -0.3, armLz: 0.4,
  }, 'inOutCubic'),
], true)

export const LAND_CLIP: Clip = makeClip('land', [
  keyframe(0, { // IMPACT — deep squat, BOTH HANDS reach down past the knees
    rootY: 7, rootRot: 0.4, spine: 0.14, head: -0.22,
    hipR: 0.62, kneeR: -1.4, footR: 0.24,
    hipL: -0.5, kneeL: -1.3, footL: 0.18,
    shR: 0.85, elR: -0.35, wrR: 6.1,
    shL: 0.7, elL: -0.4, armLz: 0.2,
  }, 'outQuad'),
  keyframe(0.26, { // RECOVER — rise, hands settle back toward the carry
    rootY: 1.5, rootRot: 0.16, spine: 0.05, head: -0.1,
    hipR: 0.35, kneeR: -0.5, footR: 0.12,
    hipL: -0.3, kneeL: -0.45, footL: 0.1,
    shR: 1.15, elR: -0.4, wrR: 6.35,
    shL: 0.6, elL: -0.7,
  }, 'outCubic'),
])

/* ------------------------------- SHEATHE / DRAW --------------------- */

/* THE SWORD HOME — notō and iai, the two halves of the same ritual
 * (Sword of the Stranger final sheathe / every samurai film's ending):
 *
 *   SHEATHE  a deliberate one-shot: the blade sweeps up into a vertical
 *            carry, the left hand finds the saya mouth at the hip, the
 *            tsuka tips BACK to meet it, and the steel slides home along
 *            the scabbard line — ending with the right fist resting on
 *            the pommel. Quiet, weighted, final.
 *   DRAW     the explosive inverse: stillness → the grip snaps onto the
 *            tsuka → the steel RIPS out along the rising diagonal into
 *            chūdan guard, the saya hand snapping to the saya to pin it.
 *            Drawn FAST — the iai beat is 0.12s from stillness to edge.
 *
 * The player gates the visuals (swordDrawn): while sheathed the blade is
 * inside the saya (not drawn) and the right hand rides the pommel. */

/** NOTŌ — sheathing. Slow, two-stage: present the blade → slide it home. */
export const SHEATHE_CLIP: Clip = makeClip('sheathe', [
  keyframe(0, { // settle out of whatever came before (guard)
    rootRot: 0.12, rootY: 0, spine: 0.05, head: -0.08,
    hipR: 0.34, kneeR: -0.55, footR: 0.12,
    hipL: -0.31, kneeL: -0.5, footL: 0.12,
    shR: 0.85, elR: -0.5, wrR: 1.15,
    shL: 0.5, elL: -0.85,
  }, 'inOutCubic'),
  keyframe(0.22, { // PRESENT — blade rises to the vertical carry, gaze softens
    rootRot: 0.09, rootY: 0.5, spine: 0.03, head: -0.04,
    hipR: 0.3, kneeR: -0.6, footR: 0.1,
    hipL: -0.3, kneeL: -0.55, footL: 0.12,
    shR: 1.45, elR: -0.75, wrR: 2.6, // blade up — kissaki over the shoulder
    shL: 0.25, elL: -0.5, // left hand drifts toward the saya mouth
    armLz: -0.2,
  }, 'inOutCubic'),
  keyframe(0.42, { // MEET — tsuka tips back to the saya mouth
    rootRot: 0.08, rootY: 0.8, spine: 0.02, head: -0.02,
    hipR: 0.28, kneeR: -0.65, footR: 0.1,
    hipL: -0.3, kneeL: -0.58, footL: 0.12,
    shR: 0.9, elR: -1.15, wrR: 3.9, // blade laid back along the scabbard line
    shL: -0.1, elL: -0.35, armLz: -0.3,
  }, 'inOutSine'),
  keyframe(0.62, { // SLIDE — steel runs home to the kojiri. The right
    // fist rides the tsuka ~at the kashira line (IK: shR 0.8/elR −1.05
    // keeps the hand at navel-forward height — the old shR −0.25 drag
    // pulled the fist 25 units behind the saya mouth into the hip blob)
    rootRot: 0.08, rootY: 0.6, spine: 0.02, head: 0,
    hipR: 0.28, kneeR: -0.62, footR: 0.1,
    hipL: -0.3, kneeL: -0.58, footL: 0.12,
    shR: 0.8, elR: -1.05, wrR: 4.9, // hand follows the blade in, ON the grip
    shL: -0.15, elL: -0.3, armLz: -0.28,
  }, 'inOutCubic'),
  keyframe(0.85, { // REST — fist settles on the pommel; the body quiet.
    // IK-solved anatomical rest (matches the sheath home-arm layer):
    // hand EXACTLY on the kashira 22 units forward of the hip, elbow
    // interior ~124° — the samurai rest, never a backward-straight reach
    rootRot: 0.06, rootY: 0.4, spine: 0.01, head: -0.02,
    hipR: 0.3, kneeR: -0.58, footR: 0.1,
    hipL: -0.3, kneeL: -0.55, footL: 0.12,
    shR: 0.93, elR: -0.98, wrR: 5.0, // hand on the kashira at navel height
    shL: 0.49, elL: -1.0, armLz: 0.2, // left hand on the saya mouth
  }, 'outCubic'),
])

/** IAI — the draw. Fast, three beats: stillness → grip → EXPLOSION into guard. */
export const DRAW_CLIP: Clip = makeClip('draw', [
  keyframe(0, { // stillness — hand on the pommel (sheathed rest pose,
    // SAME anatomical rest as SHEATHE_CLIP's end: hand ON the kashira,
    // elbow interior ~124°, iaido reference shoulder +55°)
    rootRot: 0.06, rootY: 0.4, spine: 0.01, head: -0.02,
    hipR: 0.3, kneeR: -0.58, footR: 0.1,
    hipL: -0.3, kneeL: -0.55, footL: 0.12,
    shR: 0.93, elR: -0.98, wrR: 5.0,
    shL: 0.49, elL: -1.0, armLz: 0.2,
  }, 'outQuad'),
  keyframe(0.07, { // GRIP — the hand closes on the tsuka and lifts it out
    // of the mouth (sayabiki: the LEFT arm pulls the saya back instead)
    rootRot: 0.02, rootY: 1.6, spine: 0.03, head: -0.14,
    hipR: 0.42, kneeR: -0.75, footR: 0.18,
    hipL: -0.36, kneeL: -0.7, footL: 0.1,
    shR: 0.82, elR: -0.75, wrR: 4.85, // tsuka lifts out of the mouth
    shL: 0.25, elL: -0.6, armLz: -0.3,
    pelvisYaw: -0.12,
  }, 'inQuad'),
  keyframe(0.16, { // EXPLOSION — the steel rips out along the rising diagonal
    rootRot: 0.3, rootY: -1.2, spine: 0.12, head: -0.3,
    hipR: 0.6, kneeR: -1.05, footR: 0.26,
    hipL: -0.55, kneeL: -0.35, footL: -0.08,
    shR: 1.55, elR: -0.3, wrR: 0.45, // edge flashing forward-up, elbow extending
    shL: 0.3, elL: -0.8, armLz: -0.1,
    pelvisYaw: 0.14, chestYaw: -0.08,
  }, 'outQuart'),
  keyframe(0.3, { // SETTLE — chūdan guard, the breath after the draw
    rootRot: 0.1, rootY: 0, spine: 0.05, head: -0.1,
    hipR: 0.34, kneeR: -0.55, footR: 0.12,
    hipL: -0.31, kneeL: -0.5, footL: 0.12,
    shR: 0.85, elR: -0.5, wrR: 1.15,
    shL: 0.5, elL: -0.85,
  }, 'outCubic'),
])

/* ------------------------------- DASH -------------------------------- */

/* THE CONDITIONED DASH LIBRARY — nine genuinely distinct evasion/closing
 * systems. The variant is chosen by the CONDITIONED ACTIVATION SYSTEM
 * (combat/dash.ts: evaluateDash) from the situation at the input instant:
 * airborne · input-vs-facing · momentum at initiation · threat geometry
 * (pocket / hunt-range / surrounded) · chain count. Never one animation
 * played at different speeds.
 *
 * Authored from dash reference keyframes (movies / anime / AAA — VLM
 * lean research: launch 35–45°+, glide −15–20° held, catch overshoots
 * upright briefly, settle to guard; the launch accent may spike deeper
 * for single frames):
 *  · LAUNCH  the iai explosion from a standing start (Sword of the
 *            Stranger / MGR:R Raiden): weight crashes onto the push-off
 *            leg, then ONE full-extension stride — the power line runs
 *            rear toe → rear hip → shoulder → crown on a single ~45–52°
 *            diagonal (THE most-leaned state in the game — sprint owns
 *            max-velocity ~20°, dash owns acceleration ~45°+).
 *            Head counter-pitches: the eyes stay UP. Blade chambered back
 *            through depth (bladeYaw −0.5) — iai-ready for the through-cut.
 *  · CHAIN   the second chained dash: the MIRRORED stride of LAUNCH —
 *            dash-spam reads as alternating drives, not a loop.
 *  · CARRY   initiated from a run/sprint: NO re-coil — the run feeds the
 *            dash (momentum-matched entry, the shunshin / ninja run:
 *            torso deep, BOTH arms trailing back, legs mid-scissor).
 *  · HUNT    gap-closing an enemy 240–640 ahead (fencing drive / Sekiro
 *            chase): lower, longer, gaze LOCKED on the target — the head
 *            rides higher than the shoulders (the predator read).
 *  · PIERCE  an enemy INSIDE the pocket (<170): the fencing lunge
 *            silhouette — torso stays UPRIGHT, front knee at 90°, rear
 *            leg fully extended, blade on the LEVEL thrust line riding
 *            +Z through the body plane (Sekiro Shadowrush / Yasuo E).
 *  · RETREAT guarded retreat (fencing retreat / MGR dash-out): chest
 *            opens BACK, head counter-rotates forward — eyes never leave
 *            the threat; guard presented HIGH (deflection plane); rear
 *            leg reaches back as the landing strut.
 *  · VAULT   the vertical escape: crouch coil → full-extension rise with
 *            pointed toes, blade sweeping through a rising cut arc.
 *  · AIR     the horizontal air scissor: body pitched toward travel,
 *            legs scissor then tuck, arms balance wide.
 *  · CARVE   the surrounded breakaway (Nier:Automata evade): the body
 *            YAWS through the transverse plane — pelvis/chest counter-
 *            rotate while the blade sweeps a wide clearing arc and the
 *            whole silhouette rolls toward the exit vector.
 *
 * WINDING: locomotion-family carries are up-wound (wrR + 2π where needed)
 * so every carry-to-carry crossfade sweeps the UP hemisphere — never
 * through straight-down (the kissaki would dig the floor mid-blend). */
const DASH_LAUNCH_Q: PoseInput[] = [
  { // COIL — weight crashes onto the rear leg, hips coil away (counter-wind)
    rootX: -1, rootRot: 0.02, rootY: 8.5, spine: 0.02, head: -0.02,
    hipR: 0.55, kneeR: -0.35, footR: 0.3,
    hipL: -0.35, kneeL: -1.15, footL: 0.05,
    shR: -0.05, elR: -0.85, wrR: 5.15,
    shL: 0.35, elL: -1.05,
    pelvisYaw: -0.12, chestYaw: 0.1,
  },
  { // EXPLODE — the POWER LINE: rear toe→hip→shoulder→crown on one ~45°
    // diagonal; the deepest committed pitch in the locomotion set
    rootX: 8, rootRot: 0.78, rootY: 4.2, spine: 0.17, head: -0.55,
    hipR: 1.3, kneeR: -1.45, footR: 0.35,
    hipL: -1.15, kneeL: -0.12, footL: -0.22,
    shR: -0.5, elR: -0.4, wrR: 5.25,
    shL: 0.35, elL: -0.75,
    pelvisYaw: 0.16, chestYaw: -0.1,
    armLz: 0.25, armRz: -0.35, bladeYaw: -0.5,
  },
  { // GLIDE — hold the committed line (~38–40°); rear heel recovers toward
    // the butt
    rootX: 11, rootRot: 0.7, rootY: 3.6, spine: 0.16, head: -0.52,
    hipR: 1.05, kneeR: -0.7, footR: 0.3,
    hipL: -0.6, kneeL: -1.35, footL: 0.25,
    shR: -0.4, elR: -0.45, wrR: 5.3,
    shL: 0.3, elL: -0.7,
    pelvisYaw: 0.1, chestYaw: -0.06,
    armLz: 0.18, armRz: -0.3, bladeYaw: -0.42,
  },
  { // CATCH — lead foot brakes FAR forward; COG absorbs over the bending
    // leg — the pitch unwinds hard toward upright (the brake counter-lean)
    rootX: 8, rootRot: 0.36, rootY: 5.2, spine: 0.1, head: -0.3,
    hipR: 0.8, kneeR: -1.05, footR: 0.18,
    hipL: -0.75, kneeL: -0.5, footL: 0.1,
    shR: -0.1, elR: -0.5, wrR: 5.5,
    shL: 0.45, elL: -0.8,
    armRz: -0.18, bladeYaw: -0.26,
  },
  { // SETTLE — rise toward the guard, blade presenting forward
    rootX: 4.5, rootRot: 0.24, rootY: 3.2, spine: 0.06, head: -0.18,
    hipR: 0.45, kneeR: -0.7, footR: 0.14,
    hipL: -0.45, kneeL: -0.55, footL: 0.12,
    shR: 0.4, elR: -0.5, wrR: 5.75,
    shL: 0.5, elL: -0.85,
    armRz: -0.1, bladeYaw: -0.12,
  },
]

export const DASH_LAUNCH_CLIP: Clip = makeClip('dashLaunch', [
  keyframe(0, DASH_LAUNCH_Q[0], 'outCubic'),
  keyframe(0.035, DASH_LAUNCH_Q[1], 'outQuad'),
  keyframe(0.11, DASH_LAUNCH_Q[2], 'outQuad'),
  keyframe(0.165, DASH_LAUNCH_Q[3], 'inOutCubic'),
  keyframe(0.24, DASH_LAUNCH_Q[4], 'inOutCubic'),
])

/** chained second dash — the MIRRORED stride (left leg leads): dash-spam
 * reads as alternating drives. Sword arm keeps the same carry. */
export const DASH_CHAIN_CLIP: Clip = makeClip('dashChain', [
  keyframe(0, mirrorLegs(DASH_LAUNCH_Q[0]), 'outCubic'),
  keyframe(0.035, mirrorLegs(DASH_LAUNCH_Q[1]), 'outQuad'),
  keyframe(0.11, mirrorLegs(DASH_LAUNCH_Q[2]), 'outQuad'),
  keyframe(0.165, mirrorLegs(DASH_LAUNCH_Q[3]), 'inOutCubic'),
  keyframe(0.24, mirrorLegs(DASH_LAUNCH_Q[4]), 'inOutCubic'),
])

const DASH_CARRY_Q: PoseInput[] = [
  { // STRIDE — enters MID-SCISSOR (momentum-matched: the run feeds the
    // dash; NO coil from standing). The shunshin: BOTH arms trail back,
    // torso driven DEEP (~46°) — the strongest sustained lean in the game,
    // clearly past the sprint's max-velocity posture.
    rootX: 9, rootRot: 0.8, rootY: 4.5, spine: 0.17, head: -0.6,
    hipR: 1.15, kneeR: -0.55, footR: 0.32,
    hipL: -0.8, kneeL: -1.6, footL: 0.28,
    shR: -0.55, elR: -0.35, wrR: 5.35,
    shL: -0.35, elL: -0.55,
    pelvisYaw: 0.14, chestYaw: -0.08,
    armLz: -0.3, armRz: -0.45, bladeYaw: -0.55,
  },
  { // SCISSOR PASS — the other knee punches through; arms stay trailing
    rootX: 11, rootRot: 0.76, rootY: 4, spine: 0.16, head: -0.58,
    hipR: 0.3, kneeR: -1.15, footR: 0.18,
    hipL: 0.9, kneeL: -0.9, footL: 0.3,
    shR: -0.5, elR: -0.38, wrR: 5.38,
    shL: -0.3, elL: -0.55,
    pelvisYaw: -0.06, chestYaw: 0.04,
    armLz: -0.28, armRz: -0.42, bladeYaw: -0.5,
  },
  { // CATCH — brake beat far forward, torso still committed
    rootX: 8.5, rootRot: 0.5, rootY: 5, spine: 0.12, head: -0.4,
    hipR: 0.85, kneeR: -1.0, footR: 0.2,
    hipL: -0.7, kneeL: -0.55, footL: 0.12,
    shR: -0.25, elR: -0.45, wrR: 5.45,
    shL: 0.0, elL: -0.65,
    armRz: -0.2, bladeYaw: -0.28,
  },
  { // SETTLE — momentum hands off into the run
    rootX: 5, rootRot: 0.3, rootY: 3.4, spine: 0.08, head: -0.24,
    hipR: 0.5, kneeR: -0.7, footR: 0.14,
    hipL: -0.4, kneeL: -0.58, footL: 0.12,
    shR: 0.2, elR: -0.5, wrR: 5.7,
    shL: 0.3, elL: -0.75,
    armRz: -0.1, bladeYaw: -0.15,
  },
]

export const DASH_CARRY_CLIP: Clip = makeClip('dashCarry', [
  keyframe(0, DASH_CARRY_Q[0], 'outQuad'),
  keyframe(0.06, DASH_CARRY_Q[1], 'inOutSine'),
  keyframe(0.14, DASH_CARRY_Q[2], 'inOutCubic'),
  keyframe(0.21, DASH_CARRY_Q[3], 'inOutCubic'),
])

const DASH_HUNT_Q: PoseInput[] = [
  { // WIND — a heartbeat of load (shorter than LAUNCH: the hunger is urgent)
    rootX: 0, rootRot: 0.06, rootY: 7.5, spine: 0.03, head: -0.04,
    hipR: 0.5, kneeR: -0.3, footR: 0.32,
    hipL: -0.3, kneeL: -1.05, footL: 0.05,
    shR: -0.1, elR: -0.8, wrR: 5.2,
    shL: 0.3, elL: -1.0,
    pelvisYaw: -0.1, chestYaw: 0.08,
  },
  { // THE DRIVE — maximum lunge silhouette (~47° pitch — the predator
    // read): stride split WIDE, hips LOW, gaze riding HIGH above the
    // shoulders — locked on prey
    rootX: 10, rootRot: 0.84, rootY: 5, spine: 0.18, head: -0.38,
    hipR: 1.4, kneeR: -0.6, footR: 0.34,
    hipL: -1.05, kneeL: -0.15, footL: -0.2,
    shR: -0.45, elR: -0.4, wrR: 5.25,
    shL: 0.25, elL: -0.7,
    pelvisYaw: 0.14, chestYaw: -0.1,
    armLz: 0.2, armRz: -0.4, bladeYaw: -0.55,
  },
  { // GLIDE — the wide split holds (~42°); the kissaki trains through depth
    rootX: 13, rootRot: 0.76, rootY: 4.6, spine: 0.17, head: -0.34,
    hipR: 1.2, kneeR: -0.75, footR: 0.32,
    hipL: -0.75, kneeL: -1.2, footL: 0.22,
    shR: -0.4, elR: -0.42, wrR: 5.3,
    shL: 0.2, elL: -0.68,
    pelvisYaw: 0.08, chestYaw: -0.06,
    armRz: -0.32, bladeYaw: -0.45,
  },
  { // CATCH — brake far forward; the blade is already rising to strike
    rootX: 9.5, rootRot: 0.46, rootY: 5.4, spine: 0.1, head: -0.3,
    hipR: 0.85, kneeR: -1.1, footR: 0.2,
    hipL: -0.8, kneeL: -0.5, footL: 0.1,
    shR: -0.05, elR: -0.5, wrR: 5.55,
    shL: 0.4, elL: -0.8,
    armRz: -0.16, bladeYaw: -0.22,
  },
  { // SETTLE — into strike range, blade at the mid line, coiled
    rootX: 5.5, rootRot: 0.26, rootY: 3.4, spine: 0.07, head: -0.2,
    hipR: 0.5, kneeR: -0.72, footR: 0.14,
    hipL: -0.42, kneeL: -0.58, footL: 0.12,
    shR: 0.45, elR: -0.5, wrR: 5.7,
    shL: 0.5, elL: -0.85,
    armRz: -0.08, bladeYaw: -0.1,
  },
]

export const DASH_HUNT_CLIP: Clip = makeClip('dashHunt', [
  keyframe(0, DASH_HUNT_Q[0], 'outCubic'),
  keyframe(0.04, DASH_HUNT_Q[1], 'outQuad'),
  keyframe(0.13, DASH_HUNT_Q[2], 'outQuad'),
  keyframe(0.19, DASH_HUNT_Q[3], 'inOutCubic'),
  keyframe(0.27, DASH_HUNT_Q[4], 'inOutCubic'),
])

const DASH_PIERCE_Q: PoseInput[] = [
  { // CHAMBER — compact: weight back, blade drawn to the hip, body small
    rootX: -2, rootRot: 0.1, rootY: 6.5, spine: 0.04, head: -0.08,
    hipR: 0.45, kneeR: -0.5, footR: 0.28,
    hipL: -0.3, kneeL: -1.25, footL: 0.05,
    shR: -0.15, elR: -1.2, wrR: 0.35,
    shL: 0.4, elL: -0.9,
    pelvisYaw: -0.1, chestYaw: 0.08,
  },
  { // THE LUNGE (fencing silhouette): torso UPRIGHT, front knee 90°, rear
    // leg fully extended, blade on the LEVEL thrust line reaching FAR —
    // the arm LOCKED OUT straight along the travel vector (throat height)
    rootX: 6, rootRot: 0.14, rootY: 5.5, spine: 0.03, head: -0.08,
    hipR: 0.85, kneeR: -1.55, footR: 0.15,
    hipL: -1.05, kneeL: -0.08, footL: -0.25,
    shR: 1.4, elR: 0.0, wrR: 0.3,
    shL: -0.7, elL: -0.35,
    pelvisYaw: 0.1, chestYaw: -0.06,
    bladeZ: 1.5,
  },
  { // PASS — riding through the target: the weapon slides +Z past the body
    // plane as the lunge extends under it; thrust line holds level
    rootX: 10, rootRot: 0.16, rootY: 5.2, spine: 0.03, head: -0.08,
    hipR: 0.8, kneeR: -1.5, footR: 0.14,
    hipL: -0.95, kneeL: -0.15, footL: -0.22,
    shR: 1.42, elR: 0.0, wrR: 0.28,
    shL: -0.75, elL: -0.3,
    pelvisYaw: 0.08, chestYaw: -0.05,
    bladeZ: 5,
  },
  { // RECOVER — pull the blade back through the line, rear leg steps under
    rootX: 8, rootRot: 0.2, rootY: 4.2, spine: 0.05, head: -0.1,
    hipR: 0.6, kneeR: -1.15, footR: 0.14,
    hipL: 0.2, kneeL: -0.9, footL: 0.1,
    shR: 0.95, elR: -0.55, wrR: 1.2,
    shL: 0.1, elL: -0.6,
    bladeZ: 2,
  },
  { // SETTLE — guard re-formed inside the new spacing
    rootX: 5, rootRot: 0.22, rootY: 3.2, spine: 0.06, head: -0.16,
    hipR: 0.45, kneeR: -0.7, footR: 0.14,
    hipL: -0.45, kneeL: -0.55, footL: 0.12,
    shR: 0.7, elR: -0.5, wrR: 1.3,
    shL: 0.5, elL: -0.85,
    bladeZ: 0.5,
  },
]

export const DASH_PIERCE_CLIP: Clip = makeClip('dashPierce', [
  keyframe(0, DASH_PIERCE_Q[0], 'outCubic'),
  keyframe(0.05, DASH_PIERCE_Q[1], 'outQuad'),
  keyframe(0.12, DASH_PIERCE_Q[2], 'outQuad'),
  keyframe(0.18, DASH_PIERCE_Q[3], 'inOutCubic'),
  keyframe(0.26, DASH_PIERCE_Q[4], 'inOutCubic'),
])

const DASH_RETREAT_Q: PoseInput[] = [
  { // PUSH-OFF — weight crashes onto the FRONT foot; chest opens BACK hard
    // while the head counter-rotates FORWARD — eyes never leave the threat
    // (the counter-pitch + chest yaw toward the enemy sell the read)
    rootX: -1, rootRot: -0.42, rootY: 5, spine: -0.1, head: 0.38,
    hipR: 0.55, kneeR: -1.25, footR: 0.2,
    hipL: -0.7, kneeL: -0.4, footL: 0.1,
    shR: 1.15, elR: -0.4, wrR: 1.5, // guard presented HIGH (deflection plane)
    shL: 0.9, elL: -0.75, wrL: -0.35,
    pelvisYaw: -0.14, chestYaw: 0.18,
  },
  { // DRIFT — body rides back flat; rear leg extends as the landing strut;
    // the head KEEPS tracking the threat over the opening chest
    rootX: -5, rootRot: -0.3, rootY: 3, spine: -0.06, head: 0.3,
    hipR: 0.35, kneeR: -1.1, footR: 0.18,
    hipL: -0.95, kneeL: -0.35, footL: 0.24,
    shR: 1.1, elR: -0.42, wrR: 1.45,
    shL: 0.75, elL: -0.8, wrL: -0.3,
    pelvisYaw: -0.1, chestYaw: 0.12,
  },
  { // BRAKE-CATCH — rear foot plants & loads; COG settles over it
    rootX: -6.5, rootRot: -0.12, rootY: 4, spine: 0.02, head: 0.04,
    hipR: 0.25, kneeR: -0.9, footR: 0.14,
    hipL: -0.55, kneeL: -0.85, footL: 0.16,
    shR: 1.0, elR: -0.45, wrR: 1.3,
    shL: 0.6, elL: -0.8, wrL: -0.3,
  },
  { // GUARD — re-formed, square to the threat, blade live
    rootX: -3, rootRot: 0.06, rootY: 2.6, spine: 0.05, head: -0.1,
    hipR: 0.34, kneeR: -0.6, footR: 0.12,
    hipL: -0.34, kneeL: -0.52, footL: 0.12,
    shR: 0.9, elR: -0.5, wrR: 1.2,
    shL: 0.5, elL: -0.82, wrL: -0.3,
  },
]

export const DASH_RETREAT_CLIP: Clip = makeClip('dashRetreat', [
  keyframe(0, DASH_RETREAT_Q[0], 'outQuad'),
  keyframe(0.055, DASH_RETREAT_Q[1], 'inOutCubic'),
  keyframe(0.115, DASH_RETREAT_Q[2], 'inOutCubic'),
  keyframe(0.2, DASH_RETREAT_Q[3], 'outCubic'),
])

export const DASH_VAULT_CLIP: Clip = makeClip('dashVault', [
  keyframe(0, { // DEEP coil — arms load back, blade drawn to the back carry
    rootRot: 0.14, rootY: 9, spine: 0.05, head: -0.1,
    hipR: 0.55, kneeR: -1.6, footR: 0.22,
    hipL: -0.45, kneeL: -1.55, footL: 0.2,
    shR: -0.2, elR: -0.7, wrR: 4.6,
    shL: -0.45, elL: -0.6,
  }, 'outQuad'),
  keyframe(0.05, { // FULL-EXTENSION RISE — toes pointed; the blade traces
    // the rising cut arc through the vertical (sweep distributed: coil →
    // vertical → high guard — never one windmill snap)
    rootRot: 0.08, rootY: -3.5, spine: -0.02, head: -0.2,
    hipR: -0.2, kneeR: -0.12, footR: 0.38,
    hipL: 0.1, kneeL: -0.15, footL: 0.36,
    shR: 2.0, elR: -0.15, wrR: 3.4,
    shL: 1.5, elL: -0.35,
    armRz: 0.1, bladeYaw: 0.1,
  }, 'outQuad'),
  keyframe(0.12, { // APEX — legs begin to fold; the arc completes into
    // the high guard (kissaki up-forward)
    rootRot: 0.1, rootY: -2, spine: 0.03, head: -0.16,
    hipR: -0.05, kneeR: -0.55, footR: 0.26,
    hipL: 0.18, kneeL: -0.5, footL: 0.24,
    shR: 1.6, elR: -0.35, wrR: 1.35,
    shL: 0.9, elL: -0.55,
  }, 'inOutSine'),
  keyframe(0.2, { // settle tuck toward the falling guard
    rootRot: 0.12, rootY: -1, spine: 0.05, head: -0.14,
    hipR: 0.05, kneeR: -0.75, footR: 0.2,
    hipL: 0.2, kneeL: -0.65, footL: 0.18,
    shR: 1.2, elR: -0.45, wrR: 1.3,
    shL: 0.6, elL: -0.7,
  }, 'inOutCubic'),
])

export const DASH_AIR_CLIP: Clip = makeClip('dashAir', [
  keyframe(0, { // TUCK — knees up, torso toward travel; blade ALREADY
    // chambered back through depth (the guard→chamber sweep happens in the
    // entry crossfade — a wrist windmill inside the clip would strobe)
    rootRot: 0.55, rootY: 0.5, spine: 0.12, head: -0.4,
    hipR: 0.85, kneeR: -1.6, footR: -0.05,
    hipL: 0.7, kneeL: -1.5, footL: 0.12,
    shR: 0.35, elR: -0.4, wrR: 5.15,
    shL: 0.75, elL: -0.5, armLz: 0.35,
    armRz: -0.25, bladeYaw: -0.3,
  }, 'outCubic'),
  keyframe(0.08, { // SCISSOR — front knee punches, rear trails; chamber
    // rides deeper through depth (the air-dash tell)
    rootRot: 0.6, rootY: 1, spine: 0.13, head: -0.42,
    hipR: 1.05, kneeR: -0.85, footR: 0.18,
    hipL: -0.95, kneeL: -0.7, footL: 0.28,
    shR: -0.35, elR: -0.4, wrR: 5.35,
    shL: 0.7, elL: -0.5, armLz: 0.2,
    armRz: -0.4, bladeYaw: -0.45,
  }, 'outQuad'),
  keyframe(0.2, { // settle tuck toward guard
    rootRot: 0.32, rootY: 0, spine: 0.08, head: -0.24,
    hipR: 0.35, kneeR: -1.2, footR: 0.1,
    hipL: 0.3, kneeL: -1.1, footL: 0.12,
    shR: 0.5, elR: -0.5, wrR: 5.6,
    shL: 0.5, elL: -0.6, armLz: 0.1,
    armRz: -0.18, bladeYaw: -0.2,
  }, 'inOutCubic'),
])

const DASH_CARVE_Q: PoseInput[] = [
  { // COIL LOW in the pocket — pelvis already pre-wound; blade starts
    // rising out of the back-down carry (the sweep is distributed across
    // THREE beats — a 260° windmill in one easing span would strobe)
    rootX: -1, rootRot: 0.24, rootY: 7.5, spine: 0.1, head: -0.16,
    hipR: 0.55, kneeR: -1.5, footR: 0.2,
    hipL: -0.45, kneeL: -1.45, footL: 0.18,
    shR: 0.65, elR: -0.45, wrR: 4.65,
    shL: 0.7, elL: -0.9, wrL: -0.35,
    pelvisYaw: 0.35, chestYaw: -0.22,
  },
  { // MID-SWEEP — the kissaki passes the vertical: blade UP, body already
    // committing into the yaw
    rootX: -2.2, rootRot: 0.06, rootY: 6, spine: 0.05, head: -0.04,
    hipR: 0.4, kneeR: -1.3, footR: 0.19,
    hipL: -0.48, kneeL: -1.2, footL: 0.17,
    shR: 0.8, elR: -0.35, wrR: 3.05,
    shL: 0.95, elL: -0.8, wrL: -0.28,
    pelvisYaw: 0.85, chestYaw: -0.55,
    armLz: 0.2,
  },
  { // THE CARVE — body yaws HARD through the transverse plane (Nier evade
    // roll): pelvis/chest counter-rotate, silhouette rolls toward the exit,
    // blade completing the wide clearing arc through depth
    rootX: -3.5, rootRot: -0.18, rootY: 4.5, spine: -0.02, head: 0.12,
    hipR: 0.25, kneeR: -1.15, footR: 0.18,
    hipL: -0.5, kneeL: -0.95, footL: 0.16,
    shR: 0.95, elR: -0.3, wrR: 0.75,
    shL: 1.2, elL: -0.7, wrL: -0.2,
    pelvisYaw: 1.35, chestYaw: -0.85,
    hipRz: -0.3, armLz: 0.4, armRz: 0.15, bladeYaw: -0.7,
  },
  { // UNWIND — guard re-forming as the body exits the pocket
    rootX: -5, rootRot: -0.04, rootY: 4, spine: 0.03, head: -0.06,
    hipR: 0.25, kneeR: -0.85, footR: 0.15,
    hipL: -0.5, kneeL: -0.8, footL: 0.15,
    shR: 0.85, elR: -0.5, wrR: 1.1,
    shL: 0.6, elL: -0.8, wrL: -0.28,
    pelvisYaw: 0.5, chestYaw: -0.3,
  },
  { // GUARD — out, square, blade live
    rootX: -2, rootRot: 0.08, rootY: 2.6, spine: 0.05, head: -0.1,
    hipR: 0.34, kneeR: -0.6, footR: 0.12,
    hipL: -0.34, kneeL: -0.52, footL: 0.12,
    shR: 0.85, elR: -0.5, wrR: 1.15,
    shL: 0.5, elL: -0.82, wrL: -0.3,
  },
]

export const DASH_CARVE_CLIP: Clip = makeClip('dashCarve', [
  keyframe(0, DASH_CARVE_Q[0], 'inOutSine'),
  keyframe(0.05, DASH_CARVE_Q[1], 'inOutSine'),
  keyframe(0.13, DASH_CARVE_Q[2], 'inOutSine'),
  keyframe(0.19, DASH_CARVE_Q[3], 'inOutCubic'),
  keyframe(0.27, DASH_CARVE_Q[4], 'outCubic'),
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
