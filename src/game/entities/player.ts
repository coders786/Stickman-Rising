/** STICKMAN RISING — the Player: state machine, dash system, combo machine,
 * parry/riposte, charged attacks, elemental abilities, execution finishers.
 */

import { Animator } from '../anim/animator'
import { makePose, Pose } from '../anim/pose'
import { makeSkelGeom, solveSkeleton, PLAYER_SPEC, SkelGeom, drawStick, PLAYER_STYLE } from '../anim/skeleton'
import { CHARGE_CLIP, DASH_AIR_CLIP, DASH_CLIP, FALL_CLIP, HURT_CLIP, IDLE_CLIP, JUMP_CLIP, LAND_CLIP, PARRY_CLIP, RUN_CLIP } from '../anim/clips'
import { ATTACKS, AttackDef, AttackRuntimeInfo, makeRuntimeInfo } from '../combat/attacks'
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

const SCALE = 1.32
/** standing hip height = thigh(25)+shin(24)=49 local × SCALE ≈ 64.7 — keeps
 *  straight legs exactly on the ground line instead of sinking 4px into it */
const HIP_H = 64

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
 * Radius carries +3px edge forgiveness — a katana edge is a plane, not a
 * line; the visual blade is ~3px wide so the hit volume matches the art. */
function bladeHitsBody(
  e: { x: number; y: number; scale: number },
  hasPrev: boolean,
  prev: { bx: number; by: number; tx: number; ty: number },
  cur: { bx: number; by: number; tx: number; ty: number },
): boolean {
  const s = e.scale
  for (const sp of BODY_SPHERES) {
    const cy = e.y - sp.oy * s
    const r = sp.r * s + 3
    if (hasPrev
      ? circleHitsSweptQuad(e.x, cy, r, prev.bx, prev.by, prev.tx, prev.ty, cur.bx, cur.by, cur.tx, cur.ty)
      : segHitsCircle(cur.bx, cur.by, cur.tx, cur.ty, e.x, cy, r)
    ) return true
  }
  return false
}

const MOVE_MAX = 350
const ACCEL = 2600
const FRICTION = 2800
const AIR_ACCEL = 1800
const GRAVITY = 2050
const JUMP_V = -700
const AIR_JUMP_V = -620
const DASH_SPEED = 980
const DASH_TIME = 0.15
const DASH_CD = 0.1
const DASH_RECHARGE = 0.32

interface ActionState {
  def: AttackDef
  animT: number
  hitMap: Map<number, number>
  trail: Trail
  sfxDone: boolean
  moveDone: boolean
  moveYDone: boolean
  impactDone: boolean
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
  pose: Pose = makePose()
  geom: SkelGeom = makeSkelGeom()
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
  private dashCd = 0
  private dashConsec = 0
  private dashRecharge = 0
  private dashDx = 1
  private dashDy = 0
  private airDashUsed = false
  private jumpsUsed = 0
  private afterimgTimer = 0

  private parryT = 0
  private parryActive = 0
  riposteT = 0
  private parryPerfect = false

  private chargeT = 0
  charging = false
  private chargeReady = false

  private hurtT = 0
  private deadT = 0

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
    return this.y - HIP_H + this.pose[1] * SCALE
  }

  /* ------------------------------------------------------------------ */
  /* main update                                                          */
  /* ------------------------------------------------------------------ */

  update(dt: number, w: WorldRef): void {
    this.iframes = Math.max(0, this.iframes - dt)
    this.flashT = Math.max(0, this.flashT - dt * 5)
    this.swingGlow = Math.max(0, this.swingGlow - dt * 5)
    this.riposteT = Math.max(0, this.riposteT - dt)
    this.energy = Math.min(this.maxEnergy, this.energy + dt * 3)

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
      const g = this.state === 'attack' && this.action && this.action.def.float
        ? GRAVITY * this.action.def.float
        : GRAVITY
      this.vy += g * dt
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
    if (this.dashRecharge <= 0) this.dashConsec = 0

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
    solveSkeleton(this.pose, PLAYER_SPEC, this.geom)
    this.updateBladeWorld()
  }

  private onLand(w: WorldRef): void {
    w.audio.play('land', { volume: 0.5 })
    w.fx.dust(this.x, 0, 7)
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
  /* locomotion                                                           */
  /* ------------------------------------------------------------------ */

  private updateMove(dt: number, w: WorldRef): void {
    const input = w.input
    const ax = input.axisX()
    const ay = input.axisY()

    // facing follows input
    if (ax !== 0) this.face = ax > 0 ? 1 : -1

    // horizontal movement
    if (ax !== 0) {
      const accel = this.grounded ? ACCEL : AIR_ACCEL
      this.vx += ax * accel * dt
      this.vx = clamp(this.vx, -MOVE_MAX, MOVE_MAX)
    } else if (this.grounded) {
      const f = FRICTION * dt
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f
    } else {
      this.vx = damp(this.vx, 0, 0.4, dt)
    }

    // locomotion clip selection
    const speed = Math.abs(this.vx)
    if (this.grounded) {
      if (speed > 40) {
        this.animator.play(RUN_CLIP, { blend: 0.09, speed: clamp(speed / MOVE_MAX, 0.65, 2.1) })
      } else if (this.vy === 0) {
        this.animator.play(IDLE_CLIP, { blend: 0.16 })
      }
    } else if (this.vy < -60) {
      this.animator.play(JUMP_CLIP, { blend: 0.06 })
    } else {
      this.animator.play(FALL_CLIP, { blend: 0.12 })
    }

    // ---- actions ----
    if (this.tryCombatInputs(w, ax, ay)) return
  }

  /** returns true if a new state was entered */
  private tryCombatInputs(w: WorldRef, ax: number, ay: number): boolean {
    const input = w.input

    // dash (anytime, from move)
    if ((input.pressed('dash') || input.buffered('dash')) && this.canDash()) {
      this.startDash(w, ax, ay)
      return true
    }
    // jump (grounded = jump 1, plus one air jump)
    if (input.pressed('jump') || input.buffered('jump', 0.18)) {
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
      this.startAttack(this.pickHeavy(w), w)
      return true
    }
    // light
    if (input.pressed('light') || input.buffered('light')) {
      input.takeBuffered('light')
      const id = this.riposteT > 0 ? 'riposte' : this.pickLight(w, ax, ay)
      this.startAttack(ATTACKS[id], w)
      return true
    }
    return false
  }

  private doJump(w: WorldRef): void {
    w.input.takeBuffered('jump')
    this.jumpsUsed++
    this.vy = this.jumpsUsed === 1 ? JUMP_V : AIR_JUMP_V
    this.grounded = false
    w.audio.play('jump', { volume: 0.4 })
    w.fx.dust(this.x, 0, 4)
    if (this.jumpsUsed === 2) {
      w.fx.burst(this.x, this.y - 20, 6, '#9fb4c4', 160, 0.4, 'dot')
    }
  }

  /* ------------------------------------------------------------------ */
  /* dash                                                                 */
  /* ------------------------------------------------------------------ */

  private canDash(): boolean {
    if (this.dashCd > 0 || this.dashRecharge > 0) return false
    if (!this.grounded && this.airDashUsed) return false
    return true
  }

  startDash(w: WorldRef, ax: number, ay: number): void {
    w.input.takeBuffered('dash')
    let dx = ax
    let dy = ay
    if (dx === 0 && dy === 0) dx = this.face
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    if (dx !== 0) this.face = dx > 0 ? 1 : -1
    this.dashDx = dx
    this.dashDy = dy
    this.state = 'dash'
    this.dashT = DASH_TIME
    this.dashCd = DASH_CD
    this.dashConsec++
    if (this.dashConsec >= 2) this.dashRecharge = DASH_RECHARGE
    if (!this.grounded) this.airDashUsed = true
    this.iframes = Math.max(this.iframes, 0.12)
    this.action = null
    this.charging = false
    this.vx = dx * DASH_SPEED
    this.vy = dy * DASH_SPEED * (this.grounded && dy < -0.4 ? 0.55 : 1)
    this.animator.play(this.grounded ? DASH_CLIP : DASH_AIR_CLIP, { blend: 0.05 })
    w.audio.play('dash', { pitch: rand(0.95, 1.1) })
    const colors = this.sword.colors
    w.fx.speedStreaks(this.x, this.y - 40, dx * DASH_SPEED * 0.9, 6, rgba(colors.trail, 1))
    w.fx.dust(this.x, this.grounded ? 0 : this.y, 5)
    w.cam.addTrauma(0.06)
  }

  private updateDash(dt: number, w: WorldRef): void {
    this.dashT -= dt
    // afterimages
    this.afterimgTimer -= dt
    if (this.afterimgTimer <= 0) {
      this.afterimgTimer = 0.026
      w.fx.afterimage(this.pose, this.x, this.hipY, this.face, this.sword.colors.trail, 0.3, SCALE)
    }
    // maintain velocity with slight decay
    const k = 1 - this.dashT / DASH_TIME
    const sp = DASH_SPEED * (1 - k * 0.25)
    this.vx = this.dashDx * sp
    this.vy = this.dashDy * sp * (this.grounded ? (this.dashDy < 0 ? 0.4 : 1) : 1)

    // dash attack
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
      this.vx *= 0.55
      if (!this.grounded) this.vy *= 0.5
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

  private pickHeavy(_w: WorldRef): AttackDef {
    return ATTACKS.h1
  }

  startAttack(def: AttackDef, w: WorldRef, fromParry = false): void {
    if (!def) return
    // IN-BETWEEN LAW: capture the source state BEFORE switching — chained
    // attacks crossfade slower (0.11s) than fresh entries (0.07s) so every
    // transition between animation instances gets real in-betweens.
    const wasAttack = this.state === 'attack'
    // requirement checks
    if (def.requires === 'ground' && !this.grounded) def = ATTACKS.a1
    if (def.requires === 'air' && this.grounded) def = ATTACKS.l1

    // face toward held direction at attack start
    const ax = w.input.axisX()
    if (ax !== 0 && !fromParry) this.face = ax > 0 ? 1 : -1

    const trail = w.fx.startTrail(this.sword.colors.trail, this.sword.colors.trail2, this.sword.trailWidth)
    this.hasPrevBlade = false
    this.action = {
      def,
      animT: 0,
      hitMap: new Map(),
      trail,
      sfxDone: false,
      moveDone: false,
      moveYDone: false,
      impactDone: false,
      fromParry,
    }
    if (fromParry) this.riposteT = 0
    this.state = 'attack'
    this.charging = false
    if (def === ATTACKS.l1 || def === ATTACKS.l2 || def === ATTACKS.l3 || def === ATTACKS.l4 || def === ATTACKS.l5) {
      this.lastLightAt = w.time
    }
    this.animator.play(def.clip, { blend: wasAttack ? 0.11 : 0.07, speed: this.atkSpeed })
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
      for (const e of w.enemies) {
        if (e.dead || e.spawning) continue
        const last = a.hitMap.get(e.id)
        const reArm = h.multiHit ? (last === undefined || animT - last >= h.multiHit) : last === undefined
        if (!reArm) continue
        if (bladeHitsBody(e, this.hasPrevBlade, this.prevBlade, this.blade)) {
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
      // aoe shockwave at strike moment for heavy hits
      if (h.aoe && h.aoe > 0 && !a.impactDone && this.grounded && animT >= h.start + 0.02) {
        a.impactDone = true
        w.fx.shockwave(this.x + this.face * 30, 0, h.aoe, this.sword.colors.glow, 0.4, 6)
        if (this.grounded) w.fx.groundCrack(this.x + this.face * 34, 0, h.aoe * 0.45)
      }
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
            next = def.chain.find((c) => c.startsWith('h')) ?? 'h1'
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

    // finish
    if (this.animator.isDone()) {
      w.fx.endTrail(a.trail, 0.18)
      this.action = null
      this.state = 'move'
    }
  }

  private onLandedHit(w: WorldRef, info: AttackRuntimeInfo, ex: number, ey: number): void {
    this.energy = Math.min(this.maxEnergy, this.energy + 5)
    this.meter = Math.min(100, this.meter + info.dmg * 0.32)
    // elemental on-hit flourishes
    const c = this.sword.colors
    const dir = Math.atan2(ey - this.y + 40, ex - this.x)
    switch (this.sword.id) {
      case 'inferno':
        w.fx.embers(ex, ey, 5, c.accent, 18)
        break
      case 'thunder':
        if (Math.random() < 0.3) w.fx.lightningArc(ex, ey, ex + rand(-40, 40), ey + rand(-30, 30), c.trail)
        break
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
    this.action = null
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
  }

  /* ------------------------------------------------------------------ */
  /* charge                                                               */
  /* ------------------------------------------------------------------ */

  private enterCharge(w: WorldRef): void {
    this.state = 'charge'
    this.charging = true
    this.chargeT = 0
    this.chargeReady = false
    this.action = null
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
    this.hp = Math.max(0, this.hp - dmg)
    this.flashT = 1
    this.hurtT = 0.34
    this.iframes = 0.75
    this.action = null
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
    this.action = null
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
        // THUNDER RUSH — instant dash + chain lightning
        this.enterScripted()
        this.x = clamp(this.x + this.face * 300, w.arenaMinX + 30, w.arenaMaxX - 30)
        w.audio.play('lightning', { intensity: 1 })
        w.fx.afterimage(this.pose, this.x, this.hipY, this.face, c.trail, 0.4, SCALE)
        w.fx.speedStreaks(this.x, this.y - 40, this.face * 900, 10, rgba(c.trail, 1))
        // chain to nearest enemies
        const chain = this.collectNearest(w, 5, 360)
        let px = this.x
        let py = this.y - 55
        for (const e of chain) {
          w.fx.lightningArc(px, py, e.x, e.y - 40, c.trail)
          w.fx.burst(e.x, e.y - 40, 6, c.accent, 200, 0.4, 'spark')
          this.dealAbilityDamage(w, e, 24, 0.35, 160, -180)
          px = e.x
          py = e.y - 40
        }
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

  private applyProcedural(dt: number): void {
    const p = this.pose
    // velocity lean (proportional, eased)
    const speedLean = clamp((this.vx * this.face) / MOVE_MAX, -1, 1)
    p[2] += speedLean * 0.14
    // vertical pitch while airborne
    if (!this.grounded && this.state !== 'attack') {
      p[2] += clamp(this.vy / 1400, -0.22, 0.3)
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
  }

  private updateBladeWorld(): void {
    const g = this.geom
    const spec = PLAYER_SPEC
    const len = spec.blade * this.sword.stats.range * 1.06
    // The hit segment spans from the TSUKA BUTT (9 units behind the hand
    // along the blade axis) out to the kissaki tip. Including the handle
    // closes the inner gap: point-blank enemies standing INSIDE the swing
    // arc (closer than ma-ai) used to slip between the player's body and
    // the old segment base that started past the hand — the classic
    // "sword animation disconnects from the hitbox" whiff.
    const bx = g.handR.x + Math.cos(g.bladeAngle) * -9
    const by = g.handR.y + Math.sin(g.bladeAngle) * -9
    const tx = g.handR.x + Math.cos(g.bladeAngle) * len
    const ty = g.handR.y + Math.sin(g.bladeAngle) * len
    this.blade.bx = this.x + this.face * SCALE * bx
    this.blade.by = this.hipY + SCALE * by
    this.blade.tx = this.x + this.face * SCALE * tx
    this.blade.ty = this.hipY + SCALE * ty
  }

  /* ------------------------------------------------------------------ */
  /* render                                                               */
  /* ------------------------------------------------------------------ */

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.state === 'dead' && this.deadT > 2.6) return
    const alpha = this.iframes > 0 && this.state !== 'scripted'
      ? 0.55 + 0.25 * Math.sin(time * 40)
      : 1
    ctx.save()
    ctx.translate(this.x, this.hipY)
    ctx.scale(this.face * SCALE, SCALE)
    // saya (scabbard) at the left hip, angled back — worn through the obi
    // like a real katana; the iai draw-cuts (l1 / riposte) pull the blade
    // from exactly here, so the draw reads as a draw.
    {
      const hp = this.geom.hip
      // saya body (slightly lighter than the body so it reads on the hip)
      ctx.strokeStyle = '#0d1219'
      ctx.lineWidth = 4.4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(hp.x + 3, hp.y + 1)
      ctx.lineTo(hp.x - 21, hp.y + 10.5)
      ctx.stroke()
      // rim highlight along the top edge — sells it as a scabbard
      ctx.strokeStyle = '#465a7a'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(hp.x + 2.4, hp.y - 1.2)
      ctx.lineTo(hp.x - 20.4, hp.y + 8.2)
      ctx.stroke()
      // sageo knot + kojiri cap accents
      ctx.strokeStyle = rgba(this.sword.colors.accent, 0.5)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(hp.x - 2, hp.y + 3.4)
      ctx.lineTo(hp.x - 5.5, hp.y + 0.8)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(hp.x - 18.5, hp.y + 9.3)
      ctx.lineTo(hp.x - 21.5, hp.y + 11.4)
      ctx.stroke()
    }
    drawStick(ctx, this.geom, PLAYER_STYLE, {
      time,
      alpha,
      flash: this.flashT * 0.85,
      flashColor: '#ff3b57',
    })
    drawSword(ctx, this.geom, this.sword, {
      time,
      charge: this.chargeRatio,
      alpha,
      swingGlow: this.swingGlow,
    })
    ctx.restore()

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
