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
import { PLAYER_SPEC } from './skeleton'

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

/** Hand-space authoring for human gait. This fixes the old shoulder-only
 * mirroring, which moved both hands behind the torso instead of producing
 * a genuine contralateral arm swing. The elbow pole is solved by the rig.
 */
function humanFreeArm(x: number, y: number): PoseInput {
  const upper = PLAYER_SPEC.upperArm, fore = PLAYER_SPEC.foreArm
  const r = Math.max(12, Math.min(upper + fore - 2, Math.hypot(x, y)))
  const angle = Math.acos(Math.max(-1, Math.min(1, (upper*upper + r*r - fore*fore) / (2*upper*r))))
  const flex = -(Math.PI - Math.acos(Math.max(-1, Math.min(1, (upper*upper + fore*fore - r*r) / (2*upper*fore)))))
  return { shL: Math.atan2(x, y) + angle, elL: flex }
}
function mirrorHumanStride(src: PoseInput): PoseInput {
  const sh = src.shL ?? 0, el = src.elL ?? -.45
  const x = PLAYER_SPEC.upperArm*Math.sin(sh) + PLAYER_SPEC.foreArm*Math.sin(sh + el)
  const y = PLAYER_SPEC.upperArm*Math.cos(sh) + PLAYER_SPEC.foreArm*Math.cos(sh + el)
  // Sprint backswing drops the hand toward the hip; reflecting only X
  // would put the rear fist unnaturally up behind the shoulder.
  const mirroredY = (src.rootRot ?? 0) > .13
    ? y + (-x < 0 ? Math.min(12, Math.abs(x) * .8) : -Math.min(8, Math.abs(x) * .4)) : y
  return { ...mirrorStride(src), ...humanFreeArm(-x, mirroredY) }
}

/* ------------------------------- IDLE ------------------------------- */

/* Upright Shadow Ronin standing: proud posture, naturally aligned spine,
 * hand resting on the tsuka at the hip, off-hand resting on the saya,
 * tucked elbows. Gentle diaphragmatic breathing cycle. */
/** Quiet hanmi / iai readiness: lowered center, rear foot back, angled
 * pelvis/chest and chin tucked. Breathing never unlocks the knees. */
const RONIN_REST: PoseInput = {
  rootX: 2.0, rootY: 3.3, rootRot: .12, spine: .025, head: -.055,
  shR: .12, elR: -.56, wrR: 1.18,
  ...humanFreeArm(7, 29), wrL: -.15,
  hipR: .48, kneeR: -.56, footR: .14,
  hipL: -.32, kneeL: -.34, footL: -.08,
  pelvisYaw: .15, chestYaw: -.16, armLz: -.07, armRz: .04,
}
export const IDLE_CLIP: Clip = makeClip('idle', [
  keyframe(0, RONIN_REST, 'inOutSine'),
  keyframe(.85,{...RONIN_REST,rootX:2.12,rootY:3.05,rootRot:.116,
    spine:.03,head:-.057,chestYaw:-.155,shL:.87,elL:-1.35},'inOutSine'),
  keyframe(1.75,{...RONIN_REST,rootX:2.25,rootY:2.6,rootRot:.11,
    spine:.038,head:-.06,pelvisYaw:.143,chestYaw:-.142,
    shR:.105,elR:-.59,shL:.88,elL:-1.37},'inOutSine'),
  keyframe(2.55,{...RONIN_REST,rootX:2.28,rootY:2.65,rootRot:.112,
    spine:.035,head:-.058,pelvisYaw:.14,chestYaw:-.145,
    shR:.11,elR:-.60,shL:.89,elL:-1.38},'inOutSine'),
  keyframe(3.65,{...RONIN_REST,rootX:1.88,rootY:3.48,rootRot:.124,
    spine:.022,head:-.053,pelvisYaw:.154,chestYaw:-.166,
    shR:.13,elR:-.55,shL:.855,elL:-1.32},'inOutSine'),
  keyframe(4.5,{...RONIN_REST,rootX:1.92,rootY:3.4,rootRot:.122,
    spine:.023,head:-.054,chestYaw:-.164,shL:.85,elL:-1.325},'inOutSine'),
  keyframe(5.4, RONIN_REST, 'inOutSine'),
], true)
IDLE_CLIP.interpolation = 'monotone'

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

// Rituals inherit the same relaxed-but-ready center of mass as the rest.
for (const clip of [FLOURISH_TSUBA_POP_CLIP, FLOURISH_HILT_SPIN_CLIP,
  FLOURISH_SCARF_ADJUST_CLIP, FLOURISH_STANCE_SETTLE_CLIP]) {
  for (const frame of clip.frames) {
    frame.p[0] += 2; frame.p[1] += 3.3; frame.p[2] += .12
    frame.p[3] += .025; frame.p[4] -= .055
    frame.p[5] -= .22; frame.p[6] -= .20; frame.p[7] -= .14
    frame.p[8] += .38; frame.p[9] -= .42; frame.p[10] += .08
    frame.p[11] += .12; frame.p[12] -= .27; frame.p[15] -= .04
    frame.p[18] += .11; frame.p[19] -= .14
  }
}

/** Walk is authored independently; the former WALK_Q implementation was removed. */
export {WALK_CLIP,WALK_EXPOSURES} from './patrol-walk'

/* ------------------------------- RUN -------------------------------- */

/* Athletic martial run: controlled core, tucked elbows, sword stabilized at hip. */
const RUN_Q: PoseInput[] = [
  { // CONTACT
    rootX: 1.5, rootY: 0.4, rootRot: 0.08, spine: 0.02, head: -0.04,
    hipR: 0.72, kneeR: -0.18, footR: 0.20,
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

const runHands = [[13,23],[4,26],[-10,29]]
RUN_Q.forEach((pose,i)=>Object.assign(pose,humanFreeArm(...runHands[i] as [number,number])))
for (const pose of RUN_Q) {
  pose.armLz = (pose.armLz ?? 0) * .25
  pose.foreLz = (pose.foreLz ?? 0) * .25
  pose.rootRot = (pose.rootRot ?? 0) + .0555
  pose.rootX = (pose.rootX ?? 0) + 1
  pose.head = .035 - (pose.rootRot ?? 0) - (pose.spine ?? 0)
}
const RUN_DUR = 0.5
const runB = (q: PoseInput, shR: number, elR: number): PoseInput => ({
  ...mirrorHumanStride(q), shR, elR,
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

/** SHADOW RONIN / SPRINT — forefoot strike, compression, drive, toe-off,
 * flight and recovery. Sustained speed uses a modest 10–12° pitch, not
 * a permanent acceleration fold. A short bent sword-side arm stabilizes the hilt;
 * the free arm drives through a full counter-swing. Avoid rigid arms.
 */
const SPRINT_Q: PoseInput[] = [
  { // 01 / forefoot strike: foot lands under the advancing center of mass
    rootX: 5.0, rootY: 1.2, rootRot: 0.32, spine: 0.045, head: -0.27,
    hipR: 0.78, kneeR: -0.46, footR: 0.14,
    hipL: -0.55, kneeL: -1.10, footL: -0.16,
    shR: 0.03, elR: -1.10, wrR: 1.26,
    shL: -0.50, elL: -1.25, wrL: -0.12,
    pelvisYaw: 0.15, chestYaw: -0.19, armLz: -0.12, armRz: -0.03, bladeYaw: -0.22,
  },
  { // 02 / compression: spring load, trailing heel recovers
    rootX: 5.6, rootY: 3.0, rootRot: 0.35, spine: 0.05, head: -0.30,
    hipR: 0.43, kneeR: -0.78, footR: 0.04,
    hipL: -0.22, kneeL: -1.62, footL: 0.08,
    shR: 0.07, elR: -1.14, wrR: 1.26,
    shL: -0.32, elL: -1.36, wrL: -0.12,
    pelvisYaw: 0.09, chestYaw: -0.12, armLz: -0.07, armRz: -0.03, bladeYaw: -0.20,
  },
  { // 03 / drive: stance hip extends, swing knee folds high
    rootX: 6.3, rootY: 2.1, rootRot: 0.36, spine: 0.045, head: -0.31,
    hipR: 0.02, kneeR: -0.57, footR: -0.10,
    hipL: 0.25, kneeL: -1.90, footL: 0.16,
    shR: 0.11, elR: -1.17, wrR: 1.26,
    shL: 0.04, elL: -1.43, wrL: -0.12,
    pelvisYaw: 0, chestYaw: 0, armLz: 0, armRz: -0.02, bladeYaw: -0.18,
  },
  { // 04 / toe-off: release stored energy, opposite thigh punches forward
    rootX: 6.6, rootY: 0.3, rootRot: 0.34, spine: 0.04, head: -0.29,
    hipR: -0.38, kneeR: -0.30, footR: -0.21,
    hipL: 0.73, kneeL: -1.58, footL: 0.18,
    shR: 0.13, elR: -1.15, wrR: 1.26,
    shL: 0.40, elL: -1.42, wrL: -0.12,
    pelvisYaw: -0.09, chestYaw: 0.12, armLz: 0.07, armRz: -0.02, bladeYaw: -0.19,
  },
  { // 05 / flight: both feet released, long silhouette with clear knee separation
    rootX: 6.0, rootY: -1.8, rootRot: 0.31, spine: 0.04, head: -0.26,
    hipR: -0.58, kneeR: -0.72, footR: -0.15,
    hipL: 1.00, kneeL: -1.02, footL: 0.15,
    shR: 0.09, elR: -1.12, wrR: 1.26,
    shL: 0.59, elL: -1.34, wrL: -0.12,
    pelvisYaw: -0.15, chestYaw: 0.19, armLz: 0.12, armRz: -0.03, bladeYaw: -0.22,
  },
  { // 06 / recovery: reach down, not forward; prepare the next forefoot strike
    rootX: 5.4, rootY: -0.4, rootRot: 0.31, spine: 0.045, head: -0.26,
    hipR: -0.58, kneeR: -0.98, footR: -0.16,
    hipL: 0.90, kneeL: -0.67, footL: 0.14,
    shR: 0.05, elR: -1.10, wrR: 1.26,
    shL: 0.55, elL: -1.27, wrL: -0.12,
    pelvisYaw: -0.16, chestYaw: 0.20, armLz: 0.12, armRz: -0.03, bladeYaw: -0.23,
  },
]

export const SPRINT_EXPOSURES = [0, 0.09, 0.19, 0.29, 0.39, 0.45, 0.50, 0.59, 0.69, 0.79, 0.89, 0.95] as const
const sprintHands = [[13,20],[9,22],[0,25],[-10,28],[-12,29],[-2,24]]
SPRINT_Q.forEach((pose, i) => Object.assign(pose, humanFreeArm(...sprintHands[i] as [number, number])))
// Anime ninja sprint: supported whole-core diagonal, NOT a folded waist.
// Pump the arms naturally; the head counter-pitches to keep eyes level.
for (const pose of SPRINT_Q) {
  pose.rootRot = (pose.rootRot ?? 0) + .20
  pose.rootX = 2 + ((pose.rootX ?? 0) - 5) * .3
  pose.spine = .04
  pose.head = .045 - (pose.rootRot ?? 0) - pose.spine
  pose.pelvisYaw = (pose.pelvisYaw ?? 0)*.55
  pose.chestYaw = (pose.chestYaw ?? 0)*.55
  pose.armLz = (pose.armLz ?? 0)*.3
}
const SPRINT_DUR = 0.56
export const SPRINT_CLIP: Clip = makeClip('sprint', [
  ...SPRINT_Q.map((pose, i) => keyframe(SPRINT_EXPOSURES[i] * SPRINT_DUR, pose, 'inOutSine')),
  ...SPRINT_Q.map((pose, i) => keyframe(SPRINT_EXPOSURES[i + 6] * SPRINT_DUR, mirrorHumanStride(pose), 'inOutSine')),
  keyframe(SPRINT_DUR, SPRINT_Q[0], 'inOutSine'),
], true)

SPRINT_CLIP.interpolation = 'monotone'
RUN_CLIP.interpolation = 'monotone'

/** Double-tap sprint POWER STRIDE: a separate bilateral cycle, selected only
 * while the held sprint is actually accelerating. Shared gait phase prevents
 * inserting extra steps. The lean relaxes from power stride into the cruising diagonal. */
const SPRINT_DRIVE_Q=SPRINT_Q.map(p=>({...p,
  rootRot:(p.rootRot??0)+.055,head:(p.head??0)-.055,
  rootY:(p.rootY??0)+.65,elL:(p.elL??-1)-.08,
}))
export const SPRINT_DRIVE_CLIP:Clip=makeClip('sprintDrive',[
  ...SPRINT_DRIVE_Q.map((p,i)=>keyframe(SPRINT_EXPOSURES[i]*SPRINT_DUR,p,'inOutSine')),
  ...SPRINT_DRIVE_Q.map((p,i)=>keyframe(SPRINT_EXPOSURES[i+6]*SPRINT_DUR,mirrorHumanStride(p),'inOutSine')),
  keyframe(SPRINT_DUR,SPRINT_DRIVE_Q[0],'inOutSine'),
],true)
SPRINT_DRIVE_CLIP.interpolation='monotone'

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
    rootRot: 0.10, rootY: 4.0, spine: 0.015, head: -0.01,
    hipR: 0.40, kneeR: -0.60, footR: 0.10,
    hipL: -0.30, kneeL: -0.46, footL: 0.08,
    shR: 0.16, elR: -0.62, wrR: 1.25,
    shL: 0.08, elL: -0.75, wrL: -0.20,
    pelvisYaw: 0.22, chestYaw: -0.12, armRz: 0.10, armLz: -0.08,
  }, 'inOutSine'),
  keyframe(0.9, { // subtle coiled weight shift onto rear leg
    rootRot: 0.095, rootY: 4.3, spine: 0.012, head: -0.01,
    hipR: 0.36, kneeR: -0.58, footR: 0.08,
    hipL: -0.32, kneeL: -0.45, footL: 0.06,
    shR: 0.15, elR: -0.63, wrR: 1.24,
    shL: 0.07, elL: -0.76, wrL: -0.20,
    pelvisYaw: 0.20, chestYaw: -0.10,
  }, 'inOutSine'),
  keyframe(1.8, { // return smoothly
    rootRot: 0.10, rootY: 4.0, spine: 0.015, head: -0.01,
    hipR: 0.40, kneeR: -0.60, footR: 0.10,
    hipL: -0.30, kneeL: -0.46, footL: 0.08,
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

/** Seven explicit deceleration exposures: catch, load, absorb, rebound,
 * settle, follow-through, rest. The hands counterbalance rather than freeze. */
export const STOP_CLIP:Clip=makeClip('stop',[
  keyframe(0,{...RONIN_REST,rootRot:.06,rootY:3.8,hipR:.55,kneeR:-.65,
    ...humanFreeArm(13,25),shR:.32,elR:-1.05},'inOutSine'),
  keyframe(.05,{...RONIN_REST,rootRot:-.025,rootY:5,hipR:.65,kneeR:-.85,
    hipL:-.35,kneeL:-.5,...humanFreeArm(16,23),shR:.35,elR:-1.15},'inOutSine'),
  keyframe(.11,{...RONIN_REST,rootRot:-.015,rootY:6.2,hipR:.52,kneeR:-1.0,
    hipL:-.25,kneeL:-.65,...humanFreeArm(14,24),shR:.34,elR:-1.18},'inOutSine'),
  keyframe(.18,{...RONIN_REST,rootRot:.035,rootY:5.5,hipR:.4,kneeR:-.85,
    ...humanFreeArm(11,26),shR:.30,elR:-1.1},'inOutSine'),
  keyframe(.27,{...RONIN_REST,rootRot:.085,rootY:4.2,
    ...humanFreeArm(9,28),shR:.25,elR:-.95},'inOutSine'),
  keyframe(.38,{...RONIN_REST,rootRot:.115,rootY:3.1,
    ...humanFreeArm(7,29),shR:.18,elR:-.75},'inOutSine'),
  keyframe(.50,{...RONIN_REST,...humanFreeArm(7,29)},'inOutSine'),
])
STOP_CLIP.interpolation='monotone'

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
    shR: 1.85, elR: -1.05, wrR: 6.95,
    shL: 1.65, elL: -1.10,
    pelvisYaw: 0.08,
  }, 'outQuad'),
  keyframe(.065, {
    rootRot:.24,rootY:-2.8,spine:.055,head:-.23,
    hipR:.78,kneeR:-1.65,footR:.24,hipL:-.05,kneeL:-.75,footL:.08,
    shR:1.75,elR:-.9,wrR:6.96,shL:1.5,elL:-1.0,
    pelvisYaw:.06,chestYaw:-.025,
  }, 'inOutSine'),
  keyframe(0.16, { // RISE — arms sweep out toward the balance spread
    rootRot: 0.18, rootY: -3, spine: 0.06, head: -0.18,
    hipR: 0.55, kneeR: -1.5, footR: 0.18,
    hipL: 0.32, kneeL: -1.05, footL: 0.22,
    shR: 1.6, elR: -.75, wrR: 6.98,
    shL: 1.25, elL: -.85, armLz: 0.45,
  }, 'outCubic'),
  keyframe(0.34, { // APEX — knees tuck high, hands level at the shoulders
    rootRot: 0.12, rootY: -3.6, spine: 0.05, head: -0.14,
    hipR: 0.6, kneeR: -1.9, footR: 0.1,
    hipL: 0.45, kneeL: -1.75, footL: 0.16,
    shR: 1.35, elR: -.80, wrR: 7.02,
    shL: 1.05, elL: -.95, armLz: 0.3,
  }, 'inOutCubic'),
])

/** running leap — initiated from a run: the momentum long-jump. Torso
 * drives forward over the boarding leg, trail leg sweeps back to FULL
 * extension, both hands swept down-back (airfoil drag) then flaring wide
 * at the arc top. */
export const JUMP_LEAP_CLIP: Clip = makeClip('jumpLeap', [
  keyframe(0, { // BOARDING — momentum converts through the drive leg
    rootRot: 0.5, rootY: -1.5, spine: 0.04, head: -0.44,
    hipR: 1.0, kneeR: -0.9, footR: 0.28,
    hipL: -0.85, kneeL: -0.2, footL: -0.18,
    shR: -0.5, elR: -0.4, wrR: 5.05,
    shL: -0.35, elL: -0.5,
    pelvisYaw: 0.14, chestYaw: -0.08,
  }, 'outQuad'),
  keyframe(.085, { // passing knee; no frozen long-jump split
    rootRot:.57,rootY:-2.1,spine:.04,head:-.50,
    hipR:1.12,kneeR:-1.15,footR:.22,hipL:-.8,kneeL:-.45,footL:-.12,
    shR:-.35,elR:-.85,wrR:5.08,shL:-.20,elL:-1.05,
    pelvisYaw:.12,chestYaw:-.07,
  }, 'inOutSine'),
  keyframe(0.2, { // FLIGHT — the long horizontal body, hands flat down-back
    rootRot: 0.62, rootY: -2.6, spine: 0.04, head: -0.56,
    hipR: 1.25, kneeR: -0.5, footR: 0.3,
    hipL: -.95, kneeL: -0.30, footL: -0.22,
    shR: -.4, elR: -.8, wrR: 5.1,
    shL: -.25, elL: -1.0,
    pelvisYaw: 0.1, chestYaw: -0.06,
  }, 'outCubic'),
  keyframe(0.42, { // ARC TOP — hands flare wide, lead knee reaches for landing
    rootRot: 0.5, rootY: -3, spine: 0.04, head: -0.44,
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
  keyframe(0, {
    rootY:2,rootRot:.24,spine:.06,head:-.23,
    hipR:.48,kneeR:-.8,footR:.14,hipL:-.32,kneeL:-.7,footL:.12,
    shR:1.2,elR:-.75,wrR:6.3,shL:.9,elL:-.85,armLz:.15,
  }, 'inOutSine'),
  keyframe(.045, { // IMPACT — deep squat, BOTH HANDS reach down past the knees
    rootY: 7, rootRot: 0.4, spine: 0.14, head: -0.22,
    hipR: 0.62, kneeR: -1.4, footR: 0.24,
    hipL: -0.5, kneeL: -1.3, footL: 0.18,
    shR: 0.85, elR: -0.35, wrR: 6.1,
    shL: 0.7, elL: -0.4, armLz: 0.2,
  }, 'outQuad'),
  keyframe(.12, { // rebound: hands follow the core, not a second squat
    rootY:4.5,rootRot:.29,spine:.07,head:-.25,
    hipR:.52,kneeR:-1.0,footR:.18,hipL:-.4,kneeL:-.95,footL:.14,
    shR:.95,elR:-.65,wrR:6.2,shL:.65,elL:-.85,
  }, 'inOutSine'),
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
  keyframe(0.11, { // added ritual breakdown
    rootRot:.105,rootY:.2,spine:.04,head:-.06,
    hipR:.32,kneeR:-.57,footR:.11,hipL:-.305,kneeL:-.52,footL:.12,
    shR:1.15,elR:-.62,wrR:1.85,shL:.4,elL:-.7,armLz:-.08
  }, 'inOutSine'),
  keyframe(0.22, { // PRESENT — blade rises to the vertical carry, gaze softens
    rootRot: 0.09, rootY: 0.5, spine: 0.03, head: -0.04,
    hipR: 0.3, kneeR: -0.6, footR: 0.1,
    hipL: -0.3, kneeL: -0.55, footL: 0.12,
    shR: 1.45, elR: -0.75, wrR: 2.6, // blade up — kissaki over the shoulder
    shL: 0.25, elL: -0.5, // left hand drifts toward the saya mouth
    armLz: -0.2,
  }, 'inOutCubic'),
  keyframe(0.3, { // added ritual breakdown
    rootRot:.085,rootY:.64,spine:.026,head:-.033,
    hipR:.29,kneeR:-.62,footR:.1,hipL:-.3,kneeL:-.565,footL:.12,
    shR:1.31,elR:-.88,wrR:3.05,shL:.12,elL:-.47,armLz:-.24
  }, 'inOutSine'),
  keyframe(0.37, { // added ritual breakdown
    rootRot:.082,rootY:.75,spine:.022,head:-.025,
    hipR:.285,kneeR:-.64,footR:.1,hipL:-.3,kneeL:-.575,footL:.12,
    shR:1.07,elR:-1.06,wrR:3.57,shL:-.02,elL:-.39,armLz:-.28
  }, 'inOutSine'),
  keyframe(0.42, { // MEET — tsuka tips back to the saya mouth
    rootRot: 0.08, rootY: 0.8, spine: 0.02, head: -0.02,
    hipR: 0.28, kneeR: -0.65, footR: 0.1,
    hipL: -0.3, kneeL: -0.58, footL: 0.12,
    shR: 0.9, elR: -1.15, wrR: 3.9, // blade laid back along the scabbard line
    shL: -0.1, elL: -0.35, armLz: -0.3,
  }, 'inOutSine'),
  keyframe(0.5, { // added ritual breakdown
    rootRot:.08,rootY:.76,spine:.02,head:-.01,
    hipR:.28,kneeR:-.64,footR:.1,hipL:-.3,kneeL:-.58,footL:.12,
    shR:.84,elR:-1.12,wrR:4.36,shL:-.13,elL:-.32,armLz:-.30
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
  keyframe(0.7, { // added ritual breakdown
    rootRot:.073,rootY:.52,spine:.017,head:-.006,
    hipR:.286,kneeR:-.605,footR:.1,hipL:-.3,kneeL:-.57,footL:.12,
    shR:.83,elR:-1.03,wrR:4.95,shL:.07,elL:-.53,armLz:-.12
  }, 'inOutSine'),
  keyframe(0.78, { // added ritual breakdown
    rootRot:.065,rootY:.44,spine:.012,head:-.015,
    hipR:.295,kneeR:-.59,footR:.1,hipL:-.3,kneeL:-.558,footL:.12,
    shR:.90,elR:-.99,wrR:4.985,shL:.36,elL:-.86,armLz:.11
  }, 'inOutSine'),
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
  keyframe(0.035, { // added ritual breakdown
    rootRot:.045,rootY:.95,spine:.018,head:-.07,
    hipR:.35,kneeR:-.65,footR:.13,hipL:-.32,kneeL:-.61,footL:.115,
    shR:.89,elR:-.90,wrR:4.92,shL:.4,elL:-.85,armLz:-.02,pelvisYaw:-.04
  }, 'inOutSine'),
  keyframe(0.07, { // GRIP — the hand closes on the tsuka and lifts it out
    // of the mouth (sayabiki: the LEFT arm pulls the saya back instead)
    rootRot: 0.02, rootY: 1.6, spine: 0.03, head: -0.14,
    hipR: 0.42, kneeR: -0.75, footR: 0.18,
    hipL: -0.36, kneeL: -0.7, footL: 0.1,
    shR: 0.82, elR: -0.75, wrR: 4.85, // tsuka lifts out of the mouth
    shL: 0.25, elL: -0.6, armLz: -0.3,
    pelvisYaw: -0.12,
  }, 'inQuad'),
  keyframe(0.085, { // added ritual breakdown
    rootRot:.065,rootY:1.42,spine:.033,head:-.15,
    hipR:.455,kneeR:-.81,footR:.19,hipL:-.39,kneeL:-.64,footL:.08,
    shR:.92,elR:-.71,wrR:5.16,shL:.18,elL:-.72,armLz:-.27,pelvisYaw:-.09,chestYaw:.025
  }, 'inOutSine'),
  keyframe(.105, { // extraction breakdown / left hand actively retracts saya
    rootRot:.15,rootY:.8,spine:.04,head:-.16,
    hipR:.5,kneeR:-.88,footR:.2,hipL:-.43,kneeL:-.55,footL:.05,
    shR:1.1,elR:-.65,wrR:5.65,
    shL:.12,elL:-.85,armLz:-.22,pelvisYaw:-.04,chestYaw:.04,
  }, 'inOutSine'),
  keyframe(0.12, { // added ritual breakdown
    rootRot:.205,rootY:.22,spine:.065,head:-.20,
    hipR:.54,kneeR:-.94,footR:.22,hipL:-.47,kneeL:-.48,footL:.01,
    shR:1.25,elR:-.51,wrR:6.02,shL:.16,elL:-.86,armLz:-.185,pelvisYaw:.02,chestYaw:.01
  }, 'inOutSine'),
  keyframe(0.16, { // EXPLOSION — the steel rips out along the rising diagonal
    rootRot: 0.3, rootY: -1.2, spine: 0.12, head: -0.3,
    hipR: 0.6, kneeR: -1.05, footR: 0.26,
    hipL: -0.55, kneeL: -0.35, footL: -0.08,
    shR: 1.55, elR: -0.3, wrR: 6.733185307, // edge flashing forward-up, elbow extending
    shL: 0.3, elL: -0.8, armLz: -0.1,
    pelvisYaw: 0.14, chestYaw: -0.08,
  }, 'outQuart'),
  keyframe(0.185, { // added ritual breakdown
    rootRot:.266,rootY:-1.0,spine:.10,head:-.27,
    hipR:.55,kneeR:-.94,footR:.23,hipL:-.5,kneeL:-.39,footL:-.035,
    shR:1.43,elR:-.39,wrR:6.9,shL:.32,elL:-.91,armLz:-.07,pelvisYaw:.12,chestYaw:-.07
  }, 'inOutSine'),
  keyframe(.215, { // controlled follow-through before the guard
    rootRot:.2,rootY:-.5,spine:.07,head:-.21,
    hipR:.46,kneeR:-.75,footR:.18,hipL:-.4,kneeL:-.45,footL:.04,
    shR:1.2,elR:-.55,wrR:7.05,
    shL:.38,elL:-.95,armLz:-.04,pelvisYaw:.08,chestYaw:-.04,
  }, 'inOutSine'),
  keyframe(0.245, { // added ritual breakdown
    rootRot:.145,rootY:-.22,spine:.06,head:-.15,
    hipR:.4,kneeR:-.64,footR:.15,hipL:-.35,kneeL:-.48,footL:.08,
    shR:1.02,elR:-.56,wrR:7.24,shL:.44,elL:-.92,armLz:-.015,pelvisYaw:.04,chestYaw:-.02
  }, 'inOutSine'),
  keyframe(0.275, { // added ritual breakdown
    rootRot:.112,rootY:-.04,spine:.052,head:-.112,
    hipR:.36,kneeR:-.575,footR:.125,hipL:-.32,kneeL:-.495,footL:.11,
    shR:.89,elR:-.52,wrR:7.38,shL:.48,elL:-.87,armLz:-.003,pelvisYaw:.01,chestYaw:-.005
  }, 'inOutSine'),
  keyframe(0.3, { // SETTLE — chūdan guard, the breath after the draw
    rootRot: 0.1, rootY: 0, spine: 0.05, head: -0.1,
    hipR: 0.34, kneeR: -0.55, footR: 0.12,
    hipL: -0.31, kneeL: -0.5, footL: 0.12,
    shR: 0.85, elR: -0.5, wrR: 7.433185307,
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
 *            dash (momentum-matched entry, a low forward carry:
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
  { // LOAD: center drops; knees store the burst. Arms remain compact.
    // GAP-1: the rearward gather strengthened — weight shifts BACK (rootX
    // −2), the crouch deepens, the pelvis counter-winds and the eyes stay
    // UP: the body visibly loads opposite before the stride fires.
    rootX: -2, rootY: 8.6, rootRot: .14, spine: .025, head: -.15,
    hipR: .68, kneeR: -1.15, footR: .08, hipL: -.25, kneeL: -.75, footL: -.10,
    shR: .26, elR: -1.35, wrR: 5.15, ...humanFreeArm(13,23),
    pelvisYaw: -.1, chestYaw: .08, armRz: -.035, armLz: .025,
  },
  { // PUSH: rear support and core form a diagonal; no lumbar collapse.
    rootX: 8, rootY: 4.5, rootRot: .58, spine: .045, head: -.60,
    hipR: 1.12, kneeR: -1.52, footR: .16, hipL: -.65, kneeL: -.20, footL: -.18,
    shR: -.08, elR: -1.25, wrR: 5.25, ...humanFreeArm(-10,24),
    pelvisYaw: .05, chestYaw: -.04, armRz: -.035, armLz: .025, bladeYaw: -.22,
  },
  { // PASS: one leg recovers while the lead thigh reaches for the catch.
    rootX: 9, rootY: -.5, rootRot: .56, spine: .045, head: -.58,
    hipR: .95, kneeR: -1.18, footR: .13, hipL: -.40, kneeL: -1.40, footL: .10,
    shR: -.04, elR: -1.28, wrR: 5.30, ...humanFreeArm(-15,25),
    pelvisYaw: .035, chestYaw: -.025, armRz: -.03, armLz: -.025, bladeYaw: -.22,
  },
  { // CATCH: foot reaches beneath the advancing body; knee accepts weight.
    rootX: 3.5, rootY: 7, rootRot: .27, spine: .025, head: -.25,
    hipR: .58, kneeR: -.90, footR: .10, hipL: -.42, kneeL: -.55, footL: -.08,
    shR: .18, elR: -1.2, wrR: 5.5, ...humanFreeArm(10,25),
    pelvisYaw: .03, chestYaw: -.02, armRz: -.025, bladeYaw: -.12,
  },
  { // SETTLE: core rises, no extra running cycle inside the dash.
    rootX: 2, rootY: 3.3, rootRot: .12, spine: .025, head: -.055,
    hipR: .48, kneeR: -.56, footR: .14, hipL: -.32, kneeL: -.34, footL: -.08,
    shR: .25, elR: -1.1, wrR: 5.75, ...humanFreeArm(11,26),
    pelvisYaw: .06, chestYaw: -.04, armRz: -.025, bladeYaw: -.08,
  },
]

/** Nine core drawings; four additional transitions are inserted below.
 * The compact drive is timed independently of the physical motor. */
const DASH_ANIME_Q:PoseInput[]=[
  DASH_LAUNCH_Q[0],
  {...DASH_LAUNCH_Q[0],rootX:2,rootY:6.5,rootRot:.46,spine:.04,head:-.43,
    hipR:.9,kneeR:-1.3,hipL:-.48,kneeL:-.44,...humanFreeArm(1,23)}, // release
  DASH_LAUNCH_Q[1],
  {...DASH_LAUNCH_Q[1],rootX:9,rootY:2,rootRot:.58,spine:.045,head:-.60,
    hipR:1.06,kneeR:-1.4,hipL:-.72,kneeL:-.48,...humanFreeArm(-13,24)}, // stretch
  DASH_LAUNCH_Q[2],
  {...DASH_LAUNCH_Q[2],rootX:7,rootY:2,rootRot:.50,spine:.04,head:-.51,
    hipR:.86,kneeR:-1.05,hipL:-.35,kneeL:-1.1,...humanFreeArm(-7,25)}, // gather
  DASH_LAUNCH_Q[3],
  {...DASH_LAUNCH_Q[3],rootX:2.7,rootY:5,rootRot:.19,spine:.03,head:-.17,
    hipR:.52,kneeR:-.73,hipL:-.36,kneeL:-.46,...humanFreeArm(12,25)}, // rebound
  DASH_LAUNCH_Q[4],
]
// Four additional, individually authored transitions: a quick toe-off,
// a passing step, a foot plant, and a balanced recovery. They enrich the
// silhouette without extending the dash or holding a near-horizontal pose.
DASH_ANIME_Q.splice(2,0,{...DASH_ANIME_Q[1],rootX:5,rootY:5.5,rootRot:.52,head:-.54,
  hipR:1.02,kneeR:-1.42,hipL:-.57,kneeL:-.31,...humanFreeArm(-5,23)})
DASH_ANIME_Q.splice(5,0,{...DASH_ANIME_Q[4],rootX:9,rootY:1,rootRot:.57,head:-.59,
  hipR:1.01,kneeR:-1.33,hipL:-.56,kneeL:-.82,...humanFreeArm(-14,24)})
DASH_ANIME_Q.splice(8,0,{...DASH_ANIME_Q[7],rootX:5,rootY:4,rootRot:.39,head:-.41,
  hipR:.7,kneeR:-.98,hipL:-.40,kneeL:-.80,...humanFreeArm(2,25)})
DASH_ANIME_Q.splice(11,0,{...DASH_ANIME_Q[10],rootX:2.4,rootY:4,rootRot:.15,head:-.12,
  hipR:.50,kneeR:-.64,hipL:-.34,kneeL:-.40,...humanFreeArm(11,26)})
export const DASH_ANIME_TIMES=[0,.028,.044,.060,.103,.132,.160,.195,.210,.225,.265,.282,.300] as const
export const DASH_LAUNCH_CLIP:Clip=makeClip('dashLaunch',
  DASH_ANIME_Q.map((q,i)=>keyframe(DASH_ANIME_TIMES[i],q,'inOutSine')))
DASH_LAUNCH_CLIP.interpolation='monotone'

/** Inertia reversal: brace against incoming travel before pushing in the
 * requested direction. No roll/spin; the support leg accepts the turn. */
export const DASH_PIVOT_CLIP:Clip=makeClip('dashPivot',[
  keyframe(0,{...DASH_LAUNCH_Q[0],rootX:-3,rootRot:-.17,head:.14,
    hipR:.9,kneeR:-.95,hipL:-.45,kneeL:-.65},'inOutSine'),
  keyframe(.058,{...DASH_LAUNCH_Q[1],rootX:3.5,rootRot:.40,head:-.40},'inOutSine'),
  keyframe(.1334,{...DASH_LAUNCH_Q[2],rootX:4,rootRot:.34,head:-.34},'inOutSine'),
  keyframe(.2117,{...DASH_LAUNCH_Q[3],rootRot:.18,head:-.16},'inOutSine'),
  keyframe(.29,DASH_LAUNCH_Q[4],'inOutSine'),
])

/** chained second dash — the MIRRORED stride (left leg leads): dash-spam
 * reads as alternating drives. Sword arm keeps the same carry. */
export const DASH_CHAIN_CLIP:Clip=makeClip('dashChain',
  DASH_ANIME_Q.map((q,i)=>keyframe(DASH_ANIME_TIMES[i],mirrorLegs(q),'inOutSine')))
DASH_CHAIN_CLIP.interpolation='monotone'

// Momentum-matched entry uses twelve breakdowns, with a
// slightly more committed first stride; no added airtime or pose plateau.
const DASH_CARRY_Q:PoseInput[]=DASH_ANIME_Q.filter((_,i)=>i!==11).map((q,i)=>({
  ...q, rootRot:i===0?.40:q.rootRot, head:i===0?-.42:q.head,
}))
export const DASH_CARRY_CLIP:Clip=makeClip('dashCarry',
 DASH_CARRY_Q.map((q,i)=>keyframe(DASH_ANIME_TIMES[i<11?i:i+1]*.29/.30,q,'inOutSine')))
DASH_CARRY_CLIP.interpolation='monotone'

export const DASH_HUNT_CLIP:Clip=makeClip('dashHunt',
 DASH_ANIME_Q.map((q,i)=>keyframe(DASH_ANIME_TIMES[i]*.32/.30,{
  ...q,rootX:(q.rootX??0)+(DASH_ANIME_TIMES[i]>=.044&&DASH_ANIME_TIMES[i]<=.195?1.5:0),
 },'inOutSine')))
DASH_HUNT_CLIP.interpolation='monotone'

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
  keyframe(0.1, { // SCISSOR — front knee punches, rear trails; chamber
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

// Surrounded escape: a low diagonal weave, not a near-upright spin.
// Keep a readable shoulder gap and stay inside the depth joint envelope.
DASH_CARVE_Q.forEach((q,i)=>{
 q.rootRot=[.38,.64,.70,.34,.08][i];q.spine=.035
 q.head=Math.max(-.75,.035-q.rootRot-q.spine)
 q.pelvisYaw=[.18,.38,.48,.25,.05][i]
 q.chestYaw=[-.12,-.24,-.32,-.17,0][i]
})
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

// Air arcs and ritual extraction use shape-preserving C1 in-betweens.
// Keep combat/dash authored impact eases and sprint's 10 Hz exposures intact.
for(const clip of [JUMP_CLIP,JUMP_LEAP_CLIP,AIR_JUMP_CLIP,LAND_CLIP,DRAW_CLIP,SHEATHE_CLIP]){
  clip.interpolation='monotone'
}
