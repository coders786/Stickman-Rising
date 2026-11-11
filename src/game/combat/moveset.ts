/** STICKMAN RISING — THE HAND-TO-HAND MOVSET
 *
 * Thirty unique, fully-authored full-body empty-hand animations — a real
 * fighting-game moveset (Tekken-3-style commitment: every move rotates the
 * pelvis, drops the weight, and returns to guard), inspired by the craft
 * principles of high-grade stick animation (strong silhouette arcs,
 * anticipation → snap → follow-through, smear-speed strikes) while being
 * 100% original authorship: no frame is traced from any existing video.
 *
 * Design law for this module:
 *  1. FIGHT GUARD CONTINUITY — every clip starts AND ends at FIGHT_GUARD
 *     (fists up, bladed stance). Chained moves blend guard→chamber→strike
 *     →guard; the shared base means no snap between instances.
 *  2. FULL-BODY COMMITMENT — punches drive pelvisYaw/chestYaw counter-
 *     rotation; kicks swing the whole hip line (legPose IK targets); weight
 *     drops into rootY on impacts. No arm-only punches.
 *  3. IK-AUTHORED CONTACTS — hands and feet reach AUTHORED TARGETS through
 *     the limb solvers below (law-of-cosines, verified against the FK in
 *     anim/skeleton.ts), so the visible knuckle / heel / knee IS the
 *     hitbox segment — no ghost geometry.
 *  4. NAMED BEATS — chamber → ignition → strike → follow-through → settle
 *     → recover. Every clip carries ≥7 real authored keys (the dual-stance
 *     contract) and every keyframe pair respects the continuity budget
 *     audited by .qa/continuity-check.ts (≤0.72 rad worst-case per-frame
 *     channel delta at 60 fps). Mid keys are exact pose-space midpoints
 *     (lerpPose), which provably HALVES each span's peak velocity.
 *  5. ANATOMY FIRST — every keyframe passes applyJointLimits at AUTHOR
 *     time; the runtime gates again before the FK solve.
 *
 * Channel cheat-sheet (see anim/pose.ts):
 *   +X facing · +Y down · rootY = pelvis drop · pelvisYaw + = near hip fwd
 *   chestYaw counters pelvis · armLz/Rz + = toward camera · elbow/knee
 *   channels NEGATIVE (flexion side) · hip + = swing toward facing.
 *   RIGHT limbs are the lead (near-camera) side; LEFT limbs are rear.
 */

import { keyframe, makeClip, type Clip } from '../anim/animator'
import { CH, makePose, type ChannelKey, type PoseInput } from '../anim/pose'
import { applyJointLimits } from '../anim/limits'
import { PLAYER_SPEC } from '../anim/skeleton'
import { clamp } from '../core/utils'
import type { SfxName } from '../audio/audio'
import type { AttackDef, AttackKind } from './attacks'
import {
  SAKUGA_JABCROSS_CLIP, SAKUGA_BARRAGE_CLIP, SAKUGA_DRAGON_CLIP,
  SAKUGA_HAMMER_CLIP, SAKUGA_SCORPION_CLIP, SAKUGA_WRATH_CLIP,
} from './sakuga'
import { RONIN_UNARMED } from './ronin'

export type StrikeHand = 'left' | 'right'
export type StrikeJoint = 'hand' | 'elbow' | 'foot' | 'knee' | 'shoulder'

/* ------------------------------------------------------------------ */
/* LIMB IK — channel-space two-bone solvers                            */
/* ------------------------------------------------------------------ */

/** Solve SHOULDER/ELBOW channels so the hand reaches (x,y) relative to
 * the shoulder joint. Elbow hangs below/behind the shoulder→hand line
 * (human pole). Moved here as the moveset's own arm author (unarmed.ts
 * re-exports it for player.ts compatibility). */
export function handPose(side: StrikeHand, x: number, y: number): PoseInput {
  const a = PLAYER_SPEC.upperArm, b = PLAYER_SPEC.foreArm
  const r = Math.max(12, Math.min(a + b - 2, Math.hypot(x, y)))
  const sh = Math.atan2(x, y) + Math.acos(Math.max(-1, Math.min(1, (a * a + r * r - b * b) / (2 * a * r))))
  const el = -Math.acos(Math.max(-1, Math.min(1, (r * r - a * a - b * b) / (2 * a * b))))
  return side === 'left' ? { shL: sh, elL: el } : { shR: sh, elR: el }
}

/** Solve HIP/KNEE channels so the foot reaches (x,y) relative to the hip
 * joint. Verified against the FK (skeleton.ts): femur = τ+α pokes the knee
 * FORWARD of the hip→ankle line, shin folds back by (α+γ) — the human
 * knee pole. Knee channel stays on the negative flexion side.
 *   dMax = reach at 10° flexion (limits floor), dMin at 155°. */
export function legPose(side: StrikeHand, x: number, y: number): PoseInput {
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
): PoseInput {
  const p = legPose(side, x, y)
  const shin = (side === 'left' ? p.hipL! + p.kneeL! : p.hipR! + p.kneeR!)
  const foot = toe === 'point' ? 1.3 * shin : toe === 'heel' ? 1.3 * shin - 0.7 : 0.06
  return side === 'left' ? { ...p, footL: foot } : { ...p, footR: foot }
}

/* ------------------------------------------------------------------ */
/* FIGHT GUARD — shared start/end pose of the whole empty-hand set     */
/* ------------------------------------------------------------------ */

const G: PoseInput = {
  rootRot: 0.10, spine: 0.03, head: -0.12, rootY: 3.5,
  hipR: 0.42, kneeR: -0.62, footR: 0.10,   // lead leg forward
  hipL: -0.34, kneeL: -0.58, footL: 0.06,  // rear leg back
  pelvisYaw: -0.08, chestYaw: 0.10,        // bladed stance
  ...handPose('left', 9, 5),               // rear fist at the chin
  ...handPose('right', 13, 3),             // lead fist high guard
  wrL: 0, wrR: 0,
  armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02,
}
export const FIGHT_GUARD: PoseInput = G

/* authoring helpers ------------------------------------------------- */

/** keyframe with author-time anatomy clamping. */
const kf = (t: number, d: PoseInput, ease?: string) => {
  const f = keyframe(t, d, ease)
  applyJointLimits(f.p)
  return f
}
/** monotone (shape-preserving C1) clip — strikes never wobble. */
const clip = (name: string, frames: ReturnType<typeof kf>[]): Clip => {
  const c = makeClip(name, frames)
  c.interpolation = 'monotone'
  return c
}
/** Exact pose-space midpoint of two authored keyframe inputs. Inserted
 * between beats as the explicit in-between ("ignition"/"settle") key —
 * halving every channel's delta across the split keeps each sub-span
 * inside the 60fps continuity budget by construction. Both endpoints are
 * ROM-clamped FIRST so limits-corrected channels (e.g. a hip riding the
 * 2.3 envelope) lerp from their true solved values. */
function lerpPose(a: PoseInput, b: PoseInput, t: number): PoseInput {
  const pa = applyJointLimits(makePose(a)), pb = applyJointLimits(makePose(b))
  const out: PoseInput = {}
  for (const k of Object.keys(CH) as ChannelKey[]) {
    out[k] = pa[CH[k]] + (pb[CH[k]] - pa[CH[k]]) * t
  }
  return out
}
const mid = (t: number, a: PoseInput, b: PoseInput): ReturnType<typeof kf> =>
  kf(t, lerpPose(a, b, 0.5))

/* ================================================================== */
/* GROUND LIGHT CHAIN (J, neutral) — the five-speed string             */
/* ================================================================== */

/** 01 · L1 — KIZAMI JAB: lead-hand straight, hip flick, chin down. */
const JAB = clip('unarmedJab', [
  kf(0, G),
  kf(0.06, { ...G, ...handPose('right', 10, 2), chestYaw: 0.18, head: -0.18, rootY: 3.8 }, 'outQuad'),
  mid(0.095, { ...G, ...handPose('right', 10, 2), chestYaw: 0.18, head: -0.18, rootY: 3.8 },
    { ...G, ...handPose('right', 33, -1), chestYaw: -0.22, pelvisYaw: 0.15,
      rootRot: 0.18, head: -0.22, rootX: 3, ...handPose('left', 8, 5) }),
  kf(0.13, { ...G, ...handPose('right', 33, -1), chestYaw: -0.22, pelvisYaw: 0.15,
    rootRot: 0.18, head: -0.22, rootX: 3, ...handPose('left', 8, 5) }, 'inOutCubic'),
  kf(0.19, { ...G, ...handPose('right', 29, 2), chestYaw: -0.12, pelvisYaw: 0.08 }, 'inOutCubic'),
  mid(0.225, { ...G, ...handPose('right', 29, 2), chestYaw: -0.12, pelvisYaw: 0.08 }, G),
  kf(0.26, G),
])

/** 02 · L2 — GYAKU CROSS: rear-hand power straight, full pelvis drive. */
const CROSS = clip('unarmedCross', [
  kf(0, G),
  kf(0.08, { ...G, ...handPose('left', 6, 6), chestYaw: -0.28, pelvisYaw: 0.16, rootY: 4.2, head: -0.16 }, 'outQuad'),
  mid(0.12, { ...G, ...handPose('left', 6, 6), chestYaw: -0.28, pelvisYaw: 0.16, rootY: 4.2, head: -0.16 },
    { ...G, ...handPose('left', 35, 1), chestYaw: 0.38, pelvisYaw: -0.26,
      rootRot: 0.22, rootY: 3.8, rootX: 5, ...handPose('right', 10, 3) }),
  kf(0.16, { ...G, ...handPose('left', 35, 1), chestYaw: 0.38, pelvisYaw: -0.26,
    rootRot: 0.22, rootY: 3.8, rootX: 5, ...handPose('right', 10, 3) }, 'inOutCubic'),
  kf(0.24, { ...G, ...handPose('left', 30, 3), chestYaw: 0.25, pelvisYaw: -0.15 }, 'inOutCubic'),
  mid(0.28, { ...G, ...handPose('left', 30, 3), chestYaw: 0.25, pelvisYaw: -0.15 }, G),
  kf(0.32, G),
])

/** 03 · L3 — KAGI HOOK: lead-hand horizontal hook sweeping through depth. */
const HOOK = clip('unarmedHook', [
  kf(0, G),
  kf(0.08, { ...G, ...handPose('right', 12, 6), armRz: -0.5, foreRz: -0.3,
    chestYaw: 0.32, head: -0.15, rootY: 4 }, 'outQuad'),
  mid(0.13, { ...G, ...handPose('right', 12, 6), armRz: -0.5, foreRz: -0.3,
      chestYaw: 0.32, head: -0.15, rootY: 4 },
    { ...G, ...handPose('right', 26, -2), armRz: 0.35, foreRz: 0.55,
      chestYaw: -0.38, pelvisYaw: 0.22, rootY: 4.4, rootX: 4, ...handPose('left', 8, 5) }),
  kf(0.18, { ...G, ...handPose('right', 26, -2), armRz: 0.35, foreRz: 0.55,
    chestYaw: -0.38, pelvisYaw: 0.22, rootY: 4.4, rootX: 4, ...handPose('left', 8, 5) }, 'inOutCubic'),
  kf(0.26, { ...G, ...handPose('right', 17, 1), armRz: 0.15, foreRz: 0.3,
    chestYaw: -0.2, pelvisYaw: 0.12 }, 'inOutCubic'),
  mid(0.30, { ...G, ...handPose('right', 17, 1), armRz: 0.15, foreRz: 0.3,
      chestYaw: -0.2, pelvisYaw: 0.12 }, G),
  kf(0.34, G),
])

/** 04 · L4 — SLIP BODY ELBOW: drop the level, rear elbow drives into the
 * ribs (pinned elbow-contact routing — the elbow IS the hitbox). */
const BODYBLOW = clip('unarmedBodyElbow', [
  kf(0, G),
  kf(0.08, { ...G, rootY: 9, rootRot: 0.28, spine: 0.06, chestYaw: 0.3, head: -0.2,
    ...handPose('right', 2, 6) }, 'outQuad'),
  mid(0.13, { ...G, rootY: 9, rootRot: 0.28, spine: 0.06, chestYaw: 0.3, head: -0.2,
      ...handPose('right', 2, 6) },
    { ...G, rootY: 8, rootRot: 0.3, spine: 0.05, shR: 1.15, elR: -2.5, armRz: -0.3, foreRz: -0.35,
      chestYaw: -0.36, pelvisYaw: 0.2, head: -0.22, ...handPose('left', 11, 2) }),
  kf(0.18, { ...G, rootY: 8, rootRot: 0.3, spine: 0.05, shR: 1.15, elR: -2.5, armRz: -0.3, foreRz: -0.35,
    chestYaw: -0.36, pelvisYaw: 0.2, head: -0.22, ...handPose('left', 11, 2) }, 'inOutCubic'),
  kf(0.27, { ...G, rootY: 6, rootRot: 0.22, shR: 0.95, elR: -2.4, chestYaw: -0.15 }, 'inOutCubic'),
  mid(0.315, { ...G, rootY: 6, rootRot: 0.22, shR: 0.95, elR: -2.4, chestYaw: -0.15 }, G),
  kf(0.36, G),
])

/** 05 · L5 — TWIN SHOTEI: lunging double-palm thrust (guard breaker). */
const TWINPALM = clip('unarmedTwinPalm', [
  kf(0, G),
  kf(0.10, { ...G, rootY: 6, rootRot: 0.12, chestYaw: 0.2, pelvisYaw: -0.1,
    ...handPose('left', 5, 13), ...handPose('right', 6, 12),
    wrL: -0.3, wrR: -0.3 }, 'outQuad'),
  mid(0.15, { ...G, rootY: 6, rootRot: 0.12, chestYaw: 0.2, pelvisYaw: -0.1,
      ...handPose('left', 5, 13), ...handPose('right', 6, 12),
      wrL: -0.3, wrR: -0.3 },
    { ...G, rootY: 4, rootRot: 0.30, spine: 0.05, rootX: 5, chestYaw: -0.15, pelvisYaw: 0.12,
      head: -0.2, ...handPose('left', 33, 3), ...handPose('right', 33, 7),
      wrL: -0.5, wrR: -0.5 }),
  kf(0.20, { ...G, rootY: 4, rootRot: 0.30, spine: 0.05, rootX: 5, chestYaw: -0.15, pelvisYaw: 0.12,
    head: -0.2, ...handPose('left', 33, 3), ...handPose('right', 33, 7),
    wrL: -0.5, wrR: -0.5 }, 'inOutCubic'),
  kf(0.30, { ...G, rootY: 4.5, rootRot: 0.24, ...handPose('left', 29, 4), ...handPose('right', 29, 8) }, 'inOutCubic'),
  mid(0.37, { ...G, rootY: 4.5, rootRot: 0.24, ...handPose('left', 29, 4), ...handPose('right', 29, 8) }, G),
  kf(0.44, G),
])

/* ================================================================== */
/* CONTEXTUAL GROUND LIGHTS (direction + J)                            */
/* ================================================================== */

/** 06 · RETREAT — HOP-BACK SPINNING BACKFIST (J + back). */
const BACKFIST = clip('unarmedBackfist', [
  kf(0, G),
  kf(0.06, { ...G, rootRot: -0.05, rootY: 4.5, ...handPose('left', 2, 6),
    armLz: -0.4, chestYaw: 0.45, head: -0.15 }, 'outQuad'),
  mid(0.11, { ...G, rootRot: -0.05, rootY: 4.5, ...handPose('left', 2, 6),
      armLz: -0.4, chestYaw: 0.45, head: -0.15 },
    { ...G, rootRot: 0.2, rootY: 3.8, ...handPose('left', 30, -4), wrL: -0.4,
      armLz: 0.3, foreLz: 0.4, chestYaw: -0.5, pelvisYaw: -0.25, head: -0.2 }),
  kf(0.16, { ...G, rootRot: 0.2, rootY: 3.8, ...handPose('left', 30, -4), wrL: -0.4,
    armLz: 0.3, foreLz: 0.4, chestYaw: -0.5, pelvisYaw: -0.25, head: -0.2 }, 'inOutCubic'),
  kf(0.26, { ...G, ...handPose('left', 18, 4), chestYaw: -0.25, head: -0.16 }, 'inOutCubic'),
  mid(0.32, { ...G, ...handPose('left', 18, 4), chestYaw: -0.25, head: -0.16 }, G),
  kf(0.38, G),
])

/** 07 · SPIN slot — CROUCHING HEEL SWEEP (J + down). Full-body drop,
 * near-leg low arc, off-hand plants for balance. */
const SWEEP = clip('unarmedSweep', [
  kf(0, G),
  kf(0.09, { ...G, rootY: 12, rootRot: 0.34, spine: 0.08, head: -0.1,
    ...legPose('left', -2, 26), kneeL: -1.9, ...legPose('right', 8, 30) }, 'outQuad'),
  mid(0.14, { ...G, rootY: 12, rootRot: 0.34, spine: 0.08, head: -0.1,
      ...legPose('left', -2, 26), kneeL: -1.9, ...legPose('right', 8, 30) },
    { ...G, rootY: 12, rootRot: 0.36, spine: 0.08, ...kickPose('right', 36, 30, 'point'),
      hipRz: 0.3, chestYaw: -0.3, ...legPose('left', -4, 24), kneeL: -2.0,
      ...handPose('left', 13, 20), ...handPose('right', 6, 10), head: -0.12 }),
  kf(0.19, { ...G, rootY: 12, rootRot: 0.36, spine: 0.08, ...kickPose('right', 36, 30, 'point'),
    hipRz: 0.3, chestYaw: -0.3, ...legPose('left', -4, 24), kneeL: -2.0,
    ...handPose('left', 13, 20), ...handPose('right', 6, 10), head: -0.12 }, 'inOutCubic'),
  kf(0.29, { ...G, rootY: 10, rootRot: 0.3, ...kickPose('right', 30, 28, 'point'), hipRz: 0.15,
    chestYaw: -0.15 }, 'inOutCubic'),
  mid(0.355, { ...G, rootY: 10, rootRot: 0.3, ...kickPose('right', 30, 28, 'point'), hipRz: 0.15,
      chestYaw: -0.15 }, G),
  kf(0.42, G, 'outCubic'),
])

/** 08 · LAUNCHER — RISING DRAGON UPPERCUT (J + up). Leaping shōto uppercut. */
const UPPERcut = clip('unarmedUpperCut', [
  kf(0, G),
  kf(0.10, { ...G, rootY: 9, rootRot: 0.16, chestYaw: 0.3, ...handPose('right', 6, 16),
    head: -0.16 }, 'outQuad'),
  mid(0.15, { ...G, rootY: 9, rootRot: 0.16, chestYaw: 0.3, ...handPose('right', 6, 16),
      head: -0.16 },
    { ...G, rootY: -1, rootRot: -0.08, chestYaw: -0.35, pelvisYaw: 0.2,
      ...handPose('right', 20, -30), armRz: 0.25,
      hipR: 0.2, kneeR: -0.4, hipL: -0.5, kneeL: -0.7, head: -0.08 }),
  kf(0.20, { ...G, rootY: -1, rootRot: -0.08, chestYaw: -0.35, pelvisYaw: 0.2,
    ...handPose('right', 20, -30), armRz: 0.25,
    hipR: 0.2, kneeR: -0.4, hipL: -0.5, kneeL: -0.7, head: -0.08 }, 'inOutCubic'),
  kf(0.30, { ...G, rootY: 1, rootRot: 0.02, ...handPose('right', 16, -22),
    chestYaw: -0.2 }, 'inOutCubic'),
  mid(0.36, { ...G, rootY: 1, rootRot: 0.02, ...handPose('right', 16, -22),
      chestYaw: -0.2 }, G),
  kf(0.42, G),
])

/** 09 · STABS slot — RENZOKU KNEE RUSH (J + forward mid-chain). Triple
 * driving knee barrage with forward pressure. */
const KNEEBARRAGE = clip('unarmedKneeBarrage', [
  kf(0, G),
  // GAP-1 · anticipation: the knee-rush entry sinks and counter-winds —
  // chest opens back, hips wind away before the first driving knee
  kf(0.03, { ...G, rootY: 5.5, rootRot: 0.1, chestYaw: 0.2, pelvisYaw: -0.12,
    hipR: 0.9, kneeR: -1.15, footR: 0.08 }, 'outQuad'),
  kf(0.06, { ...G, rootY: 5, rootRot: 0.16, ...legPose('right', 8, 22), kneeR: -1.6 }, 'outQuad'),
  kf(0.12, { ...G, rootY: 4, rootRot: 0.2, ...legPose('right', 27, 6), kneeR: -1.5, pelvisYaw: 0.15,
    ...handPose('left', 8, 6), ...handPose('right', 10, 8) }, 'inOutCubic'),
  kf(0.20, { ...G, rootY: 5.5, rootRot: 0.16, ...legPose('right', 6, 24), kneeR: -1.7, pelvisYaw: -0.05 }, 'outQuad'),
  kf(0.27, { ...G, rootY: 4, rootRot: 0.2, ...legPose('right', 28, 4), kneeR: -1.4, pelvisYaw: 0.18 }, 'inOutCubic'),
  kf(0.35, { ...G, rootY: 5.5, rootRot: 0.16, ...legPose('right', 7, 24), kneeR: -1.7, pelvisYaw: -0.05 }, 'outQuad'),
  kf(0.42, { ...G, rootY: 4, rootRot: 0.22, ...legPose('right', 29, 3), kneeR: -1.35, pelvisYaw: 0.2 }, 'inOutCubic'),
  mid(0.485, { ...G, rootY: 4, rootRot: 0.22, ...legPose('right', 29, 3), kneeR: -1.35, pelvisYaw: 0.2 }, G),
  kf(0.55, G),
])

/* ================================================================== */
/* GROUND HEAVIES (K, neutral chain)                                   */
/* ================================================================== */

/** 10 · H1 — RIPPLING ELBOW (empi-uchi): horizontal elbow slash, the
 * elbow itself is the hitbox. */
const ELBOW = clip('unarmedElbow', [
  kf(0, G),
  kf(0.08, { ...G, rootY: 5, rootRot: 0.14, chestYaw: 0.5, ...handPose('right', 2, 6), elR: -2.5,
    armRz: -0.3 }, 'outQuad'),
  mid(0.14, { ...G, rootY: 5, rootRot: 0.14, chestYaw: 0.5, ...handPose('right', 2, 6), elR: -2.5,
      armRz: -0.3 },
    { ...G, rootY: 4.5, rootRot: 0.25, rootX: 5, shR: 1.3, elR: -2.5, armRz: -0.35,
      foreRz: -0.4, chestYaw: -0.45, pelvisYaw: 0.25, head: -0.18 }),
  kf(0.20, { ...G, rootY: 4.5, rootRot: 0.25, rootX: 5, shR: 1.3, elR: -2.5, armRz: -0.35,
    foreRz: -0.4, chestYaw: -0.45, pelvisYaw: 0.25, head: -0.18 }, 'inOutCubic'),
  kf(0.30, { ...G, rootY: 4, rootRot: 0.2, shR: 1.05, elR: -2.4, chestYaw: -0.25 }, 'inOutCubic'),
  mid(0.36, { ...G, rootY: 4, rootRot: 0.2, shR: 1.05, elR: -2.4, chestYaw: -0.25 }, G),
  kf(0.42, G),
])

/** 11 · H2 — TORNADO ROUNDHOUSE (mawashi-geri): near-leg high arc with
 * full pelvis/chest rotation and a pointed-foot contact. */
const ROUNDHOUSE = clip('unarmedRoundhouse', [
  kf(0, G),
  kf(0.13, { ...G, rootY: 5, rootRot: 0.12, pelvisYaw: -0.35, chestYaw: 0.42,
    ...kickPose('right', 10, -6, 'point'), kneeR: -2.2, hipRz: 0.35,
    shL: 0.9, shR: 0.3, head: -0.12 }, 'outQuad'),
  mid(0.195, { ...G, rootY: 5, rootRot: 0.12, pelvisYaw: -0.35, chestYaw: 0.42,
      ...kickPose('right', 10, -6, 'point'), kneeR: -2.2, hipRz: 0.35,
      shL: 0.9, shR: 0.3, head: -0.12 },
    { ...G, rootY: 3, rootRot: 0.22, pelvisYaw: 0.45, chestYaw: -0.5,
      ...kickPose('right', 32, -16, 'point'), kneeR: -0.5, hipRz: -0.3,
      hipL: -0.5, kneeL: -0.8, shL: 0.3, shR: -0.75, head: -0.15 }),
  kf(0.26, { ...G, rootY: 3, rootRot: 0.22, pelvisYaw: 0.45, chestYaw: -0.5,
    ...kickPose('right', 32, -16, 'point'), kneeR: -0.5, hipRz: -0.3,
    hipL: -0.5, kneeL: -0.8, shL: 0.3, shR: -0.75, head: -0.15 }, 'inOutCubic'),
  kf(0.39, { ...G, rootY: 4, rootRot: 0.18, pelvisYaw: 0.25, chestYaw: -0.3,
    ...kickPose('right', 24, -6, 'point'), kneeR: -0.9, shR: 1.2 }, 'inOutCubic'),
  mid(0.455, { ...G, rootY: 4, rootRot: 0.18, pelvisYaw: 0.25, chestYaw: -0.3,
      ...kickPose('right', 24, -6, 'point'), kneeR: -0.9, shR: 1.2 }, G),
  kf(0.52, G),
])

/** 12 · H3 — SKYHAMMER FIST: overhead double hammer-fist smash. */
const HAMMER = clip('unarmedHammer', [
  kf(0, G),
  kf(0.12, { ...G, rootY: 2, rootRot: -0.06, shR: 2.6, elR: -0.85, shL: 2.5, elL: -0.9,
    wrR: -0.4, wrL: -0.4, head: -0.2 }, 'outQuad'),
  kf(0.24, { ...G, rootY: 4, rootRot: -0.04, shR: 2.7, elR: -0.6, shL: 2.6, elL: -0.7,
    wrR: -0.4, wrL: -0.4, head: -0.22 }, 'inOutCubic'),
  kf(0.32, { ...G, rootY: 9, rootRot: 0.45, spine: 0.1, ...handPose('right', 18, 22), elR: -0.55,
    ...handPose('left', 15, 22), elL: -0.6, wrR: -0.5, wrL: -0.5,
    hipR: 0.6, kneeR: -1.2, hipL: -0.55, kneeL: -1.15, head: -0.05 }, 'inCubic'),
  kf(0.44, { ...G, rootY: 7, rootRot: 0.36, ...handPose('right', 16, 18), ...handPose('left', 14, 18) }, 'inOutCubic'),
  mid(0.51, { ...G, rootY: 7, rootRot: 0.36, ...handPose('right', 16, 18), ...handPose('left', 14, 18) }, G),
  kf(0.58, G),
])

/* ================================================================== */
/* NEW DIRECTIONAL HEAVIES (K + direction — unarmed command moves)     */
/* ================================================================== */

/** 13 · AXE KICK (kakato-geri) — K + down. Heel raised overhead, chopped
 * down through the guard. */
const AXEKICK = clip('unarmedAxeKick', [
  kf(0, G),
  kf(0.14, { ...G, rootY: 5, rootRot: -0.1, chestYaw: 0.22, ...kickPose('right', 16, -32, 'flat'),
    hipRz: 0.25, hipL: -0.55, kneeL: -0.75, head: -0.1 }, 'outQuad'),
  kf(0.20, { ...G, rootY: 4, rootRot: -0.12, ...kickPose('right', 20, -36, 'flat'),
    hipRz: 0.2, hipL: -0.6, kneeL: -0.7, head: -0.08 }, 'inOutCubic'),
  kf(0.28, { ...G, rootY: 8, rootRot: 0.3, spine: 0.05, ...kickPose('right', 30, 8, 'heel'),
    kneeR: -0.2, hipRz: -0.1, chestYaw: -0.2, hipL: -0.45, kneeL: -0.7, head: 0.05 }, 'inCubic'),
  kf(0.38, { ...G, rootY: 6, rootRot: 0.22, ...legPose('right', 24, 14), kneeR: -0.5 }, 'inOutCubic'),
  mid(0.465, { ...G, rootY: 6, rootRot: 0.22, ...legPose('right', 24, 14), kneeR: -0.5 }, G),
  kf(0.55, G),
])

/** 14 · SPINNING HOOK KICK (uden-geri) — K + back. Full-body 360 with a
 * real depth-plane hook (pelvis/chest yaw sweep, foot cuts the camera). */
const SPINHOOK = clip('unarmedSpinHook', [
  kf(0, G),
  kf(0.14, { ...G, rootY: 6, rootRot: 0.1, pelvisYaw: 0.5, chestYaw: 0.6, head: 0.35,
    shR: 0.2, shL: 0.5, ...legPose('right', 8, 18), kneeR: -1.8 }, 'outQuad'),
  kf(0.26, { ...G, rootY: 4.5, rootRot: 0.16, pelvisYaw: -0.55, chestYaw: -0.75, head: -0.1,
    ...kickPose('right', 34, -20, 'point'), kneeR: -0.9, hipRz: 0.4,
    hipL: -0.5, kneeL: -0.85, shR: 0.4, shL: -0.5 }, 'inCubic'),
  kf(0.36, { ...G, rootY: 5, rootRot: 0.14, pelvisYaw: -0.3, chestYaw: -0.45,
    ...kickPose('right', 22, -12, 'point'), kneeR: -1.3, hipRz: 0.15, shR: 1.3, shL: 0.9 }, 'inOutCubic'),
  kf(0.50, { ...G, rootY: 4, pelvisYaw: 0.05, chestYaw: 0.05, head: -0.12 }, 'inOutCubic'),
  mid(0.56, { ...G, rootY: 4, pelvisYaw: 0.05, chestYaw: 0.05, head: -0.12 }, G),
  kf(0.62, G),
])

/** 15 · FRONT THRUST KICK (mae-geri kekomi) — K + forward. Stop-kick with
 * long pushback: near-full leg extension, pointed foot. */
const STEPKICK = clip('unarmedStepKick', [
  kf(0, G),
  // GAP-1 · anticipation: the stop-kick coils — weight sinks, the knee
  // starts its cocked chamber and the chest counter-rotates open before
  // the shin snaps out
  kf(0.06, { ...G, rootY: 5, rootRot: -0.05, chestYaw: 0.22, pelvisYaw: -0.14,
    head: -0.1, hipR: 1.35, kneeR: -1.1, footR: 0.06, shL: 1.4, shR: 1.35 }, 'inOutSine'),
  kf(0.13, { ...G, rootY: 4, rootRot: -0.08, ...legPose('right', 12, 2), kneeR: -2.0,
    shL: 0.6, shR: 0.3, head: -0.12 }, 'outQuad'),
  mid(0.18, { ...G, rootY: 4, rootRot: -0.08, ...legPose('right', 12, 2), kneeR: -2.0,
      shL: 0.6, shR: 0.3, head: -0.12 },
    { ...G, rootY: 3, rootRot: -0.1, ...kickPose('right', 40, -4, 'point'), kneeR: -0.35,
      chestYaw: -0.2, pelvisYaw: 0.12, shL: 0.65, shR: -0.55, head: -0.1 }),
  kf(0.23, { ...G, rootY: 3, rootRot: -0.1, ...kickPose('right', 40, -4, 'point'), kneeR: -0.35,
    chestYaw: -0.2, pelvisYaw: 0.12, shL: 0.65, shR: -0.55, head: -0.1 }, 'inOutCubic'),
  kf(0.33, { ...G, rootY: 3.5, rootRot: -0.05, ...legPose('right', 30, 4), kneeR: -0.8, shR: 1.1 }, 'inOutCubic'),
  mid(0.395, { ...G, rootY: 3.5, rootRot: -0.05, ...legPose('right', 30, 4), kneeR: -0.8, shR: 1.1 }, G),
  kf(0.46, G),
])

/* ================================================================== */
/* DASH ATTACKS                                                        */
/* ================================================================== */

/** 16 · DASH LIGHT — SHOULDER TACKLE: lowered shoulder drives through
 * (hitbox tracks the glenohumeral point). */
const TACKLE = clip('unarmedTackle', [
  kf(0, G),
  // GAP-1 · anticipation: rearward gather — the body pitches BACK, elbows
  // fold, chest counter-winds before the shoulder drive fires forward
  kf(0.08, { ...G, rootRot: 0.16, rootY: 5.5, spine: 0.05, head: -0.12,
    shR: 1.15, shL: 1.05, elR: -1.9, elL: -2.0,
    chestYaw: 0.28, pelvisYaw: -0.12 }, 'outQuad'),
  kf(0.14, { ...G, rootRot: 0.5, spine: 0.12, rootY: 5, head: -0.15, shR: 0.3, shL: 0.0,
    elR: -1.4, elL: -1.5, chestYaw: 0.15 }, 'outQuad'),
  kf(0.22, { ...G, rootRot: 0.55, spine: 0.12, rootY: 4.5, head: -0.18, shR: -0.7, shL: -0.55,
    elR: -1.5, elL: -1.35, chestYaw: 0.1 }, 'inOutCubic'),
  mid(0.29, { ...G, rootRot: 0.55, spine: 0.12, rootY: 4.5, head: -0.18, shR: -0.7, shL: -0.55,
      elR: -1.5, elL: -1.35, chestYaw: 0.1 },
    { ...G, rootRot: 0.4, rootY: 4, head: -0.12, shR: 1.2, shL: 1.0 }),
  kf(0.36, { ...G, rootRot: 0.4, rootY: 4, head: -0.12, shR: 1.2, shL: 1.0 }, 'inOutCubic'),
  mid(0.41, { ...G, rootRot: 0.4, rootY: 4, head: -0.12, shR: 1.2, shL: 1.0 }, G),
  kf(0.46, G),
])

/** 17 · DASH HEAVY — TIGER SLIDE: drop into a sliding low kick with a
 * ground-bracing off-hand. */
const SLIDEKICK = clip('unarmedSlideKick', [
  kf(0, G),
  kf(0.10, { ...G, rootY: 14, rootRot: 0.3, spine: 0.08, ...legPose('left', -6, 22), kneeL: -1.9,
    ...legPose('right', 12, 26), ...handPose('left', 14, 22), ...handPose('right', 8, 8) }, 'outQuad'),
  mid(0.16, { ...G, rootY: 14, rootRot: 0.3, spine: 0.08, ...legPose('left', -6, 22), kneeL: -1.9,
      ...legPose('right', 12, 26), ...handPose('left', 14, 22), ...handPose('right', 8, 8) },
    { ...G, rootY: 14, rootRot: 0.32, ...kickPose('right', 38, 24, 'point'), kneeR: -0.35,
      ...legPose('left', -6, 22), kneeL: -2.0, ...handPose('left', 15, 24), ...handPose('right', 5, 10),
      chestYaw: -0.25, head: -0.1 }),
  kf(0.22, { ...G, rootY: 14, rootRot: 0.32, ...kickPose('right', 38, 24, 'point'), kneeR: -0.35,
    ...legPose('left', -6, 22), kneeL: -2.0, ...handPose('left', 15, 24), ...handPose('right', 5, 10),
    chestYaw: -0.25, head: -0.1 }, 'inOutCubic'),
  kf(0.36, { ...G, rootY: 12, rootRot: 0.28, ...kickPose('right', 30, 22, 'point'), kneeR: -0.8 }, 'inOutCubic'),
  mid(0.43, { ...G, rootY: 12, rootRot: 0.28, ...kickPose('right', 30, 22, 'point'), kneeR: -0.8 }, G),
  kf(0.50, G, 'outCubic'),
])

/** 17b · POWER DASH ATTACK (sheathed) — CHARGED RAM: the sprinter coil's
 * empty-hand release. The planted charge already paid the startup, so the
 * ram ignites inside the drive: shoulder drops, whole body launches level,
 * and the lunge haymaker rides the pass THROUGH the line, weight reclaiming
 * only after the follow-through. Mirrors atk_powerArc's beat structure. */
const POWERRAM = clip('unarmedPowerRam', [
  // carried coil — pose-continuous with the charge stance's LOCK beat
  kf(0, { ...G, rootY: 4, rootRot: 0.5, spine: 0.06, head: -0.3,
    ...legPose('right', 10, 34), kneeR: -1.35, ...legPose('left', -14, 40), kneeL: -0.5,
    ...handPose('right', -4, 20), ...handPose('left', 12, 2),
    pelvisYaw: 0.14, chestYaw: -0.14 }, 'outQuad'),
  // final micro-load: the last coil before the launch
  kf(0.05, { ...G, rootY: 4.4, rootRot: 0.56, spine: 0.07, head: -0.34,
    ...legPose('right', 10, 36), kneeR: -1.42, ...legPose('left', -15, 42), kneeL: -0.45,
    ...handPose('right', -7, 18), ...handPose('left', 13, 1) }, 'outQuad'),
  // STRIKE: shoulder leads through the pack — full-body commitment
  kf(0.11, { ...G, rootY: 3.4, rootRot: 0.5, spine: 0.14, head: -0.26, rootX: 6,
    ...legPose('right', 16, 42), kneeR: -1.45, ...legPose('left', -18, 44), kneeL: -0.4,
    ...handPose('right', 30, -2), chestYaw: -0.28, pelvisYaw: 0.18 }, 'outQuart'),
  // follow-through: the haymaker arm whips past, hips unwind
  kf(0.19, { ...G, rootY: 3.8, rootRot: 0.4, spine: 0.1, head: -0.2, rootX: 7,
    ...legPose('right', 15, 44), kneeR: -1.5, ...legPose('left', -12, 42), kneeL: -0.62,
    ...handPose('right', 36, 6), chestYaw: -0.12, pelvisYaw: 0.1 }, 'outCubic'),
  // settle: the skid catch reclaims the guard
  kf(0.28, { ...G, rootY: 4.2, rootRot: 0.28, head: -0.16,
    ...legPose('right', 12, 40), kneeR: -1.5, ...legPose('left', -8, 38), kneeL: -0.9,
    ...handPose('right', 22, 6), ...handPose('left', 9, 5) }, 'inOutCubic'),
  mid(0.36, { ...G, rootY: 4.2, rootRot: 0.28, head: -0.16,
    ...legPose('right', 12, 40), kneeR: -1.5, ...legPose('left', -8, 38), kneeL: -0.9,
    ...handPose('right', 22, 6), ...handPose('left', 9, 5) }, G),
  kf(0.44, G),
])

/** 17c · SHEATHED DUAL RELEASE — RAIJIN KEN (雷神拳, thunder-god fist): the
 * empty-hand twin of RAIJIN ZAN. Both keys held through the planted coil
 * (dash + heavy, blade sheathed — the FIST_DUAL_CHARGE chamber), released
 * together: one committed power-dash drive with the cross ripping THROUGH
 * the pack. The startup was fully paid inside the chamber — the first
 * frame IS the detonation.
 *
 * Choreography (the same Alan-Becker-language beat structure as
 * atk_powerSlash): SIT (.035) the last compression · DETONATION (.08) the
 * legs fire — the body is GONE before the fist (motion leads, the weapon
 * lags) · THE CROSS (.14) the fist rips through full extension while the
 * pelvis unwinds through depth (pelvisYaw +.22 → −.20, the fist crossing
 * the depth plane on armRz/foreRz) · CARRY (.21) the torso winds OVER the
 * punched arm · RIDE (.3) · CATCH (.4) the skid plant · SKID (.52) ·
 * settle to the fight guard. kf0 = FIST_DUAL_CHARGE_CLIP's TAUT LOCK,
 * verbatim — the seamless-handoff law. */
const TAUT_LOCK: PoseInput = {
  rootX: 1, rootY: 5.5, rootRot: 0.48, head: -0.42, spine: 0.04,
  hipL: -0.4, kneeL: -0.8, hipR: 0.9, kneeR: -1.72, footR: 0.28, footL: -0.05,
  shR: -0.32, elR: -1.14, wrR: -0.52, shL: 0.85, elL: -1.5, wrL: -0.3,
  pelvisYaw: 0.22, chestYaw: -0.24, armLz: 0.15, foreRz: -0.12,
}
const POWERCROSS = clip('unarmedPowerCross', [
  // the sheathed TAUT LOCK, verbatim — seamless detonation handoff
  kf(0, TAUT_LOCK, 'outQuad'),
  // THE SIT: one final compression beat — squash before the snap
  kf(0.035, { ...TAUT_LOCK, rootY: 5.8, rootRot: 0.52, kneeL: -0.86,
    kneeR: -1.85, head: -0.46 }, 'outQuad'),
  // DETONATION: legs fire — the planted leg drives, the lifted knee plants
  // into the stride; the fist stays cocked (the lag beat: motion leads)
  kf(0.08, { rootX: 2.6, rootY: 4.8, rootRot: 0.9, head: -0.78, spine: 0.05,
    hipL: -0.66, kneeL: -0.55, footL: 0, hipR: 0.82, kneeR: -1.05, footR: 0.18,
    shR: -0.25, elR: -1.0, wrR: -0.5, shL: 0.7, elL: -0.95, wrL: -0.25,
    pelvisYaw: 0.14, chestYaw: -0.12, armLz: 0.1 }, 'outQuad'),
  // THE CROSS: the fist rips through full extension — hips unwind through
  // the swing, the fist CROSSES THE DEPTH PLANE (armRz/foreRz authored)
  kf(0.14, { rootX: 5.5, rootY: 4.2, rootRot: 1.08, spine: 0.1, head: -0.8,
    hipL: -0.9, kneeL: -0.4, footL: 0.06, hipR: 1.0, kneeR: -1.3, footR: 0.2,
    shR: 1.5, elR: 0.15, wrR: 0.15, shL: 0.9, elL: -0.6, wrL: -0.2,
    pelvisYaw: -0.2, chestYaw: 0.2, armRz: 0.3, foreRz: 0.15 }, 'outQuart'),
  // CARRY: follow-through whips the torso over the punched arm
  kf(0.21, { rootX: 8, rootY: 4.0, rootRot: 1.22, spine: 0.1, head: -0.85,
    hipL: -1.0, kneeL: -0.32, footL: 0.1, hipR: 1.12, kneeR: -1.5, footR: 0.22,
    shR: 1.6, elR: 0.35, wrR: -0.4, shL: 1.0, elL: -0.45, wrL: -0.2,
    pelvisYaw: -0.12, chestYaw: 0.1, armRz: 0.2 }, 'outCubic'),
  // RIDE: fist extended, trailing the travel line through the pack
  kf(0.3, { rootX: 7.6, rootY: 4.2, rootRot: 1.2, spine: 0.09, head: -0.82,
    hipL: -0.8, kneeL: -0.5, footL: 0.08, hipR: 1.05, kneeR: -1.42, footR: 0.21,
    shR: 1.45, elR: 0.2, wrR: -0.55, shL: 0.85, elL: -0.55, wrL: -0.2,
    pelvisYaw: -0.06, chestYaw: 0.05, armRz: 0.22 }, 'inOutSine'),
  // THE CATCH: the front leg reaches far ahead and plants the skid
  kf(0.4, { rootX: 6, rootY: 5.2, rootRot: 0.6, spine: 0.05, head: -0.5,
    hipL: -0.55, kneeL: -1.0, footL: 0.08, hipR: 1.05, kneeR: -1.5, footR: 0.25,
    shR: 0.9, elR: -0.1, wrR: -0.7, shL: 0.55, elL: -0.8, wrL: -0.2,
    pelvisYaw: -0.05, chestYaw: 0.02 }, 'outCubic'),
  // SKID ABSORB: weight sits back, the fists settle low
  kf(0.52, { rootX: 3, rootY: 5.6, rootRot: 0.3, spine: 0.05, head: -0.2,
    hipL: -0.5, kneeL: -0.9, footL: 0.1, hipR: 0.6, kneeR: -1.35, footR: 0.18,
    shR: 0.5, elR: -0.4, wrR: -0.6, shL: 0.4, elL: -0.7, wrL: -0.2,
    pelvisYaw: 0.02, chestYaw: 0 }, 'inOutCubic'),
  mid(0.58, { rootX: 3, rootY: 5.6, rootRot: 0.3, spine: 0.05, head: -0.2,
    hipL: -0.5, kneeL: -0.9, footL: 0.1, hipR: 0.6, kneeR: -1.35, footR: 0.18,
    shR: 0.5, elR: -0.4, wrR: -0.6, shL: 0.4, elL: -0.7, wrL: -0.2,
    pelvisYaw: 0.02, chestYaw: 0 }, G),
  kf(0.66, G),
])

/** 17d · SHEATHED DUAL RELEASE — FUJIN KYAKU (風神脚, wind-god kick): the
 * kick twin. Same TAUT LOCK handoff, same detonation law — but the lifted
 * knee never plants: it whips higher into the flight, then the shin snaps
 * out and the sole rips flat THROUGH the pack, crossing the DEPTH plane on
 * hipRz while the torso rides the power-dash pitch into the drive (the
 * body leans with the family — the spear leg IS the weapon). CARRY rides
 * the extended kick; the CATCH plants the landing leg far ahead. */
const POWERKICK = clip('unarmedPowerKick', [
  // the sheathed TAUT LOCK, verbatim — seamless detonation handoff
  kf(0, TAUT_LOCK, 'outQuad'),
  // THE SIT: one final compression beat — the coil loads deeper
  kf(0.035, { ...TAUT_LOCK, rootY: 5.9, rootRot: 0.52, kneeL: -0.88,
    kneeR: -1.9, head: -0.46 }, 'outQuad'),
  // DETONATION: legs fire — the planted leg drives, the chambered knee
  // whips HIGHER into the flight (the spear loads, fist stays home)
  kf(0.08, { rootX: 2.6, rootY: 4.7, rootRot: 0.88, head: -0.75, spine: 0.05,
    hipL: -0.62, kneeL: -0.5, footL: 0, hipR: 1.0, kneeR: -1.55, footR: 0.25,
    shR: -0.2, elR: -0.95, wrR: -0.5, shL: 0.7, elL: -0.9, wrL: -0.25,
    pelvisYaw: 0.16, chestYaw: -0.14, armLz: 0.1 }, 'outQuad'),
  // THE SPEAR: the knee snaps out — the foot rips flat through the pack,
  // the sole CROSSING THE DEPTH PLANE (hipRz), arms flare back for balance
  kf(0.14, { rootX: 5.5, rootY: 4.3, rootRot: 1.05, spine: 0.1, head: -0.8,
    hipL: -0.85, kneeL: -0.45, footL: 0.06, hipR: 1.32, kneeR: -0.14, footR: 1.5,
    shR: -0.15, elR: -0.5, wrR: -0.4, shL: -0.3, elL: -0.45, wrL: -0.25,
    pelvisYaw: -0.08, chestYaw: 0.06, hipRz: 0.2 }, 'outQuart'),
  // CARRY: the spear rides extended through the pack, arms trail wide
  kf(0.21, { rootX: 8, rootY: 4.0, rootRot: 1.2, spine: 0.1, head: -0.85,
    hipL: -1.0, kneeL: -0.32, footL: 0.1, hipR: 1.25, kneeR: -0.2, footR: 0.95,
    shR: -0.2, elR: -0.55, wrR: -0.45, shL: -0.25, elL: -0.5, wrL: -0.25,
    pelvisYaw: -0.1, chestYaw: 0.08, hipRz: 0.15 }, 'outCubic'),
  // RIDE: the kick folds down toward the skim, torso settles
  kf(0.3, { rootX: 7.6, rootY: 4.2, rootRot: 1.18, spine: 0.09, head: -0.82,
    hipL: -0.8, kneeL: -0.5, footL: 0.08, hipR: 1.15, kneeR: -0.5, footR: 0.4,
    shR: 0.1, elR: -0.7, wrR: -0.5, shL: 0.1, elL: -0.7, wrL: -0.2,
    pelvisYaw: -0.05, chestYaw: 0.04 }, 'inOutSine'),
  // THE CATCH: the landing leg plants far ahead, weight absorbs
  kf(0.4, { rootX: 6, rootY: 5.2, rootRot: 0.6, spine: 0.05, head: -0.5,
    hipL: -0.55, kneeL: -1.05, footL: 0.08, hipR: 0.95, kneeR: -1.3, footR: 0.2,
    shR: 0.4, elR: -0.6, wrR: -0.5, shL: 0.5, elL: -0.8, wrL: -0.2,
    pelvisYaw: -0.04, chestYaw: 0.02 }, 'outCubic'),
  // SKID ABSORB: weight sits back, the guard reclaims
  kf(0.52, { rootX: 3, rootY: 5.6, rootRot: 0.3, spine: 0.05, head: -0.2,
    hipL: -0.5, kneeL: -0.9, footL: 0.1, hipR: 0.55, kneeR: -1.3, footR: 0.15,
    shR: 0.45, elR: -0.45, wrR: -0.5, shL: 0.4, elL: -0.7, wrL: -0.2,
    pelvisYaw: 0.02, chestYaw: 0 }, 'inOutCubic'),
  mid(0.58, { rootX: 3, rootY: 5.6, rootRot: 0.3, spine: 0.05, head: -0.2,
    hipL: -0.5, kneeL: -0.9, footL: 0.1, hipR: 0.55, kneeR: -1.3, footR: 0.15,
    shR: 0.45, elR: -0.45, wrR: -0.5, shL: 0.4, elL: -0.7, wrL: -0.2,
    pelvisYaw: 0.02, chestYaw: 0 }, G),
  kf(0.66, G),
])

/* ================================================================== */
/* SPECIALS                                                            */
/* ================================================================== */

/** 18 · RIPOSTE — REKKA COUNTER PALM: parry-convert cross-step burst. */
const COUNTERPALM = clip('unarmedCounterPalm', [
  kf(0, G),
  kf(0.08, { ...G, rootY: 4.5, rootRot: 0.14, ...handPose('left', 14, -2),
    ...handPose('right', 12, 0), chestYaw: 0.3, head: -0.14 }, 'outQuad'),
  mid(0.13, { ...G, rootY: 4.5, rootRot: 0.14, ...handPose('left', 14, -2),
      ...handPose('right', 12, 0), chestYaw: 0.3, head: -0.14 },
    { ...G, rootY: 3.8, rootRot: 0.24, rootX: 6, ...handPose('right', 36, 0),
      wrR: -0.5, chestYaw: -0.32, pelvisYaw: 0.22, head: -0.18 }),
  kf(0.18, { ...G, rootY: 3.8, rootRot: 0.24, rootX: 6, ...handPose('right', 36, 0),
    wrR: -0.5, chestYaw: -0.32, pelvisYaw: 0.22, head: -0.18 }, 'inOutCubic'),
  kf(0.28, { ...G, ...handPose('right', 30, 2), chestYaw: -0.2 }, 'inOutCubic'),
  mid(0.34, { ...G, ...handPose('right', 30, 2), chestYaw: -0.2 }, G),
  kf(0.40, G),
])

/** 19 · CHARGED — SHINRA PALM: coiled hold → twin-palm shockwave. */
const SHINRA = clip('unarmedShinraPalm', [
  kf(0, G),
  kf(0.10, { ...G, rootY: 8, rootRot: 0.15, chestYaw: 0.3, pelvisYaw: -0.12,
    ...handPose('left', 2, 16), ...handPose('right', 2, 18),
    wrL: -0.3, wrR: -0.3 }, 'outQuad'),
  kf(0.20, { ...G, rootY: 8.5, rootRot: 0.16, chestYaw: 0.32, pelvisYaw: -0.14,
    ...handPose('left', 2, 16), ...handPose('right', 2, 18),
    wrL: -0.3, wrR: -0.3 }, 'inOutCubic'),
  kf(0.28, { ...G, rootY: 4, rootRot: 0.3, spine: 0.06, rootX: 5, ...handPose('left', 34, 0),
    ...handPose('right', 34, 8), wrL: -0.55, wrR: -0.55,
    chestYaw: -0.35, pelvisYaw: 0.2, head: -0.15 }, 'inOutCubic'),
  kf(0.40, { ...G, rootY: 4.5, rootRot: 0.24, ...handPose('left', 30, 2), ...handPose('right', 30, 9) }, 'inOutCubic'),
  mid(0.50, { ...G, rootY: 4.5, rootRot: 0.24, ...handPose('left', 30, 2), ...handPose('right', 30, 9) }, G),
  kf(0.60, G),
])

/** 20 · PARRY — FLOWING DEFLECT: both hands sweep inward past the core. */
export const UNARMED_PARRY_CLIP = clip('unarmedParry', [
  kf(0, G),
  kf(0.08, { ...G, rootY: 4.6, rootRot: 0.09, head: -0.1, ...handPose('left', 17, -5),
    ...handPose('right', 13, -3), foreLz: 0.3, foreRz: 0.35 }, 'outQuad'),
  kf(0.30, G),
])

/** 21 · CHARGE HOLD — COILED DRAGON: deep looped chamber with tension
 * sway (PAVE breathes on top). Loops while K is held. */
export const UNARMED_CHARGE_CLIP = clip('unarmedCharge', [
  kf(0, G),
  kf(0.18, { ...G, rootY: 7, rootRot: 0.2, head: -0.16, pelvisYaw: -0.15, chestYaw: 0.2,
    ...handPose('right', 2, 18), ...handPose('left', 14, 3) }, 'inOutSine'),
  kf(0.80, { ...G, rootY: 7.3, rootRot: 0.2, head: -0.16, pelvisYaw: -0.15, chestYaw: 0.2,
    ...handPose('right', 2, 18), ...handPose('left', 14, 3) }, 'inOutSine'),
])
UNARMED_CHARGE_CLIP.loop = true

/* ================================================================== */
/* AIR FAMILY                                                          */
/* ================================================================== */

const AIR_TUCK: PoseInput = { rootY: -1, hipR: 0.75, kneeR: -1.25, hipL: -0.25, kneeL: -1.1 }

/** 22 · A1 — FLYING KNEE: tucked air dash, knee leads the contact. */
const FLYKNEE = clip('unarmedFlyKnee', [
  kf(0, G),
  kf(0.08, { ...G, ...AIR_TUCK, ...legPose('right', 8, 20), kneeR: -1.6, head: -0.18,
    ...handPose('left', 10, 6), ...handPose('right', 10, 8) }, 'outQuad'),
  mid(0.13, { ...G, ...AIR_TUCK, ...legPose('right', 8, 20), kneeR: -1.6, head: -0.18,
      ...handPose('left', 10, 6), ...handPose('right', 10, 8) },
    { ...G, ...AIR_TUCK, rootY: -1, ...legPose('right', 30, 2), kneeR: -1.4,
      pelvisYaw: 0.18, head: -0.2, ...handPose('left', 6, 10), ...handPose('right', 8, 12) }),
  kf(0.18, { ...G, ...AIR_TUCK, rootY: -1, ...legPose('right', 30, 2), kneeR: -1.4,
    pelvisYaw: 0.18, head: -0.2, ...handPose('left', 6, 10), ...handPose('right', 8, 12) }, 'inOutCubic'),
  kf(0.28, { ...G, ...AIR_TUCK, ...legPose('right', 20, 10), kneeR: -1.5 }, 'inOutCubic'),
  mid(0.34, { ...G, ...AIR_TUCK, ...legPose('right', 20, 10), kneeR: -1.5 }, G),
  kf(0.40, G),
])

/** 23 · A2 — AIR CROSS: jumping rear straight. */
const AIRCROSS = clip('unarmedAirCross', [
  kf(0, G),
  mid(0.035, G, { ...G, ...AIR_TUCK, rootY: 0, chestYaw: -0.28, pelvisYaw: 0.14,
      ...handPose('left', 6, 6) }),
  kf(0.07, { ...G, ...AIR_TUCK, rootY: 0, chestYaw: -0.28, pelvisYaw: 0.14,
    ...handPose('left', 6, 6) }, 'outQuad'),
  mid(0.11, { ...G, ...AIR_TUCK, rootY: 0, chestYaw: -0.28, pelvisYaw: 0.14,
      ...handPose('left', 6, 6) },
    { ...G, ...AIR_TUCK, rootY: 0, ...handPose('left', 33, 0),
      chestYaw: 0.35, pelvisYaw: -0.2, head: -0.18, ...handPose('right', 10, 3) }),
  kf(0.15, { ...G, ...AIR_TUCK, rootY: 0, ...handPose('left', 33, 0),
    chestYaw: 0.35, pelvisYaw: -0.2, head: -0.18, ...handPose('right', 10, 3) }, 'inOutCubic'),
  mid(0.235, { ...G, ...AIR_TUCK, rootY: 0, ...handPose('left', 33, 0),
      chestYaw: 0.35, pelvisYaw: -0.2, head: -0.18, ...handPose('right', 10, 3) }, G),
  kf(0.32, G),
])

/** 24 · A3 — CRESCENT ARC (mikazuki-geri): outward depth-arc air kick. */
const CRESCENT = clip('unarmedCrescent', [
  kf(0, G),
  kf(0.13, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 8, -18, 'flat'), kneeR: -1.8,
    hipRz: 0.4, head: -0.14 }, 'outQuad'),
  mid(0.185, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 8, -18, 'flat'), kneeR: -1.8,
      hipRz: 0.4, head: -0.14 },
    { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 30, -14, 'point'), kneeR: -0.7,
      hipRz: -0.25, chestYaw: -0.4, pelvisYaw: 0.25, head: -0.16 }),
  kf(0.24, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 30, -14, 'point'), kneeR: -0.7,
    hipRz: -0.25, chestYaw: -0.4, pelvisYaw: 0.25, head: -0.16 }, 'inOutCubic'),
  kf(0.34, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 22, -6, 'point'), kneeR: -1.2,
    hipRz: 0.1 }, 'inOutCubic'),
  mid(0.40, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 22, -6, 'point'), kneeR: -1.2,
      hipRz: 0.1 }, G),
  kf(0.46, G),
])

/** 25 · DIVE — METEOR DROPKICK: airborne two-foot torpedo (hitbox = the
 * near foot segment; slam momentum preserved by moveY). */
const DROPKICK = clip('unarmedDropKick', [
  kf(0, G),
  kf(0.08, { ...G, rootY: 0, rootRot: -0.2, hipR: 1.1, kneeR: -1.5, hipL: 0.9, kneeL: -1.4,
    shR: 1.1, shL: 0.8 }, 'outQuad'),
  mid(0.13, { ...G, rootY: 0, rootRot: -0.2, hipR: 1.1, kneeR: -1.5, hipL: 0.9, kneeL: -1.4,
      shR: 1.1, shL: 0.8 },
    { ...G, rootY: 0, rootRot: -0.25, ...kickPose('right', 36, -6, 'point'), kneeR: -0.3,
      ...kickPose('left', 32, -2, 'point'), kneeL: -0.35, shR: -0.5, shL: -0.45, elR: -0.9, elL: -0.85,
      head: -0.12 }),
  kf(0.18, { ...G, rootY: 0, rootRot: -0.25, ...kickPose('right', 36, -6, 'point'), kneeR: -0.3,
    ...kickPose('left', 32, -2, 'point'), kneeL: -0.35, shR: -0.5, shL: -0.45, elR: -0.9, elL: -0.85,
    head: -0.12 }, 'inOutCubic'),
  kf(0.32, { ...G, rootY: 0, rootRot: -0.2, ...kickPose('right', 33, 2, 'point'), kneeR: -0.45,
    ...kickPose('left', 29, 6, 'point'), kneeL: -0.5, shR: -0.5, shL: -0.45 }, 'inOutCubic'),
  mid(0.445, { ...G, rootY: 0, rootRot: -0.2, ...kickPose('right', 33, 2, 'point'), kneeR: -0.45,
      ...kickPose('left', 29, 6, 'point'), kneeL: -0.5, shR: -0.5, shL: -0.45 }, G),
  kf(0.57, G),
])

/** 26 · SLAM — SEISMIC HEEL DROP: tuck → both heels stamp down (ground
 * shockwave handled by slamImpact, unchanged). */
const HEELDROP = clip('unarmedHeelDrop', [
  kf(0, G),
  kf(0.10, { ...G, rootY: 0, rootRot: 0.1, hipR: 1.0, kneeR: -2.0, hipL: 0.85, kneeL: -1.9,
    shR: 2.5, shL: 2.4, elR: -0.9, elL: -1.0, head: -0.15 }, 'outQuad'),
  kf(0.22, { ...G, rootY: 0, rootRot: 0.12, hipR: 1.0, kneeR: -2.05, hipL: 0.85, kneeL: -1.95,
    shR: 2.55, shL: 2.45, elR: -0.55, elL: -0.6, head: -0.18 }, 'inOutCubic'),
  kf(0.34, { ...G, rootY: 0, rootRot: 0.3, ...legPose('right', 8, 40), kneeR: -0.3,
    ...legPose('left', 6, 38), kneeL: -0.35, footR: 0.3, footL: 0.3,
    shR: 0.6, shL: 0.55, elR: -0.4, elL: -0.45, head: 0.05 }, 'inCubic'),
  kf(0.45, { ...G, rootY: 4, rootRot: 0.24, ...legPose('right', 6, 34), kneeR: -0.7,
    ...legPose('left', 5, 32), kneeL: -0.75, elR: -1.3, elL: -1.3 }, 'inOutCubic'),
  mid(0.505, { ...G, rootY: 4, rootRot: 0.24, ...legPose('right', 6, 34), kneeR: -0.7,
      ...legPose('left', 5, 32), kneeL: -0.75, elR: -1.3, elL: -1.3 }, G),
  kf(0.56, G),
])

/** 27 · AIR + BACK — TWIST KICK: spinning air hook through the depth plane. */
const AIRTWIST = clip('unarmedAirTwist', [
  kf(0, G),
  kf(0.08, { ...G, rootY: 0, pelvisYaw: 0.4, chestYaw: 0.5, head: 0.3, ...AIR_TUCK,
    ...legPose('right', 6, 18), kneeR: -1.8 }, 'outQuad'),
  mid(0.13, { ...G, rootY: 0, pelvisYaw: 0.4, chestYaw: 0.5, head: 0.3, ...AIR_TUCK,
      ...legPose('right', 6, 18), kneeR: -1.8 },
    { ...G, rootY: 0, pelvisYaw: -0.4, chestYaw: -0.55, head: -0.1, ...AIR_TUCK,
      ...kickPose('right', 32, -10, 'point'), kneeR: -0.8, hipRz: 0.35 }),
  kf(0.18, { ...G, rootY: 0, pelvisYaw: -0.4, chestYaw: -0.55, head: -0.1, ...AIR_TUCK,
    ...kickPose('right', 32, -10, 'point'), kneeR: -0.8, hipRz: 0.35 }, 'inOutCubic'),
  kf(0.28, { ...G, rootY: 0, pelvisYaw: -0.15, chestYaw: -0.2, ...AIR_TUCK,
    ...kickPose('right', 20, -6, 'point'), kneeR: -1.3 }, 'inOutCubic'),
  mid(0.36, { ...G, rootY: 0, pelvisYaw: -0.15, chestYaw: -0.2, ...AIR_TUCK,
      ...kickPose('right', 20, -6, 'point'), kneeR: -1.3 }, G),
  kf(0.44, G),
])

/** 28 · AIR + FORWARD — FLYING ELBOW: pitched dive, elbow drives down-forward. */
const AIRELBOW = clip('unarmedAirElbow', [
  kf(0, G),
  kf(0.08, { ...G, rootY: 0, rootRot: 0.35, spine: 0.1, shR: 1.6, elR: -2.5, armRz: -0.3,
    hipR: 0.8, kneeR: -1.5, hipL: -0.2, kneeL: -1.2, head: -0.14 }, 'outQuad'),
  mid(0.13, { ...G, rootY: 0, rootRot: 0.35, spine: 0.1, shR: 1.6, elR: -2.5, armRz: -0.3,
      hipR: 0.8, kneeR: -1.5, hipL: -0.2, kneeL: -1.2, head: -0.14 },
    { ...G, rootY: 0, rootRot: 0.42, spine: 0.1, shR: 1.75, elR: -2.5, armRz: -0.35,
      foreRz: -0.5, hipR: 0.85, kneeR: -1.4, hipL: -0.25, kneeL: -1.15, head: -0.16 }),
  kf(0.18, { ...G, rootY: 0, rootRot: 0.42, spine: 0.1, shR: 1.75, elR: -2.5, armRz: -0.35,
    foreRz: -0.5, hipR: 0.85, kneeR: -1.4, hipL: -0.25, kneeL: -1.15, head: -0.16 }, 'inOutCubic'),
  kf(0.30, { ...G, rootY: 0, rootRot: 0.32, shR: 1.45, elR: -2.35, hipR: 0.7, kneeR: -1.6 }, 'inOutCubic'),
  mid(0.38, { ...G, rootY: 0, rootRot: 0.32, shR: 1.45, elR: -2.35, hipR: 0.7, kneeR: -1.6 }, G),
  kf(0.46, G),
])

/* ================================================================== */
/* ULTIMATE + FLOURISH                                                 */
/* ================================================================== */

/** 29 · UNARMED ULTIMATE — THOUSAND PALM BARRAGE: alternating palms with
 * explicit recoil chambers between beats (five confirmed contacts inside
 * one flowing string). */
const ULTPALMS = clip('unarmedUltPalms', [
  kf(0, G),
  kf(0.07, { ...G, rootY: 5, rootRot: 0.14, chestYaw: 0.25,
    ...handPose('right', 4, 12), ...handPose('left', 4, 12) }, 'outQuad'),
  kf(0.16, { ...G, rootY: 4, rootRot: 0.22, rootX: 3, ...handPose('right', 34, 0),
    wrR: -0.5, ...handPose('left', 8, 6), chestYaw: -0.3, pelvisYaw: 0.2, head: -0.16 }, 'inOutCubic'),
  kf(0.25, { ...G, rootY: 4, rootRot: 0.18, ...handPose('right', 16, 8), ...handPose('left', 16, 8) }, 'inOutCubic'),
  kf(0.34, { ...G, rootY: 4, rootRot: 0.22, rootX: 4, ...handPose('left', 34, 3),
    wrL: -0.5, ...handPose('right', 8, 6), chestYaw: 0.3, pelvisYaw: -0.2, head: -0.16 }, 'inOutCubic'),
  kf(0.43, { ...G, rootY: 4, rootRot: 0.18, ...handPose('right', 16, 8), ...handPose('left', 16, 8) }, 'inOutCubic'),
  kf(0.52, { ...G, rootY: 4, rootRot: 0.24, rootX: 5, ...handPose('right', 34, 0),
    wrR: -0.5, ...handPose('left', 8, 6), chestYaw: -0.32, pelvisYaw: 0.22, head: -0.16 }, 'inOutCubic'),
  kf(0.61, { ...G, rootY: 4, rootRot: 0.18, ...handPose('right', 16, 8), ...handPose('left', 16, 8) }, 'inOutCubic'),
  kf(0.70, { ...G, rootY: 4, rootRot: 0.24, rootX: 6, ...handPose('left', 34, 3),
    wrL: -0.5, ...handPose('right', 8, 6), chestYaw: 0.32, pelvisYaw: -0.22, head: -0.16 }, 'inOutCubic'),
  kf(0.80, { ...G, rootY: 4.5, rootRot: 0.2, ...handPose('right', 28, 3), ...handPose('left', 28, 4) }, 'inOutCubic'),
  kf(0.92, G),
])

/** 30 · SHEATHED IDLE FLOURISH — FIST-PALM SALUTE: the martial bow-in —
 * open palm offered, fist drawn to the hip, then a beckon. */
const FLOURISH = clip('unarmedFlourish', [
  kf(0, G),
  kf(0.18, { ...G, rootY: 4.5, rootRot: 0.2, head: 0.08, ...handPose('left', 26, 6), elL: -0.5,
    wrL: -0.7, ...handPose('right', 0, 16), elR: -2.5, pelvisYaw: 0.1 }, 'inOutSine'),
  kf(0.42, { ...G, rootY: 4.5, rootRot: 0.2, head: 0.08, ...handPose('left', 26, 6), elL: -0.5,
    wrL: -0.7, ...handPose('right', 0, 16), elR: -2.5, pelvisYaw: 0.1 }, 'inOutSine'),
  kf(0.62, { ...G, rootY: 4, rootRot: 0.14, head: -0.1, ...handPose('right', 20, 4), elR: -1.6,
    wrR: -0.6, foreRz: 0.4 }, 'inOutSine'),
  kf(0.82, { ...G, rootY: 4, rootRot: 0.14, head: -0.1, ...handPose('right', 18, 6), elR: -1.7,
    wrR: -0.3, foreRz: -0.2 }, 'inOutSine'),
  kf(1.05, G),
])

/* ================================================================== */
/* MOVE TABLE — every empty-hand AttackDef                             */
/* ================================================================== */

interface MoveSpec {
  id: string
  label: string
  kind: AttackKind
  requires: 'ground' | 'air' | 'any'
  clip: Clip
  limb: StrikeHand
  joint?: StrikeJoint
  hitStart: number
  hitEnd: number
  dmg: number
  stagger?: number
  kb?: number
  kbY?: number
  launch?: number
  juggle?: number
  hitstop?: number
  shake?: number
  heavy?: boolean
  pad?: number
  breakGuard?: boolean
  multiHit?: number
  aoe?: number
  moveX?: number
  moveXAt?: number
  moveY?: number
  moveYAt?: number
  float?: number
  chain?: string[]
  sfxT?: number
  heavySfx?: boolean
  groundDrive?: { duration: number; acceleration: number }
  /** DASH THROUGH-STRIKE corridor (px): the swept volume behind/ahead of
   * the body along the travel line — the sheathed power strikes declare it
   * so the pass tears through the whole pack (see AttackHit). */
  corridorBack?: number
  corridorFront?: number
  /** corridor band height above the feet (px) — the kick rides lower. */
  corridorY?: number
}

/** Enforce the empty-hand contract: visible-limb hitbox (strikeHand set,
 * grip 0 — fists never draw steel), trail == hit window, ≤7 px contact
 * pad (a fist/heel is narrower than any blade), heavy sfx. */
function move(s: MoveSpec): AttackDef {
  const hit: AttackDef['hit'] = {
    start: s.hitStart, end: s.hitEnd, dmg: s.dmg,
    stagger: s.stagger ?? (s.heavy ? 0.4 : 0.2),
    kb: s.kb ?? (s.heavy ? 200 : 95), kbY: s.kbY, launch: s.launch, juggle: s.juggle,
    hitstop: s.hitstop ?? (s.heavy ? 0.06 : 0.035),
    shake: s.shake ?? (s.heavy ? 0.15 : 0.07),
    heavy: !!s.heavy, pad: s.pad ?? (s.heavy ? 7 : 5), breakGuard: s.breakGuard,
    multiHit: s.multiHit, aoe: s.aoe,
    corridorBack: s.corridorBack, corridorFront: s.corridorFront, corridorY: s.corridorY,
  }
  return {
    id: s.id, label: s.label, kind: s.kind, requires: s.requires,
    clip: s.clip, strikeHand: s.limb, strikeJoint: s.joint ?? 'hand', grip: 0,
    chain: s.chain ?? [], cancel: s.hitEnd + (s.heavy ? 0.12 : 0.06),
    hit, trail: { start: s.hitStart, end: s.hitEnd },
    swingSfx: { t: s.sfxT ?? Math.max(0.02, s.hitStart - 0.04), name: (s.heavySfx ?? s.heavy) ? 'swingHeavy' : 'swing' },
    moveX: s.moveX, moveXAt: s.moveXAt, moveY: s.moveY, moveYAt: s.moveYAt,
    float: s.float, groundDrive: s.groundDrive,
  }
}

const MOVES_SRC: MoveSpec[] = [
  /* ground light chain */
  { id: 'l1', label: 'KIZAMI JAB', kind: 'light', requires: 'ground', clip: JAB, limb: 'right',
    hitStart: 0.08, hitEnd: 0.15, dmg: 10, kb: 95,
    chain: ['sakugaJabCross'] },
  { id: 'l2', label: 'GYAKU CROSS', kind: 'light', requires: 'ground', clip: CROSS, limb: 'left',
    hitStart: 0.11, hitEnd: 0.20, dmg: 13, kb: 115,
    chain: ['l3', 'h1', 'h2', 'stabs', 'launcher', 'spin', 'retreat', 'sakugaBarrage'] },
  { id: 'l3', label: 'KAGI HOOK', kind: 'light', requires: 'ground', clip: HOOK, limb: 'right',
    hitStart: 0.12, hitEnd: 0.22, dmg: 14, kb: 125,
    chain: ['l4', 'h1', 'h2', 'stabs', 'launcher', 'retreat'] },
  { id: 'l4', label: 'SLIP BODY ELBOW', kind: 'light', requires: 'ground', clip: BODYBLOW, limb: 'right', joint: 'elbow',
    hitStart: 0.14, hitEnd: 0.26, dmg: 15, kb: 105, stagger: 0.3,
    chain: ['l5', 'h2', 'stabs', 'launcher', 'sakugaDragon'] },
  { id: 'l5', label: 'TWIN SHOTEI', kind: 'light', requires: 'ground', clip: TWINPALM, limb: 'right',
    hitStart: 0.16, hitEnd: 0.30, dmg: 16, kb: 165, breakGuard: true,
    chain: ['srOnslaught'] },
  /* contextual lights */
  { id: 'retreat', label: 'HOP-BACK BACKFIST', kind: 'light', requires: 'ground', clip: BACKFIST, limb: 'left',
    hitStart: 0.10, hitEnd: 0.22, dmg: 13, kb: 130, moveX: -110, moveXAt: 0.02 },
  { id: 'spin', label: 'CROUCHING SWEEP', kind: 'spin', requires: 'ground', clip: SWEEP, limb: 'right', joint: 'foot',
    hitStart: 0.15, hitEnd: 0.29, dmg: 14, kb: 120, kbY: 60, launch: 80, stagger: 0.5 },
  { id: 'launcher', label: 'RISING DRAGON', kind: 'launcher', requires: 'ground', clip: UPPERcut, limb: 'right',
    hitStart: 0.12, hitEnd: 0.22, dmg: 16, kb: 100, kbY: -240, launch: 420, moveY: -300, moveYAt: 0.13,
    float: 0.75, chain: ['a1', 'a2', 'a3', 'dive', 'slam'] },
  { id: 'stabs', label: 'RENZOKU KNEE RUSH', kind: 'light', requires: 'ground', clip: KNEEBARRAGE, limb: 'right', joint: 'knee',
    hitStart: 0.10, hitEnd: 0.42, dmg: 9, kb: 70, multiHit: 0.12, moveX: 120, moveXAt: 0.02 },
  /* heavies */
  { id: 'h1', label: 'RIPPLING ELBOW', kind: 'heavy', requires: 'ground', clip: ELBOW, limb: 'right', joint: 'elbow',
    hitStart: 0.14, hitEnd: 0.26, dmg: 20, kb: 180, heavy: true,
    chain: ['l1', 'l2', 'launcher', 'spin'] },
  { id: 'h2', label: 'TORNADO ROUNDHOUSE', kind: 'heavy', requires: 'ground', clip: ROUNDHOUSE, limb: 'right', joint: 'foot',
    hitStart: 0.22, hitEnd: 0.36, dmg: 26, kb: 240, heavy: true, breakGuard: true,
    chain: ['l5', 'launcher', 'sakugaScorpion'] },
  { id: 'h3', label: 'SKYHAMMER FIST', kind: 'heavy', requires: 'ground', clip: HAMMER, limb: 'right',
    hitStart: 0.26, hitEnd: 0.40, dmg: 30, kb: 210, kbY: 120, heavy: true, breakGuard: true,
    chain: ['l1', 'sakugaHammer', 'sakugaWrath'] },
  /* new command heavies */
  { id: 'axeKick', label: 'KAKATO AXE KICK', kind: 'heavy', requires: 'ground', clip: AXEKICK, limb: 'right', joint: 'foot',
    hitStart: 0.24, hitEnd: 0.36, dmg: 24, kb: 175, heavy: true, breakGuard: true,
    moveX: 60, moveXAt: 0.05, chain: ['h3'] },
  { id: 'spinHook', label: 'SPINNING HOOK KICK', kind: 'heavy', requires: 'ground', clip: SPINHOOK, limb: 'right', joint: 'foot',
    hitStart: 0.26, hitEnd: 0.44, dmg: 30, kb: 280, kbY: -60, heavy: true, shake: 0.2, hitstop: 0.065,
    chain: ['h2'] },
  { id: 'stepKick', label: 'MAE-GERI STOP KICK', kind: 'heavy', requires: 'ground', clip: STEPKICK, limb: 'right', joint: 'foot',
    hitStart: 0.17, hitEnd: 0.27, dmg: 18, kb: 260, chain: ['h1'] },
  /* dash attacks */
  { id: 'dashSlash', label: 'SHOULDER TACKLE', kind: 'dash', requires: 'any', clip: TACKLE, limb: 'right', joint: 'shoulder',
    hitStart: 0.10, hitEnd: 0.24, dmg: 16, kb: 220, moveX: 260, moveXAt: 0.03 },
  { id: 'dashHeavy', label: 'TIGER SLIDE KICK', kind: 'dash', requires: 'ground', clip: SLIDEKICK, limb: 'right', joint: 'foot',
    hitStart: 0.14, hitEnd: 0.34, dmg: 20, kb: 190, heavy: true,
    groundDrive: { duration: 0.32, acceleration: 900 } },
  /* power dash attack — the sheathed release of a fully charged dash */
  { id: 'powerArc', label: 'CHARGED RAM', kind: 'dash', requires: 'ground', clip: POWERRAM, limb: 'right', joint: 'shoulder',
    hitStart: 0.09, hitEnd: 0.22, dmg: 24, kb: 460, heavy: true, breakGuard: true,
    stagger: 0.5, hitstop: 0.08, shake: 0.24, multiHit: 0.09, moveX: 240, moveXAt: 0.02,
    chain: ['h1', 'l1'] },
  /* sheathed dual release — the empty-hand twin of RAIJIN ZAN: dash hold +
   * heavy hold through the fist chamber, BOTH keys released together.
   * Alternates punch ↔ kick per armed use (Player.firePowerDashSlash); the
   * corridor is the dash path itself, so the pass tears the pack. */
  { id: 'powerPunch', label: 'RAIJIN KEN', kind: 'dash', requires: 'ground', clip: POWERCROSS, limb: 'right', joint: 'hand',
    hitStart: 0.10, hitEnd: 0.44, dmg: 30, kb: 560, kbY: -40, heavy: true, breakGuard: true,
    stagger: 0.5, hitstop: 0.11, shake: 0.36, multiHit: 0.13, pad: 10,
    corridorBack: 150, corridorFront: 88, corridorY: 55,
    moveX: 240, moveXAt: 0.02, chain: ['h1', 'l1'] },
  { id: 'powerKick', label: 'FUJIN KYAKU', kind: 'dash', requires: 'ground', clip: POWERKICK, limb: 'right', joint: 'foot',
    hitStart: 0.10, hitEnd: 0.44, dmg: 26, kb: 640, kbY: -90, launch: 260, heavy: true, breakGuard: true,
    stagger: 0.55, hitstop: 0.12, shake: 0.38, multiHit: 0.13, pad: 10,
    corridorBack: 150, corridorFront: 88, corridorY: 40,
    moveX: 240, moveXAt: 0.02, chain: ['h2', 'l1'] },
  /* specials */
  { id: 'riposte', label: 'REKKA COUNTER PALM', kind: 'riposte', requires: 'any', clip: COUNTERPALM, limb: 'right',
    hitStart: 0.13, hitEnd: 0.24, dmg: 24, kb: 215, breakGuard: true },
  { id: 'charged', label: 'SHINRA PALM', kind: 'charged', requires: 'ground', clip: SHINRA, limb: 'right',
    hitStart: 0.24, hitEnd: 0.38, dmg: 32, kb: 265, heavy: true, breakGuard: true },
  /* air family */
  { id: 'a1', label: 'FLYING KNEE', kind: 'air', requires: 'air', clip: FLYKNEE, limb: 'right', joint: 'knee',
    hitStart: 0.10, hitEnd: 0.24, dmg: 15, kb: 145, float: 0.8,
    chain: ['a2', 'a3', 'dive'] },
  { id: 'a2', label: 'AIR CROSS', kind: 'air', requires: 'air', clip: AIRCROSS, limb: 'left',
    hitStart: 0.08, hitEnd: 0.16, dmg: 13, kb: 105, float: 0.8,
    chain: ['a3', 'dive', 'slam'] },
  { id: 'a3', label: 'CRESCENT ARC KICK', kind: 'air', requires: 'air', clip: CRESCENT, limb: 'right', joint: 'foot',
    hitStart: 0.16, hitEnd: 0.28, dmg: 17, kb: 165, float: 0.75,
    chain: ['dive', 'slam'] },
  { id: 'dive', label: 'METEOR DROPKICK', kind: 'air', requires: 'air', clip: DROPKICK, limb: 'right', joint: 'foot',
    hitStart: 0.12, hitEnd: 0.40, dmg: 24, kb: 245, heavy: true, float: 0.6,
    moveY: 650, moveYAt: 0.15 },
  { id: 'slam', label: 'SEISMIC HEEL DROP', kind: 'slam', requires: 'air', clip: HEELDROP, limb: 'right', joint: 'foot',
    hitStart: 0.20, hitEnd: 0.45, dmg: 14, kb: 80, heavy: true, multiHit: 0.16,
    moveY: 1050, moveYAt: 0.10, float: 0.4 },
  /* air command moves */
  { id: 'airTwist', label: 'TWIST KICK', kind: 'air', requires: 'air', clip: AIRTWIST, limb: 'right', joint: 'foot',
    hitStart: 0.14, hitEnd: 0.28, dmg: 18, kb: 175, float: 0.7 },
  { id: 'airElbow', label: 'FLYING ELBOW', kind: 'air', requires: 'air', clip: AIRELBOW, limb: 'right', joint: 'elbow',
    hitStart: 0.10, hitEnd: 0.26, dmg: 22, kb: 185, heavy: true, float: 0.5,
    moveY: 320, moveYAt: 0.12 },
  /* THE SAKUGA SET — the uploaded "THE DARK LORD — Sakuga Study"
   * transcribed 1:1 into this rig (clips in combat/sakuga.ts): every key
   * pose at the study's exact 24fps beat grid, IK-authored contacts on the
   * study's hand/heel spots, eases/trunk/hips matched. Hit windows sit on
   * the study's impact-event frames; hitstop/shake from its slow-in map;
   * lunges ride the engine's moveX/moveY impulses. Reached through the
   * chain graph above (l1/l2/l4/h2/h3) and chain back into the movset. */
  { id: 'sakugaJabCross', label: 'SAKUGA JAB–CROSS–SLIP', kind: 'light', requires: 'ground', clip: SAKUGA_JABCROSS_CLIP, limb: 'right',
    hitStart: 0.27, hitEnd: 0.58, dmg: 12, kb: 110, stagger: 0.18,
    multiHit: 0.26, hitstop: 0.05, shake: 0.08, moveX: 60, moveXAt: 0.10,
    chain: ['l2', 'l3', 'h1', 'sakugaBarrage'] },
  { id: 'sakugaBarrage', label: 'SAKUGA SIX-POINT BARRAGE', kind: 'light', requires: 'ground', clip: SAKUGA_BARRAGE_CLIP, limb: 'right',
    hitStart: 0.125, hitEnd: 1.17, dmg: 13, kb: 95, stagger: 0.18,
    multiHit: 0.17, hitstop: 0.045, shake: 0.08, moveX: 90, moveXAt: 0.05,
    chain: ['l1', 'h1', 'sakugaWrath'] },
  { id: 'sakugaDragon', label: 'SAKUGA RISING DRAGON', kind: 'launcher', requires: 'ground', clip: SAKUGA_DRAGON_CLIP, limb: 'right',
    hitStart: 0.34, hitEnd: 0.65, dmg: 17, kb: 100, kbY: -240, launch: 420, heavy: true,
    multiHit: 0.24, moveY: -300, moveYAt: 0.36, float: 0.75,
    chain: ['a1', 'a2', 'a3', 'dive', 'slam'] },
  { id: 'sakugaHammer', label: 'SAKUGA SKY HAMMER', kind: 'heavy', requires: 'ground', clip: SAKUGA_HAMMER_CLIP, limb: 'right',
    hitStart: 0.67, hitEnd: 0.83, dmg: 30, kb: 210, kbY: 120, heavy: true, breakGuard: true,
    hitstop: 0.12, shake: 0.30, moveY: -240, moveYAt: 0.33, float: 0.55,
    moveX: 60, moveXAt: 0.20, chain: ['l1', 'h1'] },
  { id: 'sakugaScorpion', label: 'SAKUGA SCORPION WHIP', kind: 'heavy', requires: 'ground', clip: SAKUGA_SCORPION_CLIP, limb: 'right',
    hitStart: 0.71, hitEnd: 0.87, dmg: 26, kb: 280, kbY: -60, heavy: true, breakGuard: true,
    hitstop: 0.08, shake: 0.22, moveX: 140, moveXAt: 0.50,
    chain: ['h2', 'l1'] },
  { id: 'sakugaWrath', label: 'SAKUGA WRATH FINISHER', kind: 'heavy', requires: 'ground', clip: SAKUGA_WRATH_CLIP, limb: 'left',
    hitStart: 0.79, hitEnd: 1.00, dmg: 30, kb: 460, kbY: -40, heavy: true, breakGuard: true,
    stagger: 0.5, hitstop: 0.12, shake: 0.34, multiHit: 0.16,
    moveX: 240, moveXAt: 0.77, chain: ['h1', 'l1'] },
]

export const MOVES: Record<string, AttackDef> = {}
for (const s of MOVES_SRC) MOVES[s.id] = move(s)
/* THE SHADOW RONIN SET — empty-hand variants of the transcribed dual-blade
 * sequences (combat/ronin.ts): same body choreography, fist/heel hitboxes.
 * Registered here so unarmedAttack() maps every sr id in the sheathed
 * stance — the dual-stance contract. */
Object.assign(MOVES, RONIN_UNARMED)

/** Unarmed ULT — registered in ATTACKS as `ultPalm`; routed by
 * startUnarmedFinisher (grounded ultimate). Five confirmed contacts × 13
 * damage = the 65-damage finisher, delivered as a flowing string. */
export const UNARMED_ULT: AttackDef = move({
  id: 'ultPalm', label: 'THOUSAND PALM BARRAGE', kind: 'finisher', requires: 'ground',
  clip: ULTPALMS, limb: 'right',
  hitStart: 0.13, hitEnd: 0.66, dmg: 13, kb: 60, multiHit: 0.12,
  heavy: true, breakGuard: true, shake: 0.14, hitstop: 0.03,
  moveX: 90, moveXAt: 0.05,
})

export const UNARMED_FLOURISH_CLIP = FLOURISH

/** Legacy shared guard pose export (was the old 7-style generator's
 * stance; now the fists-up fight guard — same Float32Array contract). */
export const UNARMED_GUARD = makePose(G)
