/** STICKMAN RISING — the CONDITIONED DASH ACTIVATION SYSTEM.
 *
 * One movement — the dash — driven by TEN distinct authored animations.
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
 * momentum carry, Sekiro Shadowrush pass, the fencing lunge/drive,
 * Nier:Automata evade carve.
 */

import { Clip } from '../anim/animator'
import {
  DASH_PIVOT_CLIP, DASH_LAUNCH_CLIP, DASH_CHAIN_CLIP, DASH_CARRY_CLIP, DASH_HUNT_CLIP,
  DASH_PIERCE_CLIP, DASH_RETREAT_CLIP, DASH_VAULT_CLIP, DASH_AIR_CLIP,
  DASH_CARVE_CLIP,
} from '../anim/clips'

export type DashVariant =
  | 'pivot'  // incoming momentum opposes intent: brace, reverse, drive
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
  /** Signed velocity projected along dash intent (negative = reversal). */
  forwardMomentum?:number
  /** a live enemy sits INSIDE the melee pocket ahead (<170) */
  pocketTarget: boolean
  /** a live enemy sits in the gap-close band ahead (240–640) */
  huntTarget: boolean
  /** enemies within combat radius on BOTH sides */
  surrounded: boolean
  /** damped enemy-proximity weight (0..1, hysteresis) */
  enemyNearW: number
  /** Threat behind the selected travel direction, sampled immediately. */
  rearTarget?:boolean
  /** dashes already fired inside the chain window */
  chain: number
}

/** Variant resolution — priority ladder:
 *  1. airborne                      → air
 *  2. up/neutral-while-pocketed     → carve (break OUT of the pocket)
 *  3. vertical escape               → vault
 *  4. retreating input              → carve (pocketed) / retreat
 *  5. neutral while pocketed        → carve
 *  6. opposite incoming momentum   → pivot (physical brace/reversal)
 *  7. threat variants (fwd input)   → pierce (inside) / hunt (approaching)
 *  8. chained second dash           → chain (mirrored stride)
 *  9. momentum-matched              → carry (from run/sprint)
 * 10. otherwise                     → launch (the iai explosion) */
export function evaluateDash(c: DashConditions): DashVariant {
  if (!c.grounded) return 'air'
  const horiz = Math.abs(c.dx)
  const dot = c.dx * c.face // −1 = input directly opposes facing
  const pocket = c.surrounded
  // vertical family: near-zero horizontal intent with strong UP input
  if (horiz < 0.4 && c.dy < -0.5) return pocket ? 'carve' : 'vault'
  // retreating family: input opposes the facing — the guard stays on the
  // threat; pocketed retreats carve out instead of backing into steel
  if (dot < -0.35) return pocket ? 'carve' : 'retreat'
  if(pocket&&horiz>=.4)return 'carve'
  // A pursuing enemy gets a fleeing drive, rather than an idle launch.
  if(c.rearTarget&&!c.pocketTarget&&!c.huntTarget&&dot>.35)return 'hunt'
  // neutral dash inside the pocket → breakaway
  if (pocket && horiz < 0.4) return 'carve'
  if((c.forwardMomentum??0)<-180&&horiz>.4)return 'pivot'
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
  /** Fraction of state spent visibly loading before the burst (forward family). */
  anticipation?: number
  /** Independent motor pulse: longer visible acting must not dilute thrust. */
  driveDuration?:number
  /** Ground recovery deceleration in world px/s² (contact braking force / mass). */
  catchBrake?: number
  /** audio pitch band [lo, hi] */
  pitch: [number, number]
  /** camera trauma on entry */
  trauma: number
  /** chroma aberration strength on entry */
  chroma: number
}

/** Base dash speed — the variant multipliers shape the feel (hunt is
 * hungrier than retreat; carry rides existing momentum). */
export const DASH_SPEED = 900

export const DASH_VARIANTS: Record<DashVariant, DashVariantCfg> = {
  pivot:{clip:DASH_PIVOT_CLIP,dur:.29,spd:1,iframes:.12,blend:.035,
    anticipation:.22,catchBrake:4300,pitch:[.75,.98],trauma:.18,chroma:.55},
  launch: {
    catchBrake:1400, driveDuration:.095,
    clip: DASH_LAUNCH_CLIP, dur: 0.27, spd: 1.15, iframes: 0.12, blend: 0.018,
    anticipation: .02, pitch: [0.85, 1.25], trauma: 0.22, chroma: .55,
  },
  chain: {
    catchBrake:1400, driveDuration:.095,
    clip: DASH_CHAIN_CLIP, dur: 0.265, spd: 1.22, iframes: 0.12, blend: 0.018,
    anticipation: .02, pitch: [0.90, 1.35], trauma: 0.20, chroma: .65,
  },
  carry: {
    catchBrake:1200, driveDuration:.095,
    clip: DASH_CARRY_CLIP, dur: 0.26, spd: 1.20, iframes: 0.11, blend: 0.022,
    anticipation: .02, pitch: [0.90, 1.35], trauma: 0.18, chroma: .55,
  },
  hunt: {
    catchBrake:1400, driveDuration:.10,
    clip: DASH_HUNT_CLIP, dur: 0.28, spd: 1.28, iframes: 0.13, blend: 0.022,
    anticipation: .02, pitch: [0.75, 1.25], trauma: 0.25, chroma: .65,
  },
  pierce: {
    catchBrake:3000,
    clip: DASH_PIERCE_CLIP, dur: 0.25, spd: 1.1, iframes: 0.14, blend: 0.022,
    anticipation: .1, pitch: [0.80, 1.20], trauma: 0.22, chroma: .65,
  },
  retreat: {
    catchBrake:9000,
    clip: DASH_RETREAT_CLIP, dur: 0.15, spd: 0.92, iframes: 0.12, blend: 0.05,
    pitch: [1.0, 1.45], trauma: 0.12, chroma: .55,
  },
  vault: {
    clip: DASH_VAULT_CLIP, dur: 0.18, spd: 0.8, iframes: 0.13, blend: 0.05,
    pitch: [1.05, 1.45], trauma: 0.15, chroma: .55,
  },
  carve: {
    catchBrake:6500,
    clip: DASH_CARVE_CLIP, dur: 0.2, spd: 0.96, iframes: 0.16, blend: 0.055,
    anticipation: .1, pitch: [0.75, 1.15], trauma: 0.20, chroma: .75,
  },
  air: {
    clip: DASH_AIR_CLIP, dur: 0.15, spd: 1.0, iframes: 0.1, blend: 0.06,
    pitch: [0.95, 1.45], trauma: 0.15, chroma: .55,
  },
}