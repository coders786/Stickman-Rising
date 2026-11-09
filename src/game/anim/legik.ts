/** STICKMAN RISING — GROUND-CONTACT LEG IK + GAIT PLANNER (legik).
 *
 * THE FOOT-PLANTING LAYER. FK-authored leg angles — however carefully
 * keyframed — can never guarantee the sole lands exactly on the ground
 * line: diagonal contact struts end 10–17 local units above the floor,
 * sine-based procedural walks end 5–30 units above, and blended
 * transitions sweep feet through the floor. This module replaces "feet
 * wherever the angles land" with "feet where FEET GO":
 *
 *   · GaitPlanner — a real gait state machine per biped. Each leg owns a
 *     normalized step phase [0,1): STANCE (foot world-LOCKED at its
 *     footfall anchor, flat on the ground, heel-lifting to toe-off) and
 *     SWING (foot rides a clearance arc from the old anchor to a velocity-
 *     predicted landing spot). Stride length derives from actual world
 *     velocity ÷ step cadence — planted feet never skate.
 *   · solveLegIK — analytic 2-bone IK (law of cosines) that re-solves
 *     knee/ankle joints from the femur head to the planner's ankle target.
 *     The knee always bends FORWARD (the human knee does), so every solved
 *     pose is anatomically valid regardless of gait, speed or blend state.
 *
 * The result: contact feet sit EXACTLY on the ground line (never floating,
 * never digging), swing feet ride believable arcs, strides alternate, and
 * the trailing leg shows a real extended toe-off instead of a tucked
 * hover-leg — in EVERY animation, because it is solved per-frame from the
 * actual body state, not keyframed.
 *
 * Space conventions: foot targets live in WORLD space (anchors are
 * world-locked; y=0 is the ground line, negative = above). The caller
 * converts world → character-local (local +X = facing) before/after IK;
 * the knee-forward bend assumes local facing space.
 */

import { clamp, clamp01, damp, lerp } from '../core/utils'

/* ------------------------------------------------------------------ */
/* 2-bone analytic IK                                                  */
/* ------------------------------------------------------------------ */

export interface LegIKOut {
  /** solved knee position (same space as inputs) */
  kx: number
  ky: number
  /** solved ankle (target, reach-clamped toward the hip) */
  ax: number
  ay: number
  /** true when the target was out of reach and got pulled closer */
  clamped: boolean
}

/**
 * Solve knee + ankle for a 2-bone leg. Inputs are in the caller's working
 * space; `bend` = +1 puts the knee on the +X side of the hip→ankle line
 * (knee-forward in facing-local space), −1 behind.
 *
 * Law of cosines: with d = |hip→ankle|,
 *   α = acos((l1² + d² − l2²) / (2·l1·d)) — angle at the hip between the
 *       direct line and the femur
 *   θ₁ = base − bend·α                    — femur direction
 * The knee lands at hip + l1·(cosθ₁, sinθ₁); the ankle lands on the
 * (possibly reach-clamped) target.
 */
export function solveLegIK(
  hx: number, hy: number,
  tx: number, ty: number,
  l1: number, l2: number,
  bend: 1 | -1 = 1,
  out?: LegIKOut,
): LegIKOut {
  if (!Number.isFinite(l1) || !Number.isFinite(l2) || l1 <= 0 || l2 <= 0) throw new RangeError('Leg lengths must be finite and positive')
  const o = out ?? { kx: 0, ky: 0, ax: 0, ay: 0, clamped: false }
  let dx = tx - hx
  let dy = ty - hy
  let d = Math.hypot(dx, dy)
  // Knee flexion constrained to 10–155 degrees, including unreachable
  // and coincident targets. A straight locked knee is not a valid plant.
  const dMax = Math.sqrt(l1*l1 + l2*l2 + 2*l1*l2*Math.cos(.17))
  const dMin = Math.sqrt(l1*l1 + l2*l2 + 2*l1*l2*Math.cos(2.71))
  const invalidTarget = !Number.isFinite(d)
  if (invalidTarget) { dx = 0; dy = dMax; d = dMax }
  if (d < 1e-8) { dx = 0; dy = dMin; d = dMin; o.clamped = true }
  o.clamped = invalidTarget || Math.hypot(tx - hx, ty - hy) < dMin
  if (d > dMax) {
    const k = dMax / (d || 1)
    dx *= k
    dy *= k
    d = dMax
    o.clamped = true
  } else if (d < dMin) {
    const k = dMin / (d || 1)
    dx *= k
    dy *= k
    d = dMin
    o.clamped = true
  }
  const base = Math.atan2(dy, dx)
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
  const a = Math.acos(cosA)
  const th1 = base - bend * a
  o.kx = hx + Math.cos(th1) * l1
  o.ky = hy + Math.sin(th1) * l1
  o.ax = hx + dx
  o.ay = hy + dy
  return o
}

/** Max height the femoral head can sit above a ground target at
 * horizontal offset dx with a leg of (l1+l2): the pelvis-height limiter
 * used by the foot-ground lock (the "weight" of the body). Returns a
 * NEGATIVE number (height above the y=0 ground line, canvas y-down). */
export function legVerticalReach(dx: number, l1: number, l2: number, sole: number): number {
  const reach = Math.sqrt(l1*l1 + l2*l2 + 2*l1*l2*Math.cos(.17))
  const h = Math.sqrt(Math.max(0, reach * reach - dx * dx))
  return -(h + sole)
}

/* ------------------------------------------------------------------ */
/* Gait planner                                                        */
/* ------------------------------------------------------------------ */

export interface GaitTuning {
  profile?:'patrol'
  /** stance (foot-on-ground) fraction of the step cycle: walk 0.64,
   * combat 0.55, run 0.40, sprint 0.30 (real duty factors) */
  duty: number
  /** reference stride length (world px per FULL left/right cycle) — cadence = speed/stride */
  stride: number
  /** cadence clamp (full cycles/sec; footfall rate is twice this) */
  cadMin: number
  cadMax: number
  /** swing apex clearance (world px above the planted ankle line) */
  clearance: number
  /** landing offset ahead of the hip along travel dir (world px;
   * negative = lands behind — backpedal) */
  stepAhead: number
  /** ankle rise at full toe-off (world px) */
  lift: number
  /** Parked half-stance width; player martial stances can be wider than enemies. */
  standWidth?: number
}

/** PLANT ENVELOPE — the farthest a footfall may anchor from the femoral
 * head at the moment of plant (world px). ~0.71× the player's stance-leg
 * reach: a plant inside this ring always leaves the hip a load-bearing
 * diagonal strut (hip ≥ ~45px above the floor); a plant outside it is a
 * gait-planner prediction artifact (decelerating strides: the predicted
 * hip travels farther than friction allows) and used to collapse the
 * pelvis onto the ankle line with both knees locked. The consumer-side
 * guard lives in player.updateFootLock; this is the producer-side one. */
const PLANT_ENVELOPE = 46

export const PLAYER_GAIT: Record<string, GaitTuning> = {
  walk:      { profile:'patrol', duty:.60, stride:92, cadMin:.15, cadMax:2.3, clearance:7.5, stepAhead:0, lift:2, standWidth:8 },
  run:       { duty: 0.40, stride: 185, cadMin: 1.2, cadMax: 2.15, clearance: 17, stepAhead: 27,  lift: 10 },
  sprint:    { duty: 0.30, stride: 220, cadMin: 1.65, cadMax: 2.5, clearance: 28, stepAhead: 29,  lift: 14 },
  combat:    { duty: 0.55, stride: 50,  cadMin: 1.6, cadMax: 4.2, clearance: 7,  stepAhead: 11,  lift: 5, standWidth: 20 },
  backpedal: { duty: 0.60, stride: 54,  cadMin: 1.8, cadMax: 4.0, clearance: 7,  stepAhead: -13, lift: 5 },
  idle:      { duty: 1.0,  stride: 60,  cadMin: 0.0, cadMax: 1.0, clearance: 7,  stepAhead: 12,  lift: 5, standWidth: 17 },
}

export const ENEMY_GAIT: GaitTuning = {
  duty: 0.60, stride: 50, cadMin: 0.8, cadMax: 3.4, clearance: 9,
  stepAhead: 14, lift: 6,
}

export interface FootPlan {
  /** ankle target, world space (0 = ground line) */
  x: number
  y: number
  /** foot is load-bearing on the ground this frame */
  planted: boolean
  /** toe pitch −1 (plantarflexed, toe-down) … +1 (dorsiflexed, toe-up) */
  pitch: number
}

/** per-leg gait state */
interface LegState {
  /** world x where this foot planted (locked through stance) */
  anchor: number
  /** last computed swing landing spot (becomes the anchor at footfall) */
  land: number
  /** damped park position while standing */
  park: number
  /** true while the leg is mid-swing (for wrap detection) */
  swinging: boolean
}

export class GaitPlanner {
  /** normalized step phase [0,1) — RIGHT leg; LEFT runs +0.5 */
  phase = 0
  /** steps/second actually driven last update (for clip-speed sync) */
  cadence = 0
  /** true while any foot is load-bearing */
  hasPlanted = false
  /** both feet parked (stand / combat-idle root) */
  standing = true
  /** rising edge per footfall (dust/sfx hooks) */
  footfall = false
  footfallX = 0
  /** cumulative footfall count (latched — pollers can't miss events) */
  footfalls = 0

  readonly footL: FootPlan = { x: 0, y: 0, planted: true, pitch: 0 }
  readonly footR: FootPlan = { x: 0, y: 0, planted: true, pitch: 0 }
  private legs: [LegState, LegState] = [
    { anchor: 0, land: 0, park: 0, swinging: false },
    { anchor: 0, land: 0, park: 0, swinging: false },
  ]
  private seeded = false
  private standW = 1
  private lastProfile:GaitTuning['profile']

  /**
   * Drive the gait for one frame.
   * @param x       femoral midpoint world x
   * @param vx      world horizontal velocity
   * @param face    facing (1 right / −1 left)
   * @param speed   |vx| — the gait cadence derives from it
   * @param tune    gait parameters
   * @param dt      frame dt
   * @param active  gait engaged (grounded + locomotion state). When false
   *                the planner parks both feet into a stand stance.
   * @param sole    ankle ride height above ground when planted (world px —
   *                the caller's foot-sole clearance)
   * @param grounded entity on the ground. When false the planner enters
   *                FREE mode: no planting (airborne feet never claim
   *                contact — the FK clip owns the legs while gaitW blends
   *                out), phase frozen, targets hold their last values.
   */
  update(
    x: number, vx: number, face: 1 | -1, speed: number,
    tune: GaitTuning, dt: number, active: boolean,
    sole: number, grounded = true,
  ): void {
    if (!grounded) {
      this.cadence = 0
      this.footfall = false
      this.standing = false
      this.hasPlanted = false
      this.footL.planted = false
      this.footR.planted = false
      return
    }
    if (!this.seeded) {
      this.seeded = true
      this.legs[0].anchor = this.legs[0].park = x - face * 11
      this.legs[1].anchor = this.legs[1].park = x + face * 11
    }

    // travel direction feet land toward: velocity direction, else facing
    const dir = speed > 30 ? (Math.sign(vx) as 1 | -1) : face
    // below ~8 px/s the gait PARKS into a stand stance (cadMin would
    // otherwise march the figure in place at a full stop)
    const cad = active && speed > 8
      ? clamp(speed / tune.stride, tune.cadMin, tune.cadMax)
      : 0
    this.cadence = cad
    this.footfall = false
    this.standing = cad <= 0.001
    if (!this.standing) this.phase = (this.phase + cad * dt) % 1

    if(!this.standing&&tune.profile==='patrol'&&this.lastProfile!=='patrol'){
      // Entry establishes anchors from CURRENT phase, not old idle feet.
      // Otherwise a first slow step can drag a stale anchor for >1 second.
      const stride=speed/Math.max(.001,cad),ahead=stride*tune.duty*.5
      for(const [leg,p] of [[this.legs[1],this.phase],[this.legs[0],(this.phase+.5)%1]] as const){
        leg.anchor=x+dir*(ahead-stride*p);leg.park=leg.anchor
        leg.land=x+dir*ahead;leg.swinging=p>=tune.duty
      }
    }
    this.lastProfile=this.standing?undefined:tune.profile

    this.solveLeg(this.footR, this.legs[1], this.phase, x, vx, dir, cad, tune, dt, sole, 1)
    this.solveLeg(this.footL, this.legs[0], (this.phase + 0.5) % 1, x, vx, dir, cad, tune, dt, sole, -1)
    this.hasPlanted = this.footR.planted || this.footL.planted
    // stand width blends the stance park targets (wide while parked)
    this.standW = damp(this.standW, this.standing ? 1 : 0.3, 6, dt)
  }

  /** re-seed anchors (landing, big teleports) — feet park under the hips */
  reseed(x: number, face: 1 | -1): void {
    this.lastProfile=undefined
    this.legs[0].anchor = this.legs[0].park = x - face * 9
    this.legs[1].anchor = this.legs[1].park = x + face * 13
    this.seeded = true
  }

  /** Dedicated centered walk trajectory. No run-style delayed swing or
   * giant stepAhead; each new anchor centers the following support interval. */
  private solvePatrol(out:FootPlan,leg:LegState,p:number,x:number,vx:number,dir:1|-1,cad:number,tune:GaitTuning,sole:number):void{
    const stride=cad>.001?Math.abs(vx)/cad:tune.stride
    const ahead=Math.min(31,stride*tune.duty*.5)
    if(p<tune.duty){
      const u=p/tune.duty
      out.x=leg.anchor;out.y=-sole-tune.lift*smooth01((u-.82)/.18)
      out.planted=true
      out.pitch=u<.12?lerp(.28,0,smooth01(u/.12)):-.5*smooth01((u-.72)/.28)
    }else{
      const u=(p-tune.duty)/(1-tune.duty),until=(1-p)/Math.max(.001,cad)
      leg.land=x+vx*until+dir*ahead
      out.x=lerp(leg.anchor,leg.land,smooth01(u))
      out.y=-sole-tune.clearance*Math.pow(Math.sin(Math.PI*u),1.2)-tune.lift*(1-smooth01(u/.24))
      out.pitch=lerp(-.5,.28,smooth01(u));out.planted=false;leg.swinging=true
    }
  }

  private solveLeg(
    out: FootPlan, leg: LegState, p: number,
    x: number, vx: number, dir: 1 | -1,
    cad: number, tune: GaitTuning, dt: number,
    sole: number, side: 1 | -1,
  ): void {
    // ---- wrap: a leg that was swinging and just crossed into stance
    // plants at its predicted landing spot — clamped into the plant
    // envelope around the CURRENT femoral position (prediction artifacts
    // at deceleration planted feet beyond the leg's reach: the collapse)
    if (leg.swinging && p < tune.duty) {
      leg.swinging = false
      if (leg.anchor !== leg.land) {
        leg.anchor = clamp(leg.land, x - PLANT_ENVELOPE, x + PLANT_ENVELOPE)
        this.footfall = true
        this.footfalls++
        this.footfallX = leg.anchor
      }
    }
    if (this.standing) {
      // ---- STAND: park the foot at the staggered stance position, flat
      const park = x + dir * side * (tune.standWidth ?? 12) * this.standW
      leg.park = damp(leg.park, park, 12, dt)
      leg.anchor = leg.park
      leg.swinging = false
      out.x = leg.park
      out.y = -sole
      out.planted = true
      out.pitch = side > 0 ? 0.16 : 0.04
      return
    }
    if(tune.profile==='patrol'){this.solvePatrol(out,leg,p,x,vx,dir,cad,tune,sole);return}
    if (p < tune.duty) {
      // ---- STANCE: world-locked anchor, flat sole, heel lifts to toe-off
      const u = p / tune.duty
      const lift = tune.lift * smooth01((u - 0.7) / 0.3)
      out.x = leg.anchor
      out.y = -sole - lift
      out.planted = true
      out.pitch = u < 0.16
        ? lerp(0.55, 0.05, u / 0.16)             // heel-strike → flat
        : -smooth01((u - 0.6) / 0.4)             // flat → toe-off
    } else {
      // ---- SWING: clearance arc old anchor → predicted landing spot.
      // The forward sweep is DELAYED (~16% of swing): the foot lags behind
      // the advancing hip early — the trailing toe-off extension read —
      // then sweeps forward fast into the heel strike (velocity peaks
      // mid-late swing, as in real gait). The lift rises slowly at first
      // (the toe grazes low behind) to a mid-late apex (knee drive).
      const u = (p - tune.duty) / (1 - tune.duty)
      const tFall = cad > 0.01 ? (1 - p) / cad : 0.2
      leg.land = x + vx * tFall * 0.86 + tune.stepAhead * dir
      const eu = smooth01(clamp01((u - 0.16) / 0.84))
      const arc = Math.sin(Math.PI * clamp01(u)) * (0.38 + 0.62 * smooth01(u))
      out.x = lerp(leg.anchor, leg.land, eu)
      out.y = -sole - tune.clearance * arc
      out.planted = false
      // toe-off point-down → dorsiflexed (toe-up) reach for heel strike
      out.pitch = lerp(-0.85, 0.6, smooth01(u)) + Math.sin(Math.PI * u) * 0.25
      leg.swinging = true
    }
  }
}

function smooth01(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

/* ------------------------------------------------------------------ */
/* Foot pitch → toe offset (local facing space)                        */
/* ------------------------------------------------------------------ */

/**
 * Toe position from ankle + pitch, in LOCAL facing space (+X = facing).
 * pitch −1 = plantarflexed (toe points down-forward under the ankle),
 * 0 = flat, +1 = dorsiflexed (toe up, heel-strike reach).
 * `len` = foot length in the same units.
 */
export function toeFromPitch(
  ankleX: number, ankleY: number,
  pitch: number, len: number,
  out: { x: number; y: number },
): void {
  const p = clamp(pitch, -1, 1)
  let dx: number, dy: number
  if (p >= 0) {
    // flat → dorsiflexed
    dx = lerp(0.98, 0.92, p)
    dy = lerp(0.18, -0.4, p)
  } else {
    // flat → plantarflexed (toe tucks down-forward)
    dx = lerp(0.98, 0.36, -p)
    dy = lerp(0.18, 0.94, -p)
  }
  out.x = ankleX + dx * len
  out.y = ankleY + dy * len
}
