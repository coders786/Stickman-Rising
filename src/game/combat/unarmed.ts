/** STICKMAN RISING — empty-hand ATTACK MAPPING layer.
 *
 * The moveset itself (30 unique full-body animations, IK-authored
 * contacts, command branches) lives in `moveset.ts`. This module keeps
 * the historical player-facing API: `unarmedAttack(base)` swaps any
 * sword AttackDef for its empty-hand equivalent the moment the blade is
 * sheathed — the dual-stance contract ("fists never draw steel") is
 * pinned by tests/dual-stance.test.ts and preserved here:
 *   · the returned def ALWAYS carries `strikeHand` (visible-limb hitbox)
 *   · grip 0 — no blade arc, no slash trail, no hidden weapon
 *   · triggers, chain topology and requires are inherited per-mapping
 */
import type { AttackDef } from './attacks'
import {
  MOVES, UNARMED_PARRY_CLIP, UNARMED_PUNCH_CHARGE_CLIP, UNARMED_KICK_CHARGE_CLIP, UNARMED_GUARD,
  handPose, UNARMED_ULT, UNARMED_FLOURISH_CLIP,
  type StrikeHand,
} from './moveset'

export { handPose, UNARMED_PARRY_CLIP as UNARMED_PARRY,
  UNARMED_PUNCH_CHARGE_CLIP as UNARMED_PUNCH_CHARGE, UNARMED_KICK_CHARGE_CLIP as UNARMED_KICK_CHARGE,
  UNARMED_GUARD, UNARMED_ULT, UNARMED_FLOURISH_CLIP }
/** Stable compatibility binding. A local const avoids Turbopack's stale
 * cross-module re-export identity when the charge clips are hot-replaced. */
export const UNARMED_CHARGE = UNARMED_KICK_CHARGE_CLIP
export type { StrikeHand }
export const CHARGED_PUNCH = MOVES.chargedPunch
export const CHARGED_KICK = MOVES.chargedKick

const cache = new Map<string, AttackDef>()

/* ------------------------------------------------------------------ */
/* FORWARD TRAVEL — the thing the reference sheets do on every frame   */
/* ------------------------------------------------------------------ */

/** How hard each empty-hand strike steps in.
 *
 * All seven uploaded sheets put the fighter *slightly further right on
 * every single frame* (measured: ~5px/frame, `.qa/ref-motion.ts`). Nothing
 * in them is ever a stationary turret. Ours was: every `unarmed*` def had
 * `moveX: undefined`, so measured root advance was **0.0px for l1..l5** and
 * the feet instead slid forward in local space under a pinned root — a
 * treadmill. That single missing channel is why a combo falls apart: the
 * grunt starts at 34px, strike 1 shoves it out, and because the player
 * never closes, strikes 3-5 open their windows outside hand reach.
 *
 * The value is the *speed* the drive motor targets (`vx`, px/s), matching
 * the sword kit's scale (`l1` is 150 with no drive, `l3` is 110).
 *
 * MEASURED (`.qa/tmp/sweep.ts`, acc 2400, the drive duration below):
 *
 *     moveX  d0.08   d0.10   d0.12   d0.14      <- advance, px
 *      120    14.2    16.2    19.2    22.2
 *      160    15.9    23.1    27.1    31.1
 *      200    15.9    24.0    33.4    39.7
 *      260+   15.9    24.0    33.4    43.1
 *
 * Two facts fall out of that table and they are why this is tuned, not
 * guessed. **(1) Duration is the lever, magnitude is only the ceiling** —
 * past ~200px/s the drive saturates and adding more `moveX` changes
 * nothing. **(2) The motor brakes at 900px/s² the whole time**
 * (`brakeVelocity` in `updateAttack`), so the step is v²/1800-ish and dies
 * fast; a strike cannot travel far no matter what it is told.
 *
 * So the budget is a *sum over the string*. A light string's job is to
 * hold a body at 34px, not to outrun it: ~16-25px per strike, with the
 * finisher taking the big step that actually catches a pushed body.
 */
const UNARMED_STEP: Record<string, number> = {
  // the two jabs: a lead-hand poke off a planted base. Smallest step.
  l1: 130, l2: 150,
  // the cross: rear foot pivots, hips drive through. This is the strike
  // that must CATCH what the jabs pushed away, so it steps hardest of the
  // three lights.
  l3: 200,
  // the hook: rotation, not travel. It shoulders in for the shortening.
  l4: 165,
  // the overhead finisher: the committed step.
  l5: 210,
  h1: 175, h2: 185, h3: 200,
  launcher: 170, spin: 160, retreat: -170,
  powerPunch: 210, powerArc: 195, ironRoot: 175, cyclone: 185,
  sakugaJabCross: 185, sakugaHammer: 195,
}
/** Default for any unarmed id not named above — a straight, committed
 *  step. Unknown ids still advance, so no future move can be a turret. */
const UNARMED_STEP_DEFAULT = 165

/** How long the drive motor runs. This — not `moveX` — is what sets the
 *  distance travelled (see the table above).
 *
 *  It is a FRACTION of the clip, not a fixed time, and that matters: a
 *  heavy's wind-up is 0.16-0.20s, so a 0.12s drive that starts at its
 *  ignition beat has spent itself before the fist is even forward. h1's
 *  window (0.16-0.28) found the body still 16px outside reach at aT 0.25
 *  and only closed by aT 0.42 -- after the window had shut. Deriving the
 *  span from the clip keeps the step proportional: a jab steps short and
 *  quick, a finisher steps through its whole wind-up and lands on time.
 *
 *  Clamped so it can never eat the recovery beat (which is what lets the
 *  next strike in a string start from a planted base). */
const UNARMED_DRIVE_FRAC = 0.55
const UNARMED_DRIVE_MIN = 0.10
const UNARMED_DRIVE_MAX = 0.24
const UNARMED_DRIVE_ACCEL = 2400

/** Hard ceiling on how far ONE strike may carry the player, in px.
 *
 *  This is the string's budget, not the strike's: a standoff is ~34px and
 *  a 5-hit light string must stay in front of a body it is hitting rather
 *  than striding past it. Nothing separates the player's body from an
 *  enemy's (there is no collision solver), so an over-long step walks
 *  straight through the target. Measured before this cap: `l5` travelled
 *  55.7px -- and the real advance is a little under `moveX * driveDur`
 *  because the motor starts from rest. 34px per strike is exactly the
 *  standoff, so even a whole string can only close to zero, never past. */
// The range-aware standoff clamp in Player prevents overrun. A 40px ceiling
// gives dramatic retro silhouettes enough body travel to put the *real limb*
// on the opponent instead of solving short anatomy with invisible padding.
const UNARMED_STEP_PX_MAX = 40

/** The step is injected on the ignition beat, just as the fist fires —
 *  the same timing the sword kit uses (`moveXAt` ≈ contact minus a frame).
 *  `groundDrive` makes it a finite, accelerating push instead of an
 *  instant teleport, so the body leans into the step and stops. */
function applyStep(def: AttackDef, base: AttackDef): AttackDef {
  if (def.moveX !== undefined) return def
  const step = UNARMED_STEP[def.id] ?? UNARMED_STEP_DEFAULT
  const at = Math.max(0, (def.hit?.start ?? 0.12) - 0.03)
  const dur = Math.max(UNARMED_DRIVE_MIN,
    Math.min(UNARMED_DRIVE_MAX, (def.clip?.dur ?? 0.3) * UNARMED_DRIVE_FRAC))
  // Distance is speed x drive-duration (approx -- the motor starts from
  // rest), so cap the SPEED by what this strike's drive span can cover.
  const speed = Math.min(step, UNARMED_STEP_PX_MAX / dur)
  return {
    ...def,
    moveX: speed,
    moveXAt: at,
    groundDrive: { duration: dur, acceleration: UNARMED_DRIVE_ACCEL },
  }
}

/** Map a sword AttackDef onto its empty-hand counterpart.
 * Unknown ids fall back to a re-labeled jab clone that preserves the
 * base's kind/requires/chain so no future attack can ever strand the
 * sheathed stance without a working animation. */
export function unarmedAttack(base: AttackDef): AttackDef {
  if (base.strikeHand) return base
  const mv = MOVES[base.id]
  if (mv) {
    const stepped = applyStep(mv, base)
    // Only cache when we did not allocate (the moveset defs are shared).
    if (stepped === mv) cache.set(base.id, mv)
    return stepped
  }
  const cached = cache.get(base.id)
  if (cached) return cached
  const generic = MOVES.l1
  const def = applyStep({
    ...generic,
    id: base.id,
    label: generic.label,
    kind: base.kind,
    requires: base.requires,
    chain: base.chain,
  } as AttackDef, base)
  cache.set(base.id, def)
  return def
}
