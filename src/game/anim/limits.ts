/** STICKMAN RISING — ANATOMICAL JOINT LIMITS (limits).
 *
 * THE INVERSION GUARD. Clips author the performance; this module does not
 * direct it. Its single job is physical impossibility: a human elbow cannot
 * fold the wrong way, a knee cannot hyperextend, a shoulder cannot wind
 * past the glenohumeral envelope, and no stack of IK can leave a channel
 * non-finite. Everything else — how far a lunge leans, whether an arm is
 * locked straight at the height of a thrust, how tight a chamber is — is
 * AUTHORING, and stays exactly as written in the clip.
 *
 * ── WHY THE OLD CEILINGS ARE GONE ────────────────────────────────────
 * The previous revision also clamped AUTHORED ranges: 1.10 rad of spine
 * pitch (POWER_DASH_CLIP authors 1.30 for its committed drive), a −2.62
 * elbow floor, a −0.26 elbow "never lock" floor, and so on. Those bounds
 * were written for procedural layers that could add arbitrary amounts to a
 * pose each frame. Those layers no longer exist, so the bounds only ever
 * fired on the clips — which is the opposite of what an animator expects
 * when they type a number into a keyframe. The ones kept below are set
 * OUTSIDE the authored envelope of all 40 clips (measured, not guessed):
 * they never touch a keyframe, only IK or crossfade excursions.
 *
 * ── RESEARCH BASE (ROM, sagittal plane, Norkin & White / AAOS) ────────
 *   joint          direction rule
 *   ────────────────────────────────────────────────────────────────────
 *   elbow          flexion side only (negative in this rig); 155° max
 *   knee           folds BACKWARD only (negative); 155° max
 *   shoulder       180° flexion / 60° extension from the coronal plane
 *   hip            ~125° thigh-up / 35° behind
 *   spine          −25° extension .. 60° flexion (trunk share, generous)
 *
 * The pass is POSITIONAL (stateless) and runs immediately before
 * solveFighter3D, so the pose that is rendered is always physically
 * possible — but an authored keyframe is never a value this module
 * changes.
 */

import { CH, Pose, makePose } from './pose'
import { clamp } from '../core/utils'

const SAFE_POSE = makePose()

/* ---- hard ROM (radians) — anatomical, not stylistic ---- */
const EL_FLEX_MAX = 2.70 // 155°: the flexion limit itself
const KNEE_FLEX_MAX = 2.70 // 155°
const SH_BACK = 1.20 // 69° of extension behind the coronal plane
const SH_FWD = 3.10 // 178° flexion (arm overhead)
const HIP_BACK = 1.20 // 69° behind the pelvis
const HIP_FWD = 2.45 // 140° thigh-up
const SPINE_BACK = 0.62 // 35° of trunk extension
const SPINE_FWD = 1.62 // 93° of trunk flexion (authored max: 1.31)

/**
 * Clamp a pose into physical possibility. Mutates in place; returns the
 * same array.
 *
 * Elbow/knee channels are sign-locked to the rig's flexion convention
 * (negative): a channel that crossed sides is REFLECTED, keeping its
 * flexion magnitude, so a crossfade sweeping an elbow through zero folds
 * the same amount on the correct side instead of snapping straight.
 */
export function applyJointLimits(p: Pose): Pose {
  // Never allow a corrupt input/spring state to poison the entire rig.
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) p[i] = SAFE_POSE[i]
  p[CH.head] = clamp(p[CH.head], -1.05, 1.05)
  p[CH.pelvisYaw] = clamp(p[CH.pelvisYaw], -1.0, 1.0)
  p[CH.chestYaw] = clamp(p[CH.chestYaw], -1.35, 1.35)
  for (const ch of [CH.hipLz, CH.hipRz]) p[ch] = clamp(p[ch], -0.85, 0.85)
  for (const ch of [CH.armLz, CH.armRz]) p[ch] = clamp(p[ch], -1.6, 1.6)
  for (const ch of [CH.foreLz, CH.foreRz]) p[ch] = clamp(p[ch], -1.45, 1.45)

  // ---- elbows: flexion side only, magnitude keeps its authored value ----
  for (const ch of [CH.elL, CH.elR] as const) {
    p[ch] = p[ch] > 0 ? -Math.abs(p[ch]) : Math.max(p[ch], -EL_FLEX_MAX)
  }
  // ---- knees: fold backward only ----
  for (const ch of [CH.kneeL, CH.kneeR] as const) {
    p[ch] = p[ch] > 0 ? -Math.abs(p[ch]) : Math.max(p[ch], -KNEE_FLEX_MAX)
  }
  // ---- shoulders / hips: envelope, not posture ----
  p[CH.shL] = clamp(p[CH.shL], -SH_BACK, SH_FWD)
  p[CH.shR] = clamp(p[CH.shR], -SH_BACK, SH_FWD)
  p[CH.hipL] = clamp(p[CH.hipL], -HIP_BACK, HIP_FWD)
  p[CH.hipR] = clamp(p[CH.hipR], -HIP_BACK, HIP_FWD)
  // ---- spine: total trunk pitch (pelvis share + lumbar share) ----
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
  const mag = (v: number) => v < -EL_FLEX_MAX
  const kmag = (v: number) => v < -KNEE_FLEX_MAX
  const spine = p[CH.rootRot] + p[CH.spine] * 0.43
  return {
    elbowSide: [side(p[CH.elL]), side(p[CH.elR])],
    elbowMag: [mag(p[CH.elL]), mag(p[CH.elR])],
    kneeSide: [side(p[CH.kneeL]), side(p[CH.kneeR])],
    kneeMag: [kmag(p[CH.kneeL]), kmag(p[CH.kneeR])],
    shoulder: [p[CH.shL] < -SH_BACK || p[CH.shL] > SH_FWD, p[CH.shR] < -SH_BACK || p[CH.shR] > SH_FWD],
    hip: [p[CH.hipL] < -HIP_BACK || p[CH.hipL] > HIP_FWD, p[CH.hipR] < -HIP_BACK || p[CH.hipR] > HIP_FWD],
    spine: spine > SPINE_FWD || spine < -SPINE_BACK,
  }
}

/** The authored envelope of the whole clip library, in channel space.
 * Exported so the QA overview can prove the guard is a no-op on authored
 * keyframes — an authored pose that reports here is a clip bug, not a
 * constraint. */
export const ROM_BOUNDS = {
  elbow: EL_FLEX_MAX,
  knee: KNEE_FLEX_MAX,
  shoulder: [-SH_BACK, SH_FWD] as const,
  hip: [-HIP_BACK, HIP_FWD] as const,
  spine: [-SPINE_BACK, SPINE_FWD] as const,
}
