/** STICKMAN RISING — the Player: state machine, dash system, combo machine,
 * parry/riposte, charged attacks, elemental abilities, execution finishers.
 */

import { Animator } from '../anim/animator'
import { SwordArcSolver } from '../anim/armarc'
import { makePose, Pose, CH } from '../anim/pose'
import { PLAYER_SPEC, PLAYER_STYLE } from '../anim/skeleton'
import { FighterGeom, drawFighter3D, FOCUS, ikArm3D, makeFighterGeom, solveFighter3D } from '../anim/rig3d'
import { FootPlan, GaitPlanner, LegIKOut, PLAYER_GAIT, solveLegIK, toeFromPitch } from '../anim/legik'
import { applyJointLimits } from '../anim/limits'
import { KeyLight, ShadowFigure, drawCastShadow, drawStrobeRim } from '../render/lighting'
import { reflectOffSegment } from '../fx/lightning'
import {
  AIR_JUMP_CLIP, BACKPEDAL_CLIP, BRAKE_CLIP, CHARGE_CLIP, COMBAT_IDLE_CLIP, COMBAT_STEP_CLIP,
  DRAW_CLIP, FALL_CLIP, HURT_CLIP, IDLE_CLIP, JUMP_CLIP, JUMP_LEAP_CLIP, LAND_CLIP,
  PARRY_CLIP, RUN_CLIP, SHEATHE_CLIP, SPRINT_CLIP, WALK_CLIP,
} from '../anim/clips'
import { ATTACKS, AttackDef, AttackRuntimeInfo, makeRuntimeInfo } from '../combat/attacks'
import {
  DashVariant, DashVariantCfg, DASH_SPEED, DASH_VARIANTS, dashEnvelope, evaluateDash,
} from '../combat/dash'
import { drawSword, SWORDS, SwordDef, SwordId } from '../combat/swords'
import { Trail } from '../fx/fx'
import { WorldRef } from '../core/types'
import { clamp, clamp01, damp, rand, rgba, segHitsCircle } from '../core/utils'

/** circle vs swept blade quad (prev segment + current segment) — prevents tunneling */
function circleHitsSweptQuad(
  cx: number, cy: number, r: number,
  pbx: number, pby: number, ptx: number, pty: number,
  bx: number, by: number, tx: number, ty: number,
): boolean {
  // current + previous blade segments
  if (segHitsCircle(bx, by, tx, ty, cx, cy, r)) return true
  if (segHitsCircle(pbx, pby, ptx, pty, cx, cy, r)) return true
  // swept edges (tip path + base path)
  if (segHitsCircle(ptx, pty, tx, ty, cx, cy, r)) return true
  if (segHitsCircle(pbx, pby, bx, by, cx, cy, r)) return true
  // circle center inside the swept quad (spins / wide arcs)
  if (pointInTri(cx, cy, pbx, pby, ptx, pty, tx, ty)) return true
  if (pointInTri(cx, cy, pbx, pby, tx, ty, bx, by)) return true
  return false
}

function pointInTri(px: number, py: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): boolean {
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3)
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

export type PlayerState =
  | 'move' | 'attack' | 'dash' | 'parry' | 'charge' | 'hurt' | 'dead'
  | 'scripted' // driven by Game cinematics (ult / execution)

/** Locomotion styles — each a genuinely distinct authored cycle (never a
 * playback rescale of one clip). Selected by the context-aware controller
 * from: speed, direction relative to facing, sprint latch, enemy formation
 * (proximity weight + surrounded), and previous mode (dwell hysteresis). */
export type LocoMode =
  | 'idle'        // grounded, slow, safe — relaxed breathing carry
  | 'combatIdle'  // grounded, slow, THREAT ENGAGED — rooted live guard
                 // (planted feet, weight shifts; NEVER a stepping loop)
  | 'walk'        // Condition A: relaxed open-space carry
  | 'run'         // conventional run
  | 'sprint'      // Condition C: explosive double-tap dash-run
  | 'combat'      // Condition B (moving): low quick shuffle, live guard
  | 'backpedal'   // retreating while facing the threat — guard up
  | 'brake'       // one-shot hard stop (input reversal at speed)

const SCALE = 1.32
/** nominal (airborne) hip height = thigh(25)+shin(24) = 49 local × SCALE.
 * Grounded height is NOT fixed — it derives from the planted foot via the
 * foot-ground lock (updateFootLock): idle bent knees, lunges and landing
 * squashes all sit exactly ON the ground line. */
const HIP_H = (25 + 24) * SCALE

/**
 * Enemy body spheres: [centerY offset above ground, radius] in enemy-local
 * units (× e.scale). Traced from the ENEMY_SPEC skeleton — hip at 47u, torso
 * 32u, head top ≈ 94u. The old single circle (y-34, r 26) only covered the
 * lower 2/3 of the body, so chest/head-height slashes passed straight
 * through the sprite without connecting. Three spheres hug the visual body.
 */
const BODY_SPHERES: ReadonlyArray<{ oy: number; r: number }> = [
  { oy: 14, r: 15 }, // legs / hip mass
  { oy: 48, r: 21 }, // torso (the main target)
  { oy: 78, r: 17 }, // chest / head zone
]

/** blade segment vs an enemy's full visual body (any sphere, swept-aware).
 * `pad` fattens the radius per-attack — a katana edge is a plane; the hit
 * volume must match the visual footprint of the blade edge corridor. */
function bladeHitsBody(
  e: { x: number; y: number; scale: number },
  hasPrev: boolean,
  prev: { bx: number; by: number; tx: number; ty: number },
  cur: { bx: number; by: number; tx: number; ty: number },
  pad = 3,
): boolean {
  const s = e.scale
  for (const sp of BODY_SPHERES) {
    const cy = e.y - sp.oy * s
    const r = sp.r * s + pad
    if (hasPrev
      ? circleHitsSweptQuad(e.x, cy, r, prev.bx, prev.by, prev.tx, prev.ty, cur.bx, cur.by, cur.tx, cur.ty)
      : segHitsCircle(cur.bx, cur.by, cur.tx, cur.ty, e.x, cy, r)
    ) return true
  }
  return false
}

const MOVE_MAX = 350
/** Condition C sprint ceiling + its own accel curve — sprint is a distinct
 * mechanical system (pose + cadence + stride), not a playback-rate hack. */
const SPRINT_MAX = 480
const SPRINT_ACCEL = 3400
const ACCEL = 2600
const FRICTION = 2800
/** braking deceleration when reversing at speed (skid → BRAKE_CLIP + dust) */
const BRAKE_DECEL = 4600
const AIR_ACCEL = 1800
const GRAVITY = 2050
/** ANTI-FLOAT gravity shaping (Sekiro-weight): apex decay ×2.2 kills the
 * moon-hover; the fall accelerates ×3.5 so the body plummets; terminal
 * velocity caps the plunge. Rising hard (launch/juggle) keeps ~1.35× so
 * launches still read. */
const GRAV_APEX = 2.2
const GRAV_RISE = 1.35
const GRAV_FALL = 3.5
const TERMINAL_VY = 1650
/** JUMP HEIGHT: −950 with the shaped gravity clears ~158px ≈ 2.5× hip
 * height — a commanding, deliberate jump (the old −840 cleared ~1.9×
 * which read as a hop next to this). The double jump gets its own strong
 * figure; the running LEAP converts horizontal momentum instead. */
const JUMP_V = -950
const AIR_JUMP_V = -820
const DASH_CD = 0.1
const DASH_RECHARGE = 0.32
/** dash ghost beats: fire times as fractions of dash duration (research:
 * cap 3, exponential spacing) + the per-ghost starting darkness */
const DASH_GHOST_BEATS = [0.18, 0.5, 0.85]
// first ghost toned 0.5 → 0.38: it fires closest to the live body and the
// half-dark overlay + rim double-draw swallowed the SOLID figure's own
// anatomy at the dash apex (limbs/joints became unreadable under the trail)
const DASH_GHOST_A0 = [0.38, 0.34, 0.24]

interface ActionState {
  def: AttackDef
  animT: number
  hitMap: Map<number, number>
  trail: Trail
  sfxDone: boolean
  moveDone: boolean
  moveYDone: boolean
  impactDone: boolean
  overshootDone: boolean
  flashDone: boolean
  fromParry: boolean
}

interface AbilityState {
  kind: SwordId
  t: number
  step: number
  targets: number[]
  x: number
  y: number
}

export class Player {
  x = 400
  y = 0
  vx = 0
  vy = 0
  face: 1 | -1 = 1
  grounded = true

  hp = 100
  maxHp = 100
  energy = 100
  maxEnergy = 100
  meter = 0

  sword: SwordDef = SWORDS.katana

  state: PlayerState = 'move'
  private animator = new Animator()

  /* ---------------------------------------------------------------- */
  /* CONTEXT-AWARE LOCOMOTION (spec §4–§7)                              */
  /* ---------------------------------------------------------------- */

  /** current locomotion style — selected from speed, direction, enemy
   * formation, sprint latch, and previous state; NEVER from a raw threshold
   * without hysteresis (no flicker). Read by the inspection lab. */
  loco: LocoMode = 'idle'
  /** time spent in the current loco mode (dwell hysteresis) */
  private locoT = 0
  /** explicit sprint latch: double-tap-and-hold a direction (DMC-style) */
  private sprintLatch = false
  private lastTapDir = 0
  private lastTapT = -10
  /** last-seen PRESS EVENT stamps (event-driven: frame-rate independent) */
  private stampR = -1
  private stampL = -1
  /** damped enemy-proximity weight 0..1 — hysteresis via asymmetric rates
   * (in k=7, out k=2.2): drives combat crouch, guard raise, combat shuffle */
  enemyNearW = 0
  /** nearest live threat (world) — head tracking + context, public for QA */
  threatX = 0
  threatY = 0
  hasThreat = false
  /** enemies both sides within combat radius — surrounded read */
  private surrounded = false
  /** one-shot brake clip state */
  private braking = false
  /** 180° turn pivot blend (cosmetic counter-rotation while face flips) */
  private turnT = 0
  private turnDir = 1
  /** POST-ATTACK MOMENTUM: the body preserves the last swing's rotational
   * momentum into locomotion (follow-through + recovery), decaying */
  private postAttackT = 0
  private postArmVel = 0
  /** smoothed acceleration → anticipatory lean (previous-frame awareness) */
  private accelSm = 0
  private prevVx = 0
  /** damped dash lean weight (velocity-envelope driven — see applyProcedural) */
  private dashLeanS = 0
  /** damped head-aim toward the threat (alive even while retreating) */
  private headTrackW = 0
  /** wall-clock seconds (input rhythm: double-tap sprint detection) */
  private now = 0
  pose: Pose = makePose()
  geom: FighterGeom = makeFighterGeom()
  swingGlow = 0
  flashT = 0
  iframes = 0

  private action: ActionState | null = null
  private ability: AbilityState | null = null

  private lightIndex = 0
  private airIndex = 0
  private lastLightAt = -10
  private lastGrounded = true
  private landSpring = 0

  private dashT = 0
  private dashDur = DASH_VARIANTS.launch.dur
  private dashSpd = DASH_SPEED
  /** active variant config (clip + tuning) — set on startDash */
  private dashCfg: DashVariantCfg = DASH_VARIANTS.launch
  private dashCd = 0
  private dashConsec = 0
  /** chain window: dashes within this span of the last one link into a
   * chain (see update() — the old code zeroed dashConsec EVERY frame
   * while recharge was 0, so consecutive dashes never accumulated and
   * the recharge gate never fired) */
  private dashChainT = 0
  private dashRecharge = 0
  private dashDx = 1
  private dashDy = 0
  /** current dash variant — public for the inspection lab + QA harness */
  dashVariant: DashVariant = 'launch'
  /** true while the exit of this dash handed momentum to locomotion (QA) */
  dashHandoff = false
  private airDashUsed = false
  private jumpsUsed = 0
  /** THREE-BEAT GHOST SCHEDULE (research-capped): afterimages fire at dash
   * progress 0.18 / 0.5 / 0.85 — spacing WIDENS through the dash (the gaps
   * read as acceleration), each successively darker. Replaces the old
   * uniform 6–8-ghost cadence (visual clutter). */
  private dashGhostIdx = 0
  /** when the last dash ended — the momentum tail window feeds the
   * dash-strike conversion (attacking on dash momentum = through-cut) */
  private dashEndedAt = -10
  /** POST-RETREAT GUARD LOCK: a backdash/escape commits the facing toward
   * the threat for a beat — holding the retreat direction accelerates past
   * the backpedal speed threshold within ~15ms, which would otherwise flip
   * the body into a fleeing run mid-evade. Dodging reads as dodging WITH
   * the guard up; the turn develops after the lock, if still held. */
  private retreatLockT = 0

  private parryT = 0
  private parryActive = 0
  riposteT = 0
  private parryPerfect = false

  /* ---- SWORD HOME (notō / iai): the sheath system. swordDrawn=false →
   * the steel rides inside the saya, locomotion arms are HANDS-ONLY, and
   * any combat input snaps it back out with the iai flash. */
  swordDrawn = true
  /** the active one-shot sheath/draw ritual (runs inside state 'move') */
  private sheathAct: { t: number; dur: number; mode: 'sheathe' | 'draw' } | null = null
  /** seconds of standing peace (no threat, no combat) — feeds auto-sheathe */
  private peaceT = 0
  /** damped weight of the sheathed pommel-rest arm layer */
  private sheathW = 0

  private chargeT = 0
  charging = false
  private chargeReady = false

  private hurtT = 0
  private deadT = 0

  /* ---- WEIGHT: hip height derives from the planted foot (foot-ground
   * lock) — no floating, no digging, real weight transfer for every pose. */
  private footLock = HIP_H

  /* ---- GROUND-CONTACT GAIT (legik): a real gait planner + 2-bone leg IK
   * owns the legs during grounded locomotion — stance feet world-LOCKED
   * exactly on the ground line, swing feet on clearance arcs. This is the
   * fix for the floating far/offside leg in every animation. */
  private gait = new GaitPlanner()
  /** gait authority weight (0 = FK clip legs, 1 = IK planner legs) */
  private gaitW = 0
  private ikOut: LegIKOut = { kx: 0, ky: 0, ax: 0, ay: 0, clamped: false }
  private toeScratch = { x: 0, y: 0 }
  /** sole clearance of the visual foot wedge (local units) */
  private static readonly SOLE = 3.4
  /** sole clearance in world px */
  private static readonly SOLE_W = 3.4 * SCALE

  /* ---- BLADE DYNAMICS: rotational inertia of the katana. The tip lags
   * the arm's angular acceleration and whips through on release — a
   * physically-motivated furi-otoshi accent layered under the keyframes. */
  private bladeLag = 0
  private bladeLagVel = 0
  private prevArmSum = 0
  /** signed arm angular velocity (rad/s) — drives lag, chain reaction, overshoot */
  private armVel = 0

  /* ---- KINETIC CHAIN (anti "spinning top"): hips → torso → shoulders
   * counter-lag spring. When the arm whips, the body visibly loads against
   * it (30% hips · 50% torso · 20% shoulders) — Newton's third law, read. */
  private chainLag = 0
  private chainLagVel = 0

  /* ---- 2.8D: camera-side depth of the blade plane (−1..1) + hyper-scale
   * (blade grows during active frames, anime weapon read) + smear tracking */
  private bladeZ = 0
  private swingScale = 1
  private prevBladeAng = 0
  private hasPrevAng = false
  /** this frame's angular smear window (prev → current blade angle) */
  private smearA0 = 0
  private smearA1 = 0

  /* ---- 3D GAIT / SWORD-CARRY state (rig3d consumers) ---- */
  /** damped gait twist amplitude (pelvis swivel + shoulder counter) */
  private gaitYawAmp = 0
  /** damped weapon carry yaw per locomotion (sprint tuck etc.) */
  private carryYaw = 0
  /** damped sword-arm depth carry */
  private carryArmZ = 0
  /** damped sword-FOREARM depth carry (elbow-pivot yaw — the steel folds
   * deeper than the shoulder can yaw) */
  private carryForeZ = 0

  /* ---- TWO-HANDED GRIP: the off hand reaches for the tsuka butt via 2-bone
   * IK (real kenjutsu: chūdan/jōdan/kiri are two-handed stances). */
  private twoHandW = 0

  /* ---- SWORD-LED ARM CONTROL (anim/armarc.ts): during each strike the
   * blade follows a geometrically-locked arc and a 2-bone IK chain solves
   * the sword arm to carry it — the enemy sits on the monouchi BY
   * construction, so the visual cut and the hitbox are one object. */
  private swordArc = new SwordArcSolver()

  /* ---- arm life: idle breathing clock + anime impact-frame timer ---- */
  private animClock = 0
  private impactFlashT = 0

  /* ---- HEAVY CHAIN: h1 → h2 → h3 (was: single animation forever). */
  private heavyIndex = 0
  private lastHeavyAt = -10

  /* ---- HYPER-ARMOR window (charged release): damage bleeds at 35%, but
   * the swing is never interrupted — the counter to "charged never hits". */
  private armorT = 0

  /** world-space blade segment (hit + trail sampling) */
  blade = { bx: 0, by: 0, tx: 0, ty: 0 }
  /** previous frame's blade segment (swept hit detection) */
  private prevBlade = { bx: 0, by: 0, tx: 0, ty: 0 }
  private hasPrevBlade = false

  constructor() {
    this.animator.play(IDLE_CLIP, { blend: 0.05 })
  }

  reset(x: number): void {
    this.x = x
    this.y = 0
    this.vx = 0
    this.vy = 0
    this.face = 1
    this.grounded = true
    this.hp = this.maxHp
    this.energy = this.maxEnergy
    this.meter = 0
    this.state = 'move'
    this.action = null
    this.ability = null
    this.charging = false
    this.hurtT = 0
    this.iframes = 0
    this.deadT = 0
    this.exitScriptedSoon = 0
    this.lightIndex = 0
    this.airIndex = 0
    this.bladeZ = 0
    this.swingScale = 1
    this.bladeLag = 0
    this.bladeLagVel = 0
    this.chainLag = 0
    this.chainLagVel = 0
    this.prevArmSum = 0
    this.hasPrevAng = false
    // context-aware locomotion state
    this.loco = 'idle'
    this.locoT = 0
    this.sprintLatch = false
    this.lastTapDir = 0
    this.lastTapT = -10
    // NOTE: stampR/stampL deliberately NOT reset — re-syncing against the
    // input's live press-stamps on the next frame avoids a phantom press
    this.enemyNearW = 0
    this.hasThreat = false
    this.surrounded = false
    this.braking = false
    this.turnT = 0
    this.postAttackT = 0
    this.postArmVel = 0
    this.accelSm = 0
    this.prevVx = 0
    this.headTrackW = 0
    this.gaitYawAmp = 0
    this.carryYaw = 0
    this.carryArmZ = 0
    this.carryForeZ = 0
    this.dashVariant = 'launch'
    this.dashCfg = DASH_VARIANTS.launch
    this.dashHandoff = false
    this.dashT = 0
    this.dashDur = DASH_VARIANTS.launch.dur
    this.dashSpd = DASH_SPEED
    this.dashConsec = 0
    this.dashChainT = 0
    this.dashRecharge = 0
    this.dashCd = 0
    this.retreatLockT = 0
    this.swordDrawn = true
    this.sheathAct = null
    this.peaceT = 0
    this.sheathW = 0
    this.animator.play(IDLE_CLIP, { blend: 0.05 })
  }

  setSword(id: SwordId): void {
    this.sword = SWORDS[id]
  }

  get atkSpeed(): number {
    return this.sword.stats.spd
  }

  get busy(): boolean {
    return this.state === 'attack' || this.state === 'charge' || this.state === 'parry' || this.state === 'scripted'
  }

  get chargeRatio(): number {
    return clamp01(this.chargeT / 0.55)
  }

  get parryWindowOpen(): boolean {
    return this.parryActive > 0
  }

  get isDead(): boolean {
    return this.state === 'dead'
  }

  get deadTime(): number {
    return this.deadT
  }

  get hipY(): number {
    // footLock (damped) IS the hip height: planted-foot-derived → weight.
    // (geom already contains pose rootY, so no double count.)
    return this.y - this.footLock
  }

  /* ------------------------------------------------------------------ */
  /* main update                                                          */
  /* ------------------------------------------------------------------ */

  update(dt: number, w: WorldRef): void {
    this.iframes = Math.max(0, this.iframes - dt)
    this.armorT = Math.max(0, this.armorT - dt)
    this.flashT = Math.max(0, this.flashT - dt * 5)
    this.swingGlow = Math.max(0, this.swingGlow - dt * 5)
    this.riposteT = Math.max(0, this.riposteT - dt)
    this.energy = Math.min(this.maxEnergy, this.energy + dt * 3)

    // context-system clocks
    this.now += dt
    this.locoT += dt
    if (this.turnT > 0) this.turnT = Math.max(0, this.turnT - dt * 6) // ~0.17s pivot
    if (this.postAttackT > 0) this.postAttackT = Math.max(0, this.postAttackT - dt)
    // the sword-home ritual only lives in the move state — any external
    // transition (hurt / parry / scripted) abandons it
    if (this.state !== 'move' && this.sheathAct) this.sheathAct = null

    switch (this.state) {
      case 'move': this.updateMove(dt, w); break
      case 'attack': this.updateAttack(dt, w); break
      case 'dash': this.updateDash(dt, w); break
      case 'parry': this.updateParry(dt, w); break
      case 'charge': this.updateCharge(dt, w); break
      case 'hurt': this.updateHurt(dt, w); break
      case 'dead': this.updateDead(dt, w); break
      case 'scripted': this.updateScripted(dt); break
    }

    // physics integration (shared)
    if (this.state !== 'dash') {
      let g: number
      if (this.state === 'attack' && this.action && this.action.def.float) {
        // authored air-combo float overrides the shaping (juggle windows)
        g = GRAVITY * this.action.def.float
      } else if (this.vy < 0) {
        // ANTI-FLOAT: apex decay — no moon hovering
        g = GRAVITY * (this.vy < -260 ? GRAV_RISE : GRAV_APEX)
      } else {
        // heavy fall: the body plummets
        g = GRAVITY * GRAV_FALL
      }
      this.vy += g * dt
      if (this.vy > TERMINAL_VY) this.vy = TERMINAL_VY
    }
    this.x += this.vx * dt
    this.y += this.vy * dt

    // ground
    const wasAir = !this.grounded
    if (this.y >= 0) {
      this.y = 0
      if (this.vy > 140) {
        this.landSpring = clamp(this.vy / 700, 0, 1)
        if (wasAir) this.onLand(w)
      } else if (wasAir) {
        this.landSpring = 0.4
        this.onLand(w)
      }
      this.vy = 0
      this.grounded = true
      this.jumpsUsed = 0
      this.airDashUsed = false
    } else {
      this.grounded = false
    }
    // arena bounds
    if (this.x < w.arenaMinX + 20) {
      this.x = w.arenaMinX + 20
      if (this.vx < -200) w.fx.dust(this.x - 12, 0, 5)
      this.vx = Math.max(0, this.vx)
    }
    if (this.x > w.arenaMaxX - 20) {
      this.x = w.arenaMaxX - 20
      if (this.vx > 200) w.fx.dust(this.x + 12, 0, 5)
      this.vx = Math.min(0, this.vx)
    }

    this.dashCd = Math.max(0, this.dashCd - dt)
    this.dashRecharge = Math.max(0, this.dashRecharge - dt)
    this.retreatLockT = Math.max(0, this.retreatLockT - dt)
    if (this.dashRecharge <= 0) {
      // chain bookkeeping: the counter survives for the chain window after
      // the LAST dash — reset only when the window closes (or the recharge
      // punishment completes), never unconditionally every frame
      this.dashChainT = Math.max(0, this.dashChainT - dt)
      if (this.dashChainT <= 0) this.dashConsec = 0
    }

    // ability script
    if (this.ability) this.updateAbility(dt, w)

    // animation + solve
    this.animator.update(dt)
    // Base layer: the clip FULLY owns the pose each frame (write, never
    // accumulate). applyProcedural() is a bounded additive layer on top.
    // Without this copy, procedural += deltas integrate unbounded → spine
    // spin + root sink. (Same contract as Spine's AnimationState.apply /
    // Godot AnimationTree → Skeleton2D.)
    this.pose.set(this.animator.pose)
    this.applyProcedural(dt)
    this.updateBladeZ(dt) // zArc → bladeYaw channel (BEFORE the 3D solve)
    // procedural layers (bounded, frame-local — never accumulate):
    // SWORD-LED ARC first: it rewrites the arm channels, so the blade
    // dynamics spring below sees the ARC's angular velocity — the whip
    // lags/overshoots the real swing, not the raw keyframes.
    this.swordArc.update(dt, {
      pose: this.pose,
      shoulderX: this.geom.shoulderR.x, shoulderY: this.geom.shoulderR.y,
      shoulderZ: this.geom.shoulderR.z,
      handX: this.geom.handR.x, handY: this.geom.handR.y,
      handZ: this.geom.handR.z,
      def: this.state === 'attack' ? this.action?.def ?? null : null,
      animT: this.action ? this.action.animT : 0,
      enemies: w.enemies,
      face: this.face,
      x: this.x,
      hipY: this.hipY,
      reach: PLAYER_SPEC.blade * this.sword.stats.range * SCALE * 1.1 + 130,
    })
    this.updateBladeDynamics(dt, w) // wrist lag spring + kinetic chain — feeds hitboxes
    this.applyTwoHandGrip(dt)       // off-hand IK onto the tsuka
    // ANATOMICAL LIMITS: the last writer before the solve. Clips, additive
    // layers, crossfades and every IK all pass through the same human ROM
    // gate — elbows never cross their flexion side, knees never fold
    // forward, shoulders stay in the glenohumeral envelope.
    applyJointLimits(this.pose)
    // 3D SOLVE: sagittal channels + depth channels → projected joints + blade
    solveFighter3D(
      this.pose, PLAYER_SPEC, this.geom,
      PLAYER_SPEC.blade * this.sword.stats.range * 1.06,
      this.swingScale,
    )
    this.updateGait(dt, w)             // ground-contact foot planner (legik)
    this.updateFootLock(dt)         // weight: hips sit on the planted foot
    this.applyGroundIK(dt)          // leg IK: feet exactly where feet go
    this.updateBladeWorld()
    this.updateSwingScale(dt)
  }

  private onLand(w: WorldRef): void {
    w.audio.play('land', { volume: 0.5 })
    w.fx.dust(this.x, 0, 7)
    // re-seed the gait anchors under the landing position — the squash
    // parks both feet flat through the absorb, then stepping resumes
    this.gait.reseed(this.x, this.face)
    // slam impact while attacking
    const a = this.action
    if (a && a.def.slamImpact && !a.impactDone) {
      a.impactDone = true
      this.slamAoe(w, a.def.slamImpact.r, a.def.slamImpact.dmg, a.def.slamImpact.launch)
    }
    if (this.state === 'move' && this.lastGrounded === false) {
      this.animator.play(LAND_CLIP, { blend: 0.06 })
    }
    this.airIndex = 0
  }

  private slamAoe(w: WorldRef, r: number, dmg: number, launch: number): void {
    const info: AttackRuntimeInfo = {
      id: 'slam', dmg: dmg * this.sword.stats.dmg, heavy: true,
      stagger: 0.5, kb: 240, kbY: 0, launch, juggle: 0,
      hitstop: 0.11, shake: 0.45, aoe: r, breakGuard: true, kind: 'heavy',
    }
    const colors = this.sword.colors
    w.fx.shockwave(this.x, 0, r, colors.glow, 0.5, 8)
    w.fx.groundCrack(this.x, 0, r * 0.6)
    w.fx.burst(this.x, -6, 14, colors.glow, 340, 0.5, 'spark')
    w.fx.screenFlash(colors.trail, 0.16, 5)
    w.addHitstop(0.09, 0.06)
    w.cam.addTrauma(0.4)
    w.audio.play('slam', { intensity: 1 })
    const bx = this.x
    for (const e of w.enemies) {
      if (e.dead || e.spawning) continue
      const dx = e.x - bx
      if (Math.abs(dx) < r && e.y > -140) {
        w.hitEnemy(e.id, { bx: bx - 20, by: -20, tx: bx + 20, ty: -20 }, info)
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* context-aware locomotion                                            */
  /* ------------------------------------------------------------------ */

  /** Per-frame enemy-formation scan (spec §5): nearest threat + proximity
   * weight (with hysteresis) + surrounded flag. Feeds the locomotion
   * selector AND the procedural posture layers. NEVER takes control away
   * from the player — posture only. */
  private scanEnemies(dt: number, w: WorldRef): void {
    const RADIUS = 430
    let bestD = Infinity
    let ahead = false
    let behind = false
    for (const e of w.enemies) {
      if (e.dead || e.spawning) continue
      const dx = e.x - this.x
      const ad = Math.abs(dx)
      if (ad < RADIUS) {
        if (dx * this.face > 0) ahead = true
        else behind = true
      }
      if (ad < bestD) {
        bestD = ad
        this.threatX = e.x
        this.threatY = e.y
        this.hasThreat = true
      }
    }
    if (bestD === Infinity) this.hasThreat = false
    this.surrounded = ahead && behind && bestD < 300
    // asymmetric damp = hysteresis: fast to raise the guard, slow to relax
    const target = bestD < RADIUS ? 1 : 0
    const k = target > this.enemyNearW ? 7 : 2.2
    this.enemyNearW = damp(this.enemyNearW, target, k, dt)
    // head-tracking weight: quick to look, slower to look away
    const ht = this.hasThreat && bestD < 520 ? 1 : 0
    const hk = ht > this.headTrackW ? 8 : 3
    this.headTrackW = damp(this.headTrackW, ht, hk, dt)
  }

  /** Select the locomotion mode with dwell hysteresis (no flicker): a mode
   * must be held ≥0.1s before another can take over (except brake/turn
   * interrupts). Priority: brake > sprint latch > combat (moving, enemy
   * near) > backpedal (retreating vs facing) > run > walk > combatIdle
   * (threat engaged, standing) > idle (safe, standing).
   *
   * THE IDLE FIX: standing still with a threat engaged is combatIdle — a
   * ROOTED guard (planted feet, weight shifts). The old selector returned
   * the combat SHUFFLE here, so the player visibly marched in place while
   * "idle". Stepping only happens when actually moving. */
  private pickLoco(speed: number, ax: number): LocoMode {
    const fwd = this.vx * this.face
    if (this.braking) return 'brake'
    if (!this.grounded) return this.loco // airborne handled by clips, not modes
    if (speed < 36) {
      return this.enemyNearW > 0.5 || this.surrounded ? 'combatIdle' : 'idle'
    }
    // retreating while a threat is engaged → guarded backpedal
    if (fwd < -60 && this.enemyNearW > 0.4) return 'backpedal'
    // explicit sprint outranks proximity awareness (player intent wins)
    if (this.sprintLatch && speed > 300) return 'sprint'
    // Condition B: combat shuffle while enemies are near (but full-speed
    // committed running still uses the run mechanics)
    if (this.enemyNearW > 0.55 && speed < 310 && ax !== 0) return 'combat'
    if (speed > 210) return 'run'
    return 'walk'
  }

  private setLoco(mode: LocoMode): void {
    if (mode === this.loco) return
    // dwell hysteresis: hold each mode ≥0.1s (brake interrupts instantly)
    if (this.locoT < 0.1 && mode !== 'brake' && this.loco !== 'brake') return
    this.loco = mode
    this.locoT = 0
  }

  private updateMove(dt: number, w: WorldRef): void {
    const input = w.input
    const ax = input.axisX()
    const ay = input.axisY()

    // ---- enemy-formation awareness (posture influence ONLY) ----
    this.scanEnemies(dt, w)

    // ---- SWORD HOME ritual: an active sheathe/draw owns the body (rooted,
    // planted — you do not walk while feeding steel home). Danger inputs
    // interrupt instantly with the combat snap-draw. ----
    if (this.sheathAct) {
      this.updateSheathAct(dt, w, ax, ay)
      return
    }

    // ---- facing: hold toward an engaged threat at maneuvering speed ----
    // (Condition B: circle/retreat keeps the guard trained on the enemy —
    // backpedal instead of a civilian turn-away. Full-speed escape or
    // open-space movement flips freely — EXCEPT inside the post-retreat
    // guard lock: a dash-back never converts into a fleeing turn.)
    if (ax !== 0 && this.face !== (ax > 0 ? 1 : -1)) {
      const engaged = this.enemyNearW > 0.55 && this.hasThreat
      const slow = Math.abs(this.vx) < 260 && !this.sprintLatch
      if (!(engaged && slow) && this.retreatLockT <= 0) {
        if (Math.abs(this.vx) > 120) {
          this.turnT = 1
          this.turnDir = -Math.sign(ax)
          w.fx.dust(this.x, 0, 4)
        }
        this.face = ax > 0 ? 1 : -1
      }
    }

    // ---- double-tap direction → sprint latch (DMC-style, event-driven) ----
    // Press stamps come from the keydown EVENTS (input clock), so a rapid
    // tap-release-tap registers even if the release window contained zero
    // game frames (low fps / throttled rAF).
    {
      const sr = w.input.pressStamp('right')
      const sl = w.input.pressStamp('left')
      const newR = sr !== this.stampR && sr >= 0
      const newL = sl !== this.stampL && sl >= 0
      if (newR || newL) {
        const stamp = newR ? sr : sl
        const dir = newR ? 1 : -1
        if (stamp - this.lastTapT < 0.3 && dir === this.lastTapDir) {
          this.sprintLatch = true
        }
        this.lastTapDir = dir
        this.lastTapT = stamp
      }
      this.stampR = sr
      this.stampL = sl
    }
    if (ax === 0) this.sprintLatch = false

    // ---- horizontal movement (sprint has its own accel curve + ceiling) ----
    const sprinting = this.sprintLatch && this.grounded && ax !== 0 && Math.sign(ax) === Math.sign(this.vx || ax)
    const vMax = sprinting ? SPRINT_MAX : MOVE_MAX
    if (ax !== 0) {
      // input reversal at speed → BRAKE (skid decel + one-shot clip + dust)
      const reversing = Math.sign(ax) !== Math.sign(this.vx) && Math.abs(this.vx) > 240
      if (reversing && this.grounded && !this.braking) {
        this.braking = true
        this.animator.play(BRAKE_CLIP, { blend: 0.04 })
        w.fx.dust(this.x - this.face * 10, 0, 7)
        w.audio.play('land', { volume: 0.35 })
      }
      if (reversing || this.braking) {
        // hard skid deceleration toward zero before re-accelerating
        const d = BRAKE_DECEL * dt
        this.vx = Math.abs(this.vx) <= d ? 0 : this.vx - Math.sign(this.vx) * d
      } else {
        // analog target speed: axis magnitude maps to a target velocity —
        // partial input = partial speed (walk reachable; touch-friendly),
        // full keys still hit the ceiling. Accelerate toward it, never past.
        const targetV = ax * vMax
        const movingToward = Math.sign(this.vx) === Math.sign(targetV) || this.vx === 0
        if (!movingToward || Math.abs(this.vx) < Math.abs(targetV)) {
          const accel = sprinting ? SPRINT_ACCEL : this.grounded ? ACCEL : AIR_ACCEL
          this.vx += ax * accel * dt
          if (Math.sign(this.vx) === Math.sign(targetV) && Math.abs(this.vx) > Math.abs(targetV)) {
            this.vx = targetV
          }
        } else if (Math.sign(this.vx) === Math.sign(targetV) && Math.abs(this.vx) > Math.abs(targetV)) {
          // ease down toward the lower analog target (stick pushed softer)
          const f = FRICTION * dt
          const dv = Math.min(f, Math.abs(this.vx) - Math.abs(targetV))
          this.vx -= Math.sign(this.vx) * dv
        }
      }
      this.vx = clamp(this.vx, -vMax, vMax)
    } else if (this.grounded) {
      const f = FRICTION * dt
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f
    } else {
      this.vx = damp(this.vx, 0, 0.4, dt)
    }

    // ---- locomotion clip selection (context-aware, hysteresis) ----
    const speed = Math.abs(this.vx)
    if (this.grounded) {
      if (this.braking) {
        if (this.animator.isDone() || speed < 90) this.braking = false
      } else {
        this.setLoco(this.pickLoco(speed, ax))
        // GAIT-CADENCE SYNC: clip playback speed follows the legik planner's
        // step cadence (velocity ÷ stride) so the authored torso bob + arm
        // pump land on the SAME beat as the IK-planted feet — the stride
        // length itself derives from velocity, so planted feet never skate.
        const cad = Math.max(0.001, this.gait.cadence)
        const cadSpeed = (dur: number) => clamp(cad * dur / 2, 0.5, 2.4)
        switch (this.loco) {
          case 'walk':
            this.animator.play(WALK_CLIP, { blend: 0.18, speed: cadSpeed(1.0) })
            break
          case 'run':
            this.animator.play(RUN_CLIP, { blend: 0.12, speed: cadSpeed(0.5) })
            break
          case 'sprint':
            this.animator.play(SPRINT_CLIP, { blend: 0.1, speed: cadSpeed(0.36) })
            break
          case 'combat':
            this.animator.play(COMBAT_STEP_CLIP, { blend: 0.16, speed: cadSpeed(0.44) })
            break
          case 'combatIdle':
            this.animator.play(COMBAT_IDLE_CLIP, { blend: 0.18 })
            break
          case 'backpedal':
            this.animator.play(BACKPEDAL_CLIP, { blend: 0.14, speed: cadSpeed(0.56) })
            break
          default:
            this.animator.play(IDLE_CLIP, { blend: 0.16 })
        }
      }
    } else if (this.vy < -60) {
      // rising: the takeoff family (jump / leap / air-jump) is authored AT
      // the press (doJump) — never stomp it the frame after; only default
      // to the plain rise clip when airborne WITHOUT a jump entry this
      // flight (e.g. exiting an air dash or an attack float)
      const cn = this.animator.getClip()?.name
      if (cn !== 'jump' && cn !== 'jumpLeap' && cn !== 'airJump') {
        this.animator.play(JUMP_CLIP, { blend: 0.06 })
      }
    } else {
      this.animator.play(FALL_CLIP, { blend: 0.12 })
    }

    // ---- actions ----
    if (this.tryCombatInputs(w, ax, ay)) return

    // ---- AUTO-SHEATHE (the quiet beat): grounded, no threat, standing
    // still with the blade out for 3.5s → the samurai-film ending. Any
    // movement or threat resets the dwell. ----
    if (this.swordDrawn && this.grounded && !this.hasThreat && Math.abs(this.vx) < 24) {
      this.peaceT += dt
      if (this.peaceT > 3.5) this.startSheath(w)
    } else {
      this.peaceT = 0
    }
  }

  /** returns true if a new state was entered */
  private tryCombatInputs(w: WorldRef, ax: number, ay: number): boolean {
    const input = w.input

    // ---- SWORD HOME toggle (KeyQ): the notō / iai ritual ----
    if (input.pressed('sheathe')) {
      if (this.swordDrawn) this.startSheath(w)
      else this.startDraw(w)
      return true
    }

    // dash (anytime, from move) — the steel snaps out with it
    if ((input.pressed('dash') || input.buffered('dash')) && this.canDash()) {
      if (!this.swordDrawn) this.snapDraw(w)
      this.startDash(w, ax, ay)
      return true
    }
    // jump (grounded = jump 1, plus one air jump) — HANDS-ONLY: the steel
    // can stay home through the whole airborne family
    if (input.pressed('jump') || input.buffered('jump', 0.18)) {
      if (this.jumpsUsed < 2) {
        this.doJump(w)
        return false
      }
    }
    // parry
    if (input.pressed('parry')) {
      if (!this.swordDrawn) this.snapDraw(w)
      this.enterParry(w)
      return true
    }
    // ability
    if (input.pressed('ability')) {
      if (this.energy >= this.sword.ability.cost) {
        if (!this.swordDrawn) this.snapDraw(w)
        this.startAbility(w)
        return true
      }
    }
    // ult is handled by Game (cinematic)

    // heavy: charge vs tap
    if (input.down('heavy') && this.grounded) {
      if (!this.swordDrawn) this.snapDraw(w)
      this.enterCharge(w)
      return true
    }
    if (input.pressed('heavy') || input.buffered('heavy')) {
      input.takeBuffered('heavy')
      if (!this.swordDrawn) this.snapDraw(w)
      this.startAttack(this.pickHeavy(w), w)
      return true
    }
    // light
    if (input.pressed('light') || input.buffered('light')) {
      input.takeBuffered('light')
      if (!this.swordDrawn) this.snapDraw(w)
      // DASH MOMENTUM STRIKE: attacking while the last dash's momentum
      // still carries the body converts into the through-cut — the
      // dash-strike feel (Hades). Without this, the 150ms in-dash input
      // window was brutally tight and dash attacks "randomly" whiffed.
      if (this.grounded
        && w.time - this.dashEndedAt < 0.18
        && Math.abs(this.vx) > 110
        && this.riposteT <= 0) {
        this.startAttack(ATTACKS.dashSlash, w)
        return true
      }
      const id = this.riposteT > 0 ? 'riposte' : this.pickLight(w, ax, ay)
      this.startAttack(ATTACKS[id], w)
      return true
    }
    return false
  }

  /* ------------------------------------------------------------------ */
  /* sword home — sheathing / unsheathing (notō / iai)                    */
  /* ------------------------------------------------------------------ */

  /** NOTŌ: feed the steel home. Rooted, deliberate, one-shot. */
  private startSheath(w: WorldRef): void {
    if (this.sheathAct || !this.swordDrawn || !this.grounded) return
    this.sheathAct = { t: SHEATHE_CLIP.dur, dur: SHEATHE_CLIP.dur, mode: 'sheathe' }
    this.peaceT = 0
    this.vx *= 0.3
    this.animator.play(SHEATHE_CLIP, { blend: 0.09 })
    w.audio.play('swordSwitch', { volume: 0.3, pitch: 0.7 })
  }

  /** IAI: the deliberate draw (KeyQ). Fast three-beat explosion. */
  private startDraw(w: WorldRef): void {
    if (this.sheathAct || this.swordDrawn) return
    this.sheathAct = { t: DRAW_CLIP.dur, dur: DRAW_CLIP.dur, mode: 'draw' }
    this.animator.play(DRAW_CLIP, { blend: 0.06 })
  }

  /** instant combat draw: the ritual is abandoned, steel out NOW — every
   * combat input while sheathed routes through here (iai snap-draw). */
  private snapDraw(w: WorldRef): void {
    this.sheathAct = null
    if (!this.swordDrawn) {
      this.swordDrawn = true
      this.drawBurst(w)
    }
  }

  /** the iai draw flash — ONE clean light event along the draw line (the
   * shadow/light language, no particle confetti). */
  private drawBurst(w: WorldRef): void {
    const c = this.sword.colors
    w.fx.motionLine(this.x + this.face * 30, this.hipY - 16, this.face, 0, 72, 0.2, c.core)
    w.fx.screenFlash(c.core, 0.1, 6)
    w.cam.addTrauma(0.08)
    w.audio.play('swing', { pitch: 1.32, volume: 0.5 })
  }

  /** runs the active sheath/draw ritual inside state 'move': rooted
   * physics, the steel-crossing gate events, danger interrupts, completion. */
  private updateSheathAct(dt: number, w: WorldRef, ax: number, ay: number): void {
    const act = this.sheathAct
    if (!act) return
    const input = w.input
    const before = act.t
    act.t -= dt
    // rooted: the ritual plants the feet; residual momentum bleeds off
    if (this.grounded) {
      const f = FRICTION * dt
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f
    }
    // ---- the steel crossing the saya mouth (visual gate events) ----
    if (act.mode === 'sheathe') {
      // the slide home begins at ~0.42 into the clip (the MEET beat)
      if (before > act.dur - 0.42 && act.t <= act.dur - 0.42) {
        this.swordDrawn = false
        w.audio.play('swordSwitch', { volume: 0.4, pitch: 0.85 })
      }
    } else {
      // the steel rips out at the explosion beat (~0.12 in)
      if (before > act.dur - 0.12 && act.t <= act.dur - 0.12) {
        this.swordDrawn = true
        this.drawBurst(w)
      }
    }
    // ---- danger interrupts: the steel snaps out, the ritual dies ----
    if ((input.pressed('dash') || input.buffered('dash')) && this.canDash()) {
      this.snapDraw(w)
      this.startDash(w, ax, ay)
      return
    }
    if (input.pressed('jump') || input.buffered('jump', 0.18)) {
      if (this.jumpsUsed < 2) {
        // jumping keeps the steel home — the airborne family is hands-only;
        // any combat input snaps the blade back out on landing
        this.sheathAct = null
        this.doJump(w)
        return
      }
    }
    if (input.pressed('light') || input.buffered('light')) {
      input.takeBuffered('light')
      this.snapDraw(w)
      this.startAttack(ATTACKS.l1, w) // the iai draw-cut
      return
    }
    if (input.pressed('heavy') || input.buffered('heavy')) {
      input.takeBuffered('heavy')
      this.snapDraw(w)
      this.startAttack(this.pickHeavy(w), w)
      return
    }
    if (input.pressed('parry')) {
      this.snapDraw(w)
      this.enterParry(w)
      return
    }
    // ---- completion ----
    if (act.t <= 0) {
      this.sheathAct = null
      if (act.mode === 'sheathe') this.swordDrawn = false
      else this.swordDrawn = true
      this.peaceT = 0
    }
  }

  private doJump(w: WorldRef): void {
    w.input.takeBuffered('jump')
    this.jumpsUsed++
    const first = this.jumpsUsed === 1
    const wasGrounded = this.grounded
    this.vy = first ? JUMP_V : AIR_JUMP_V
    this.grounded = false
    if (first) {
      // ---- CONDITIONED JUMP (the same doctrine as the dash system): the
      // situation at the input instant picks the authored animation —
      // a run converts into the LEAP (momentum long-jump + a touch of
      // carry-over speed), a standstill gets the vertical hands-only jump.
      const speed = Math.abs(this.vx)
      if (wasGrounded && speed > 300) {
        this.vx = Math.sign(this.vx) * Math.min(speed * 1.12, 560)
        this.animator.play(JUMP_LEAP_CLIP, { blend: 0.05 })
      } else {
        this.animator.play(JUMP_CLIP, { blend: 0.05 })
      }
      w.audio.play('jump', { volume: 0.4 })
      w.fx.dust(this.x, 0, 4)
    } else {
      // AIR JUMP — the mid-air redirect. Clean read: ONE small vertical
      // light streak under the boots (no particle puff cloud).
      this.animator.play(AIR_JUMP_CLIP, { blend: 0.05 })
      w.fx.motionLine(this.x, this.y - 12, 0, -1, 48, 0.2, '#dff3ff')
      w.audio.play('jump', { volume: 0.3, pitch: 1.18 })
    }
  }

  /* ------------------------------------------------------------------ */
  /* dash — the CONDITIONED ACTIVATION SYSTEM                            */
  /* (variant resolution + tuning live in combat/dash.ts; clips.ts       */
  /*  authors the nine reference silhouettes)                            */
  /* ------------------------------------------------------------------ */

  private canDash(): boolean {
    if (this.dashCd > 0 || this.dashRecharge > 0) return false
    if (!this.grounded && this.airDashUsed) return false
    return true
  }

  /** CONDITIONED VARIANT RESOLUTION: snapshot the full tactical context at
   * the input instant — airborne, input-vs-facing, momentum, threat
   * geometry (nearest live enemy AHEAD of the dash vector: pocket <170 /
   * hunt band 240–640), surrounded flag, chain count — and hand it to the
   * pure evaluator (combat/dash.ts). Different conditions activate
   * genuinely different animations of the same movement. */
  private pickDashVariant(w: WorldRef, dx: number, dy: number): DashVariant {
    const dirX = Math.sign(dx || this.face)
    let aheadD = Infinity
    for (const e of w.enemies) {
      if (e.dead || e.spawning) continue
      const d = Math.abs(e.x - this.x)
      if (Math.sign(e.x - this.x) === dirX && d < aheadD) aheadD = d
    }
    const hasAhead = aheadD !== Infinity
    return evaluateDash({
      grounded: this.grounded,
      dx, dy, face: this.face,
      speed: Math.abs(this.vx),
      pocketTarget: hasAhead && aheadD < 170,
      huntTarget: hasAhead && aheadD > 240 && aheadD < 640,
      surrounded: this.surrounded,
      enemyNearW: this.enemyNearW,
      chain: this.dashConsec,
    })
  }

  startDash(w: WorldRef, ax: number, ay: number): void {
    w.input.takeBuffered('dash')
    this.peaceT = 0
    this.sheathAct = null
    let dx = ax
    let dy = ay
    if (dx === 0 && dy === 0) dx = this.face
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len

    // ---- conditioned variant + its tuned config ----
    const variant = this.pickDashVariant(w, dx, dy)
    this.dashVariant = variant
    const cfg = DASH_VARIANTS[variant]
    this.dashCfg = cfg

    // facing rules: forward-family/air dashes follow travel; retreats keep
    // the guard trained on the threat (the MGR dash-in / dash-out rhythm —
    // attack after a backdash lunges back toward the enemy)
    const forwardFamily = variant === 'launch' || variant === 'chain'
      || variant === 'carry' || variant === 'hunt' || variant === 'pierce'
      || variant === 'air'
    if (forwardFamily && dx !== 0) {
      if (dx > 0 !== (this.face > 0)) {
        // carve the flip: the body unwinds through the 180° pivot
        this.turnT = 1
        this.turnDir = this.face
      }
      this.face = dx > 0 ? 1 : -1
    }

    // ---- adaptive generosity: retreating with an enemy INSIDE melee
    // range earns a wider dodge window (on top of the variant's own) ----
    let iframes = cfg.iframes
    if (variant === 'retreat' || variant === 'carve') {
      if (this.nearestEnemy(w, 170)) iframes += 0.04
    }

    this.dashDx = dx
    this.dashDy = dy
    this.state = 'dash'
    this.dashDur = cfg.dur
    this.dashT = cfg.dur
    this.dashGhostIdx = 0
    this.dashSpd = DASH_SPEED * cfg.spd
    this.dashCd = DASH_CD
    this.dashConsec++
    this.dashChainT = 0.45 // dashes within 0.45s link into a chain
    if (this.dashConsec >= 2) this.dashRecharge = DASH_RECHARGE
    if (!this.grounded) this.airDashUsed = true
    this.iframes = Math.max(this.iframes, iframes)
    this.dropAction()
    this.charging = false
    this.dashHandoff = false
    this.vx = dx * this.dashSpd
    this.vy = dy * this.dashSpd * (this.grounded && dy < -0.4 ? 0.55 : 1)

    // ---- clip + presentation per variant (entry blend is momentum-
    // matched: carry blends longer because the run already matches) ----
    const colors = this.sword.colors
    this.animator.play(cfg.clip, { blend: cfg.blend, speed: variant === 'chain' ? 1.12 : 1 })

    w.audio.play('dash', { pitch: rand(cfg.pitch[0], cfg.pitch[1]) })

    // ---- LAUNCH FX — THE CLEAN READ (replaces the old particle clutter):
    // ONE HDR velocity line along the true travel vector + a ground shadow
    // smear under the path. Shadow & light language, no confetti. The
    // per-variant afterimages (shadow silhouettes, updateDash) do the rest.
    {
      const reach = cfg.dur * this.dashSpd
      const long = variant === 'hunt' || variant === 'pierce'
        ? 1.28 : variant === 'carry' || variant === 'chain' ? 1.12 : 1
      const lineLen = Math.min(200, reach * 0.6) * long
      w.fx.motionLine(
        this.x + dx * 20, this.y - 46 + dy * 20,
        dx, dy, lineLen, 0.26, colors.core,
      )
      if (this.grounded) {
        w.fx.shadowSmear(this.x + dx * reach * 0.42, reach * 0.34, 0.4)
      }
    }

    // lens strain + camera bite scale with aggression
    w.fx.chroma(cfg.chroma)
    w.cam.addTrauma(cfg.trauma)
  }

  private updateDash(dt: number, w: WorldRef): void {
    this.dashT -= dt
    const k = 1 - this.dashT / this.dashDur
    // SHADOW-SILHOUETTE afterimages — the dark ghost trail with the backlit
    // rim. THREE beats only (research cap), fired as dash-progress fractions
    // [0.18, 0.5, 0.85]: spacing widens down the trail (acceleration read)
    // and each ghost starts DARKER (a0 0.5 → 0.36 → 0.24) with a shorter
    // life — a clean cut to nothing at the exit instead of a fading cloud.
    while (this.dashGhostIdx < 3 && k >= DASH_GHOST_BEATS[this.dashGhostIdx]) {
      const gi = this.dashGhostIdx
      w.fx.shadowGhost(
        this.pose, this.x, this.hipY, this.face, this.dashDx,
        this.sword.colors.core, 0.3 - gi * 0.05, SCALE, DASH_GHOST_A0[gi],
      )
      this.dashGhostIdx++
    }
    // velocity envelope (combat/dash.ts): entry burst → sustain plateau →
    // quadratic tail bleed. Hunt/pierce HOLD full speed through the mid
    // dash (the hunger); launch bleeds immediately into the exit handoff.
    const sp = this.dashSpd * dashEnvelope(k, this.dashCfg.sustain)
    this.vx = this.dashDx * sp
    this.vy = this.dashDy * sp * (this.grounded ? (this.dashDy < 0 ? 0.4 : 1) : 1)

    // dash attack (kept: light = through-cut, heavy = piercing fang)
    const input = w.input
    if (input.pressed('light') || input.buffered('light')) {
      input.takeBuffered('light')
      this.startAttack(ATTACKS.dashSlash, w)
      return
    }
    if (input.pressed('heavy') || input.buffered('heavy')) {
      if (!this.grounded) {
        input.takeBuffered('heavy')
        this.startAttack(ATTACKS.slam, w)
        return
      }
      input.takeBuffered('heavy')
      this.startAttack(ATTACKS.dashHeavy, w)
      return
    }
    if (this.dashT <= 0) {
      this.state = 'move'
      this.dashEndedAt = w.time
      // retreat family: commit the facing toward the threat through the
      // recovery beat (see retreatLockT — the guard never turns its back)
      if (this.dashVariant === 'retreat' || this.dashVariant === 'carve' || this.dashVariant === 'vault') {
        this.retreatLockT = 0.45
      }
      // ---- MOMENTUM EXIT (the smoothness law): never a dead stop ----
      const ax = input.axisX()
      const dirHeld = Math.sign(ax) === Math.sign(this.dashDx) && Math.abs(ax) > 0.25
      const retreat = this.dashVariant === 'retreat' || this.dashVariant === 'carve'
      if (this.grounded) {
        if (dirHeld && Math.abs(this.dashDx) > 0.35) {
          // HANDOFF: dash speed decays into locomotion. The forward lunge
          // hands off sprint-worthy speed (the player FEELS carried, not
          // braked); the retreat variants hand off at BACKPEDAL pace — a
          // guarded retreat must never convert into a full-speed fleeing
          // run with the guard dropped (the facing logic would flip the
          // body away from the threat mid-retreat)
          const cap = retreat ? 250 : SPRINT_MAX
          const exitSp = Math.min(Math.abs(this.vx), cap)
          this.vx = Math.sign(this.dashDx) * exitSp
          this.dashHandoff = true
        } else if (retreat) {
          // retreat brake: a short hop cuts DEEP and settles through the
          // clip's own guard tail — never the forward landing skid (the
          // guarded retreat would visually pitch chest-first into a crouch)
          this.vx *= 0.45
        } else {
          // forward brake: soften the cut, then the physical skid takes over
          this.vx *= 0.72
          if (Math.abs(this.vx) > 240) {
            // dark skid streak (shadow language — not a dust puff cloud)
            w.fx.shadowSmear(this.x - Math.sign(this.vx) * 20, 26, 0.4)
            this.landSpring = 0.35
            this.animator.play(LAND_CLIP, { blend: 0.05 })
          }
        }
      } else {
        this.vy *= 0.5
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* attacks / combo machine                                              */
  /* ------------------------------------------------------------------ */

  private pickLight(w: WorldRef, ax: number, ay: number): string {
    // contextual branches
    if (ay < -0.4 && this.grounded) return 'launcher'
    if (ay > 0.4 && this.grounded) return 'spin'
    if (this.grounded && ax !== 0 && Math.sign(ax) !== this.face) return 'retreat'
    if (!this.grounded) {
      if (ay > 0.4) return 'dive'
      this.airIndex = (this.airIndex % 3) + 1
      return `a${this.airIndex}`
    }
    // ground light chain (with time decay)
    if (w.time - this.lastLightAt > 1.1) this.lightIndex = 0
    this.lightIndex = Math.min(this.lightIndex + 1, 5)
    return `l${Math.min(this.lightIndex, 5)}`
  }

  /** Heavy CHAIN: Kiri Oroshi → Tsuki → Grand Slam. Sequential like the
   * light chain, with time decay — heavy attacks finally have combo
   * pairing instead of one animation forever. */
  private pickHeavy(w: WorldRef): AttackDef {
    if (w.time - this.lastHeavyAt > 1.15) this.heavyIndex = 0
    this.heavyIndex = Math.min(this.heavyIndex + 1, 3)
    return ATTACKS[`h${this.heavyIndex}`] ?? ATTACKS.h1
  }

  /** abandon the current attack cleanly. CRITICAL: the slash trail must
   * be ENDED — an emitting trail never ages out on its own, so an action
   * dropped without this (hurt interrupt / scripted entry / dash-cancel)
   * leaves an ETERNAL frozen ribbon on screen. */
  private dropAction(): void {
    const a = this.action
    if (!a) return
    if (a.trail.emitting) {
      a.trail.emitting = false
      a.trail.age = 0
      a.trail.life = 0.22
    }
    this.action = null
  }

  startAttack(def: AttackDef, w: WorldRef, fromParry = false): void {
    if (!def) return
    this.peaceT = 0
    this.sheathAct = null
    // IN-BETWEEN LAW: capture the source state BEFORE switching — chained
    // attacks crossfade slower (0.11s) than fresh entries (0.07s) so every
    // transition between animation instances gets real in-betweens.
    const wasAttack = this.state === 'attack'
    // requirement checks
    if (def.requires === 'ground' && !this.grounded) def = ATTACKS.a1
    if (def.requires === 'air' && this.grounded) def = ATTACKS.l1

    // face toward held direction at attack start
    const ax = w.input.axisX()
    if (ax !== 0 && !fromParry) {
      this.face = ax > 0 ? 1 : -1
    } else if (!fromParry) {
      // SOFT AIM: no direction held → face the nearest threat. Every swing
      // commits toward a real target — the root of "aimed at different
      // angles": cuts should converge on the enemy, not on empty planes.
      const tgt = this.nearestEnemy(w, 600)
      if (tgt && Math.abs(tgt.x - this.x) > 24) {
        this.face = tgt.x > this.x ? 1 : -1
      }
    }

    // heavy chain bookkeeping (h1 → h2 → h3 sequencing)
    const hm = /^h([123])$/.exec(def.id)
    if (hm) {
      this.heavyIndex = Number(hm[1])
      this.lastHeavyAt = w.time
    }
    if (/^l[1-5]$/.test(def.id)) this.lastLightAt = w.time

    // HYPER-ARMOR: the charged release cannot be interrupted (the root
    // cause of "charged never hits" — enemies struck mid-swing cancelled it)
    if (def.id === 'charged') this.armorT = 0.5

    const trail = w.fx.startTrail(this.sword.colors.trail, this.sword.colors.trail2, this.sword.trailWidth)
    this.hasPrevBlade = false
    this.hasPrevAng = false
    this.action = {
      def,
      animT: 0,
      hitMap: new Map(),
      trail,
      sfxDone: false,
      moveDone: false,
      moveYDone: false,
      impactDone: false,
      overshootDone: false,
      flashDone: !def.drawFlash,
      fromParry,
    }
    if (fromParry) this.riposteT = 0
    this.swordArc.begin() // sword-led arc: reset the engage capture
    this.state = 'attack'
    this.charging = false
    // ANIME TIMING: attack bodies play "on twos" (24Hz stepped keys —
    // crisp, keyframed combat beats à la GG Strive) while blade physics,
    // smears, and trails run full-rate on the procedural layers.
    this.animator.play(def.clip, { blend: wasAttack ? 0.11 : 0.07, speed: this.atkSpeed, stepRate: 24 })
    // slight ground friction during attacks
  }

  private updateAttack(dt: number, w: WorldRef): void {
    const a = this.action
    if (!a) {
      this.state = 'move'
      return
    }
    const def = a.def
    a.animT = this.animator.getTime()
    const animT = a.animT
    const spd = this.atkSpeed

    // ground friction / air drag during attack
    if (this.grounded) {
      const f = 900 * dt
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f
    }

    // sfx event
    if (!a.sfxDone && animT >= def.swingSfx.t) {
      a.sfxDone = true
      w.audio.play(def.swingSfx.name, { pitch: rand(0.94, 1.08) })
    }
    // iai SNAP-DRAW flash release: the blade clears the saya in one frame —
    // a localized light event + a 2-frame stretch on the steel sells it.
    if (!a.flashDone && animT >= def.trail.start) {
      a.flashDone = true
      const c = this.sword.colors
      w.fx.burst(this.blade.tx, this.blade.ty, 7, c.core, 300, 0.3, 'spark')
      w.fx.shockwave(this.blade.tx, this.blade.ty, 46, c.glow, 0.18, 3)
      w.cam.addTrauma(0.05)
      this.swingScale = Math.max(this.swingScale, 1.3) // velocity stretch
    }
    // forward impulse
    if (!a.moveDone && def.moveX !== undefined && animT >= (def.moveXAt ?? def.hit.start)) {
      a.moveDone = true
      this.vx = this.face * def.moveX * (def.kind === 'dash' ? 1 : 1)
    }
    // vertical impulse (launcher hop / slam plunge)
    if (!a.moveYDone && def.moveY !== undefined && animT >= (def.moveYAt ?? 0)) {
      a.moveYDone = true
      this.vy = def.moveY
      if (def.moveY < 0) {
        this.grounded = false
        w.fx.dust(this.x, 0, 6)
      }
    }

    // hit window: sample blade segment & test enemies (swept, anti-tunneling)
    const h = def.hit
    if (animT >= h.start && animT <= h.end) {
      this.swingGlow = 1
      const info = makeRuntimeInfo(def, this.sword.stats.dmg)
      // DASH THROUGH-CUT: the iai pass cuts everything the dash swept
      // through — the player crosses the target at 980px/s BEFORE the
      // attack anim even starts, so the blade-only segment points past
      // them. The corridor is the DASH PATH itself: a fixed chest-height
      // band from 124px behind the player to 66px ahead — anchored to the
      // path (not the wandering kissaki, which wraps behind on the
      // follow-through and would collapse the span). This is the swept
      // volume of the through-cut.
      let curSeg = this.blade
      let usePrev = this.hasPrevBlade
      if (def.kind === 'dash') {
        curSeg = {
          bx: this.x - this.face * 124,
          by: this.y - 55,
          tx: this.x + this.face * 66,
          ty: this.y - 55,
        }
        usePrev = false
      }
      for (const e of w.enemies) {
        // spawning enemies within blade reach (landing pods, y > -90) are
        // fair game — the swing connects the moment the body crosses the arc
        if (e.dead || (e.spawning && e.y < -90)) continue
        const last = a.hitMap.get(e.id)
        const reArm = h.multiHit ? (last === undefined || animT - last >= h.multiHit) : last === undefined
        if (!reArm) continue
        if (bladeHitsBody(e, usePrev, this.prevBlade, curSeg, h.pad ?? 3)) {
          a.hitMap.set(e.id, animT)
          w.hitEnemy(e.id, this.blade, info)
          this.onLandedHit(w, info, e.x, e.y - 48 * e.scale)
        }
      }
      // remember this frame's blade for the next sweep test
      this.prevBlade.bx = this.blade.bx
      this.prevBlade.by = this.blade.by
      this.prevBlade.tx = this.blade.tx
      this.prevBlade.ty = this.blade.ty
      this.hasPrevBlade = true
      // aoe shockwave at strike moment for heavy hits — the wave is REAL:
      // enemies inside the radius eat the strike (the charged/h3 promise:
      // the shockwave visual must connect, not just decorate)
      if (h.aoe && h.aoe > 0 && !a.impactDone && this.grounded && animT >= h.start + 0.02) {
        a.impactDone = true
        w.fx.shockwave(this.x + this.face * 30, 0, h.aoe, this.sword.colors.glow, 0.4, 6)
        if (this.grounded) w.fx.groundCrack(this.x + this.face * 34, 0, h.aoe * 0.45)
        for (const e of w.enemies) {
          if (e.dead || e.spawning) continue
          if (a.hitMap.has(e.id) && !h.multiHit) continue
          if (Math.abs(e.x - this.x) < h.aoe && e.y > -140) {
            a.hitMap.set(e.id, animT)
            w.hitEnemy(e.id, this.blade, info)
            this.onLandedHit(w, info, e.x, e.y - 48 * e.scale)
          }
        }
      }
    }

    // OVERSHOOT (follow-through law): as the active window closes, inject a
    // 2-frame rotational impulse — the tip pushes PAST the stop point and
    // the wrist spring elastic-snaps it back. Stopping dead reads weightless.
    if (!a.overshootDone && animT > h.end && this.armVel !== 0) {
      a.overshootDone = true
      this.bladeLagVel += Math.sign(this.armVel) * 2.4
    }

    // trail emission
    if (animT >= def.trail.start && animT <= def.trail.end) {
      w.fx.pushTrail(a.trail, this.blade.bx, this.blade.by, this.blade.tx, this.blade.ty)
    } else if (animT > def.trail.end && a.trail.emitting) {
      w.fx.endTrail(a.trail)
    }

    // cancel window → allow chaining / dash-cancel / jump-cancel
    const dashCancel = animT >= h.end * 0.6
    if (animT >= def.cancel || dashCancel) {
      const input = w.input
      if ((input.pressed('dash') || input.buffered('dash')) && this.canDash()) {
        w.fx.endTrail(a.trail)
        this.startDash(w, input.axisX(), input.axisY())
        return
      }
      if (input.pressed('parry')) {
        w.fx.endTrail(a.trail)
        this.enterParry(w)
        return
      }
      if (animT >= def.cancel) {
        // chain next attack
        const ax = input.axisX()
        const ay = input.axisY()
        let next: string | null = null
        if (input.buffered('light')) {
          input.takeBuffered('light')
          next = this.riposteT > 0 && this.grounded ? 'riposte' : this.pickLight(w, ax, ay)
        } else if (input.buffered('heavy')) {
          input.takeBuffered('heavy')
          if (!this.grounded) {
            next = 'slam'
          } else if (input.down('heavy')) {
            // still holding → convert to charge
            this.enterCharge(w)
            w.fx.endTrail(a.trail)
            return
          } else {
            // advance the heavy CHAIN (h1 → h2 → h3) like the light chain
            const heavyNext = def.chain.find((c) => /^h[123]$/.test(c))
            next = heavyNext ?? (def.kind === 'heavy' ? 'l1' : 'h1')
          }
        }
        if (next) {
          // validate chain (or allow from-parry riposte)
          if (fromChain(def, next, this)) {
            w.fx.endTrail(a.trail)
            this.startAttack(ATTACKS[next], w)
            return
          }
        }
        // jump cancel on ground
        if (this.grounded && (input.pressed('jump') || input.buffered('jump', 0.15))) {
          w.fx.endTrail(a.trail)
          this.doJump(w)
          this.state = 'move'
          return
        }
      }
    }

    // finish — capture the swing's final rotational momentum: the body
    // carries it into locomotion (post-attack recovery, spec §7)
    if (this.animator.isDone()) {
      w.fx.endTrail(a.trail, 0.18)
      this.postAttackT = 0.34
      this.postArmVel = this.armVel
      this.action = null
      this.state = 'move'
    }
  }

  private onLandedHit(w: WorldRef, info: AttackRuntimeInfo, ex: number, ey: number): void {
    this.energy = Math.min(this.maxEnergy, this.energy + 5)
    this.meter = Math.min(100, this.meter + info.dmg * 0.32)
    // ANIME IMPACT FRAME (research: 1-2 frame white beat at contact): heavy
    // connects flash the whole silhouette white through the hit-stop — the
    // classic anime cut-in. Lighter hits keep the spark burst only.
    if (info.hitstop >= 0.07 && this.impactFlashT <= 0) {
      this.impactFlashT = 0.085
    }
    // elemental on-hit flourishes
    const c = this.sword.colors
    const dir = Math.atan2(ey - this.y + 40, ex - this.x)
    switch (this.sword.id) {
      case 'inferno':
        w.fx.embers(ex, ey, 5, c.accent, 18)
        break
      case 'thunder': {
        // RAY-TRACED DISCHARGE: the steel dumps its charge into the wound —
        // the bolt leaps from the contact point along the blade axis, then
        // REFLECTS off the struck body (mirror law about the hit normal)
        // onto the next target, skating the wet ground between hops.
        // Energy decays 40% per body; width + damage ride the energy.
        if (Math.random() < 0.4) {
          const bdx = this.blade.tx - this.blade.bx
          const bdy = this.blade.ty - this.blade.by
          const bl = Math.hypot(bdx, bdy) || 1
          w.fx.lightningCast(
            { enemies: w.enemies, minX: w.arenaMinX, maxX: w.arenaMaxX },
            ex, ey,
            bdx / bl + rand(-0.25, 0.25), bdy / bl + rand(-0.25, 0.25),
            {
              color: c.trail, energy: 0.85, bounces: 2, dmg: 7,
              width: 2.2, maxLen: 380,
              hit: (e, d) => {
                if (e.id !== undefined) {
                  this.dealAbilityDamage(w, e as unknown as EnemyLike, d, 0.02, 60, -40)
                }
              },
            },
          )
        }
        break
      }
      case 'void':
        w.fx.burst(ex, ey, 4, c.core, 120, 0.4, 'shard')
        break
      case 'gravity':
        w.fx.burst(ex, ey, 3, c.accent, 60, 0.5, 'ember')
        break
      case 'phantom':
        w.fx.slashArc(ex, ey, dir + rand(-0.5, 0.5), 1.4, 30, c.trail, c.trail2)
        break
      default:
        break
    }
  }

  /* ------------------------------------------------------------------ */
  /* parry / riposte                                                      */
  /* ------------------------------------------------------------------ */

  private enterParry(w: WorldRef): void {
    w.input.takeBuffered('parry')
    this.state = 'parry'
    this.parryT = 0.3
    this.parryActive = 0.17
    this.parryPerfect = true
    this.dropAction()
    this.charging = false
    if (this.grounded) this.vx *= 0.2
    this.animator.play(PARRY_CLIP, { blend: 0.06 })
    w.audio.play('parry', { volume: 0.4, pitch: 1.15 })
  }

  private updateParry(dt: number, w: WorldRef): void {
    this.parryT -= dt
    this.parryActive -= dt
    if (this.grounded) {
      const f = 1200 * dt
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f
    }
    if (this.parryT <= 0) {
      this.state = 'move'
    }
  }

  /** Called by Game when an enemy strike connects while parry window is open. */
  onParrySuccess(w: WorldRef, sourceX: number, perfect: boolean): void {
    const colors = this.sword.colors
    const px = (this.x + sourceX) / 2
    const py = this.y - 55
    w.fx.impactFrame(px, py, colors.glow) // the counter's kill frame
    w.fx.impact(px, py, Math.atan2(0, sourceX - this.x), true, colors.glow, '#ffffff')
    w.fx.shockwave(px, py, 90, colors.glow, 0.3, 5)
    w.fx.screenFlash('#ffffff', 0.22, 6)
    w.audio.play(perfect ? 'parryPerfect' : 'parry')
    w.addHitstop(0.11, 0.1)
    w.addSlowmo(0.25, 0.22)
    w.cam.addTrauma(0.3)
    w.cam.zoomPulse(0.12)
    this.meter = Math.min(100, this.meter + 10)
    this.energy = Math.min(this.maxEnergy, this.energy + 12)
    this.riposteT = 0.95
    this.parryT = 0.12
    this.parryActive = 0
    this.flashT = 0.6
    // LIGHTNING PARRY (thunder): the incoming strike's kinetic line
    // reflects off the blade plane (mirror law about the steel's normal)
    // and discharges back down the reflected ray — parries RETURN fire
    if (this.sword.id === 'thunder' && this.swordDrawn) {
      const inDx = Math.sign(this.x - sourceX) || 1
      const r = reflectOffSegment(inDx, 0.08, this.blade.bx, this.blade.by, this.blade.tx, this.blade.ty)
      w.fx.lightningCast(
        { enemies: w.enemies, minX: w.arenaMinX, maxX: w.arenaMaxX },
        this.blade.tx, this.blade.ty, r.dx, r.dy,
        {
          color: colors.trail, energy: 0.9, bounces: 2, dmg: 12, width: 2.6, maxLen: 420,
          hit: (e, d) => {
            if (e.id !== undefined) {
              this.dealAbilityDamage(w, e as unknown as EnemyLike, d, 0.1, 90, -60)
            }
          },
        },
      )
    }
  }

  /* ------------------------------------------------------------------ */
  /* charge                                                               */
  /* ------------------------------------------------------------------ */

  private enterCharge(w: WorldRef): void {
    this.state = 'charge'
    this.charging = true
    this.chargeT = 0
    this.chargeReady = false
    this.dropAction()
    if (this.grounded) this.vx = 0
    this.animator.play(CHARGE_CLIP, { blend: 0.08 })
    w.audio.play('charge', { volume: 0.5 })
  }

  private updateCharge(dt: number, w: WorldRef): void {
    const input = w.input
    this.chargeT += dt
    if (!this.chargeReady && this.chargeT >= 0.55) {
      this.chargeReady = true
      w.audio.play('chargeReady')
    }
    // converge particles on the blade
    if (this.chargeReady && Math.random() < 0.5) {
      const c = this.sword.colors
      w.fx.embers(this.blade.tx, this.blade.ty, 2, c.glow, 10)
      // THUNDER: tesla-crawl — micro-arcs snapping grip→monouchi along the
      // steel (~15Hz pair cadence — a crackling capacitor, not a laser show)
      if (this.sword.id === 'thunder' && Math.random() < 0.55) {
        w.fx.lightningCrawl(this.blade.bx, this.blade.by, this.blade.tx, this.blade.ty, c.trail)
      }
    }
    if (this.grounded) this.vx = 0

    // release
    if (!input.down('heavy')) {
      this.charging = false
      if (this.chargeT >= 0.4) {
        this.startAttack(ATTACKS.charged, w)
        w.audio.play('chargeReady', { pitch: 0.8 })
        return
      }
      // too short: treat as heavy tap
      this.startAttack(this.pickHeavy(w), w)
      return
    }
    // dash cancels charge
    if ((input.pressed('dash') || input.buffered('dash')) && this.canDash()) {
      this.charging = false
      this.startDash(w, input.axisX(), input.axisY())
    }
  }

  /* ------------------------------------------------------------------ */
  /* hurt / death                                                         */
  /* ------------------------------------------------------------------ */

  takeDamage(w: WorldRef, dmg: number, dir: number, heavy: boolean): boolean {
    if (this.iframes > 0 || this.state === 'dash' || this.state === 'dead' || this.state === 'scripted') return false
    // HYPER-ARMOR (charged release): the swing is uninterruptible — damage
    // bleeds at 35%, no knockback, no hurt state. The commitment reads as
    // power instead of a liability.
    if (this.armorT > 0) {
      this.hp = Math.max(0, this.hp - dmg * 0.35)
      this.flashT = Math.max(this.flashT, 0.45)
      if (this.hp <= 0) {
        this.state = 'dead'
        this.deadT = 0
        this.armorT = 0
        this.vx = dir * 300
        this.vy = -420
        w.audio.play('hurt', { volume: 0.8, intensity: 1 })
      } else {
        w.fx.burst(this.x, this.y - 50, 4, '#ffb14a', 140, 0.4, 'spark')
      }
      return true
    }
    this.hp = Math.max(0, this.hp - dmg)
    this.flashT = 1
    this.hurtT = 0.34
    this.iframes = 0.75
    this.dropAction()
    this.charging = false
    this.ability = null
    this.state = 'hurt'
    this.vx = dir * (heavy ? 380 : 240)
    if (!this.grounded) this.vy = -220
    else this.vy = heavy ? -320 : -140
    this.grounded = false
    this.animator.play(HURT_CLIP, { blend: 0.05 })
    w.audio.play('hurt', { volume: 0.8, intensity: heavy ? 1 : 0.5 })
    w.fx.burst(this.x, this.y - 50, 10, '#ff3b57', 300, 0.5, 'spark')
    w.fx.screenFlash('#ff2a4a', 0.2, 4)
    w.cam.addTrauma(heavy ? 0.45 : 0.3)
    w.addHitstop(0.06)
    if (this.hp <= 0) {
      this.state = 'dead'
      this.deadT = 0
      this.vx = dir * 300
      this.vy = -420
    }
    return true
  }

  private updateHurt(dt: number, w: WorldRef): void {
    this.hurtT -= dt
    if (this.hurtT <= 0) this.state = 'move'
    if (this.grounded) {
      const f = 1400 * dt
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f
    }
  }

  private updateDead(dt: number, _w: WorldRef): void {
    this.deadT += dt
    // ragdoll-ish settle
    if (this.grounded) this.vx = damp(this.vx, 0, 4, dt)
  }

  /* ------------------------------------------------------------------ */
  /* scripted (ult / execution cinematics driven by Game)                 */
  /* ------------------------------------------------------------------ */

  enterScripted(): void {
    this.state = 'scripted'
    this.dropAction()
    this.charging = false
    this.vx = 0
  }

  exitScripted(): void {
    if (this.state === 'scripted') this.state = 'move'
    this.animator.play(IDLE_CLIP, { blend: 0.1 })
  }

  private updateScripted(_dt: number): void {
    if (this.grounded) this.vx = 0
  }

  playClip(clip: Parameters<Animator['play']>[0], speed = 1): void {
    this.animator.play(clip, { blend: 0.03, speed, restart: true })
  }

  /* ------------------------------------------------------------------ */
  /* abilities                                                            */
  /* ------------------------------------------------------------------ */

  startAbility(w: WorldRef): void {
    const cost = this.sword.ability.cost
    this.energy -= cost
    w.audio.play('energyFull', { volume: 0.4, pitch: 0.9 })
    this.ability = { kind: this.sword.id, t: 0, step: 0, targets: [], x: this.x, y: this.y }
    const c = this.sword.colors
    w.fx.screenFlash(c.trail, 0.14, 4)
    w.cam.zoomPulse(0.1)

    switch (this.sword.id) {
      case 'katana': {
        // BLADE STORM — chain of teleport dashes through nearest enemies
        this.enterScripted()
        w.audio.play('dash', { pitch: 1.2 })
        break
      }
      case 'inferno': {
        // INFERNO WAVE — rolling fire projectile
        w.audio.play('fire', { intensity: 1 })
        w.spawnProjectile({
          kind: 'firewave', x: this.x + this.face * 46, y: -12,
          vx: this.face * 560, vy: 0, dmg: 38 * this.sword.stats.dmg, life: 1.4,
        })
        w.fx.shockwave(this.x + this.face * 40, 0, 120, c.glow, 0.5, 7)
        w.fx.burst(this.x + this.face * 50, -20, 18, c.trail, 420, 0.6, 'ember')
        w.cam.addTrauma(0.35)
        this.animator.play(ATTACKS.l5.clip, { blend: 0.04, speed: 1.15 })
        break
      }
      case 'thunder': {
        // THUNDER RUSH — instant dash + RAY-TRACED chain lightning: the
        // traveled line electrifies AND a discharge ray reflects
        // body→body through the pack with intent (each reflection
        // candidate is scored against the next live target)
        this.enterScripted()
        const startX = this.x
        this.x = clamp(this.x + this.face * 300, w.arenaMinX + 30, w.arenaMaxX - 30)
        w.audio.play('lightning', { intensity: 1 })
        w.fx.afterimage(this.pose, this.x, this.hipY, this.face, c.trail, 0.4, SCALE)
        w.fx.speedStreaks(this.x, this.y - 40, this.face * 900, 10, rgba(c.trail, 1))
        const rw = { enemies: w.enemies, minX: w.arenaMinX, maxX: w.arenaMaxX }
        // the path itself rides a bolt (no damage — pure line)
        w.fx.lightningCast(rw, startX, this.y - 55, this.face, 0, {
          color: c.trail, energy: 1, bounces: 1, width: 3, maxLen: 340,
        })
        // the discharge from the exit blade: bounces through the pack
        w.fx.lightningCast(rw, this.x + this.face * 30, this.y - 55, this.face, -0.15, {
          color: c.trail, energy: 1, bounces: 4, dmg: 24, width: 3.2, maxLen: 480,
          hit: (e, d) => {
            if (e.id === undefined) return
            this.dealAbilityDamage(w, e as unknown as EnemyLike, d, 0.35, 160, -180)
            w.fx.burst(e.x, e.y - 40, 6, c.accent, 200, 0.4, 'spark')
          },
        })
        w.cam.addTrauma(0.4)
        w.addHitstop(0.08)
        this.exitScriptedSoon = 0.35
        break
      }
      case 'void': {
        // VOID STEP — teleport into densest cluster + implode
        this.enterScripted()
        const target = this.findDensest(w, 200)
        if (target) {
          w.fx.dissolve(this.x, this.y - 50, c.core, c.glow)
          this.x = clamp(target.x + (target.x > this.x ? -70 : 70), w.arenaMinX + 30, w.arenaMaxX - 30)
          this.face = target.x > this.x ? 1 : -1
          w.fx.dissolve(this.x, this.y - 50, c.core, c.glow)
          w.audio.play('void', { intensity: 1 })
          w.fx.shockwave(this.x, 0, 160, c.glow, 0.5, 8)
          for (const e of w.enemies) {
            if (e.dead || e.spawning) continue
            if (Math.abs(e.x - this.x) < 130 && e.y > -160) {
              this.dealAbilityDamage(w, e, 34, 0.5, 100, -420)
            }
          }
          this.animator.play(ATTACKS.charged.clip, { blend: 0.02, speed: 1.3 })
          w.addHitstop(0.1, 0.12)
          w.addSlowmo(0.3, 0.3)
          w.cam.addTrauma(0.5)
        }
        this.exitScriptedSoon = 0.4
        break
      }
      case 'gravity': {
        // GRAVITY CRUSH — pull, suspend, slam
        this.enterScripted()
        w.audio.play('gravity', { intensity: 1 })
        w.fx.shockwave(this.x, 0, 240, c.glow, 0.7, 9)
        for (const e of w.enemies) {
          if (e.dead || e.spawning) continue
          const dx = this.x - e.x
          if (Math.abs(dx) < 260 && e.y > -200) {
            e.vx = dx * 3.2
            e.vy = -rand(380, 480)
            e.launched = true
            this.ability.targets.push(e.id)
          }
        }
        this.animator.play(ATTACKS.h3.clip, { blend: 0.04, speed: 1.2 })
        this.exitScriptedSoon = 0.75
        break
      }
      case 'phantom': {
        // PHANTOM BARRAGE — delayed echo slashes
        this.enterScripted()
        const targets = this.collectNearest(w, 4, 420)
        this.ability.targets = targets.map((e) => e.id)
        w.audio.play('phantom', { intensity: 1 })
        break
      }
    }
  }

  /** set > 0 to auto-exit scripted state after t seconds */
  exitScriptedSoon = 0

  private updateAbility(dt: number, w: WorldRef): void {
    const ab = this.ability
    if (!ab) return
    ab.t += dt
    if (this.exitScriptedSoon > 0) {
      this.exitScriptedSoon -= dt
      if (this.exitScriptedSoon <= 0) {
        this.exitScripted()
        if (ab.kind !== 'gravity') this.ability = null
      }
    }

    const c = this.sword.colors

    switch (ab.kind) {
      case 'katana': {
        // storm: dash-slash through a new enemy every 0.13s, 6 steps
        const interval = 0.13
        if (ab.t >= ab.step * interval && ab.step < 6) {
          ab.step++
          const targets = this.collectNearest(w, 6, 520).filter((e) => !ab.targets.includes(e.id))
          const tgt = targets[0]
          if (tgt) {
            ab.targets.push(tgt.id)
            w.fx.afterimage(this.pose, this.x, this.hipY, this.face, c.trail, 0.35, SCALE)
            w.fx.speedStreaks(this.x, this.y - 40, tgt.x - this.x, 6, rgba(c.trail, 1))
            this.x = clamp(tgt.x + (tgt.x > this.x ? -54 : 54), w.arenaMinX + 30, w.arenaMaxX - 30)
            this.face = tgt.x > this.x ? 1 : -1
            const ang = Math.atan2(tgt.y - 40 - (this.y - 55), tgt.x - this.x)
            w.fx.slashArc(tgt.x, tgt.y - 40, ang, 2.6, 66, c.trail, c.trail2)
            w.fx.impact(tgt.x, tgt.y - 40, ang, false, c.glow, c.accent)
            this.dealAbilityDamage(w, tgt, 16, 0.3, 140, -220)
            w.audio.play('swing', { pitch: rand(1.1, 1.3), volume: 0.7 })
            this.animator.play(ATTACKS.dashSlash.clip, { blend: 0.02, speed: 1.4 })
            w.cam.addTrauma(0.12)
            w.addHitstop(0.03)
          }
        }
        if (ab.step >= 6 && ab.t > 6 * interval + 0.2) {
          this.ability = null
          this.exitScripted()
        }
        break
      }
      case 'gravity': {
        // suspend hold, then crush at t=0.55
        if (ab.step === 0 && ab.t >= 0.55) {
          ab.step = 1
          w.audio.play('slam', { intensity: 1 })
          w.fx.shockwave(this.x, 0, 220, c.glow, 0.5, 10)
          w.fx.groundCrack(this.x, 0, 130)
          w.addHitstop(0.1)
          w.cam.addTrauma(0.5)
          for (const e of w.enemies) {
            if (e.dead || !ab.targets.includes(e.id)) continue
            if (Math.abs(e.x - this.x) < 240) {
              e.vy = 520
              this.dealAbilityDamage(w, e, 30, 0.5, 0, 0)
            }
          }
          this.animator.play(ATTACKS.h2.clip, { blend: 0.03, speed: 1.25 })
        }
        if (ab.t >= 1.0) {
          this.ability = null
          this.exitScripted()
        }
        break
      }
      case 'phantom': {
        // echoes every 0.2s
        const interval = 0.2
        if (ab.t >= ab.step * interval && ab.step < ab.targets.length) {
          const eid = ab.targets[ab.step]
          ab.step++
          const e = w.enemies.find((en) => en.id === eid && !en.dead)
          if (e) {
            const ang = rand(TAU_LIKE)
            w.fx.slashArc(e.x, e.y - 40, ang, 2.4, 60, c.trail, c.trail2, 1.2)
            w.fx.afterimage(this.pose, e.x - this.face * 60, this.hipY, this.face, c.trail, 0.4, SCALE)
            w.fx.impact(e.x, e.y - 40, ang, false, c.glow, c.accent)
            this.dealAbilityDamage(w, e, 18, 0.34, 120, -160)
            w.audio.play('swing', { pitch: rand(0.9, 1.1), volume: 0.6 })
          }
        }
        if (ab.step >= Math.max(ab.targets.length, 1) && ab.t > ab.targets.length * interval + 0.25) {
          this.ability = null
          this.exitScripted()
        }
        break
      }
      default:
        if (ab.t > 1.2) {
          this.ability = null
        }
    }
  }

  private collectNearest(w: WorldRef, n: number, range: number): EnemyLike[] {
    const list: EnemyLike[] = []
    for (const e of w.enemies) {
      if (e.dead || e.spawning) continue
      const d = Math.hypot(e.x - this.x, e.y - this.y)
      if (d < range) list.push({ id: e.id, x: e.x, y: e.y, d })
    }
    list.sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
    return list.slice(0, n)
  }

  private findDensest(w: WorldRef, range: number): EnemyLike | null {
    let best: EnemyLike | null = null
    let bestScore = -1
    for (const e of w.enemies) {
      if (e.dead || e.spawning) continue
      let score = 0
      for (const o of w.enemies) {
        if (o.dead || o.spawning) continue
        if (Math.abs(o.x - e.x) < range) score++
      }
      if (score > bestScore) {
        bestScore = score
        best = { id: e.id, x: e.x, y: e.y, d: 0 }
      }
    }
    return best
  }

  private dealAbilityDamage(w: WorldRef, e: EnemyLike, dmg: number, stagger: number, kb: number, kbY: number): void {
    const info: AttackRuntimeInfo = {
      id: 'ability', dmg: dmg * this.sword.stats.dmg, heavy: dmg > 20,
      stagger, kb, kbY, launch: kbY < -300 ? kbY : 0, juggle: kbY < -100 ? kbY : 0,
      hitstop: dmg > 20 ? 0.07 : 0.03, shake: dmg > 20 ? 0.25 : 0.1,
      aoe: 0, breakGuard: true, kind: 'ability',
    }
    w.hitEnemy(e.id, { bx: e.x - 20, by: e.y - 40, tx: e.x + 20, ty: e.y - 40 }, info)
    this.meter = Math.min(100, this.meter + dmg * 0.25)
  }

  /* ------------------------------------------------------------------ */
  /* animation glue                                                       */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* procedural layers: weight, blade physics, two-handed grip            */
  /* ------------------------------------------------------------------ */

  /** updateGait — drive the legik GaitPlanner. Engaged for grounded
   * locomotion (move state, not braking, not in the sheathe ritual); every
   * other state (attacks, dashes, air, hurt) parks the planner so the FK
   * clip legs apply, with only the plant-snap/clamp pass fixing contact. */
  private updateGait(dt: number, w: WorldRef): void {
    const active = this.state === 'move' && this.grounded && !this.braking && !this.sheathAct
    const tune = PLAYER_GAIT[this.loco] ?? PLAYER_GAIT.idle
    const speed = Math.abs(this.vx)
    // femoral midpoint in world space (geom solved this frame)
    const hipX = this.x + this.face * SCALE * this.geom.hip.x
    this.gait.update(hipX, this.vx, this.face, speed, tune, dt, active, Player.SOLE_W, this.grounded)
    // authority blend: in over ~90ms, out over ~180ms (hands off gently)
    this.gaitW = damp(this.gaitW, active ? 1 : 0, active ? 18 : 8, dt)
    // footfall feedback: a whisper of dust at real heel strikes (run+ only)
    if (this.gait.footfall && speed > 230) {
      w.fx.dust(this.gait.footfallX, 0, 2)
    }
  }

  /** FOOT-GROUND LOCK — the pelvis-height authority. With the gait active
   * the hip sits at the AUTHORED nominal height minus whatever the most-
   * extended planted leg allows (diagonal struts at contact drop the hips
   * — real weight acceptance); the authored rootY bob now reads exactly
   * once (the old flight-branch double-counted it away). For non-gait
   * grounded poses the lowest FK foot still pins the sole exactly; airborne
   * → nominal hip height (physics owns y).
   *
   * THE STANCE-LEG CONTRACT (the collapse fix — "no knee suspension"):
   * The leg-geometry bound `bound = f.y − vert(dx)` is only meaningful
   * while the planted foot is INSIDE the leg's reach annulus. A foot that
   * plants beyond horizontal reach (fast-stop strides: the old planner
   * predicted landings up to 110px ahead) drives vert → 0 → bound → ankle
   * height → the pelvis crashed to the floor with both knees locked
   * straight (hipY −65 → −7). Two guards now hold:
   *   1. dx is clamped into the reachable envelope before the sqrt — a
   *      stance foot can never claim a hip below 0.72·HIP_H (a deep but
   *      ALIVE lunge, never a collapse).
   *   2. femurT is bounded to [0.74, 1.0]·HIP_H in gait states — the hips
   *      neither stand on locked knees nor sink into a squat while
   *      locomoting. (Deep authored crouches — dash/land squats — go
   *      through the FK pin branch, which is untouched.) */
  private updateFootLock(dt: number): void {
    const g = this.geom
    const rootY = this.pose[CH.rootY]
    let target: number
    if (this.gaitW > 0.5 && this.gait.hasPlanted && this.grounded) {
      // GAIT: femur target height = authored nominal, limited by the
      // planted leg geometry (the pelvis can't outrun its own stance leg)
      const l1 = PLAYER_SPEC.thigh * SCALE
      const l2 = PLAYER_SPEC.shin * SCALE
      const reach = (l1 + l2) * 0.999
      // the stance foot's horizontal offset is bounded to the reachable
      // envelope: beyond it the leg cannot push the hip ANY lower, so the
      // bound saturates instead of collapsing to ankle height
      const dxMax = reach * 0.72
      let bound = -Infinity
      const feet: { x: number; y: number; fx: number }[] = [
        { x: this.gait.footL.x, y: this.gait.footL.y, fx: this.x + this.face * SCALE * g.hipPtL.x },
        { x: this.gait.footR.x, y: this.gait.footR.y, fx: this.x + this.face * SCALE * g.hipPtR.x },
      ]
      for (const f of feet) {
        if (f.y > -0.5) continue // swing foot target — not load-bearing
        const dx = clamp(Math.abs(f.x - f.fx), 0, dxMax)
        const vert = Math.sqrt(reach * reach - dx * dx)
        bound = Math.max(bound, f.y - vert)
      }
      // nominal effective femur height: hips at HIP_H, rootY bob applies once
      const nominal = -HIP_H + SCALE * rootY
      let femurT = Math.max(nominal, isFinite(bound) ? bound : nominal)
      // hip band (y-down: more-negative = taller):
      //   Math.max  — hips never ride ABOVE straight-leg height (stilt read)
      //   Math.min  — hips never SINK below 74% leg height while locomoting
      // (the old "crouch floor" Math.max(femurT, −1.16·HIP_H) never bound
      // the collapse, which arrived from ABOVE: femurT → −4.4 → hips on
      // the floor with locked knees. These two clamps are direction-checked
      // against the y-down sign convention: a stand (−66.9) passes both
      // untouched; a collapse (−4.4) is floored to −47.9.)
      femurT = Math.max(femurT, -HIP_H * 1.0)
      femurT = Math.min(femurT, -HIP_H * 0.74)
      // footLock ↔ hipY: effective femur = hipY + SCALE·hipPt.y = femurT
      target = SCALE * g.hipPtR.y - femurT
    } else if (this.grounded && this.state !== 'dead') {
      // FK stance pin: lowest ankle/toe owns the hip (captures lunges,
      // squats, attacks — anything with an extended leg near the floor)
      const lowContact = Math.max(g.ankleL.y, g.ankleR.y, g.toeL.y, g.toeR.y) + 2.4
      const support = lowContact * SCALE
      target = support >= HIP_H * 0.72 && support <= HIP_H * 1.2 ? support : HIP_H
    } else {
      // AIR: physics owns height; the authored rootY bob shows through the
      // geom exactly once (footLock constant — the old +rootY term canceled
      // it against the geom's own rootY, killing the clip bob outright)
      target = HIP_H
    }
    // critically-damped tracking (k=24): follows a 0.3s stride with ~2px
    // residual, and because the target itself is now bounded, the spring
    // can never be flung by a degenerate bound again
    this.footLock = damp(this.footLock, target, 24, dt)
  }

  /** GROUND IK — the leg writer. Two passes:
   *  1. GAIT pass (weight gaitW): re-solve both legs from the femoral heads
   *     to the planner's ankle targets — stance feet land EXACTLY on the
   *     ground line at their world-locked anchors, swing feet ride the arc.
   *     Knee always bends forward (anatomy). Toes from the gait pitch
   *     (heel-strike → flat → toe-off).
   *  2. PLANT pass (non-gait grounded states — attacks, dashes, brake,
   *     land): any leg that is EXTENDED and near the floor gets snapped by
   *     IK to exact sole contact at its authored x (stance feet never
   *     hover); any toe below the floor gets clamped up (the floor is
   *     solid). Airborne legs stay pure FK. */
  private applyGroundIK(dt: number): void {
    void dt
    const g = this.geom
    const l1 = PLAYER_SPEC.thigh
    const l2 = PLAYER_SPEC.shin
    const legLen = l1 + l2
    const w = this.gaitW
    this.snapContacts.length = 0

    if (w > 0.01) {
      const legs: [FootPlan, typeof g.hipPtL, typeof g.kneeL, typeof g.ankleL, typeof g.toeL][] = [
        [this.gait.footL, g.hipPtL, g.kneeL, g.ankleL, g.toeL],
        [this.gait.footR, g.hipPtR, g.kneeR, g.ankleR, g.toeR],
      ]
      for (const [fp, hipPt, knee, ankle, toe] of legs) {
        // world target → local (facing) space
        const tx = (fp.x - this.x) / (this.face * SCALE)
        const ty = (fp.y - this.hipY) / SCALE
        solveLegIK(hipPt.x, hipPt.y, tx, ty, l1, l2, 1, this.ikOut)
        knee.x += (this.ikOut.kx - knee.x) * w
        knee.y += (this.ikOut.ky - knee.y) * w
        ankle.x += (this.ikOut.ax - ankle.x) * w
        ankle.y += (this.ikOut.ay - ankle.y) * w
        toeFromPitch(ankle.x, ankle.y, fp.pitch, PLAYER_SPEC.foot, this.toeScratch)
        // the floor is solid: a plantarflexed toe-off toe never digs below it
        const groundLy = (-1.2 - this.hipY) / SCALE
        if (this.toeScratch.y > groundLy) this.toeScratch.y = groundLy
        toe.x += (this.toeScratch.x - toe.x) * w
        toe.y += (this.toeScratch.y - toe.y) * w
      }
    }

    // PLANT pass — exact contact for non-gait grounded stances + floor clamp
    if (w < 0.99 && this.grounded && this.state !== 'dead') {
      const legs: [typeof g.hipPtL, typeof g.kneeL, typeof g.ankleL, typeof g.toeL][] = [
        [g.hipPtL, g.kneeL, g.ankleL, g.toeL],
        [g.hipPtR, g.kneeR, g.ankleR, g.toeR],
      ]
      const iw = 1 - w // authority complement
      for (const [hipPt, knee, ankle, toe] of legs) {
        const ankleWy = this.hipY + SCALE * ankle.y
        const toeWy = this.hipY + SCALE * toe.y
        const extended = ankle.y > legLen * 0.52
        // capture band: sole within ~12px of the line, or already below it
        const nearGround = ankleWy > -12 && toeWy < 6
        if (extended && nearGround) {
          // snap: keep the authored stance x, pin the sole exactly
          const ty = (-Player.SOLE_W - this.hipY) / SCALE
          solveLegIK(hipPt.x, hipPt.y, ankle.x, ty, l1, l2, 1, this.ikOut)
          knee.x += (this.ikOut.kx - knee.x) * iw
          knee.y += (this.ikOut.ky - knee.y) * iw
          ankle.x += (this.ikOut.ax - ankle.x) * iw
          ankle.y += (this.ikOut.ay - ankle.y) * iw
          // flat toe forward
          toeFromPitch(ankle.x, ankle.y, 0.12, PLAYER_SPEC.foot, this.toeScratch)
          toe.x += (this.toeScratch.x - toe.x) * iw
          toe.y += (this.toeScratch.y - toe.y) * iw
          // register the exact contact point for the shadow AO core
          if (iw > 0.5) this.snapContacts.push(this.x + this.face * SCALE * ankle.x)
        } else {
          // floor clamp — the ground is solid: toes never render below it
          const groundLy = (-1.2 - this.hipY) / SCALE
          if (toe.y > groundLy) toe.y = groundLy
          if (extended && ankle.y > (-Player.SOLE_W + 2 - this.hipY) / SCALE) {
            ankle.y = (-Player.SOLE_W + 2 - this.hipY) / SCALE
          }
        }
      }
    }
  }

  /** BLADE DYNAMICS — rotational inertia of the katana as a spring-damper
   * on the wrist channel. When the arm accelerates (windup → cut), the tip
   * lags behind the drive angle; when the arm decelerates, the stored
   * energy whips the tip THROUGH the target line with a small overshoot —
   * the physical furi-otoshi snap real swordsmen feel. Under-damped
   * (ζ≈0.3): lively, never mushy. Applied BEFORE solve → hitboxes inherit
   * the physical blade, not just the keyframed one.
   *
   * During hit-stop (world timeScale ≈ 0.05) the blade takes a ±5° impact
   * resistance deflection AGAINST its swing direction — the cut bites into
   * something with mass (spec: kinetic impact modulation). */
  private updateBladeDynamics(dt: number, w: WorldRef): void {
    if (dt <= 1e-5) return
    const p = this.pose
    const armSum = p[CH.shR] + p[CH.elR] + p[CH.wrR]
    const armVel = (armSum - this.prevArmSum) / dt
    this.armVel = armVel
    this.prevArmSum = armSum
    // lag target: proportional to angular velocity (inertia resisting)
    const target = w.timeScale < 0.5
      ? clamp(-Math.sign(armVel || this.bladeLag || 1) * 0.09, -0.15, 0.15) // impact resistance ~5°
      : clamp(-armVel * 0.045, -0.15, 0.15)
    // spring toward target, under-damped for the whip-through
    const K = 260
    const C = 9
    this.bladeLagVel += (K * (target - this.bladeLag) - C * this.bladeLagVel) * dt
    this.bladeLag += this.bladeLagVel * dt
    this.bladeLag = clamp(this.bladeLag, -0.17, 0.17)
    this.bladeLagVel = clamp(this.bladeLagVel, -6, 6)
    p[CH.wrR] += this.bladeLag

    // KINETIC CHAIN (hips 30% · torso 50% · shoulders 20%): a slower spring
    // driven by the same arm whip. Accelerating into a cut → the torso loads
    // INTO the swing; the deceleration at impact → the body recoils back.
    // The upper body can never again rotate independently of the hips.
    const k2 = 90
    const c2 = 7.5
    const chainTarget = clamp(-armVel * 0.02, -0.14, 0.14)
    this.chainLagVel += (k2 * (chainTarget - this.chainLag) - c2 * this.chainLagVel) * dt
    this.chainLag = clamp(this.chainLag + this.chainLagVel * dt, -0.16, 0.16)
    p[CH.rootRot] += -this.chainLag * 0.3
    p[CH.spine] += -this.chainLag * 0.5
    p[CH.shR] += this.chainLag * 0.2

    // GROUND CLEARANCE — the floor is SOLID: the kissaki can never pass
    // below the ground plane. Clip-blends between carries (guard ↔ walk
    // side-carry ↔ run trail) linearly sweep the wrist through
    // straight-down angles; without this, the tip pierces the floor for
    // ~10 frames on every transition. A positional wrist constraint rotates
    // the tip toward the NEARER horizon (forward-level or back-level,
    // preserving the carry direction), rate-limited so the lowering reads
    // as the kissaki TAPPING the floor and sliding along it.
    // (Attacks exempt: their tips target enemy bodies above the floor.)
    if (this.state !== 'attack') {
      const sum = p[CH.shR] + p[CH.elR] + p[CH.wrR]
      const bladeA = Math.PI / 2 - sum
      const sinA = Math.sin(bladeA)
      const cosA = Math.cos(bladeA)
      if (sinA > 0.05) {
        const len = PLAYER_SPEC.blade * this.sword.stats.range * 1.06 * this.swingScale
        const tipLY = this.geom.handR.y + sinA * len
        // local floor = the stance foot's contact point (crouch-aware),
        // small margin for the drawn edge width
        const floorLocal = Math.max(
          this.geom.ankleL.y, this.geom.ankleR.y, this.geom.toeL.y, this.geom.toeR.y,
        ) + 2.5
        if (tipLY > floorLocal) {
          const dY = tipLY - floorLocal
          // solve for the angle that puts the tip exactly on the floor
          const sinT = Math.max(0.06, (sinA * len - dY) / len)
          const aT = Math.asin(clamp01(sinT))
          // quadrant-safe (raw channels are up-wound): cos<0 → back-down
          // carry rotates toward straight-back; cos≥0 → forward-down
          // rotates toward level-forward — the carry direction is preserved
          if (cosA < 0) {
            const aNorm = Math.PI - Math.asin(clamp01(sinA))
            const delta = Math.PI - aT - aNorm
            p[CH.wrR] -= clamp(delta, 0, 20 * dt)
          } else {
            const aNorm = Math.asin(clamp01(sinA))
            const delta = aNorm - aT
            p[CH.wrR] += clamp(delta, 0, 20 * dt)
          }
        }
      }
    }
  }

  private nearestEnemy(w: WorldRef, range: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    for (const e of w.enemies) {
      if (e.dead || e.spawning) continue
      const d = Math.abs(e.x - this.x)
      if (d < bestD && d < range) {
        bestD = d
        best = { x: e.x, y: e.y }
      }
    }
    return best
  }

  /** HYPER-SCALE: the blade grows ×1.22 through the active frames and ×1.12
   * on dashes (anime weapon read; the hit segment grows with it — visuals
   * and hit volume stay one object). Damped so it never pops. */
  private updateSwingScale(dt: number): void {
    let target = 1
    if (this.state === 'dash') target = 1.12
    else if (this.state === 'attack' && this.action) {
      const h = this.action.def.hit
      const t = this.action.animT
      if (t >= h.start - 0.06 && t <= h.end + 0.1) target = 1.22
    }
    this.swingScale = damp(this.swingScale, target, 18, dt)
  }

  /** zArc Z-envelope → BLADE YAW: the legacy visual depth pulse, expressed
   * as a 3D yaw on the weapon. Only attacks WITHOUT a declared 3D
   * trajectory use it — traj'd attacks own the bladeYaw channel through
   * the arc solver (real yaw paths, not a sine pulse). */
  private updateBladeZ(dt: number): void {
    let target = 0
    if (this.state === 'attack' && this.action) {
      const def = this.action.def
      if (def.zArc) {
        const tr = def.trail
        const t = this.action.animT
        if (t >= tr.start && t <= tr.end) {
          const u = clamp01((t - tr.start) / (tr.end - tr.start))
          target = def.zArc * Math.sin(u * Math.PI)
        }
      }
    }
    this.bladeZ = damp(this.bladeZ, target, 16, dt)
    if (!this.action?.def.traj) this.pose[CH.bladeYaw] += this.bladeZ * 0.85
  }
  /** TWO-HANDED GRIP — the off hand solves 2-bone IK onto the tsuka butt
   * (te-no-uchi: left hand at the pommel, right near the guard — how a
   * katana is actually swung). Blended over the authored off-arm channels
   * with a state-driven weight so running/dashing pumps stay authored.
   *
   * ANATOMY CONTRACT v2 (the "draped straight off-arm" fix):
   *  · 3D SOLVE: the IK runs in REAL 3D — target = pommel pulled into the
   *    left shoulder's depth neighborhood (|Δz| ≤ 12), solved with
   *    rig3d.ikArm3D (law of cosines in the target's own plane). The old
   *    projected-2D solve ignored the 15-unit depth gap between the far
   *    shoulder (z≈−7) and the grip (z≈+8), so the channels it wrote
   *    re-projected to a nearly-straight arm draped across the torso —
   *    the "one elbow looks broken at idle" defect.
   *  · FLEXION FLOOR: grip elbows hold ≥35° flexion (el ≤ −0.61) — a
   *    hand stacked on a tsuka is never a straight arm.
   *  · DEPTH COHERENCE: the solve writes armLz AND foreLz (the forearm's
   *    own elbow-pivot yaw) split like the sword-arc solver, so upper arm
   *    and forearm fold through the SAME depth story.
   *  · THREAT-DRIVEN WEIGHT: at standstill the grip weight tracks
   *    enemyNearW — threat engaged = full two-hand chūdan grip; safe =
   *    the arm hangs (the relax layer owns it). Sheathed = never. */
  private applyTwoHandGrip(dt: number): void {
    // desired grip weight by state
    let target = 0
    switch (this.state) {
      case 'move':
        if (!this.swordDrawn) target = 0
        else if (Math.abs(this.vx) < 60) target = this.enemyNearW // threat = grip
        else target = 0.1
        break
      case 'attack':
        target = this.action ? (this.action.def.grip ?? 0.45) : 0.45
        break
      case 'charge':
      case 'parry':
        target = this.swordDrawn ? 1 : 0
        break
      case 'scripted':
        target = 0.5
        break
      default:
        target = 0
    }
    this.twoHandW = damp(this.twoHandW, target, 11, dt)
    const w = this.twoHandW
    if (w < 0.03 || !this.swordDrawn) return

    const g = this.geom // last frame's solve — continuous, 1-frame stale
    // ---- 3D target: tsuka butt, pulled toward the far shoulder's depth ----
    const U = PLAYER_SPEC.upperArm
    const F = PLAYER_SPEC.foreArm
    const sx = g.shoulderL.x
    const sy = g.shoulderL.y
    const sz = g.shoulderL.z
    let dx = g.pommel.x - sx
    let dy = g.pommel.y - sy
    let dz = clamp(g.pommel.z - sz, -12, 12) // depth clamp — no cross-body reach
    const ik = ikArm3D(dx, dy, dz, U, F)
    // anatomical grip band: 35°..150° flexion, flexion side only
    const elIk = clamp(ik.el, -2.62, -0.61)
    const shIk = clamp(ik.sh, -1.05, 3.05)
    // depth split (mirror of the sword-arc solver): the shoulder plane
    // carries ~58% of the reach yaw, the forearm's elbow-pivot the rest
    const foreLead = clamp(ik.yaw * 0.42, -0.6, 0.6)
    const armYaw = clamp(ik.yaw - foreLead, -1.35, 1.35)
    const foreYaw = clamp(ik.yaw - armYaw, -0.65, 0.65)
    const p = this.pose
    p[CH.shL] += (shIk - p[CH.shL]) * w
    p[CH.elL] += (elIk - p[CH.elL]) * w
    p[CH.armLz] += (armYaw - p[CH.armLz]) * w
    p[CH.foreLz] += (foreYaw - p[CH.foreLz]) * w
  }

  private applyProcedural(dt: number): void {
    const p = this.pose
    this.animClock += dt
    // anime impact-frame timer (white silhouette beat on heavy connects)
    if (this.impactFlashT > 0) this.impactFlashT = Math.max(0, this.impactFlashT - dt)

    // ---- previous-frame awareness: smoothed acceleration lean ----
    const accel = (this.vx - this.prevVx) / Math.max(dt, 1e-4)
    this.prevVx = this.vx

    /* ---- THE TIERED LEAN SYSTEM (VLM/biomechanics research) ----------
     * Trunk lean is a FUNCTION OF ACCELERATION, not raw speed (Kugler &
     * Janshen: lean ≈ atan(a/g)) — and the tiers are hard-separated so
     * each locomotion state owns a distinct posture band:
     *   walk  3–7°    (0.06 rad cap)
     *   run   ~10°    (0.10 rad cap)
     *   sprint ~15°   (0.15 rad cap — max-VELOCITY posture: research says
     *                  elite sprinters hold only 15–20° at top speed)
     *   dash  +12.6°  (a damped additive on the already-deep authored
     *                  clips — acceleration posture, 45°+ authored)
     * The speed term is normalized by the SPRINT ceiling (not MOVE_MAX)
     * so run ≈ 0.73 and sprint 1.0 no longer clamp to the same lean —
     * the old bug that made sprint read exactly as leaned as dash.
     *
     * THE STOP FIX: braking (accel opposing travel) is NOT a license to
     * lean backward — a real stop lowers the COG over the stride and rides
     * a shallow 2–4° back-pitch. The old /3200 gain on a −3500px/s² stop
     * spike produced a −9.2° back-lean that LINGERED (k=14 decay) after
     * the body had already stopped — the "leans too much when I stop"
     * defect. Now: braking lean is gain-limited to ±0.05 rad and decays
     * fast (k=26) once the speed is gone; the spent momentum sinks into
     * the knees instead (rootY), which reads as weight, not stiffness. */
    const capFor: Record<string, number> = {
      walk: 0.06, run: 0.1, sprint: 0.15, combat: 0.05, backpedal: 0.045, idle: 0.03,
    }
    const cap = capFor[this.loco] ?? 0.08
    const speedLean = clamp((this.vx * this.face) / SPRINT_MAX, -1, 1)
    const braking = this.accelSm * this.face < 0
    const accelCap = braking ? 0.05 : 0.12
    const accelLean = clamp(this.accelSm * this.face / (braking ? 6800 : 3600), -accelCap, accelCap)
    // smoothing: braking settles fast (k=26) — the reverse pitch must
    // vanish WITH the speed, never linger over a stopped body
    this.accelSm = damp(this.accelSm, accel, braking ? 26 : 14, dt)
    const lean = speedLean * cap + accelLean
    // brake COG dip: the deceleration sinks into the knees (weight),
    // replacing most of the old backward lean
    const brakeDip = braking ? clamp(-this.accelSm * this.face / 4200, 0, 1.6) : 0

    /* ---- DASH LEAN (replaces the old hard exemption): a damped additive
     * driven by the dash's own velocity envelope — NOT the raw accel
     * spike (that was the "dash fights itself" jitter source). Ramps in
     * over ~80ms, decays out through the catch/settle beats as the
     * envelope falls, and hands off smoothly to the locomotion lean at
     * exit — the authored silhouette still owns the peak shape, this
     * layer owns the entry surge + exit continuity. */
    const dashVelFrac = clamp(Math.abs(this.vx) / DASH_SPEED, 0, 1)
    const dashTarget = this.state === 'dash' ? dashVelFrac * dashVelFrac * 0.22 : 0
    this.dashLeanS = damp(this.dashLeanS, dashTarget, 10, dt)
    const dashLean = this.dashLeanS * (this.face * Math.sign(this.vx || this.face * 1) > 0 ? 1 : -0.5)

    // ---- FULL-BODY LEAN (THE "torso-only bend" fix): the forward pitch
    // is distributed through the ENTIRE articulation — and crucially the
    // PELVIS TRANSLATES toward the facing (rootX) so the body hangs over
    // its toes while the feet stay planted BEHIND the COG: the legs become
    // diagonal struts (front knee loaded, rear leg extended), not vertical
    // hangers under a rotated chest. Lumbar adds its fraction, the ankle
    // dorsi-flexes to brake, the COG drops as the body commits. A body
    // that leans only from the chest reads as a puppet; a body that leans
    // from the ground up reads as an athlete.
    if (this.state !== 'dead') {
      const l = this.state === 'dash' ? dashLean : lean
      p[CH.rootRot] += l * 0.6
      p[CH.spine] += l * 0.22
      p[CH.rootX] += l * 7 // pelvis surge: hips ride forward over the stance
      p[CH.hipR] += l * 0.5
      p[CH.hipL] -= l * 0.38
      p[CH.kneeR] -= l * 0.3
      p[CH.kneeL] -= l * 0.2
      p[CH.footR] += l * 0.18
      p[CH.rootY] += Math.abs(l) * 2.2
      // braking weight acceptance: the stop sinks into the knees
      p[CH.rootY] += brakeDip
      p[CH.kneeR] -= brakeDip * 0.22
      p[CH.kneeL] -= brakeDip * 0.16
      // head counter-pitches to keep the eyes on the horizon (the sprint
      // tell: body flat, gaze level — MGR:R Raiden's forward drive;
      // research: cervical extension ≈ trunk lean − a few degrees)
      p[CH.head] -= l * 0.35
    }

    // vertical pitch while airborne
    if (!this.grounded && this.state !== 'attack') {
      p[CH.rootRot] += clamp(this.vy / 1400, -0.22, 0.3)
    }

    // ---- GAIT TWIST (the 3D torso read): pelvis swivel + shoulder
    // COUNTER-rotation in depth, phased to the stride cycle. This is the
    // transverse-plane half of locomotion the sagittal clips can't carry:
    // the hip sockets advance/recede per stride and the shoulder girdle
    // counter-rotates — the #1 depth tell of real bipedal gait.
    if (this.state === 'move' && this.grounded) {
      const clip = this.animator.getClip()
      const ph = clip && clip.loop && clip.dur > 0
        ? (this.animator.getTime() / clip.dur) % 1
        : 0
      const sway = Math.sin(ph * Math.PI * 2)
      let amp = 0
      let cAmp = 0
      switch (this.loco) {
        // research (gait biomechanics): pelvis transverse rotation at sprint
        // 12–18°, shoulder counter-rotation 25–40° — the chest counter is
        // ~1.3× pelvis at walk and approaches ~2× at sprint cadence
        case 'walk': amp = 0.12; cAmp = 1.3; break
        case 'run': amp = 0.21; cAmp = 1.55; break
        case 'sprint': amp = 0.3; cAmp = 1.85; break
        case 'combat': case 'backpedal': amp = 0.05; cAmp = 1.2; break
        default: break
      }
      this.gaitYawAmp = damp(this.gaitYawAmp, amp, 8, dt)
      p[CH.pelvisYaw] += sway * this.gaitYawAmp
      p[CH.chestYaw] += -sway * this.gaitYawAmp * cAmp
    } else {
      this.gaitYawAmp = damp(this.gaitYawAmp, 0, 8, dt)
    }

    // ---- SWORD CARRY per gait (depth-aware weapon handling): each
    // locomotion state carries the weapon DIFFERENTLY — walk: relaxed
    // low-back carry; run: trailing flat behind the hip; sprint: tucked
    // HARD back with the blade swinging through depth BEHIND the torso
    // plane (bladeYaw −0.5: the steel visibly recedes past the body);
    // combat: square-on live guard. Never one frozen carry for all states.
    // DASH carries are VARIANT-aware: the forward lunge tucks the steel
    // back (iai-ready); the backdash/escape HOLD the guard toward the
    // threat — the blade never turns its back on an enemy you're dodging.
    {
      let carryYaw = 0
      let carryArm = 0
      let carryFore = 0
      if (this.state === 'move' && this.grounded) {
        switch (this.loco) {
          case 'walk': carryYaw = -0.12; carryArm = -0.08; carryFore = -0.05; break
          case 'run': carryYaw = -0.28; carryArm = -0.14; carryFore = -0.08; break
          // sprint: tucked hard back but the tuck lives in BLADE YAW only —
          // the old arm-yaw pair (−0.16/−0.1 on top of authored −0.18)
          // stacked with the girdle inheritance to ~−0.39 total: the
          // forearm's projected direction became ~47% depth, so a deeply
          // BENT elbow (interior ~111°) projected to a straight horizontal
          // stub behind the hip — the "dead sword arm" read. Arm yaw stays
          // shallow; bladeYaw −0.3 carries the whole Raiden tuck alone.
          case 'sprint': carryYaw = -0.3; carryArm = -0.06; carryFore = -0.04; break
          case 'combat': carryYaw = 0.06; carryArm = 0.1; carryFore = 0.05; break
          case 'backpedal': carryYaw = 0.04; carryArm = 0.06; carryFore = 0.03; break
          default: break
        }
      } else if (this.state === 'dash') {
        switch (this.dashVariant) {
          case 'launch': case 'chain': carryYaw = -0.42; carryArm = -0.3; carryFore = -0.26; break
          case 'carry': carryYaw = -0.46; carryArm = -0.34; carryFore = -0.3; break
          case 'hunt': carryYaw = -0.45; carryArm = -0.3; carryFore = -0.26; break
          case 'air': carryYaw = -0.3; carryArm = -0.24; carryFore = -0.18; break
          case 'pierce': carryYaw = 0; carryArm = 0; carryFore = 0; break // clip owns the thrust line
          case 'vault': carryYaw = 0.02; carryArm = 0.04; carryFore = 0.02; break
          case 'retreat': carryYaw = 0.1; carryArm = 0.08; carryFore = 0.05; break
          case 'carve': carryYaw = -0.12; carryArm = 0.06; carryFore = -0.08; break
        }
      }
      this.carryYaw = damp(this.carryYaw, carryYaw, 6, dt)
      this.carryArmZ = damp(this.carryArmZ, carryArm, 6, dt)
      this.carryForeZ = damp(this.carryForeZ, carryFore, 6, dt)
      if (this.state !== 'attack') {
        p[CH.bladeYaw] += this.carryYaw
        p[CH.armRz] += this.carryArmZ
        // the forearm folds DEEPER than the shoulder can yaw — the elbow
        // trails in its own plane while the grip tucks past the hip
        // (the forearm's elbow-pivot DOF doing real carrying work)
        p[CH.foreRz] += this.carryForeZ
      }
    }

    // ---- DASH PROCEDURAL MOTION: continuous layers the keyframed clips
    // can't carry alone. (1) ESCAPE depth-carve: a smooth sin() yaw sweep
    // over the dash duration — the pelvis/chest twist through the
    // transverse plane peaks mid-dash and unwinds into the guard; the clip
    // authors the beats, this guarantees the sweep between them. (2) UP
    // rise: the gaze stays level while the world drops — head/blade
    // counter-articulate the vertical travel. (3) direction-aware pelvis
    // yaw on the forward lunge: the hips square into the travel vector.
    if (this.state === 'dash') {
      const k = 1 - this.dashT / this.dashDur
      if (this.dashVariant === 'carve') {
        const spin = Math.sin(clamp01(k) * Math.PI) * 0.38
        p[CH.pelvisYaw] += spin
        p[CH.chestYaw] += spin * 0.6
      } else if (this.dashVariant === 'vault') {
        p[CH.head] -= 0.12 * Math.sin(clamp01(k) * Math.PI)
      } else if (this.dashVariant === 'launch' || this.dashVariant === 'chain'
        || this.dashVariant === 'carry' || this.dashVariant === 'hunt'
        || this.dashVariant === 'pierce') {
        // pelvis squares into the dash vector (diagonal dashes yaw the hips)
        p[CH.pelvisYaw] += this.dashDy * 0.22
      } else if (this.dashVariant === 'retreat') {
        // the guarded retreat: hips open slightly against travel, chest
        // counter-rotates to keep the guard presentation toward the threat
        p[CH.pelvisYaw] -= this.dashDy * 0.16
      }
    }

    // ---- ATTACK TORSO DRIVE: the body follows the blade. When a cut
    // sweeps through depth (bladeYaw), the pelvis rotates WITH it and the
    // shoulders rotate FURTHER — hips → torso → shoulders generate the
    // sword's power together (spec: full-body power generation).
    if (this.state === 'attack') {
      const by = p[CH.bladeYaw]
      p[CH.pelvisYaw] += by * 0.35
      p[CH.chestYaw] += by * 0.65
    }

    // ---- 180° TURN PIVOT: cosmetic counter-rotation sweep through the
    // flip — the body leans back over the OLD direction, unwinding into the
    // new one, with a hip drop + knee flex (weight shift through the turn)
    if (this.turnT > 0) {
      const e = this.turnT * this.turnT // ease-out unwind
      p[CH.rootRot] += this.turnDir * this.face * 1.15 * e
      p[CH.rootY] += 3.2 * e
      p[CH.kneeR] -= 0.22 * e
      p[CH.kneeL] -= 0.16 * e
      // the turn also YAWS the pelvis through depth — the body carves the
      // reversal instead of flat-spinning
      p[CH.pelvisYaw] += this.turnDir * 0.3 * e
    }

    // ---- POST-ATTACK MOMENTUM (sword-aware locomotion, spec §7): the
    // torso/shoulder chain preserves the final swing's rotational momentum
    // and recovers over ~0.34s — never snapping to an upright neutral
    if (this.postAttackT > 0 && this.state === 'move') {
      const e = Math.pow(this.postAttackT / 0.34, 1.6) // decaying carryover
      const m = clamp(this.postArmVel * 0.02, -0.16, 0.16)
      p[CH.rootRot] += m * 0.6 * e
      p[CH.spine] += m * 0.8 * e
      p[CH.shR] += m * 1.2 * e
      p[CH.wrR] += m * 0.5 * e
    }

    // ---- COMBAT CROUCH + GUARD RAISE (Condition B, spec §4/§5): enemy
    // proximity lowers the COG, flexes the knees, coils the torso — a
    // weighted, damped overlay (never a snap; hysteresis in scanEnemies)
    const wC = this.enemyNearW
    if (wC > 0.02 && this.state === 'move' && this.grounded) {
      p[1] += wC * 2.4
      p[2] += wC * 0.06
      p[CH.kneeR] -= wC * 0.1
      p[CH.kneeL] -= wC * 0.07
      // surrounded: even lower, blade centered
      if (this.surrounded) p[1] += wC * 1.2
    }
    // ---- SWORD RELAX/RAISE: safe → the katana lowers into a deep side
    // carry (arm drops, kissaki down-BACK ~139°, tip clearing the ground
    // by ~14 local units — the old +4.33 offset measured proj −124..−142°:
    // the blade rode UP over the shoulder instead of hanging); threat →
    // it rises back into the live guard (the blade "notices" enemies
    // before the player swings — emergent, damped, alive). The wrR offset
    // is NEGATIVE-WOUND (−2.09): the guard→relax sum sweep 1.5 → −0.86
    // rad carries the blade angle 4° → +139° THROUGH THE UP HEMISPHERE
    // (tip over the shoulder for a beat, then settling down-back) —
    // never through straight-down.
    // THE OFF-ARM HANG (the drape fix): safe-idle arms HANG — shoulder
    // back to vertical, soft ~30° elbow, hand beside the thigh/saya. The
    // old layer only nudged shL while the grip IK chased the pommel with
    // its old weight-1 target, producing a near-straight arm draped
    // across the torso. Now: when relaxed the grip weight goes to 0
    // (see applyTwoHandGrip) and this layer OWNS the hang.
    // (SHEATHED: skipped — no blade to relax; the pommel-rest layer below
    // owns the arms.)
    if (this.swordDrawn && this.state === 'move' && this.grounded && Math.abs(this.vx) < 60) {
      const relax = 1 - wC
      // THE BENT-CARRY READ (reference panel 1 conformance): a relaxed sword
      // carry holds ~53° elbow flexion (interior ~127°) with the hand at
      // hip-front — "low carry WITH control", not a limp straight arm. The
      // old −0.05 elbow nudge left the arm near-straight (~150°) and passive
      // (the "dead arm at idle" read); the deeper bend also carries the hand
      // to (10, 1) local — in front of the hip, kissaki sweeping down-back.
      p[CH.shR] += relax * -0.25
      p[CH.elR] += relax * -0.35
      p[CH.wrR] += relax * -2.09
      // the natural hang: upper arm vertical, elbow softly bent —
      // NEVER a reach across the body
      p[CH.shL] += (relax * (-0.02 - p[CH.shL])) * 0.6
      p[CH.elL] += (relax * (-0.52 - p[CH.elL])) * 0.6
      p[CH.armLz] += (relax * (0.06 - p[CH.armLz])) * 0.5
      p[CH.foreLz] += (relax * (0.04 - p[CH.foreLz])) * 0.5
    }

    // ---- SWORD HOME ARM LAYER: while sheathed in grounded locomotion the
    // right fist rides the tsuka pommel and the left steadies the saya
    // mouth — the samurai walk (Ghost of Tsushima exploration read).
    // Fades OUT above walking pace: a pinned pommel-rest at full run read
    // as a frozen, lifeless arm (the sword arm must pump with the gait).
    // Airborne = the hands-only jump family (authored clips); the ritual
    // clips own the arms while active. Damped weight → smooth transitions.
    //
    // THE DYNAMIC KASHIRA WELD (two stacked fixes):
    //  1. The old static targets (shR −0.34, elR −0.46) reached BACKWARD
    //     behind the hip with a near-straight elbow — the fist floated 34
    //     units from the drawn pommel and read as a dislocated elbow jammed
    //     into the pelvis (the idle catastrophe). The kashira renders ~22
    //     units FORWARD of the hip (tsuka continues the saya axis out of
    //     the mouth at ~14° above horizontal — iaido rest: shoulder ~+55°,
    //     elbow interior ~115-125°, hand at navel height).
    //  2. Static channel targets still drifted 2-3 units off the hilt
    //     through breathing sway, and the up-wound carry wrist oriented the
    //     FIST backward off the tsuka axis (the renderer orients fists on
    //     the blade-angle sum). The right arm is now IK-solved onto the
    //     LIVE kashira point every frame — the same pelvis-pitch formula
    //     the saya renderer uses — with the wrist rotated onto the saya
    //     axis: the fist stays GLUED to the hilt through sway, and reads
    //     like a hand actually holding the tsuka.
    {
      const paceFade = 1 - clamp01((Math.abs(this.vx) - 110) / 90)
      const sheathTarget = !this.swordDrawn && this.state === 'move'
        && this.grounded && !this.sheathAct ? paceFade : 0
      this.sheathW = damp(this.sheathW, sheathTarget, 9, dt)
      if (this.sheathW > 0.02) {
        const k = this.sheathW
        // the saya geometry (local space — mirror of the draw path)
        const pelvisPitch = p[CH.rootRot] + p[CH.spine] * 0.35
        const sayAng = 0.24 + pelvisPitch * 0.6
        const tl = PLAYER_SPEC.blade * 0.36
        const mx = p[CH.rootX] + 3
        const my = p[CH.rootY] + 1
        const kx = mx + Math.cos(sayAng) * tl
        const ky = my - Math.sin(sayAng) * tl
        // right arm → LIVE kashira IK (geom is last frame's solve, unprojected)
        {
          const g = this.geom
          const sS = FOCUS / (FOCUS - g.shoulderR.z)
          const sx = g.shoulderR.x / sS
          const sy = g.shoulderR.y / sS
          const ik = ikArm3D(
            kx - sx, ky - sy, clamp(-g.shoulderR.z, -10, 10),
            PLAYER_SPEC.upperArm, PLAYER_SPEC.foreArm,
          )
          const elIk = clamp(ik.el, -2.62, -0.61)
          const shIk = clamp(ik.sh, -1.05, 3.05)
          p[CH.shR] += (shIk - p[CH.shR]) * k
          p[CH.elR] += (elIk - p[CH.elR]) * k
          p[CH.armRz] += (clamp(ik.yaw, -0.45, 0.45) - p[CH.armRz]) * k
          // wrist: the fist axis rides the SAYA axis (blade angle = −sayAng)
          // — the fist reads as wrapping the tsuka, never pointing backward
          p[CH.wrR] += (Math.PI / 2 + sayAng - shIk - elIk - p[CH.wrR]) * k
        }
        // left hand steadies the saya mouth — static near-mouth targets at
        // 0.8 weight (the far arm is depth-occluded; a full cross-body IK
        // onto the mouth would yaw the arm ~72° through the torso)
        p[CH.shL] += (0.45 - p[CH.shL]) * k * 0.8
        p[CH.elL] += (-0.95 - p[CH.elL]) * k * 0.8
        p[CH.armLz] += (0.2 - p[CH.armLz]) * k * 0.8
      }
    }

    // ---- HEAD TRACKING: the head turns toward the nearest threat (alive
    // even mid-locomotion — running away while glancing back)
    if (this.headTrackW > 0.02 && this.hasThreat && this.state === 'move') {
      const dx = (this.threatX - this.x) * this.face
      const dy = this.threatY - (this.hipY - 70) // vs head height (world)
      const ang = Math.atan2(dy, Math.abs(dx) + 24) // +pitch = look down
      p[CH.head] += clamp(ang, -0.42, 0.5) * 0.55 * this.headTrackW
    }

    // landing spring (squash)
    if (this.landSpring > 0) {
      this.landSpring = Math.max(0, this.landSpring - dt * 5)
      p[1] += this.landSpring * 6
    }
    // charge tremble
    if (this.charging) {
      p[0] += rand(-0.8, 0.8) * this.chargeRatio
      p[1] += rand(-0.5, 0.5) * this.chargeRatio
    }
    // hurt shake
    if (this.hurtT > 0) {
      p[0] += rand(-1.4, 1.4) * this.hurtT
    }
    // ARM LIFE: the guard breathes — out-of-phase micro sway on the sword
    // arm joints (research: even "idle" reference poses hold live tension).
    // Bounded ±0.025 rad; blended away the moment any state layer drives
    // the arm (attacks own it via the sword-led arc + keyframes).
    if (this.state === 'move' && this.grounded && Math.abs(this.vx) < 40 && this.hurtT <= 0) {
      const t = this.animClock
      p[CH.shR] += Math.sin(t * 1.9) * 0.018
      p[CH.elR] += Math.sin(t * 1.5 + 0.8) * 0.024
      p[CH.wrR] += Math.sin(t * 1.7 + 1.6) * 0.016
      p[CH.shL] += Math.sin(t * 1.6 + 2.2) * 0.015
      p[CH.elL] += Math.sin(t * 1.4 + 3.0) * 0.02
    }
  }

  private updateBladeWorld(): void {
    if (!this.swordDrawn) {
      // steel home: no live blade segment in the world — no trail, no
      // smear, no hitbox. The saya owns the geometry until the next draw.
      this.blade.bx = this.blade.tx = this.x
      this.blade.by = this.blade.ty = this.hipY - 20
      this.hasPrevAng = false
      this.hasPrevBlade = false
      return
    }
    const g = this.geom
    // The hit segment IS the projected 3D blade: tsuka-side grip → kissaki.
    // Because both the renderer and this hitbox consume the same projection,
    // visual contact == gameplay contact for every depth excursion.
    this.blade.bx = this.x + this.face * SCALE * g.grip.x
    this.blade.by = this.hipY + SCALE * g.grip.y
    this.blade.tx = this.x + this.face * SCALE * g.tip.x
    this.blade.ty = this.hipY + SCALE * g.tip.y
    // smear tracking: this frame's PROJECTED angle becomes the smear tail
    if (this.hasPrevAng) {
      this.smearA0 = this.prevBladeAng
      this.smearA1 = g.bladeProjAngle
    }
    this.prevBladeAng = g.bladeProjAngle
    this.hasPrevAng = true
  }

  /* ------------------------------------------------------------------ */
  /* render                                                               */
  /* ------------------------------------------------------------------ */

  /* ---- LIGHTING ENGINE: projected-skeleton cast shadow ----
   * Every solved joint (and the blade) projects along the key light onto
   * the ground plane — the shadow deforms with the pose, stretches when
   * the storm strobes, detaches + fades when airborne, and carries tight
   * contact-AO cores under the legik-planted feet. */
  private shChains: number[][] = [[], [], [], [], []]
  private shHead = { x: 0, y: 0, r: 0 }
  private shBlade = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private shFig: ShadowFigure = { chains: this.shChains, head: this.shHead, blade: this.shBlade }
  /* strobe rim state — set by the renderer each frame from the key light */
  strobeLight: KeyLight | null = null
  strobeK = 0
  private rimChains: number[][] = [[], [], [], [], []]
  /** contact-AO anchors from the plant-snap pass (non-gait stances:
   * attacks, dashes, brake, land — filled each frame by applyGroundIK) */
  private snapContacts: number[] = []

  drawShadow(ctx: CanvasRenderingContext2D, light: KeyLight): void {
    if (this.state === 'dead' && this.deadT > 2.6) return
    const g = this.geom
    const f = this.face * SCALE
    const hy = this.hipY
    const W = (j: { x: number; y: number }, out: number[]) => {
      out.push(this.x + f * j.x, hy + SCALE * j.y)
    }
    // chains: legs (hip→knee→ankle→toe), torso, arms (shoulder→elbow→hand)
    const chains = this.shChains
    chains[0].length = 0
    W(g.hipPtL, chains[0]); W(g.kneeL, chains[0]); W(g.ankleL, chains[0]); W(g.toeL, chains[0])
    chains[1].length = 0
    W(g.hipPtR, chains[1]); W(g.kneeR, chains[1]); W(g.ankleR, chains[1]); W(g.toeR, chains[1])
    chains[2].length = 0
    W(g.hip, chains[2]); W(g.waist, chains[2]); W(g.chest, chains[2]); W(g.neckTop, chains[2])
    chains[3].length = 0
    W(g.shoulderL, chains[3]); W(g.elbL, chains[3]); W(g.handL, chains[3])
    chains[4].length = 0
    W(g.shoulderR, chains[4]); W(g.elbR, chains[4]); W(g.handR, chains[4])
    // head + blade
    this.shHead.x = this.x + f * g.headC.x
    this.shHead.y = hy + SCALE * g.headC.y
    this.shHead.r = 9.4 * SCALE
    this.shBlade.x0 = this.x + f * g.grip.x; this.shBlade.y0 = hy + SCALE * g.grip.y
    this.shBlade.x1 = this.x + f * g.tip.x; this.shBlade.y1 = hy + SCALE * g.tip.y
    // contact AO: the legik planted anchors (exact ground-contact points)
    // PLUS any plant-snap contacts from non-gait stances (dash/attacks/brake)
    const contacts: number[] = []
    if (this.grounded) {
      if (this.gaitW > 0.5) {
        if (this.gait.footL.planted) contacts.push(this.gait.footL.x)
        if (this.gait.footR.planted) contacts.push(this.gait.footR.x)
        if (contacts.length) contacts.push(this.x + f * g.hip.x)
      }
      for (const c of this.snapContacts) contacts.push(c)
      if (!contacts.length && this.gaitW > 0.5) contacts.push(this.x + f * g.hip.x)
    }
    drawCastShadow(ctx, this.shFig, light, {
      alpha: 0.58, width: 6.4, passes: 3, scale: SCALE,
      height: this.y, contacts,
    })
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.state === 'dead' && this.deadT > 2.6) return
    const alpha = this.iframes > 0 && this.state !== 'scripted'
      ? 0.55 + 0.25 * Math.sin(time * 40)
      : 1
    ctx.save()
    ctx.translate(this.x, this.hipY)
    ctx.scale(this.face * SCALE, SCALE)
    // saya (scabbard) at the left hip, angled back-down through the obi like
    // a real katana — sized to sheathe the blade (blade 52): the iai
    // draw-cuts (l1 / riposte) pull the steel from exactly here.
    {
      const hp = this.geom.hip
      const sayLen = PLAYER_SPEC.blade * 0.88
      // the scabbard rides the PELVIS: its angle follows the hip pitch
      // (rootRot) + a slice of the pelvis yaw, so it stays glued to the
      // body through leans, lunges and twists — a world-fixed angle read
      // as a floating rod whenever the fighter committed forward
      const pelvisPitch = this.pose[CH.rootRot] + this.pose[CH.spine] * 0.35
      const ang = 0.24 + pelvisPitch * 0.6
      const tipX = hp.x - Math.cos(ang) * sayLen
      const tipY = hp.y + Math.sin(ang) * sayLen
      // saya body (slightly lighter than the body so it reads on the hip)
      ctx.strokeStyle = '#0d1219'
      ctx.lineWidth = 4.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(hp.x + 3, hp.y + 1)
      ctx.lineTo(tipX, tipY)
      ctx.stroke()
      // rim highlight along the top edge — sells it as a scabbard
      ctx.strokeStyle = '#465a7a'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(hp.x + 2.4, hp.y - 1.2)
      ctx.lineTo(tipX + Math.cos(ang) * 2, tipY - Math.sin(ang) * 2)
      ctx.stroke()
      // sageo knot + kojiri (end cap) accents
      ctx.strokeStyle = rgba(this.sword.colors.accent, 0.5)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(hp.x - 2, hp.y + 3.4)
      ctx.lineTo(hp.x - 5.5, hp.y + 0.8)
      ctx.stroke()
      // kojiri: FILLED metal cap on the saya mouth (a bare accent ring read
      // as a floating rig artifact at gameplay zoom — cap the tube properly).
      // Accent kept DIM (0.32) — the kojiri ring must never compete with the
      // bright tsuba at the mouth: two equal rings flipped the katana's
      // read at a glance (VLM: "the far back ring could be misread as the
      // pommel") — the forward hilt owns the bright metal.
      ctx.fillStyle = '#0d1219'
      ctx.beginPath()
      ctx.arc(tipX, tipY, 3.1, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = rgba(this.sword.colors.accent, 0.32)
      ctx.beginPath()
      ctx.arc(tipX, tipY, 3.1, 0, Math.PI * 2)
      ctx.stroke()
      // SHEATHED tsuka stub: moved to a FRONT pass (after the body) — the
      // grip pokes out FORWARD of the hip silhouette at navel height, and
      // the old behind-body draw swallowed it into the black pelvis blob
      // ("the hand rests on nothing" read). See the front pass below.
    }
    drawFighter3D(ctx, this.geom, PLAYER_STYLE, {
      time,
      alpha,
      // flash: hurt red OR the anime impact-frame white beat (whichever
      // is stronger this frame — impact wins during hit-stop)
      flash: Math.max(this.flashT * 0.85, this.impactFlashT > 0 ? 0.92 : 0),
      flashColor: this.impactFlashT > this.flashT * 0.85 ? '#eafcff' : '#ff3b57',
      // BLADE-CAST LIGHT: the swinging/charging edge lights the body —
      // a rim pass on the sword-side silhouette (spec: dynamic blade light)
      edgeLight: {
        color: this.sword.colors.glow,
        a: clamp01(this.swingGlow * 0.55 + this.chargeRatio * 0.5 + this.bladeZ * 0.25) * alpha,
      },
    })
    // ---- SHEATHED TSUKA — FRONT PASS (the readable hilt): the grip
    // continues the saya axis out of the mouth, tsuba seated at the
    // opening, kashira cap at the far end where the resting fist welds
    // (the sheath IK layer targets exactly that point). Brighter tones
    // + accent rings than the saya body so the hilt READS against the
    // dark scene and the black body — "hand resting on the sheathed
    // katana" is the single most-held pose in the game; it cannot be a
    // whisper-dark stroke.
    if (!this.swordDrawn) {
      const hp = this.geom.hip
      const pelvisPitch = this.pose[CH.rootRot] + this.pose[CH.spine] * 0.35
      const ang = 0.24 + pelvisPitch * 0.6
      const mx = hp.x + 3
      const my = hp.y + 1
      const tl = PLAYER_SPEC.blade * 0.36
      const kx = mx + Math.cos(ang) * tl
      const ky = my - Math.sin(ang) * tl
      // grip body
      ctx.strokeStyle = '#1d2735'
      ctx.lineWidth = 3.8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(mx, my)
      ctx.lineTo(kx, ky)
      ctx.stroke()
      // wrap glint along the top edge (ito wrap catching the key light)
      ctx.strokeStyle = rgba(this.sword.colors.accent, 0.8)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(mx + Math.cos(ang) * 2.5, my - Math.sin(ang) * 2.5 - 1.4)
      ctx.lineTo(kx - Math.cos(ang) * 1.5, ky - Math.sin(ang) * 1.5 - 1.4)
      ctx.stroke()
      // kashira (pommel cap) — the fist welds HERE
      ctx.fillStyle = '#2a3949'
      ctx.beginPath()
      ctx.arc(kx, ky, 2.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = rgba(this.sword.colors.accent, 0.85)
      ctx.lineWidth = 1.1
      ctx.beginPath()
      ctx.arc(kx, ky, 2.6, 0, Math.PI * 2)
      ctx.stroke()
      // tsuba (guard) seated at the mouth
      ctx.fillStyle = '#3b5069'
      ctx.beginPath()
      ctx.arc(mx, my, 3.1, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = rgba(this.sword.colors.accent, 0.8)
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.arc(mx, my, 3.1, 0, Math.PI * 2)
      ctx.stroke()
    }
    // THE 3D BLADE: projected metrics from the rig — grip, projected angle
    // (after yaw + perspective), projected length, tip depth. Visual blade
    // == hitbox blade (updateBladeWorld consumes the same numbers).
    // Sheathed → the steel is inside the saya: only the resting tsuka stub
    // renders (the saya block above); the live weapon pass is skipped.
    if (this.swordDrawn) {
      drawSword(ctx, this.sword, {
        time,
        charge: this.chargeRatio,
        alpha,
        swingGlow: this.swingGlow,
      }, this.geom.grip.x, this.geom.grip.y, this.geom.bladeProjAngle, this.geom.bladeProjLen, this.geom.bladeTipZ)
    }
    ctx.restore()

    // ---- ANIME SMEAR (two-layer, research-applied): when tip velocity
    // explodes, the blade stretches across this frame's angular sweep as
    // translucent wedges — a COOL WAKE over the full span plus a HOT
    // LEADING EDGE on the leading ~55% of the sweep (reference sheets:
    // the hot core leads, a cooler wake trails it 30-45° behind). World
    // space, drawn here so it composites over the body with additive glow.
    const dA = this.hasPrevAng ? this.smearA1 - this.smearA0 : 0
    const tipSpd = Math.abs(dA) * 62 * PLAYER_SPEC.blade * SCALE * this.swingScale
    if (tipSpd > 950 && this.state !== 'dead' && this.swordDrawn) {
      // pivot = the weapon grip (the blade's true rotation center), world space
      const px = this.x + this.face * SCALE * this.geom.grip.x
      const py = this.hipY + SCALE * this.geom.grip.y
      const R = this.geom.bladeProjLen * SCALE
      // local → world angles (facing mirror flips around the Y axis)
      const wa0 = this.face === 1 ? this.smearA0 : Math.PI - this.smearA0
      const wa1 = this.face === 1 ? this.smearA1 : Math.PI - this.smearA1
      const k = Math.min(1, (tipSpd - 950) / 1400)
      const ccw = wa1 < wa0
      // leading edge start: 45% back from the tip of the sweep
      const leadA = wa0 + (wa1 - wa0) * 0.45
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      // cool wake — the full angular span at full radius
      ctx.fillStyle = rgba(this.sword.colors.trail, 0.09 + 0.15 * k)
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.arc(px, py, R, wa0, wa1, ccw)
      ctx.closePath()
      ctx.fill()
      // hot leading edge — rides the front of the sweep
      ctx.fillStyle = rgba(this.sword.colors.core, 0.12 + 0.2 * k)
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.arc(px, py, R * 0.9, leadA, wa1, ccw)
      ctx.closePath()
      ctx.fill()
      // white-hot kissaki streak — the very tip of the arc
      ctx.fillStyle = rgba('#eaffff', 0.1 + 0.22 * k)
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.arc(px, py, R * 0.97, wa0 + (wa1 - wa0) * 0.72, wa1, ccw)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // ---- BLADE POINT-LIGHT: the edge emits a real localized light into
    // the world while swinging/charging (additive radial at blade mid) ----
    const lightI = clamp01(this.swingGlow * 0.8 + this.chargeRatio * 0.6)
    if (lightI > 0.25 && this.swordDrawn) {
      const mx = (this.blade.bx + this.blade.tx) / 2
      const my = (this.blade.by + this.blade.ty) / 2
      const r = 72 + lightI * 74 + this.bladeZ * 30
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const grad = ctx.createRadialGradient(mx, my, 6, mx, my, r)
      grad.addColorStop(0, rgba(this.sword.colors.glow, 0.16 * lightI))
      grad.addColorStop(0.55, rgba(this.sword.colors.trail, 0.07 * lightI))
      grad.addColorStop(1, rgba(this.sword.colors.trail, 0))
      ctx.fillStyle = grad
      ctx.fillRect(mx - r, my - r, r * 2, r * 2)
      ctx.restore()
    }

    // parry aura
    if (this.state === 'parry' && this.parryActive > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = rgba(this.sword.colors.glow, 0.4 + 0.2 * Math.sin(time * 30))
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.arc(this.x, this.hipY - 18, 44 + Math.sin(time * 22) * 3, -1.1, 1.1)
      ctx.stroke()
      ctx.restore()
    }
    // charge aura
    if (this.charging && this.chargeReady) {
      const c = this.sword.colors
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const r = 30 + this.chargeRatio * 16 + Math.sin(time * 18) * 4
      ctx.strokeStyle = rgba(c.glow, 0.3 + 0.2 * Math.sin(time * 14))
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(this.x, this.hipY - 16, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // ---- STROBE RIM LIGHT (lighting engine): the bolt that casts the
    // shadow also lights the caster — an additive edge pass on the lit
    // side of the silhouette, flickering with the restrike cadence. ----
    if (this.strobeLight && this.strobeK > 0.04) {
      const g = this.geom
      ctx.save()
      ctx.translate(this.x, this.hipY)
      ctx.scale(this.face * SCALE, SCALE)
      const rc = this.rimChains
      const L = (j: { x: number; y: number }, out: number[]) => { out.push(j.x, j.y) }
      rc[0].length = 0
      L(g.hipPtL, rc[0]); L(g.kneeL, rc[0]); L(g.ankleL, rc[0])
      rc[1].length = 0
      L(g.hipPtR, rc[1]); L(g.kneeR, rc[1]); L(g.ankleR, rc[1])
      rc[2].length = 0
      L(g.hip, rc[2]); L(g.waist, rc[2]); L(g.chest, rc[2]); L(g.neckTop, rc[2])
      rc[3].length = 0
      L(g.shoulderL, rc[3]); L(g.elbL, rc[3]); L(g.handL, rc[3])
      rc[4].length = 0
      L(g.shoulderR, rc[4]); L(g.elbR, rc[4]); L(g.handR, rc[4])
      drawStrobeRim(ctx, this.strobeLight, this.strobeK * alpha, rc,
        { x: g.headC.x, y: g.headC.y, r: 9.2 }, this.face, 5)
      ctx.restore()
    }
  }
}

/* ------------------------------------------------------------------ */

const TAU_LIKE = Math.PI * 2

interface EnemyLike {
  id: number
  x: number
  y: number
  d?: number
}

function fromChain(def: AttackDef, next: string, player: Player): boolean {
  if (next === 'riposte') return true
  // launcher chains naturally into air attacks
  if (def.id === 'launcher' && (next.startsWith('a') || next === 'dive' || next === 'slam')) return true
  if (def.chain.includes(next)) return true
  // any light may restart the chain if the window allows
  if (player.grounded && next.startsWith('l') && def.chain.some((c) => c.startsWith('l'))) return true
  if (!player.grounded && (next.startsWith('a') || next === 'dive' || next === 'slam') && def.chain.some((c) => c.startsWith('a') || c === 'dive' || c === 'slam')) return true
  return false
}
