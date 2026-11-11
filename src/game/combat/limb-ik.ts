/** STICKMAN RISING — LIMB IK (channel-space two-bone solvers).
 *
 * Extracted from moveset.ts so clip modules (moveset.ts, sakuga.ts) can
 * share the exact same arm/leg authoring math WITHOUT an import cycle
 * (moveset imports sakuga's clips; sakuga needs these solvers). The math
 * is verbatim from the original moveset authors — verified against the
 * FK in anim/skeleton.ts. */

import { PLAYER_SPEC } from '../anim/skeleton'
import { clamp } from '../core/utils'

export type StrikeHand = 'left' | 'right'

/** Solve SHOULDER/ELBOW channels so the hand reaches (x,y) relative to
 * the shoulder joint. Elbow hangs below/behind the shoulder→hand line
 * (human pole). Targets rescale with the arm (see moveset.handPose). */
export function handPose(side: StrikeHand, x: number, y: number): Record<string, number> {
  const a = PLAYER_SPEC.upperArm, b = PLAYER_SPEC.foreArm
  const k = (a + b) / 38
  x *= k; y *= k
  const r = Math.max(12, Math.min(a + b - 2, Math.hypot(x, y)))
  const sh = Math.atan2(x, y) + Math.acos(Math.max(-1, Math.min(1, (a * a + r * r - b * b) / (2 * a * r))))
  const el = -Math.acos(Math.max(-1, Math.min(1, (r * r - a * a - b * b) / (2 * a * b))))
  return side === 'left' ? { shL: sh, elL: el } : { shR: sh, elR: el }
}

/** Solve HIP/KNEE channels so the foot reaches (x,y) relative to the hip
 * joint. Femur = τ+α pokes the knee FORWARD of the hip→ankle line, shin
 * folds back by (α+γ) — the human knee pole; knee channel stays on the
 * negative flexion side.
 *   dMax = reach at 10° flexion (limits floor), dMin at 155°. */
export function legPose(side: StrikeHand, x: number, y: number): Record<string, number> {
  const a = PLAYER_SPEC.thigh, b = PLAYER_SPEC.shin
  const d = Math.max(10.5, Math.min(48.8, Math.hypot(x, y)))
  const tau = Math.atan2(x, y)
  const al = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1))
  const ga = Math.acos(clamp((d * d + b * b - a * a) / (2 * d * b), -1, 1))
  const hip = tau + al
  const knee = -(al + ga)
  return side === 'left' ? { hipL: hip, kneeL: knee } : { hipR: hip, kneeR: knee }
}

/** Kick authoring: legPose + an articulated toe. 'point' extends the toe
 * along the shin (roundhouse/front-kick read); 'heel' flexes it back so
 * the HEEL leads (axe kick chop); 'flat' plants the sole (chambers).
 * fr = 1.3·shinAng reproduces a pointed foot in the FK toe equation. */
export function kickPose(
  side: StrikeHand, x: number, y: number,
  toe: 'point' | 'heel' | 'flat' = 'point',
): Record<string, number> {
  const p = legPose(side, x, y)
  const shin = (side === 'left' ? p.hipL! + p.kneeL! : p.hipR! + p.kneeR!)
  const foot = toe === 'point' ? 1.3 * shin : toe === 'heel' ? 1.3 * shin - 0.7 : 0.06
  return side === 'left' ? { ...p, footL: foot } : { ...p, footR: foot }
}
