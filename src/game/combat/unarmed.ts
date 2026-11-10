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
  MOVES, UNARMED_PARRY_CLIP, UNARMED_CHARGE_CLIP, UNARMED_GUARD,
  handPose, UNARMED_ULT, UNARMED_FLOURISH_CLIP,
  type StrikeHand,
} from './moveset'

export { handPose, UNARMED_PARRY_CLIP as UNARMED_PARRY, UNARMED_CHARGE_CLIP as UNARMED_CHARGE,
  UNARMED_GUARD, UNARMED_ULT, UNARMED_FLOURISH_CLIP }
export type { StrikeHand }

const cache = new Map<string, AttackDef>()

/** Map a sword AttackDef onto its empty-hand counterpart.
 * Unknown ids fall back to a re-labeled jab clone that preserves the
 * base's kind/requires/chain so no future attack can ever strand the
 * sheathed stance without a working animation. */
export function unarmedAttack(base: AttackDef): AttackDef {
  if (base.strikeHand) return base
  const mv = MOVES[base.id]
  if (mv) { cache.set(base.id, mv); return mv }
  const cached = cache.get(base.id)
  if (cached) return cached
  const generic = MOVES.l1
  const def: AttackDef = {
    ...generic,
    id: base.id,
    label: generic.label,
    kind: base.kind,
    requires: base.requires,
    chain: base.chain,
  }
  cache.set(base.id, def)
  return def
}
