/** STICKMAN RISING — THE 3D FIGHTER RIG (rig3d).
 *
 * ── AXIS CONVENTION (the single source of truth) ──────────────────────
 *  Character-local space, RIGHT-handed, mirrored by the draw transform:
 *    +X  = facing direction (horizontal, gameplay plane)
 *    +Y  = DOWN (canvas vertical; feet at ≈ +49 local units)
 *    +Z  = TOWARD THE CAMERA (out of the gameplay plane)
 *  Yaw ψ rotates around the vertical (+Y) axis and is applied as
 *    x' = x·cosψ + z·sinψ ;  z' = −x·sinψ + z·cosψ
 *  POSITIVE yaw swings a segment toward the camera / advances the NEAR
 *  side forward. All three axes carry meaning:
 *    X — gameplay reach, stride, weight transfer
 *    Y — height, COG, gravity, ground contact
 *    Z — depth articulation: shoulder counter-rotation, hip swivel, blade
 *        trajectories that pass near↔far, thrusts that spear the lens
 *
 * ── PROJECTION ─────────────────────────────────────────────────────────
 *  A mild perspective (focal F = 620 local units) projects the 3D joints
 *  onto the gameplay plane:  s = F/(F − z);  px = x·s;  py = y·s.
 *  Limb widths and weapon lengths scale by the same factor, and draw order
 *  + shading follow depth — rotation reads as foreshortening, near limbs
 *  widen/brighten, far limbs thin/darken, the blade visibly recedes and
 *  pierces. The gameplay plane itself sits at z = 0 (enemies, hitboxes,
 *  ground): a z=0 segment projects 1:1, so 2D gameplay logic is unchanged
 *  and the VISIBLE blade IS the hitbox (both are the projected segment).
 *
 * ── SOLVE ──────────────────────────────────────────────────────────────
 *  solveFighter3D extends the classic channel solve with the depth
 *  channels (pose.ts 17–25):
 *    pelvisYaw  — rotates the femur-head sockets; near leg advances
 *    chestYaw   — rotates the shoulder girdle on top of the pelvis
 *                 fraction (shoulder↔hip COUNTER-rotation, the 3D torso
 *                 twist read)
 *    hipLz/hipRz, armLz/armRz — per-limb yaw DOFs
 *    bladeYaw   — blade tip toward/away from camera (out-of-plane cuts)
 *    bladeZ     — grip translated along Z (thrust depth travel)
 */

import { drawHumanoid } from './humanoid'
import { CH, Pose } from './pose'
import { SkelSpec, StickStyle } from './skeleton'
import { clamp, clamp01 } from '../core/utils'

/** perspective focal length in character-local units */
export const FOCUS = 620

/** a solved joint: px/py = PROJECTED position, z = depth (local units) */
export interface J3 {
  x: number
  y: number
  z: number
}

export interface FighterGeom {
  hip: J3
  hipPtR: J3
  hipPtL: J3
  waist: J3
  chest: J3
  neckTop: J3
  headC: J3
  headAng: number
  shoulderR: J3
  shoulderL: J3
  kneeL: J3
  ankleL: J3
  toeL: J3
  kneeR: J3
  ankleR: J3
  toeR: J3
  elbL: J3
  handL: J3
  elbR: J3
  handR: J3
  /** the weapon grip (hand translated by bladeZ along +Z) */
  grip: J3
  /** kissaki tip — full 3D (pitch from channel sum, yaw from bladeYaw) */
  tip: J3
  /** tsuka butt (pommel) — off-hand IK target */
  pommel: J3
  /** blade pitch in the sagittal plane (π/2 − channel sum — IK compatible) */
  bladeAngle: number
  /** blade yaw (depth plane rotation) */
  bladeYaw: number
  /** PROJECTED blade angle + length (what the eye and the hitbox see) */
  bladeProjAngle: number
  bladeProjLen: number
  /** normalized tip depth (−1..1): + = kissaki at the lens */
  bladeTipZ: number
  torsoAngle: number
  /** total girdle yaw (pelvis fraction + chest counter) — render/readout */
  girdleYaw: number
  pelvisYaw: number
}

const j = (): J3 => ({ x: 0, y: 0, z: 0 })

export function makeFighterGeom(): FighterGeom {
  return {
    hip: j(), hipPtR: j(), hipPtL: j(), waist: j(), chest: j(), neckTop: j(),
    headC: j(), headAng: 0, shoulderR: j(), shoulderL: j(),
    kneeL: j(), ankleL: j(), toeL: j(), kneeR: j(), ankleR: j(), toeR: j(),
    elbL: j(), handL: j(), elbR: j(), handR: j(),
    grip: j(), tip: j(), pommel: j(),
    bladeAngle: 0, bladeYaw: 0, bladeProjAngle: 0, bladeProjLen: 0, bladeTipZ: 0,
    torsoAngle: 0, girdleYaw: 0, pelvisYaw: 0,
  }
}

/** project: 3D local → (screen-plane local, depth scale kept in z) */
function proj(o: J3, x: number, y: number, z: number): void {
  const s = FOCUS / (FOCUS - z)
  o.x = x * s
  o.y = y * s
  o.z = z
}

/** limb direction from swing + yaw (see convention above) */
function limbDir(swing: number, yaw: number, out: { x: number; y: number; z: number }): void {
  const ss = Math.sin(swing)
  out.x = ss * Math.cos(yaw)
  out.y = Math.cos(swing)
  out.z = ss * Math.sin(yaw)
}

const dirScratch = { x: 0, y: 0, z: 0 }

/** FOREARM CARRYING ANGLE (valgus): the anatomically extended forearm
 * rides ~10–15° LATERAL of the humerus line. In the side-view rig this
 * reads as a small constant forearm-yaw bias that fades as the elbow
 * flexes (the angle collapses in flexion) — keeps two-handed katana grips
 * from reading as one rigid broomstick. */
const CARRY_VALGUS = 0.17

/**
 * Solve the full articulated fighter. The classic 2D channels drive the
 * sagittal plane; the depth channels rotate girdles/limbs out of it.
 * Output is fully PROJECTED (x, y) with depth in z.
 */
export function solveFighter3D(pose: Pose, spec: SkelSpec, out: FighterGeom, bladeLen: number, swingScale = 1): FighterGeom {
  const rot = pose[CH.rootRot]
  const spine = pose[CH.spine]
  const head = pose[CH.head]
  const rootZ = pose[CH.rootZ]
  const pelvisYaw = pose[CH.pelvisYaw]
  const chestYaw = pose[CH.chestYaw]
  const girdleYaw = pelvisYaw * 0.35 + chestYaw
  out.pelvisYaw = pelvisYaw
  out.girdleYaw = girdleYaw

  const cpsi = Math.cos(pelvisYaw)
  const spsi = Math.sin(pelvisYaw)
  const cgi = Math.cos(girdleYaw)
  const sgi = Math.sin(girdleYaw)

  // ---- SPINE: hip → waist → chest, with the rotation bow ----
  const hipX = pose[CH.rootX]
  const hipY = pose[CH.rootY]
  const t1 = rot
  const t2 = rot + spine
  // lumbar: carries a fraction of the pelvis yaw (the twist starts low)
  const waistBow = Math.sin(pelvisYaw) * 1.5
  const waistX = hipX + Math.sin(t1) * spec.torso * 0.57 + waistBow * 0.4
  const waistY = hipY - Math.cos(t1) * spec.torso * 0.57
  const waistZ = rootZ + Math.sin(pelvisYaw) * 1.2
  // thoracic: bows INTO the chest rotation (counter-rotation lean read)
  const chestBow = Math.sin(girdleYaw) * 1.6
  const chestX = waistX + Math.sin(t2) * spec.torso * 0.43 + chestBow * 0.5
  const chestY = waistY - Math.cos(t2) * spec.torso * 0.43
  const chestZ = waistZ + Math.sin(girdleYaw) * 1.1
  out.torsoAngle = t2

  // ---- neck + skull (head counter-yaws a fraction — eyes stay on target) ----
  // THE READABLE NECK: the skull seats headR·1.05 above the atlas (the
  // jaw still overhangs the column's front-top — anatomy) and the column
  // itself is long enough that a clean band of neck shows between the
  // trapezius slopes and the skull at gameplay zoom. The old 0.9·headR
  // seating buried the column inside the head ellipse — "no neck, the
  // arms feel connected to the neck".
  const ha = t2 + head
  const headYaw = girdleYaw * 0.22
  const neckX = chestX + Math.sin(ha) * spec.neck + Math.sin(headYaw) * 0.8
  const neckY = chestY - Math.cos(ha) * spec.neck
  const neckZ = chestZ + Math.sin(headYaw) * 1.6
  const headX = neckX + Math.sin(ha) * spec.headR * 1.05 + Math.sin(headYaw) * 1.4
  const headY = neckY - Math.cos(ha) * spec.headR * 1.05
  const headZ = neckZ + Math.sin(headYaw) * 2.2

  // ---- SHOULDER GIRDLE: offsets rotated by girdleYaw around the spine ----
  // Biacromial half-width ±0.10H (Drillis–Contini): shZ 9.2 gives the
  // recomposed bulkier girdle a REAL coronal depth spread — the projected
  // shoulder line visibly foreshortens as the chest yaws (THE
  // transverse-plane torso read), and the wider sockets carry the 5.15
  // deltoid caps without burying them in the ribcage.
  const sf = spec.shoulderFwd
  const sd = spec.shoulderDrop
  const shZ = 9.2
  // near shoulder (sword side): (sf, sd, +shZ) rotated
  const shRx = chestX + sf * cgi + shZ * sgi
  const shRy = chestY + sd
  const shRz = chestZ - sf * sgi + shZ * cgi
  // far shoulder: (−sf·0.62, sd·1.18, −shZ·0.92) rotated — slightly narrower
  // far socket (the thoracic cage occludes the far clavicle)
  const sfL = -sf * 0.62
  const sdL = sd * 1.18
  const shLx = chestX + sfL * cgi - shZ * 0.92 * sgi
  const shLy = chestY + sdL
  const shLz = chestZ - sfL * sgi - shZ * 0.92 * cgi

  // ---- FEMUR HEADS: sockets rotated by pelvisYaw ----
  const fhR = 2.3
  const fhL = -2.3
  const hpRx = hipX + 1.7 * cpsi + fhR * spsi
  const hpRy = hipY
  const hpRz = rootZ - 1.7 * spsi + fhR * cpsi
  const hpLx = hipX - 2.1 * cpsi + fhL * spsi
  const hpLy = hipY
  const hpLz = rootZ + 2.1 * spsi + fhL * cpsi

  // ---- LEGS (per-leg yaw inherits a pelvis fraction — hip swivel read) ----
  solveLeg(out.kneeL, out.ankleL, out.toeL, hpLx, hpLy, hpLz, pose[CH.hipL], pose[CH.kneeL], pose[CH.footL], spec, pose[CH.hipLz] - pelvisYaw * 0.35)
  solveLeg(out.kneeR, out.ankleR, out.toeR, hpRx, hpRy, hpRz, pose[CH.hipR], pose[CH.kneeR], pose[CH.footR], spec, pose[CH.hipRz] + pelvisYaw * 0.35)

  // ---- ARMS (shoulder yaw inherits the girdle rotation; the forearm adds
  // its OWN elbow-pivot yaw — the pronation DOF that lets the hand lead
  // through depth while the elbow trails in another plane entirely) ----
  // GIRDLE INHERITANCE CAP (the "dead arm" silhouette guard): the inherited
  // fraction of the girdle yaw is bounded ±0.28 rad. Gait layers stacked
  // authored arm yaw + carry + full inheritance to ~−0.44 total at sprint —
  // the forearm's projected direction became ~47% depth, so a deeply bent
  // elbow (interior 111°) PROJECTED to a straight horizontal stub. Attacks
  // write their own armRz directly (the 3D-cut read, up to ±1.35) and are
  // untouched by this cap; only the torso-twist inheritance is bounded.
  const armYawInherit = clamp(girdleYaw, -0.62, 0.62) * 0.45
  const foreYawInherit = clamp(girdleYaw, -0.62, 0.62) * 0.2
  solveArm(out.elbL, out.handL, shLx, shLy, shLz, pose[CH.shL], pose[CH.elL], spec,
    pose[CH.armLz] + armYawInherit, pose[CH.foreLz] + foreYawInherit, -CARRY_VALGUS)
  solveArm(out.elbR, out.handR, shRx, shRy, shRz, pose[CH.shR], pose[CH.elR], spec,
    pose[CH.armRz] + armYawInherit, pose[CH.foreRz] + foreYawInherit, CARRY_VALGUS)

  // ---- PROJECT the core joints ----
  proj(out.hip, hipX, hipY, rootZ)
  proj(out.waist, waistX, waistY, waistZ)
  proj(out.chest, chestX, chestY, chestZ)
  proj(out.neckTop, neckX, neckY, neckZ)
  proj(out.headC, headX, headY, headZ)
  out.headAng = ha
  proj(out.shoulderR, shRx, shRy, shRz)
  proj(out.shoulderL, shLx, shLy, shLz)
  proj(out.hipPtR, hpRx, hpRy, hpRz)
  proj(out.hipPtL, hpLx, hpLy, hpLz)

  // ---- WEAPON: pitch from channel sum, yaw from bladeYaw, grip from bladeZ ----
  const sum = pose[CH.shR] + pose[CH.elR] + pose[CH.wrR]
  out.bladeAngle = Math.PI / 2 - sum
  out.bladeYaw = pose[CH.bladeYaw]
  const gripZ = pose[CH.bladeZ]
  const gx = out.handR.x / (FOCUS / (FOCUS - out.handR.z)) // unproject hand x
  const gy = out.handR.y / (FOCUS / (FOCUS - out.handR.z))
  proj(out.grip, gx, gy, out.handR.z + gripZ)
  // blade 3D direction: sagittal pitch rotated by yaw
  const ca = Math.cos(out.bladeAngle)
  const sa = Math.sin(out.bladeAngle)
  const byaw = out.bladeYaw
  const dx = ca * Math.cos(byaw)
  const dy = sa
  const dz = ca * Math.sin(byaw)
  const len = bladeLen * swingScale
  proj(out.tip, gx + dx * len, gy + dy * len, out.handR.z + gripZ + dz * len)
  proj(out.pommel, gx - dx * len * 0.3, gy - dy * len * 0.3, out.handR.z + gripZ - dz * len * 0.3)
  // projected blade metrics (what the eye + hitbox consume)
  out.bladeProjAngle = Math.atan2(out.tip.y - out.grip.y, out.tip.x - out.grip.x)
  out.bladeProjLen = Math.hypot(out.tip.x - out.grip.x, out.tip.y - out.grip.y)
  out.bladeTipZ = clamp(out.tip.z / 60, -1, 1)
  return out
}

function solveLeg(
  knee: J3, ankle: J3, toe: J3,
  hx: number, hy: number, hz: number,
  hipC: number, kneeC: number, footC: number,
  spec: SkelSpec, yaw: number,
): void {
  limbDir(hipC, yaw, dirScratch)
  const kx = hx + dirScratch.x * spec.thigh
  const ky = hy + dirScratch.y * spec.thigh
  const kz = hz + dirScratch.z * spec.thigh
  limbDir(hipC + kneeC, yaw, dirScratch)
  const ax = kx + dirScratch.x * spec.shin
  const ay = ky + dirScratch.y * spec.shin
  const az = kz + dirScratch.z * spec.shin
  // foot: heel/toe flex in the leg's yaw plane (blended toward sagittal)
  const tf = Math.PI / 2 + (hipC + kneeC) * 0.35 + footC * 0.5
  limbDir(tf, yaw * 0.7, dirScratch)
  const tx = ax + dirScratch.x * spec.foot
  const ty = ay + dirScratch.y * spec.foot
  const tz = az + dirScratch.z * spec.foot
  proj(knee, kx, ky, kz)
  proj(ankle, ax, ay, az)
  proj(toe, tx, ty, tz)
}

/** The arm solver — now genuinely 3-segment in depth:
 * upper arm in the shoulder's yaw plane, forearm in its OWN plane
 * (shoulder yaw + forearm yaw + valgus bias that decays with flexion). */
function solveArm(
  elb: J3, hand: J3,
  sx: number, sy: number, sz: number,
  shC: number, elC: number,
  spec: SkelSpec, yaw: number, foreYaw: number, valgus: number,
): void {
  limbDir(shC, yaw, dirScratch)
  const ex = sx + dirScratch.x * spec.upperArm
  const ey = sy + dirScratch.y * spec.upperArm
  const ez = sz + dirScratch.z * spec.upperArm
  // carrying angle fades to zero as the elbow flexes past ~60°
  const flex = clamp01(1 - Math.abs(elC) / 1.05)
  const fYaw = yaw + foreYaw + valgus * flex
  limbDir(shC + elC, fYaw, dirScratch)
  const hx = ex + dirScratch.x * spec.foreArm
  const hy = ey + dirScratch.y * spec.foreArm
  const hz = ez + dirScratch.z * spec.foreArm
  // Anatomical elbow pole: preserve the authored/weapon-constrained HAND
  // target, but solve the elbow behind/below the reach line. Previously
  // a negative flexion channel could put the elbow forward and the hand
  // trailing, producing the backwards forearm seen in locomotion.
  // Sphere-intersection IK preserves both 3D bone lengths and grip position.
  const dx = hx - sx, dy = hy - sy, dz = hz - sz
  const distance = Math.hypot(dx, dy, dz)
  if (distance > 1e-5) {
    const ux = dx / distance, uy = dy / distance, uz = dz / distance
    const along = (spec.upperArm**2 - spec.foreArm**2 + distance**2) / (2 * distance)
    const height = Math.sqrt(Math.max(0, spec.upperArm**2 - along**2))
    const side = sz >= 0 ? .18 : -.18
    const dot = -ux + .35 * uy + side * uz
    let px = -1 - dot * ux, py = .35 - dot * uy, pz = side - dot * uz
    let plen = Math.hypot(px, py, pz)
    if (plen < 1e-5) { px = -uy; py = ux; pz = 0; plen = Math.hypot(px, py) || 1 }
    proj(elb, sx + ux * along + px / plen * height,
      sy + uy * along + py / plen * height, sz + uz * along + pz / plen * height)
  } else {
    proj(elb, ex, ey, ez)
  }
  proj(hand, hx, hy, hz)
}

/* ------------------------------------------------------------------ */
/* 3D ARM IK — solves (sh, el, yaw) so the hand reaches a 3D target    */
/* ------------------------------------------------------------------ */

/** Solve arm channels for a 3D hand target (character-local, relative to
 * the shoulder). Returns swing/elbow/yaw channel values; elbow bends
 * anatomically (down/back). Used by the 3D sword-arc solver.
 *
 * ANATOMICAL CLAMPS: the target is clamped to [0.30, 0.93] of the arm's
 * full length and the solved elbow holds ≥15° flexion — a hand at 0.985×
 * reach solved the joint to ~169° interior (a locked-straight "dislocated"
 * elbow: "no human turns his elbow past 170°"), and a fully-folded target
 * inverted the hinge. The 7% reach surrender is invisible at gameplay
 * zoom; the straight-arm read was not. */
export function ikArm3D(
  tx: number, ty: number, tz: number, // target rel. shoulder
  upper: number, fore: number,
): { sh: number; el: number; yaw: number; reach: number } {
  const dx = tx
  const dy = ty
  const dz = tz
  const d = Math.hypot(dx, dy, dz) || 1e-4
  const armLen = upper + fore
  const r = clamp(d, armLen * 0.3, armLen * 0.93)
  const reach = r / armLen
  // planar projection onto (radial-horizontal, vertical)
  const rh = Math.hypot(dx, dz)
  const rawYaw = rh > 1e-4 ? Math.atan2(dz, dx) : 0
  // martial constraint: tuck elbows close to ribcage, prevent outward abduction
  const yaw = clamp(rawYaw, -0.65, 0.65)
  // law of cosines in the sagittal-style plane
  const cosB = clamp((upper * upper + r * r - fore * fore) / (2 * upper * r), -1, 1)
  const B = Math.acos(cosB)
  const base = Math.atan2(rh, dy) // angle from straight-down toward the target
  const sh = base + B
  // elbow angle: forearm vs upper arm in the same plane — flexion side
  // (negative channel) only, 15°..150° interior band
  const cosE = clamp((upper * upper + fore * fore - r * r) / (2 * upper * fore), -1, 1)
  const el = clamp(-(Math.PI - Math.acos(cosE)), -2.62, -0.26)
  return { sh, el, yaw, reach }
}

/* ------------------------------------------------------------------ */
/* DEPTH-SHADED FIGHTER RENDERER                                       */
/* ------------------------------------------------------------------ */

export interface FighterDrawOpts {
  motionEnergy?: number
  hands?: import('./hand-gestures').HandGestures
  /** Contour-only rim, never interior bone strokes. */
  rimColor?: string
  rimAlpha?: number
  /** Tinted surface echo; shares the live ronin anatomy, never a stick rig. */
  ghost?: string
  ghostAlpha?: number
  alpha?: number
  time?: number
  flash?: number
  flashColor?: string
  simple?: boolean
  edgeLight?: { color: string; a: number }
  /** colored fill from a nearby practical light (look.emitterFill) */
  /** colored fills from nearby practicals (look.emitterFills) — one tap
   *  per source so light lands on the side facing EACH emitter */
  sideFills?: { color: string; a: number; dx: number }[]
  /** face sign + context scale of the caller's transform — world-space tap
   *  offsets must be un-flipped/un-scaled or lighting lands on the wrong
   *  side of a left-facing figure */
  flipX?: number
  unit?: number
  scarfNodes?: ReadonlyArray<{ x: number; y: number }>
  scarfColor?: string
}

/** The old capsule-and-joint-cap renderer has been deleted. */
export const drawFighter3D = drawHumanoid
