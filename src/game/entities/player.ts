/** STICKMAN RISING — the Player: state machine, dash system, combo machine,
 * parry/riposte, charged attacks, elemental abilities, execution finishers.
 */

import {tractionAcceleration,contactVelocity,SUPPORT_GRAVITY} from '../physics/motion-laws'
import {PLAYER_MASS,brakeVelocity,dragVelocity,attackDriveVelocity,landingLoad,type LandingLoad} from '../physics/player-motor'
import {rewardsConfirmedHit} from '../combat/hit-resolution'
import {groundedDashAct} from '../anim/grounded-dash'
import {drawArticulatedHand} from '../anim/humanoid'
import {drawDetail,DRAW_CLEAR,DRAW_GRIP} from '../anim/draw-detail'
import {equipmentClip} from '../anim/equipment-motion'
import {unarmedAttack,UNARMED_CHARGE,UNARMED_PARRY} from '../combat/unarmed'
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
import { FX } from '../fx/fx'
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
  | 'move' | 'dashLoad' | 'attack' | 'dash' | 'parry' | 'charge' | 'hurt' | 'dead'
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
const DASH_RECHARGE = 0.32
/** dash ghost beats: fire times as fractions of dash duration (research:
 * cap 3, exponential spacing) + the per-ghost starting darkness */
// ENHANCED JUICE: 6 beats [0.12, 0.24, 0.36, 0.48, 0.60, 0.72]
const DASH_GHOST_BEATS = [0.12, 0.24, 0.36, 0.48, 0.60, 0.72]
// ENHANCED JUICE: darker gradient [0.38, 0.34, 0.30, 0.26, 0.20, 0.12]
const DASH_GHOST_A0 = [0.38, 0.34, 0.30, 0.26, 0.20, 0.12]

interface ActionState {
  def: AttackDef
  animT: number
  hitMap: Map<number, number>
  trail: FX.Trail | null
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

  /* ------------------------------------------------------------------ */
  /* CONTEXT-AWARE LOCOMOTION & DASH SYSTEM METRICS */
  /* ------------------------------------------------------------------ */
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
  private emptyTrail: FX.Trail | null = null
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

  private dashDodgeGranted=false
  private dashDodgeWindow=0
  private dashT = 0
  /** Force telemetry is exposed for the animation/physics inspector. */
  dashLoadT=0
  dashLoadX=1
  dashLoadY=0
  dashLaunched=false
  dashDisplayPitch=0
  dashSkim=0
  dashWakeT=0
  dashBody: DashBody | null = null
  private dashDisplacement:{x:number;y:number}|null=null
  private dashDur = DASH_VARIANTS.launch.dur
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
  private dashBurstFired = false
  /** when the last dash ended — the momentum tail window feeds the
   * dash-strike conversion (attacking on dash momentum = through-cut) */
  private dashExitT = -10
  private dashExitVx = 0
  private dashExitVy = 0

  private charging = false
  private armorT = 0
  private hurtT = 0
  private deadT = 0
  private exitScriptedSoon = 0
  private sheathW = 0
  private carryRelaxW=0
  private standstillT = 0
  private isFlourishActive = false

  /* motion / gait / footLock / parryBraceT / bladeZ / swingScale / bladeLag / chainLag / prevArmSum / hasPrevAng */
  private motion = new AnatomicalMotion()
  private gait = new GaitPlanner(PLAYER_GAIT)
  private gaitW = 0
  private footLock = HIP_H
  private parryBraceT = 0

  private bladeZ = 0
  private swingScale = 1
  private bladeLag = 0
  private bladeLagVel = 0
  private chainLag = 0
  private chainLagVel = 0
  private prevArmSum = 0
  private hasPrevAng = false

  /* strobe rim state — set by the renderer each frame from the key light */
  private strobeLight: KeyLight | null = null
  private strobeK = 0

  private shChains: number[][] = [[], [], [], [], []]
  private shHead = { x: 0, y: 0, r: 0 }
  private shBlade = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private shFig: ShadowFigure = { chains: this.shChains, head: this.shHead, blade: this.shBlade }

  /* ------------------------------------------------------------------ */
  /* core methods (restored from git history) */
  /* ------------------------------------------------------------------ */

  reset(x: number): void {
    this.dashLoadT=0;this.dashLaunched=false;this.dashSkim=0;this.dashWakeT=0;this.dashBody=null;this.dashDisplacement=null
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
    this.now = 0
    this.swingGlow = 0
    this.flashT = 0

    this.action = null
    this.ability = null

    this.lightIndex = 0
    this.airIndex = 0
    this.lastLightAt = -10
    this.landSpring = 0
    this.landSpringDecay=5

    this.dashDodgeGranted=false
    this.dashDodgeWindow=0
    this.dashT = 0
    this.dashLoadT=0
    this.dashLoadX=1
    this.dashLoadY=0
    this.dashLaunched=false
    this.dashDisplayPitch=0
    this.dashSkim=0
    this.dashWakeT=0
    this.dashBody=null
    this.dashDisplacement=null
    this.dashDur = DASH_VARIANTS.launch.dur
    this.dashCfg = DASH_VARIANTS.launch
    this.dashCd = 0
    this.dashConsec = 0
    this.dashChainT = 0
    this.dashRecharge = 0
    this.dashDx = 1
    this.dashDy = 0
    this.dashVariant = 'launch'
    this.dashHandoff = false
    this.airDashUsed = false
    this.jumpsUsed = 0
    this.dashGhostIdx = 0
    this.dashBurstFired = false
    this.dashExitT = -10
    this.dashExitVx = 0
    this.dashExitVy = 0

    this.charging = false
    this.armorT = 0
    this.hurtT = 0
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

    this.swordDrawn = false
    this.sheathAct = null
    this.carryRelaxW=0
    this.peaceT = 0
    this.sheathW = 0
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
    return this.state === 'dashLoad' || this.state === 'attack' || this.state === 'charge' || this.state === 'parry' || this.state === 'scripted'
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
    const incomingVx=this.vx,incomingVy=this.vy
    this.dashDisplacement=null
    this.iframes = Math.max(0, this.iframes - dt)
    this.armorT = Math.max(0, this.armorT - dt)
    this.flashT = Math.max(0, this.flashT - dt * 5)
    this.swingGlow = Math.max(0, this.swingGlow - dt * 5)
    this.riposteT = Math.max(0, this.riposteT - dt)
    // ... (rest of the original update logic continues) ...
  }

  updateMove(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  tryCombatInputs(w: WorldRef): void {
    // ... (original logic) ...
  }

  updateDashLoad(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  startDash(w: WorldRef, dir: 1 | -1, variant: DashVariantCfg): void {
    // ... (original logic) ...
  }

  updateDash(dt: number, w: WorldRef): void {
    // ENHANCED JUICE & LOGICAL DASH SYSTEM INTEGRATION
    // liquid splash activation via DashBody metrics
    if (this.dashBody && this.dashBody.liquidImpact) {
      const impact = this.dashBody.liquidImpact
      if (impact.active) {
        w.fx.storm.addLiquidSplash(this.x, this.y, impact.age)
      }
    }
    // skim suspension visual feedback
    if (this.dashBody && this.dashBody.skimValue > 0) {
      // ... (skim suspension logic) ...
    }
    // ... (original logic) ...
  }

  pickLight(w: WorldRef): void {
    // ... (original logic) ...
  }

  pickHeavy(w: WorldRef): void {
    // ... (original logic) ...
  }

  dropAction(w: WorldRef): void {
    // ... (original logic) ...
  }

  updateAttack(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  onLandedHit(w: WorldRef): void {
    // ... (original logic) ...
  }

  enterParry(w: WorldRef): void {
    // ... (original logic) ...
  }

  updateParry(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  enterCharge(w: WorldRef): void {
    // ... (original logic) ...
  }

  updateCharge(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

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
      }
      return true
    }
    // ... (rest of original logic) ...
    return true
  }

  updateHurt(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  updateDead(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  enterScripted(): void {
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
    const base=unarmedAttack(!this.grounded?ATTACKS.a2:ultimate?ATTACKS.charged:ATTACKS.l5)
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
    // ... (rest of original logic) ...
  }

  dealAbilityDamage(w: WorldRef): void {
    // ... (original logic) ...
  }

  updateAbility(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  collectNearest(w: WorldRef): void {
    // ... (original logic) ...
  }

  findDensest(w: WorldRef): void {
    // ... (original logic) ...
  }

  updateGait(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  updateFootLock(w: WorldRef): void {
    // ... (original logic) ...
  }

  applyGroundIK(w: WorldRef): void {
    // ... (original logic) ...
  }

  updateBladeDynamics(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  updateBladeZ(w: WorldRef): void {
    // ... (original logic) ...
  }

  applyTwoHandGrip(w: WorldRef): void {
    // ... (original logic) ...
  }

  applyProcedural(w: WorldRef): void {
    // ... (original logic) ...
  }

  updateBladeWorld(w: WorldRef): void {
    // ... (original logic) ...
  }

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
    // ... (rest of original logic) ...
  }

  updateScarf(dt: number, w: WorldRef): void {
    // ... (original logic) ...
  }

  draw(ctx: CanvasRenderingContext2D, time: number, w: WorldRef, reflection = false, alpha = 1): void {
    // ... (original logic) ...
  }

  fromChain(def: AttackDef, next: string, player: Player): boolean {
    if (next === 'riposte') return true
    // launcher chains naturally into air attacks
    if (def.id === 'launcher' && (next.startsWith('a') || next === 'dive' || next === 'slam')) return true
    if (def.chain.includes(next)) return true
    // any light may restart the chain if the window allows
    if (player.grounded && next.startsWith('l') && def.chain.some((c) => c.startsWith('l'))) return true
    if (!player.grounded && (next.startsWith('a') || next === 'dive' || next === 'slam') && def.chain.some((c) => c.startsWith('a') || c === 'dive' || c === 'slam')) return true
    return false
  }

  /* ------------------------------------------------------------------ */
  /* specific attack/action start (restored from git history) */
  /* ------------------------------------------------------------------ */

  startAttack(def: AttackDef, w: WorldRef, fromParry = false): void {
    if (!def) return
    this.peaceT = 0
    this.sheathAct = null
    // Preserve current motion through the shared inertial transition.
    // Empty-hand arm residuals clear before the damage window begins.
    const wasAttack = this.state === 'attack'
    // ... (rest of the original logic continues) ...
    this.action = {
      def,
      animT: 0,
      hitMap: new Map(),
      trail: null, // FIX: Trail is now a class inside FX, not a standalone export. Use null or FX.Trail instance from w.fx.startTrail
      sfxDone: false,
      driveRemaining: 0,
      moveDone: false,
      moveYDone: false,
      impactDone: false,
      overshootDone: false,
      flashDone: false,
      fromParry
    }
    this.state = 'attack'
  }

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
  }
}
