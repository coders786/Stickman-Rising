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
import { bakeClip, BAKE_FPS } from '../anim/bake'
import { CH, makePose, type ChannelKey, type PoseInput } from '../anim/pose'
import { applyJointLimits } from '../anim/limits'
import { PLAYER_SPEC } from '../anim/skeleton'
import { clamp } from '../core/utils'
import type { SfxName } from '../audio/audio'
import type { AttackDef, AttackKind } from './attacks'
import { EMPTY_HAND_PAD_MAX } from './contracts'
import {
  SAKUGA_JABCROSS_CLIP, SAKUGA_BARRAGE_CLIP, SAKUGA_DRAGON_CLIP,
  SAKUGA_HAMMER_CLIP, SAKUGA_SCORPION_CLIP, SAKUGA_WRATH_CLIP,
} from './sakuga'
import { RONIN_UNARMED } from './ronin'
import { chain, chamber, contact, fistAt, footAt, kickChamber, kickExtend, recover, stance } from './fullbody'

export type StrikeHand = 'left' | 'right'
export type StrikeJoint = 'hand' | 'elbow' | 'foot' | 'knee' | 'shoulder'

/* ------------------------------------------------------------------ */
/* LIMB IK — channel-space two-bone solvers                            */
/* ------------------------------------------------------------------ */

/** Solve SHOULDER/ELBOW channels so the hand reaches (x,y) relative to
 * the shoulder joint. Elbow hangs below/behind the shoulder→hand line
 * (human pole). Moved here as the moveset's own arm author (unarmed.ts
 * re-exports it for player.ts compatibility).
 *
 * REACH RESCALE: authored targets were composed for the old 38-unit arm.
 * They are rescaled by (reach/38) so punches keep their extension ratio
 * on the recomposed 42-unit arm (jab 33 → 36.5 forward) instead of
 * arriving with a needlessly bent elbow. Guard targets (r ≤ 12) are
 * pinned by the floor clamp and do not move. */
export function handPose(side: StrikeHand, x: number, y: number): PoseInput {
  const a = PLAYER_SPEC.upperArm, b = PLAYER_SPEC.foreArm
  const k = (a + b) / 38
  x *= k; y *= k
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
/** Bake-then-resample clip — the reference studio's pipeline.
 *
 * Authored keys carry per-key eases (`in` accelerating INTO a contact, `out`
 * releasing out of a chamber). Burning those onto a 24 fps grid and then
 * resampling with the shape-preserving spline is what makes a strike snap:
 * the contact frame remains the fastest frame, and holds stay dead still.
 * Skipping the bake (sampling the sparse keys directly) makes the engine
 * ignore every ease and smear the whole move into one uniform blur. */
const clip = (name: string, frames: ReturnType<typeof kf>[], contact: number | null = null): Clip =>
  bakeClip(makeClip(name, frames), BAKE_FPS, contact)
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

/** 01 · L1 — KIZAMI JAB.
 *
 * A jab is the smallest strike in the set, so it gets the least body —
 * but not NO body, which is what it had (legs moved 0.00 rad). The chain
 * is short and shallow: a step off the lead foot, a hip flick, the lead
 * shoulder riding the fist out, and the rear hand pulling back into the
 * jaw as counter-weight.
 *
 * Beats: settle held → step+chamber → SNAP → brace → release. */
const JAB = clip('unarmedJab', [
  kf(0, stance('right')),
  // the step: lead foot picks up and lands a hand's width forward. Small,
  // but it is where the strike's forward travel comes from.
  kf(0.055, chain('linear', 'right', {
    drive: 0.35, travel: 1.4, sink: 0.6, lean: 0.16,
    leadFoot: [13, 40], rearFoot: [-18, 42],
    fist: [14, 4], offFist: [7, 5],
  }), 'outQuad'),
  // CHAMBER: held. The lead fist stops just short, weight on the rear leg.
  kf(0.075, chamber('linear', 'right', { coil: 0.55, sink: 0.5 }),
    'inOutCubic'),  // 40 ms to contact: the fast span the whole move is for
  // ignition in-between: splits the chamber->contact span so no sub-span
  // exceeds the 60fps continuity budget. The elbow is the fastest channel
  // here, so the split is authored rather than left to the sampler.
  mid(0.105, chamber('linear', 'right', { coil: 0.55, sink: 0.5 }),
    contact('linear', 'right', {
      drive: 0.85, travel: 3.6, sink: 0.2, lean: 0.20, depth: 0.55,
      leadFoot: [21, 39], rearFoot: [-23, 41],
      fist: [40, -1], offFist: [-2, 8],
    })),
  // SNAP — contact. Fist at full reach, rear fist pulled hard back.
  kf(0.145, contact('linear', 'right', {
    drive: 0.85, travel: 3.6, sink: 0.2, lean: 0.20, depth: 0.60,
    leadFoot: [21, 39], rearFoot: [-23, 41],
    fist: [40, -1], offFist: [-2, 8],
  }), 'inOutCubic'),
  mid(0.172, contact('linear', 'right', {
    drive: 0.85, travel: 3.6, sink: 0.2, lean: 0.20, depth: 0.60,
    leadFoot: [21, 39], rearFoot: [-23, 41],
    fist: [40, -1], offFist: [-2, 8],
  }), contact('linear', 'right', {
    drive: 0.55, travel: 2.8, sink: 0.5, lean: 0.17,
    leadFoot: [19, 40], rearFoot: [-20, 42],
    fist: [32, 1], offFist: [2, 7],
  })),
  // the brace: the body stops, the arm relaxes, the rear leg takes weight
  kf(0.20, contact('linear', 'right', {
    drive: 0.55, travel: 2.8, sink: 0.5, lean: 0.17,
    leadFoot: [19, 40], rearFoot: [-20, 42],
    fist: [32, 1], offFist: [2, 7],
  }), 'inOutCubic'),
  mid(0.24, recover('right', { settle: 0.7 }), stance('right')),
  kf(0.26, stance('right')),
])
/** 02 · L2 — GYAKU CROSS.
 *
 * The rear-hand power straight, and the first real rotation of the string.
 * The chain here is long and violent: the rear foot pivots hard, the
 * pelvis turns a full quarter, the chest whips through, and the rear hip
 * comes off the floor as the fist arrives. The lead hand does not guard —
 * it PULLS BACK, the counter-weight that lets the cross land.
 *
 * The weight transfer is the point: rootX travels further than the jab's,
 * and the legs re-plant twice (rear foot turns in, lead foot braces). */
const CROSS = clip('unarmedCross', [
  kf(0, stance('right')),
  // uncoil: weight rolls onto the rear leg, hips wind AWAY from the target
  kf(0.06, chamber('rotation', 'left', { coil: 0.9, sink: 1.4 }), 'outQuad'),
  // ignition — hips start to turn before the fist moves (proximal first)
  mid(0.10, chamber('rotation', 'left', { coil: 0.9, sink: 1.4 }),
    contact('rotation', 'left', {
      drive: 1.15, travel: 6.5, sink: 0.4, lean: 0.24, depth: 0.75,
      leadFoot: [22, 38], rearFoot: [-26, 39],
      fist: [40, -2], offFist: [3, 5],
    })),
  // CONTACT: rear hip through, fist at full reach, head down the line
  kf(0.145, contact('rotation', 'left', {
    drive: 1.15, travel: 6.5, sink: 0.4, lean: 0.24, depth: 0.80,
    leadFoot: [22, 38], rearFoot: [-26, 39],
    fist: [40, -2], offFist: [3, 5],
  }), 'inOutCubic'),
  // the rear hip lands; the fist stays out one beat longer than the body,
  // then the arm relaxes while the torso is still turned through
  kf(0.205, contact('rotation', 'left', {
    drive: 0.95, travel: 5.4, sink: 0.6, lean: 0.22,
    leadFoot: [21, 38], rearFoot: [-24, 40],
    fist: [39, 0], offFist: [5, 6],
  }), 'inOutCubic'),
  mid(0.245, contact('rotation', 'left', {
    drive: 0.95, travel: 5.4, sink: 0.6, lean: 0.22,
    leadFoot: [21, 38], rearFoot: [-24, 40],
    fist: [39, 0], offFist: [5, 6],
  }), recover('left', { settle: 1 })),
  kf(0.285, recover('left', { settle: 1 }), 'inOutCubic'),
  kf(0.32, stance('right')),
])
/** 03 · L3 — KAGI HOOK.
 *
 * The arc. Unlike the two straights before it, the hook's power comes from
 * ROTATION rather than travel: the hips commit a full quarter-turn, the
 * lead elbow rides high, and the fist swings through depth (armRz/foreRz)
 * so the arc reads as coming around the target rather than into it.
 *
 * The counter-weight here is the rear hand coming ACROSS the chest, which
 * is what stops the whole body simply spinning.
 *
 * Beats: stance -> wind (hips away) -> ignition -> CONTACT -> follow-through
 * -> settle. The follow-through overshoots the target line: the torso keeps
 * turning past contact and only then unwinds. */
const HOOK = clip('unarmedHook', [
  kf(0, stance('right')),
  // WIND: hips rotate away, lead elbow lifts, fist draws back and out
  kf(0.075, chain('rotation', 'right', {
    drive: -0.55, travel: -2.0, sink: 1.6, lean: 0.10, depth: -0.55,
    leadFoot: [12, 40], rearFoot: [-19, 41],
    fist: [7, 5], offFist: [8, 5],
  }), 'outQuad'),
  // ignition: hips lead, the arm has barely moved yet
  mid(0.115, chain('rotation', 'right', {
    drive: -0.55, travel: -2.0, sink: 1.6, lean: 0.10, depth: -0.55,
    leadFoot: [12, 40], rearFoot: [-19, 41],
    fist: [7, 5], offFist: [8, 5],
  }), contact('rotation', 'right', {
    drive: 1.0, travel: 4.5, sink: 0.5, lean: 0.18, depth: 0.5,
    leadFoot: [20, 38], rearFoot: [-25, 39],
    fist: [38, 2], offFist: [1, 6],
  })),
  // CONTACT — elbow high, fist arriving from outside the target line
  kf(0.16, contact('rotation', 'right', {
    drive: 1.0, travel: 4.5, sink: 0.5, lean: 0.18, depth: 0.5,
    leadFoot: [20, 38], rearFoot: [-25, 39],
    fist: [38, 2], offFist: [1, 6],
  }), 'inOutCubic'),
  // FOLLOW-THROUGH: the torso keeps turning PAST the target, arm folding
  kf(0.225, contact('rotation', 'right', {
    drive: 1.35, travel: 3.4, sink: 0.9, lean: 0.14, depth: 0.7,
    leadFoot: [18, 39], rearFoot: [-24, 40],
    fist: [26, -1], offFist: [2, 5],
  }), 'inOutCubic'),
  mid(0.275, contact('rotation', 'right', {
    drive: 1.35, travel: 3.4, sink: 0.9, lean: 0.14, depth: 0.7,
    leadFoot: [18, 39], rearFoot: [-24, 40],
    fist: [26, -1], offFist: [2, 5],
  }), recover('right', { settle: 1 })),
  kf(0.31, recover('right', { settle: 1 }), 'inOutCubic'),
  kf(0.34, stance('right')),
])

/** 04 · L4 — SLIP BODY ELBOW.
 *
 * The first move in the string where the WHOLE BODY changes height. This
 * is a slip: the head and chest drop and slide to the outside line, the
 * knees bend deep, and the elbow arrives while the body is still falling.
 * The elbow is the hitbox, so the strike is deliberately short — the drama
 * is in the level change, not the reach.
 *
 * Beats: stance -> dip + slip (the body leaves the centre line) -> the
 * elbow drives through on the way UP (a slip is a downward move, an elbow
 * is an upward one — the reversal is what makes it snap). */
const BODYBLOW = clip('unarmedBodyElbow', [
  kf(0, stance('right')),
  // settle onto the legs before the slip — a weave has an entry
  kf(0.045, {
    rootX: -0.4, rootY: 7.0, rootRot: 0.185,
    spine: 0.13, head: -0.04,
    rootZ: -1.6, hipLz: -0.2, hipRz: 0.2,
    pelvisYaw: 0.15, chestYaw: -0.22,
    ...footAt('right', 13, 39), ...footAt('left', -17, 40),
    ...fistAt('right', 11, 5), ...fistAt('left', 10, 5),
    elL: -1.95,
    armLz: -0.08, armRz: -0.14, foreRz: 0.22, foreLz: -0.05,
  }, 'outQuad'),
  // SLIP: the whole silhouette drops and shifts off the centre line
  kf(0.105, {
    rootX: -1.5, rootY: 9, rootRot: 0.28,
    spine: 0.26, head: 0.10,
    rootZ: -3.2, hipLz: -0.4, hipRz: 0.4,
    pelvisYaw: 0.30, chestYaw: -0.42,
    ...footAt('right', 12, 36), ...footAt('left', -20, 38),
    ...fistAt('right', 4, 9), ...fistAt('left', 9, 6),
    elL: -1.55,
    armLz: -0.28, armRz: -0.42, foreRz: 0.30, foreLz: -0.05,
  }, 'outQuad'),
  mid(0.15, {
    rootX: -1.5, rootY: 9, rootRot: 0.28,
    spine: 0.26, head: 0.10,
    rootZ: -3.2, hipLz: -0.4, hipRz: 0.4,
    pelvisYaw: 0.30, chestYaw: -0.42,
    ...footAt('right', 12, 36), ...footAt('left', -20, 38),
    ...fistAt('right', 4, 9), ...fistAt('left', 9, 6),
    armLz: -0.28, armRz: -0.42, foreRz: 0.30, foreLz: -0.05,
  }, {
    rootX: 2.6, rootY: 4.9, rootRot: 0.185,
    spine: 0.10, head: 0.30,
    pelvisYaw: -0.42, chestYaw: 0.52,
    ...footAt('right', 18, 40), ...footAt('left', -21, 42),
    shR: 1.22, elR: -2.18, wrR: 0,
    ...fistAt('left', 8, 6),
    elL: -1.30,
    armRz: 0.42, foreRz: -0.34, armLz: -0.16, foreLz: -0.05,
  }),
  // CONTACT: the elbow is still DRIVING up and through. Measured against
  // the elbow kinematics, a folded elbow (elR -2.45) sits behind the
  // shoulder line, so the strike arrives with the arm opening rather than
  // parked: shR 1.16 -> 1.34 and elR -2.05 -> -1.55 across the beat.
  kf(0.215, {
    rootX: 5.0, rootY: 3.2, rootRot: 0.175,
    spine: 0.04, head: 0.38,
    pelvisYaw: -0.68, chestYaw: 0.76,
    ...footAt('right', 20, 39), ...footAt('left', -22, 41),
    shR: 1.55, elR: -1.42, wrR: 0,
    ...fistAt('left', 5, 7),
    armRz: 0.68, foreRz: -0.50, armLz: -0.12, foreLz: -0.05,
  }, 'inOutCubic'),
  kf(0.255, {
    ...recover('right', { settle: 1 }),
    rootY: 6.4, pelvisYaw: -0.25, chestYaw: 0.30,
    ...fistAt('right', 16, 4), ...fistAt('left', 8, 5),
    armRz: 0.22, foreRz: -0.10,
  }, 'inOutCubic'),
  mid(0.31, {
    ...recover('right', { settle: 1 }),
    rootY: 6.4, pelvisYaw: -0.25, chestYaw: 0.30,
    ...fistAt('right', 16, 4), ...fistAt('left', 8, 5),
  }, stance('right')),
  // a slip leaves you lower than you started for a beat, then you stand
  kf(0.36, stance('right')),
])

/** 05 · L5 — TWIN SHOTEI.
 *
 * The string's punctuation: BOTH palms drive out together. This is the
 * one move where the body is symmetric, and that is the drama — the whole
 * torso squares up and both legs push as one. It also reads as a distinct
 * silhouette at the end of a chain of single-limb strikes.
 *
 * Beats: stance -> both hands chamber at the ribs while the body sinks
 * and squares -> BOTH palms fire, the body rises and travels -> settle
 * back into the bladed stance. */
const TWINPALM = clip('unarmedTwinPalm', [
  kf(0, stance('right')),
  // CHAMBER: square the hips, sink onto both legs, palms at the ribs
  kf(0.085, {
    rootX: -2, rootY: 8.2, rootRot: 0.20,
    spine: 0.20, head: -0.24,
    pelvisYaw: 0.02, chestYaw: 0.02,
    ...footAt('right', 12, 38), ...footAt('left', -14, 39),
    ...fistAt('right', 5, 7), ...fistAt('left', 5, 7),
    armRz: -0.55, armLz: 0.55, foreRz: 0.35, foreLz: -0.35,
  }, 'outQuad'),
  mid(0.14, {
    rootX: -2, rootY: 8.2, rootRot: 0.20,
    spine: 0.20, head: -0.24,
    pelvisYaw: 0.02, chestYaw: 0.02,
    ...footAt('right', 12, 38), ...footAt('left', -14, 39),
    ...fistAt('right', 5, 7), ...fistAt('left', 5, 7),
    armRz: -0.55, armLz: 0.55, foreRz: 0.35, foreLz: -0.35,
  }, {
    rootX: 6, rootY: 3.2, rootRot: 0.24,
    spine: 0.02, head: 0.30,
    pelvisYaw: 0.0, chestYaw: 0.0,
    ...footAt('right', 22, 40), ...footAt('left', -24, 41),
    ...fistAt('right', 36, -4), ...fistAt('left', 34, -2),
    armRz: 0.30, armLz: -0.30, foreRz: 0.22, foreLz: -0.22,
  }),
  // DOUBLE CONTACT: both palms at full extension, body risen and driven
  kf(0.19, {
    rootX: 6, rootY: 3.2, rootRot: 0.24,
    spine: 0.02, head: 0.30,
    pelvisYaw: 0.0, chestYaw: 0.0,
    ...footAt('right', 22, 40), ...footAt('left', -24, 41),
    ...fistAt('right', 36, -4), ...fistAt('left', 34, -2),
    armRz: 0.30, armLz: -0.30, foreRz: 0.22, foreLz: -0.22,
  }, 'inOutCubic'),
  // the push continues past the palms; the body then re-blades
  kf(0.27, contact('linear', 'right', {
    drive: 0.5, travel: 7.2, sink: 0.2, lean: 0.18, depth: 1.05,
    leadFoot: [23, 41], rearFoot: [-24, 42],
    fist: [26, 0], offFist: [22, 2],
  }), 'inOutCubic'),
  mid(0.34, contact('linear', 'right', {
    drive: 0.5, travel: 7.2, sink: 0.2, lean: 0.18,
    leadFoot: [23, 41], rearFoot: [-24, 42],
    fist: [26, 0], offFist: [22, 2],
  }), recover('right', { settle: 1 })),
  kf(0.39, recover('right', { settle: 1 }), 'inOutCubic'),
  kf(0.44, stance('right')),
])


const BACKFIST = clip('unarmedBackfist', [
  kf(0, stance('left')),
  // LOAD — the retreat begins by going DOWN. Both knees fold under the
  // hips and the weight sits on the balls of the feet: you cannot jump
  // from a standing pose, and a hop whose crouch is missing reads as a
  // slide no matter what the root does.
  kf(0.045, chain('lift', 'left', {
    drive: 0.15, travel: -1.6, sink: 3.2, lean: 0.10,
    leadFoot: [10, 46], rearFoot: [-14, 47],
    fist: [11, 6], offFist: [9, 5],
  }), 'outQuad'),
  // LAUNCH — legs snap straight, body leaves the ground. Sink goes
  // negative (the body rises) and both feet trail: this is the airborne
  // frame the arc is read from.
  kf(0.065, chain('lift', 'left', {
    drive: -0.10, travel: -2.6, sink: -2.2, lean: -0.06, depth: -0.70,
    leadFoot: [7, 38], rearFoot: [-11, 39],
    fist: [12, 5], offFist: [8, 5],
  }), 'outCubic'),
  // TUCK — the peak. Knees come up under the body and the backfist
  // chambers: the off-hand is already carrying the rotation.
  mid(0.145, chain('lift', 'left', {
      drive: -0.10, travel: -2.6, sink: -2.2, lean: -0.06,
      leadFoot: [7, 38], rearFoot: [-11, 39],
      fist: [12, 5], offFist: [8, 5],
    }),
    contact('rotation', 'left', {
      drive: 0.55, travel: -1.4, sink: -1.4, lean: 0.16,
      leadFoot: [14, 34], rearFoot: [-8, 36],
      fist: [38, -5], offFist: [2, 7],
    })),
  // CONTACT — the backfist lands as the feet come down. The strike is
  // thrown OFF the landing, which is what makes the hop and the hit one
  // action instead of two.
  kf(0.195, contact('rotation', 'left', {
    drive: 1.05, travel: 0.6, sink: 0.4, lean: 0.20, depth: 0.55,
    leadFoot: [18, 41], rearFoot: [-20, 42],
    fist: [40, -6], offFist: [-3, 8],
  }), 'inOutCubic'),
  // FOLLOW-THROUGH — the turn keeps going past the target while the
  // body settles onto the rear foot.
  kf(0.265, contact('rotation', 'left', {
    drive: 1.25, travel: 0.0, sink: 1.6, lean: 0.14,
    leadFoot: [16, 43], rearFoot: [-22, 43],
    fist: [30, -2], offFist: [0, 7],
  }), 'inOutCubic'),
  // ABSORB — the knees take the landing. This is the frame that sells
  // the weight: a hop that lands straight-legged looks weightless.
  mid(0.315, contact('rotation', 'left', {
      drive: 1.25, travel: 0.0, sink: 1.6, lean: 0.14,
      leadFoot: [16, 43], rearFoot: [-22, 43],
      fist: [30, -2], offFist: [0, 7],
    }),
    recover('left', { settle: 1 })),
  kf(0.35, recover('left', { settle: 0.6 }), 'inOutCubic'),
  kf(0.38, stance('left')),
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
    elL: -2.25, shL: 0.55,
    head: -0.16 }, 'outQuad'),
  mid(0.15, { ...G, rootY: 9, rootRot: 0.16, chestYaw: 0.3, ...handPose('right', 6, 16),
      head: -0.16 },
    { ...G, rootY: -1, rootRot: -0.08, chestYaw: -0.35, pelvisYaw: 0.2,
      ...handPose('right', 20, -30), armRz: 0.25,
      // off arm DRIVES DOWN as the uppercut rises
      shL: -0.45, elL: -1.15,
      hipR: 0.2, kneeR: -0.4, hipL: -0.5, kneeL: -0.7, head: -0.08 }),
  kf(0.20, { ...G, rootY: -1, rootRot: -0.08, chestYaw: -0.35, pelvisYaw: 0.2,
    ...handPose('right', 20, -30), armRz: 0.25,
    shL: -0.55, elL: -1.05,
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
  kf(0.06, { ...G, rootY: 5, rootRot: 0.16, ...legPose('right', 8, 22), kneeR: -1.6,
    shL: 0.75, elL: -1.75, shR: 1.05, elR: -2.10 }, 'outQuad'),
  kf(0.12, { ...G, rootY: 4, rootRot: 0.2, ...legPose('right', 27, 6), kneeR: -1.5, pelvisYaw: 0.15,
    // arms PUMP opposite the knee: right knee up -> right arm back
    ...handPose('left', 8, 6), ...handPose('right', 10, 8),
    shR: 0.35, elR: -1.15, shL: 1.25, elL: -2.25,
    ...legPose('left', -8, 34), kneeL: -1.05 }, 'inOutCubic'),
  kf(0.20, { ...G, rootY: 5.5, rootRot: 0.16, ...legPose('right', 6, 24), kneeR: -1.7, pelvisYaw: -0.05,
    shR: 1.15, elR: -2.15, shL: 0.60, elL: -1.60,
    ...legPose('left', -4, 30), kneeL: -0.90 }, 'outQuad'),
  kf(0.27, { ...G, rootY: 4, rootRot: 0.2, ...legPose('right', 28, 4), kneeR: -1.4, pelvisYaw: 0.18,
    shR: 0.30, elR: -1.10, shL: 1.20, elL: -2.20,
    ...legPose('left', -9, 35), kneeL: -1.10 }, 'inOutCubic'),
  kf(0.35, { ...G, rootY: 5.5, rootRot: 0.16, ...legPose('right', 7, 24), kneeR: -1.7, pelvisYaw: -0.05,
    shR: 1.10, elR: -2.10, shL: 0.65, elL: -1.65,
    ...legPose('left', -4, 30), kneeL: -0.85 }, 'outQuad'),
  kf(0.42, { ...G, rootY: 4, rootRot: 0.22, ...legPose('right', 29, 3), kneeR: -1.35, pelvisYaw: 0.2,
    shR: 0.28, elR: -1.05, shL: 1.22, elL: -2.22,
    ...legPose('left', -9, 35), kneeL: -1.12 }, 'inOutCubic'),
  mid(0.485, { ...G, rootY: 4, rootRot: 0.22, ...legPose('right', 29, 3), kneeR: -1.35, pelvisYaw: 0.2 }, G),
  kf(0.55, G),
])

/* ================================================================== */
/* GROUND HEAVIES (K, neutral chain)                                   */
/* ================================================================== */

/** 10 · H1 — RIPPLING ELBOW (empi-uchi).
 *
 * A heavy elbow is not a big punch. It is a whole-body TURN with the point
 * of the elbow at the outside edge. The chain is a full 180° of shoulder
 * girdle travel: wind the hips the opposite way, then let the pelvis and
 * chest unwind THROUGH the target while the elbow stays folded and leads.
 *
 * The off hand comes back and up to the opposite shoulder — the classic
 * empi counter-weight, and the pose that makes the silhouette read as
 * "everything is turning".
 *
 * Beats: stance -> wind hard away -> ignition -> CONTACT (elbow point
 * arriving) -> the body keeps turning -> unwind. */
const ELBOW = clip('unarmedElbow', [
  kf(0, stance('right')),
  // WIND: the girdle rotates away from the target. Authored as a SMALL
  // departure from the stance — a big negative-drive jolt on frame 1 put
  // the limb's speed peak at t=0.018, before the strike had even begun.
  kf(0.095, chain('rotation', 'right', {
    drive: -0.18, travel: 0.5, sink: 0.6, lean: 0.13, depth: -0.55,
    leadFoot: [13, 40], rearFoot: [-19, 41],
    fist: [10, 6], offFist: [9, 5],
  }), 'outQuad'),
  mid(0.145, chain('rotation', 'right', {
    drive: -0.18, travel: 0.5, sink: 0.6, lean: 0.13, depth: -0.55,
    leadFoot: [13, 40], rearFoot: [-19, 41],
    fist: [10, 6], offFist: [9, 5],
  }), {
    // the elbow point: shoulder driven across, elbow folded hard, torso
    // a full quarter past square
    rootX: 5.4, rootY: 4.9, rootRot: 0.225,
    spine: 0.06, head: 0.26,
    pelvisYaw: 0.70, chestYaw: -0.92,
    ...footAt('right', 20, 39), ...footAt('left', -25, 40),
    shR: 1.72, elR: -2.10, wrR: 0,
    ...fistAt('left', 7, 5),
    // Z: the chest is quarter-turned AWAY, so the striking girdle loads
    // behind the plane. Without this the whole move was a flat slab
    // (measured span 37.0 vs 101.6 on `charged`) and the spin read as a
    // 2D flip. Negative here is what the contact key spends.
    rootZ: -9.5,
    armRz: -0.62, armLz: 0.44, foreRz: -0.55, foreLz: 0.38,
  }),
  // CONTACT — elbow point at the outside edge of the turn. The arm is
  // STILL DRIVING here: shR 1.16 -> 1.36 and elR -2.30 -> -2.58 across the
  // contact beat, so the point keeps travelling through the hit instead
  // of arriving and stopping (which put the speed peak in the recovery).
  kf(0.165, {
    rootX: 10.6, rootY: 4.2, rootRot: 0.27,
    spine: 0.11, head: 0.16,
    pelvisYaw: 1.02, chestYaw: -1.32,
    ...footAt('right', 23, 38), ...footAt('left', -28, 39),
    // EMI A point. The forearm stays FOLDED (elR -2.05) — at elR -1.15 the
    // arm projects nearly straight and the silhouette reads as a punch, not
    // an elbow strike. The leading edge is the point of the elbow, driven
    // across by the shoulder, so reach is deliberately short: the turn is
    // the move. (Measured elbow lead +10px: inside the 15px body sphere.)
    // measured sweep: shR 2.1 / elR -1.9 = +14px elbow lead with a 109deg
    // fold. Deeper folds (+126deg) collapse the lead to +1px; shallower
    // (92deg) straightens the arm and reads as a punch.
    // Fold re-solved at -1.40 once depth was added: see the note below.
    shR: 2.10, elR: -1.40, wrR: 0,
    ...fistAt('left', 3, 6),
    // Z: the turn arrives IN FRONT of the plane. rootZ travels -9.5 -> +11
    // through the contact so the elbow point comes at the viewer, and the
    // arm yaw goes positive with it: the striking arm's wrist ends up the
    // nearest thing on the figure, which is the near-end-larger read the
    // whole depth pass is built on.
    // rootX carries the extra reach the depth costs: yawing the arm toward
    // the camera shortens its X projection, and the first pass dropped the
    // elbow lead to 8.9px (the test floor is 15). The body travels further
    // so the point still leads the hips by a readable margin.
    rootZ: 11.0,
    // Fold/yaw pair solved together, not guessed: folding the arm hard to
    // swing it toward the camera costs X reach and dropped this test to
    // 8.9px. Sweeping fold x yaw x fore-yaw for lead AND depth left one
    // point that satisfies both -- elR -1.40 / armRz 0.55 / foreRz 0.60
    // gives 16.4px lead with the elbow at z 35 and wrist at z 32.
    armRz: 0.55, armLz: -0.30, foreRz: 0.60, foreLz: -0.26,
  }, 'inOutCubic'),
  // follow-through: still turning, the elbow folding back to the guard
  kf(0.285, {
    ...recover('right', { settle: 1 }),
    rootX: 4, rootY: 6, pelvisYaw: 0.45, chestYaw: -0.60,
    shR: 1.20, elR: -1.55, wrR: 0.18,
    ...fistAt('left', 7, 5),
    // and the depth unwinds back toward the plane as the body settles
    rootZ: 3.5,
    armRz: 0.16, foreRz: 0.10,
  }, 'inOutCubic'),
  mid(0.355, {
    ...recover('right', { settle: 1 }),
    rootX: 4, rootY: 6, pelvisYaw: 0.45, chestYaw: -0.60,
    shR: 1.18, elR: -1.45, wrR: 0.10,
    ...fistAt('left', 7, 5),
  }, stance('right')),
  kf(0.42, stance('right')),
])

/** 11 · H2 — TORNADO ROUNDHOUSE (mawashi-geri).
 *
 * The biggest lower-body action in the set, and the one place the whole
 * figure leaves the floor. Authored beats: pivot the support foot, swing
 * the free leg through a horizontal arc with the hips opening, contact at
 * the far edge of the arc, then the LEG keeps travelling past the target
 * while the body unwinds and drops back into the stance.
 *
 * Note the arms: the off arm drives BACK as the leg comes through. That
 * is not decoration — it is what a body does to stay over its own support
 * foot, and it is what stops the kick looking like a hinge. */
const ROUNDHOUSE = clip('unarmedRoundhouse', [
  kf(0, stance('right')),
  // PIVOT: the support foot turns out and the weight shifts onto it. Small
  // — the knee has not come up yet.
  kf(0.055, {
    rootX: 0.5, rootY: 6.2, rootRot: 0.115,
    spine: 0.09, head: -0.06,
    pelvisYaw: -0.22, chestYaw: 0.28,
    // Z: the coil loads behind the plane and DEEPENS through the wind
    rootZ: -6.5, hipLz: -0.7, hipRz: 0.7,
    ...footAt('right', 12, 41), ...footAt('left', -16, 41),
    ...kickChamber('right', 9, 40),
    ...fistAt('right', 11, 4), ...fistAt('left', 6, 5),
    // counter-hand elbow: folded while the body coils
    elL: -2.05,
    armRz: -0.10, foreRz: 0.12, armLz: 0.14, foreLz: -0.10,
  }, 'outQuad'),
  // CHAMBER: the free knee now comes up across the body
  kf(0.115, {
    rootX: -1.0, rootY: 7.2, rootRot: 0.10,
    spine: 0.14, head: 0.02,
    pelvisYaw: -0.55, chestYaw: 0.70,
    rootZ: -10.5, hipLz: -1.1, hipRz: 1.1,
    ...footAt('right', 8, 40), ...footAt('left', -17, 41),
    ...kickChamber('right', -2, 3),
    ...fistAt('right', 10, 5), ...fistAt('left', 2, 6),
    elL: -1.80,
    armRz: -0.30, foreRz: 0.20, armLz: 0.35, foreLz: -0.20,
  }, 'outQuad'),
  mid(0.165, {
    rootX: -1.0, rootY: 7.2, rootRot: 0.10,
    spine: 0.14, head: 0.02,
    pelvisYaw: -0.55, chestYaw: 0.70,
    rootZ: -3.4, hipLz: -0.7, hipRz: 0.7,
    ...footAt('right', 8, 40), ...footAt('left', -17, 41),
    ...kickChamber('right', -2, 3),
    ...fistAt('right', 10, 5), ...fistAt('left', 2, 6),
    armRz: -0.30, foreRz: 0.20, armLz: 0.35, foreLz: -0.20,
  }, {
    // the leg swings THROUGH: hips wide open, support foot turned out
    rootX: 4.5, rootY: 5.0, rootRot: 0.22,
    spine: 0.02, head: 0.26,
    pelvisYaw: 1.05, chestYaw: -0.85,
    rootZ: 6.0, hipLz: 1.2, hipRz: -1.2,
    ...footAt('right', 6, 41),
    ...kickExtend('right', 41, -27),
    ...fistAt('right', 3, 8), ...fistAt('left', 1, 8),
    // opens as the kick swings through — this is the counter-rotation
    elL: -1.35,
    armRz: 0.42, foreRz: 0.30, armLz: -0.60, foreLz: 0.35,
  }),
  // CONTACT — the leg is still swinging THROUGH the arc here, further
  // along it than the ignition key. Holding the same pose as the ignition
  // stopped the foot dead at the hit, which pushed the speed peak into
  // the chamber and disconnected the impact.
  kf(0.215, {
    rootX: 5.0, rootY: 4.6, rootRot: 0.235,
    spine: 0.0, head: 0.30,
    pelvisYaw: 1.20, chestYaw: -0.98,
    // Z: the kick arrives IN FRONT of the plane. A tornado roundhouse is a
    // move whose whole point is rotation -- without Z travel the sweep was
    // a flat arc and the depth span sat at 44.9, the second weakest in the
    // set. rootZ coil -10.5 -> +14 is a 24.5-unit commitment, and the
    // kicking hip leads it (+1.7) so the foot is the nearest mass.
    rootZ: 14.0, hipLz: 1.7,
    ...footAt('right', 5, 41),
    // The shin was still folded to 77deg at contact, so the strike read as
    // a KNEE LIFT rather than a roundhouse no matter how much depth it had.
    // Measured sweep of kickExtend: fold angle vs reach is
    //   40/-26 69deg 55.4u | 44/-27 50deg 60.7u | 46/-26 38deg 63.4u
    //   47/-28 30deg 64.7u (up clamps past -36)
    // 46/-26 keeps the strike low enough to be a body kick and straightens
    // the leg to 38deg, so the foot leads the hip by 63px instead of 53.
    ...kickExtend('right', 46, -26),
    hipRz: -1.0 + 0.30,
    ...fistAt('right', 0, 9), ...fistAt('left', -1, 9),
    armRz: 0.50, foreRz: 0.34, armLz: -0.68, foreLz: 0.40,
  }, 'inOutCubic'),
  // FOLLOW-THROUGH: the kick keeps going; the support leg unwinds under it
  kf(0.335, {
    rootX: 3.5, rootY: 6.2, rootRot: 0.20,
    spine: 0.08, head: 0.16,
    pelvisYaw: 0.70, chestYaw: -0.50,
    rootZ: 7.5, hipLz: 1.1, hipRz: -1.1,
    ...footAt('right', 8, 40), ...footAt('left', -18, 41),
    ...kickExtend('right', 24, -10),
    ...fistAt('right', 8, 6), ...fistAt('left', 5, 6),
    armRz: 0.20, foreRz: 0.15, armLz: -0.31, foreLz: 0.18,
  }, 'inOutCubic'),
  kf(0.415, {
    ...recover('right', { settle: 1 }),
    rootY: 7.4, ...kickChamber('right', 11, 6),
    chestYaw: -0.22, pelvisYaw: 0.25,
  }, 'inOutCubic'),
  mid(0.475, {
    ...recover('right', { settle: 1 }),
    rootY: 7.4, ...kickChamber('right', 11, 6),
    chestYaw: -0.22, pelvisYaw: 0.25,
  }, stance('right')),
  kf(0.52, stance('right')),
])

/** 12 · H3 — SKYHAMMER FIST.
 *
 * The overhead double hammer. The whole body is a lever: both arms go up
 * onto the toes (rootY negative — the only clip in the set that RISES
 * before it drops), then everything comes down at once — arms, head,
 * chest, hips — landing in a deep square stance. It is the largest
 * vertical travel in the set.
 *
 * The drop is the move. The arms arrive last, which is what makes it read
 * as a hammer rather than a push. */
const HAMMER = clip('unarmedHammer', [
  kf(0, stance('right')),
  // RISE + GATHER: both fists overhead, body extended, heels lifting
  kf(0.115, {
    rootX: -1, rootY: 1.2, rootRot: -0.10,
    spine: -0.16, head: -0.34,
    // Z: the gather loads the whole body BEHIND the plane -- hips back,
    // weight on the heels. The pelvis channel is what was missing: hipZ
    // travelled only 3.4 over the whole clip, so the hammer dropped in a
    // flat plane and the move was indistinguishable from a push.
    rootZ: -8.5, hipLz: 0.55, hipRz: 0.55,
    pelvisYaw: 0.02, chestYaw: -0.04,
    ...footAt('right', 12, 40), ...footAt('left', -13, 41),
    ...fistAt('right', 2, -14), ...fistAt('left', 2, -12),
    armRz: -0.95, armLz: 0.70, foreRz: -0.80, foreLz: 0.55,
  }, 'outQuad'),
  // the apex holds one beat — the anticipation IS the drama
  mid(0.155, {
    rootX: -1, rootY: 1.2, rootRot: -0.10,
    spine: -0.16, head: -0.34,
    rootZ: -8.5, hipLz: 0.55, hipRz: 0.55,
    pelvisYaw: 0.02, chestYaw: -0.04,
    ...footAt('right', 12, 40), ...footAt('left', -13, 41),
    ...fistAt('right', 2, -14), ...fistAt('left', 2, -12),
    armRz: -0.95, armLz: 0.70, foreRz: -0.80, foreLz: 0.55,
  }, {
    // the DROP: everything compresses into a deep square stance
    rootX: 4, rootY: 10.5, rootRot: 0.44,
    spine: 0.34, head: 0.12,
    rootZ: 2.0, hipLz: 0.35, hipRz: -0.35,
    pelvisYaw: 0.0, chestYaw: 0.0,
    ...footAt('right', 17, 34), ...footAt('left', -18, 35),
    ...fistAt('right', 20, 12), ...fistAt('left', 20, 12),
    armRz: 0.20, armLz: -0.20, foreRz: 0.24, foreLz: -0.24,
  }),
  // CONTACT — the fists land lowest as the body bottoms out. Struck lower
  // and further forward than the settle key that follows, so the peak
  // speed is ON the hit rather than in the recovery.
  kf(0.215, {
    rootX: 5, rootY: 11.5, rootRot: 0.48,
    spine: 0.38, head: 0.14,
    // Z: the drop arrives IN FRONT of the plane and both fists lead it.
    // rootZ -8.5 -> +13 is a 21.5-unit commitment through the strike, and
    // the arm yaw goes positive with it so the fists are the nearest mass
    // on the figure at contact -- the near-end-larger read.
    rootZ: 13.0, hipLz: 1.10, hipRz: -1.10,
    pelvisYaw: 0.0, chestYaw: 0.0,
    ...footAt('right', 18, 33), ...footAt('left', -19, 34),
    ...fistAt('right', 24, 16), ...fistAt('left', 24, 16),
    // Staggered on purpose: both fists driving to the same yaw fused into
    // one unreadable blob on the sheet. Splitting them in depth (lead hand
    // nearer than the support hand, with the lead's wrist yawed further)
    // keeps them legibly overlapping -- two shapes, one mass.
    armRz: 1.20, armLz: -0.62, foreRz: 1.05, foreLz: -0.48,
  }, 'inOutCubic'),
  // the body stays low — a hammer does not bounce back up
  kf(0.375, {
    rootX: 3, rootY: 9, rootRot: 0.34,
    spine: 0.24, head: 0.02,
    // stays forward of the plane as the body bottoms out -- the commitment
    // is what the move is about, so it unwinds only part way
    rootZ: 6.5, hipLz: 0.80, hipRz: -0.80,
    ...footAt('right', 16, 36), ...footAt('left', -17, 37),
    ...fistAt('right', 16, 8), ...fistAt('left', 16, 8),
    armRz: 0.42, armLz: -0.42, foreRz: 0.34, foreLz: -0.34,
  }, 'inOutCubic'),
  mid(0.46, {
    rootX: 3, rootY: 9, rootRot: 0.34,
    spine: 0.28, head: 0.24,
    ...footAt('right', 16, 36), ...footAt('left', -17, 37),
    ...fistAt('right', 16, 8), ...fistAt('left', 16, 8),
  }, stance('right')),
  kf(0.58, stance('right')),
])


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
/* RONIN HAND-TO-HAND — THE KINETIC-CHAIN SET                          */
/*                                                                     */
/* Five empty-hand techniques authored to the reference studio's       */
/* biomechanical beat law (proximal-to-distal: ground force → hips →   */
/* trunk torque → shoulder lead → elbow snap → impact):                */
/*   · CHAMBER — weight shifts, hips drop, torso coils (pelvisYaw /    */
/*     chestYaw counter-rotation), elbows clamp to the ribs            */
/*   · STILLNESS FRAME — a near-duplicate key 1–2 frames before the    */
/*     release: zero velocity, tension peaked (the reference's f9–10)  */
/*   · SNAP — the strike key: rootX drive, full extension, inCubic /   */
/*     outQuart ignition                                               */
/*   · IMPACT HOLD — a near-duplicate of the strike key: the body      */
/*     braces through the contact instead of bouncing off it           */
/*   · SETTLE — mid() back to the shared fight guard                   */
/* ================================================================== */

/** 15a · VIPER PALM — the VIPER CROSS-PIERCE read as empty hand: the
 * rear leg pistons, the palm drives a single linear line through the
 * center of mass, elbows tucked so no energy leaks sideways. */
const VIPERPALM = clip('unarmedViperPalm', [
  kf(0.0, G),
  // CHAMBER: weight loads onto the rear leg, torso coils open
  kf(0.117, { ...G, rootY: 4.5, chestYaw: 0.3, pelvisYaw: -0.18,
    hipL: -0.5, kneeL: -0.75, footR: -0.06, footL: 0.42, rootZ: -0.5,
    ...handPose('right', 8, 10), head: -0.16 }, 'outQuad'),
  // STILLNESS FRAME: tension peaks, zero velocity before the release
  kf(0.167, { ...G, rootY: 4.6, chestYaw: 0.32, pelvisYaw: -0.19,
    hipL: -0.5, kneeL: -0.75, footR: -0.06, footL: 0.42, rootZ: -0.5,
    ...handPose('right', 8, 10), head: -0.17 }, 'outQuad'),
  mid(0.242, { ...G, rootY: 4.6, chestYaw: 0.32, pelvisYaw: -0.19,
      hipL: -0.5, kneeL: -0.75, footR: -0.06, footL: 0.42, rootZ: -0.5,
    ...handPose('right', 8, 10), head: -0.17 },
    { ...G, rootX: 6, rootY: 3.6, rootRot: 0.24, chestYaw: -0.34, pelvisYaw: 0.24,
      ...handPose('right', 36, 0), wrR: -0.4, ...handPose('left', 9, 4),
      ...legPose('left', -16, 34), footR: 0.16, footL: 0.9, rootZ: 0.55, head: -0.2 }),
  // SNAP: the piston fires — palm on one line, rear leg extended
  kf(0.317, { ...G, rootX: 6, rootY: 3.6, rootRot: 0.24, chestYaw: -0.34, pelvisYaw: 0.24,
    ...handPose('right', 36, 0), wrR: -0.4, ...handPose('left', 9, 4),
    ...legPose('left', -16, 34), footR: 0.16, footL: 0.9, rootZ: 0.55, head: -0.2 }, 'inOutCubic'),
  // IMPACT HOLD: the body braces through the contact
  kf(0.358, { ...G, rootX: 6.5, rootY: 3.8, rootRot: 0.24, chestYaw: -0.32, pelvisYaw: 0.22,
    ...handPose('right', 36, 0), wrR: -0.4, ...handPose('left', 9, 4),
    ...legPose('left', -16, 34), footR: 0.16, footL: 0.9, rootZ: 0.55, head: -0.2 }, 'inOutCubic'),
  kf(0.45, { ...G, rootX: 3.2, rootY: 4, ...handPose('right', 30, 2), chestYaw: -0.2 }, 'inOutCubic'),
  mid(0.525, { ...G, rootX: 1.4, rootY: 3.8, ...handPose('right', 24, 3), chestYaw: -0.12 }, G),
  kf(0.6, G),
], 0.275)

/** 15b · AVALANCHE HAMMER — the METEOR DROP impact read standing: both
 * hands clasp overhead, the whole mass plunges (rootY 6.5 → 11.5) and the
 * hammer drives DOWN-forward to hip height, ahead of the body. The impact
 * hold is the longest in the set — the body lands ON the blow. */
const AVALANCHE = clip('unarmedAvalancheHammer', [
  kf(0.0, G),
  // GATHER: arms rise overhead, hips sink under the load
  kf(0.197, { ...G, rootY: 6, rootRot: 0.06, ...handPose('right', 14, -30),
    ...handPose('left', 9, -25), wrR: -0.5, wrL: -0.5,
    hipR: 0.3, kneeR: -0.8, hipL: -0.26, kneeL: -0.76,
    footR: -0.04, footL: 0.3, rootZ: -0.45, head: -0.16 }, 'outQuad'),
  // STILLNESS FRAME: coiled at the apex, one breath before the drop
  kf(0.273, { ...G, rootY: 6.5, rootRot: 0.08, ...handPose('right', 15, -32),
    ...handPose('left', 10, -27), wrR: -0.5, wrL: -0.5,
    hipR: 0.3, kneeR: -0.85, hipL: -0.26, kneeL: -0.8,
    footR: -0.04, footL: 0.3, rootZ: -0.45, head: -0.17 }, 'outQuad'),
  mid(0.342, { ...G, rootY: 6.5, rootRot: 0.08, ...handPose('right', 15, -32),
      ...handPose('left', 10, -27), wrR: -0.5, wrL: -0.5,
      hipR: 0.3, kneeR: -0.85, hipL: -0.26, kneeL: -0.8,
    footR: -0.04, footL: 0.3, rootZ: -0.45, head: -0.17 },
    { ...G, rootY: 10, rootRot: 0.36, spine: 0.08, ...handPose('right', 38, 26),
      ...handPose('left', 32, 24), wrR: -0.7, wrL: -0.7,
      hipR: 0.7, kneeR: -1.3, hipL: -0.6, kneeL: -1.2,
    footR: 0.06, footL: 0.78, rootZ: 0.5, head: -0.05 }),
  // SNAP: the avalanche lands — mass, spine and hands in one line
  kf(0.41, { ...G, rootY: 10, rootRot: 0.36, spine: 0.08, ...handPose('right', 38, 26),
    ...handPose('left', 32, 24), wrR: -0.7, wrL: -0.7,
    hipR: 0.7, kneeR: -1.3, hipL: -0.6, kneeL: -1.2,
    footR: 0.06, footL: 0.78, rootZ: 0.5, head: -0.05 }, 'inCubic'),
  // IMPACT HOLD: knees compress, the blow stays buried
  kf(0.479, { ...G, rootY: 10.5, rootRot: 0.38, spine: 0.08, ...handPose('right', 37, 27),
    ...handPose('left', 31, 25), wrR: -0.7, wrL: -0.7,
    hipR: 0.7, kneeR: -1.35, hipL: -0.6, kneeL: -1.25,
    footR: 0.06, footL: 0.8, rootZ: 0.55, head: -0.04 }, 'inOutCubic'),
  kf(0.592, { ...G, rootY: 8, rootRot: 0.3, ...handPose('right', 28, 12), ...handPose('left', 24, 10) }, 'inOutCubic'),
  mid(0.684, { ...G, rootY: 8, rootRot: 0.3, ...handPose('right', 28, 12), ...handPose('left', 24, 10) }, G),
  kf(0.79, G),
], 0.38)

const CYCLONE = clip('unarmedCyclone', [
  kf(0.0, G),
  // WIND: shoulders counter-rotate against the hips — elastic load
  kf(0.229, { ...G, rootY: 5, pelvisYaw: 0.5, chestYaw: 0.55, head: 0.3,
    shL: 0.6, hipR: 0.34, kneeR: -1.05, hipL: -0.3, kneeL: -0.95,
    armRz: 0.35, foreRz: 0.5, hipLz: 0.3, footR: 0.22, footL: -0.08 }, 'outQuad'),
  // STILLNESS FRAME: wound to the stop, zero velocity
  kf(0.3, { ...G, rootY: 5, pelvisYaw: 0.55, chestYaw: 0.6, head: 0.3,
    shL: 0.6, hipR: 0.34, kneeR: -1.1, hipL: -0.3, kneeL: -1.0,
    armRz: 0.35, foreRz: 0.5, hipLz: 0.3, footR: 0.22, footL: -0.08 }, 'outQuad'),
  mid(0.371, { ...G, rootY: 5, pelvisYaw: 0.55, chestYaw: 0.6, head: 0.3,
      shL: 0.6, hipR: 0.34, kneeR: -1.1, hipL: -0.3, kneeL: -1.0,
      armRz: 0.35, foreRz: 0.5, hipLz: 0.3, footR: 0.22, footL: -0.08 },
    { ...G, rootY: 4, pelvisYaw: -0.55, chestYaw: -0.7, head: -0.1,
      ...handPose('left', 34, -2), wrL: -0.4, armLz: 0.3, foreLz: 0.4,
      hipRz: 0.3, hipR: 0.4, kneeR: -0.95, hipL: -0.32, kneeL: -0.9,
      armRz: -0.28, foreRz: -0.4, hipLz: -0.18, footR: -0.04, footL: 0.7 }),
  // SNAP: the unwind — backfist crosses the depth plane at full radius
  kf(0.443, { ...G, rootY: 4, pelvisYaw: -0.55, chestYaw: -0.7, head: -0.1,
    ...handPose('left', 34, -2), wrL: -0.4, armLz: 0.3, foreLz: 0.4,
    hipRz: 0.3, hipR: 0.4, kneeR: -0.95, hipL: -0.32, kneeL: -0.9,
      armRz: -0.28, foreRz: -0.4, hipLz: -0.18, footR: -0.04, footL: 0.7 }, 'inCubic'),
  // IMPACT HOLD: centrifugal extension braces through the arc
  kf(0.507, { ...G, rootY: 4, pelvisYaw: -0.5, chestYaw: -0.6, head: -0.1,
    ...handPose('left', 34, -2), wrL: -0.4, armLz: 0.3, foreLz: 0.4,
    hipRz: 0.3, hipR: 0.4, kneeR: -0.95, hipL: -0.32, kneeL: -0.9,
      armRz: -0.28, foreRz: -0.4, hipLz: -0.18, footR: -0.04, footL: 0.7 }, 'inOutCubic'),
  kf(0.629, { ...G, rootY: 4.2, pelvisYaw: -0.2, chestYaw: -0.25, ...handPose('left', 24, 2) }, 'inOutCubic'),
  mid(0.714, { ...G, rootY: 4.2, pelvisYaw: -0.2, chestYaw: -0.25, ...handPose('left', 24, 2) }, G),
  kf(0.8, G),
], 0.429)

const IRONROOT = clip('unarmedIronRoot', [
  kf(0.0, G),
  // SINK: the root drops — hips to the floor, palms chambered low
  kf(0.135, { ...G, rootY: 7.5, rootRot: 0.24, spine: 0.05,
    ...handPose('left', 6, 13), ...handPose('right', 8, 12), wrL: -0.3, wrR: -0.3,
    hipR: 0.6, kneeR: -1.2, hipL: -0.52, kneeL: -1.12,
    footR: 0.26, footL: 0.34, rootZ: -0.4, head: -0.16 }, 'outQuad'),
  // STILLNESS FRAME: rooted, loaded, zero velocity
  kf(0.21, { ...G, rootY: 8, rootRot: 0.26, spine: 0.05,
    ...handPose('left', 6, 13), ...handPose('right', 8, 12), wrL: -0.3, wrR: -0.3,
    hipR: 0.62, kneeR: -1.26, hipL: -0.54, kneeL: -1.16,
    footR: 0.26, footL: 0.34, rootZ: -0.4, head: -0.17 }, 'outQuad'),
  mid(0.285, { ...G, rootY: 8, rootRot: 0.26, spine: 0.05,
      ...handPose('left', 6, 13), ...handPose('right', 8, 12), wrL: -0.3, wrR: -0.3,
      hipR: 0.62, kneeR: -1.26, hipL: -0.54, kneeL: -1.16,
    footR: 0.26, footL: 0.34, rootZ: -0.4, head: -0.17 },
    { ...G, rootY: 5, rootRot: 0.34, rootX: 5, ...handPose('left', 30, 13),
      ...handPose('right', 36, 2), wrL: -0.55, wrR: -0.55,
      chestYaw: -0.3, pelvisYaw: 0.18, footR: 0.02, footL: 0.22, rootZ: 0.45, head: -0.2 }),
  // SNAP: both palms on one line, the root behind them
  kf(0.36, { ...G, rootY: 5, rootRot: 0.34, rootX: 5, ...handPose('left', 30, 13),
    ...handPose('right', 36, 2), wrL: -0.55, wrR: -0.55,
    chestYaw: -0.3, pelvisYaw: 0.18, footR: 0.02, footL: 0.22, rootZ: 0.45, head: -0.2 }, 'inOutCubic'),
  // IMPACT HOLD: the stance absorbs the reaction
  kf(0.435, { ...G, rootY: 5.5, rootRot: 0.34, rootX: 5.5, ...handPose('left', 30, 13),
    ...handPose('right', 36, 2), wrL: -0.55, wrR: -0.55,
    chestYaw: -0.28, pelvisYaw: 0.16, footR: 0.02, footL: 0.24, rootZ: 0.5, head: -0.2 }, 'inOutCubic'),
  kf(0.57, { ...G, rootX: 3.4, rootY: 5, rootRot: 0.26, ...handPose('left', 28, 5), ...handPose('right', 28, 9) }, 'inOutCubic'),
  mid(0.645, { ...G, rootX: 1.6, rootY: 4.4, rootRot: 0.2, ...handPose('left', 20, 6), ...handPose('right', 21, 7) }, G),
  kf(0.72, G),
], 0.315)

/** 15e · OMEGA PALM — the OMEGA HORIZON read as empty hand: condensation
 * (deep crouch, arms drawn to the core), a long singularity stillness,
 * then the horizon flash — both palms burst forward on the lunge line
 * and the body rides the deceleration home. The string closer. */
const OMEGAPALM = clip('unarmedOmegaPalm', [
  kf(0.0, G),
  // CONDENSE: center of gravity drops, arms drawn to the core
  kf(0.168, { ...G, rootY: 7, rootRot: 0.2, ...handPose('left', 6, 11),
    ...handPose('right', 8, 11), pelvisYaw: -0.2, chestYaw: 0.25, head: -0.18,
    hipR: 0.58, kneeR: -1.16, hipL: -0.5, kneeL: -1.06,
    footL: 0.36, footR: 0.14, rootZ: -0.5 }, 'outQuad'),
  // SINGULARITY: absolute stillness — the longest hold in the set
  kf(0.336, { ...G, rootY: 7.4, rootRot: 0.22, ...handPose('left', 6, 12),
    ...handPose('right', 8, 12), pelvisYaw: -0.2, chestYaw: 0.26, head: -0.19,
    hipR: 0.58, kneeR: -1.2, hipL: -0.5, kneeL: -1.1,
    footL: 0.36, footR: 0.14, rootZ: -0.5 }, 'inOutSine'),
  kf(0.42, { ...G, rootY: 7.5, rootRot: 0.22, ...handPose('left', 6, 12),
    ...handPose('right', 8, 12), pelvisYaw: -0.2, chestYaw: 0.26, head: -0.19,
    hipR: 0.58, kneeR: -1.2, hipL: -0.5, kneeL: -1.1,
    footL: 0.36, footR: 0.14, rootZ: -0.5 }, 'inOutSine'),
  mid(0.504, { ...G, rootY: 7.5, rootRot: 0.22, ...handPose('left', 6, 12),
      ...handPose('right', 8, 12), pelvisYaw: -0.2, chestYaw: 0.26, head: -0.19,
      hipR: 0.58, kneeR: -1.2, hipL: -0.5, kneeL: -1.1,
      footL: 0.36, footR: 0.14, rootZ: -0.5 },
    { ...G, rootY: 3.5, rootRot: 0.4, rootX: 8, ...handPose('left', 32, 13),
      ...handPose('right', 38, 0), wrL: -0.6, wrR: -0.6,
      chestYaw: -0.4, pelvisYaw: 0.3, footL: 0.85, footR: 0.02, rootZ: 0.5, head: -0.22 }),
  // THE FLASH: both palms past the guard line, hips unwound through it
  kf(0.588, { ...G, rootY: 3.5, rootRot: 0.4, rootX: 8, ...handPose('left', 32, 13),
    ...handPose('right', 38, 0), wrL: -0.6, wrR: -0.6,
    chestYaw: -0.4, pelvisYaw: 0.3, footL: 0.85, footR: 0.02, rootZ: 0.5, head: -0.22 }, 'outQuart'),
  // IMPACT HOLD: majestic deceleration begins, palms stay buried
  kf(0.672, { ...G, rootY: 4, rootRot: 0.38, rootX: 8.5, ...handPose('left', 32, 13),
    ...handPose('right', 38, 0), wrL: -0.6, wrR: -0.6,
    chestYaw: -0.36, pelvisYaw: 0.26, footL: 0.85, footR: 0.02, rootZ: 0.5, head: -0.22 }, 'inOutCubic'),
  // SETTLE: the body RIDES the lunge home (rootX decays through the keys —
  // spreading the guard pose would teleport it back 8 px in five frames)
  kf(0.812, { ...G, rootX: 4.5, rootY: 4.5, rootRot: 0.26, ...handPose('left', 28, 4), ...handPose('right', 28, 8) }, 'inOutCubic'),
  mid(0.896, { ...G, rootX: 2, rootY: 4.1, rootRot: 0.2, ...handPose('left', 20, 6), ...handPose('right', 21, 7) }, G),
  kf(0.98, G),
], 0.504)

/* ================================================================== */
/* DASH ATTACKS                                                        */
/* ================================================================== */

/** 16 · DASH LIGHT — SHOULDER TACKLE: lowered shoulder drives through
 * (hitbox tracks the glenohumeral point). */
const TACKLE = clip('unarmedTackle', [
  kf(0, stance('right')),
  // GATHER — the whole body goes DOWN and BACK before it goes anywhere.
  // The legs are the engine of a tackle: knees fold under the hips, the
  // trailing leg loads, the body coils away from the target. Previously
  // the legs were frozen at one angle for the entire clip (measured:
  // hipR 0.42 / kneeR -0.62 identical on all 13 frames) — a stick figure
  // pivoting at the shoulder.
  kf(0.075, chain('linear', 'right', {
    drive: 0.10, travel: -2.0, sink: 3.4, lean: 0.08,
    // CROUCH: ankles pulled UP toward the hips (down 28/29), not pushed
    // away. down 45/47 would straighten the legs to 10-36deg.
    leadFoot: [13, 28], rearFoot: [-15, 29],
    fist: [12, 6], offFist: [10, 5],
  }), 'outQuad'),
  // DRIVE — the rear leg extends and throws the body. This is the beat a
  // tackle lives on: hips leading, shoulder still behind, both feet
  // pushing. Sink goes negative as the body launches into the tackle.
  kf(0.145, chain('linear', 'right', {
    drive: 0.75, travel: 3.0, sink: 0.4, lean: 0.30,
    leadFoot: [22, 36], rearFoot: [-25, 38],
    fist: [8, 8], offFist: [6, 8],
  }), 'outCubic'),
  // CONTACT — the shoulder arrives. The lead leg is planted and braced,
  // the rear leg is fully extended behind and DRIVING: everything is
  // behind the point of the shoulder. The head is down and through.
  kf(0.215, contact('linear', 'right', {
    drive: 1.15, travel: 4.6, sink: 0.9, lean: 0.42, curl: 0.10, depth: 0.95,
    // the lead leg is PLANTED and braced (a real bend, not a stick), the
    // rear leg extended long behind and driving: the diagonal that gives a
    // tackle its line of force
    leadFoot: [24, 33], rearFoot: [-33, 41],
    // arms tucked TIGHT to the ribs so the shoulder is the leading edge,
    // not the hands — a tackle that reaches with its hands is a shove
    fist: [7, 9], offFist: [5, 9],
  }), 'inOutCubic'),
  // THROUGH — the shoulder keeps going past the target while the hips
  // follow. The rear leg swings through: it has done its job.
  kf(0.285, contact('linear', 'right', {
    drive: 1.35, travel: 5.4, sink: 1.4, lean: 0.30, curl: 0.06,
    leadFoot: [20, 34], rearFoot: [-26, 38],
    fist: [10, 8], offFist: [8, 8],
  }), 'inOutCubic'),
  // BRACE — both feet wide and planted, weight settling. A tackle that
  // does not brace after the hit has no weight.
  mid(0.355, contact('linear', 'right', {
      drive: 1.35, travel: 5.4, sink: 1.4, lean: 0.30, curl: 0.06,
      leadFoot: [24, 40], rearFoot: [-18, 43],
      fist: [10, 8], offFist: [8, 8],
    }),
    recover('right', { settle: 1 })),
  kf(0.41, recover('right', { settle: 0.6 }), 'inOutCubic'),
  kf(0.46, stance('right')),
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
 * settle to the fight guard. kf(0 = FIST_DUAL_CHARGE_CLIP's TAUT LOCK,
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
  kf(0, stance('right')),
  // ABSORB — a counter does not start by attacking. The body gives ground,
  // sinks onto the back leg, and turns SLIGHTLY AWAY: it is receiving the
  // incoming blow. depth -0.55 opens the girdle toward the camera so the
  // sink reads as the body going back and down in 3D, not just squatting.
  kf(0.075, chain('linear', 'right', {
    drive: -0.15, travel: -1.8, sink: 2.6, lean: 0.02, depth: -0.55,
    leadFoot: [14, 31], rearFoot: [-18, 33],
    fist: [10, 7], offFist: [11, 6],
    offFold: 0.30,
  }), 'outQuad'),
  // PLANT — the counter's launch is the REAR FOOT driving. Weight drops
  // through the floor and the hips start to square, but the palm has not
  // moved yet: proximal first, exactly as in the strike chain.
  kf(0.135, chain('linear', 'right', {
    drive: 0.35, travel: 0.4, sink: 1.9, lean: 0.10, depth: -0.20,
    leadFoot: [17, 33], rearFoot: [-21, 35],
    fist: [14, 6], offFist: [10, 6],
    offFold: 0.45,
  }), 'outCubic'),
  // CONTACT — the palm arrives with everything behind it. The lead leg is
  // braced, the rear leg is extended and has just finished driving, the
  // chest has rotated through, and the whole girdle opens FORWARD in depth
  // (+0.85) so the palm comes toward the player as well as across.
  kf(0.205, contact('linear', 'right', {
    drive: 1.10, travel: 4.2, sink: 0.6, lean: 0.26, depth: 0.85,
    leadFoot: [23, 34], rearFoot: [-27, 36],
    fist: [40, -3], offFist: [-2, 8],
    offFold: 0.85,
  }), 'inOutCubic'),
  // THROUGH — the palm keeps going past the target line and the body
  // follows it. depth peaks here: the strike has come fully round.
  kf(0.275, contact('linear', 'right', {
    drive: 1.30, travel: 4.8, sink: 1.2, lean: 0.18, depth: 0.70,
    leadFoot: [21, 37], rearFoot: [-22, 40],
    fist: [34, 0], offFist: [1, 8],
    offFold: 0.60,
  }), 'inOutCubic'),
  // SETTLE — weight comes back to centre, the girdle closes.
  mid(0.34, contact('linear', 'right', {
      drive: 1.30, travel: 4.8, sink: 1.2, lean: 0.18, depth: 0.70,
      leadFoot: [21, 37], rearFoot: [-22, 40],
      fist: [34, 0], offFist: [1, 8],
      offFold: 0.60,
    }),
    recover('right', { settle: 1 })),
  kf(0.40, stance('right')),
])

/** 19 · CHARGED — SHINRA PALM: coiled hold → twin-palm shockwave. */
const SHINRA = clip('unarmedShinraPalm', [
  kf(0, stance('right')),
  // GATHER — the charge begins by SINKING. Both knees fold, the body turns
  // away in depth (girdle opens to -0.8) and the palms draw in to the
  // ribs. A charged move earns its weight from the load, not from a hold.
  kf(0.10, chain('linear', 'right', {
    drive: -0.30, travel: -2.2, sink: 3.6, lean: 0.04, depth: -0.80,
    leadFoot: [13, 29], rearFoot: [-17, 30],
    fist: [7, 6], offFist: [7, 7],
    offFold: 0.25,
  }), 'outQuad'),
  // COMPRESS — deeper, and now BOTH hands are cocked. This is the frame the
  // player reads as "charging": the body is a coiled spring, feet wide,
  // knees loaded, both palms back.
  kf(0.20, chain('linear', 'right', {
    drive: -0.45, travel: -3.0, sink: 4.4, lean: 0.02, depth: -1.05,
    leadFoot: [12, 27], rearFoot: [-16, 28],
    fist: [4, 7], offFist: [3, 7],
    offFold: 0.15,
  }), 'inOutCubic'),
  // THE HOLD — two frames of real stillness. It is deliberately short: a
  // charge has to be FELT before it breaks, but a long freeze is what made
  // this clip read flat. The pose creeps one hair deeper so it is alive.
  kf(0.30, chain('linear', 'right', {
    drive: -0.50, travel: -3.2, sink: 4.6, lean: 0.02, depth: -1.10,
    leadFoot: [12, 26], rearFoot: [-16, 28],
    fist: [3, 7], offFist: [2, 7],
    offFold: 0.12,
  }), 'inOutSine'),
  // RELEASE — everything fires at once. Hips square, rear leg extends and
  // throws, and BOTH palms go through the target line while the girdle
  // slams open to +1.0. The legs are the engine here: the sink drops from
  // 4.6 to -0.4, so the body literally rises and drives into the hit.
  kf(0.395, contact('linear', 'right', {
    drive: 1.25, travel: 5.0, sink: -0.4, lean: 0.30, depth: 1.00, curl: 0.06,
    leadFoot: [25, 38], rearFoot: [-29, 35],
    fist: [41, -4], offFist: [34, -1],
    offFold: 0.95,
  }), 'outQuart'),
  // IMPACT — the follow-through: palms past the line, the body still
  // traveling. Legs braced wide.
  kf(0.475, contact('linear', 'right', {
    drive: 1.40, travel: 5.6, sink: 0.6, lean: 0.20, depth: 0.85, curl: 0.04,
    leadFoot: [22, 40], rearFoot: [-25, 40],
    fist: [36, 0], offFist: [30, 2],
    offFold: 0.75,
  }), 'inOutCubic'),
  // SETTLE — the heavy recovery. Weight comes back down and centre.
  mid(0.545, contact('linear', 'right', {
      drive: 1.40, travel: 5.6, sink: 0.6, lean: 0.20, depth: 0.85, curl: 0.04,
      leadFoot: [22, 40], rearFoot: [-25, 40],
      fist: [36, 0], offFist: [30, 2],
      offFold: 0.75,
    }),
    recover('right', { settle: 1 })),
  kf(0.60, stance('right')),
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
    ...handPose('left', 10, 6), ...handPose('right', 10, 8), elL: -2.10, elR: -2.25 }, 'outQuad'),
  mid(0.13, { ...G, ...AIR_TUCK, ...legPose('right', 8, 20), kneeR: -1.6, head: -0.18,
      ...handPose('left', 10, 6), ...handPose('right', 10, 8), elL: -2.10, elR: -2.25 },
    { ...G, ...AIR_TUCK, rootY: -1, ...legPose('right', 30, 2), kneeR: -1.4,
      pelvisYaw: 0.18, head: -0.2, ...handPose('left', 6, 10), ...handPose('right', 8, 12),
      // off arm PUMPS DOWN into the knee drive
      elL: -1.20, elR: -1.85 }),
  kf(0.18, { ...G, ...AIR_TUCK, rootY: -1, ...legPose('right', 30, 2), kneeR: -1.4,
    pelvisYaw: 0.18, head: -0.2, ...handPose('left', 6, 10), ...handPose('right', 8, 12),
    elL: -1.05, elR: -1.75 }, 'inOutCubic'),
  kf(0.28, { ...G, ...AIR_TUCK, ...legPose('right', 20, 10), kneeR: -1.5,
    elL: -1.70, elR: -2.05 }, 'inOutCubic'),
  mid(0.34, { ...G, ...AIR_TUCK, ...legPose('right', 20, 10), kneeR: -1.5 }, G),
  kf(0.40, G),
])

/** 23 · A2 — AIR CROSS: jumping rear straight. */
const AIRCROSS = clip('unarmedAirCross', [
  kf(0, G),
  mid(0.035, G, { ...G, ...AIR_TUCK, rootY: 0, chestYaw: -0.28, pelvisYaw: 0.14,
      ...handPose('left', 6, 6), elR: -2.20 }),
  kf(0.07, { ...G, ...AIR_TUCK, rootY: 0, chestYaw: -0.28, pelvisYaw: 0.14,
    ...handPose('left', 6, 6), elR: -2.20 }, 'outQuad'),
  mid(0.11, { ...G, ...AIR_TUCK, rootY: 0, chestYaw: -0.28, pelvisYaw: 0.14,
      ...handPose('left', 6, 6), elR: -2.20 },
    { ...G, ...AIR_TUCK, rootY: 0, ...handPose('left', 33, 0),
      chestYaw: 0.35, pelvisYaw: -0.2, head: -0.18, ...handPose('right', 10, 3),
      // guard arm pulls back as the cross fires
      shR: 0.75, elR: -1.55 }),
  kf(0.15, { ...G, ...AIR_TUCK, rootY: 0, ...handPose('left', 33, 0),
    chestYaw: 0.35, pelvisYaw: -0.2, head: -0.18, ...handPose('right', 10, 3),
    shR: 0.85, elR: -1.40 }, 'inOutCubic'),
  mid(0.235, { ...G, ...AIR_TUCK, rootY: 0, ...handPose('left', 33, 0),
      chestYaw: 0.35, pelvisYaw: -0.2, head: -0.18, ...handPose('right', 10, 3) }, G),
  kf(0.32, G),
])

/** 24 · A3 — CRESCENT ARC (mikazuki-geri): outward depth-arc air kick. */
const CRESCENT = clip('unarmedCrescent', [
  kf(0, G),
  kf(0.13, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 8, -18, 'flat'), kneeR: -1.8,
    // the arms load ACROSS as the leg winds out to the side
    shL: 0.95, elL: -2.05, shR: 0.30, elR: -2.25, armLz: 0.45, armRz: -0.30,
    hipRz: 0.4, head: -0.14 }, 'outQuad'),
  mid(0.185, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 8, -18, 'flat'), kneeR: -1.8,
      shL: 0.95, elL: -2.05, shR: 0.30, elR: -2.25, armLz: 0.45, armRz: -0.30,
      hipRz: 0.4, head: -0.14 },
    { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 30, -14, 'point'), kneeR: -0.7,
      // and SNAP the other way as the kick cuts across — the classic
      // crescent counter-rotation
      shL: -0.30, elL: -0.65, shR: 0.55, elR: -1.15, armLz: -1.05, armRz: 0.85,
      hipRz: -0.25, chestYaw: -0.4, pelvisYaw: 0.25, head: -0.16 }),
  kf(0.24, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 30, -14, 'point'), kneeR: -0.7,
    shL: -0.38, elL: -0.58, shR: 0.62, elR: -1.05, armLz: -1.20, armRz: 0.95,
    hipRz: -0.25, chestYaw: -0.4, pelvisYaw: 0.25, head: -0.16 }, 'inOutCubic'),
  kf(0.34, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 22, -6, 'point'), kneeR: -1.2,
    shL: 0.35, elL: -1.45, shR: 0.80, elR: -1.70, armLz: -0.45, armRz: 0.40,
    hipRz: 0.1 }, 'inOutCubic'),
  mid(0.40, { ...G, ...AIR_TUCK, rootY: 0, ...kickPose('right', 22, -6, 'point'), kneeR: -1.2,
      shL: 0.35, elL: -1.45, shR: 0.80, elR: -1.70, armLz: -0.45, armRz: 0.40,
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
    // arms WRAP ACROSS the body to load the spin
    shL: 1.15, elL: -2.20, shR: 0.55, elR: -2.35,
    armLz: 0.55, armRz: -0.35,
    ...legPose('right', 6, 18), kneeR: -1.8 }, 'outQuad'),
  mid(0.13, { ...G, rootY: 0, pelvisYaw: 0.4, chestYaw: 0.5, head: 0.3, ...AIR_TUCK,
      shL: 1.15, elL: -2.20, shR: 0.55, elR: -2.35,
      armLz: 0.55, armRz: -0.35,
      ...legPose('right', 6, 18), kneeR: -1.8 },
    { ...G, rootY: 0, pelvisYaw: -0.4, chestYaw: -0.55, head: -0.1, ...AIR_TUCK,
      // arms FLING OUT wide: the spin is driven and then caught by them
      shL: -0.35, elL: -0.55, shR: 0.20, elR: -0.75,
      armLz: -1.15, armRz: 1.05,
      ...kickPose('right', 32, -10, 'point'), kneeR: -0.8, hipRz: 0.35 }),
  kf(0.18, { ...G, rootY: 0, pelvisYaw: -0.4, chestYaw: -0.55, head: -0.1, ...AIR_TUCK,
    shL: -0.45, elL: -0.42, shR: 0.28, elR: -0.62,
    armLz: -1.30, armRz: 1.20,
    ...kickPose('right', 32, -10, 'point'), kneeR: -0.8, hipRz: 0.35 }, 'inOutCubic'),
  kf(0.28, { ...G, rootY: 0, pelvisYaw: -0.15, chestYaw: -0.2, ...AIR_TUCK,
    shL: 0.30, elL: -1.30, shR: 0.85, elR: -1.55,
    armLz: -0.55, armRz: 0.50,
    ...kickPose('right', 20, -6, 'point'), kneeR: -1.3 }, 'inOutCubic'),
  mid(0.36, { ...G, rootY: 0, pelvisYaw: -0.15, chestYaw: -0.2, ...AIR_TUCK,
      shL: 0.30, elL: -1.30, shR: 0.85, elR: -1.55,
      armLz: -0.55, armRz: 0.50,
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
    // THE EMPTY-HAND CONTRACT, ENFORCED: a fist/heel is narrower than any
    // blade, so the contact pad is clamped at 7 px here rather than trusted
    // from the spec. Authoring pad:10 in this table (as two dash strikes
    // once did) silently produced a punch with a katana's hitbox.
    heavy: !!s.heavy, pad: Math.min(EMPTY_HAND_PAD_MAX, s.pad ?? (s.heavy ? 7 : 5)),
    breakGuard: s.breakGuard,
    multiHit: s.multiHit, aoe: s.aoe,
    corridorBack: s.corridorBack, corridorFront: s.corridorFront, corridorY: s.corridorY,
  }
  return {
    id: s.id, label: s.label, kind: s.kind, requires: s.requires,
    clip: s.clip, strikeHand: s.limb, strikeJoint: s.joint ?? 'hand', grip: 0,
    // the cancel window can never outrun the clip: an authored recovery pad
    // past the last keyframe would leave the chain window open on a clip that
    // has already ended (audit-combat-map's cancel ≤ duration contract).
    chain: s.chain ?? [], cancel: Math.min(s.hitEnd + (s.heavy ? 0.12 : 0.06), s.clip.dur),
    hit, trail: { start: s.hitStart, end: s.hitEnd },
    swingSfx: { t: s.sfxT ?? Math.max(0.02, s.hitStart - 0.04), name: (s.heavySfx ?? s.heavy) ? 'swingHeavy' : 'swing' },
    moveX: s.moveX, moveXAt: s.moveXAt, moveY: s.moveY, moveYAt: s.moveYAt,
    float: s.float, groundDrive: s.groundDrive,
  }
}

const MOVES_SRC: MoveSpec[] = [
  /* ground light chain */
  { id: 'l1', label: 'KIZAMI JAB', kind: 'light', requires: 'ground', clip: JAB, limb: 'right',
    hitStart: 0.095, hitEnd: 0.15, dmg: 10, kb: 95,
    chain: ['sakugaJabCross', 'viperPalm'] },
  { id: 'l2', label: 'GYAKU CROSS', kind: 'light', requires: 'ground', clip: CROSS, limb: 'left',
    hitStart: 0.11, hitEnd: 0.20, dmg: 13, kb: 115,
    chain: ['l3', 'h1', 'h2', 'stabs', 'launcher', 'spin', 'retreat', 'sakugaBarrage', 'viperPalm', 'cyclone'] },
  { id: 'l3', label: 'KAGI HOOK', kind: 'light', requires: 'ground', clip: HOOK, limb: 'right',
    hitStart: 0.105, hitEnd: 0.22, dmg: 14, kb: 125,
    chain: ['l4', 'h1', 'h2', 'stabs', 'launcher', 'retreat', 'cyclone', 'avalancheElbow'] },
  { id: 'l4', label: 'SLIP BODY ELBOW', kind: 'light', requires: 'ground', clip: BODYBLOW, limb: 'right', joint: 'elbow',
    // window anchored on the elbow's measured peak (0.22s), not the
    // pre-slip timestamp: the slip is the setup, the elbow is the hit
    hitStart: 0.155, hitEnd: 0.24, dmg: 15, kb: 105, stagger: 0.3,
    chain: ['l5', 'h2', 'stabs', 'launcher', 'sakugaDragon', 'viperPalm', 'ironRoot'] },
  { id: 'l5', label: 'TWIN SHOTEI', kind: 'light', requires: 'ground', clip: TWINPALM, limb: 'right',
    hitStart: 0.16, hitEnd: 0.30, dmg: 16, kb: 165, breakGuard: true,
    chain: ['srOnslaught', 'omegaPalm'] },
  /* contextual lights */
  { id: 'retreat', label: 'HOP-BACK BACKFIST', kind: 'light', requires: 'ground', clip: BACKFIST, limb: 'left',
    // window anchored on the measured fist peak (0.139): the backfist is
    // thrown OFF the landing, so the hitbox must not open during the
    // launch — it opens as the feet come down and the turn fires.
    hitStart: 0.175, hitEnd: 0.295, dmg: 13, kb: 130,
    // moveX is a VELOCITY and the attack damps it hard, so displacement is
    // strongly compressed: -110 bought only 7px. -300 buys ~50px, which is
    // what a hop-back has to cover for the legs and the root to agree.
    // the impulse fires and finishes BEFORE the backfist lands. Retreat and
    // reach were cancelling each other (moveX -300 -> never connects); the
    // hop gets the first 100ms, the strike gets the rest.
    // BALANCE: a hop-back and a counter are in direct tension — the body
    // travels away while the fist reaches forward, so they subtract
    // (measured: -110 -> reaches 45px, -200 -> 25px, -300 -> never lands).
    // -200 is the point where the hop still reads as a hop (~35px of
    // travel, an 80ms airborne arc) and the backfist still counters an
    // enemy standing at its natural 30-45px engagement distance.
    moveX: -150, moveXAt: 0.0,
    // moveY actually leaves the floor. Without it the legs tuck in the
    // pose while the engine keeps the feet planted, which is a mime of a
    // hop rather than a hop. -230 at the launch beat gives a short,
    // weighty arc that lands on the backfist.
    moveY: -190, moveYAt: 0.06 },
  { id: 'spin', label: 'CROUCHING SWEEP', kind: 'spin', requires: 'ground', clip: SWEEP, limb: 'right', joint: 'foot',
    hitStart: 0.15, hitEnd: 0.29, dmg: 14, kb: 120, kbY: 60, launch: 80, stagger: 0.5 },
  { id: 'launcher', label: 'RISING DRAGON', kind: 'launcher', requires: 'ground', clip: UPPERcut, limb: 'right',
    hitStart: 0.15, hitEnd: 0.25, dmg: 16, kb: 100, kbY: -240, launch: 420, moveY: -300, moveYAt: 0.13,
    float: 0.75, chain: ['a1', 'a2', 'a3', 'dive', 'slam'] },
  { id: 'stabs', label: 'RENZOKU KNEE RUSH', kind: 'light', requires: 'ground', clip: KNEEBARRAGE, limb: 'right', joint: 'knee',
    hitStart: 0.05, hitEnd: 0.50, dmg: 9, kb: 70, multiHit: 0.12, moveX: 120, moveXAt: 0.02 },
  /* heavies */
  { id: 'h1', label: 'RIPPLING ELBOW', kind: 'heavy', requires: 'ground', clip: ELBOW, limb: 'right', joint: 'elbow',
    // re-anchored: adding the Z travel moved the elbow's speed peak from
    // 0.182 to 0.174, ahead of the old 0.192 window. Opening at 0.164
    // keeps a 0.12s window and covers the peak outright.
    hitStart: 0.164, hitEnd: 0.284, dmg: 20, kb: 180, heavy: true,
    chain: ['l1', 'l2', 'launcher', 'spin', 'avalancheElbow'] },
  { id: 'h2', label: 'TORNADO ROUNDHOUSE', kind: 'heavy', requires: 'ground', clip: ROUNDHOUSE, limb: 'right', joint: 'foot',
    hitStart: 0.152, hitEnd: 0.292, dmg: 26, kb: 240, heavy: true, breakGuard: true,
    chain: ['l5', 'launcher', 'sakugaScorpion', 'omegaPalm'] },
  { id: 'h3', label: 'SKYHAMMER FIST', kind: 'heavy', requires: 'ground', clip: HAMMER, limb: 'right',
    // re-anchored: staggering the fists in depth moved the lead fist's speed
    // peak from 0.174 to 0.174 but shortened the window's coverage -- at
    // 0.19 the window opened 32ms after the peak and scored only 0.79.
    hitStart: 0.155, hitEnd: 0.295, dmg: 30, kb: 210, kbY: 120, heavy: true, breakGuard: true,
    chain: ['l1', 'sakugaHammer', 'sakugaWrath', 'avalancheElbow'] },
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
    stagger: 0.5, hitstop: 0.11, shake: 0.36, multiHit: 0.13, pad: 7,
    corridorBack: 150, corridorFront: 88, corridorY: 55,
    moveX: 240, moveXAt: 0.02, chain: ['h1', 'l1'] },
  { id: 'powerKick', label: 'FUJIN KYAKU', kind: 'dash', requires: 'ground', clip: POWERKICK, limb: 'right', joint: 'foot',
    hitStart: 0.10, hitEnd: 0.44, dmg: 26, kb: 640, kbY: -90, launch: 260, heavy: true, breakGuard: true,
    stagger: 0.55, hitstop: 0.12, shake: 0.38, multiHit: 0.13, pad: 7,
    corridorBack: 150, corridorFront: 88, corridorY: 40,
    moveX: 240, moveXAt: 0.02, chain: ['h2', 'l1'] },
  /* THE KINETIC-CHAIN SET — five empty-hand techniques authored to the
   * reference studio's proximal-to-distal beat law (chamber → stillness
   * frame → snap → impact hold → settle). Clips above; the combo director
   * (combat/combo-director.ts) walks these branches. */
  { id: 'viperPalm', label: 'VIPER PALM PIERCE', kind: 'light', requires: 'ground', clip: VIPERPALM, limb: 'right',
    hitStart: 0.275, hitEnd: 0.4, dmg: 15, kb: 130, stagger: 0.22, hitstop: 0.045,
    moveX: 70, moveXAt: 0.25,
    chain: ['l3', 'l4', 'ironRoot', 'h1', 'launcher'] },
  { id: 'avalancheElbow', label: 'AVALANCHE HAMMER DROP', kind: 'heavy', requires: 'ground', clip: AVALANCHE, limb: 'right', joint: 'hand',
    hitStart: 0.38, hitEnd: 0.517, dmg: 27, kb: 190, kbY: 90, heavy: true, breakGuard: true,
    stagger: 0.35, hitstop: 0.11, shake: 0.26, moveX: 55, moveXAt: 0.319,
    chain: ['l1', 'l2', 'omegaPalm', 'h2'] },
  { id: 'cyclone', label: 'CYCLONE BACKFIST', kind: 'light', requires: 'ground', clip: CYCLONE, limb: 'left',
    hitStart: 0.429, hitEnd: 0.543, dmg: 18, kb: 155, stagger: 0.3, hitstop: 0.06, shake: 0.12,
    moveX: 40, moveXAt: 0.343, chain: ['l2', 'l4', 'spin', 'viperPalm'] },
  { id: 'ironRoot', label: 'IRON ROOT PALM', kind: 'light', requires: 'ground', clip: IRONROOT, limb: 'right',
    hitStart: 0.315, hitEnd: 0.45, dmg: 19, kb: 175, breakGuard: true, stagger: 0.4, hitstop: 0.07,
    moveX: 60, moveXAt: 0.255, chain: ['l1', 'h1', 'omegaPalm'] },
  { id: 'omegaPalm', label: 'OMEGA HORIZON PALM', kind: 'finisher', requires: 'ground', clip: OMEGAPALM, limb: 'right',
    hitStart: 0.504, hitEnd: 0.7, dmg: 34, kb: 430, kbY: -50, heavy: true, breakGuard: true,
    stagger: 0.55, hitstop: 0.13, shake: 0.36, multiHit: 0.14,
    moveX: 150, moveXAt: 0.476, chain: ['l1', 'l2'] },
  /* specials */
  { id: 'riposte', label: 'REKKA COUNTER PALM', kind: 'riposte', requires: 'any', clip: COUNTERPALM, limb: 'right',
    // window on the measured palm peak (0.173), not the pre-recompose value
    hitStart: 0.165, hitEnd: 0.285, dmg: 24, kb: 215, breakGuard: true },
  { id: 'charged', label: 'SHINRA PALM', kind: 'charged', requires: 'ground', clip: SHINRA, limb: 'right',
    // window on the measured release peak (0.315): the charge holds,
    // then the explosion is the fast frame
    hitStart: 0.305, hitEnd: 0.445, dmg: 32, kb: 265, heavy: true, breakGuard: true },
  /* air family */
  { id: 'a1', label: 'FLYING KNEE', kind: 'air', requires: 'air', clip: FLYKNEE, limb: 'right', joint: 'knee',
    hitStart: 0.02, hitEnd: 0.16, dmg: 15, kb: 145, float: 0.8,
    chain: ['a2', 'a3', 'dive'] },
  { id: 'a2', label: 'AIR CROSS', kind: 'air', requires: 'air', clip: AIRCROSS, limb: 'left',
    hitStart: 0.11, hitEnd: 0.19, dmg: 13, kb: 105, float: 0.8,
    chain: ['a3', 'dive', 'slam'] },
  { id: 'a3', label: 'CRESCENT ARC KICK', kind: 'air', requires: 'air', clip: CRESCENT, limb: 'right', joint: 'foot',
    hitStart: 0.355, hitEnd: 0.455, dmg: 17, kb: 165, float: 0.75,
    chain: ['dive', 'slam'] },
  { id: 'dive', label: 'METEOR DROPKICK', kind: 'air', requires: 'air', clip: DROPKICK, limb: 'right', joint: 'foot',
    hitStart: 0.12, hitEnd: 0.40, dmg: 24, kb: 245, heavy: true, float: 0.6,
    moveY: 650, moveYAt: 0.15 },
  { id: 'slam', label: 'SEISMIC HEEL DROP', kind: 'slam', requires: 'air', clip: HEELDROP, limb: 'right', joint: 'foot',
    hitStart: 0.28, hitEnd: 0.53, dmg: 14, kb: 80, heavy: true, multiHit: 0.16,
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
/* The hitbox follows the animation, never the other way round: a re-timed
 * clip reports the instant its pose actually snaps, so any move whose clip
 * was baked around a contact gets its window re-anchored onto that frame
 * (same width, so damage-per-window and cancel maths are unchanged). */
for (const m of Object.values(MOVES)) {
  const snapAt = m.clip?.snapAt
  if (snapAt == null) continue
  const width = Math.max(1 / 60, m.hit.end - m.hit.start)
  const start = Math.max(0, Math.round((snapAt - 1 / 24) * 1000) / 1000)
  m.hit = { ...m.hit, start, end: Math.round((start + width) * 1000) / 1000 }
}
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
