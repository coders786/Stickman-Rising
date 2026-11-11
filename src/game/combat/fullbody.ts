/** STICKMAN RISING — full-body hand-to-hand choreography.
 *
 * ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────
 * An audit of the 45 empty-hand moves found the light chain barely used
 * the lower body: l1–l5 and h1 had ZERO leg-channel motion (legsL =
 * legsR = 0.00 rad across the whole clip). They were arms and torso
 * rotating above a pair of frozen pins. h2 and h3 moved a leg, but as an
 * afterthought rather than as the source of the strike.
 *
 * That is technically "not arm-only" — the pelvis and chest do turn — but
 * it is not how a body throws a punch. The user's note was exact: use the
 * FULL body, all limbs, dramatic motion, and no physics.
 *
 * ── THE MODEL: PROXIMAL → DISTAL ───────────────────────────────────────
 * Every strike here is authored as a kinetic chain that starts at the
 * ground and ends at the contact point:
 *
 *     stance/step  →  pelvis    →  chest     →  shoulder  →  limb  →  contact
 *     (feet, legs)    (hip yaw)    (counter)    (drive)      (extend)
 *
 * The body is a whip, not a turret. That ordering is the single law this
 * module exists to enforce, and `chain()` below is the vocabulary for it.
 *
 * Two consequences of doing it this way, both deliberate:
 *
 *  · FOLLOW-THROUGH AND COUNTER-WEIGHT. A strike does not stop at
 *    contact. The limb that is NOT striking travels the opposite way
 *    (the guard hand pulls back as the lead drives out), because that is
 *    what keeps a real body balanced — and it is what makes a silhouette
 *    read as a whole action rather than one moving arm.
 *  · THE WEIGHT MOVES. A committed strike transfers body weight: the root
 *    travels forward into the strike and the legs re-plant underneath it.
 *    A jab creeps; a cross drives; a hammer drops.
 *
 * ── DELIBERATELY NOT PHYSICS ───────────────────────────────────────────
 * Every number here is an authored key. Nothing is solved by a spring, a
 * damped integrator, or a momentum exchange. `no physics here` — the
 * motion is drawn, the same way it would be drawn on twos: a small number
 * of extreme poses, held, then snapped through. The economy is the
 * point: a dramatic body pose held for three frames reads harder than a
 * physically-plausible continuum of them.
 *
 * Anatomical plausibility is preserved by two things and no more:
 * `applyJointLimits` (the ROM gate every clip passes through) and the
 * explicit `hipPose`/`handPose` channel solvers — anatomy as a constraint
 * on where you are allowed to draw, not as a simulation.
 *
 * ── NAMING ─────────────────────────────────────────────────────────────
 * Channel names are the game's 28-channel pose: rootX/rootY/rootRot,
 * pelvisYaw, chestYaw, per-side hip/knee/foot, per-side shoulder/elbow/
 * wrist, and the depth channels (armLz/armRz, foreLz/foreRz) that let a
 * strike travel out of the gameplay plane for the 3D read.
 */
import { CH, type PoseInput } from '../anim/pose'
import type { StrikeHand } from './moveset'

/* ------------------------------------------------------------------ */
/* anatomy constants — read off PLAYER_SPEC, never re-guessed          */
/* ------------------------------------------------------------------ */

/** Arm reach, shoulder to fist, in rig units. */
const ARM = 42
/** Leg reach, hip to ankle. */
const LEG = 49

/* ------------------------------------------------------------------ */
/* the vocabulary                                                      */
/* ------------------------------------------------------------------ */

/** How far back the guard sits, in rig units. The strike's forward travel
 * is measured FROM here, which is what gives the body a range to cross —
 * a stance already centred has nowhere to drive to. */
const STANCE_BACK = -7

/**
 * A full-body strike pose.
 *
 * Everything is optional and layered over the fight guard, so a key only
 * states what it changes — but the intent is that a key states something
 * about EVERY link in the chain, because a pose that mentions only the
 * arm is the failure mode this module exists to correct.
 */
export interface FullBodyKey extends PoseInput {
  /** lead foot (near side) placement: [forward, down] from the hip. */
  footLead?: readonly [number, number]
  /** rear foot (far side) placement: [forward, down] from the hip. */
  footRear?: readonly [number, number]
}

/** Which foot is in front. Tracks through the chain, because a body that
 * throws with the same-side hand and foot is off-balance and reads wrong. */
export interface ChainState {
  lead: StrikeHand
  /** Distance travelled forward so far (drives rootX accumulation). */
  travel: number
}

/**
 * Solve a foot placement into hip/knee/foot channels.
 *
 * This is anatomy, not physics: the leg is treated as two rigid segments
 * of known length and the joint angles that put the ankle on the target
 * are solved in closed form. Same closed-form solve the existing
 * `legPose` helper uses, kept local so this module has no dependency on
 * the clip table it is replacing.
 */
export function footAt(side: StrikeHand, forward: number, down: number): PoseInput {
  const d = Math.max(10.5, Math.min(LEG - 0.2, Math.hypot(forward, down)))
  const tau = Math.atan2(forward, down)
  const a = 25, b = 24 // thigh, shin
  const al = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))))
  const ga = Math.acos(Math.max(-1, Math.min(1, (d * d + b * b - a * a) / (2 * d * b))))
  const hip = tau + al
  const knee = -(al + ga)
  // The foot channel keeps the sole flat on the floor for a planted leg:
  // shin absolute angle is hip + knee, so the ankle compensates.
  const foot = -(hip + knee) * 0.55
  return side === 'left'
    ? { hipL: hip, kneeL: knee, footL: foot }
    : { hipR: hip, kneeR: knee, footR: foot }
}

/** Clamp an authored reach so the given hand can physically get there. */
function reach(x: number, y: number): [number, number] {
  const r = Math.hypot(x, y)
  const max = ARM - 1.5
  if (r <= max) return [x, y]
  const k = max / r
  return [x * k, y * k]
}

/**
 * Solve a fist position (relative to the shoulder) into shoulder/elbow
 * channels, with the elbow hanging on the human pole.
 */
export function fistAt(side: StrikeHand, x: number, y: number): PoseInput {
  const [rx, ry] = reach(x, y)
  const a = 22, b = 20 // upperArm, foreArm
  const r = Math.max(12, Math.min(a + b - 2, Math.hypot(rx, ry)))
  const sh = Math.atan2(rx, ry) + Math.acos(Math.max(-1, Math.min(1, (a * a + r * r - b * b) / (2 * a * r))))
  const el = -Math.acos(Math.max(-1, Math.min(1, (r * r - a * a - b * b) / (2 * a * b))))
  return side === 'left' ? { shL: sh, elL: el } : { shR: sh, elR: el }
}

/* ------------------------------------------------------------------ */
/* stance                                                              */
/* ------------------------------------------------------------------ */

/**
 * A boxer's stance with the weight visibly loaded onto the rear leg.
 *
 * Deeper than the old guard (rootY 3.5 → 5.5) because a fighter who is
 * about to transfer weight has to have somewhere to transfer it FROM. The
 * lead foot is placed forward and the rear foot drives back, which is
 * what gives every strike below a leg it can push against.
 */
export function stance(lead: StrikeHand = 'right'): PoseInput {
  const rear: StrikeHand = lead === 'right' ? 'left' : 'right'
  return {
    // the guard sits BACK on the rear leg: rootX is negative so that a
    // forward strike has somewhere to travel from (see STANCE_BACK)
    rootX: STANCE_BACK,
    rootRot: 0.12, spine: 0.04, head: -0.13, rootY: 5.5,
    pelvisYaw: lead === 'right' ? -0.10 : 0.10,
    chestYaw: lead === 'right' ? 0.14 : -0.14,
    ...footAt(lead, 19, 38),        // lead foot well forward
    ...footAt(rear, -21, 39),       // rear foot well back — a real base
    ...fistAt(lead, 12, 3),         // lead fist high
    ...fistAt(rear, 7, 5),          // rear fist at the jaw
    armRz: 0.06, armLz: -0.06, foreRz: 0.08, foreLz: -0.04,
  }
}

/* ------------------------------------------------------------------ */
/* the chain                                                           */
/* ------------------------------------------------------------------ */

/** Where a strike's motion comes from. This is the whole design in one
 * enum: pick the source, and the pose writers follow from it. */
export type Source =
  /** Push off the rear leg, hips square up behind a straight line. */
  | 'linear'
  /** Rotate the pelvis hard, the striking limb swings in an arc. */
  | 'rotation'
  /** Drop the whole body's weight down through the contact point. */
  | 'drop'
  /** Rise through the legs, everything travels upward. */
  | 'lift'

/**
 * A full-body strike pose, assembled in chain order.
 *
 * ```ts
 * chain('linear', 'right', {
 *   drive: 0.9,        // pelvis/chest commitment
 *   travel: 4,         // rootX forward
 *   sink: -1.5,        // rootY (negative = up)
 *   leadFoot: [16, 43],
 *   rearFoot: [-17, 45],
 *   fist: [39, -3],    // relative to shoulder
 *   offFist: [-4, 8],  // the non-striking hand, pulled the other way
 * })
 * ```
 */
export function chain(
  source: Source,
  strike: StrikeHand,
  o: {
    /** how hard the hips/chest commit, 0..1.5 */
    drive?: number
    /** rootX forward, rig units */
    travel?: number
    /** rootY offset; negative = the body rises */
    sink?: number
    /** rootRot total lean toward the strike */
    lean?: number
    leadFoot?: readonly [number, number]
    rearFoot?: readonly [number, number]
    /** striking fist relative to its shoulder */
    fist?: readonly [number, number]
    /** the OTHER hand, relative to its shoulder — counter-motion */
    offFist?: readonly [number, number]
    /** extra spine/head curl, radians */
    curl?: number
    /** depth: how far the strike travels toward the camera */
    depth?: number
  } = {},
): PoseInput {
  const d = o.drive ?? 0.8
  const lead = strike
  const rear: StrikeHand = strike === 'right' ? 'left' : 'right'
  const off = rear
  const sign = strike === 'right' ? 1 : -1

  // The source decides how the drive is distributed. A rotation uses
  // pelvis yaw as its primary mover; a linear drive squares the hips less
  // and pushes the root instead; a drop spends its budget on rootY.
  const pelvisYaw = (source === 'rotation' ? -1.45 : source === 'linear' ? 0.85 : 0.55) * d * sign
  const chestYaw = (source === 'rotation' ? 1.30 : source === 'linear' ? -1.05 : -0.45) * d * sign
  // PROJECTED TRAVEL is what the player sees. Authored units are rig units
  // and the rig renders at SCALE 1.32, so a 4-unit travel is barely 5px —
  // which is why the first pass of this re-composition looked like a statue
  // with a moving arm. These multipliers buy real silhouette movement.
  // travel is measured from the guard's resting offset, not from zero
  const TRAVEL_GAIN = 3.9
  const rootX = STANCE_BACK + (o.travel ?? (source === 'drop' ? 2 : source === 'linear' ? 5 : 4)) * TRAVEL_GAIN
  const rootY = 5.5 + (o.sink ?? (source === 'drop' ? 3.5 : source === 'lift' ? -2.5 : 0.5)) * 1.9
  const rootRot = (o.lean ?? 0.16) + (source === 'drop' ? 0.14 : source === 'lift' ? -0.10 : 0.06)
  // THE HEAD COMMITS. It points down the strike line (positive head here
  // means the skull pitches back toward the target), which is what sells
  // intent: the body is being thrown AT something, not just moved.
  const headLead = 0.26 + 0.20 * d + (source === 'drop' ? 0.30 : source === 'lift' ? -0.16 : 0.10)

  const leadFoot = o.leadFoot ?? [13, 44]
  const rearFoot = o.rearFoot ?? [-13, 45]

  return {
    rootX, rootY, rootRot,
    spine: (source === 'drop' ? 0.24 : source === 'rotation' ? 0.10 : 0.06) + (o.curl ?? 0),
    head: -0.13 + headLead + (o.curl ?? 0) * 0.8,
    pelvisYaw,
    chestYaw,
    ...footAt(lead, leadFoot[0], leadFoot[1]),
    ...footAt(rear, rearFoot[0], rearFoot[1]),
    // depth: the whole girdle opens toward the camera on the way through
    armLz: (strike === 'left' ? 1 : -1) * (o.depth ?? 0.10),
    armRz: (strike === 'right' ? 1 : -1) * (o.depth ?? 0.10),
    ...fistAt(strike, o.fist?.[0] ?? 34, o.fist?.[1] ?? -2),
    ...fistAt(off, o.offFist?.[0] ?? -6, o.offFist?.[1] ?? 7),
    foreRz: strike === 'right' ? (o.depth ?? 0.10) : -0.05,
    foreLz: strike === 'left' ? (o.depth ?? 0.10) : -0.05,
  }
}

/** A chamber: the opposite of a strike. Everything draws BACK and DOWN,
 * coiling away from where the strike will go. Held long enough to read. */
export function chamber(
  source: Source,
  strike: StrikeHand,
  o: { coil?: number; sink?: number; travel?: number } = {},
): PoseInput {
  const c = o.coil ?? 1
  const sign = strike === 'right' ? 1 : -1
  const rear: StrikeHand = strike === 'right' ? 'left' : 'right'
  return {
    rootX: STANCE_BACK - (o.travel ?? 2) * c,
    rootY: 5.5 + (o.sink ?? (source === 'drop' ? -2.5 : 2.2)) * c,
    rootRot: 0.12 + 0.10 * c,
    spine: -0.04 * c,
    // the chin tucks as the body coils — but not to the same place the
    // strike will go, so the snap of the head reads on the way out
    head: -0.30 - 0.04 * c,
    pelvisYaw: (source === 'rotation' ? 0.55 : -0.35) * c * sign,
    chestYaw: (source === 'rotation' ? -0.60 : 0.45) * c * sign,
    ...footAt(strike, 10, 44.5),
    ...footAt(rear, -15, 45.5),
    armLz: strike === 'left' ? -0.25 * c : 0.05,
    armRz: strike === 'right' ? -0.25 * c : 0.05,
    ...fistAt(strike, 11, 7 + 2 * c),
    ...fistAt(rear, 10, 4),
    foreRz: 0.15 * c, foreLz: -0.02,
  }
}

/** Contact. The strike's full extension, and the frame the hitbox opens
 * on. Distinct from `chain` only in that it is authored to be an extreme,
 * held pose — the one frame the player is meant to read. */
export function contact(
  source: Source,
  strike: StrikeHand,
  o: Parameters<typeof chain>[2] = {},
): PoseInput {
  return chain(source, strike, o)
}

/** The recovery pose: weight has arrived, the limb relaxes, the body
 * settles onto the lead leg. Never a snap straight back to stance. */
export function recover(strike: StrikeHand, o: { settle?: number } = {}): PoseInput {
  const s = o.settle ?? 1
  const rear: StrikeHand = strike === 'right' ? 'left' : 'right'
  return {
    ...stance(strike),
    rootX: STANCE_BACK + 4.5 * s,
    rootY: 5.5 + 0.8 * s,
    rootRot: 0.14,
    pelvisYaw: (strike === 'right' ? 0.10 : -0.10) * s,
    chestYaw: (strike === 'right' ? -0.12 : 0.12) * s,
    ...fistAt(strike, 20, 3),
    ...fistAt(rear, 9, 5),
  }
}

/* ------------------------------------------------------------------ */
/* diagnostics                                                         */
/* ------------------------------------------------------------------ */

/** Report which body groups a resolved key actually moves, relative to the
 * stance. Used by `.qa/full-body.ts` to prove the choreography uses the
 * whole body instead of asserting it in a comment. */
export function activeGroups(key: PoseInput, base: PoseInput): string[] {
  const groups: Record<string, (keyof typeof CH)[]> = {
    root: ['rootX', 'rootY', 'rootRot'],
    pelvis: ['pelvisYaw'],
    chest: ['chestYaw', 'spine'],
    head: ['head'],
    legL: ['hipL', 'kneeL', 'footL'],
    legR: ['hipR', 'kneeR', 'footR'],
    armL: ['shL', 'elL', 'armLz', 'foreLz'],
    armR: ['shR', 'elR', 'armRz', 'foreRz'],
  }
  const out: string[] = []
  for (const [name, chs] of Object.entries(groups)) {
    for (const ch of chs) {
      const a = key[ch] as number | undefined
      const b = base[ch] as number | undefined
      if (a === undefined) continue
      if (Math.abs(a - (b ?? 0)) > 0.10) { out.push(name); break }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* kicking                                                             */
/* ------------------------------------------------------------------ */

/**
 * A kick CHAMBER: the knee is up and folded, the foot is still near the
 * body. Authored as knee flexion on top of a hip solve, because that is
 * what a chamber physically is — the target is the knee, not the foot.
 *
 * `fwd`/`up` are the KNEE's position relative to the hip.
 */
export function kickChamber(side: StrikeHand, fwd: number, up: number): PoseInput {
  const hip = Math.atan2(fwd, up) + 1.15
  return side === 'left'
    ? { hipL: hip, kneeL: -2.15, footL: 1.15 }
    : { hipR: hip, kneeR: -2.15, footR: 1.15 }
}

/**
 * A kick EXTENSION: the shin swings out to the target and the toe points
 * along the shin. `fwd`/`up` are the ANKLE's position relative to the hip
 * — note `up` is negative for anything above hip height, which is the
 * whole point of a high kick.
 */
export function kickExtend(side: StrikeHand, fwd: number, up: number): PoseInput {
  const base = footAt(side, fwd, Math.max(6, up))
  // foot: point the toe along the shin (1.3 x shin angle reproduces a
  // pointed foot through the FK toe equation)
  const hip = side === 'left' ? base.hipL! : base.hipR!
  const knee = side === 'left' ? base.kneeL! : base.kneeR!
  const foot = 1.3 * (hip + knee)
  return side === 'left' ? { ...base, footL: foot } : { ...base, footR: foot }
}
