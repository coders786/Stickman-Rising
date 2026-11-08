/** STICKMAN RISING — enemies: 7 classes + boss mech.
 *
 * AI: orbit/approach with implicit attack tokens (max 3 engaged), telegraphed
 * strikes, ranged gunners, flying drones, blocking shields, armored heavies,
 * parrying elites, and a phased boss. Reactions: hitstun, knockback, launch,
 * juggle, knockdown, death.
 */

import { makePose, Pose } from '../anim/pose'
import { makeSkelGeom, solveSkeleton, SkelGeom, drawStick, StickStyle } from '../anim/skeleton'
import { ENEMY_GAIT, GaitPlanner, LegIKOut, solveLegIK, toeFromPitch } from '../anim/legik'
import { KeyLight, ShadowFigure, drawCastShadow, drawStrobeRim } from '../render/lighting'
import { WorldRef } from '../core/types'
import { AttackRuntimeInfo } from '../combat/attacks'
import { clamp, clamp01, damp, rand, rgba } from '../core/utils'

export type EnemyKind = 'grunt' | 'assassin' | 'heavy' | 'shield' | 'gunner' | 'drone' | 'elite' | 'boss'

export type EnemyState =
  | 'enter' | 'chase' | 'strafe' | 'windup' | 'strike' | 'recover'
  | 'stun' | 'launched' | 'down' | 'getup' | 'aim' | 'dive' | 'pattern'

interface EnemyConfig {
  hp: number
  speed: number
  range: number
  dmg: number
  windup: number
  recover: number
  scale: number
  score: number
  orbit: number
  style: StickStyle
  weapon: 'machete' | 'dagger' | 'hammer' | 'shield' | 'rifle' | 'none' | 'sword' | 'bossblade'
  weaponColor: string
}

const baseStyle = (body: string, dark: string, glow: string, lineW = 5): StickStyle => ({
  body, dark, outline: '#04060a', glow, lineW, headStyle: 'visor', armor: false,
})

export const ENEMY_CONFIGS: Record<EnemyKind, EnemyConfig> = {
  grunt: {
    hp: 30, speed: 135, range: 68, dmg: 8, windup: 0.5, recover: 0.55,
    scale: 1.04, score: 50, orbit: 120,
    style: baseStyle('#c8ccd2', '#78818c', '#ff4646'),
    weapon: 'machete', weaponColor: '#d8dde3',
  },
  assassin: {
    hp: 22, speed: 255, range: 62, dmg: 6, windup: 0.26, recover: 0.3,
    scale: 0.94, score: 80, orbit: 150,
    style: baseStyle('#b6a8d8', '#6f5f96', '#c44dff'),
    weapon: 'dagger', weaponColor: '#e8ddff',
  },
  heavy: {
    hp: 105, speed: 72, range: 82, dmg: 18, windup: 0.78, recover: 0.9,
    scale: 1.32, score: 150, orbit: 130,
    style: { ...baseStyle('#d8b46a', '#8f7038', '#ffae2e', 7), armor: true, core: '#ffae2e' },
    weapon: 'hammer', weaponColor: '#ffd27a',
  },
  shield: {
    hp: 62, speed: 95, range: 72, dmg: 10, windup: 0.55, recover: 0.7,
    scale: 1.12, score: 120, orbit: 110,
    style: baseStyle('#9fd8b4', '#5f9678', '#46ffb4', 6),
    weapon: 'shield', weaponColor: '#46ffb4',
  },
  gunner: {
    hp: 26, speed: 115, range: 400, dmg: 5, windup: 0.5, recover: 0.9,
    scale: 1.0, score: 90, orbit: 380,
    style: baseStyle('#e8d8a0', '#96855a', '#ffe14d'),
    weapon: 'rifle', weaponColor: '#ffe14d',
  },
  drone: {
    hp: 20, speed: 165, range: 90, dmg: 9, windup: 0.45, recover: 0.6,
    scale: 0.9, score: 70, orbit: 170,
    style: { ...baseStyle('#a8d8e8', '#5f96a8', '#35f2ff', 4), headStyle: 'goggles' },
    weapon: 'none', weaponColor: '#35f2ff',
  },
  elite: {
    hp: 170, speed: 205, range: 74, dmg: 8, windup: 0.3, recover: 0.4,
    scale: 1.16, score: 400, orbit: 140,
    style: { ...baseStyle('#f0d8d8', '#965f6f', '#ff2a4a', 5.5), armor: true, core: '#ff2a4a' },
    weapon: 'sword', weaponColor: '#ff5c7a',
  },
  boss: {
    hp: 950, speed: 62, range: 150, dmg: 22, windup: 0.7, recover: 0.8,
    scale: 3.0, score: 2500, orbit: 200,
    style: { ...baseStyle('#c8d4e0', '#5f7183', '#ff2a4a', 9), armor: true, core: '#ff2a4a', headStyle: 'helm' },
    weapon: 'bossblade', weaponColor: '#ff5c7a',
  },
}

let nextId = 1

export class Enemy {
  id = nextId++
  kind: EnemyKind
  cfg: EnemyConfig
  x: number
  y = 0
  vx = 0
  vy = 0
  face: 1 | -1 = 1
  hp: number
  maxHp: number
  state: EnemyState = 'enter'
  stateT = 0
  dead = false
  spawning = true
  launched = false
  scale: number
  dmg: number

  stunT = 0
  private attackCd = 0
  private walkPhase = 0
  private spinT = 0
  private flailT = 0
  hpBarT = 0
  flashT = 0
  private side: 1 | -1
  private sideT = 0
  private strikeHits = 0
  private burstLeft = 0
  private burstT = 0
  private blockHp = 3
  blockUp = false
  staggerMeter = 0
  private patternIdx = 0
  private patternStep = 0
  private patternT = 0
  vulnerableT = 0

  pose: Pose = makePose()
  geom: SkelGeom = makeSkelGeom()

  /* ---- GROUND-CONTACT GAIT (legik): the chase/strafe/aim walk gets real
   * planted feet — world-locked stance anchors exactly on the ground line,
   * swing arcs, stride alternating with velocity. This kills the legacy
   * sine-FK walk where BOTH feet hovered 5–30px above the floor. */
  private gait = new GaitPlanner()
  private gaitW = 0
  private ikOut: LegIKOut = { kx: 0, ky: 0, ax: 0, ay: 0, clamped: false }
  private toeScratch = { x: 0, y: 0 }
  private gaitTune = { ...ENEMY_GAIT }

  constructor(kind: EnemyKind, x: number, waveScale: number) {
    this.kind = kind
    this.cfg = ENEMY_CONFIGS[kind]
    this.x = x
    this.scale = this.cfg.scale
    this.hp = this.maxHp = Math.round(this.cfg.hp * waveScale)
    this.dmg = this.cfg.dmg * (1 + (waveScale - 1) * 0.5)
    this.side = Math.random() < 0.5 ? -1 : 1
    this.attackCd = rand(0.4, 1.2)
    if (kind === 'drone') this.y = -rand(130, 210)
    if (kind === 'boss') this.vulnerableT = 0
  }

  get hipY(): number {
    return this.y - 47 * this.scale + this.pose[1] * this.scale
  }

  /* ------------------------------------------------------------------ */

  update(dt: number, w: WorldRef): void {
    this.stateT += dt
    this.attackCd -= dt
    this.hpBarT = Math.max(0, this.hpBarT - dt)
    this.flashT = Math.max(0, this.flashT - dt * 6)
    // lightning illumination fade (lingers ~0.45s — the channel afterglow)
    if (this.litT > 0) this.litT = Math.max(0, this.litT - dt * 2.2)
    this.stunT = Math.max(0, this.stunT - dt)
    this.vulnerableT = Math.max(0, this.vulnerableT - dt)
    if (this.dead) return

    const px = PLAYER_X_REF.x
    const py = PLAYER_X_REF.y
    const dx = px - this.x
    const adx = Math.abs(dx)

    // boss runs its pattern brain instead of normal chase
    if (this.kind === 'boss' && (this.state === 'chase' || this.state === 'strafe')) {
      this.state = 'pattern'
      this.stateT = 0
      this.patternStep = 0
      this.patternT = 0
    }

    switch (this.state) {
      case 'enter': {
        if (this.kind === 'drone') {
          this.spawning = false
          this.state = 'chase'
        } else {
          // drop pod landing
          if (this.stateT < 0.55) {
            this.y = -560 * (1 - this.stateT / 0.55)
          } else {
            this.y = 0
            this.spawning = false
            this.state = 'chase'
            w.fx.dust(this.x, 0, 8)
            w.cam.addTrauma(0.1)
          }
        }
        break
      }
      case 'chase':
      case 'strafe': {
        this.face = dx > 0 ? 1 : -1
        this.blockUp = this.kind === 'shield' && adx > 50
        this.sideT -= dt
        if (this.sideT <= 0) {
          this.sideT = rand(2.5, 5)
          if (Math.random() < 0.25) this.side = (-this.side) as 1 | -1
        }
        const targetSide = Math.sign(dx) === this.side ? this.side : -Math.sign(dx)
        const desired = px - targetSide * this.cfg.orbit
        const speed = this.cfg.speed
        // approach with natural accel
        const diff = desired - this.x
        this.vx = damp(this.vx, clamp(diff * 3, -speed, speed), 4, dt)
        // vertical hover for drones
        if (this.kind === 'drone') {
          const targetY = -150 + Math.sin(w.time * 2 + this.id) * 34
          this.y = damp(this.y, targetY, 2.2, dt)
          this.vy = 0
        }
        this.walkPhase += Math.abs(this.vx) * dt * 0.055

        // attack decisions
        if (this.attackCd <= 0 && !this.spawning) {
          if (this.kind === 'gunner') {
            if (adx > 180 && adx < 520) {
              this.state = 'aim'
              this.stateT = 0
              this.burstLeft = 3
              this.burstT = 0
            } else if (adx <= 180) {
              // retreat
              this.vx = -Math.sign(dx) * this.cfg.speed
            }
          } else if (adx < this.cfg.range + 14 && Math.abs(this.y) < 60) {
            const engaged = this.countEngaged(w)
            const maxEngaged = this.kind === 'boss' ? 1 : 3
            if (engaged < maxEngaged) {
              this.state = 'windup'
              this.stateT = 0
              w.audio.play('telegraph', { volume: 0.4, pitch: this.kind === 'heavy' ? 0.6 : 1 })
            } else {
              this.attackCd = 0.3
            }
          } else if (this.kind === 'drone' && adx < 160 && Math.random() < 0.02) {
            this.state = 'dive'
            this.stateT = 0
            w.audio.play('telegraph', { volume: 0.35, pitch: 1.3 })
          }
        }
        // drone occasional orb shot
        if (this.kind === 'drone' && this.attackCd <= 0 && adx > 200) {
          this.attackCd = rand(1.6, 2.6)
          w.spawnProjectile({
            kind: 'orb', x: this.x, y: this.y - 10,
            vx: Math.sign(dx) * 260, vy: (py - 40 - this.y) * 1.4,
            dmg: 6, life: 3,
          })
        }
        break
      }
      case 'aim': {
        this.face = dx > 0 ? 1 : -1
        this.vx = damp(this.vx, 0, 6, dt)
        this.burstT -= dt
        if (this.burstT <= 0 && this.burstLeft > 0) {
          this.burstLeft--
          this.burstT = 0.14
          w.audio.play('gunshot', { volume: 0.5, pitch: rand(0.95, 1.1) })
          w.spawnProjectile({
            kind: 'bullet', x: this.x + this.face * 30, y: this.y - 44,
            vx: this.face * 900, vy: 0, dmg: this.dmg, life: 1.2,
          })
          w.fx.sparks(this.x + this.face * 30, this.y - 44, this.face > 0 ? 0 : Math.PI, 0.5, 4, '#ffe14d', 260, 0.2)
        }
        if (this.burstLeft <= 0 && this.burstT <= 0) {
          this.state = 'recover'
          this.stateT = 0
          this.attackCd = rand(1.6, 2.4)
        }
        break
      }
      case 'dive': {
        // drone dive attack
        const dir = Math.atan2(py - 40 - this.y, px - this.x)
        this.vx = Math.cos(dir) * 460
        this.vy = Math.sin(dir) * 460
        if (Math.hypot(px - this.x, py - this.y) < 60) {
          const dirFace = dx > 0 ? 1 : -1
          const res = w.enemyStrikePlayer(this.dmg, dirFace, false, this.x)
          if (res) {
            this.state = 'stun'
            this.stunT = 1.3
            this.stateT = 0
            this.vx = -dirFace * 260
            this.vy = -180
          }
        }
        if (this.y >= -6) {
          this.y = -rand(130, 200)
          this.state = 'recover'
          this.stateT = 0
        }
        if (this.stateT > 1.4) {
          this.state = 'chase'
          this.stateT = 0
        }
        break
      }
      case 'windup': {
        this.face = dx > 0 ? 1 : -1
        this.vx = damp(this.vx, 0, 8, dt)
        if (this.stateT >= this.cfg.windup) {
          this.state = 'strike'
          this.stateT = 0
          this.strikeHits = this.kind === 'assassin' ? 2 : this.kind === 'elite' ? 3 : 1
          this.vx = Math.sign(dx) * (this.kind === 'heavy' ? 180 : this.kind === 'boss' ? 220 : 340)
          w.audio.play('swing', { volume: 0.4, pitch: this.kind === 'heavy' ? 0.7 : 1.15 })
        }
        break
      }
      case 'strike': {
        const dir = dx > 0 ? 1 : -1
        // hit test against player (front circle)
        const reach = this.cfg.range * this.scale
        if (this.strikeHits > 0 && adx < reach && Math.abs(this.y - py) < 90) {
          const res = w.enemyStrikePlayer(this.dmg, dir, this.kind === 'heavy' || this.kind === 'boss', this.x)
          this.strikeHits = 0
          if (res) {
            // got parried → staggered
            this.state = 'stun'
            this.stunT = this.kind === 'boss' ? 0.9 : 1.5
            this.stateT = 0
            this.vx = -dir * 300
            break
          }
        }
        this.vx = damp(this.vx, 0, 3.5, dt)
        if (this.stateT > (this.kind === 'assassin' ? 0.16 : 0.26) && this.strikeHits > 1) {
          // quick follow-up strike (assassin/elite combos)
          this.stateT = 0
          this.strikeHits--
          this.vx = Math.sign(dx) * 300
          w.audio.play('swing', { volume: 0.35, pitch: 1.2 })
        } else if (this.stateT > 0.3) {
          this.state = 'recover'
          this.stateT = 0
          this.attackCd = this.kind === 'elite' ? rand(1.2, 2) : rand(0.8, 1.8)
        }
        break
      }
      case 'recover': {
        this.vx = damp(this.vx, 0, 5, dt)
        if (this.stateT >= this.cfg.recover) {
          this.state = 'chase'
          this.stateT = 0
        }
        break
      }
      case 'stun': {
        this.vx = damp(this.vx, 0, 4, dt)
        if (this.stunT <= 0) {
          this.state = 'chase'
          this.stateT = 0
          this.attackCd = 0.4
          if (this.kind === 'shield') this.blockHp = 3
        }
        break
      }
      case 'launched': {
        this.flailT += dt * 14
        this.spinT += dt * 3.2
        this.vy += 1350 * dt // juggle gravity (heavier than normal)
        if (this.vy > 0 && this.y >= -4) {
          this.state = 'down'
          this.stateT = 0
          this.y = 0
          this.vy = 0
          this.launched = false
          w.fx.dust(this.x, 0, 6)
          w.audio.play('land', { volume: 0.4, pitch: 0.7 })
        }
        break
      }
      case 'down': {
        this.vx = damp(this.vx, 0, 6, dt)
        if (this.stateT >= 0.85) {
          this.state = 'getup'
          this.stateT = 0
        }
        break
      }
      case 'getup': {
        if (this.stateT >= 0.45) {
          this.state = 'chase'
          this.stateT = 0
          this.attackCd = 0.6
        }
        break
      }
      case 'pattern': {
        this.updateBossPattern(dt, w, px, py)
        break
      }
    }

    // physics
    if (this.state !== 'launched' && this.kind !== 'drone' || this.state === 'launched') {
      if (this.kind !== 'drone' && this.state !== 'dive') {
        this.vy += 1900 * dt
      }
    }
    if (this.kind === 'drone' && this.state !== 'launched') this.vy = 0
    this.x += this.vx * dt
    this.y += this.vy * dt
    if (this.kind !== 'drone' && this.state !== 'launched') {
      if (this.y > 0) {
        this.y = 0
        this.vy = 0
      }
    }
    this.x = clamp(this.x, w.arenaMinX + 16, w.arenaMaxX - 16)

    // build + solve pose
    this.buildPose(dt, w.time)
    // ground-contact gait: drive the planner + write the gait hip bob into
    // the pose root BEFORE the solve (the femoral head must ride the bob)
    this.updateGait(dt)
    solveSkeleton(this.pose, ENEMY_SPEC, this.geom)
    // leg IK: feet exactly where feet go (gait legs + stance snap/clamp)
    this.applyGroundIK()
  }

  /** gait drive — engaged while walking (chase/strafe/aim, grounded). The
   * gait owns pose[1] for these states: hips ride at 44·scale with a 2-per-
   * stride dip (the old sine bob fought the double-counted hipY formula).
   * The pelvis also lowers if a planted anchor is beyond leg reach. */
  private updateGait(dt: number): void {
    const s = this.scale
    const walking = (this.state === 'chase' || this.state === 'strafe' || this.state === 'aim')
      && this.kind !== 'drone' && this.y > -0.5
    const speed = Math.abs(this.vx)
    // scale the tune to the body
    this.gaitTune.stride = ENEMY_GAIT.stride * s
    this.gaitTune.clearance = ENEMY_GAIT.clearance * s
    this.gaitTune.stepAhead = ENEMY_GAIT.stepAhead * s
    this.gaitTune.lift = ENEMY_GAIT.lift * s
    this.gait.update(this.x, this.vx, this.face, speed, this.gaitTune, dt, walking, 2.2 * s, this.y > -0.5)
    this.gaitW = damp(this.gaitW, walking ? 1 : 0, walking ? 14 : 7, dt)
    if (this.gaitW > 0.01) {
      const bob = 1.3 * Math.abs(Math.sin(Math.PI * 2 * this.gait.phase)) * s
      // effective femur height target: 44·s (3 units of knee reserve) with
      // the mid-stance dip; pose[1] shows it exactly once through hipY+geom
      let eff = -44 * s + bob
      // pelvis bound: the most-extended planted leg limits the hip
      if (this.gait.hasPlanted) {
        const reach = 46 * s * 0.999
        let bound = -Infinity
        for (const f of [this.gait.footL, this.gait.footR]) {
          if (f.y > -0.5) continue
          const dx = Math.abs(f.x - this.x)
          const vert = Math.sqrt(Math.max(0, reach * reach - dx * dx))
          bound = Math.max(bound, f.y - vert)
        }
        if (isFinite(bound) && bound > eff) eff = bound
      }
      // pose[1] ↔ effective femur: eff = hipY + s·p1 = (y − 47s + p1·s) + s·p1
      // (y = 0 grounded) → p1 = (47s + eff) / (2s)
      const p1 = (47 * s + eff) / (2 * s)
      const w = this.gaitW
      this.pose[1] = this.pose[1] * (1 - w) + p1 * w
      // subtle live-lean while walking, scaled by actual speed (a stalking
      // enemy leans less than a charging one)
      this.pose[2] += 0.14 * clamp01(speed / 220) * w
    }
  }

  /** leg IK writer — gait legs (world targets → local, knee-forward) plus
   * the stance snap + floor clamp for other grounded states (windup/strike/
   * recover/stun/pattern/dive/getup). Lying-down and airborne states keep
   * their FK legs. */
  private applyGroundIK(): void {
    const s = this.scale
    const g = this.geom
    const l1 = ENEMY_SPEC.thigh
    const l2 = ENEMY_SPEC.shin
    const legLen = l1 + l2
    const grounded = this.y > -0.5 && this.state !== 'launched' && this.state !== 'enter'
    const w = this.gaitW
    this.snapContacts.length = 0

    if (w > 0.01) {
      const legs: [typeof this.gait.footL, typeof g.hipPtL, typeof g.kneeL, typeof g.ankleL, typeof g.toeL][] = [
        [this.gait.footL, g.hipPtL, g.kneeL, g.ankleL, g.toeL],
        [this.gait.footR, g.hipPtR, g.kneeR, g.ankleR, g.toeR],
      ]
      for (const [fp, hipPt, knee, ankle, toe] of legs) {
        const tx = (fp.x - this.x) / (this.face * s)
        const ty = (fp.y - this.hipY) / s
        solveLegIK(hipPt.x, hipPt.y, tx, ty, l1, l2, 1, this.ikOut)
        knee.x += (this.ikOut.kx - knee.x) * w
        knee.y += (this.ikOut.ky - knee.y) * w
        ankle.x += (this.ikOut.ax - ankle.x) * w
        ankle.y += (this.ikOut.ay - ankle.y) * w
        toeFromPitch(ankle.x, ankle.y, fp.pitch, ENEMY_SPEC.foot, this.toeScratch)
        // the floor is solid — a plantarflexed toe never digs below it
        const groundLy = (-1 - this.hipY) / s
        if (this.toeScratch.y > groundLy) this.toeScratch.y = groundLy
        toe.x += (this.toeScratch.x - toe.x) * w
        toe.y += (this.toeScratch.y - toe.y) * w
      }
    }

    // stance snap + floor clamp for the remaining grounded states
    if (w < 0.99 && grounded && this.state !== 'down') {
      const iw = 1 - w
      const pairs: [typeof g.hipPtL, typeof g.kneeL, typeof g.ankleL, typeof g.toeL][] = [
        [g.hipPtL, g.kneeL, g.ankleL, g.toeL],
        [g.hipPtR, g.kneeR, g.ankleR, g.toeR],
      ]
      for (const [hipPt, knee, ankle, toe] of pairs) {
        const ankleWy = this.hipY + s * ankle.y
        const toeWy = this.hipY + s * toe.y
        const extended = ankle.y > legLen * 0.52
        const nearGround = ankleWy > -12 * s && toeWy < 6 * s
        if (extended && nearGround) {
          const ty = (-2.2 * s - this.hipY) / s
          solveLegIK(hipPt.x, hipPt.y, ankle.x, ty, l1, l2, 1, this.ikOut)
          knee.x += (this.ikOut.kx - knee.x) * iw
          knee.y += (this.ikOut.ky - knee.y) * iw
          ankle.x += (this.ikOut.ax - ankle.x) * iw
          ankle.y += (this.ikOut.ay - ankle.y) * iw
          toeFromPitch(ankle.x, ankle.y, 0.12, ENEMY_SPEC.foot, this.toeScratch)
          toe.x += (this.toeScratch.x - toe.x) * iw
          toe.y += (this.toeScratch.y - toe.y) * iw
          if (iw > 0.5) this.snapContacts.push(this.x + this.face * s * ankle.x)
        } else if (toeWy > -0.5) {
          // the floor is solid — toes never render below it
          const groundLy = (-1 - this.hipY) / s
          if (toe.y > groundLy) toe.y = groundLy
        }
      }
    }
  }

  private countEngaged(w: WorldRef): number {
    let n = 0
    for (const e of w.enemies) {
      if (e.dead || e.id === this.id) continue
      if (e.state === 'windup' || e.state === 'strike' || e.state === 'aim') n++
    }
    return n
  }

  /* ------------------------------------------------------------------ */
  /* boss patterns                                                        */
  /* ------------------------------------------------------------------ */

  private updateBossPattern(dt: number, w: WorldRef, px: number, _py: number): void {
    this.patternT += dt
    const dx = px - this.x
    this.face = dx > 0 ? 1 : -1

    switch (this.patternStep) {
      case 0: { // approach + sweep
        this.vx = damp(this.vx, Math.sign(dx) * this.cfg.speed, 2, dt)
        if (Math.abs(dx) < 260 && this.patternT > 0.8) {
          this.patternStep = 1
          this.patternT = 0
          w.audio.play('telegraph', { pitch: 0.5, volume: 0.7 })
        }
        break
      }
      case 1: { // sweep windup
        this.vx = damp(this.vx, 0, 6, dt)
        if (this.patternT > 0.7) {
          this.patternStep = 2
          this.patternT = 0
          this.vx = Math.sign(dx) * 480
          w.audio.play('swingHeavy', { pitch: 0.55, volume: 0.9 })
          w.cam.addTrauma(0.3)
        }
        break
      }
      case 2: { // sweep strike
        if (this.patternT < 0.4 && Math.abs(dx) < 220) {
          w.enemyStrikePlayer(this.dmg, Math.sign(dx), true, this.x)
        }
        if (this.patternT > 0.5) {
          this.patternStep = 3
          this.patternT = 0
          this.patternIdx++
        }
        break
      }
      case 3: { // stomp (2 shockwaves)
        this.vx = 0
        if (this.patternT > 0.55 && this.patternIdx % 2 === 0) {
          // stomp
          w.audio.play('slam', { intensity: 1, pitch: 0.6 })
          w.fx.shockwave(this.x, 0, 240, '#ff2a4a', 0.6, 10)
          w.fx.groundCrack(this.x, 0, 140)
          w.cam.addTrauma(0.55)
          if (Math.abs(dx) < 250 && Math.abs(this.y) < 20) {
            w.enemyStrikePlayer(this.dmg * 0.8, Math.sign(dx), true, this.x)
          }
          this.patternStep = 4
          this.patternT = 0
        } else if (this.patternT > 0.55) {
          // missile volley instead
          for (let i = 0; i < 5; i++) {
            w.spawnProjectile({
              kind: 'missile', x: this.x + rand(-60, 60), y: this.y - 150,
              vx: rand(-120, 120), vy: -rand(60, 140),
              dmg: 10, life: 4, homing: 1.6,
            })
          }
          w.audio.play('explosion', { volume: 0.4, pitch: 1.4 })
          this.patternStep = 4
          this.patternT = 0
        }
        break
      }
      case 4: { // recover
        this.vx = damp(this.vx, 0, 4, dt)
        if (this.patternT > 1.1) {
          // enrage rush below 50% hp
          if (this.hp < this.maxHp * 0.5 && Math.random() < 0.4) {
            this.patternStep = 5
            this.patternT = 0
            w.audio.play('bossAlert', { volume: 0.4 })
          } else {
            this.patternStep = 0
            this.patternT = 0
          }
        }
        break
      }
      case 5: { // enrage rush
        if (this.patternT < 0.5) {
          this.vx = damp(this.vx, 0, 8, dt) // crouch telegraph
          if (this.patternT < 0.1) w.fx.sparks(this.x, 0, -Math.PI / 2, 1, 8, '#ff2a4a', 200)
        } else if (this.patternT < 1.2) {
          this.vx = Math.sign(dx || 1) * 620
          if (Math.abs(dx) < 190) {
            w.enemyStrikePlayer(this.dmg, Math.sign(dx), true, this.x)
          }
        } else {
          this.patternStep = 0
          this.patternT = 0
        }
        break
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* reactions                                                            */
  /* ------------------------------------------------------------------ */

  /** returns 'killed' | 'hit' | 'blocked' | 'armored' */
  takeHit(info: AttackRuntimeInfo, dir: number, fromX: number): 'killed' | 'hit' | 'blocked' | 'armored' {
    if (this.dead) return 'killed'
    this.hpBarT = 2
    this.flashT = 1

    // shield block: frontal, guard intact, not guard-breaking
    if (
      this.kind === 'shield' && this.blockUp && this.state !== 'stun' &&
      !info.breakGuard && Math.sign(fromX - this.x) === this.face
    ) {
      this.blockHp -= info.heavy ? 2 : 1
      this.hp -= info.dmg * 0.12
      if (this.blockHp <= 0) {
        // guard break
        this.state = 'stun'
        this.stunT = 2.1
        this.stateT = 0
        this.blockUp = false
        this.vx = dir * 200
        return 'hit'
      }
      return 'blocked'
    }

    // damage
    let dmg = info.dmg
    if (this.vulnerableT > 0) dmg *= 2
    if (this.kind === 'heavy' || this.kind === 'boss') dmg *= 0.72
    this.hp -= dmg

    if (this.hp <= 0) {
      this.dead = true
      return 'killed'
    }

    if (this.kind === 'boss') {
      this.staggerMeter += dmg
      if (this.staggerMeter >= 220) {
        this.staggerMeter = 0
        this.state = 'stun'
        this.stunT = 2.6
        this.vulnerableT = 3.2
        this.stateT = 0
      }
      return 'hit'
    }

    // launched / juggled state
    if (this.state === 'launched' || this.launched) {
      this.launched = true
      this.state = 'launched'
      this.stateT = 0
      this.vy = info.juggle !== 0 ? info.juggle * 0.9 : info.launch * 0.6 - 160
      this.vx = dir * info.kb * 0.45
      return 'hit'
    }

    // super-armor for heavy windup
    if (this.kind === 'heavy' && (this.state === 'windup' || this.state === 'strike') && !info.heavy && !info.launch && !info.breakGuard) {
      return 'armored'
    }

    if (info.launch !== 0 && this.kind !== 'heavy') {
      this.launched = true
      this.state = 'launched'
      this.stateT = 0
      this.vy = info.launch
      this.vx = dir * info.kb * 0.5
      return 'hit'
    }

    // normal hitstun
    this.state = 'stun'
    this.stunT = Math.max(0.18, info.stagger)
    this.stateT = 0
    this.vx = dir * (info.kb / (this.kind === 'heavy' ? 4 : 1))
    if (this.kind === 'drone' && info.launch === 0) {
      this.vy = -60
    }
    return 'hit'
  }

  /* ------------------------------------------------------------------ */
  /* procedural animation                                                 */
  /* ------------------------------------------------------------------ */

  private buildPose(dt: number, time: number): void {
    const p = this.pose
    // reset to baseline
    p[0] = 0
    p[1] = 0
    p[2] = 0.08
    p[3] = 0.05
    p[4] = -0.08
    p[5] = 0.24; p[6] = -0.12; p[7] = 0.1
    p[8] = -0.26; p[9] = -0.14; p[10] = 0.12
    p[11] = 0.3; p[12] = -0.45; p[13] = -0.1
    p[14] = 0.35; p[15] = -0.4; p[16] = 0.9

    const speed = Math.abs(this.vx)

    switch (this.state) {
      case 'chase':
      case 'strafe':
      case 'aim': {
        if (speed > 24) {
          const ph = this.walkPhase
          p[5] = Math.sin(ph) * 0.55
          p[6] = -0.2 - Math.max(0, -Math.sin(ph)) * 0.9
          p[8] = Math.sin(ph + Math.PI) * 0.55
          p[9] = -0.2 - Math.max(0, -Math.sin(ph + Math.PI)) * 0.9
          p[2] = 0.22
          p[1] = Math.abs(Math.sin(ph)) * 2.4 - 1.2
          // arms counter-swing (weapon arm steadier)
          p[11] = Math.sin(ph + Math.PI) * 0.4
          p[14] = 0.4 + Math.sin(ph) * 0.18
        } else {
          // idle sway
          p[1] = Math.sin(time * 2.2 + this.id) * 1.4
          p[14] = 0.35 + Math.sin(time * 2.2 + this.id) * 0.05
        }
        if (this.state === 'aim') {
          // rifle raised at player
          p[14] = 1.35
          p[15] = -0.15
          p[16] = -1.35 // blade angle ≈ forward
          p[11] = 1.1
          p[12] = -0.35
          p[2] = 0.05
        }
        if (this.kind === 'drone') {
          // hover pose: legs dangle, thruster bob
          p[1] = Math.sin(time * 5 + this.id) * 2
          p[5] = 0.35; p[6] = -0.7
          p[8] = 0.15; p[9] = -0.55
          p[14] = 0.6; p[15] = -0.7
          p[11] = -0.2; p[12] = -0.6
        }
        break
      }
      case 'windup': {
        const k = clamp01(this.stateT / this.cfg.windup)
        // coil back, weapon raised & glowing
        p[2] = -0.12 - k * 0.22
        p[14] = -1.5 - k * 0.9
        p[15] = -0.5
        p[16] = -0.4
        p[11] = 0.6 + k * 0.3
        p[5] = 0.4; p[8] = -0.5 - k * 0.15
        p[1] = k * 3
        break
      }
      case 'strike': {
        // weapon swept forward, lean in
        p[2] = 0.38
        p[14] = 1.45
        p[15] = -0.1
        p[16] = -0.15
        p[11] = -0.35
        p[5] = 0.6; p[6] = -0.35
        p[8] = -0.55
        break
      }
      case 'recover': {
        p[2] = 0.18
        p[14] = 0.8
        p[15] = -0.35
        break
      }
      case 'stun': {
        // slumped, dizzy
        p[2] = 0.42 + Math.sin(time * 6) * 0.04
        p[3] = 0.18
        p[4] = 0.22
        p[1] = 4
        p[14] = 0.15; p[15] = -0.15; p[16] = 0.3
        p[11] = -0.25; p[12] = -0.3
        p[5] = 0.5; p[6] = -0.65
        p[8] = -0.45; p[9] = -0.5
        break
      }
      case 'launched': {
        // spinning flail
        p[2] = this.spinT * 2.4 % (Math.PI * 2)
        p[5] = Math.sin(this.flailT) * 0.7
        p[8] = Math.sin(this.flailT + 2) * 0.7
        p[11] = Math.sin(this.flailT + 1) * 0.8
        p[14] = Math.sin(this.flailT + 3) * 0.8
        p[6] = -0.8; p[9] = -0.6
        break
      }
      case 'down': {
        // lying on the ground
        p[2] = 1.42
        p[1] = 34
        p[4] = -0.3
        p[5] = 0.9; p[6] = -0.3
        p[8] = -0.7; p[9] = -0.9
        p[11] = -1.2; p[14] = 1.0
        p[12] = -0.4; p[15] = -0.5
        break
      }
      case 'getup': {
        const k = clamp01(this.stateT / 0.45)
        // interpolate down → standing
        p[2] = 1.42 * (1 - k)
        p[1] = 34 * (1 - k)
        p[5] = 0.9 * (1 - k) + 0.24 * k
        p[8] = -0.7 * (1 - k) - 0.26 * k
        p[11] = -1.2 * (1 - k) + 0.3 * k
        p[14] = 1.0 * (1 - k) + 0.35 * k
        break
      }
      case 'dive': {
        p[2] = 0.7
        p[14] = 1.6; p[15] = -0.2; p[16] = -0.3
        p[5] = -0.5; p[8] = -0.3
        p[6] = -0.4; p[9] = -0.9
        break
      }
      case 'pattern': {
        if (this.patternStep === 1) {
          const k = clamp01(this.patternT / 0.7)
          p[2] = -0.1 - k * 0.25
          p[14] = -1.7 - k * 1.1
          p[15] = -0.4
          p[16] = -0.3
          p[11] = -0.9 - k * 0.5
          p[1] = k * 6
        } else if (this.patternStep === 2) {
          p[2] = 0.5
          p[14] = 1.5
          p[15] = -0.1
          p[16] = -0.1
          p[11] = 0.9
        } else if (this.patternStep === 3) {
          p[2] = 0.65
          p[14] = 2.9; p[15] = 0.3; p[16] = 0.2
          p[1] = 18
          p[5] = 0.9; p[8] = 0.7
          p[6] = -0.5; p[9] = -0.6
        } else if (this.patternStep === 5 && this.patternT < 0.5) {
          p[2] = 0.55
          p[1] = 14
          p[6] = -1.1; p[9] = -1.2
          p[14] = -1.2
        } else {
          p[2] = 0.15
          p[14] = 0.5
        }
        break
      }
      default:
        break
    }
    void dt
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                            */
  /* ------------------------------------------------------------------ */

  /** RAY-TRACED LIGHTNING illumination: while litT > 0 the silhouette
   * re-draws additively in the bolt color — struck bodies GLOW where the
   * channel touched them (the "ray-traced" read: light on geometry). */
  litT = 0
  litColor = '#41f6ff'

  /** called by the lightning engine on every bounce contact */
  lightningLit(color: string, t: number): void {
    this.litColor = color
    this.litT = Math.max(this.litT, t)
  }

  /* ---- LIGHTING ENGINE: projected-skeleton cast shadow ---- */
  private shChains: number[][] = [[], [], [], [], []]
  private shHead = { x: 0, y: 0, r: 0 }
  private shBlade = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private shFig: ShadowFigure = { chains: this.shChains, head: this.shHead, blade: this.shBlade }
  /* strobe rim state — set by the renderer each frame from the key light */
  strobeLight: KeyLight | null = null
  strobeK = 0
  private rimChains: number[][] = [[], [], [], [], []]
  /** contact-AO anchors from the plant-snap pass (non-gait stances) */
  private snapContacts: number[] = []

  drawShadow(ctx: CanvasRenderingContext2D, light: KeyLight): void {
    const g = this.geom
    const s = this.scale
    const f = this.face * s
    const hy = this.hipY
    const W = (j: { x: number; y: number }, out: number[]) => {
      out.push(this.x + f * j.x, hy + s * j.y)
    }
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
    this.shHead.x = this.x + f * g.headC.x
    this.shHead.y = hy + s * g.headC.y
    this.shHead.r = 8.6 * s
    // weapon streak (matches drawWeapon's reach)
    const wlen = this.cfg.weapon === 'bossblade' ? 92
      : this.cfg.weapon === 'none' || this.cfg.weapon === 'shield' ? 0 : 34
    if (wlen > 0) {
      this.shBlade.x0 = this.x + f * g.handR.x
      this.shBlade.y0 = hy + s * g.handR.y
      this.shBlade.x1 = this.x + f * (g.handR.x + Math.cos(g.bladeAngle) * wlen)
      this.shBlade.y1 = hy + s * (g.handR.y + Math.sin(g.bladeAngle) * wlen)
      this.shFig.blade = this.shBlade
    } else {
      this.shFig.blade = null
    }
    const contacts: number[] = []
    if (this.y > -0.5) {
      if (this.gaitW > 0.5) {
        if (this.gait.footL.planted) contacts.push(this.gait.footL.x)
        if (this.gait.footR.planted) contacts.push(this.gait.footR.x)
        if (contacts.length) contacts.push(this.x)
      }
      for (const c of this.snapContacts) contacts.push(c)
    }
    const flying = this.kind === 'drone' ? this.y : this.y
    drawCastShadow(ctx, this.shFig, light, {
      alpha: this.kind === 'drone' ? 0.36 : 0.5, width: 6, passes: 2, scale: s,
      height: flying, contacts,
    })
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.dead || this.spawning) return
    const s = this.scale
    const cfg = this.cfg
    ctx.save()
    ctx.translate(this.x, this.hipY)
    ctx.scale(this.face * s, s)
    drawStick(ctx, this.geom, cfg.style, {
      time,
      flash: this.flashT * 0.8,
      flashColor: '#ffffff',
    })
    this.drawWeapon(ctx, time)
    // LIGHTNING RIM: the bolt's channel lights the body it struck. A true
    // RIM, not a tint: the ghost re-pass draws ~7% scaled up, so the color
    // peeks out AROUND the silhouette (edge light), flickering with the
    // channel's ~15Hz restrike cadence
    if (this.litT > 0.02) {
      const k = clamp01(this.litT) * (0.8 + 0.2 * Math.sin(time * 47))
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.scale(1.075, 1.075)
      drawStick(ctx, this.geom, cfg.style, {
        ghost: this.litColor,
        ghostAlpha: 0.85 * k,
        time,
      })
      ctx.restore()
    }
    // STROBE RIM (lighting engine): the sky bolt lights every figure's
    // lit side — same additive edge pass the player gets
    if (this.strobeLight && this.strobeK > 0.04 && this.kind !== 'drone') {
      const g = this.geom
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
      drawStrobeRim(ctx, this.strobeLight, this.strobeK, rc,
        { x: g.headC.x, y: g.headC.y, r: 8.4 }, this.face, 4)
    }
    ctx.restore()

    // telegraph indicator
    if (this.state === 'windup' || (this.state === 'pattern' && this.patternStep === 1)) {
      const k = clamp01(this.stateT / this.cfg.windup)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = rgba('#ff2a4a', 0.7 + 0.3 * Math.sin(time * 26))
      ctx.lineWidth = 2
      const yy = this.hipY - 78 * s
      ctx.beginPath()
      ctx.moveTo(this.x - 7, yy - 10)
      ctx.lineTo(this.x + 7, yy + 2)
      ctx.moveTo(this.x + 7, yy - 10)
      ctx.lineTo(this.x - 7, yy + 2)
      ctx.stroke()
      // charge bar
      ctx.strokeStyle = rgba('#ff2a4a', 0.85)
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(this.x - 14, yy + 10)
      ctx.lineTo(this.x - 14 + 28 * k, yy + 10)
      ctx.stroke()
      ctx.restore()
    }

    // stun dizzy marks
    if (this.state === 'stun') {
      ctx.save()
      ctx.fillStyle = rgba('#ffe14d', 0.8)
      for (let i = 0; i < 3; i++) {
        const a = time * 4 + (i * Math.PI * 2) / 3
        ctx.beginPath()
        ctx.arc(this.x + Math.cos(a) * 16, this.hipY - 72 * s + Math.sin(a) * 5, 2.4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // hp bar (small, above)
    if (this.hpBarT > 0 && this.hp < this.maxHp && this.kind !== 'boss') {
      const wBar = 46 * s
      const yBar = this.hipY - 74 * s
      const a = clamp01(this.hpBarT)
      ctx.save()
      ctx.globalAlpha = a
      ctx.fillStyle = 'rgba(4,6,10,0.8)'
      ctx.fillRect(this.x - wBar / 2, yBar, wBar, 5)
      const frac = clamp01(this.hp / this.maxHp)
      ctx.fillStyle = frac > 0.5 ? '#46ffb4' : frac > 0.25 ? '#ffe14d' : '#ff2a4a'
      ctx.fillRect(this.x - wBar / 2 + 1, yBar + 1, (wBar - 2) * frac, 3)
      ctx.restore()
    }

    // boss vulnerable core indicator
    if (this.kind === 'boss' && this.vulnerableT > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const pulse = 0.5 + 0.5 * Math.sin(time * 12)
      ctx.strokeStyle = rgba('#ffe14d', 0.5 + pulse * 0.5)
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(this.x, this.hipY - 26, 30 + pulse * 8, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  /** CHEAP MIRROR GHOST — single flat-color stroke pass for the wet-floor
   * reflection (and any future multipass use). Full-detail redraws × 2
   * passes × N enemies were a frame-rate sink; the mirror only needs a
   * silhouette. */
  drawGhost(ctx: CanvasRenderingContext2D, _time: number): void {
    if (this.dead || this.spawning) return
    const g = this.geom
    ctx.save()
    ctx.translate(this.x, this.hipY)
    ctx.scale(this.face * this.scale, this.scale)
    ctx.strokeStyle = rgba(this.cfg.style.body, 0.9)
    ctx.lineWidth = this.cfg.style.lineW * 0.85
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // legs + arms as two-point chains
    ctx.beginPath()
    ctx.moveTo(g.hipPtL.x, g.hipPtL.y); ctx.lineTo(g.kneeL.x, g.kneeL.y); ctx.lineTo(g.ankleL.x, g.ankleL.y)
    ctx.moveTo(g.hipPtR.x, g.hipPtR.y); ctx.lineTo(g.kneeR.x, g.kneeR.y); ctx.lineTo(g.ankleR.x, g.ankleR.y)
    ctx.moveTo(g.shoulderL.x, g.shoulderL.y); ctx.lineTo(g.elbL.x, g.elbL.y); ctx.lineTo(g.handL.x, g.handL.y)
    ctx.moveTo(g.shoulderR.x, g.shoulderR.y); ctx.lineTo(g.elbR.x, g.elbR.y); ctx.lineTo(g.handR.x, g.handR.y)
    ctx.stroke()
    // torso + head
    ctx.lineWidth = this.cfg.style.lineW * 1.3
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
    ctx.lineTo(g.waist.x, g.waist.y)
    ctx.lineTo(g.chest.x, g.chest.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(g.headC.x, g.headC.y, 8, 0, Math.PI * 2)
    ctx.stroke()
    // weapon as one flat stroke (blade line only)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(g.handR.x, g.handR.y)
    ctx.lineTo(g.handR.x + Math.cos(g.bladeAngle) * 26, g.handR.y + Math.sin(g.bladeAngle) * 26)
    ctx.stroke()
    ctx.restore()
  }

  private drawWeapon(ctx: CanvasRenderingContext2D, time: number): void {
    const g = this.geom
    const cfg = this.cfg
    const a = g.bladeAngle
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const hx = g.handR.x
    const hy = g.handR.y
    const telegraphing = this.state === 'windup' || (this.state === 'pattern' && this.patternStep === 1)

    ctx.lineCap = 'round'

    switch (cfg.weapon) {
      case 'machete': {
        const len = 30
        ctx.strokeStyle = '#10151c'
        ctx.lineWidth = 6
        line(ctx, hx, hy, dx, dy, len)
        ctx.strokeStyle = cfg.weaponColor
        ctx.lineWidth = 3
        line(ctx, hx, hy, dx, dy, len)
        break
      }
      case 'dagger': {
        ctx.strokeStyle = '#10151c'
        ctx.lineWidth = 5
        line(ctx, hx, hy, dx, dy, 20)
        ctx.strokeStyle = cfg.weaponColor
        ctx.lineWidth = 2.2
        line(ctx, hx, hy, dx, dy, 20)
        break
      }
      case 'hammer': {
        // shaft + heavy head
        ctx.strokeStyle = '#2a2018'
        ctx.lineWidth = 5
        line(ctx, hx, hy, dx, dy, 34)
        const ex = hx + dx * 34
        const ey = hy + dy * 34
        ctx.fillStyle = cfg.weaponColor
        ctx.strokeStyle = '#04060a'
        ctx.lineWidth = 1.5
        ctx.save()
        ctx.translate(ex, ey)
        ctx.rotate(a)
        ctx.fillRect(-7, -11, 14, 22)
        ctx.strokeRect(-7, -11, 14, 22)
        ctx.restore()
        break
      }
      case 'shield': {
        // rect shield on front arm
        const sx = g.handL.x
        const sy = g.handL.y
        ctx.save()
        ctx.translate(sx + 6, sy)
        ctx.fillStyle = '#1a2620'
        ctx.strokeStyle = cfg.weaponColor
        ctx.lineWidth = 2.5
        const bw = 13
        const bh = 34
        roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 4)
        ctx.fill()
        ctx.stroke()
        if (this.blockUp) {
          ctx.globalCompositeOperation = 'lighter'
          ctx.strokeStyle = rgba(cfg.weaponColor, 0.35 + 0.2 * Math.sin(time * 8))
          ctx.lineWidth = 5
          roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 4)
          ctx.stroke()
        }
        ctx.restore()
        break
      }
      case 'rifle': {
        ctx.strokeStyle = '#1a1f28'
        ctx.lineWidth = 5.5
        line(ctx, hx - dx * 10, hy - dy * 10, dx, dy, 34)
        ctx.strokeStyle = cfg.weaponColor
        ctx.lineWidth = 1.6
        line(ctx, hx, hy, dx, dy, 34)
        if (this.state === 'aim') {
          // muzzle glow
          ctx.globalCompositeOperation = 'lighter'
          ctx.fillStyle = rgba(cfg.weaponColor, 0.6 + 0.4 * Math.sin(time * 30))
          ctx.beginPath()
          ctx.arc(hx + dx * 34, hy + dy * 34, 3.5, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }
      case 'sword': {
        const len = 44
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = rgba(cfg.weaponColor, 0.3)
        ctx.lineWidth = 8
        line(ctx, hx, hy, dx, dy, len)
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = '#10151c'
        ctx.lineWidth = 5
        line(ctx, hx, hy, dx, dy, len)
        ctx.strokeStyle = cfg.weaponColor
        ctx.lineWidth = 2.4
        line(ctx, hx, hy, dx, dy, len)
        break
      }
      case 'bossblade': {
        const len = 92
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = rgba(cfg.weaponColor, 0.25 + (telegraphing ? 0.3 * Math.sin(time * 20) : 0))
        ctx.lineWidth = 14
        line(ctx, hx, hy, dx, dy, len)
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = '#10151c'
        ctx.lineWidth = 9
        line(ctx, hx, hy, dx, dy, len)
        ctx.strokeStyle = cfg.weaponColor
        ctx.lineWidth = 4
        line(ctx, hx, hy, dx, dy, len)
        break
      }
      case 'none':
      default: {
        // drone: thruster flames under hips
        ctx.globalCompositeOperation = 'lighter'
        const f = 8 + Math.sin(time * 40 + this.id) * 4
        ctx.fillStyle = rgba('#35f2ff', 0.55)
        ctx.beginPath()
        ctx.moveTo(this.pose[0] - 6, 6)
        ctx.lineTo(this.pose[0] - 2, 6 + f)
        ctx.lineTo(this.pose[0] + 2, 6 + f * 0.7)
        ctx.closePath()
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(this.pose[0] + 4, 6)
        ctx.lineTo(this.pose[0] + 8, 6 + f * 0.8)
        ctx.lineTo(this.pose[0] + 11, 6 + f * 0.5)
        ctx.closePath()
        ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
        break
      }
    }

    // telegraph weapon glow
    if (telegraphing && cfg.weapon !== 'none' && cfg.weapon !== 'shield') {
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = rgba('#ff2a4a', 0.55 + 0.35 * Math.sin(time * 24))
      ctx.lineWidth = 4
      line(ctx, hx, hy, dx, dy, cfg.weapon === 'bossblade' ? 92 : 34)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

/* ------------------------------------------------------------------ */

/** player position reference — set by Game each frame (avoids circular imports) */
export const PLAYER_X_REF = { x: 400, y: 0 }

const ENEMY_SPEC = {
  torso: 32,
  neck: 3.9,
  headR: 8,
  shoulderFwd: 2.7,
  shoulderDrop: 2.8,
  upperArm: 20,
  foreArm: 18,
  hand: 6,
  thigh: 24,
  shin: 22,
  foot: 8,
  blade: 40,
}

function line(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, len: number): void {
  ctx.beginPath()
  ctx.moveTo(x - dx * 6, y - dy * 6)
  ctx.lineTo(x + dx * len, y + dy * len)
  ctx.stroke()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
