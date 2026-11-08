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

import { CH, Pose } from './pose'
import { SkelSpec, StickStyle } from './skeleton'
import { clamp, clamp01, lerp, rgba, smoothstep } from '../core/utils'

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
  const ha = t2 + head
  const headYaw = girdleYaw * 0.22
  const neckX = chestX + Math.sin(ha) * spec.neck + Math.sin(headYaw) * 0.8
  const neckY = chestY - Math.cos(ha) * spec.neck
  const neckZ = chestZ + Math.sin(headYaw) * 1.6
  const headX = neckX + Math.sin(ha) * spec.headR * 0.9 + Math.sin(headYaw) * 1.4
  const headY = neckY - Math.cos(ha) * spec.headR * 0.9
  const headZ = neckZ + Math.sin(headYaw) * 2.2

  // ---- SHOULDER GIRDLE: offsets rotated by girdleYaw around the spine ----
  // Biacromial half-width ±0.10H (Drillis–Contini): shZ 8 gives the girdle
  // a REAL coronal depth spread — the projected shoulder line visibly
  // foreshortens as the chest yaws (THE transverse-plane torso read).
  const sf = spec.shoulderFwd
  const sd = spec.shoulderDrop
  const shZ = 8
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
  solveArm(out.elbL, out.handL, shLx, shLy, shLz, pose[CH.shL], pose[CH.elL], spec,
    pose[CH.armLz] + girdleYaw * 0.45, pose[CH.foreLz] + girdleYaw * 0.2, -CARRY_VALGUS)
  solveArm(out.elbR, out.handR, shRx, shRy, shRz, pose[CH.shR], pose[CH.elR], spec,
    pose[CH.armRz] + girdleYaw * 0.45, pose[CH.foreRz] + girdleYaw * 0.2, CARRY_VALGUS)

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
  proj(elb, ex, ey, ez)
  proj(hand, hx, hy, hz)
}

/* ------------------------------------------------------------------ */
/* 3D ARM IK — solves (sh, el, yaw) so the hand reaches a 3D target    */
/* ------------------------------------------------------------------ */

/** Solve arm channels for a 3D hand target (character-local, relative to
 * the shoulder). Returns swing/elbow/yaw channel values; elbow bends
 * anatomically (down/back). Used by the 3D sword-arc solver. */
export function ikArm3D(
  tx: number, ty: number, tz: number, // target rel. shoulder
  upper: number, fore: number,
): { sh: number; el: number; yaw: number; reach: number } {
  const dx = tx
  const dy = ty
  const dz = tz
  const d = Math.hypot(dx, dy, dz) || 1e-4
  const r = Math.min(d, (upper + fore) * 0.985)
  const reach = r / (upper + fore)
  // planar projection onto (radial-horizontal, vertical)
  const rh = Math.hypot(dx, dz)
  const yaw = rh > 1e-4 ? Math.atan2(dz, dx) : 0
  // law of cosines in the sagittal-style plane
  const cosB = clamp((upper * upper + r * r - fore * fore) / (2 * upper * r), -1, 1)
  const B = Math.acos(cosB)
  const base = Math.atan2(rh, dy) // angle from straight-down toward the target
  const sh = base + B
  // elbow angle: forearm vs upper arm in the same plane
  const cosE = clamp((upper * upper + fore * fore - r * r) / (2 * upper * fore), -1, 1)
  const el = -(Math.PI - Math.acos(cosE))
  return { sh, el, yaw, reach }
}

/* ------------------------------------------------------------------ */
/* DEPTH-SHADED FIGHTER RENDERER                                       */
/* ------------------------------------------------------------------ */

export interface FighterDrawOpts {
  alpha?: number
  time?: number
  flash?: number
  flashColor?: string
  simple?: boolean
  edgeLight?: { color: string; a: number }
}

/** width scale from depth: near limbs thicken, far limbs thin */
function zScale(z: number): number {
  return FOCUS / (FOCUS - clamp(z, -90, 90))
}

function fillTaper3(
  ctx: CanvasRenderingContext2D,
  a: J3, b: J3,
  wa: number, wb: number,
  color: string,
  alpha = 1,
): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(a.x + nx * wa, a.y + ny * wa)
  ctx.lineTo(b.x + nx * wb, b.y + ny * wb)
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb)
  ctx.lineTo(a.x - nx * wa, a.y - ny * wa)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(a.x, a.y, wa, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(b.x, b.y, wb, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** blend two '#rrggbb' tones (t=0 → a, t=1 → b) — the stable limb depth
 * crossfade. Non-hex inputs fall back to a hard step (only hex styles
 * reach this path in practice). */
function mixHex(a: string, b: string, t: number): string {
  if (a.charCodeAt(0) !== 35 || b.charCodeAt(0) !== 35 || a.length < 7 || b.length < 7) return t > 0.5 ? b : a
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16)
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16)
  const r = (ar + (br - ar) * t + 0.5) | 0
  const gg = (ag + (bg - ag) * t + 0.5) | 0
  const bl = (ab + (bb - ab) * t + 0.5) | 0
  return '#' + ((1 << 24) | (r << 16) | (gg << 8) | bl).toString(16).slice(1)
}

function fillFoot3(
  ctx: CanvasRenderingContext2D,
  a: J3, b: J3,
  color: string,
  alpha = 1,
  k = 1,
): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(a.x + nx * 3.4 * k, a.y + ny * 3.4 * k)
  ctx.lineTo(b.x + nx * 2.5 * k, b.y + ny * 2.5 * k)
  ctx.lineTo(b.x - nx * 2.5 * k, b.y - ny * 2.5 * k)
  ctx.lineTo(a.x - nx * 3.4 * k, a.y - ny * 3.4 * k)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(a.x, a.y, 3.4 * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(b.x, b.y, 2.3 * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function fillFist3(
  ctx: CanvasRenderingContext2D,
  p: J3,
  ax: number, ay: number, // projected grip axis (unit)
  size: number,
  color: string,
  alpha = 1,
): void {
  const px = -ay
  const py = ax
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(p.x + px * size, p.y + py * size)
  ctx.lineTo(p.x + ax * size * 0.55 + px * size * 0.8, p.y + ay * size * 0.55 + py * size * 0.8)
  ctx.lineTo(p.x + ax * size * 0.55 - px * size * 0.8, p.y + ay * size * 0.55 - py * size * 0.8)
  ctx.lineTo(p.x - px * size, p.y - py * size)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(p.x, p.y, size * 0.92, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const LIMB = 5 // lineW base

/**
 * Draws the fighter in full 3D depth language, same silhouette style as
 * the classic renderer: rim → BEHIND limbs (depth shade) → torso + NECK →
 * FRONT limbs (near-black, halo-separated) → fists → head → flash.
 * Each limb's tone follows its OWN depth relative to the torso plane
 * (smoothstep crossfade — no near/far race, no color pop when limbs cross
 * in Z mid-stride). Anatomy reads: the neck column renders in the
 * back-plane shade between the trapezius slopes and the skull; front
 * limbs carry a rim halo so they read as limbs LAYERED on the black torso
 * (arms attach at the deltoid, never at the neck); rear hinge creases
 * mark the knees and elbows as JOINTS.
 */
export function drawFighter3D(
  ctx: CanvasRenderingContext2D,
  g: FighterGeom,
  style: StickStyle,
  opts: FighterDrawOpts = {},
): void {
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01) return
  const t = opts.time ?? 0
  const black = style.body
  const rim = style.outline
  const back = style.dark !== black ? style.dark : rgba(black, 0.82)
  const lineW = style.lineW

  // ---- depth sort keys (mid-joint means) ----
  const zTorso = (g.hip.z + g.waist.z + g.chest.z) / 3
  const zLegR = (g.hipPtR.z + g.kneeR.z + g.ankleR.z) / 3
  const zLegL = (g.hipPtL.z + g.kneeL.z + g.ankleL.z) / 3
  const zArmR = (g.shoulderR.z + g.elbR.z + g.handR.z) / 3
  const zArmL = (g.shoulderL.z + g.elbL.z + g.handL.z) / 3

  // ---- STABLE limb shading (the back-leg glitch fix) ----
  // Each limb's tone follows its OWN depth relative to the torso plane —
  // never a winner-takes-all race between the pair. The old binary near/far
  // swap flipped colors + widths in a single frame whenever the legs
  // crossed in Z mid-stride (the "glitching back leg"). A ±4-unit smoothstep
  // window around the torso plane crossfades the tone through crossings.
  const near01 = (z: number) => smoothstep((z - zTorso + 4) / 8)
  const legRn = near01(zLegR)
  const legLn = near01(zLegL)
  const armRn = near01(zArmR)
  const armLn = near01(zArmL)
  // limb draw sets — full PROPORTION PARITY per side: the far side loses
  // only 4% width (the old 10% + same-size feet read as a shrunken "fake
  // shadow" duplicate of the leg). Colors crossfade back-shade → black.
  const legR = { hip: g.hipPtR, knee: g.kneeR, ankle: g.ankleR, toe: g.toeR, z: zLegR, col: mixHex(back, black, legRn), k: lerp(0.96, 1, legRn), n: legRn }
  const legL = { hip: g.hipPtL, knee: g.kneeL, ankle: g.ankleL, toe: g.toeL, z: zLegL, col: mixHex(back, black, legLn), k: lerp(0.96, 1, legLn), n: legLn }
  const armR = { sh: g.shoulderR, elb: g.elbR, hand: g.handR, z: zArmR, col: mixHex(back, black, armRn), k: lerp(0.96, 1, armRn), n: armRn }
  const armL = { sh: g.shoulderL, elb: g.elbL, hand: g.handL, z: zArmL, col: mixHex(back, black, armLn), k: lerp(0.96, 1, armLn), n: armLn }
  // z-ascending order per pair: behind-limbs render before the torso
  const backLeg = zLegR <= zLegL ? legR : legL
  const frontLeg = zLegR <= zLegL ? legL : legR
  const backArm = zArmR <= zArmL ? armR : armL
  const frontArm = zArmR <= zArmL ? armL : armR

  // width factors from depth
  const wf = (z: number) => zScale(z)
  const nearK = 1 + Math.max(0, zTorso) * 0.004

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // ---- 0. rim pass ----
  if (!opts.simple) {
    ctx.save()
    ctx.globalAlpha *= 0.78
    ctx.strokeStyle = rim
    ctx.lineWidth = lineW + 3.6
    ctx.beginPath()
    ctx.moveTo(g.hipPtR.x, g.hipPtR.y); ctx.lineTo(g.kneeR.x, g.kneeR.y); ctx.lineTo(g.ankleR.x, g.ankleR.y)
    ctx.moveTo(g.hipPtL.x, g.hipPtL.y); ctx.lineTo(g.kneeL.x, g.kneeL.y); ctx.lineTo(g.ankleL.x, g.ankleL.y)
    ctx.moveTo(g.shoulderR.x, g.shoulderR.y); ctx.lineTo(g.elbR.x, g.elbR.y); ctx.lineTo(g.handR.x, g.handR.y)
    ctx.moveTo(g.shoulderL.x, g.shoulderL.y); ctx.lineTo(g.elbL.x, g.elbL.y); ctx.lineTo(g.handL.x, g.handL.y)
    ctx.stroke()
    ctx.lineWidth = (lineW + 3.6) * 1.5
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
    ctx.lineTo(g.waist.x, g.waist.y)
    ctx.lineTo(g.chest.x, g.chest.y)
    ctx.lineTo(g.neckTop.x, g.neckTop.y)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 1. BEHIND limbs (depth-shaded, full proportion parity: same base
  // widths as the front side — deltoid .055H → elbow .035H → wrist .020H —
  // only the TONE and a 4% width whisper mark the depth) ----
  {
    const L = backLeg
    const w = wf(L.z) * L.k
    fillTaper3(ctx, L.hip, L.knee, 6.5 * w, 4.7 * w, L.col)
    fillTaper3(ctx, L.knee, L.ankle, 4.4 * w, 2.9 * w, L.col)
    fillFoot3(ctx, L.ankle, L.toe, L.col, 1, L.k * wf(L.z))
    ctx.fillStyle = L.col
    ctx.beginPath()
    ctx.arc(L.knee.x, L.knee.y, 4.6 * w, 0, Math.PI * 2)
    ctx.fill()
  }
  {
    const A = backArm
    const w = wf(A.z) * A.k
    ctx.fillStyle = A.col
    ctx.beginPath()
    ctx.arc(A.sh.x, A.sh.y, 5.6 * w, 0, Math.PI * 2)
    ctx.fill()
    fillTaper3(ctx, A.sh, A.elb, 5.7 * w, 3.6 * w, A.col)
    fillTaper3(ctx, A.elb, A.hand, 3.4 * w, 2.1 * w, A.col)
    ctx.beginPath()
    ctx.arc(A.elb.x, A.elb.y, 3.9 * w, 0, Math.PI * 2)
    ctx.fill()
  }

  // ---- 2. torso: pelvis basin → abdomen → ribcage → trapezius → NECK ----
  fillTaper3(ctx, g.hip, g.waist, 9.6 * wf(zTorso), 6.6 * wf(zTorso), black)
  // ribcage: widest at the mid-chest line, 9.4 at the top (the old 10.4
  // end-cap swallowed the ENTIRE neck column — the "head fused to torso"
  // read; the deltoid caps + trapezius now own the shoulder-line width)
  fillTaper3(ctx, g.waist, g.chest, 6.6 * wf(zTorso), 9.4 * wf(zTorso), black)
  // trapezius: out to BOTH deltoid caps — but its top vertices sit at the
  // neck MIDPOINT (30% up the column), NOT the atlas: the upper neck stays
  // clean so the neck reads as structure between skull and shoulders. The
  // projected shoulder line still foreshortens as the girdle yaws (THE 3D
  // torso read).
  {
    const ndx = g.neckTop.x - g.chest.x
    const ndy = g.neckTop.y - g.chest.y
    const nl = Math.hypot(ndx, ndy) || 1
    const px = -ndy / nl
    const py = ndx / nl
    const k = 0.3
    const tx = g.chest.x + ndx * k
    const ty = g.chest.y + ndy * k
    ctx.fillStyle = black
    ctx.beginPath()
    ctx.moveTo(tx + px * 3.0, ty + py * 3.0)
    ctx.lineTo(tx - px * 3.0, ty - py * 3.0)
    ctx.lineTo(g.shoulderL.x - px * 3.4, g.shoulderL.y - py * 3.4)
    ctx.lineTo(g.shoulderL.x + px * 4.8, g.shoulderL.y + py * 4.8)
    ctx.lineTo(g.shoulderR.x - px * 5.2, g.shoulderR.y - py * 5.2)
    ctx.lineTo(g.shoulderR.x + px * 5.8, g.shoulderR.y + py * 5.8)
    ctx.closePath()
    ctx.fill()
  }
  // THE VISIBLE NECK — in the back-plane shade (the same depth tone as the
  // far limbs): a real column rising from between the trapezius slopes to
  // the skull base. Anatomy: the chin overhangs the column's front-top in
  // profile (the skull seats on the atlas BEHIND the jaw) — the head pass
  // draws over the top of this column, and the jaw crease below marks the
  // separation.
  fillTaper3(ctx, g.chest, g.neckTop, 5.0, 3.6, back)
  if (!opts.simple) {
    // rear cervical line — a whisper of rim so the column keeps its spine
    const ndx = g.neckTop.x - g.chest.x
    const ndy = g.neckTop.y - g.chest.y
    const nl = Math.hypot(ndx, ndy) || 1
    const px = -ndy / nl
    const py = ndx / nl
    ctx.strokeStyle = rgba(rim, 0.42)
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.moveTo(g.chest.x - px * 4.4, g.chest.y - py * 4.4)
    ctx.lineTo(g.neckTop.x - px * 3.0, g.neckTop.y - py * 3.0)
    ctx.stroke()
  }

  // ---- 3. FRONT limbs (over the torso) with SEPARATION HALO ----
  // The halo is a rim capsule ~1.3 wider UNDER the limb's own fill: a light
  // edge peeks around the silhouette, so the limb reads as a LAYERED arm
  // attached at the deltoid — not a growth of the black torso mass (the
  // old 0.34-alpha whisper line was invisible at gameplay zoom, and the
  // arm's emergence point read at the neck). Halo strength follows the
  // limb's nearness → fades smoothly at depth crossings.
  {
    const L = frontLeg
    const w = wf(L.z) * L.k * nearK
    const ha = 0.5 * L.n
    if (!opts.simple && ha > 0.04) {
      fillTaper3(ctx, L.hip, L.knee, 6.5 * w + 1.3, 4.7 * w + 1.2, rim, ha)
      fillTaper3(ctx, L.knee, L.ankle, 4.4 * w + 1.2, 2.9 * w + 1.1, rim, ha)
    }
    fillTaper3(ctx, L.hip, L.knee, 6.5 * w, 4.7 * w, L.col)
    fillTaper3(ctx, L.knee, L.ankle, 4.4 * w, 2.9 * w, L.col)
    fillFoot3(ctx, L.ankle, L.toe, L.col, 1, L.k * wf(L.z) * nearK)
    ctx.fillStyle = L.col
    ctx.beginPath()
    ctx.arc(L.knee.x, L.knee.y, 4.6 * w, 0, Math.PI * 2)
    ctx.fill()
  }
  {
    const A = frontArm
    const w = wf(A.z) * A.k * nearK
    const ha = 0.55 * A.n
    if (!opts.simple && ha > 0.04) {
      fillTaper3(ctx, A.sh, A.elb, 5.7 * w + 1.4, 3.6 * w + 1.3, rim, ha)
      fillTaper3(ctx, A.elb, A.hand, 3.4 * w + 1.2, 2.1 * w + 1.1, rim, ha)
    }
    ctx.fillStyle = A.col
    ctx.beginPath()
    ctx.arc(A.sh.x, A.sh.y, 5.9 * w, 0, Math.PI * 2)
    ctx.fill()
    fillTaper3(ctx, A.sh, A.elb, 5.7 * w, 3.6 * w, A.col)
    fillTaper3(ctx, A.elb, A.hand, 3.4 * w, 2.1 * w, A.col)
    ctx.beginPath()
    ctx.arc(A.elb.x, A.elb.y, 3.9 * w, 0, Math.PI * 2)
    ctx.fill()
    // DELTOID RING — the explicit shoulder anchor: a rim arc around the
    // glenohumeral cap that says "the arm starts HERE" (the elbow ring
    // lower down was being misread as the attachment point in review)
    if (!opts.simple) {
      ctx.strokeStyle = rgba(rim, 0.32 + 0.3 * A.n)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(A.sh.x, A.sh.y, 5.9 * w + 0.7, Math.PI * 0.55, Math.PI * 1.45)
      ctx.stroke()
    }
  }
  // ---- 3.5 HINGE CREASES — a rear arc on every knee + elbow cap: the
  // joints read as JOINTS (bends articulate) instead of rubber-hose tubes
  if (!opts.simple) {
    ctx.save()
    ctx.strokeStyle = rim
    ctx.lineWidth = 1.3
    for (const L of [backLeg, frontLeg]) {
      const w = wf(L.z) * L.k
      ctx.globalAlpha *= 0.28 + 0.34 * L.n
      ctx.beginPath()
      ctx.arc(L.knee.x, L.knee.y, 4.6 * w + 0.9, Math.PI * 0.62, Math.PI * 1.38)
      ctx.stroke()
      ctx.globalAlpha /= 0.28 + 0.34 * L.n
    }
    for (const A of [backArm, frontArm]) {
      const w = wf(A.z) * A.k
      ctx.globalAlpha *= 0.34 + 0.4 * A.n
      ctx.beginPath()
      ctx.arc(A.elb.x, A.elb.y, 3.9 * w + 0.85, Math.PI * 0.6, Math.PI * 1.4)
      ctx.stroke()
      ctx.globalAlpha /= 0.34 + 0.4 * A.n
    }
    ctx.restore()
  }

  // ---- 4. fists on the projected blade axis ----
  const bax = Math.cos(g.bladeProjAngle)
  const bay = Math.sin(g.bladeProjAngle)
  // off-hand fist — follows its own arm's depth tone (stable blend)
  fillFist3(ctx, g.handL, bax, bay, 2.9, armL.col)
  // sword fist — ON the grip (follows bladeZ thrust travel), toned with
  // its arm so a depth-swung sword arm never pops a pure-black fist
  fillFist3(ctx, g.grip, bax, bay, 3.4 * wf(g.grip.z), armR.col)
  if (!opts.simple) {
    ctx.save()
    ctx.strokeStyle = rgba(rim, 0.55)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(g.grip.x, g.grip.y, 3.6 * wf(g.grip.z), -1.2, 0.9)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 4.5 BLADE-CAST RIM LIGHT ----
  const el = opts.edgeLight
  if (el && el.a > 0.03) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.strokeStyle = rgba(el.color, Math.min(0.85, el.a))
    ctx.lineWidth = 2
    // sword arm chain — whichever side it's on
    ctx.beginPath()
    ctx.moveTo(g.shoulderR.x, g.shoulderR.y)
    ctx.lineTo(g.elbR.x, g.elbR.y)
    ctx.lineTo(g.grip.x, g.grip.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(g.hip.x + 5.2, g.hip.y - 1)
    ctx.quadraticCurveTo(g.waist.x + 6.5, g.waist.y - 1, g.chest.x + 8.2, g.chest.y + 1.5)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(g.hipPtR.x + 4.4, g.hipPtR.y + 1)
    ctx.lineTo(g.kneeR.x + 3.4, g.kneeR.y - 1)
    ctx.stroke()
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(g.handL.x, g.handL.y, 2.6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 5. head ----
  ctx.save()
  ctx.fillStyle = black
  ctx.translate(g.headC.x, g.headC.y)
  ctx.rotate(g.headAng * 0.35)
  ctx.beginPath()
  ctx.ellipse(0, -0.4, 8.2, 9.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(2.6, 5.6)
  ctx.quadraticCurveTo(1.2, 8.6, -1.8, 8.2)
  ctx.quadraticCurveTo(-4.2, 7.6, -4.6, 4.4)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-2.0, -8.2)
  ctx.quadraticCurveTo(-7.5, -12.6, -12.6, -9.4)
  ctx.quadraticCurveTo(-8.8, -6.4, -5.2, -5.2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  if (!opts.simple) {
    ctx.save()
    ctx.strokeStyle = rgba(rim, 0.5)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(g.headC.x - 1.5, g.headC.y - 0.5, 8.6, Math.PI * 0.62, Math.PI * 1.32)
    ctx.stroke()
    // jaw line — the chin edge that separates skull from the neck column
    // (anatomy: the mandible overhangs the cervical column's front in
    // profile; this crease is what makes the neck read as NECK)
    ctx.strokeStyle = rgba(rim, 0.5)
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.arc(g.headC.x + 0.6, g.headC.y - 0.5, 8.3, Math.PI * 0.08, Math.PI * 0.52)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 6. glowing eyes ----
  if (!opts.simple) {
    const blink = 0.85 + 0.15 * Math.sin(t * 3.1)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rgba(style.glow, 0.95 * blink)
    ctx.beginPath()
    ctx.ellipse(g.headC.x + 3.4, g.headC.y - 1.4, 2.0, 1.15, -0.18, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(g.headC.x + 6.4, g.headC.y - 2.2, 1.25, 0.9, -0.18, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ---- 7. hit flash ----
  const flash = clamp01(opts.flash ?? 0)
  if (flash > 0.02) {
    const fc = opts.flashColor ?? '#ffffff'
    const flw = wf(frontLeg.z) * frontLeg.k * nearK
    const faw = wf(frontArm.z) * frontArm.k * nearK
    fillTaper3(ctx, frontLeg.hip, frontLeg.knee, 6.5 * flw, 4.7 * flw, fc, flash)
    fillTaper3(ctx, frontLeg.knee, frontLeg.ankle, 4.4 * flw, 2.9 * flw, fc, flash)
    fillTaper3(ctx, backLeg.hip, backLeg.knee, 6.5 * wf(backLeg.z) * backLeg.k, 4.7 * wf(backLeg.z) * backLeg.k, fc, flash * 0.8)
    fillTaper3(ctx, frontArm.sh, frontArm.elb, 5.7 * faw, 3.6 * faw, fc, flash)
    fillTaper3(ctx, frontArm.elb, frontArm.hand, 3.4 * faw, 2.5 * faw, fc, flash)
    fillTaper3(ctx, g.waist, g.chest, 6.6, 9.4, fc, flash)
    fillTaper3(ctx, g.hip, g.waist, 9.6, 6.6, fc, flash)
    ctx.fillStyle = fc
    ctx.save()
    ctx.globalAlpha *= flash
    ctx.beginPath()
    ctx.ellipse(g.headC.x, g.headC.y - 0.4, 8.2, 9.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
  void LIMB
}
