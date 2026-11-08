/** STICKMAN RISING — ANATOMICAL JOINT LIMITS (limits).
 *
 * THE CONSTRAINT LAYER. Channel-space poses are raw floats: clips author
 * them, procedural layers ADD to them, IK solvers write them. Nothing in
 * that pipeline is bounded — an elbow channel can cross its flexion side
 * (the "inverted arm"), a knee can fold forward, an arm can wind past the
 * glenohumeral envelope. Human joints cannot. This module is the final
 * pre-solve gate: every pose passes through `applyJointLimits` and comes
 * out inside the human range of motion.
 *
 * ── RESEARCH BASE (ROM, sagittal plane, Norkin & White / AAOS) ────────
 *   joint          extension      flexion         rig channel (sign)
 *   ────────────────────────────────────────────────────────────────────
 *   elbow          0° (lock)      0→150°          el ∈ [−2.62, −0.26]
 *                                                 (interior 165°..15°;
 *                                                 NEGATIVE = flexion side
 *                                                 — the rig's authored
 *                                                 convention; positive =
 *                                                 the inverted elbow)
 *   knee           0° (lock)      0→155°          knee ∈ [−2.71, −0.17]
 *                                                 (interior 170°..10°;
 *                                                 knees fold BACKWARD only)
 *   shoulder       60° behind     180° overhead   sh ∈ [−1.05, 3.05]
 *   hip            ~35° behind*   125° thigh-up   hip ∈ [−1.0, 2.30]
 *                                                 (*sprint pelvis tilt
 *                                                 buys visual extension)
 *   spine (pitch)  25° back       50° fwd +       rootRot+spine·0.43
 *                                 lumbar share    ∈ [−0.45, 1.10]
 *
 * The pass is POSITIONAL (stateless): it runs after every procedural
 * writer and immediately before solveFighter3D, so clips, IK, additive
 * layers and crossfades are ALL bounded by the same anatomy. Solvers that
 * need to exceed a limit should solve for a reachable target instead —
 * limits are the safety net, not the steering.
 */

import { CH, Pose } from './pose'
import { clamp } from '../core/utils'

/* ---- limit constants (radians) — see table above ---- */
const EL_FLEX_MIN = 0.26 // ≥15° flexion: never a locked-straight elbow read
const EL_FLEX_MAX = 2.62 // ≤150° flexion
const KNEE_FLEX_MIN = 0.17 // ≥10°: knees never lock (spring-loaded stance)
const KNEE_FLEX_MAX = 2.71 // ≤155°
const SH_BACK = 1.05 // 60° extension behind the coronal plane
const SH_FWD = 3.05 // 175° flexion (arm overhead, kissaki raises)
const HIP_BACK = 1.0
const HIP_FWD = 2.3
const SPINE_BACK = 0.45
const SPINE_FWD = 1.1 // dash acceleration posture peaks ~0.9+share

/**
 * Clamp a pose into the human range of motion. Mutates in place; returns
 * the same array. Elbow/knee channels are sign-locked to the rig's
 * flexion convention (negative) BEFORE magnitude-clamping — a pose that
 * crossed the flexion side (positive elbow) snaps to the correct side at
 * minimum flexion rather than folding the joint backwards.
 */
export function applyJointLimits(p: Pose): Pose {
  // ---- elbows: sign-locked flexion ----
  // positive elbow = the forearm folds the WRONG way (bird-knee). Snap it
  // to the flexion side; a tiny positive value (≤8°) reads as "almost
  // straight" and settles at the min-flexion floor instead.
  for (const ch of [CH.elL, CH.elR] as const) {
    p[ch] = p[ch] > 0
      ? -EL_FLEX_MIN
      : clamp(p[ch], -EL_FLEX_MAX, -EL_FLEX_MIN)
  }
  // ---- knees: fold backward only, never locked ----
  for (const ch of [CH.kneeL, CH.kneeR] as const) {
    p[ch] = p[ch] > 0
      ? -KNEE_FLEX_MIN
      : clamp(p[ch], -KNEE_FLEX_MAX, -KNEE_FLEX_MIN)
  }
  // ---- shoulders: glenohumeral swing envelope ----
  p[CH.shL] = clamp(p[CH.shL], -SH_BACK, SH_FWD)
  p[CH.shR] = clamp(p[CH.shR], -SH_BACK, SH_FWD)
  // ---- hips: pelvis-femur envelope ----
  p[CH.hipL] = clamp(p[CH.hipL], -HIP_BACK, HIP_FWD)
  p[CH.hipR] = clamp(p[CH.hipR], -HIP_BACK, HIP_FWD)
  // ---- spine: total pitch (pelvis share + lumbar share) ----
  // rootRot carries ~70% of the trunk pitch, spine the lumbar remainder;
  // bound the SUM so no stack of additive layers can jackknife the torso.
  const spineTotal = p[CH.rootRot] + p[CH.spine] * 0.43
  if (spineTotal > SPINE_FWD) {
    const over = spineTotal - SPINE_FWD
    p[CH.rootRot] -= over * 0.7
    p[CH.spine] -= (over * 0.3) / 0.43
  } else if (spineTotal < -SPINE_BACK) {
    const over = -SPINE_BACK - spineTotal
    p[CH.rootRot] += over * 0.7
    p[CH.spine] += (over * 0.3) / 0.43
  }
  return p
}

/** diagnostics: true when the pose violates a hard limit (pre-clamp) —
 * the QA harness polls this to catch limit hits per state. */
export interface LimitReport {
  elbowSide: [boolean, boolean] // L,R — true when channel crossed flexion side
  elbowMag: [boolean, boolean] // true when |flexion| out of band
  kneeSide: [boolean, boolean]
  kneeMag: [boolean, boolean]
  shoulder: [boolean, boolean]
  hip: [boolean, boolean]
  spine: boolean
}
export function checkJointLimits(p: Pose): LimitReport {
  const side = (v: number) => v > 0
  const mag = (v: number) => v < -EL_FLEX_MAX || (v < 0 && v > -EL_FLEX_MIN)
  const kmag = (v: number) => v < -KNEE_FLEX_MAX || (v < 0 && v > -KNEE_FLEX_MIN)
  return {
    elbowSide: [side(p[CH.elL]), side(p[CH.elR])],
    elbowMag: [mag(p[CH.elL]), mag(p[CH.elR])],
    kneeSide: [side(p[CH.kneeL]), side(p[CH.kneeR])],
    kneeMag: [kmag(p[CH.kneeL]), kmag(p[CH.kneeR])],
    shoulder: [p[CH.shL] < -SH_BACK || p[CH.shL] > SH_FWD, p[CH.shR] < -SH_BACK || p[CH.shR] > SH_FWD],
    hip: [p[CH.hipL] < -HIP_BACK || p[CH.hipL] > HIP_FWD, p[CH.hipR] < -HIP_BACK || p[CH.hipR] > HIP_FWD],
    spine: p[CH.rootRot] + p[CH.spine] * 0.43 > SPINE_FWD || p[CH.rootRot] + p[CH.spine] * 0.43 < -SPINE_BACK,
  }
}
