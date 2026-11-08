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
  if (src.armRz !== undefined) out.armRz = src.armRz
  if (src.bladeYaw !== undefined) out.bladeYaw = src.bladeYaw
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
 * sway — up-wound per the clips.ts winding convention).
 * The pelvis SURGES forward through the cycle (rootX 2→7): the hips ride
 * over the stance foot — the leg geometry is authored as diagonal struts,
 * and the 3D channels twist the gait (pelvisYaw ±0.2, chest counter). */
const RUN_Q: PoseInput[] = [
  { // CONTACT — lead heel strikes FAR forward, trail toe still down
    rootX: 2, rootY: 0.6, rootRot: 0.34, spine: 0.05, head: -0.19,
    hipR: 0.88, kneeR: -0.08, footR: 0.24,
    hipL: -0.8, kneeL: -0.62, footL: -0.06,
    shR: 0.3, elR: -1.0, wrR: 6.19,
    shL: 0.7, elL: -1.05, wrL: -0.24,
    pelvisYaw: 0.2, chestYaw: -0.14, armLz: 0.28,
  },
  { // LOADING — weight absorbs over the bending lead leg, big stride split
    rootX: 4.5, rootY: 2.2, rootRot: 0.37, spine: 0.075, head: -0.26,
    hipR: 0.5, kneeR: -0.72, footR: 0.06,
    hipL: -0.95, kneeL: -0.3, footL: 0.02,
    shR: 0.55, elR: -1.05, wrR: 6.16,
    shL: 0.32, elL: -1.0, wrL: -0.2,
    pelvisYaw: 0.06, chestYaw: -0.04, armLz: 0.1,
  },
  { // PUSH-OFF — lead leg drives back hard, trail knee punches through high
    rootX: 7, rootY: 1.0, rootRot: 0.34, spine: 0.09, head: -0.3,
    hipR: -0.3, kneeR: -0.38, footR: -0.1,
    hipL: 0.52, kneeL: -1.32, footL: 0.2,
    shR: 0.72, elR: -0.95, wrR: 6.22,
    shL: 0.08, elL: -0.95, wrL: -0.16,
    pelvisYaw: -0.18, chestYaw: 0.12, armLz: -0.26,
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
 * mechanical system entirely. THE MAX-VELOCITY POSTURE (research: elite
 * sprinters hold ~15–20° trunk lean at top speed — the 35°+ lean belongs
 * to ACCELERATION, which is what the DASH family owns now; sprint stays
 * tall so the two states read instantly apart):
 *  · torso pitch ~20–23° (rootRot 0.36–0.40) + lumbar continuation —
 *    clearly above run, clearly below dash
 *  · PELVIS SURGES FORWARD (rootX 5→10 local): the hips ride over the
 *    toes ahead of the planted feet; the legs solve as DIAGONAL struts
 *    (stance leg compressed under the COG, trail leg fully extended)
 *  · COG swings 3.4 → 5.4 local (lowest at load absorb) — dropped hips
 *  · HEEL-TO-BUTT recovery: the swing shin folds past −1.9 rad under a
 *    back-swing thigh — the heel physically approaches the glutes
 *  · KNEE PUNCH-THROUGH: hip swings to 1.25+ rad (thigh nearly
 *    horizontal) before the next overstriding toe-up contact
 *  · big bent-elbow arm drive with DEPTH: the off-arm punches forward
 *    through +Z (armLz 0.42 — toward the camera), the sword arm trails
 *    back through −Z — the arms scissor THROUGH depth, not just the plane
 *  · katana tucked hard back (sum ≈ 0.4, bladeYaw −0.28: the steel
 *    swings behind the torso plane — the MGR Raiden sprint carry)
 *  · 3D gait twist: pelvisYaw ±0.26 with chest counter ±0.38 (research:
 *    shoulder counter-rotation ≈ 2× pelvis at sprint cadence) — the hips
 *    drive the stride, the shoulders counter-rotate against them
 * Cadence ≈ 5.5 steps/s. */
const SPRINT_Q: PoseInput[] = [
  { // CONTACT — right foot strikes FAR forward, toe UP (dorsiflexed)
    rootX: 5, rootRot: 0.36, rootY: 3.4, spine: 0.09, head: -0.3,
    hipR: 1.18, kneeR: -0.3, footR: 0.34,
    hipL: -0.95, kneeL: -0.45, footL: -0.12,
    shR: -0.45, elR: -0.55, wrR: 5.85,
    shL: 1.05, elL: -1.15,
    pelvisYaw: 0.26, chestYaw: -0.38, armLz: 0.42, armRz: -0.3, bladeYaw: -0.26,
  },
  { // SCISSOR — weight absorbs (COG LOWEST); trail heel kicks INTO the butt
    rootX: 7, rootRot: 0.39, rootY: 5.4, spine: 0.1, head: -0.32,
    hipR: 0.22, kneeR: -1.05, footR: 0.06,
    hipL: -0.85, kneeL: -1.9, footL: 0.3,
    shR: -0.35, elR: -0.5, wrR: 5.82,
    shL: 0.7, elL: -1.05,
    pelvisYaw: 0.08, chestYaw: -0.1, armLz: 0.12, armRz: -0.22, bladeYaw: -0.22,
  },
  { // TOE-OFF — full hip extension behind; left knee PUNCHES through HIGH
    rootX: 10, rootRot: 0.38, rootY: 3.8, spine: 0.09, head: -0.3,
    hipR: -0.72, kneeR: -0.4, footR: -0.18,
    hipL: 1.25, kneeL: -1.15, footL: 0.12,
    shR: -0.3, elR: -0.45, wrR: 5.84,
    shL: 0.34, elL: -0.95,
    pelvisYaw: -0.26, chestYaw: 0.38, armLz: -0.4, armRz: -0.1, bladeYaw: -0.18,
  },
  { // FLIGHT — hips stay HIGH, legs SCISSOR-EXTENDED (stride split — a
    // sprinter lengthens in the air; a tucked flight reads as a crouch)
    rootX: 8, rootRot: 0.35, rootY: 0.6, spine: 0.08, head: -0.28,
    hipR: -0.5, kneeR: -0.75, footR: -0.1,
    hipL: 1.1, kneeL: -0.5, footL: 0.32,
    shR: -0.4, elR: -0.5, wrR: 5.83,
    shL: 0.88, elL: -1.1,
    pelvisYaw: -0.1, chestYaw: 0.14, armLz: -0.15, armRz: -0.26, bladeYaw: -0.24,
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

/* ------------------------------- COMBAT IDLE ------------------------- */

/* Condition B at REST — the ROOTED live guard. Standing still with a
 * threat engaged is NOT walking: the feet stay PLANTED while the weight
 * shifts between the stance legs (pelvis sway), the COG breathes, and the
 * kissaki drifts on a tiny figure around the threat's throat line — a
 * coiled spring that never steps. (The old selector fell back to the
 * combat SHUFFLE here — the player visibly marched in place while idle.) */
export const COMBAT_IDLE_CLIP: Clip = makeClip('combatIdle', [
  keyframe(0, {
    rootRot: 0.16, rootY: 3, spine: 0.07, head: -0.13,
    hipR: 0.4, kneeR: -0.68, footR: 0.14,
    hipL: -0.38, kneeL: -0.6, footL: 0.13,
    shR: 0.9, elR: -0.48, wrR: 1.18,
    shL: 0.58, elL: -0.7, wrL: -0.26,
    pelvisYaw: 0.05,
  }, 'inOutSine'),
  keyframe(0.8, { // weight settles onto the rear leg; blade dips a breath
    rootRot: 0.15, rootY: 3.6, spine: 0.065, head: -0.15,
    kneeR: -0.6, kneeL: -0.66,
    shR: 0.86, elR: -0.52, wrR: 1.08,
    shL: 0.55, elL: -0.72,
    pelvisYaw: -0.06,
  }, 'inOutSine'),
  keyframe(1.6, { // weight rides forward; the kissaki re-centers on the line
    rootRot: 0.17, rootY: 3.1, spine: 0.07, head: -0.12,
    kneeR: -0.7, kneeL: -0.56,
    shR: 0.92, elR: -0.46, wrR: 1.24,
    shL: 0.6, elL: -0.68,
    pelvisYaw: 0.06,
  }, 'inOutSine'),
  keyframe(2.4, {
    rootRot: 0.16, rootY: 3.3, spine: 0.07, head: -0.13,
    kneeR: -0.66, kneeL: -0.6,
    shR: 0.9, elR: -0.48, wrR: 1.16,
    shL: 0.58, elL: -0.7,
    pelvisYaw: 0.02,
  }, 'inOutSine'),
  keyframe(3.2, {
    rootRot: 0.16, rootY: 3, spine: 0.07, head: -0.13,
    hipR: 0.4, kneeR: -0.68, footR: 0.14,
    hipL: -0.38, kneeL: -0.6, footL: 0.13,
    shR: 0.9, elR: -0.48, wrR: 1.18,
    shL: 0.58, elL: -0.7, wrL: -0.26,
    pelvisYaw: 0.05,
  }, 'inOutSine'),
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
  keyframe(0.62, { // SLIDE — steel runs home to the kojiri
    rootRot: 0.08, rootY: 0.6, spine: 0.02, head: 0,
    hipR: 0.28, kneeR: -0.62, footR: 0.1,
    hipL: -0.3, kneeL: -0.58, footL: 0.12,
    shR: -0.25, elR: -0.55, wrR: 4.9, // arm follows the blade in
    shL: -0.15, elL: -0.3, armLz: -0.28,
  }, 'inOutCubic'),
  keyframe(0.85, { // REST — fist settles on the pommel; the body quiet
    rootRot: 0.06, rootY: 0.4, spine: 0.01, head: -0.02,
    hipR: 0.3, kneeR: -0.58, footR: 0.1,
    hipL: -0.3, kneeL: -0.55, footL: 0.12,
    shR: -0.32, elR: -0.42, wrR: 5.0, // hand on the tsuka at the hip
    shL: 0.1, elL: -0.4, armLz: -0.15,
  }, 'outCubic'),
])

/** IAI — the draw. Fast, three beats: stillness → grip → EXPLOSION into guard. */
export const DRAW_CLIP: Clip = makeClip('draw', [
  keyframe(0, { // stillness — hand on the pommel (sheathed rest pose)
    rootRot: 0.06, rootY: 0.4, spine: 0.01, head: -0.02,
    hipR: 0.3, kneeR: -0.58, footR: 0.1,
    hipL: -0.3, kneeL: -0.55, footL: 0.12,
    shR: -0.32, elR: -0.42, wrR: 5.0,
    shL: 0.1, elL: -0.4, armLz: -0.15,
  }, 'outQuad'),
  keyframe(0.07, { // GRIP — the hand snaps onto the tsuka; hips coil back
    rootRot: 0.02, rootY: 1.6, spine: 0.03, head: -0.14,
    hipR: 0.42, kneeR: -0.75, footR: 0.18,
    hipL: -0.36, kneeL: -0.7, footL: 0.1,
    shR: -0.38, elR: -0.6, wrR: 4.85, // tsuka lifts out of the mouth
    shL: -0.2, elL: -0.45, armLz: -0.3,
    pelvisYaw: -0.12,
  }, 'inQuad'),
  keyframe(0.16, { // EXPLOSION — the steel rips out along the rising diagonal
    rootRot: 0.3, rootY: -1.2, spine: 0.12, head: -0.3,
    hipR: 0.6, kneeR: -1.05, footR: 0.26,
    hipL: -0.55, kneeL: -0.35, footL: -0.08,
    shR: 1.55, elR: 0.05, wrR: 0.45, // edge flashing forward-up
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
