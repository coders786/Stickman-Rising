/** STICKMAN RISING — SWORD-LED ARM CONTROL (arc-driven IK sword arm).
 *
 * RESEARCH BASE (pixel-art sword-combo reference sheets, image-searched and
 * VLM-analyzed):
 *  · CraftPix "Samurai Pack": the overhead diagonal reads 10-11 → 4 o'clock,
 *    sweeping THROUGH the frontal target zone at chest height; horizontal
 *    kesa cuts ride at WAIST height — the hand is LOW, the blade level.
 *  · framesprite 16-frame slash VFX: a C-shaped sweep covering the whole
 *    front hemisphere; the hot core LEADS and a cooler wake trails it by
 *    ~30-45°; timing = acceleration → held peak → decay.
 *  · Wuxia "Fistmaster" combo chains (24-29f): 2-4f windup holds, 2-3 frame
 *    strikes with wide spacing deltas, 8-10 frame ease-out recoveries, a
 *    1-2 frame hit-stop at contact; hips rotate 30-40° into the strike;
 *    the elbow is ~90° chambered at windup and nearly locked (extended) at
 *    contact; trails wrap PAST the contact point (overshoot beyond it).
 *
 * ARCHITECTURE — the "arm in my control" inversion. The classic failure —
 * "every sword aims at a different angle and some angles never connect" —
 * comes from keyframing the FK arm chain (shR/elR/wrR) and DERIVING the
 * blade from it: nothing constrains the blade ray to pass through a target
 * during the active frames. This module inverts the hierarchy for the
 * strike window the way the reference sheets are actually authored: the
 * BLADE leads and the arm solves to carry it.
 *
 *  1. ENGAGE just before the authored sweep: capture the live chamber
 *     blade angle + hand position (perfect continuity, no pop).
 *  2. LOCK a contact angle = the attack's own technique angle (kesa
 *     diagonal, tsuki level, gyaku rising…), nudged ≤8° toward the enemy.
 *  3. Place the contact hand so the enemy sits on the MONOUCHI — the
 *     cutting third of the blade, mid-way between tsuba and kissaki:
 *     hand = E − dir(A)·s with s solved to keep the hand inside the arm's
 *     reach annulus. The enemy is then ON the blade segment BY
 *     CONSTRUCTION: visual hit = hitbox hit, every technique, every time.
 *  4. Sweep chamber → contact with an accelerating ease (inCubic — the
 *     researched "2-3 frame strike with wide spacing deltas"); long
 *     multi-hit windows sweep smooth instead (inOutSine). The hand glides
 *     chamber → monouchi on the same curve: the tip spirals out.
 *  5. Overshoot ~9° past the contact line, then settle; blend out into
 *     the authored follow-through.
 *
 * Runs at FULL frame rate on top of the stepped 24Hz body clip — the
 * mixed frame-rate law: body on twos, blade on ones.
 */

import { sampleClip } from './animator'
import { CH, makePose, Pose } from './pose'
import { makeSkelGeom, PLAYER_SPEC, SkelGeom, solveSkeleton } from './skeleton'
import type { AttackDef } from '../combat/attacks'
import { clamp, clamp01, EASES } from '../core/utils'

/** world→local scale + nominal hip height (mirror of entities/player.ts) */
const SCALE = 1.32
const HIP_H = (PLAYER_SPEC.thigh + PLAYER_SPEC.shin) * SCALE

/** Enemy body bands in world units above the feet (mirror of the hit-test
 * BODY_SPHERES in entities/player.ts). The arc targets the band matching
 * the attack's authored strike HEIGHT — kesa cuts the torso, tsuki the
 * chest, hasso the legs: technique identity survives the aim lock. */
const BANDS: ReadonlyArray<{ oy: number; r: number }> = [
  { oy: 14, r: 15 }, // legs / hip mass
  { oy: 48, r: 21 }, // torso (the main target)
  { oy: 78, r: 17 }, // chest / head zone
]

/** arm reach in character-local units */
const ARM_REACH = PLAYER_SPEC.upperArm + PLAYER_SPEC.foreArm
/** nominal on-screen blade length (local): spec × hyper-scale × grip draw */
const BLADE_LEN = PLAYER_SPEC.blade * 1.06 * 1.22

/** virtual whiff target: where an enemy usually stands (local units) */
const VIRTUAL_X = 55

export interface ArcEnemy {
  x: number
  y: number
  scale: number
  dead: boolean
  spawning: boolean
}

export interface ArcCtx {
  pose: Pose
  /** live sword-shoulder + sword-hand from last frame's solve (character-local).
   * The IK pivots from the GLENOHUMERAL joint — the arm's anatomical root. */
  shoulderX: number
  shoulderY: number
  handX: number
  handY: number
  /** current attack (null → solver decays out) */
  def: AttackDef | null
  animT: number
  enemies: readonly ArcEnemy[]
  face: number
  /** player world position */
  x: number
  hipY: number
  /** world reach envelope for lock targets */
  reach: number
}

interface ArcProfile {
  /** technique contact angle (rad; 0 = level, + = tip down) */
  authA: number
  /** authored hand height (local y) at mid-active — band selector */
  handY: number
  /** contact extension fraction of arm reach */
  extC: number
  /** target band index */
  band: number
}

/* ------------------------------------------------------------------ */
/* per-attack profile derivation (cached)                              */
/* ------------------------------------------------------------------ */

const profiles = new Map<string, ArcProfile>()
const dPose = makePose()
const dGeom = makeSkelGeom()

function profileFor(def: AttackDef): ArcProfile {
  let p = profiles.get(def.id)
  if (p) return p
  const tMid = (def.hit.start + def.hit.end) * 0.5
  sampleClip(def.clip, tMid, dPose)
  solveSkeleton(dPose, PLAYER_SPEC, dGeom)
  const sum = dPose[CH.shR] + dPose[CH.elR] + dPose[CH.wrR]
  const authA = Math.PI / 2 - sum
  const handY = dGeom.handR.y
  // nearest band to the authored strike height
  let band = 1
  let bd = Infinity
  for (let i = 0; i < BANDS.length; i++) {
    const ly = (HIP_H - BANDS[i].oy) / SCALE
    const d = Math.abs(ly - handY)
    if (d < bd) {
      bd = d
      band = i
    }
  }
  // authored extension at strike (slightly boosted: the arm drives
  // THROUGH the target — research: elbow near-locked at contact)
  const extAuth = Math.hypot(dGeom.handR.x - dGeom.shoulderR.x, dGeom.handR.y - dGeom.shoulderR.y) / ARM_REACH
  p = {
    authA,
    handY,
    extC: clamp(extAuth + 0.05, 0.62, 0.96),
    band,
  }
  profiles.set(def.id, p)
  return p
}

/* ------------------------------------------------------------------ */
/* monouchi hand placement                                             */
/* ------------------------------------------------------------------ */

/**
 * Places the sword hand so the blade line (hand → tip along dir(A))
 * passes through the target point E: hand = E − dir(A)·s, with s chosen
 * to land the hand inside the arm's reach annulus (law-of-cosines IK can
 * then always solve). `sx, sy` = the sword SHOULDER (glenohumeral pivot).
 * Returns the hand position.
 */
function placeHand(
  ex: number, ey: number, // target center (character-local)
  a: number, // blade angle
  sx: number, sy: number, // shoulder pivot
): { x: number; y: number } {
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  const vx = ex - sx
  const vy = ey - sy
  const d2 = vx * vx + vy * vy
  // projection of the target onto the blade axis
  const proj = vx * dx + vy * dy
  // perpendicular distance from the shoulder to the blade line through E
  const perp2 = Math.max(0, d2 - proj * proj)
  const r = ARM_REACH * 0.92
  // hand = E − dir·s at radius r from the shoulder:
  //   |E − dir·s − shoulder|² = r²  →  s² − 2·proj·s + d2 − r² = 0
  const disc = r * r - perp2
  let s = -1
  if (disc >= 0) {
    const root = Math.sqrt(disc)
    const sA = proj - root
    const sB = proj + root
    // prefer s in the cutting zone [4, 0.75·L], closest to mid-blade
    const lo = 4
    const hi = BLADE_LEN * 0.75
    const sClamp = (v: number) => clamp(v, lo, hi)
    const cA = sClamp(sA)
    const cB = sClamp(sB)
    const mid = BLADE_LEN * 0.45
    s = Math.abs(cA - mid) <= Math.abs(cB - mid) ? cA : cB
  }
  if (s < 0) {
    // blade line passes outside the annulus (extreme geometry): fall back
    // to a radial extension — the blade still sweeps the front plane
    return { x: sx + dx * ARM_REACH * 0.9, y: sy + dy * ARM_REACH * 0.9 }
  }
  let hx = ex - dx * s
  let hy = ey - dy * s
  // hard clamp into the reachable annulus (solving drift safety)
  const rx = hx - sx
  const ry = hy - sy
  const rr = Math.hypot(rx, ry) || 1e-4
  const rc = clamp(rr, ARM_REACH * 0.34, ARM_REACH * 0.965)
  hx = sx + (rx / rr) * rc
  hy = sy + (ry / rr) * rc
  return { x: hx, y: hy }
}

/* ------------------------------------------------------------------ */
/* the solver                                                          */
/* ------------------------------------------------------------------ */

export class SwordArcSolver {
  /** blend weight of the arc layer over the FK arm (0..1) */
  weight = 0
  /** current arc blade angle (valid while weight > 0) */
  bladeA = 0
  /** arc angular velocity (rad/s) — diagnostics + tuning */
  sweepVel = 0

  private engaged = false
  private startA = 0
  private lockedA = 0
  private hand0X = 0
  private hand0Y = 0
  private handCX = 0
  private handCY = 0
  private lastA = 0
  private hasLast = false

  begin(): void {
    this.engaged = false
    this.hasLast = false
    this.weight = 0
  }

  update(dt: number, c: ArcCtx): void {
    if (dt <= 1e-6) return
    const def = c.def
    if (!def) {
      this.weight = Math.max(0, this.weight - dt * 22)
      if (this.weight < 0.01) this.hasLast = false
      return
    }
    const h = def.hit
    const profile = profileFor(def)
    const blendStart = def.trail.start - 0.045
    const contactT = Math.max(h.start + 0.02, h.end - 0.02)
    const ovEnd = contactT + 0.08
    const releaseStart = Math.max(ovEnd, def.trail.end - 0.02)
    const releaseEnd = releaseStart + 0.09
    const t = c.animT

    if (t < blendStart) {
      // windup: pure authored FK chamber (the pretty pose owns this beat)
      this.weight = Math.max(0, this.weight - dt * 22)
      return
    }
    if (t > releaseEnd) {
      this.weight = Math.max(0, this.weight - dt * 22)
      if (this.weight < 0.01) this.engaged = false
      return
    }

    // ---- ENGAGE: capture the live chamber + lock the contact angle ----
    if (!this.engaged) {
      this.engaged = true
      const p = c.pose
      this.startA = Math.PI / 2 - (p[CH.shR] + p[CH.elR] + p[CH.wrR])
      this.hand0X = c.handX
      this.hand0Y = c.handY
      this.lockedA = this.lockContact(profile, c)
    }

    // ---- weight trapezoid (blend in over 45ms, out over 90ms) ----
    const wIn = clamp01((t - blendStart) / 0.045)
    const wOut = t <= releaseStart ? 1 : 1 - clamp01((t - releaseStart) / (releaseEnd - releaseStart))
    const w = Math.min(wIn, wOut)
    this.weight = w

    // ---- arc angle + hand path ----
    const span = Math.max(1e-4, contactT - blendStart)
    let a: number
    let hx: number
    let hy: number
    if (t <= contactT) {
      const u = clamp01((t - blendStart) / span)
      // wide spacing deltas: hold near the chamber, then the 2-3 frame
      // strike burst (inCubic). Long multi-hit windows sweep smooth.
      const e = span > 0.3 ? EASES.inOutSine(u) : EASES.inCubic(u)
      a = this.startA + (this.lockedA - this.startA) * e
      hx = this.hand0X + (this.handCX - this.hand0X) * e
      hy = this.hand0Y + (this.handCY - this.hand0Y) * e
    } else if (t <= ovEnd) {
      // OVERSHOOT: the tip pushes PAST the contact line (~9°) and snaps
      // back — research: trails wrap past the contact point.
      const v = clamp01((t - contactT) / 0.08)
      const dir = Math.sign(this.lockedA - this.startA) || 1
      const mag = clamp(Math.abs(this.lockedA - this.startA) * 0.22, 0.05, 0.18)
      a = this.lockedA + dir * mag * Math.sin(v * Math.PI) * (1 - 0.45 * v)
      hx = this.handCX
      hy = this.handCY
    } else {
      a = this.lockedA
      hx = this.handCX
      hy = this.handCY
    }
    this.bladeA = a
    this.sweepVel = this.hasLast ? (a - this.lastA) / dt : 0
    this.lastA = a
    this.hasLast = true

    // ---- 2-bone IK: the arm carries the blade ----
    if (w > 0.02) {
      // clamp the hand target into the reach annulus around the SHOULDER
      let rx = hx - c.shoulderX
      let ry = hy - c.shoulderY
      const rr = Math.hypot(rx, ry) || 1e-4
      const rc = clamp(rr, ARM_REACH * 0.34, ARM_REACH * 0.965)
      const tx = c.shoulderX + (rx / rr) * rc
      const ty = c.shoulderY + (ry / rr) * rc
      const U = PLAYER_SPEC.upperArm
      const F = PLAYER_SPEC.foreArm
      rx = tx - c.shoulderX
      ry = ty - c.shoulderY
      const d = Math.hypot(rx, ry)
      const cosB = clamp((U * U + d * d - F * F) / (2 * U * d), -1, 1)
      const B = Math.acos(cosB)
      const base = Math.atan2(ry, rx)
      // elbow bends DOWN (anatomical — matches the off-hand IK)
      const upperAng = base + B
      const ex = c.shoulderX + Math.cos(upperAng) * U
      const ey = c.shoulderY + Math.sin(upperAng) * U
      const shIk = Math.atan2(ex - c.shoulderX, ey - c.shoulderY)
      const elIk = Math.atan2(tx - ex, ty - ey) - shIk
      // bladeAngle = π/2 − (shR+elR+wrR) → wrist closes the chain onto A
      const wrIk = (Math.PI / 2 - a) - shIk - elIk
      const p = c.pose
      p[CH.shR] += (shIk - p[CH.shR]) * w
      p[CH.elR] += (elIk - p[CH.elR]) * w
      p[CH.wrR] += (wrIk - p[CH.wrR]) * w
    }
  }

  /** Lock the contact angle + monouchi hand for this swing. */
  private lockContact(profile: ArcProfile, c: ArcCtx): number {
    // ---- pick the live target: nearest enemy in the reach envelope ----
    let ex = VIRTUAL_X
    let ey = (HIP_H - BANDS[profile.band].oy) / SCALE
    let bestD = Infinity
    const reachLocal = c.reach / SCALE
    for (const e of c.enemies) {
      if (e.dead || e.spawning) continue
      const lx = (e.x - c.x) * c.face / SCALE
      if (lx < 8 || lx > reachLocal) continue
      const ly = (e.y - BANDS[profile.band].oy * e.scale - c.hipY) / SCALE
      if (Math.abs(ly) > 170) continue
      const d = Math.abs(lx - 45) + Math.abs(ly) * 0.5
      if (d < bestD) {
        bestD = d
        ex = lx
        ey = ly
      }
    }
    // ---- contact angle: the technique angle, nudged toward the enemy ----
    const dirC = Math.atan2(ey - c.shoulderY, ex - c.shoulderX)
    let dA = dirC - profile.authA
    while (dA > Math.PI) dA -= Math.PI * 2
    while (dA < -Math.PI) dA += Math.PI * 2
    const locked = profile.authA + clamp(dA, -0.35, 0.35) * 0.24
    // ---- monouchi hand placement ----
    const hand = placeHand(ex, ey, locked, c.shoulderX, c.shoulderY)
    this.handCX = hand.x
    this.handCY = hand.y
    return locked
  }
}
