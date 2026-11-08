/** STICKMAN RISING — SWORD-LED ARM CONTROL II: THE 3D TRAJECTORY SOLVER.
 *
 * RESEARCH BASE (pixel-art sword-combo reference sheets, VLM-analyzed):
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
 * ── THE 3D TRAJECTORY SYSTEM ───────────────────────────────────────────
 * Every attack declares its blade path through REAL 3D space (traj field):
 *    pitch  a0 → a1   — the screen-plane blade angle (chamber → contact)
 *    yaw    y0 → y1   — the DEPTH plane rotation: the kissaki sweeps from
 *                       behind the body plane (−) through the target plane
 *                       (0) toward the camera (+). Horizontal cuts carve
 *                       wide depth arcs; thrusts spear the lens.
 *    extent e0 → e1   — arm extension (chambered coil → driven through)
 * The solver sweeps (a, y, e) along a researched acceleration curve and
 * solves the arm in 3D (2-bone IK + shoulder yaw — rig3d.ikArm3D) so the
 * blade CARRIES the path. The enemy sits on the monouchi BY CONSTRUCTION:
 * the contact hand is placed on the blade's 3D ray through the target.
 *
 * THE BODY FOLLOWS THE BLADE: the same yaw drives pelvis rotation (40%)
 * and chest counter-rotation (75%) — hips → torso → shoulders generate
 * the sword's power together; the extension drives a weight shift onto
 * the front foot. Attacks that pass through depth visibly TWIST the
 * fighter through the transverse plane.
 *
 * Timing: body clips play "on twos" (24Hz) while this layer integrates at
 * full frame rate — mixed frame-rate law, blade on ones.
 */

import { CH, Pose } from './pose'
import { PLAYER_SPEC } from './skeleton'
import { ikArm3D } from './rig3d'
import type { AttackDef, Traj3D } from '../combat/attacks'
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
  /** live sword-shoulder + sword-hand from last frame's solve (character-local,
   *  PROJECTED x/y + depth z — the 3D chain pivots from the glenohumeral). */
  shoulderX: number
  shoulderY: number
  shoulderZ: number
  handX: number
  handY: number
  handZ: number
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

/* ------------------------------------------------------------------ */
/* fallback profile (attacks without a declared traj) — derived from   */
/* the keyframed mid-active pose, exactly like the classic solver      */
/* ------------------------------------------------------------------ */

import { makePose } from './pose'
import { makeFighterGeom, solveFighter3D } from './rig3d'

const profiles = new Map<string, { a0: number; a1: number; y0: number; y1: number; e0: number; e1: number; band: number }>()
const dPose = makePose()
const dGeom = makeFighterGeom()

function profileFor(def: AttackDef): { a0: number; a1: number; y0: number; y1: number; e0: number; e1: number; band: number } {
  let p = profiles.get(def.id)
  if (p) return p
  const tMid = (def.hit.start + def.hit.end) * 0.5
  const tChamber = Math.max(0, def.trail.start - 0.1)
  // solve the authored keyframes through the 3D rig to read the chamber
  // and contact blade states
  solveFighter3D(sampleAt(def, tChamber), PLAYER_SPEC, dGeom, PLAYER_SPEC.blade)
  const a0 = dGeom.bladeAngle
  const y0 = dGeom.bladeYaw
  const ext0 = Math.hypot(dGeom.handR.x - dGeom.shoulderR.x, dGeom.handR.y - dGeom.shoulderR.y) / ARM_REACH
  const h0 = dGeom.handR.y
  solveFighter3D(sampleAt(def, tMid), PLAYER_SPEC, dGeom, PLAYER_SPEC.blade)
  const a1 = dGeom.bladeAngle
  const y1 = dGeom.bladeYaw
  const ext1 = Math.hypot(dGeom.handR.x - dGeom.shoulderR.x, dGeom.handR.y - dGeom.shoulderR.y) / ARM_REACH
  const h1 = dGeom.handR.y
  // nearest band to the authored strike height
  let band = 1
  let bd = Infinity
  for (let i = 0; i < BANDS.length; i++) {
    const ly = (HIP_H - BANDS[i].oy) / SCALE
    const d = Math.abs(ly - h1)
    if (d < bd) {
      bd = d
      band = i
    }
  }
  p = {
    a0,
    a1,
    y0,
    y1: y1 + 0.25, // derived sweeps still get a depth exit bias
    e0: clamp(ext0, 0.4, 0.8),
    e1: clamp(ext1 + 0.05, 0.62, 0.96),
    band,
  }
  void h0
  profiles.set(def.id, p)
  return p
}

/** keyframe sampler (local — the Animator's is instance state) */
import { sampleClip } from './animator'
import type { Clip } from './animator'
const sampleCache = new Map<string, { clip: Clip; pose: Pose }>()
function sampleAt(def: AttackDef, t: number): Pose {
  let c = sampleCache.get(def.id)
  if (!c || c.clip !== def.clip) {
    c = { clip: def.clip, pose: makePose() }
    sampleCache.set(def.id, c)
  }
  sampleClip(def.clip, t, c.pose)
  return c.pose
}

/* ------------------------------------------------------------------ */
/* the solver                                                          */
/* ------------------------------------------------------------------ */

/** normalized trajectory spec the solver consumes */
interface TrajState {
  a0: number
  a1: number
  y0: number
  y1: number
  e0: number
  e1: number
  band: number
}

export class SwordArcSolver {
  /** blend weight of the arc layer over the FK arm (0..1) */
  weight = 0
  /** current arc blade angle (valid while weight > 0) */
  bladeA = 0
  /** current arc blade YAW (depth) — diagnostics + tuning */
  bladeY = 0
  /** arc angular velocity (rad/s) — diagnostics + tuning */
  sweepVel = 0

  private engaged = false
  private startA = 0
  private startY = 0
  private lockedA = 0
  private lockedY = 0
  private hand0X = 0
  private hand0Y = 0
  private hand0Z = 0
  private handCX = 0
  private handCY = 0
  private handCZ = 0
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
    const traj = trajFor(def)
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

    // ---- ENGAGE: capture the live chamber + lock the 3D contact ----
    if (!this.engaged) {
      this.engaged = true
      const p = c.pose
      this.startA = Math.PI / 2 - (p[CH.shR] + p[CH.elR] + p[CH.wrR])
      this.startY = p[CH.bladeYaw]
      this.hand0X = c.handX
      this.hand0Y = c.handY
      this.hand0Z = c.handZ
      this.lockContact(traj, c)
    }

    // ---- weight trapezoid (blend in over 45ms, out over 90ms) ----
    const wIn = clamp01((t - blendStart) / 0.045)
    const wOut = t <= releaseStart ? 1 : 1 - clamp01((t - releaseStart) / (releaseEnd - releaseStart))
    const w = Math.min(wIn, wOut)
    this.weight = w

    // ---- sweep the trajectory: chamber → contact (→ overshoot) ----
    const span = Math.max(1e-4, contactT - blendStart)
    let a: number
    let y: number
    let ext: number
    let hx: number
    let hy: number
    let hz: number
    if (t <= contactT) {
      const u = clamp01((t - blendStart) / span)
      // wide spacing deltas: hold near the chamber, then the 2-3 frame
      // strike burst (inCubic). Long multi-hit windows sweep smooth.
      const e = span > 0.3 ? EASES.inOutSine(u) : EASES.inCubic(u)
      a = this.startA + (this.lockedA - this.startA) * e
      y = this.startY + (this.lockedY - this.startY) * e
      ext = traj.e0 + (traj.e1 - traj.e0) * e
      hx = this.hand0X + (this.handCX - this.hand0X) * e
      hy = this.hand0Y + (this.handCY - this.hand0Y) * e
      hz = this.hand0Z + (this.handCZ - this.hand0Z) * e
    } else if (t <= ovEnd) {
      // OVERSHOOT: the tip pushes PAST the contact line (~12% of span) in
      // BOTH pitch and yaw — the blade wraps through depth past the target,
      // then snaps back — research: trails wrap past the contact point.
      const v = clamp01((t - contactT) / 0.08)
      const dirA = Math.sign(this.lockedA - this.startA) || 1
      const dirY = Math.sign(this.lockedY - this.startY) || 1
      const magA = clamp(Math.abs(this.lockedA - this.startA) * 0.22, 0.05, 0.18)
      const magY = clamp(Math.abs(this.lockedY - this.startY) * 0.16, 0.04, 0.14)
      a = this.lockedA + dirA * magA * Math.sin(v * Math.PI) * (1 - 0.45 * v)
      y = this.lockedY + dirY * magY * Math.sin(v * Math.PI) * (1 - 0.45 * v)
      ext = traj.e1
      hx = this.handCX
      hy = this.handCY
      hz = this.handCZ
    } else {
      a = this.lockedA
      y = this.lockedY
      ext = traj.e1
      hx = this.handCX
      hy = this.handCY
      hz = this.handCZ
    }
    this.bladeA = a
    this.bladeY = y
    this.sweepVel = this.hasLast ? (a - this.lastA) / dt : 0
    this.lastA = a
    this.hasLast = true

    // ---- 3D arm IK: the arm carries the blade ----
    if (w > 0.02) {
      const p = c.pose
      // target = swept hand position, extension-scaled from the shoulder.
      // DEGENERACY GUARDS: the target stays FORWARD of the shoulder with
      // bounded depth — an arm that solves backward or 27 units deep reads
      // as a broken rig (the ±π yaw snap) and no cut needs it.
      let tx = hx - c.shoulderX
      let ty = hy - c.shoulderY
      let tz = hz - c.shoulderZ
      const d = Math.hypot(tx, ty, tz) || 1e-4
      // 0.93 ceiling: full-reach targets solve the elbow to ~169° interior
      // — the locked-straight "past 170°" elbow. The surrender is invisible;
      // the dislocation read was not.
      const want = ARM_REACH * clamp(0.32 + ext * 0.61, 0.32, 0.93)
      const k = Math.min(1, want / d)
      tx *= k
      ty *= k
      tz *= k
      if (tx < 5) tx = 5
      tz = clamp(tz, -13, 13)
      const ik = ikArm3D(tx, ty, tz, PLAYER_SPEC.upperArm, PLAYER_SPEC.foreArm)
      // yaw continuity + anatomical bound: unwrap onto the branch nearest
      // the blade's own yaw, then clamp — the sword arm never yaws past
      // ~77°; anything wider is a solve artifact, not anatomy
      let armYaw = ik.yaw
      while (armYaw - y > Math.PI) armYaw -= Math.PI * 2
      while (y - armYaw > Math.PI) armYaw += Math.PI * 2
      // FOREARM-LEAD SPLIT: the hand leads through depth while the elbow
      // trails in its own plane (shoulder internal rotation + pronation —
      // the horizontal-cut read). The shoulder plane carries ~58% of the
      // cut's depth yaw (clamped ±77° anatomically), the forearm's
      // elbow-pivot yaw carries the rest — TOTAL stays = ik.yaw so the
      // hand still lands exactly on the IK target.
      const foreLead = clamp(ik.yaw * 0.42, -0.6, 0.6)
      armYaw = clamp(armYaw - foreLead, -1.35, 1.35)
      const foreYaw = clamp(ik.yaw - armYaw, -0.65, 0.65)
      // wrist closes the chain onto the swept pitch a
      const wrIk = Math.PI / 2 - a - ik.sh - ik.el
      p[CH.shR] += (ik.sh - p[CH.shR]) * w
      p[CH.elR] += (ik.el - p[CH.elR]) * w
      p[CH.wrR] += (wrIk - p[CH.wrR]) * w
      p[CH.armRz] += (armYaw - p[CH.armRz]) * w
      p[CH.foreRz] += (foreYaw - p[CH.foreRz]) * w
      // the blade's own yaw channel takes the trajectory yaw
      p[CH.bladeYaw] += (y - p[CH.bladeYaw]) * w

      // ---- THE BODY FOLLOWS THE BLADE: hips rotate with the cut's depth
      // sweep, the chest counter-rotates further (75%), and the extension
      // shifts weight onto the front foot. Hips → torso → shoulders
      // generate the sword's power TOGETHER (spec §4).
      p[CH.pelvisYaw] += y * 0.4 * w
      p[CH.chestYaw] += y * 0.75 * w
      p[CH.rootX] += (ext - traj.e0) * 7 * w
      p[CH.rootRot] += clamp((ext - traj.e0) * 0.5, -0.3, 0.3) * w
    }
  }

  /** Lock the 3D contact: pitch/yaw from the trajectory, hand placed on the
   * monouchi ray through the live target. The enemy ends up ON the blade
   * segment by construction — in 3D, then projected for the hitbox. */
  private lockContact(traj: TrajState, c: ArcCtx): void {
    // ---- pick the live target: nearest enemy in the reach envelope ----
    let ex = VIRTUAL_X
    let ey = (HIP_H - BANDS[traj.band].oy) / SCALE
    let bestD = Infinity
    const reachLocal = c.reach / SCALE
    for (const e of c.enemies) {
      if (e.dead || e.spawning) continue
      const lx = (e.x - c.x) * c.face / SCALE
      if (lx < 8 || lx > reachLocal) continue
      const ly = (e.y - BANDS[traj.band].oy * e.scale - c.hipY) / SCALE
      if (Math.abs(ly) > 170) continue
      const d = Math.abs(lx - 45) + Math.abs(ly) * 0.5
      if (d < bestD) {
        bestD = d
        ex = lx
        ey = ly
      }
    }
    // the target sits on the gameplay plane (z = 0)
    const ez = 0

    // ---- contact state from the trajectory (nudge the pitch toward the
    // enemy's height band so tall/short targets stay on the edge) ----
    let locked = traj.a1
    {
      const dirC = Math.atan2(ey - c.shoulderY, ex - c.shoulderX)
      let dA = dirC - traj.a1
      while (dA > Math.PI) dA -= Math.PI * 2
      while (dA < -Math.PI) dA += Math.PI * 2
      locked = traj.a1 + clamp(dA, -0.35, 0.35) * 0.2
    }
    this.lockedA = locked
    this.lockedY = traj.y1

    // ---- monouchi hand placement IN 3D: hand = E − dir3D(a, y)·s, with s
    // chosen to land the hand inside the arm's 3D reach annulus ----
    const dx = Math.cos(locked) * Math.cos(traj.y1)
    const dy = Math.sin(locked)
    const dz = Math.cos(locked) * Math.sin(traj.y1)
    const vx = ex - c.shoulderX
    const vy = ey - c.shoulderY
    const vz = ez - c.shoulderZ
    const d2 = vx * vx + vy * vy + vz * vz
    const proj = vx * dx + vy * dy + vz * dz
    const perp2 = Math.max(0, d2 - proj * proj)
    const r = ARM_REACH * 0.92
    const disc = r * r - perp2
    let s = -1
    if (disc >= 0) {
      const root = Math.sqrt(disc)
      const sA = proj - root
      const sB = proj + root
      // prefer s in the cutting zone [4, 0.75·L], closest to mid-blade —
      // AND favoring the candidate that keeps the hand FORWARD of the
      // shoulder (a backward hand flips the arm yaw through ±π: the snap
      // bug; a sword arm reaches forward through cuts, always)
      const lo = 4
      const hi = BLADE_LEN * 0.75
      const sClamp = (v: number) => clamp(v, lo, hi)
      const cA = sClamp(sA)
      const cB = sClamp(sB)
      const mid = BLADE_LEN * 0.45
      const fwdA = ex - dx * cA - c.shoulderX
      const fwdB = ex - dx * cB - c.shoulderX
      if (fwdA < 6 && fwdB >= 6) s = cB
      else if (fwdB < 6 && fwdA >= 6) s = cA
      else s = Math.abs(cA - mid) <= Math.abs(cB - mid) ? cA : cB
    }
    let hx: number
    let hy: number
    let hz: number
    if (s < 0) {
      // blade ray passes outside the annulus (degenerate geometry — e.g.
      // attacking point-blank out of a sprint, where the visual shoulder
      // rides ~20 units forward of the hip): place the hand FORWARD of the
      // shoulder at a sane depth. NEVER along the raw ray — its z-component
      // can fling the grip 27 units at the camera and flip the arm through ±π.
      hx = c.shoulderX + ARM_REACH * 0.8
      hy = ey
      hz = c.shoulderZ + clamp(-dz * 12, -8, 8)
    } else {
      hx = ex - dx * s
      hy = ey - dy * s
      hz = ez - dz * s
      // hard clamp into the reachable annulus (solving drift safety) —
      // the clamp direction preserves the forward bias
      const rx = hx - c.shoulderX
      const ry = hy - c.shoulderY
      const rz = hz - c.shoulderZ
      const rr = Math.hypot(rx, ry, rz) || 1e-4
      const rc = clamp(rr, ARM_REACH * 0.32, ARM_REACH * 0.93)
      hx = c.shoulderX + (rx / rr) * rc
      hy = c.shoulderY + (ry / rr) * rc
      hz = c.shoulderZ + (rz / rr) * rc
    }
    // forward floor: the sword hand never solves BEHIND the shoulder —
    // point-blank targets take a short-forward grip instead of a flipped arm
    if (hx - c.shoulderX < 6) hx = c.shoulderX + 6
    this.handCX = hx
    this.handCY = hy
    this.handCZ = hz
  }
}

/** trajectory for an attack: declared 3D path, or the derived fallback */
function trajFor(def: AttackDef): TrajState {
  if (def.traj) {
    // band from the declared strike height (default torso)
    let band = 1
    const hy = (HIP_H - (def.traj.band ?? 48)) / SCALE
    let bd = Infinity
    for (let i = 0; i < BANDS.length; i++) {
      const d = Math.abs((HIP_H - BANDS[i].oy) / SCALE - hy)
      if (d < bd) {
        bd = d
        band = i
      }
    }
    return { ...def.traj, band }
  }
  return profileFor(def)
}

export type { Traj3D }
