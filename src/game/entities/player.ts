import {DASH_STAMINA_MAX,DASH_STAMINA_COST,POWER_DASH_STAMINA_COST,DASH_STAMINA_REGEN,DASH_STAMINA_REGEN_STILL,DASH_STAMINA_REGEN_SPRINT,DASH_STAMINA_REGEN_DELAY} from '../combat/stamina'
import {tractionAcceleration,contactVelocity,SUPPORT_GRAVITY,quadraticDragVelocity,airDragCoefficient} from '../physics/motion-laws'
import {PLAYER_MASS,brakeVelocity,dragVelocity,attackDriveVelocity,landingLoad,type LandingLoad} from '../physics/player-motor'
import {rewardsConfirmedHit} from '../combat/hit-resolution'
import {groundedDashAct} from '../anim/grounded-dash'
import {DASH_CHARGE_CLIP,POWER_DASH_CLIP,powerDashAct,powerDashRecovery,powerDashLift} from '../anim/power-dash'
/** STICKMAN RISING — the Player: state machine, dash system, combo machine,
 * parry/riposte, charged attacks, elemental abilities, execution finishers.
 */

import {drawArticulatedHand} from '../anim/humanoid'
import {drawDetail,DRAW_CLEAR,DRAW_GRIP} from '../anim/draw-detail'
import {equipmentClip} from '../anim/equipment-motion'
import {handPose,unarmedAttack,UNARMED_CHARGE,UNARMED_PARRY,UNARMED_ULT,UNARMED_FLOURISH_CLIP} from '../combat/unarmed'
import type {Clip,PlayOpts} from '../anim/animator'
import { DashBody } from '../physics/dash-body'
import { SprintExposure,SPRINT_EXPOSURE_CHANNELS } from '../anim/sprint-exposure'
import { Animator } from '../anim/animator'
import { handGestures } from '../anim/hand-gestures'
import { ContextMotion,DEFAULT_CONTEXT,type MotionContext } from '../anim/context-motion'
import { SwordArcSolver } from '../anim/armarc'
import { makePose, Pose, CH } from '../anim/pose'
import { PLAYER_SPEC, PLAYER_STYLE } from '../anim/skeleton'
import { FighterGeom, drawFighter3D, FOCUS, ikArm3D, makeFighterGeom, solveFighter3D } from '../anim/rig3d'
import { FootPlan, GaitPlanner, LegIKOut, PLAYER_GAIT, solveLegIK, toeFromPitch } from '../anim/legik'
import { AnatomicalMotion } from '../anim/motion-constraints'
import { applyJointLimits } from '../anim/limits'
import { PaveState, applyPave, updatePaveSpin, type JumpStyle } from '../anim/pave'
import { KeyLight, ShadowFigure, drawCastShadow } from '../render/lighting'
import { reflectOffSegment } from '../fx/lightning'
import {
  AIR_JUMP_CLIP, BACKPEDAL_CLIP, BRAKE_CLIP, CHARGE_CLIP, COMBAT_IDLE_CLIP, COMBAT_STEP_CLIP,
  DRAW_CLIP, FALL_CLIP, FLOURISH_HILT_SPIN_CLIP, FLOURISH_SCARF_ADJUST_CLIP,
  FLOURISH_STANCE_SETTLE_CLIP, FLOURISH_TSUBA_POP_CLIP, HURT_CLIP, IDLE_CLIP, JUMP_CLIP,
  JUMP_LEAP_CLIP, LAND_CLIP, PARRY_CLIP, RUN_CLIP, SHEATHE_CLIP, SPRINT_CLIP, SPRINT_DRIVE_CLIP, STOP_CLIP, WALK_CLIP,
} from '../anim/clips'
import { ATTACKS, AttackDef, AttackRuntimeInfo, makeRuntimeInfo } from '../combat/attacks'
import {
  DashVariant, DashVariantCfg, DASH_VARIANTS, evaluateDash,
} from '../combat/dash'
import { drawSword, SWORDS, SwordDef, SwordId } from '../combat/swords'
import { Trail } from '../fx/fx'
import { WorldRef } from '../core/types'
import { clamp, clamp01, damp, rand, rgba, segHitsCircle } from '../core/utils'

/** The reference finish: upright chest, extended trailing leg and a bent
 * forward support leg. Keep attack arms authored by the attack itself. */
function dashFinishPose(p:Pose,weight:number,mirrored:boolean,arms:boolean,armWeight=weight,armed=false):void {
  const rear=mirrored?CH.hipR:CH.hipL,lead=mirrored?CH.hipL:CH.hipR
  const rearKnee=mirrored?CH.kneeR:CH.kneeL,leadKnee=mirrored?CH.kneeL:CH.kneeR
  p[rear]+=(-.65-p[rear])*weight;p[lead]+=(.88-p[lead])*weight
  p[rearKnee]+=(-.35-p[rearKnee])*weight;p[leadKnee]+=(-1.28-p[leadKnee])*weight
  if(arms){
    const bladeArm=p[CH.shR]+p[CH.elR]
    p[CH.shL]+=(.65-p[CH.shL])*armWeight;p[CH.elL]+=(-1.05-p[CH.elL])*armWeight
    p[CH.shR]+=(.35-p[CH.shR])*armWeight;p[CH.elR]+=(-.85-p[CH.elR])*armWeight
    if(armed)p[CH.wrR]+=bladeArm-p[CH.shR]-p[CH.elR]
  }
}

/** Keep dash arms bent and near the chest, with an independent front hand.
 * Targets are shoulder-relative and use the rig's true upper/forearm lengths. */
function dashGuardPose(p:Pose,weight:number,progress:number,power:boolean,armed:boolean):void {
  const arc=Math.sin(Math.PI*clamp01(progress))
  const left=handPose('left',power?17+2*arc:14+2*arc,power?13:19)
  const right=handPose('right',power?10:6,power?17:23)
  p[CH.shL]+=(left.shL!-p[CH.shL])*weight;p[CH.elL]+=(left.elL!-p[CH.elL])*weight
  const old=p[CH.shR]+p[CH.elR]
  p[CH.shR]+=(right.shR!-p[CH.shR])*weight;p[CH.elR]+=(right.elR!-p[CH.elR])*weight
  // The drawn weapon keeps the same orientation as the authored carry.
  if(armed)p[CH.wrR]+=old-p[CH.shR]-p[CH.elR]
}

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
  | 'move' | 'attack' | 'dash' | 'dashCharge' | 'parry' | 'charge' | 'hurt' | 'dead'
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
const AIR_ACCEL = 650
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
const POWER_DASH_CHARGE = 0.32
const POWER_DASH_RECOVERY = 0.34
const DASH_FINISH_RISE = 0.24
/** dash ghost beats: fire times as fractions of dash duration (research:
 * cap 3, exponential spacing) + the per-ghost starting darkness */
const DASH_GHOST_BEATS = [0.24, 0.48, 0.72]
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
  driveRemaining:number
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
  readonly maxStamina = DASH_STAMINA_MAX
  stamina = DASH_STAMINA_MAX
  private staminaRegenDelay = 0
  meter = 0

  sword: SwordDef = SWORDS.katana

  state: PlayerState = 'move'
  private animator = new Animator(true)
  private contextMotion = new ContextMotion()
  sprintExposure=new SprintExposure()
  private motionContext:MotionContext = {...DEFAULT_CONTEXT}
  private contextClip = ''
  private contextEntrySpeed = 0
  private stopEntrySpeed = 0
  /** Last contact load, captured before the ground removes normal velocity. */
  readonly physicsMetrics={mass:PLAYER_MASS,momentumX:0,momentumY:0,energy:0,forceX:0,forceY:0,supportLoad:0}
  landingLoad:LandingLoad=landingLoad(0)
  private landingImpact = 0
  private landingRecoveryT = 0
  /** Deterministic condition readout for the animation inspector. */
  animationVariation = 'rest-open'

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
  private sprintDriveT = 0
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
  private emptyTrail:Trail={active:false,pts:new Float32Array(4),head:0,count:0,N:1,age:0,life:0,color:'#000',color2:'#000',width:0,emitting:false}
  private postAttackT = 0
  private postArmVel = 0
  /** smoothed acceleration → anticipatory lean (previous-frame awareness) */
  private accelSm = 0
  private prevVx = 0
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
  private landSpring = 0
  private landSpringDecay=5

  private dashChargeT=0
  private dashChargeReady=false
  private dashChargeFxT=0
  private dashChargeX=1
  private dashPower=false
  private dashPendingCharge=false
  private dashPendingJump=false
  private dashRecoverT=0
  private dashFinishT=0
  private dashDodgeGranted=false
  private dashDodgeWindow=0
  private dashT = 0
  /** Force telemetry is exposed for the animation/physics inspector. */
  dashDisplayPitch=0
  dashBody:DashBody|null=null
  private dashMotionActive=false
  private dashBoostFxFired=false
  private dashSink=0
  private dashSkim=0
  private dashLift=0
  private dashWakeTimer=0
  private dashWakeCount=0
  private dashCatchFxFired=false
  private dashDisplacement:{x:number;y:number}|null=null
  private dashDur = DASH_VARIANTS.launch.dur
  /** active variant config (clip + tuning) — set on startDash */
  private dashCfg: DashVariantCfg = DASH_VARIANTS.launch
  private dashCd = 0
  private dashConsec = 0
  /** Chain animation follows recent dashes; it does not impose a recharge lock. */
  private dashChainT = 0
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
  private dashBurstFired = false
  /** when the last dash ended — the momentum tail window feeds the
   * dash-strike conversion (attacking on dash momentum = through-cut) */
  private dashEndedAt = -10
  /** POST-RETREAT GUARD LOCK: a backdash/escape commits the facing toward
   * the threat for a beat — holding the retreat direction accelerates past
   * the backpedal speed threshold within ~15ms, which would otherwise flip
   * the body into a fleeing run mid-evade. Dodging reads as dodging WITH
   * the guard up; the turn develops after the lock, if still held. */
  private retreatLockT = 0

  private parryBraceT=0
  private parryT = 0
  private parryActive = 0
  riposteT = 0
  private parryPerfect = false

  /* ---- SWORD HOME (notō / iai): the sheath system. swordDrawn=false →
   * the steel rides inside the saya, locomotion arms are HANDS-ONLY, and
   * any combat input snaps it back out with the iai flash. Defaults to
   * sheathed Iai / Battōjutsu mode. */
  swordDrawn = false
  /** the active one-shot sheath/draw ritual (runs inside state 'move') */
  private carryRelaxW=0
  private sheathAct: { t: number; dur: number; mode: 'sheathe' | 'draw' } | null = null
  /** seconds of standing peace (no threat, no combat) — feeds auto-sheathe */
  private peaceT = 0
  /** damped weight of the sheathed pommel-rest arm layer */
  private sheathW = 0

  /* ---- PAVE: procedural animation variation — the bounded secondary-
   * motion layer (moving holds, breath, hurt posture, sword body-language,
   * combo escalation flair). Additive pass that runs AFTER every authored /
   * procedural writer and the grip IK, BEFORE the anatomical limits + FK
   * solve (documented solve order). Per-entity seeded → no two plays of a
   * clip render identically. */
  private pave = new PaveState()
  /** seconds since the last damage taken (flinch carryover window 0–1s) */
  private sinceHitT = 99
  /** seconds airborne (aerial pose evolution: tuck → extend → spread) */
  private airT = 0
  /** airborne silhouette variant for PAVE ('leap' = momentum long-jump) */
  private jumpStyle: JumpStyle = 'standard'

  /* ---- IDLE FLOURISHES & SCARF SIMULATION ---- */
  private standstillT = 0
  private lastFlourish = -1
  private isFlourishActive = false
  private flourishDur = 0
  private flourishT = 0

  private scarfSimNodes = [
    { x: 0, y: 0, ox: 0, oy: 0 },
    { x: -5, y: 3, ox: -5, oy: 3 },
    { x: -11, y: 8, ox: -11, oy: 8 },
    { x: -18, y: 14, ox: -18, oy: 14 },
    { x: -26, y: 20, ox: -26, oy: 20 },
  ]

  private chargeT = 0
  charging = false
  private chargeReady = false

  private hurtT = 0
  private deadT = 0

  /* ---- WEIGHT: hip height derives from the planted foot (foot-ground
   * lock) — no floating, no digging, real weight transfer for every pose. */
  private motion = new AnatomicalMotion()
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
    this.playAnimation(IDLE_CLIP, { blend: 0.05 })
  }

  reset(x: number): void {
    this.dashChargeT=0;this.dashChargeReady=false;this.dashChargeX=1;this.dashPower=false;this.dashPendingCharge=false;this.dashPendingJump=false;this.dashRecoverT=0;this.dashFinishT=0
    this.dashBody=null;this.dashDisplacement=null;this.dashMotionActive=false;this.dashBoostFxFired=false;this.dashSink=0;this.dashSkim=0;this.dashLift=0;this.dashWakeTimer=0;this.dashWakeCount=0;this.dashCatchFxFired=false
    this.motion.reset()
    this.x = x
    this.y = 0
    this.vx = 0
    this.vy = 0
    this.physicsMetrics.momentumX=0;this.physicsMetrics.momentumY=0;this.physicsMetrics.energy=0
    this.physicsMetrics.forceX=0;this.physicsMetrics.forceY=0;this.physicsMetrics.supportLoad=this.physicsMetrics.mass*SUPPORT_GRAVITY
    this.face = 1
    this.grounded = true
    this.gait.reseed(x,1);this.gaitW=0;this.footLock=HIP_H
    this.contextMotion.reset()
    this.sprintExposure.reset()
    this.contextClip='';this.landingRecoveryT=0;this.landingImpact=0;this.landingLoad=landingLoad(0);this.landSpring=0;this.landSpringDecay=5;this.parryBraceT=0;this.stopEntrySpeed=0
    this.hp = this.maxHp
    this.energy = this.maxEnergy
    this.stamina = this.maxStamina;this.staminaRegenDelay=0
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
    this.sprintDriveT=0
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
    this.dashConsec = 0
    this.dashChainT = 0
    this.dashCd = 0
    this.retreatLockT = 0
    this.swordDrawn = false
    this.sheathAct = null
    this.carryRelaxW=0
    this.peaceT = 0
    this.sheathW = 0
    this.pave = new PaveState()
    this.sinceHitT = 99
    this.airT = 0
    this.jumpStyle = 'standard'
    this.standstillT = 0
    this.isFlourishActive = false
    this.playAnimation(IDLE_CLIP, { blend: 0.05 })
  }

  setSword(id: SwordId): void {
    this.sword = SWORDS[id]
  }

  get atkSpeed(): number {
    return this.sword.stats.spd
  }

  get busy(): boolean {
    return this.state === 'dashCharge' || this.state === 'attack' || this.state === 'charge' || this.state === 'parry' || this.state === 'scripted'
  }

  get chargeRatio(): number {
    return clamp01(this.chargeT / 0.55)
  }

  /** The blade's CHARGE for rendering: whichever live charge is driving the
   * steel — the heavy-hold gather OR the planted dash-charge coil (the blade
   * charges while the dash charges). Physical, not arcane: this ratio drives
   * the steel's kinetic language (edge glint, vibration ghost, kissaki star)
   * in drawSword — never a neon halo. */
  get bladeChargeRatio(): number {
    return Math.max(this.chargeRatio, this.state === 'dashCharge' ? this.dashChargeProgress : 0)
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

  get dashChargeProgress():number {return this.state==='dashCharge'?clamp01(this.dashChargeT/POWER_DASH_CHARGE):0}
  get staminaCooldown():number {return this.staminaRegenDelay}

  get hipY(): number {
    // footLock (damped) IS the hip height: planted-foot-derived → weight.
    // (geom already contains pose rootY, so no double count.)
    return this.y - this.footLock - this.dashLift
  }

  /* ------------------------------------------------------------------ */
  /* main update                                                          */
  /* ------------------------------------------------------------------ */

  update(dt: number, w: WorldRef): void {
    const incomingVx=this.vx,incomingVy=this.vy
    this.dashDisplacement=null
    // Quadratic air resistance acts on the real velocity outside the dash
    // motor too. Ground movement can still actively replace the lost speed.
    if(this.state!=='dash'&&!this.dashMotionActive){
      const lean=this.grounded&&this.loco==='sprint'&&this.vx*this.face>0?.35:0
      this.vx=quadraticDragVelocity(this.vx,airDragCoefficient(lean),dt)
    }
    this.iframes = Math.max(0, this.iframes - dt)
    this.armorT = Math.max(0, this.armorT - dt)
    this.flashT = Math.max(0, this.flashT - dt * 5)
    this.sinceHitT += dt
    this.swingGlow = Math.max(0, this.swingGlow - dt * 5)
    this.riposteT = Math.max(0, this.riposteT - dt)
    this.energy = Math.min(this.maxEnergy, this.energy + dt * 3)
    const staminaWait=this.staminaRegenDelay
    this.staminaRegenDelay=Math.max(0,staminaWait-dt)
    // STILLNESS LAW: recovery is physical. A planted body (feet down, |vx|
    // near zero — including the dash-charge stance, where the character is
    // logically STANDING while the button is held) rests at full rate; a
    // moving gait recovers slower; a full sprint barely trickles back.
    // Swinging and dashing are exertion: those states pause the meter.
    if(this.staminaRegenDelay<=0&&!this.dashMotionActive&&this.state!=='dead'&&this.state!=='attack'&&this.state!=='dash'){
      const still=this.grounded&&Math.abs(this.vx)<30
      const rate=still?DASH_STAMINA_REGEN_STILL:this.loco==='sprint'?DASH_STAMINA_REGEN_SPRINT:DASH_STAMINA_REGEN
      this.stamina=Math.min(this.maxStamina,this.stamina+rate*Math.max(0,dt-staminaWait))
    }
    // Do not save a failed dash press and unexpectedly fire it after regen.
    if(w.input.pressed('dash')&&this.stamina<DASH_STAMINA_COST){
      w.input.takeBuffered('dash');this.dashPendingCharge=false
    }

    // A held press during the short power recovery is remembered only while
    // it remains held. Releasing or losing focus cancels it, never auto-fires.
    if(w.input.pressed('dash') && this.stamina>=DASH_STAMINA_COST && (this.dashRecoverT>0||this.dashFinishT>0||(this.dashPower&&this.dashMotionActive))){
      this.dashPendingCharge=w.input.down('dash')
      w.input.takeBuffered('dash')
    }
    if(!w.input.down('dash')||this.state==='hurt'||this.state==='dead'||this.state==='scripted')this.dashPendingCharge=false
    if(this.state==='move'&&(this.dashRecoverT>0||this.dashFinishT>0)&&w.input.pressed('jump')){
      this.dashPendingJump=true;w.input.takeBuffered('jump')
    }
    if(this.state!=='move')this.dashPendingJump=false
    if(this.dashPendingJump&&this.dashRecoverT<=0&&this.dashFinishT<=0&&!this.dashMotionActive&&this.state==='move'&&this.grounded){
      this.dashPendingJump=false;this.dashPendingCharge=false;this.doJump(w)
    }
    if(this.dashPendingCharge&&this.dashRecoverT<=0&&this.dashFinishT<=0&&!this.dashMotionActive&&this.state==='move'&&this.grounded){
      this.dashPendingCharge=false
      this.requestDash(w,w.input.axisX(),w.input.axisY())
    }

    // context-system clocks
    this.now += dt
    this.locoT += dt
    this.sprintDriveT=Math.max(0,this.sprintDriveT-dt)
    if (this.turnT > 0) this.turnT = Math.max(0, this.turnT - dt * 6) // ~0.17s pivot
    if (this.postAttackT > 0) this.postAttackT = Math.max(0, this.postAttackT - dt)
    // the sword-home ritual only lives in the move state — any external
    // transition (hurt / parry / scripted) abandons it
    if (this.state !== 'move' && this.sheathAct) this.sheathAct = null

    switch (this.state) {
      case 'move': this.updateMove(dt, w); break
      case 'attack':
        if ((w.input.pressed('dash') || w.input.buffered('dash')) && this.canDash()) {
          this.requestDash(w,w.input.axisX(),w.input.axisY())
        } else {
          if(this.dashMotionActive)this.advanceDashMotor(dt,w)
          this.updateAttack(dt, w)
        }
        break
      case 'dash': this.updateDash(dt, w); break
      case 'dashCharge': this.updatePowerDashCharge(dt,w); break
      case 'parry': this.updateParry(dt, w); break
      case 'charge': this.updateCharge(dt, w); break
      case 'hurt': this.updateHurt(dt, w); break
      case 'dead': this.updateDead(dt, w); break
      case 'scripted': this.updateScripted(dt); break
    }

    // A jump pressed on the exact landing frame is queued as well.
    if(this.state==='move'&&(this.dashRecoverT>0||this.dashFinishT>0)&&w.input.pressed('jump')){
      this.dashPendingJump=true;w.input.takeBuffered('jump')
    }

    // A dash activated from movement participates in THIS physics step too.
    if(this.state==='dash'&&!this.dashDisplacement)this.updateDash(dt,w)
    // The charged burst has a real, short momentum-absorption tradeoff.
    // It never locks sword inputs and it cannot reverse velocity.
    if((this.dashRecoverT>0||this.dashFinishT>0) && this.grounded && !this.dashMotionActive){
      const progress=this.dashRecoverT>0?POWER_DASH_RECOVERY-this.dashRecoverT:DASH_FINISH_RISE-this.dashFinishT
      const u=clamp01(progress/.08),blend=u*u*(3-2*u)
      const brake=1400+((this.dashRecoverT>0?3000:3600)-1400)*blend
      this.vx=brakeVelocity(this.vx,tractionAcceleration(brake),dt)
    }
    // physics integration (shared)
    if (this.state !== 'dash' && !this.dashDisplacement) {
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
    const dashTravel=this.dashDisplacement as {x:number;y:number}|null
    this.x += dashTravel?.x ?? this.vx * dt
    this.y += dashTravel?.y ?? this.vy * dt

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
    this.airT = this.grounded ? 0 : this.airT + dt
    // PAVE airborne spin accumulator — inert unless a jump style sets a
    // target; the post-landing unwind to the nearest full turn preserves
    // rendered pose continuity (pave.ts owns the math).
    updatePaveSpin(this.pave, dt, !this.grounded)
    // arena bounds
    if (this.x < w.arenaMinX + 20) {
      this.x = w.arenaMinX + 20
      if (this.vx < -200) w.fx.dust(this.x - 12, 0, 5)
      if(this.vx<0)this.absorbDashWall()
      this.vx = contactVelocity(this.vx,1)
    }
    if (this.x > w.arenaMaxX - 20) {
      this.x = w.arenaMaxX - 20
      if (this.vx > 200) w.fx.dust(this.x + 12, 0, 5)
      if(this.vx>0)this.absorbDashWall()
      this.vx = contactVelocity(this.vx,-1)
    }

    const m=this.physicsMetrics
    m.momentumX=m.mass*this.vx;m.momentumY=m.mass*this.vy
    m.energy=.5*m.mass*(this.vx*this.vx+this.vy*this.vy)
    m.forceX=m.mass*(this.vx-incomingVx)/Math.max(dt,1e-8)
    m.forceY=m.mass*(this.vy-incomingVy)/Math.max(dt,1e-8)
    m.supportLoad=this.grounded?m.mass*SUPPORT_GRAVITY:0
    this.landingRecoveryT=Math.max(0,this.landingRecoveryT-dt)
    this.dashCd = Math.max(0, this.dashCd - dt)
    this.dashRecoverT = Math.max(0, this.dashRecoverT - dt)
    this.dashFinishT = Math.max(0, this.dashFinishT - dt)
    this.retreatLockT = Math.max(0, this.retreatLockT - dt)
    this.dashChainT = Math.max(0, this.dashChainT - dt)
    if (this.dashChainT <= 0) this.dashConsec = 0

    // ability script
    if (this.ability) this.updateAbility(dt, w)

    // animation + solve
    this.updateGait(dt, w)
    const gaitClip = this.animator.getClip()?.name
    const syncGait = this.state === 'move' && this.grounded && !this.braking
      && !this.sheathAct && ['walk','run','sprint','sprintDrive','combatStep','backpedal'].includes(gaitClip ?? '')
    this.animator.update(dt, syncGait ? this.gait.phase : undefined,
      this.dashDisplacement&&this.dashBody&&this.animator.getClip()?.name===(this.dashPower?POWER_DASH_CLIP:this.dashCfg.clip).name?(this.dashPower?this.dashBody.progress*POWER_DASH_CLIP.dur:this.dashBody.poseProgress*this.dashCfg.clip.dur):undefined)
    // Base layer: the clip FULLY owns the pose each frame (write, never
    // accumulate). applyProcedural() is a bounded additive layer on top.
    // Without this copy, procedural += deltas integrate unbounded → spine
    // spin + root sink. (Same contract as Spine's AnimationState.apply /
    // Godot AnimationTree → Skeleton2D.)
    this.pose.set(this.animator.pose)
    this.applyProcedural(dt)
    if(this.state==='dash'&&this.dashBody){
      const b=this.dashBody
      const forcePitch=clamp(b.ax*this.face/18000,-.055,.055)
      this.pose[CH.rootRot]+=forcePitch
      this.pose[CH.head]-=forcePitch
      if(b.phase==='load'||b.phase==='wall')this.pose[CH.rootY]+=b.phase==='wall'?1.5:.7
      this.pose[CH.elL]-=clamp(Math.abs(b.ax)/220000,0,.075)
    }
    const motionClip=this.animator.getClip()
    if(this.contextClip!==motionClip?.name){this.contextClip=motionClip?.name??'';this.contextEntrySpeed=Math.abs(this.vx)}
    const motionPhase=motionClip&&motionClip.dur>0
      ? (motionClip.loop?(this.animator.getTime()/motionClip.dur)%1:Math.min(1,this.animator.getTime()/motionClip.dur)):0
    Object.assign(this.motionContext,{state:this.state,clip:motionClip?.name??'idle',phase:motionPhase,
      speed:Math.abs(this.vx),forward:this.vx*this.face,acceleration:this.accelSm*this.face,
      threat:this.enemyNearW,surrounded:this.surrounded,health:this.hp/Math.max(1,this.maxHp),
      grounded:this.grounded,vy:this.vy,swordDrawn:this.swordDrawn,entrySpeed:/stop|brake/i.test(motionClip?.name??'')?this.stopEntrySpeed:this.contextEntrySpeed,
      landingImpact:this.landingImpact,counter:this.action?.fromParry??false,
      attackKind:this.action?.def.kind??'light',dashVariant:this.dashVariant})
    this.contextMotion.apply(this.pose,this.motionContext,dt)
    this.animationVariation=this.contextMotion.variation
    this.motion.update(this.pose, dt, this.state !== 'dead',!this.action?.def.strikeHand)
    // Deliberate 10 Hz sprint acting, AFTER smoothing so holds are not smeared.
    // Attacks/dash/draw interrupt instantly; final contact/grip IK is never cached.
    this.animator.applyPreparedTransition(this.pose,dt)
    const sprintActing=!this.animator.transitioning&&this.state==='move'&&this.grounded&&!this.braking&&!this.sheathAct
      &&/^sprint/.test(motionClip?.name??'')
    if(sprintActing)this.contextMotion.composeSprintArms(this.pose,this.motionContext)
    this.sprintExposure.apply(this.pose,
      this.contextMotion.hands(handGestures(motionClip?.name??'idle',motionPhase,this.swordDrawn||this.sheathW>.1),this.motionContext),
      motionPhase,dt,sprintActing)
    if(this.sprintExposure.active){
      this.animator.adoptDisplayPose(this.pose,SPRINT_EXPOSURE_CHANNELS)
      this.motion.adoptDisplayArms(this.pose)
    }
    // Final low-drive acting lives after entry smoothing, but its own
    // quintic envelope starts/ends at zero with zero velocity/acceleration.
    // Never tip a backward guard or an aerial dodge onto the floor.
    this.dashSink=0;this.dashSkim=0;this.dashLift=0
    if((this.state==='dash'||(this.state==='attack'&&this.dashMotionActive&&this.action?.def.kind==='dash'))&&this.grounded&&this.dashBody&&this.dashDx*this.face>.5&&this.dashBody.phase!=='wall'&&!this.dashPower){
      const cfg=this.dashCfg,load=(cfg.anticipation??.08)*cfg.dur
      const drive=cfg.driveDuration??Math.max(.04,(cfg.dur-load)*.58)
      const a=groundedDashAct(this.dashBody.age,this.dashBody.duration,load,drive),p=this.pose
      // Normal dash remains upright throughout; its own footwork, not a
      // scaled copy of the power lean, supplies the sense of speed.
      p[CH.rootRot]=clamp(a.pitch,this.dashDisplayPitch-14*dt,this.dashDisplayPitch+14*dt)
      this.dashDisplayPitch=p[CH.rootRot]
      p[CH.spine]+=(.02-p[CH.spine])*a.weight
      p[CH.head]+=(-a.pitch-p[CH.head])*a.weight
      const brace=a.compression*a.weight,reach=a.rearReach*a.weight
      const rear=this.dashVariant==='chain'?CH.hipR:CH.hipL
      const lead=this.dashVariant==='chain'?CH.hipL:CH.hipR
      p[CH.rootX]+=1.5*brace
      p[rear]-=.16*reach;p[lead]+=.08*reach
      p[CH.kneeL]-=.12*brace;p[CH.kneeR]-=.12*brace
      if(this.state==='dash')dashGuardPose(p,a.weight*(1-a.catch),this.dashBody.progress,false,this.swordDrawn)
      dashFinishPose(p,a.catch*a.weight,this.dashVariant==='chain',this.state==='dash',a.catch*a.weight,this.swordDrawn)
      this.dashSink=a.drop*a.weight
    }
    // A charged release uses its own authored performance; dash strikes keep
    // their attack arms, while the grounded body follows the same power arc.
    if(this.dashPower&&this.dashMotionActive&&this.grounded&&this.dashBody&&this.dashDx*this.face>.5&&this.dashBody.phase!=='wall'&&(this.state==='dash'||(this.state==='attack'&&this.action?.def.kind==='dash'))){
      const a=powerDashAct(this.dashBody.progress),p=this.pose
      const pitch=.35+1.0*a.drive-.31*a.catch
      p[CH.rootRot]=clamp(pitch,this.dashDisplayPitch-10*dt,this.dashDisplayPitch+10*dt)
      this.dashDisplayPitch=p[CH.rootRot]
      p[CH.spine]=.025;p[CH.head]=-Math.min(.85,Math.max(-.1,p[CH.rootRot]))
      // The moving guard remains separate from the dash-attack arm layer.
      if(this.state==='dash')dashGuardPose(p,a.drive*(1-a.catch),this.dashBody.progress,true,this.swordDrawn)
      dashFinishPose(p,a.catch,this.dashVariant==='chain',this.state==='dash',a.catch,this.swordDrawn)
      this.dashSink=a.drop
      this.dashLift=powerDashLift(this.dashBody.age)
      // Both soles follow the low ballistic body arc before returning to the
      // close-to-ground skim and then the planted braking catch.
      this.dashSkim=7*a.drive+this.dashLift
    }
    // Charge/stabilization are planted body-language beats, not flight.
    if(this.grounded&&this.state==='dashCharge'){
      // The planted COIL clip owns the stance (plant → sink → lock — its
      // keyframes are the choreography). This layer adds only what a clip
      // cannot: the live isometric LOAD — an opposing knee/pelvis tremor
      // and a micro tremble in the sword arm itself, the steel visibly
      // straining under stored tension. IK keeps the soles grounded.
      const u=clamp01(this.dashChargeT/POWER_DASH_CHARGE),q=u*u*(3-2*u),p=this.pose
      const tremor=Math.sin(this.now*55)*q
      p[CH.rootX]+=tremor*.7;p[CH.kneeL]+=.045*tremor;p[CH.kneeR]-=.045*tremor
      p[CH.shR]+=.022*tremor;p[CH.elR]+=.016*tremor
      this.dashSink=Math.max(this.dashSink,.4*q)
    } else if(this.grounded&&!this.dashMotionActive&&this.state==='move'&&(this.dashRecoverT>0||this.dashFinishT>0)){
      const progress=this.dashRecoverT>0?1-this.dashRecoverT/POWER_DASH_RECOVERY:1-this.dashFinishT/DASH_FINISH_RISE
      const q=powerDashRecovery(progress),p=this.pose
      // A bounded, damped joint response absorbs impact before standing.
      const wobble=Math.sin(progress*Math.PI*2)*q*(1-progress)
      p[CH.rootRot]+=(.04+.09*wobble-p[CH.rootRot])*q
      p[CH.head]+=(-.04-.04*wobble-p[CH.head])*q
      // Upper body settles just after the legs, rather than every joint
      // snapping to idle on the same frame. Sword attacks still own their arms.
      const armQ=powerDashRecovery(clamp01((progress-.08)/.92))
      dashFinishPose(p,q,this.dashVariant==='chain',true,armQ,this.swordDrawn)
      p[CH.kneeL]-=.10*wobble;p[CH.kneeR]+=.08*wobble
      p[CH.rootY]+=1.5*Math.max(0,wobble)
      this.dashSink=q
    }
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
      def: this.state === 'attack' && this.swordDrawn ? this.action?.def ?? null : null,
      animT: this.action ? this.action.animT : 0,
      enemies: w.enemies,
      face: this.face,
      x: this.x,
      hipY: this.hipY,
      reach: PLAYER_SPEC.blade * this.sword.stats.range * SCALE * 1.1 + 130,
    })
    this.updateBladeDynamics(dt, w) // wrist lag spring + kinetic chain — feeds hitboxes
    this.applyTwoHandGrip(dt)       // off-hand IK onto the tsuka
    // ---- PAVE (bounded organic variation): the additive secondary-motion
    // pass. Positioned deliberately AFTER every authored/procedural writer
    // and the grip IK but BEFORE the anatomical gate + FK solve, so:
    //   (a) the off-hand grip + foot IK re-solve against the varied pose
    //       (a gripping hand never gets uncontrolled noise — brief §6),
    //   (b) applyJointLimits bounds every additive offset,
    //   (c) the arm channels are gated to near-zero inside strike/trail
    //       windows so hitboxes and trails stay crisp.
    {
      const a = this.action
      const striking = this.state === 'attack' && a != null
        && a.animT >= a.def.trail.start - 0.07 && a.animT <= a.def.trail.end + 0.09
      // Precision actions gate the arm channels: strike/trail windows and
      // the dash family are authored contact silhouettes (hand separation,
      // blade arcs) — noise there would blur readable beats. Rituals,
      // parries and the scripted cinematic keep a partial gate so holds
      // stay alive without smearing choreography.
      const armGate = striking || this.state === 'dash' || this.state === 'dashCharge' ? 0.15
        : this.sheathAct != null || this.state === 'parry' || this.state === 'scripted' ? 0.35
        : 1
      const hpFrac = this.hp / this.maxHp
      const speedRatio = clamp01(Math.abs(this.vx) / SPRINT_MAX)
      applyPave(this.pose, {
        time: this.now,
        dt,
        hp: hpFrac,
        comboHits: w.combo?.hits ?? 0,
        speedRatio,
        airborne: !this.grounded,
        airborneT: this.airT,
        chargeRatio: this.chargeRatio,
        sinceHitTaken: this.sinceHitT,
        sword: this.sword.id,
        armGate,
        // contextual breath: calm 14 bpm → combat threat + sprint exertion
        // + near-death labor climb toward ~40 (spec §4.3)
        breathRate: 14 + 12 * this.enemyNearW + 9 * speedRatio + 8 * (1 - hpFrac),
        jumpStyle: this.jumpStyle,
      }, this.pave)
    }
    // ANATOMICAL LIMITS: the last writer before the solve. Clips, additive
    // layers, crossfades and every IK all pass through the same human ROM
    // gate — elbows never cross their flexion side, knees never fold
    // forward, shoulders stay in the glenohumeral envelope.
    applyJointLimits(this.pose,(this.state==='dash'||(this.state==='attack'&&this.dashPower&&this.dashMotionActive&&this.action?.def.kind==='dash'))&&this.dashDx*this.face>.5?1.58:1.1)
    // 3D SOLVE: sagittal channels + depth channels → projected joints + blade
    solveFighter3D(
      this.pose, PLAYER_SPEC, this.geom,
      PLAYER_SPEC.blade * this.sword.stats.range * 1.06,
      this.swingScale,
    )
    this.applyDrawContact()
    this.updateFootLock(dt)         // weight: hips sit on the planted foot
    this.applyGroundIK(dt)          // leg IK: feet exactly where feet go
    this.animator.captureDisplayPose(this.pose,dt)
    this.updateBladeWorld()
    this.updateSwingScale(dt)
    this.updateScarf(dt, w.time)
  }

  private drawSocket(){
    const act=this.sheathAct,seconds=act?.mode==='draw'?act.dur-act.t:0
    const d=drawDetail(seconds),ang=.24+(this.pose[CH.rootRot]+this.pose[CH.spine]*.35)*.6+.30*d.extraction*(1-d.turn)
    return{...d,ang,x:this.geom.hip.x+3-Math.cos(ang)*d.retract,
      y:this.geom.hip.y+1+Math.sin(ang)*d.retract-d.lift}
  }

  /** Final projected hand contact, after smoothing. Small bounded Jacobian
   * solves preserve arm lengths; no hand teleport or stretched bone. */
  private applyDrawContact():void{
    if(this.sheathAct?.mode!=='draw')return
    const socket=this.drawSocket(),p=this.pose
    const length=PLAYER_SPEC.blade*this.sword.stats.range*1.06
    const resolve=()=>solveFighter3D(p,PLAYER_SPEC,this.geom,length,this.swingScale)
    for(const side of ['R','L'] as const){
      const sh=side==='R'?CH.shR:CH.shL,el=side==='R'?CH.elR:CH.elL
      const pull=side==='R'?length*socket.extraction:0
      const tx=socket.x+Math.cos(socket.ang)*pull,ty=socket.y-Math.sin(socket.ang)*pull
      const weight=socket.contact
      const hand=()=>side==='R'?this.geom.handR:this.geom.handL
      const initialSh=p[sh],initialEl=p[el]
      for(let i=0;i<6;i++){
        resolve();const x=hand().x,y=hand().y,ex=tx-x,ey=ty-y
        if(Math.hypot(ex,ey)<.15)break
        p[sh]+=.001;resolve();const ax=(hand().x-x)/.001,ay=(hand().y-y)/.001;p[sh]-=.001
        p[el]+=.001;resolve();const bx=(hand().x-x)/.001,by=(hand().y-y)/.001;p[el]-=.001
        const det=ax*by-ay*bx;if(Math.abs(det)<.001)break
        p[sh]+=clamp((ex*by-ey*bx)/det,-.24,.24)
        p[el]+=clamp((ax*ey-ay*ex)/det,-.24,.24);applyJointLimits(p)
      }
      p[sh]=initialSh+(p[sh]-initialSh)*weight;p[el]=initialEl+(p[el]-initialEl)*weight
    }
    applyJointLimits(p);resolve()
  }

  private onLand(w: WorldRef): void {
    this.landingImpact=Math.max(0,this.vy)
    this.landingLoad=landingLoad(this.landingImpact)
    this.landSpring=this.landingLoad.compression
    this.landSpringDecay=this.landSpring/this.landingLoad.absorptionTime
    if(this.state==='move')this.landingRecoveryT=Math.abs(this.vx)>250?.08:this.landingImpact>700?.20:.12
    w.audio.play('land', { volume: .25+.4*this.landingLoad.pressure })
    w.fx.dust(this.x, 0, Math.round(4+6*this.landingLoad.pressure))
    // re-seed the gait anchors under the landing position — the squash
    // parks both feet flat through the absorb, then stepping resumes
    this.gait.reseed(this.x, this.face)
    // slam impact while attacking
    const a = this.action
    if (a && a.def.slamImpact && !a.impactDone) {
      a.impactDone = true
      this.slamAoe(w, a.def.slamImpact.r, a.def.slamImpact.dmg, a.def.slamImpact.launch)
    }
    if (this.state === 'move') {
      this.playAnimation(LAND_CLIP, { blend: 0.06 })
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
    if ((this.sprintLatch && speed > 300) || speed > 420) return 'sprint'
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
    // interrupt instantly, preserving the current equipment stance. ----
    if (this.sheathAct) {
      this.updateSheathAct(dt, w, ax, ay)
      return
    }

    // ---- facing: hold toward an engaged threat at maneuvering speed ----
    // (Condition B: circle/retreat keeps the guard trained on the enemy —
    // backpedal instead of a civilian turn-away. Full-speed escape or
    // open-space movement flips freely — EXCEPT inside the post-retreat
    // guard lock: a dash-back never converts into a fleeing turn.)
    if (this.dashRecoverT<=0 && this.dashFinishT<=0 && ax !== 0 && this.face !== (ax > 0 ? 1 : -1)) {
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

    // Sprint intent belongs to the event-level input recognizer. Release,
    // opposing direction, blur and pause cannot leave a stale latch behind.
    const heldSprint=(input.sprintDirection?.()??0)===Math.sign(ax)&&ax!==0
    if(heldSprint&&!this.sprintLatch)this.sprintDriveT=.22 // first propulsive support beat
    if(!heldSprint)this.sprintDriveT=0
    this.sprintLatch=heldSprint

    // Resolve dash from the incoming state BEFORE applying this frame's
    // walking/braking forces. Otherwise reversal classification varies by Hz.
    if(!input.pressed('sheathe')&&(input.pressed('dash')||input.buffered('dash'))&&this.canDash()){
      this.requestDash(w,ax,ay)
      return
    }

    // ---- horizontal movement (sprint has its own accel curve + ceiling) ----
    const sprinting = this.sprintLatch && this.grounded && ax !== 0 && Math.sign(ax) === Math.sign(this.vx || ax)
    const vMax = sprinting ? SPRINT_MAX : MOVE_MAX
    if ((this.dashRecoverT>0||this.dashFinishT>0) && this.grounded) {
      // Inertia owns the skid: direction input cannot steer until settled.
    } else if (ax !== 0) {
      // input reversal at speed → BRAKE (skid decel + one-shot clip + dust)
      const reversing = this.grounded && Math.sign(ax) !== Math.sign(this.vx) && Math.abs(this.vx) > 240
      if (reversing && this.grounded && !this.braking) {
        this.braking = true
        this.stopEntrySpeed=Math.abs(this.vx)
        this.playAnimation(BRAKE_CLIP, { blend: 0.04 })
        w.fx.dust(this.x - this.face * 10, 0, 7)
        w.audio.play('land', { volume: 0.35 })
      }
      if (reversing || this.braking) {
        // hard skid deceleration toward zero before re-accelerating
        this.vx = brakeVelocity(this.vx,tractionAcceleration(BRAKE_DECEL),dt)
      } else {
        // analog target speed: axis magnitude maps to a target velocity —
        // partial input = partial speed (walk reachable; touch-friendly),
        // full keys still hit the ceiling. Accelerate toward it, never past.
        const targetV = ax * vMax
        const movingToward = Math.sign(this.vx) === Math.sign(targetV) || this.vx === 0
        if (!movingToward || Math.abs(this.vx) < Math.abs(targetV)) {
          const accel = !this.grounded ? AIR_ACCEL : sprinting ? SPRINT_ACCEL : ACCEL
          this.vx += (this.grounded?tractionAcceleration(ax*accel):ax*accel)*dt
          if (Math.sign(this.vx) === Math.sign(targetV) && Math.abs(this.vx) > Math.abs(targetV)) {
            this.vx = targetV
          }
        } else if (Math.sign(this.vx) === Math.sign(targetV) && Math.abs(this.vx) > Math.abs(targetV)) {
          // ease down toward the lower analog target (stick pushed softer)
          // Overspeed is momentum, not invalid input. Dissipate it rather
          // than snapping dash exits / airborne travel to the run ceiling.
          const desired=targetV+(this.vx-targetV)*Math.exp(-(this.grounded?6:.55)*dt)
          // At extreme carry speeds, traction bounds braking rather than
          // allowing exponential target seeking to demand infinite force.
          this.vx+=this.grounded?tractionAcceleration((desired-this.vx)/Math.max(dt,1e-8))*dt:desired-this.vx
        }
      }
    } else if (this.grounded) {
      if(!this.braking && Math.abs(this.vx)>35 && !this.sheathAct){
        this.braking=true
        this.stopEntrySpeed=Math.abs(this.vx)
        this.playAnimation(STOP_CLIP,{blend:.085})
      }
      this.vx = brakeVelocity(this.vx,tractionAcceleration(FRICTION),dt)
    } else {
      this.vx = dragVelocity(this.vx,.4,dt)
    }

    // ---- locomotion clip selection (context-aware, hysteresis) ----
    const speed = Math.abs(this.vx)
    if (this.grounded) {
      if(this.landingRecoveryT>0 && this.animator.getClip()?.name===LAND_CLIP.name){
        // Preserve the impact/rolling landing instead of stomping it next frame.
      } else if (this.braking) {
        if (this.animator.isDone() || (ax !== 0 && speed < 90)) this.braking = false
      } else {
        this.setLoco(this.pickLoco(speed, ax))
        // GAIT-CADENCE SYNC: clip playback speed follows the legik planner's
        // step cadence (velocity ÷ stride) so the authored torso bob + arm
        // pump land on the SAME beat as the IK-planted feet — the stride
        // length itself derives from velocity, so planted feet never skate.
        const cad = Math.max(0.001, this.gait.cadence)
        const cadSpeed = (dur: number) => cad * dur
        switch (this.loco) {
          case 'walk':
            this.playAnimation(WALK_CLIP, { blend: 0.18, syncPhase: true, speed: cadSpeed(WALK_CLIP.dur) })
            break
          case 'run':
            this.playAnimation(RUN_CLIP, { blend: 0.12, syncPhase: true, speed: cadSpeed(RUN_CLIP.dur) })
            break
          case 'sprint':
            this.playAnimation(this.sprintDriveT>0||this.accelSm*this.face>500?SPRINT_DRIVE_CLIP:SPRINT_CLIP, { blend: 0.08, syncPhase: true, speed: cadSpeed(SPRINT_CLIP.dur) })
            break
          case 'combat':
            this.playAnimation(COMBAT_STEP_CLIP, { blend: 0.16, speed: cadSpeed(0.44) })
            break
          case 'combatIdle':
            this.playAnimation(COMBAT_IDLE_CLIP, { blend: 0.18 })
            break
          case 'backpedal':
            this.playAnimation(BACKPEDAL_CLIP, { blend: 0.14, speed: cadSpeed(0.56) })
            break
          default:
            if (speed < 12 && Math.abs(ax) < 0.05 && !this.hasThreat) {
              this.standstillT += dt
              if (this.isFlourishActive) {
                this.flourishT += dt
                if (this.flourishT >= this.flourishDur || this.animator.isDone()) {
                  this.isFlourishActive = false
                  this.standstillT = 0
                  this.playAnimation(IDLE_CLIP, { blend: 0.18 })
                }
              } else if (this.standstillT > 7.2 && !this.swordDrawn) {
                const flourishes = [
                  { clip: FLOURISH_TSUBA_POP_CLIP, dur: 0.95 },
                  { clip: FLOURISH_HILT_SPIN_CLIP, dur: 1.1 },
                  { clip: FLOURISH_SCARF_ADJUST_CLIP, dur: 1.3 },
                  { clip: FLOURISH_STANCE_SETTLE_CLIP, dur: 1.0 },
                  // empty-hand taunt: the fist-palm martial salute (sheathed only)
                  { clip: UNARMED_FLOURISH_CLIP, dur: 1.05 },
                ]
                let idx = Math.floor(Math.random() * flourishes.length)
                if (idx === this.lastFlourish) idx = (idx + 1) % flourishes.length
                this.lastFlourish = idx
                const fl = flourishes[idx]
                this.isFlourishActive = true
                this.flourishDur = fl.dur
                this.flourishT = 0
                this.playAnimation(fl.clip, { blend: 0.16 })
              } else if (!this.isFlourishActive) {
                this.playAnimation(IDLE_CLIP, { blend: 0.16 })
              }
            } else {
              if (this.isFlourishActive) {
                this.isFlourishActive = false
              }
              this.standstillT = 0
              this.playAnimation(IDLE_CLIP, { blend: 0.16 })
            }
        }
      }
    } else if (this.vy < -60) {
      // rising: the takeoff family (jump / leap / air-jump) is authored AT
      // the press (doJump) — never stomp it the frame after; only default
      // to the plain rise clip when airborne WITHOUT a jump entry this
      // flight (e.g. exiting an air dash or an attack float)
      const cn = this.animator.getClip()?.name
      if (cn !== 'jump' && cn !== 'jumpLeap' && cn !== 'airJump') {
        this.playAnimation(JUMP_CLIP, { blend: 0.06 })
      }
    } else {
      this.playAnimation(FALL_CLIP, { blend: 0.12 })
    }

    // ---- actions ----
    if (this.tryCombatInputs(w, ax, ay)) return

    // Quiet-time bookkeeping; chosen equipment mode persists until Q.
    if (this.swordDrawn && this.grounded && !this.hasThreat && Math.abs(this.vx) < 32) {
      this.peaceT += dt
      // Equipment intent is explicit: only Q starts a sheath ritual.
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

    // Dash preserves the selected equipment stance.
    if ((input.pressed('dash') || input.buffered('dash')) && this.canDash()) {
      this.requestDash(w, ax, ay)
      return true
    }
    // jump (grounded = jump 1, plus one air jump) — HANDS-ONLY: the steel
    // can stay home through the whole airborne family
    if (this.dashRecoverT<=0 && this.dashFinishT<=0 && (input.pressed('jump') || input.buffered('jump', 0.18))) {
      if (this.jumpsUsed < 2) {
        this.doJump(w)
        return false
      }
    }
    // parry
    if (input.pressed('parry')) {
      this.enterParry(w)
      return true
    }
    // ability
    if (input.pressed('ability')) {
      if (this.energy >= this.sword.ability.cost) {
          this.startAbility(w)
        return true
      }
    }
    // ult is handled by Game (cinematic)

    // heavy: charge vs tap
    if (input.down('heavy') && this.grounded) {
      this.enterCharge(w)
      return true
    }
    if (input.pressed('heavy') || input.buffered('heavy')) {
      input.takeBuffered('heavy')
      this.startAttack(this.grounded?this.pickHeavy(w):ATTACKS.slam, w)
      return true
    }
    // light
    if (input.pressed('light') || input.buffered('light')) {
      input.takeBuffered('light')
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
    this.playAnimation(SHEATHE_CLIP, { blend: 0.09 })
    w.audio.play('swordSwitch', { volume: 0.3, pitch: 0.7 })
  }

  /** IAI: the deliberate draw (KeyQ). Fast three-beat explosion. */
  private startDraw(w: WorldRef): void {
    if (this.sheathAct || this.swordDrawn) return
    this.sheathAct = { t: DRAW_CLIP.dur, dur: DRAW_CLIP.dur, mode: 'draw' }
    this.playAnimation(DRAW_CLIP, { blend: 0.06 })
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
    if(act.mode==='draw'&&before>act.dur-DRAW_GRIP&&act.t<=act.dur-DRAW_GRIP){
      w.audio.play('swordSwitch',{volume:.16,pitch:1.12}) // grip/collar release, before steel sound
    }
    // ---- the steel crossing the saya mouth (visual gate events) ----
    if (act.mode === 'sheathe') {
      // the slide home begins at ~0.42 into the clip (the MEET beat)
      if (before > act.dur - 0.42 && act.t <= act.dur - 0.42) {
        this.swordDrawn = false
        w.audio.play('swordSwitch', { volume: 0.4, pitch: 0.85 })
      }
    } else {
      // the tip clears after progressive extraction (not a visibility pop)
      if (before > act.dur - DRAW_CLEAR && act.t <= act.dur - DRAW_CLEAR) {
        this.swordDrawn = true
        this.drawBurst(w)
      }
    }
    // ---- interrupts preserve whichever side of the steel gate was reached ----
    if ((input.pressed('dash') || input.buffered('dash')) && this.canDash()) {
      this.sheathAct = null
      this.requestDash(w, ax, ay)
      return
    }
    if (input.pressed('jump') || input.buffered('jump', 0.18)) {
      if (this.jumpsUsed < 2) {
        // jumping keeps the steel home — the airborne family is hands-only;
        // subsequent combat uses the current equipment stance
        this.sheathAct = null
        this.doJump(w)
        return
      }
    }
    if (input.pressed('light') || input.buffered('light')) {
      input.takeBuffered('light')
      this.sheathAct = null
      this.startAttack(ATTACKS.l1, w) // the iai draw-cut
      return
    }
    if (input.pressed('heavy') || input.buffered('heavy')) {
      input.takeBuffered('heavy')
      this.sheathAct = null
      this.startAttack(this.pickHeavy(w), w)
      return
    }
    if (input.pressed('parry')) {
      this.sheathAct = null
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
      this.jumpStyle = wasGrounded && speed > 300 ? 'leap' : 'standard'
      if (wasGrounded && speed > 300) {
        this.vx = Math.sign(this.vx) * Math.max(speed, Math.min(speed * 1.12, 560))
        this.playAnimation(JUMP_LEAP_CLIP, { blend: 0.05 })
      } else {
        this.playAnimation(JUMP_CLIP, { blend: 0.05 })
      }
      w.audio.play('jump', { volume: 0.4 })
      w.fx.dust(this.x, 0, 4)
    } else {
      // AIR JUMP — the mid-air redirect. Clean read: ONE small vertical
      // light streak under the boots (no particle puff cloud).
      this.playAnimation(AIR_JUMP_CLIP, { blend: 0.05 })
      w.fx.motionLine(this.x, this.y - 12, 0, -1, 48, 0.2, '#dff3ff')
      w.audio.play('jump', { volume: 0.3, pitch: 1.18 })
    }
  }

  /* ------------------------------------------------------------------ */
  /* dash — the CONDITIONED ACTIVATION SYSTEM                            */
  /* (variant resolution + tuning live in combat/dash.ts; clips.ts       */
  /*  authors the ten conditioned silhouettes)                            */
  /* ------------------------------------------------------------------ */

  private canDash(): boolean {
    if (this.stamina < DASH_STAMINA_COST || this.dashCd > 0 || this.dashRecoverT > 0 || this.dashFinishT > 0 || (this.dashPower && this.dashMotionActive)) return false
    if (!this.grounded && this.airDashUsed) return false
    return true
  }

  /** CONDITIONED VARIANT RESOLUTION: snapshot the full tactical context at
   * the input instant — airborne, input-vs-facing, momentum, threat
   * geometry (nearest live enemy AHEAD of the dash vector: pocket <170 /
   * hunt band 240–640), surrounded flag, chain count — and hand it to the
   * pure evaluator (combat/dash.ts). Different conditions activate
   * genuinely different animations of the same movement (including inertia reversal). */
  private pickDashVariant(w: WorldRef, dx: number, dy: number): DashVariant {
    const dirX = Math.sign(dx || this.face)
    let aheadD = Infinity,behindD=Infinity
    for (const e of w.enemies) {
      if (e.dead || e.spawning) continue
      if(Math.abs(e.y-this.y)>150)continue
      const d = Math.abs(e.x - this.x)
      if(Math.sign(e.x-this.x)!==dirX)behindD=Math.min(behindD,d)
      if (Math.sign(e.x - this.x) === dirX && d < aheadD) aheadD = d
    }
    const hasAhead = aheadD !== Infinity
    return evaluateDash({
      grounded: this.grounded,
      dx, dy, face: this.face,
      speed: Math.abs(this.vx),
      forwardMomentum:this.vx*dx+this.vy*dy,
      pocketTarget: hasAhead && aheadD < 170,
      huntTarget: hasAhead && aheadD > 240 && aheadD < 640,
      surrounded: aheadD<220&&behindD<220,
      rearTarget:behindD<220,
      enemyNearW: this.enemyNearW,
      chain: this.dashConsec,
    })
  }

  /** Grounded neutral/locomotion presses charge; early release is a normal
   * dash. Air/vertical and active combat cancels remain immediate. */
  private requestDash(w:WorldRef,ax:number,ay:number):void {
    const input=w.input
    if(this.state!=='move'||!this.grounded||Math.abs(ay)>.5){this.startDash(w,ax,ay);return}
    if(!input.down('dash')){
      // Only a real same-frame tap may fire; stale buffered releases and
      // focus resets must never launch after the stabilization lockout.
      input.takeBuffered('dash')
      if(input.released('dash'))this.startDash(w,ax,ay)
      return
    }
    input.takeBuffered('dash')
    this.sheathAct=null;this.dropAction();this.charging=false
    this.state='dashCharge';this.dashChargeT=0;this.dashChargeReady=false;this.dashChargeFxT=0
    this.dashChargeX=ax||this.face
    // The planted CHARGE COIL itself — not a recycled brake cycle played at
    // half speed. Standing entries blend from the near-neutral first beat;
    // running entries arrest through it (traction brakes the real velocity).
    this.playAnimation(DASH_CHARGE_CLIP,{blend:.07})
  }

  private updatePowerDashCharge(dt:number,w:WorldRef):void {
    const input=w.input
    if(!this.grounded){this.state='move';return}
    this.vx=brakeVelocity(this.vx,tractionAcceleration(3200),dt)
    const ax=input.axisX(),ay=input.axisY()
    if(Math.abs(ax)>.2)this.dashChargeX=ax
    // Attack from the charge: a FULLY charged release converts directly into
    // the power dash attack (the startup was already paid in the coil —
    // the blade is charged, so the strike rides the release). Early presses
    // remain plain attacks, exactly as before.
    if(input.pressed('light')||input.buffered('light')){
      input.takeBuffered('light')
      if(this.dashChargeReady&&this.stamina>=POWER_DASH_STAMINA_COST){
        this.startDash(w,this.dashChargeX,0,true)
        this.startAttack(ATTACKS.powerArc,w)
        return
      }
      this.startAttack(ATTACKS[this.pickLight(w,ax,ay)],w);return
    }
    if(input.pressed('heavy')||input.buffered('heavy')){
      input.takeBuffered('heavy')
      if(this.dashChargeReady&&this.stamina>=POWER_DASH_STAMINA_COST){
        this.startDash(w,this.dashChargeX,0,true)
        this.startAttack(ATTACKS.powerArc,w)
        return
      }
      this.startAttack(this.pickHeavy(w),w);return
    }
    if(input.pressed('jump')||input.pressed('parry')||input.pressed('sheathe')){
      this.state='move'
      if(input.pressed('jump'))this.doJump(w)
      else if(input.pressed('parry'))this.enterParry(w)
      else if(this.swordDrawn)this.startSheath(w);else this.startDraw(w)
      return
    }
    if(!input.down('dash')){
      // Input reset/blur is cancellation, not an accidental power shot.
      if(!input.released('dash')){this.state='move';return}
      this.startDash(w,this.dashChargeX,0,this.dashChargeReady)
      return
    }
    this.dashChargeT=Math.min(POWER_DASH_CHARGE,this.dashChargeT+dt)
    this.dashChargeFxT-=dt
    if(this.dashChargeT>.12&&this.dashChargeFxT<=0){
      // Foot-pressure grit: the planted feet crush ground debris — small
      // puffs scatter around the STANCE, thrown off the load line.
      this.dashChargeFxT=.10
      w.fx.dust(this.x+rand(-7,7)-this.dashChargeX*10,-1,2)
      w.cam.addTrauma(.022) // camera honors the user's shake setting
    }
    if(!this.dashChargeReady&&this.dashChargeT>=POWER_DASH_CHARGE){
      this.dashChargeReady=true
      if(this.stamina>=POWER_DASH_STAMINA_COST){
        w.audio.play('chargeReady',{volume:.32,pitch:1.15})
        // The LOCK tell is kinetic, not arcane: the trembling steel snaps
        // taut — a few white glint sparks shed off the kissaki, and the
        // stance settles one final unit (the coil's own last keyframe).
        if(this.swordDrawn)w.fx.sparks(this.blade.tx,this.blade.ty,-Math.PI/2,.4,3,'#eaf6ff',240,.2)
        w.fx.dust(this.x-this.dashChargeX*8,0,3)
        w.cam.addTrauma(.05)
      }
    }
  }

  startDash(w: WorldRef, ax: number, ay: number, power=false): void {
    w.input.takeBuffered('dash')
    if(this.stamina<DASH_STAMINA_COST){if(this.state==='dashCharge')this.state='move';return}
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
    const powerDash=power&&this.stamina>=POWER_DASH_STAMINA_COST&&this.grounded&&Math.abs(dx)>.5&&Math.abs(dy)<.5
    this.stamina=Math.max(0,this.stamina-(powerDash?POWER_DASH_STAMINA_COST:DASH_STAMINA_COST))
    this.staminaRegenDelay=DASH_STAMINA_REGEN_DELAY
    // Power uses its own motor timing even in a pocket/retreat context;
    // a short standard-dash variant must not cut off the power performance.
    const cfg=powerDash?{...DASH_VARIANTS[variant],dur:.27,driveDuration:.095,catchBrake:1400}:DASH_VARIANTS[variant]
    this.dashCfg = cfg

    // facing rules: forward-family/air dashes follow travel; retreats keep
    // the guard trained on the threat (the MGR dash-in / dash-out rhythm —
    // attack after a backdash lunges back toward the enemy)
    const forwardFamily = variant === 'pivot' || variant === 'launch' || variant === 'chain'
      || variant === 'carry' || variant === 'hunt' || variant === 'pierce'
      || variant === 'air'
    if ((forwardFamily||powerDash) && dx !== 0) {
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

    this.dashPower=powerDash
    this.dashDisplayPitch=this.pose[CH.rootRot]
    this.dashDx = dx
    this.dashDy = dy
    this.state = 'dash'
    this.dashDur = cfg.dur
    this.dashT = cfg.dur
    this.dashGhostIdx = 0
    this.dashBurstFired = false
    this.dashCd = DASH_CD
    this.dashConsec++
    this.dashChainT = 0.45 // dashes within 0.45s link into a chain
    if (!this.grounded) this.airDashUsed = true
    this.dashDodgeGranted=false
    this.dashDodgeWindow=iframes
    this.dropAction()
    this.charging = false
    this.dashHandoff = false
    // Entry preserves incoming momentum. The motor must earn a reversal.
    this.dashBody=new DashBody(cfg,this.vx,this.vy,dx,dy,this.grounded)
    this.dashFinishT=0;this.dashMotionActive=true;this.dashBoostFxFired=false;this.dashSink=0;this.dashWakeTimer=0;this.dashWakeCount=0;this.dashCatchFxFired=false

    // ---- clip + presentation per variant (entry blend is momentum-
    // matched: carry blends longer because the run already matches) ----
    const dashClip=this.dashPower?POWER_DASH_CLIP:cfg.clip
    this.playAnimation(dashClip, { blend: cfg.blend, speed: dashClip.dur / (cfg.dur+(this.dashPower?.18:0)) })

    // Dash audio follows the real propulsion event, not button-down.

    // Burst FX wait for real propulsion (updateDash). No pretend travel
    // vector while an opposite-direction dash is still overcoming inertia.

    // lens strain + camera bite scale with aggression
    w.fx.chroma(cfg.chroma)
    w.cam.addTrauma(cfg.trauma)
  }

  private absorbDashWall():void {
    if(!this.dashMotionActive||!this.dashBody||this.dashBody.phase==='wall')return
    this.dashBody.blockX()
    if(this.dashPower)this.dashRecoverT=POWER_DASH_RECOVERY
    else if(this.grounded&&this.dashDx*this.face>.5)this.dashFinishT=DASH_FINISH_RISE
    // Ground reaction owns the recovery, not a dash pose running in place.
    if(this.grounded&&this.state==='dash')this.playAnimation(STOP_CLIP,{blend:.035,speed:3})
  }

  private advanceDashMotor(dt: number, w: WorldRef): void {
    const body=this.dashBody??new DashBody(this.dashCfg,this.vx,this.vy,this.dashDx,this.dashDy,this.grounded)
    this.dashBody=body
    const travel=body.step(dt,this.grounded,this.vx,this.vy,this.dashPower)
    this.dashDisplacement=travel
    this.vx=body.vx;this.vy=body.vy
    if(travel.takeoff)this.grounded=false
    this.dashDur=body.duration
    this.dashT=body.phase==='wall'?0:Math.max(0,body.duration-body.age)
    if(!this.dashDodgeGranted&&body.phase==='drive'){
      this.iframes=Math.max(this.iframes,this.dashDodgeWindow)
      this.dashDodgeGranted=true
    }
    // One propulsion accent, not a progress-timer puff. Reversals must
    // actually travel toward intent before emitting the forward burst.
    const speed=Math.hypot(this.vx,this.vy)
    if(!this.dashBurstFired&&body.phase==='drive'&&speed>220
      &&this.vx*this.dashDx+this.vy*this.dashDy>180){
      this.dashBurstFired=true
      w.audio.play('dash',{pitch:rand(this.dashCfg.pitch[0],this.dashCfg.pitch[1])})
      const ux=this.vx/speed,uy=this.vy/speed,color=this.sword.colors.core
      w.fx.motionLine(this.x-ux*28,this.y-38,ux,uy,Math.min(130,speed*.18),.11,color)
      w.fx.motionLine(this.x-ux*42,this.y-23,ux,uy,Math.min(85,speed*.12),.09,color)
      const escape=this.dashVariant==='carve',hunt=this.dashVariant==='hunt'
      w.fx.speedStreaks(this.x-ux*20,this.y-20,-ux*speed*.35,escape?7:hunt?6:4,color)
      // Propulsion-only accents: no fake flash while bracing a reversal.
      w.fx.motionLine(this.x-ux*12,this.y-52,ux,uy,Math.min(170,speed*.21),.075,'#e6faff')
      if(escape){
        w.fx.motionLine(this.x,this.y-30,-uy,ux,65,.12,color)
        w.fx.motionLine(this.x,this.y-30,uy,-ux,65,.12,color)
      }
      if(this.grounded){
        w.fx.dust(this.x-ux*22,0,7)
        w.fx.shadowSmear(this.x-ux*20,Math.min(85,speed*.11),.42)
        if(this.dashPower){
          w.fx.groundShatter(this.x-ux*20,Math.sign(ux),12)
          w.fx.groundCrack(this.x-ux*20,0,55)
          w.cam.addTrauma(.32)
        }
      }
      w.cam.addTrauma(this.dashCfg.trauma*.55)
      w.fx.chroma(this.dashCfg.chroma)
    }
    // Accent the real second thrust once; never a full-screen strobe.
    if(body.boosting&&this.vx*this.dashDx>180&&!this.dashBoostFxFired){
      this.dashBoostFxFired=true
      const dir=Math.sign(this.vx)||this.dashDx, color=this.sword.colors.core
      w.audio.play('dash',{pitch:1.15,volume:.65})
      w.fx.shockwave(this.x-dir*15,this.y-25,55,color,.22,3)
      w.fx.speedStreaks(this.x-dir*20,this.y-25,-dir*Math.abs(this.vx)*.4,7,color)
      w.fx.motionLine(this.x-dir*35,this.y-32,dir,0,150,.14,color)
      w.fx.dust(this.x-dir*24,0,6)
      w.fx.chroma(.45);w.cam.addTrauma(.14)
    }
    if(body.boosting && this.vx*this.dashDx>180 && this.dashWakeCount<3){
      this.dashWakeTimer-=dt
      if(this.dashWakeTimer<=0){
        this.dashWakeTimer=.065;this.dashWakeCount++
        const dir=Math.sign(this.vx)||this.dashDx,color=this.sword.colors.core
        w.fx.dust(this.x-dir*24,0,4)
        w.fx.shadowSmear(this.x-dir*20,Math.min(105,speed*.08),.24)
        w.fx.speedStreaks(this.x-dir*28,this.y-22,-dir*speed*.28,3,color)
        w.fx.motionLine(this.x-dir*38,this.y-18,dir,0,Math.min(120,speed*.09),.1,color)
      }
    }
    if(body.boostEngaged&&!body.boosting&&!this.dashCatchFxFired&&this.grounded&&body.age>=body.duration*.7&&body.phase!=='wall'){
      this.dashCatchFxFired=true
      w.fx.dust(this.x+this.dashDx*12,0,5)
      w.fx.shadowSmear(this.x,55,.22)
    }
    const k=body.progress
    // SHADOW-SILHOUETTE afterimages — the dark ghost trail with the backlit
    // rim. THREE beats only (research cap), fired as dash-progress fractions
    // [0.18, 0.5, 0.85]: spacing widens down the trail (acceleration read)
    // and each ghost starts DARKER (a0 0.5 → 0.36 → 0.24) with a shorter
    // life — a clean cut to nothing at the exit instead of a fading cloud.
    while (this.dashGhostIdx < 3 && k >= DASH_GHOST_BEATS[this.dashGhostIdx]) {
      const gi = this.dashGhostIdx
      w.fx.shadowGhost(
        this.pose, this.x, this.hipY, this.face, Math.sign(this.vx)||this.dashDx,
        this.sword.colors.core, 0.3 - gi * 0.05, SCALE, DASH_GHOST_A0[gi],
      )
      this.dashGhostIdx++
    }
    if(this.dashT<=0 || body.phase==='wall'){
      if(this.dashPower&&this.dashMotionActive){
        this.dashRecoverT=POWER_DASH_RECOVERY
        if(this.grounded){w.fx.dust(this.x+this.dashDx*10,0,3);w.fx.shadowSmear(this.x,38,.16)}
      }
      if(!this.dashPower&&this.grounded&&body.phase!=='wall'&&this.dashDx*this.face>.5)this.dashFinishT=DASH_FINISH_RISE
      this.dashMotionActive=false
    }
  }

  private updateDash(dt: number, w: WorldRef): void {
    const input = w.input
    // A fresh press can reverse or redirect the dash without waiting for
    // its animation to finish. A held press cannot auto-repeat.
    if ((input.pressed('dash') || input.buffered('dash')) && this.canDash()) {
      this.requestDash(w,input.axisX(),input.axisY())
      return
    }
    this.advanceDashMotor(dt,w)
    // Light and heavy begin immediately while the motor keeps driving.
    // A live POWER dash converts into its dedicated release — GALE BREAKER —
    // instead of the standard pass cuts: the charged body earns its own
    // strike performance, not a retimed phantom cut.
    if (input.pressed('light') || input.buffered('light')) {
      input.takeBuffered('light')
      this.startAttack(this.dashPower?ATTACKS.powerArc:ATTACKS.dashSlash, w)
      return
    }
    if (input.pressed('heavy') || input.buffered('heavy')) {
      if (!this.grounded) {
        input.takeBuffered('heavy')
        this.startAttack(ATTACKS.slam, w)
        return
      }
      input.takeBuffered('heavy')
      this.startAttack(this.dashPower?ATTACKS.powerArc:ATTACKS.dashHeavy, w)
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
      // Forces already supplied the catch. No exit multipliers, horizontal
      // cap or vertical halving: locomotion friction and gravity take over.
      this.dashHandoff=Math.abs(input.axisX())>.25&&Math.sign(input.axisX())===Math.sign(this.vx)

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
      // Empty-hand air command moves (twist kick / flying elbow) — sheathed
      // only; the drawn air family keeps its a1–a3 cycle untouched.
      if (!this.swordDrawn && ax !== 0) {
        return Math.sign(ax) !== this.face ? 'airTwist' : 'airElbow'
      }
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
    // Empty-hand command heavies (sheathed only — the drawn heavy chain is
    // unchanged): K+down axe kick · K+back spinning hook · K+forward stop kick.
    if (!this.swordDrawn && this.grounded) {
      const ax = w.input.axisX(), ay = w.input.axisY()
      if (ay > 0.4) return ATTACKS.axeKick
      if (ax !== 0 && Math.sign(ax) !== this.face) return ATTACKS.spinHook
      if (ax !== 0 && Math.sign(ax) === this.face) return ATTACKS.stepKick
    }
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

  private playAnimation(clip:Clip,opts:PlayOpts={}):void{
    this.animator.play(equipmentClip(clip,this.swordDrawn),opts)
  }

  startAttack(def: AttackDef, w: WorldRef, fromParry = false): void {
    if (!def) return
    this.peaceT = 0
    this.sheathAct = null
    // per-combo variation seed: no two plays of the same chain render
    // identically (PAVE spec var #27)
    this.pave.reseed(w.time, this.x)
    // Preserve current motion through the shared inertial transition.
    // Empty-hand arm residuals clear before the damage window begins.
    const wasAttack = this.state === 'attack'
    // requirement checks
    if (def.requires === 'ground' && !this.grounded) def = ATTACKS.a1
    if (def.requires === 'air' && this.grounded) def = ATTACKS.l1
    if(!this.swordDrawn)def=unarmedAttack(def)

    // face toward held direction at attack start
    const ax = w.input.axisX()
    if (ax !== 0 && !fromParry) {
      this.face = ax > 0 ? 1 : -1
    } else if (!fromParry && def.kind === 'dash' && this.dashMotionActive && this.dashDx !== 0) {
      // A through-cut follows its travel, not a closer enemy left behind.
      this.face = this.dashDx > 0 ? 1 : -1
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

    const trail = def.strikeHand?this.emptyTrail:w.fx.startTrail(this.sword.colors.trail, this.sword.colors.trail2, this.sword.trailWidth)
    this.hasPrevBlade = false
    this.hasPrevAng = false
    this.action = {
      def,
      animT: 0,
      hitMap: new Map(),
      trail,
      sfxDone: false,
      driveRemaining:0,
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
    // Authored startup/contact/recovery clocks remain independent of
    // visual entry residuals; do not smear the fist past its contact beat.
    this.playAnimation(def.clip, { blend: wasAttack ? 0.11 : 0.07, speed: def.strikeHand?1:this.atkSpeed,armBlendLimit:def.strikeHand?def.hit.start*.75:undefined })
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

    // A through-cut rides the live dash motor instead of braking it.
    if (this.grounded && !this.dashMotionActive) {
      this.vx = brakeVelocity(this.vx,900,dt)
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
      if(def.groundDrive&&this.grounded)a.driveRemaining=def.groundDrive.duration
      else if(!def.groundDrive && !(def.kind==='dash' && (this.dashMotionActive || this.vx*this.face>def.moveX)))this.vx=this.face*def.moveX
    }
    // Drive follows the authored ignition beat without erasing running carry.
    // The finite budget belongs to this action and is discarded on cancel.
    if(a.driveRemaining>0&&def.groundDrive&&def.moveX!==undefined){
      const driveDt=Math.min(dt,a.driveRemaining)
      if(this.grounded)this.vx=attackDriveVelocity(this.vx,this.face*def.moveX,def.groundDrive.acceleration,driveDt)
      a.driveRemaining=Math.max(0,a.driveRemaining-dt)
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
      const info = makeRuntimeInfo(def, def.strikeHand?1:this.sword.stats.dmg)
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
      if (def.kind === 'dash' && !def.strikeHand) {
        curSeg = {
          bx: this.x - this.face * 124,
          by: this.y - 55,
          tx: this.x + this.face * 66,
          ty: this.y - 55,
        }
        usePrev = this.hasPrevBlade
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
          const result=w.hitEnemy(e.id, this.blade, info)
          if(rewardsConfirmedHit(result))this.onLandedHit(w, {...info,dmg:result.actualDamage}, e.x, e.y - 48 * e.scale)
        }
      }
      // remember this frame's blade for the next sweep test
      this.prevBlade.bx = curSeg.bx
      this.prevBlade.by = curSeg.by
      this.prevBlade.tx = curSeg.tx
      this.prevBlade.ty = curSeg.ty
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
            const result=w.hitEnemy(e.id, this.blade, info)
            if(rewardsConfirmedHit(result))this.onLandedHit(w, {...info,dmg:result.actualDamage}, e.x, e.y - 48 * e.scale)
          }
        }
      }
    }

    // OVERSHOOT (follow-through law): as the active window closes, inject a
    // 2-frame rotational impulse — the tip pushes PAST the stop point and
    // the wrist spring elastic-snaps it back. Stopping dead reads weightless.
    if (!def.strikeHand && !a.overshootDone && animT > h.end && this.armVel !== 0) {
      a.overshootDone = true
      this.bladeLagVel += Math.sign(this.armVel) * 2.4
    }

    // trail emission
    if (!def.strikeHand && animT >= def.trail.start && animT <= def.trail.end) {
      w.fx.pushTrail(a.trail, this.blade.bx, this.blade.by, this.blade.tx, this.blade.ty)
    } else if (animT > def.trail.end && a.trail.emitting) {
      w.fx.endTrail(a.trail)
    }

    // Normal combo / parry / jump windows; dash cancels are handled before this update.
    const dashCancel = animT >= h.end * 0.6
    if (animT >= def.cancel || dashCancel) {
      const input = w.input
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
          if (this.riposteT > 0 && this.grounded) {
            next = 'riposte'
          } else if (this.grounded && ax !== 0 && Math.sign(ax) === this.face && def.chain.includes('stabs')) {
            // FORWARD PRESSURE: holding INTO the enemy mid-chain swaps the
            // next light for the triple-thrust string (renzoku tsuki). The
            // forward axis was the only unmapped direction in pickLight, so
            // neutral / back / up / down chains are untouched.
            next = 'stabs'
          } else {
            next = this.pickLight(w, ax, ay)
          }
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
      this.postArmVel = def.strikeHand?0:this.armVel
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
    if(!this.swordDrawn)return
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
    this.dashMotionActive=false
    w.input.takeBuffered('parry')
    this.state = 'parry'
    this.parryT = 0.3
    this.parryActive = 0.17
    this.parryPerfect = true
    this.dropAction()
    this.charging = false
    // Defense opens immediately; finite support braking catches the body.
    this.parryBraceT=.05
    this.playAnimation(this.swordDrawn?PARRY_CLIP:UNARMED_PARRY, { blend: 0.06 })
    w.audio.play('parry', { volume: 0.4, pitch: 1.15 })
  }

  private updateParry(dt: number, w: WorldRef): void {
    this.parryT -= dt
    this.parryActive -= dt
    const braceDt=Math.min(dt,this.parryBraceT)
    this.parryBraceT=Math.max(0,this.parryBraceT-dt)
    if (this.grounded) {
      this.vx=brakeVelocity(this.vx,8000,braceDt)
      this.vx=brakeVelocity(this.vx,1200,dt-braceDt)
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
    this.dashMotionActive=false
    this.state = 'charge'
    this.charging = true
    this.chargeT = 0
    this.chargeReady = false
    this.dropAction()
    if (this.grounded) this.vx = 0
    this.playAnimation(this.swordDrawn?CHARGE_CLIP:UNARMED_CHARGE, { blend: 0.08 })
    w.audio.play('charge', { volume: 0.5 })
  }

  private updateCharge(dt: number, w: WorldRef): void {
    const input = w.input
    this.chargeT += dt
    if (!this.chargeReady && this.chargeT >= 0.55) {
      this.chargeReady = true
      w.audio.play('chargeReady')
    }
    // The charged hold speaks KINETIC, not arcane: the straining steel sheds
    // occasional tiny glint sparks near the kissaki (drawSword carries the
    // edge glint / vibration ghost / tip star). The THUNDER sword keeps its
    // tesla-crawl — that is that blade's element identity, not the charge.
    if (this.chargeReady) {
      if (this.swordDrawn && Math.random() < 0.3) {
        w.fx.sparks(this.blade.tx, this.blade.ty, -Math.PI / 2, .35, 1, '#eaf6ff', 200, .18)
      }
      if (this.swordDrawn && this.sword.id === 'thunder' && Math.random() < 0.55) {
        w.fx.lightningCrawl(this.blade.bx, this.blade.by, this.blade.tx, this.blade.ty, this.sword.colors.trail)
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
      this.requestDash(w, input.axisX(), input.axisY())
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
      this.sinceHitT = 0
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
    this.sinceHitT = 0
    this.flashT = 1
    this.hurtT = 0.34
    this.iframes = 0.75
    this.dropAction()
    this.dashMotionActive=false
    this.charging = false
    this.ability = null
    this.state = 'hurt'
    this.vx = dir * (heavy ? 380 : 240)
    if (!this.grounded) this.vy = -220
    else this.vy = heavy ? -320 : -140
    this.grounded = false
    this.playAnimation(HURT_CLIP, { blend: 0.05 })
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
    this.dashMotionActive=false
    this.state = 'scripted'
    this.dropAction()
    this.charging = false
    this.vx = 0
  }

  exitScripted(): void {
    if (this.state === 'scripted') this.state = 'move'
    this.playAnimation(IDLE_CLIP, { blend: 0.1 })
  }

  private updateScripted(_dt: number): void {
    if (this.grounded) this.vx = 0
  }

  playClip(clip: Parameters<Animator['play']>[0], speed = 1): void {
    if (!clip) return // same guard as startAttack — cinematics must never crash on a missing clip
    const intent=Object.values(ATTACKS).find(a=>a.clip===clip)
    if(!this.swordDrawn&&intent)clip=unarmedAttack(intent).clip
    this.playAnimation(clip, { blend: 0.03, speed, restart: true })
  }

  /* ------------------------------------------------------------------ */
  /* abilities                                                            */
  /* ------------------------------------------------------------------ */

  startUnarmedFinisher(w:WorldRef,ultimate=false):void{
    if(this.swordDrawn)return
    if(ultimate){if(this.meter<100)return;this.meter=0}
    // Grounded ultimate = the dedicated THOUSAND PALM BARRAGE (six confirmed
    // contacts); air ults and the ability slot keep their existing moves.
    if(ultimate&&this.grounded){this.startAttack(UNARMED_ULT,w);return}
    const base=unarmedAttack(!this.grounded?ATTACKS.a2:ATTACKS.l5)
    this.startAttack({...base,label:ultimate?'FOCUSED PALM':'GUARD BREAK',
      hit:{...base.hit,dmg:ultimate?65:40,heavy:true,breakGuard:true,stagger:.6}},w)
  }

  startAbility(w: WorldRef): void {
    if(!this.swordDrawn){
      if(this.energy<this.sword.ability.cost)return
      this.energy-=this.sword.ability.cost
      const base=unarmedAttack(this.grounded?ATTACKS.charged:ATTACKS.a2)
      this.startAttack({...base,label:'FOCUSED PALM',hit:{...base.hit,dmg:30,heavy:true,breakGuard:true}},w)
      return
    }
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
        this.playAnimation(ATTACKS.l5.clip, { blend: 0.04, speed: 1.15 })
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
          this.playAnimation(ATTACKS.charged.clip, { blend: 0.02, speed: 1.3 })
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
        this.playAnimation(ATTACKS.h3.clip, { blend: 0.04, speed: 1.2 })
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
            this.playAnimation(ATTACKS.dashSlash.clip, { blend: 0.02, speed: 1.4 })
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
          this.playAnimation(ATTACKS.h2.clip, { blend: 0.03, speed: 1.25 })
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
    const result=w.hitEnemy(e.id, { bx: e.x - 20, by: e.y - 40, tx: e.x + 20, ty: e.y - 40 }, info)
    if(rewardsConfirmedHit(result))this.meter = Math.min(100, this.meter + result.actualDamage * 0.25)
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
    const ritualSupport=!!this.sheathAct&&Math.abs(this.vx)<35
    const active = this.state === 'move' && this.grounded && !this.braking && this.dashRecoverT<=0 && this.dashFinishT<=0 && (!this.sheathAct||ritualSupport)
    const tune = ritualSupport?PLAYER_GAIT.idle:PLAYER_GAIT[this.loco] ?? PLAYER_GAIT.idle
    const speed = Math.abs(this.vx)
    // femoral midpoint in world space (geom solved this frame)
    const hipX = this.x + this.face * SCALE * this.geom.hip.x
    this.gait.update(hipX, this.vx, this.face, speed, tune, dt, active, Player.SOLE_W, this.grounded)
    // authority blend: in over ~90ms, out over ~180ms (hands off gently)
    this.gaitW = damp(this.gaitW, active ? 1 : 0, active ? 18 : (this.state === 'dash'||this.state === 'dashCharge'||this.dashMotionActive||this.dashRecoverT>0||this.dashFinishT>0) ? 60 : this.braking ? 15 : 8, dt)
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
      const feet: { x: number; y: number; fx: number; planted: boolean }[] = [
        { x: this.gait.footL.x, y: this.gait.footL.y, fx: this.x + this.face * SCALE * g.hipPtL.x, planted: this.gait.footL.planted },
        { x: this.gait.footR.x, y: this.gait.footR.y, fx: this.x + this.face * SCALE * g.hipPtR.x, planted: this.gait.footR.planted },
      ]
      for (const f of feet) {
        if (!f.planted) continue // A raised swing foot must NEVER set pelvis support height.
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
      femurT = Math.min(femurT, -HIP_H * (this.loco==='walk'&&!this.sheathAct ? .88 : .74))
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
    if(this.grounded&&(this.state==='dash'||this.dashMotionActive||this.state==='dashCharge'||this.dashRecoverT>0||(this.state==='move'&&this.dashFinishT>0)))target=Math.max(HIP_H*.67,target-13*this.dashSink)
    // critically-damped tracking (k=24): follows a 0.3s stride with ~2px
    // residual, and because the target itself is now bounded, the spring
    // can never be flung by a degenerate bound again
    this.footLock = damp(this.footLock, target, 24, dt)
    if(this.grounded&&(this.state==='dash'||this.dashMotionActive||this.state==='dashCharge'||this.dashRecoverT>0||(this.state==='move'&&this.dashFinishT>0))){
      const hip=g.ankleL.y>g.ankleR.y?g.hipPtL:g.hipPtR
      // The support leg must be able to reach the floor during low drive.
      this.footLock=Math.min(this.footLock,SCALE*(hip.y+(PLAYER_SPEC.thigh+PLAYER_SPEC.shin)*.96)+Player.SOLE_W)
    }
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
        // Blend the TARGET, then solve. Blending solved knee positions
        // shortened the femur/shin during every gait transition.
        solveLegIK(hipPt.x, hipPt.y, ankle.x + (tx - ankle.x) * w,
          ankle.y + (ty - ankle.y) * w, l1, l2, 1, this.ikOut)
        knee.x = this.ikOut.kx; knee.y = this.ikOut.ky
        ankle.x = this.ikOut.ax; ankle.y = this.ikOut.ay
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
      const support=this.grounded&&(this.state==='dash'||this.dashMotionActive||this.state==='dashCharge'||this.dashRecoverT>0||(this.state==='move'&&this.dashFinishT>0))
        ? (g.ankleL.y>g.ankleR.y?g.ankleL:g.ankleR):null
      for (const [hipPt, knee, ankle, toe] of legs) {
        const ankleWy = this.hipY + SCALE * ankle.y
        const toeWy = this.hipY + SCALE * toe.y
        const extended = ankle.y > legLen * 0.52
        // capture band: sole within ~12px of the line, or already below it
        const nearGround = ankleWy > -12 && toeWy < 6
        if ((extended && nearGround)||ankle===support||this.dashSkim>.05) {
          // snap: keep the authored stance x, pin the sole exactly
          // Stagger the two feet slightly during the power skim; both remain
          // close to the roof, but they do not move as one rigid shape.
          const skimWave=this.dashBody?Math.sin(this.dashBody.progress*Math.PI*3)*.13:0
          const skim=this.dashSkim*(1+(ankle===g.ankleL?skimWave:-skimWave))
          const ty = (-Player.SOLE_W - skim - this.hipY) / SCALE
          const forced=ankle===support||this.dashSkim>.05
          const maxDx=Math.sqrt(Math.max(0,(legLen*.98)**2-(ty-hipPt.y)**2))
          const tx=forced?hipPt.x+clamp(ankle.x-hipPt.x,-maxDx,maxDx):ankle.x
          solveLegIK(hipPt.x, hipPt.y, tx, forced?ty:ankle.y+(ty-ankle.y)*iw, l1, l2, 1, this.ikOut)
          knee.x = this.ikOut.kx; knee.y = this.ikOut.ky
          ankle.x = this.ikOut.ax; ankle.y = this.ikOut.ay
          // flat toe forward
          toeFromPitch(ankle.x, ankle.y, 0.12, PLAYER_SPEC.foot, this.toeScratch)
          toe.x += (this.toeScratch.x - toe.x) * iw
          toe.y += (this.toeScratch.y - toe.y) * iw
          // register the exact contact point for the shadow AO core
          if (iw > 0.5&&this.dashSkim<.5) this.snapContacts.push(this.x + this.face * SCALE * ankle.x)
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
    if(!this.swordDrawn&&!this.sheathAct){
      this.bladeLag=0;this.bladeLagVel=0;this.chainLag=0;this.chainLagVel=0
      return
    }
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
    const chainTarget = this.state === 'attack' ? clamp(-armVel * 0.02, -0.14, 0.14) : 0
    this.chainLagVel += (k2 * (chainTarget - this.chainLag) - c2 * this.chainLagVel) * dt
    this.chainLag = clamp(this.chainLag + this.chainLagVel * dt, -0.16, 0.16)
    // Carry/wrist interpolation is not a sword impact. Feeding it back into
    // locomotion folded the spine on every stride, even with steel sheathed.
    if (this.state === 'attack') {
      p[CH.rootRot] += -this.chainLag * 0.3
      p[CH.spine] += -this.chainLag * 0.5
      p[CH.shR] += this.chainLag * 0.2
    }

    // GROUND CLEARANCE — the floor is SOLID: the kissaki can never pass
    // below the ground plane. Clip-blends between carries (guard ↔ walk
    // side-carry ↔ run trail) linearly sweep the wrist through
    // straight-down angles; without this, the tip pierces the floor for
    // ~10 frames on every transition. A positional wrist constraint rotates
    // the tip toward the NEARER horizon (forward-level or back-level,
    // preserving the carry direction), rate-limited so the lowering reads
    // as the kissaki TAPPING the floor and sliding along it.
    // (Attacks exempt: their tips target enemy bodies above the floor.)
    if (this.swordDrawn && this.state !== 'attack') {
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
    // desired grip weight by state — strictly eliminates floating zombie arms
    let target = 0
    switch (this.state) {
      case 'move':
        if (!this.swordDrawn || this.isFlourishActive) target = 0
        else if (Math.abs(this.vx) < 40) target = Math.min(0.2, this.enemyNearW * 0.2)
        else target = 0
        break
      case 'attack':
        target = this.action ? (this.action.def.grip ?? 0.45) : 0.45
        break
      case 'charge':
      case 'parry':
        target = this.swordDrawn ? 0.85 : 0
        break
      case 'scripted':
        target = 0.4
        break
      default:
        target = 0
    }
    this.twoHandW = damp(this.twoHandW, target, 11, dt)
    const w = this.twoHandW
    if (w < 0.03 || !this.swordDrawn || this.isFlourishActive || this.sheathAct) return

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

    // Dash keyframes own the support-line pitch. Never stack a second
    // velocity-driven torso tilt on top of the authored launch/catch.

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
      const l = this.state === 'dash' ? 0 : lean
      // Martial upright alignment: subtle core tilt without zombie slouch
      p[CH.rootRot] += l * 0.14
      p[CH.spine] += l * 0.06
      p[CH.rootX] += l * 1.2
      p[CH.hipR] += l * 0.22
      p[CH.hipL] -= l * 0.18
      p[CH.kneeR] -= l * 0.12
      p[CH.kneeL] -= l * 0.08
      p[CH.footR] += l * 0.08
      p[CH.rootY] += Math.abs(l) * 1.0
      // braking weight acceptance: the stop sinks cleanly into knees
      p[CH.rootY] += brakeDip
      p[CH.kneeR] -= brakeDip * 0.22
      p[CH.kneeL] -= brakeDip * 0.16
      // head stays level on horizon
      p[CH.head] -= l * 0.12
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
        case 'walk': amp = 0.04; cAmp = 1.3; break
        case 'run': amp = 0.055; cAmp = 1.1; break
        case 'sprint': amp = 0.045; cAmp = 1.15; break
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
          case 'pivot': case 'launch': case 'chain': carryYaw = -0.28; carryArm = -0.04; carryFore = -0.025; break
          case 'carry': carryYaw = -0.28; carryArm = -0.04; carryFore = -0.025; break
          case 'hunt': carryYaw = -0.28; carryArm = -0.04; carryFore = -0.025; break
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
      } else if (this.dashVariant === 'pivot' || this.dashVariant === 'launch' || this.dashVariant === 'chain'
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
    const relaxedCarry=this.swordDrawn && this.state === 'move' && !this.sheathAct && this.grounded && Math.abs(this.vx)<60
    this.carryRelaxW=damp(this.carryRelaxW,relaxedCarry?1:0,10,dt)
    if (relaxedCarry) {
      const relax = (1 - wC)*this.carryRelaxW
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
        && this.grounded && !this.braking && !this.sheathAct && !this.isFlourishActive && !this.hasThreat ? paceFade*(1-clamp01(Math.abs(this.vx)/45)) : 0
      this.sheathW = damp(this.sheathW, sheathTarget, 9, dt)
      if (this.sheathW > 0.02 && !this.sheathAct && this.state==='move' && this.grounded && !this.hasThreat) {
        const k = this.sheathW
        // the saya geometry (local space — mirror of the draw path)
        const pelvisPitch = p[CH.rootRot] + p[CH.spine] * 0.35
        const sayAng = 0.24 + pelvisPitch * 0.6
        const tl = PLAYER_SPEC.blade * 0.28
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
        // The off-arm retains the authored counter-swing. Pinning BOTH
        // arms to the waist erased the gait and made walking look lifeless.
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
      this.landSpring = Math.max(0, this.landSpring - dt * this.landSpringDecay)
      p[1] += this.landSpring * 6
    }
    // charge tremble
    if (this.charging) {
      p[0] += Math.sin(this.animClock*23)*.18*this.chargeRatio
      p[1] += Math.sin(this.animClock*19+.7)*.12*this.chargeRatio
    }
    // hurt shake
    if (this.hurtT > 0) {
      p[0] += Math.sin(this.animClock*36)*.45*this.hurtT
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
    const strike=this.action?.def.strikeHand
    if(!this.swordDrawn&&strike){
      const g=this.geom
      // The hit segment IS the striking limb: fist / elbow / ankle / knee /
      // shoulder — resolved from the same projected skeleton the renderer
      // draws, so visual contact == gameplay contact for every joint type.
      const joint=this.action?.def.strikeJoint??'hand'
      const L=strike==='left'
      const distal=joint==='elbow'?(L?g.elbL:g.elbR)
        :joint==='foot'?(L?g.ankleL:g.ankleR)
        :joint==='knee'?(L?g.kneeL:g.kneeR)
        :joint==='shoulder'?(L?g.shoulderL:g.shoulderR)
        :(L?g.handL:g.handR)
      const proximal=joint==='elbow'?(L?g.shoulderL:g.shoulderR)
        :joint==='foot'?(L?g.kneeL:g.kneeR)
        :joint==='knee'?(L?g.hipPtL:g.hipPtR)
        :joint==='shoulder'?g.chest
        :(L?g.elbL:g.elbR)
      // Distal joint toward the contact point (70% distal + 30% proximal).
      this.blade.bx=this.x+this.face*SCALE*(distal.x*.7+proximal.x*.3)
      this.blade.by=this.hipY+SCALE*(distal.y*.7+proximal.y*.3)
      this.blade.tx=this.x+this.face*SCALE*distal.x
      this.blade.ty=this.hipY+SCALE*distal.y
      this.hasPrevAng=false
      return
    }
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
    this.shHead.r = PLAYER_SPEC.headR * 1.05 * SCALE
    this.shBlade.x0 = this.x + f * g.grip.x; this.shBlade.y0 = hy + SCALE * g.grip.y
    this.shBlade.x1 = this.x + f * g.tip.x; this.shBlade.y1 = hy + SCALE * g.tip.y
    this.shFig.blade = this.swordDrawn ? this.shBlade : null
    // contact AO: the legik planted anchors (exact ground-contact points)
    // PLUS any plant-snap contacts from non-gait stances (dash/attacks/brake)
    const contacts: number[] = []
    if (this.grounded) {
      if (this.gaitW > 0.5) {
        if (this.gait.footL.planted) contacts.push(this.gait.footL.x)
        if (this.gait.footR.planted) contacts.push(this.gait.footR.x)
      }
      for (const c of this.snapContacts) contacts.push(c)
    }
    drawCastShadow(ctx, this.shFig, light, {
      alpha: 0.58, width: 6.4, passes: 3, scale: SCALE,
      height: this.y, contacts,
    })
  }

  private updateScarf(dt: number, time: number): void {
    const collarX = (this.geom.chest.x + this.geom.neckTop.x) * 0.5
    const collarY = (this.geom.chest.y + this.geom.neckTop.y) * 0.5
    const nodes = this.scarfSimNodes
    nodes[0].x = collarX
    nodes[0].y = collarY
    nodes[0].ox = collarX
    nodes[0].oy = collarY

    // Movement response in character-local space
    const relVx = -(this.vx / SCALE) * this.face
    const relVy = -(this.vy / SCALE)
    const wind = Math.sin(time * 6.5) * 0.4

    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i]
      const vx = (n.x - n.ox) * 0.82 + relVx * 0.05 + wind * (i * 0.25)
      const vy = (n.y - n.oy) * 0.82 + relVy * 0.04 + 0.35
      n.ox = n.x
      n.oy = n.y
      n.x += vx
      n.y += vy

      const p = nodes[i - 1]
      const dx = n.x - p.x
      const dy = n.y - p.y
      const dist = Math.hypot(dx, dy) || 1e-4
      const segLen = 5.2
      const diff = (dist - segLen) / dist
      n.x -= dx * diff * 0.85
      n.y -= dy * diff * 0.85
    }
  }

  draw(ctx: CanvasRenderingContext2D, time: number, reflection=false): void {
    if (this.state === 'dead' && this.deadT > 2.6) return
    const alpha = this.iframes > 0 && this.state !== 'scripted' && this.state !== 'dash'
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
      const sayLen = PLAYER_SPEC.blade * this.sword.stats.range * 1.06
      // the scabbard rides the PELVIS: its angle follows the hip pitch
      // (rootRot) + a slice of the pelvis yaw, so it stays glued to the
      // body through leans, lunges and twists — a world-fixed angle read
      // as a floating rod whenever the fighter committed forward
      const pelvisPitch = this.pose[CH.rootRot] + this.pose[CH.spine] * 0.35
      const detail=this.sheathAct?.mode==='draw'?this.drawSocket():null
      const ang = detail?.ang??Math.min(0.24+pelvisPitch*.6,this.state==='dash'&&this.grounded?.5:2)
      const mouthX=detail?.x??hp.x+3,mouthY=detail?.y??hp.y+1
      const tipX = mouthX - Math.cos(ang) * sayLen
      const tipY = mouthY + Math.sin(ang) * sayLen
      // saya body (slightly lighter than the body so it reads on the hip)
      ctx.strokeStyle = '#0d1219'
      ctx.lineWidth = 4.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(mouthX, mouthY)
      ctx.lineTo(tipX, tipY)
      ctx.stroke()
      // rim highlight along the top edge — sells it as a scabbard
      ctx.strokeStyle = '#465a7a'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(mouthX-.6, mouthY-2.2)
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
    // Rear-up carry belongs behind the torso. The opaque body occludes
    // the back blade rather than displaying steel through the ribcage.
    const drawing=this.sheathAct?.mode==='draw'
    const rearCarry=!drawing&&this.swordDrawn&&this.state!=='attack'&&this.geom.tip.x<this.geom.grip.x&&this.geom.bladeYaw<0
    if(rearCarry)drawSword(ctx,this.sword,{time,charge:this.bladeChargeRatio,alpha,swingGlow:0},
      this.geom.grip.x,this.geom.grip.y,this.geom.bladeProjAngle,this.geom.bladeProjLen,this.geom.bladeTipZ)
    const currentClip=this.animator.getClip()
    const handPhase=currentClip && currentClip.dur>0
      ? (currentClip.loop ? (this.animator.getTime()/currentClip.dur)%1 : Math.min(1,this.animator.getTime()/currentClip.dur)) : 0
    drawFighter3D(ctx, this.geom, PLAYER_STYLE, {
      time,
      motionEnergy:Math.min(1,Math.abs(this.vx)/480),
      hands:this.sprintExposure.active?this.sprintExposure.hands:this.contextMotion.hands(handGestures(currentClip?.name??'idle',handPhase,this.swordDrawn||this.sheathW>.1),this.motionContext),
      rimColor:'#000000',rimAlpha:0,
      alpha,
      // Null-black face/body stays black through hurt and impact frames.
      flash: 0, // null-black body; impacts remain in weapon/scene FX
      flashColor: this.impactFlashT > this.flashT * 0.85 ? '#eafcff' : '#ff3b57',
      // Shared renderer accepts weapon lighting; the matte surface ignores it.
      edgeLight: {
        color: this.sword.colors.glow,
        // Rim = light cast by the swinging/glinting steel onto the body —
        // a reflection, not a body aura.
        a: clamp01(this.swingGlow * 0.55 + this.bladeChargeRatio * 0.35 + this.bladeZ * 0.25) * alpha,
      },
      scarfNodes: this.scarfSimNodes,
    })
    // ---- SHEATHED TSUKA — FRONT PASS (the readable hilt): the grip
    // continues the saya axis out of the mouth, tsuba seated at the
    // opening, kashira cap at the far end where the resting fist welds
    // (the sheath IK layer targets exactly that point). Brighter tones
    // + accent rings than the saya body so the hilt READS against the
    // dark scene and the black body — "hand resting on the sheathed
    // katana" is the single most-held pose in the game; it cannot be a
    // whisper-dark stroke.
    if (!this.swordDrawn && !drawing) {
      const hp = this.geom.hip
      const pelvisPitch = this.pose[CH.rootRot] + this.pose[CH.spine] * 0.35
      const ang = Math.min(0.24+pelvisPitch*.6,this.state==='dash'&&this.grounded?.5:2)
      const mx = hp.x + 3
      const my = hp.y + 1
      const tl = PLAYER_SPEC.blade * 0.28
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
    if(drawing){
      const d=this.drawSocket(),g=this.geom
      // The saya is an occluder: only the steel physically past its mouth
      // is visible. Grip and blade stay one rigid object in the right fist.
      const home=Math.PI-d.ang
      let delta=g.bladeProjAngle-home;while(delta>Math.PI)delta-=Math.PI*2;while(delta< -Math.PI)delta+=Math.PI*2
      const angle=home+delta*d.turn
      ctx.save()
      if(d.extraction<.999){
        ctx.translate(d.x,d.y);ctx.rotate(-d.ang)
        ctx.beginPath();ctx.rect(0,-200,300,400);ctx.clip()
        ctx.rotate(d.ang);ctx.translate(-d.x,-d.y)
      }
      const pull=PLAYER_SPEC.blade*this.sword.stats.range*1.06*d.extraction
      const gx=d.x+Math.cos(d.ang)*pull,gy=d.y-Math.sin(d.ang)*pull
      drawSword(ctx,this.sword,{time,charge:0,alpha,swingGlow:0},
        gx+(g.handR.x-gx)*d.grip,gy+(g.handR.y-gy)*d.grip,angle,
        PLAYER_SPEC.blade*this.sword.stats.range*1.06*(1-d.turn)+g.bladeProjLen*d.turn,g.bladeTipZ)
      ctx.restore()
      // Fingers wrap in FRONT of the tsuka. Rendering steel over the palm
      // made a correctly positioned grip look like a floating sword.
      if(d.grip>.95){
        ctx.save();ctx.translate(g.handR.x,g.handR.y)
        ctx.rotate(Math.atan2(g.handR.y-g.elbR.y,g.handR.x-g.elbR.x))
        drawArticulatedHand(ctx,'#000000',d.rightOpen);ctx.restore()
      }
    }
    if (this.swordDrawn && !rearCarry && !drawing) {
      drawSword(ctx, this.sword, {
        time,
        charge: this.bladeChargeRatio,
        alpha,
        swingGlow: this.swingGlow,
      }, this.geom.grip.x, this.geom.grip.y, this.geom.bladeProjAngle, this.geom.bladeProjLen, this.geom.bladeTipZ)
    }
    ctx.restore()

    // Reflection contains geometry, not lens-space aura/smear duplicates.
    if(reflection)return

    // ---- ANIME SMEAR (two-layer, research-applied): when tip velocity
    // explodes, the blade stretches across this frame's angular sweep as
    // translucent wedges — a COOL WAKE over the full span plus a HOT
    // LEADING EDGE on the leading ~55% of the sweep (reference sheets:
    // the hot core leads, a cooler wake trails it 30-45° behind). World
    // space, drawn here so it composites over the body with additive glow.
    const dA = this.hasPrevAng ? this.smearA1 - this.smearA0 : 0
    const tipSpd = Math.abs(dA) * 62 * PLAYER_SPEC.blade * SCALE * this.swingScale
    if (tipSpd > 950 && this.state==='attack' && this.swordDrawn) {
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

    // ---- BLADE POINT-LIGHT: while SWINGING, the moving edge throws a real
    // localized light into the world (additive radial at blade mid). The
    // charge contributes only a third weight — the glint, not a furnace. ----
    const lightI = clamp01(this.swingGlow * 0.8 + this.bladeChargeRatio * 0.3)
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
    // CHARGE read — GROUND PRESSURE, not an aura: while either charge holds
    // its planted stance, the soles crush down and the ground answers with
    // dark stress smears under the stance line (drawn on the GROUND plane,
    // in shadow, additive-free). The blade itself carries the kinetic
    // language (edge glint + vibration ghost + kissaki star — see drawSword);
    // nothing orbits the body.
    if ((this.charging || this.state === 'dashCharge') && this.swordDrawn) {
      const cr = this.bladeChargeRatio
      const gy = this.y + 2 // ground plane at the soles
      const stance = 11 + cr * 5 // the stance widens as the coil deepens
      ctx.save()
      ctx.globalAlpha = clamp01(0.14 + cr * 0.2)
      ctx.strokeStyle = '#06090d'
      ctx.lineWidth = 2.2 + cr * 1.6
      ctx.lineCap = 'round'
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.arc(this.x + s * stance, gy, 6 + cr * 3, s === this.face ? -0.5 : Math.PI - 0.35, s === this.face ? 0.35 : Math.PI + 0.5)
        ctx.stroke()
      }
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
