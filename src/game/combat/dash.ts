/** STICKMAN RISING — the CONDITIONED DASH ACTIVATION SYSTEM.
 *
 * One movement — the dash — driven by NINE distinct authored animations.
 * The variant is not picked by a single input direction: the system
 * evaluates the full tactical context AT THE INPUT INSTANT and activates
 * the animation whose pose, timing, and silhouette express that situation:
 *
 *   ┌─ C1 AIRBORNE?                 → air family
 *   ├─ C2 INPUT vs FACING (dot)     → forward / backward / neutral / up
 *   ├─ C3 MOMENTUM at initiation    → stationary vs stride vs drive
 *   ├─ C4 THREAT GEOMETRY           → pocket (<170) / hunt (240–640) /
 *   │                                surrounded / none
 *   └─ C5 CHAIN count               → mirrored stride on the second dash
 *
 * Reference silhouettes (see clips.ts DASH LIBRARY header for the full
 * keyframe credits): MGR:R Raiden dash, Sword of the Stranger iai-dash,
 * Naruto shunshin carry, Sekiro Shadowrush pass, the fencing lunge/drive,
 * Nier:Automata evade carve.
 */

import { Clip } from '../anim/animator'
import {
  DASH_LAUNCH_CLIP, DASH_CHAIN_CLIP, DASH_CARRY_CLIP, DASH_HUNT_CLIP,
  DASH_PIERCE_CLIP, DASH_RETREAT_CLIP, DASH_VAULT_CLIP, DASH_AIR_CLIP,
  DASH_CARVE_CLIP,
} from '../anim/clips'

export type DashVariant =
  | 'launch'  // iai explosion from a standing start
  | 'chain'   // mirrored stride: the second chained dash
  | 'carry'   // momentum-matched: initiated from run/sprint
  | 'hunt'    // gap-close hunger: target ahead at 240–640
  | 'pierce'  // pass-through lunge: target inside the pocket (<170)
  | 'retreat' // guarded retreat: backdash with the guard on the threat
  | 'vault'   // vertical escape
  | 'carve'   // surrounded breakaway: the depth-carve roll
  | 'air'     // airborne scissor

/** The tactical snapshot evaluated at the input instant. Built by the
 * player from live world state — the evaluator itself is a pure function
 * (trivially unit-checkable, no hidden couplings). */
export interface DashConditions {
  grounded: boolean
  /** normalized input vector (already default-resolved toward facing) */
  dx: number
  dy: number
  /** current facing at the input instant */
  face: 1 | -1
  /** |vx| at initiation — the momentum the dash must match */
  speed: number
  /** a live enemy sits INSIDE the melee pocket ahead (<170) */
  pocketTarget: boolean
  /** a live enemy sits in the gap-close band ahead (240–640) */
  huntTarget: boolean
  /** enemies within combat radius on BOTH sides */
  surrounded: boolean
  /** damped enemy-proximity weight (0..1, hysteresis) */
  enemyNearW: number
  /** dashes already fired inside the chain window */
  chain: number
}

/** Variant resolution — priority ladder:
 *  1. airborne                      → air
 *  2. up/neutral-while-pocketed     → carve (break OUT of the pocket)
 *  3. vertical escape               → vault
 *  4. retreating input              → carve (pocketed) / retreat
 *  5. neutral while pocketed        → carve
 *  6. threat variants (fwd input)   → pierce (inside) / hunt (approaching)
 *  7. chained second dash           → chain (mirrored stride)
 *  8. momentum-matched              → carry (from run/sprint)
 *  9. otherwise                     → launch (the iai explosion) */
export function evaluateDash(c: DashConditions): DashVariant {
  if (!c.grounded) return 'air'
  const horiz = Math.abs(c.dx)
  const dot = c.dx * c.face // −1 = input directly opposes facing
  const pocket = c.surrounded && c.enemyNearW > 0.5
  // vertical family: near-zero horizontal intent with strong UP input
  if (horiz < 0.4 && c.dy < -0.5) return pocket ? 'carve' : 'vault'
  // retreating family: input opposes the facing — the guard stays on the
  // threat; pocketed retreats carve out instead of backing into steel
  if (dot < -0.35) return pocket ? 'carve' : 'retreat'
  // neutral dash inside the pocket → breakaway
  if (pocket && horiz < 0.4) return 'carve'
  // forward family — conditioned by THREAT GEOMETRY first (the enemy
  // decides), then chain mirroring, then momentum matching:
  if (dot > 0.35) {
    // an enemy already INSIDE the blade pocket → pierce THROUGH the body
    if (c.pocketTarget) return 'pierce'
    // an enemy in the gap-close band → the hungry hunting lunge
    if (c.huntTarget) return 'hunt'
  }
  // the chained second dash mirrors the stride (spam reads as alternating
  // drives, not a loop)
  if (c.chain >= 1) return 'chain'
  // initiated from real momentum → carry the stride (no re-coil)
  if (c.speed >= 200) return 'carry'
  // from a standstill (or a slow walk) → the explosive iai launch
  return 'launch'
}

export interface DashVariantCfg {
  /** the authored clip */
  clip: Clip
  /** dash state duration (s) */
  dur: number
  /** speed multiplier on the base DASH_SPEED */
  spd: number
  /** i-frame seconds */
  iframes: number
  /** animator entry crossfade (s) — momentum-matched entries blend longer */
  blend: number
  /** velocity envelope: fraction of the dash held at full speed before the
   *  quadratic tail bleed (hunt/pierce sustain; launch bleeds immediately) */
  sustain: number
  /** audio pitch band [lo, hi] */
  pitch: [number, number]
  /** camera trauma on entry */
  trauma: number
  /** chroma aberration strength on entry */
  chroma: number
}

/** Base dash speed — the variant multipliers shape the feel (hunt is
 * hungrier than retreat; carry rides existing momentum). */
export const DASH_SPEED = 980

export const DASH_VARIANTS: Record<DashVariant, DashVariantCfg> = {
  launch: {
    clip: DASH_LAUNCH_CLIP, dur: 0.17, spd: 1.0, iframes: 0.12, blend: 0.035,
    sustain: 0, pitch: [0.95, 1.1], trauma: 0.06, chroma: 0.35,
  },
  chain: {
    clip: DASH_CHAIN_CLIP, dur: 0.16, spd: 1.06, iframes: 0.12, blend: 0.035,
    sustain: 0, pitch: [1.0, 1.12], trauma: 0.06, chroma: 0.5,
  },
  carry: {
    clip: DASH_CARRY_CLIP, dur: 0.19, spd: 1.08, iframes: 0.11, blend: 0.09,
    sustain: 0.3, pitch: [1.0, 1.12], trauma: 0.05, chroma: 0.35,
  },
  hunt: {
    clip: DASH_HUNT_CLIP, dur: 0.21, spd: 1.16, iframes: 0.13, blend: 0.04,
    sustain: 0.55, pitch: [0.88, 0.98], trauma: 0.07, chroma: 0.45,
  },
  pierce: {
    clip: DASH_PIERCE_CLIP, dur: 0.18, spd: 1.1, iframes: 0.14, blend: 0.035,
    sustain: 0.5, pitch: [0.92, 1.0], trauma: 0.07, chroma: 0.5,
  },
  retreat: {
    clip: DASH_RETREAT_CLIP, dur: 0.15, spd: 0.92, iframes: 0.12, blend: 0.05,
    sustain: 0, pitch: [1.12, 1.26], trauma: 0.03, chroma: 0.35,
  },
  vault: {
    clip: DASH_VAULT_CLIP, dur: 0.18, spd: 0.8, iframes: 0.13, blend: 0.05,
    sustain: 0, pitch: [1.18, 1.3], trauma: 0.04, chroma: 0.35,
  },
  carve: {
    clip: DASH_CARVE_CLIP, dur: 0.2, spd: 0.96, iframes: 0.16, blend: 0.055,
    sustain: 0.15, pitch: [0.82, 0.92], trauma: 0.1, chroma: 0.55,
  },
  air: {
    clip: DASH_AIR_CLIP, dur: 0.15, spd: 1.0, iframes: 0.1, blend: 0.06,
    sustain: 0, pitch: [1.05, 1.15], trauma: 0.04, chroma: 0.35,
  },
}

/** dash velocity envelope — entry burst → sustain plateau → quadratic tail
 * bleed. `sustain` = fraction held at full speed. */
export function dashEnvelope(k: number, sustain: number): number {
  const s = Math.min(Math.max(sustain, 0), 0.95)
  const tail = s < 1 ? Math.max(0, (k - s) / (1 - s)) : 0
  return 1 - 0.42 * tail * tail
}
