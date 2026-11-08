/** STICKMAN RISING — skeleton solver + articulated stickman renderer.
 *
 * Solves joint positions from a Pose, then renders a layered, readable,
 * cybernetic stickman: dark outline pass → back limbs → torso → front limbs →
 * joints/head/armor. Supports ghost mode (afterimages) and hit-flash overlays.
 */

import { Pose } from './pose'
import { clamp01, rgba } from '../core/utils'

export interface Vec2 {
  x: number
  y: number
}

export interface SkelSpec {
  torso: number
  /** visible neck column: shoulder-line (C7) → skull base (atlas) */
  neck: number
  headR: number
  /** glenohumeral joint forward of the spine-top, along the torso frame */
  shoulderFwd: number
  /** glenohumeral joint below the shoulder line, along the torso frame */
  shoulderDrop: number
  upperArm: number
  foreArm: number
  hand: number
  thigh: number
  shin: number
  foot: number
  blade: number
}

/** ANATOMICAL PROPORTION SYSTEM — 8-head canon adapted to a silhouette
 * fighter (H ≈ 104 local units ≈ 137px at SCALE 1.32). Every joint offset
 * below derives from this table; nothing is placed by eye:
 *
 *   region            fraction    local units
 *   ──────────────────────────────────────────────
 *   skull height      1.28 head   17.6 (r 8.8 — stylized readability)
 *   neck column       0.35 head    4.6 (C7 → skull base)
 *   hip→shoulder line 0.355 H     37   (waist split 0.57/0.43)
 *   femur head offset             ±~2  (front hip +1.7, rear −2.1)
 *   glenohumeral jt   0.031 H      3.2 fwd × 3.3 drop (near shoulder)
 *   humerus           0.212 H      22
 *   forearm           0.160 H     16.6 (humerus:forearm = 1.33:1 — the
 *                                      Drillis–Contini intermembral ratio,
 *                                      upper end: joint caps + bent-arm
 *                                      foreshortening eat ~10% of the
 *                                      perceived humerus at render time)
 *   hand              0.062 H     6.5
 *   femur             0.24 H      25
 *   tibia             0.23 H      24   (femur:tibia = 1.04:1 ✓)
 *   foot length       0.10 H      10
 *   blade 56 ≈ 54% of height + tsuka ≈ 70% — legit long-katana read
 *
 * Leg chain 49 keeps HIP_H = 64 world EXACTLY stable (ground contact,
 * foot-lock and hitbox heights all depend on it). The arm chain 38.6 keeps
 * ~96% of the legacy reach envelope while restoring the true humerus:
 * forearm ratio (1.1:1 read as a gorilla forearm at silhouette scale).
 */
export const PLAYER_SPEC: SkelSpec = {
  torso: 37,
  neck: 5.6,
  headR: 8.8,
  shoulderFwd: 3.2,
  shoulderDrop: 3.3,
  upperArm: 22,
  foreArm: 16.6,
  hand: 6.5,
  thigh: 25,
  shin: 24,
  foot: 10,
  blade: 56,
}

export interface SkelGeom {
  hip: Vec2
  /** femur head, front leg (near side) */
  hipPtR: Vec2
  /** femur head, back leg (far side) */
  hipPtL: Vec2
  waist: Vec2
  chest: Vec2
  /** skull base (atlas joint) — top of the neck column */
  neckTop: Vec2
  headC: Vec2
  headAng: number
  /** glenohumeral joints — THE arm roots (anatomical) */
  shoulderR: Vec2
  shoulderL: Vec2
  kneeL: Vec2
  ankleL: Vec2
  toeL: Vec2
  kneeR: Vec2
  ankleR: Vec2
  toeR: Vec2
  elbL: Vec2
  handL: Vec2
  elbR: Vec2
  handR: Vec2
  bladeAngle: number // absolute angle of blade from hand, radians (0 = +X)
  torsoAngle: number
}

export function makeSkelGeom(): SkelGeom {
  const z = (): Vec2 => ({ x: 0, y: 0 })
  return {
    hip: z(), hipPtR: z(), hipPtL: z(), waist: z(), chest: z(), neckTop: z(),
    headC: z(), headAng: 0, shoulderR: z(), shoulderL: z(),
    kneeL: z(), ankleL: z(), toeL: z(),
    kneeR: z(), ankleR: z(), toeR: z(),
    elbL: z(), handL: z(), elbR: z(), handR: z(),
    bladeAngle: 0, torsoAngle: 0,
  }
}

/** Solve joint positions. Reuses `out`.
 *
 * SPINE CHAIN (four articulated regions, parented in order):
 *   hip → waist (pelvis/abdomen, 57% along `rot`) → chest (ribcage +
 *   shoulder line, 43% along `rot + spine`) → neck column (along the head
 *   channel) → skull. The waist joint makes the torso BEND instead of
 *   shear — the lumbar and thoracic curves separate.
 *
 * SHOULDER GIRDLE (the arms-from-the-neck fix): the glenohumeral joints
 * solve as chest + (shoulderFwd, shoulderDrop) in the chest's frame —
 * below the shoulder line and slightly anterior, like a real skeleton.
 * The far shoulder sits behind and lower (2.8D depth read). Arms chain
 * from THESE, never from the spine top.
 *
 * LEGS chain from offset femur-head joints (front hip slightly anterior,
 * rear hip behind) — the pelvis reads as a real basin, and stride scissor
 * from two distinct roots. */
export function solveSkeleton(pose: Pose, spec: SkelSpec, out: SkelGeom): SkelGeom {
  const rot = pose[2]
  const spine = pose[3]
  const head = pose[4]

  // spine: hip → waist → chest
  out.hip.x = pose[0]
  out.hip.y = pose[1]
  const t1 = rot
  out.waist.x = out.hip.x + Math.sin(t1) * spec.torso * 0.57
  out.waist.y = out.hip.y - Math.cos(t1) * spec.torso * 0.57
  const t2 = rot + spine
  out.chest.x = out.waist.x + Math.sin(t2) * spec.torso * 0.43
  out.chest.y = out.waist.y - Math.cos(t2) * spec.torso * 0.43
  out.torsoAngle = t2

  // neck column + skull — a REAL neck: full spec.neck of visible column
  // between the shoulder line and the skull base
  const ha = t2 + head
  out.neckTop.x = out.chest.x + Math.sin(ha) * spec.neck
  out.neckTop.y = out.chest.y - Math.cos(ha) * spec.neck
  out.headC.x = out.neckTop.x + Math.sin(ha) * spec.headR * 0.9
  out.headC.y = out.neckTop.y - Math.cos(ha) * spec.headR * 0.9
  out.headAng = ha

  // ---- SHOULDER GIRDLE: the arm roots ----
  // fwd(t) = (cos t, sin t); down-along-torso = (−sin t, cos t)
  const sf = spec.shoulderFwd
  const sd = spec.shoulderDrop
  out.shoulderR.x = out.chest.x + Math.cos(t2) * sf - Math.sin(t2) * sd
  out.shoulderR.y = out.chest.y + Math.sin(t2) * sf + Math.cos(t2) * sd
  const sfL = -sf * 0.62
  const sdL = sd * 1.18
  out.shoulderL.x = out.chest.x + Math.cos(t2) * sfL - Math.sin(t2) * sdL
  out.shoulderL.y = out.chest.y + Math.sin(t2) * sfL + Math.cos(t2) * sdL

  // ---- femur heads ----
  out.hipPtR.x = out.hip.x + Math.cos(t1) * 1.7
  out.hipPtR.y = out.hip.y + Math.sin(t1) * 1.7
  out.hipPtL.x = out.hip.x + Math.cos(t1) * -2.1
  out.hipPtL.y = out.hip.y + Math.sin(t1) * -2.1

  // legs (angle from straight-down, positive = forward)
  const hl = pose[5]
  const kl = pose[6]
  const fl = pose[7]
  out.kneeL.x = out.hipPtL.x + Math.sin(hl) * spec.thigh
  out.kneeL.y = out.hipPtL.y + Math.cos(hl) * spec.thigh
  const al = hl + kl
  out.ankleL.x = out.kneeL.x + Math.sin(al) * spec.shin
  out.ankleL.y = out.kneeL.y + Math.cos(al) * spec.shin
  // foot roll (Williams, Animator's Survival Kit): the toe defaults to FLAT
  // on the ground line; the foot channel is heel/toe flex (±) with a whisper
  // of shin influence so airborne tucks still point. Authoring foot angles
  // relative to the shin pointed the toe nearly straight down, planting
  // ~12px of rigid foot below the ground in every grounded pose.
  const tl = Math.PI / 2 + al * 0.35 + fl * 0.5
  out.toeL.x = out.ankleL.x + Math.sin(tl) * spec.foot
  out.toeL.y = out.ankleL.y + Math.cos(tl) * spec.foot

  const hr = pose[8]
  const kr = pose[9]
  const fr = pose[10]
  out.kneeR.x = out.hipPtR.x + Math.sin(hr) * spec.thigh
  out.kneeR.y = out.hipPtR.y + Math.cos(hr) * spec.thigh
  const ar = hr + kr
  out.ankleR.x = out.kneeR.x + Math.sin(ar) * spec.shin
  out.ankleR.y = out.kneeR.y + Math.cos(ar) * spec.shin
  const tr = Math.PI / 2 + ar * 0.35 + fr * 0.5
  out.toeR.x = out.ankleR.x + Math.sin(tr) * spec.foot
  out.toeR.y = out.ankleR.y + Math.cos(tr) * spec.foot

  // arms — FROM THE SHOULDERS (angle from straight-down, positive = forward)
  const sl = pose[11]
  const el = pose[12]
  out.elbL.x = out.shoulderL.x + Math.sin(sl) * spec.upperArm
  out.elbL.y = out.shoulderL.y + Math.cos(sl) * spec.upperArm
  const wl = sl + el
  out.handL.x = out.elbL.x + Math.sin(wl) * spec.foreArm
  out.handL.y = out.elbL.y + Math.cos(wl) * spec.foreArm

  const sr = pose[14]
  const er = pose[15]
  out.elbR.x = out.shoulderR.x + Math.sin(sr) * spec.upperArm
  out.elbR.y = out.shoulderR.y + Math.cos(sr) * spec.upperArm
  const wr = sr + er
  out.handR.x = out.elbR.x + Math.sin(wr) * spec.foreArm
  out.handR.y = out.elbR.y + Math.cos(wr) * spec.foreArm

  // blade: forearm direction rotated by wrist. forearm angle-from-+X = π/2 − (shR+elR);
  // positive wrist swings the tip toward facing (+X).
  out.bladeAngle = Math.PI / 2 - wr - pose[16]
  return out
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export interface StickStyle {
  body: string
  dark: string
  outline: string
  glow: string
  lineW: number
  headStyle: 'visor' | 'goggles' | 'drone' | 'helm' | 'grunt'
  armor: boolean
  core?: string
  visorAlpha?: number
  /** full black silhouette humanoid (player remodel): filled capsules,
   * tapered torso, glowing eyes — Limbo/INSIDE readability language */
  silhouette?: boolean
}

export const PLAYER_STYLE: StickStyle = {
  body: '#04060a',
  dark: '#24334d', // back-limb depth shade — bright enough to READ against
  // the pure-black mass at gameplay zoom (the old #131b28 vanished — the
  // far/lead leg “disappeared” into the body blob in sprint contact)
  outline: '#2c3a50',
  glow: '#41f6ff',
  lineW: 5,
  headStyle: 'visor',
  armor: false,
  silhouette: true,
}

export interface DrawOpts {
  alpha?: number
  time?: number
  flash?: number
  flashColor?: string
  /** ghost/afterimage mode: single flat color, no detail */
  ghost?: string
  ghostAlpha?: number
  /** skip outline+details (perf for far enemies) */
  simple?: boolean
  /** BLADE-CAST LIGHT: additive rim pass on the sword-side silhouette —
   * the swinging/charging edge illuminates the body that carries it */
  edgeLight?: { color: string; a: number }
}

function limb(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.lineTo(cx, cy)
  ctx.stroke()
}

/** Fills a foot wedge (ankle → toe) with heel/toe widths. */
function fillFoot(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, bx: number, by: number,
  color: string,
  alpha = 1,
): void {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(ax + nx * 3.4, ay + ny * 3.4)
  ctx.lineTo(bx + nx * 2.5, by + ny * 2.5)
  ctx.lineTo(bx - nx * 2.5, by - ny * 2.5)
  ctx.lineTo(ax - nx * 3.4, ay - ny * 3.4)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(ax, ay, 3.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(bx, by, 2.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Draws the stickman. The ctx is expected to be pre-translated to the hip
 * position, flipped horizontally for facing, and scaled — geom is local space.
 */
export function drawStick(
  ctx: CanvasRenderingContext2D,
  g: SkelGeom,
  style: StickStyle,
  opts: DrawOpts = {},
): void {
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01) return
  const t = opts.time ?? 0
  const ghost = opts.ghost
  const lineW = style.lineW

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (ghost) {
    // ---- afterimage pass: flat, cheap, gorgeous ----
    ctx.strokeStyle = ghost
    ctx.lineWidth = lineW * 0.85
    const ga = opts.ghostAlpha ?? 1
    ctx.globalAlpha *= ga
    limb(ctx, g.hipPtL.x, g.hipPtL.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
    limb(ctx, g.hipPtR.x, g.hipPtR.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
    limb(ctx, g.shoulderL.x, g.shoulderL.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)
    limb(ctx, g.shoulderR.x, g.shoulderR.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
    ctx.lineTo(g.waist.x, g.waist.y)
    ctx.lineTo(g.chest.x, g.chest.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(g.headC.x, g.headC.y, style === PLAYER_STYLE ? 8.8 : 8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }

  // ---- full-black humanoid silhouette (player) ----
  if (style.silhouette) {
    drawSilhouette(ctx, g, style, opts, t, lineW)
    ctx.restore()
    return
  }

  // ---- 1. outline pass (readability against the neon city) ----
  if (!opts.simple) {
    ctx.strokeStyle = style.outline
    ctx.lineWidth = lineW + 3.6
    limb(ctx, g.hipPtL.x, g.hipPtL.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
    limb(ctx, g.hipPtR.x, g.hipPtR.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
    limb(ctx, g.shoulderL.x, g.shoulderL.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)
    limb(ctx, g.shoulderR.x, g.shoulderR.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
    ctx.lineTo(g.waist.x, g.waist.y)
    ctx.lineTo(g.chest.x, g.chest.y)
    ctx.stroke()
  }

  // ---- 2. back limbs ----
  ctx.strokeStyle = style.dark
  ctx.lineWidth = lineW
  limb(ctx, g.hipPtL.x, g.hipPtL.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
  ctx.strokeStyle = rgba(style.dark, 0.82)
  limb(ctx, g.shoulderL.x, g.shoulderL.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)

  // ---- 3. torso (thicker, armored core) ----
  ctx.strokeStyle = style.body
  ctx.lineWidth = lineW * 1.42
  ctx.beginPath()
  ctx.moveTo(g.hip.x, g.hip.y)
  ctx.lineTo(g.waist.x, g.waist.y)
  ctx.lineTo(g.chest.x, g.chest.y)
  ctx.stroke()

  // ---- 4. front limbs ----
  ctx.strokeStyle = style.body
  ctx.lineWidth = lineW
  limb(ctx, g.hipPtR.x, g.hipPtR.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
  limb(ctx, g.shoulderR.x, g.shoulderR.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)

  // ---- 5. feet ----
  ctx.strokeStyle = style.body
  ctx.lineWidth = lineW * 0.72
  ctx.beginPath()
  ctx.moveTo(g.ankleR.x, g.ankleR.y)
  ctx.lineTo(g.toeR.x, g.toeR.y)
  ctx.moveTo(g.ankleL.x, g.ankleL.y)
  ctx.lineTo(g.toeL.x, g.toeL.y)
  ctx.stroke()

  // ---- 6. mechanical joints ----
  const jr = lineW * 0.52
  ctx.fillStyle = style.outline
  for (const j of [g.kneeL, g.kneeR, g.elbL, g.elbR]) {
    ctx.beginPath()
    ctx.arc(j.x, j.y, jr + 1.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = style.dark
  for (const j of [g.kneeL, g.kneeR, g.elbL, g.elbR]) {
    ctx.beginPath()
    ctx.arc(j.x, j.y, jr, 0, Math.PI * 2)
    ctx.fill()
  }
  if (!opts.simple) {
    ctx.fillStyle = rgba(style.glow, 0.85)
    for (const j of [g.kneeR, g.elbR]) {
      ctx.beginPath()
      ctx.arc(j.x, j.y, jr * 0.42, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ---- 7. head ----
  const hr = 8.8
  ctx.fillStyle = style.outline
  ctx.beginPath()
  ctx.arc(g.headC.x, g.headC.y, hr + 1.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = style.dark
  ctx.beginPath()
  ctx.arc(g.headC.x, g.headC.y, hr, 0, Math.PI * 2)
  ctx.fill()
  // visor slit (facing side) — glowing
  const va = style.visorAlpha ?? 1
  const vx = g.headC.x + Math.cos(g.headAng) * 0
  const vy = g.headC.y
  const flick = 0.85 + 0.15 * Math.sin(t * 11.3)
  ctx.strokeStyle = rgba(style.glow, va * flick)
  ctx.lineWidth = 2.6
  ctx.beginPath()
  ctx.moveTo(vx + 1.5, vy - 3.1)
  ctx.lineTo(vx + hr - 0.6, vy - 2.2)
  ctx.stroke()
  if (!opts.simple) {
    // helmet crest
    ctx.strokeStyle = rgba(style.body, 0.9)
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(g.headC.x - 4.5, g.headC.y - hr + 0.8)
    ctx.lineTo(g.headC.x - 2.5, g.headC.y - hr - 3.4)
    ctx.stroke()
  }

  // ---- 8. cybernetic armor (player / elite / heavy) ----
  if (style.armor && !opts.simple) {
    const ca = Math.sin(t * 6.2) * 0.5 + 0.5
    // shoulder pauldron on sword arm
    const shx = g.chest.x
    const shy = g.chest.y
    ctx.fillStyle = rgba(style.body, 0.94)
    ctx.strokeStyle = style.outline
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(shx - 2, shy - 3.4)
    ctx.lineTo(shx + 9.5, shy - 5.6)
    ctx.lineTo(shx + 11.5, shy + 2.2)
    ctx.lineTo(shx - 1, shy + 3.4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // chest core (pulsing energy)
    if (style.core) {
      const cxp = (g.hip.x + g.chest.x) * 0.5
      const cyp = (g.hip.y + g.chest.y) * 0.5
      ctx.fillStyle = rgba(style.core, 0.55 + ca * 0.4)
      ctx.beginPath()
      ctx.arc(cxp, cyp, 3.1 + ca * 0.9, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = rgba(style.core, 0.9)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cxp, cyp, 5.6 + ca * 1.4, 0, Math.PI * 2)
      ctx.stroke()
    }
    // thigh plate on front leg
    ctx.strokeStyle = rgba(style.body, 0.85)
    ctx.lineWidth = lineW * 0.5
    ctx.beginPath()
    ctx.moveTo((g.hip.x + g.kneeR.x) / 2, (g.hip.y + g.kneeR.y) / 2)
    ctx.lineTo((g.hip.x + g.kneeR.x) / 2 + 1.2, (g.hip.y + g.kneeR.y) / 2 - 2.6)
    ctx.stroke()
  }

  // ---- 9. hit flash overlay ----
  const flash = clamp01(opts.flash ?? 0)
  if (flash > 0.02) {
    ctx.strokeStyle = rgba(opts.flashColor ?? '#ffffff', flash)
    ctx.lineWidth = lineW
    limb(ctx, g.hipPtL.x, g.hipPtL.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
    limb(ctx, g.hipPtR.x, g.hipPtR.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
    limb(ctx, g.shoulderL.x, g.shoulderL.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)
    limb(ctx, g.shoulderR.x, g.shoulderR.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)
    ctx.lineWidth = lineW * 1.4
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
    ctx.lineTo(g.waist.x, g.waist.y)
    ctx.lineTo(g.chest.x, g.chest.y)
    ctx.stroke()
  }

  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Full-black humanoid silhouette (player remodel)                      */
/* ------------------------------------------------------------------ */

/** Fist: a short capsule perpendicular to the grip axis — knuckles read. */
function fillFist(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  ax: number, ay: number, // grip axis (unit)
  size: number,
  color: string,
  alpha = 1,
): void {
  // perpendicular of grip axis
  const px = -ay
  const py = ax
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x + px * size, y + py * size)
  ctx.lineTo(x + ax * size * 0.55 + px * size * 0.8, y + ay * size * 0.55 + py * size * 0.8)
  ctx.lineTo(x + ax * size * 0.55 - px * size * 0.8, y + ay * size * 0.55 - py * size * 0.8)
  ctx.lineTo(x - px * size, y - py * size)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, size * 0.92, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Rounded wedge between two points with per-end widths — torso/lats. */
function fillTaper(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, bx: number, by: number,
  wa: number, wb: number,
  color: string,
  alpha = 1,
): void {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(ax + nx * wa, ay + ny * wa)
  ctx.lineTo(bx + nx * wb, by + ny * wb)
  ctx.lineTo(bx - nx * wb, by - ny * wb)
  ctx.lineTo(ax - nx * wa, ay - ny * wa)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(ax, ay, wa, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(bx, by, wb, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Limbo/INSIDE-style silhouette, modeled on the articulated skeleton:
 * pelvis basin → abdominal taper → ribcage flare → trapezius → neck column
 * → skull; deltoid caps AT the glenohumeral joints; arms chain shoulder →
 * elbow → fist. Draw order back-to-front: rim → back limbs → torso → front
 * limbs → hands/feet → head → eyes → hit flash. Local space, ctx pre-flipped.
 */
function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  g: SkelGeom,
  style: StickStyle,
  opts: DrawOpts,
  t: number,
  lineW: number,
): void {
  const black = style.body
  const rim = style.outline
  // back-limb depth shade: still silhouette-dark, but separable from the
  // pure-black mass (the old 82%-alpha-black vanished against the torso)
  const back = style.dark !== black ? style.dark : rgba(black, 0.82)

  // ---- 0. rim pass (separates pure black from the night city) ----
  if (!opts.simple) {
    ctx.save()
    ctx.globalAlpha *= 0.78
    ctx.strokeStyle = rim
    ctx.lineWidth = lineW + 3.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    limb(ctx, g.hipPtL.x, g.hipPtL.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
    limb(ctx, g.hipPtR.x, g.hipPtR.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
    limb(ctx, g.shoulderL.x, g.shoulderL.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)
    limb(ctx, g.shoulderR.x, g.shoulderR.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)
    ctx.lineWidth = (lineW + 3.6) * 1.5
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
    ctx.lineTo(g.waist.x, g.waist.y)
    ctx.lineTo(g.chest.x, g.chest.y)
    ctx.lineTo(g.neckTop.x, g.neckTop.y)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 1. back limbs (recessed — depth cue), with anatomy ----
  // back leg from the far femur head: thigh (quad mass) → calf taper
  fillTaper(ctx, g.hipPtL.x, g.hipPtL.y, g.kneeL.x, g.kneeL.y, 5.8, 4.3, back)
  fillTaper(ctx, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y, 4.0, 2.8, back)
  fillFoot(ctx, g.ankleL.x, g.ankleL.y, g.toeL.x, g.toeL.y, back)
  // knee cap (back) — centers the joint inside the calf silhouette
  ctx.fillStyle = back
  ctx.beginPath()
  ctx.arc(g.kneeL.x, g.kneeL.y, 4.2, 0, Math.PI * 2)
  ctx.fill()
  // rear deltoid cap — the back arm's root reads at the far shoulder
  ctx.beginPath()
  ctx.arc(g.shoulderL.x, g.shoulderL.y, 4.6, 0, Math.PI * 2)
  ctx.fill()
  // back arm: triceps taper + forearm, from the far glenohumeral joint
  fillTaper(ctx, g.shoulderL.x, g.shoulderL.y, g.elbL.x, g.elbL.y, 4.9, 3.1, back)
  fillTaper(ctx, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y, 2.9, 1.8, back)

  // ---- 2. torso: pelvis basin + abdomen + ribcage + trapezius + neck ----
  // pelvis: WIDE at the hip (iliac crest), tapering hard to the waist —
  // strong region contrast so the pelvis reads as a basin
  fillTaper(ctx, g.hip.x, g.hip.y, g.waist.x, g.waist.y, 9.6, 6.6, black)
  // abdomen → ribcage: narrow at the navel, flaring WIDE at the chest —
  // the V-taper of the latissimus into the ribcage
  fillTaper(ctx, g.waist.x, g.waist.y, g.chest.x, g.chest.y, 6.6, 10.4, black)
  // trapezius: the shoulder girdle — slopes from the skull base out to BOTH
  // deltoid caps (near + far). This polygon is what ties arms to shoulders.
  {
    const ndx = g.neckTop.x - g.chest.x
    const ndy = g.neckTop.y - g.chest.y
    const nl = Math.hypot(ndx, ndy) || 1
    const px = -ndy / nl
    const py = ndx / nl
    ctx.save()
    ctx.fillStyle = black
    ctx.beginPath()
    ctx.moveTo(g.neckTop.x + px * 3.4, g.neckTop.y + py * 3.4)
    ctx.lineTo(g.neckTop.x - px * 3.4, g.neckTop.y - py * 3.4)
    // out to the FAR shoulder cap (behind + lower — 2.8D depth read)
    ctx.lineTo(g.shoulderL.x + px * 4.8, g.shoulderL.y + py * 4.8)
    ctx.lineTo(g.shoulderL.x - px * 3.4, g.shoulderL.y - py * 3.4)
    // through the shoulder line to the NEAR shoulder cap
    ctx.lineTo(g.shoulderR.x - px * 5.2, g.shoulderR.y - py * 5.2)
    ctx.lineTo(g.shoulderR.x + px * 5.8, g.shoulderR.y + py * 5.8)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  // neck column: chest (shoulder line) up to the skull base — a real neck,
  // wide at the base (sternocleidomastoid + trap roots) tapering to atlas
  fillTaper(ctx, g.chest.x, g.chest.y, g.neckTop.x, g.neckTop.y, 4.6, 3.3, black)

  // ---- 3. front limbs (solid black, anatomical) ----
  // front leg from the near femur head: quad → knee → calf
  fillTaper(ctx, g.hipPtR.x, g.hipPtR.y, g.kneeR.x, g.kneeR.y, 6.5, 4.7, black)
  fillTaper(ctx, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y, 4.4, 2.9, black)
  fillFoot(ctx, g.ankleR.x, g.ankleR.y, g.toeR.x, g.toeR.y, black)
  // knee cap — centers the joint in the front calf silhouette
  ctx.fillStyle = black
  ctx.beginPath()
  ctx.arc(g.kneeR.x, g.kneeR.y, 4.6, 0, Math.PI * 2)
  ctx.fill()
  // deltoid cap ON the glenohumeral joint — the arm reads from the shoulder
  ctx.beginPath()
  ctx.arc(g.shoulderR.x, g.shoulderR.y, 5.7, 0, Math.PI * 2)
  ctx.fill()
  // bicep → forearm taper (anatomical: deltoid .055H → elbow .035H →
  // wrist .020H — the forearm tapers STEEPER than the humerus)
  fillTaper(ctx, g.shoulderR.x, g.shoulderR.y, g.elbR.x, g.elbR.y, 5.7, 3.6, black)
  fillTaper(ctx, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y, 3.4, 2.1, black)
  // elbow sphere (silhouette joint)
  ctx.beginPath()
  ctx.arc(g.elbR.x, g.elbR.y, 3.7, 0, Math.PI * 2)
  ctx.fill()

  // ---- 4. hands: fists oriented on the blade axis (grip anatomy) ----
  const bax = Math.cos(g.bladeAngle)
  const bay = Math.sin(g.bladeAngle)
  // off-hand fist (rear grip — back shade, under the sword hand)
  fillFist(ctx, g.handL.x, g.handL.y, bax, bay, 2.9, back)
  // sword hand — big knuckle fist across the tsuka
  fillFist(ctx, g.handR.x, g.handR.y, bax, bay, 3.4, black)
  // grip readability: a whisper of rim on the sword fist so the grip reads
  // against the black mass (playtest note: hands vanished at gameplay zoom)
  if (!opts.simple) {
    ctx.save()
    ctx.strokeStyle = rgba(rim, 0.55)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(g.handR.x, g.handR.y, 3.6, -1.2, 0.9)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 4.5 BLADE-CAST RIM LIGHT (2.8D dynamic lighting): the glowing
  // edge lights the sword-side of the body — arm, torso leading edge,
  // front thigh. An additive whisper that separates the carrier from the
  // night and sells the blade as a real 3D light source in the scene. ----
  const el = opts.edgeLight
  if (el && el.a > 0.03) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.strokeStyle = rgba(el.color, Math.min(0.85, el.a))
    ctx.lineWidth = 2
    // sword arm chain (shoulder → elbow → hand) — closest to the source
    ctx.beginPath()
    ctx.moveTo(g.shoulderR.x, g.shoulderR.y)
    ctx.lineTo(g.elbR.x, g.elbR.y)
    ctx.lineTo(g.handR.x, g.handR.y)
    ctx.stroke()
    // torso leading edge (the lit side of the ribcage)
    ctx.beginPath()
    ctx.moveTo(g.hip.x + 5.2, g.hip.y - 1)
    ctx.quadraticCurveTo(g.waist.x + 6.5, g.waist.y - 1, g.chest.x + 8.2, g.chest.y + 1.5)
    ctx.stroke()
    // front thigh quad — the forward leg catches the spill
    ctx.beginPath()
    ctx.moveTo(g.hipPtR.x + 4.4, g.hipPtR.y + 1)
    ctx.lineTo(g.kneeR.x + 3.4, g.kneeR.y - 1)
    ctx.stroke()
    // off-hand knuckles kiss the light when gripping the tsuka
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(g.handL.x, g.handL.y, 2.6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 5. head: skull dome + jaw taper + swept hood crest ----
  ctx.save()
  ctx.fillStyle = black
  // skull — egg tilted with headAng (slightly taller than wide)
  ctx.translate(g.headC.x, g.headC.y)
  ctx.rotate(g.headAng * 0.35)
  ctx.beginPath()
  ctx.ellipse(0, -0.4, 8.2, 9.5, 0, 0, Math.PI * 2)
  ctx.fill()
  // jaw taper — chin mass forward-low (reads as a jaw, not a ball)
  ctx.beginPath()
  ctx.moveTo(2.6, 5.6)
  ctx.quadraticCurveTo(1.2, 8.6, -1.8, 8.2)
  ctx.quadraticCurveTo(-4.2, 7.6, -4.6, 4.4)
  ctx.closePath()
  ctx.fill()
  // hood/kabuto crest — swept back over the crown
  ctx.beginPath()
  ctx.moveTo(-2.0, -8.2)
  ctx.quadraticCurveTo(-7.5, -12.6, -12.6, -9.4)
  ctx.quadraticCurveTo(-8.8, -6.4, -5.2, -5.2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  // rim arc on the back of the skull — the one lit edge of the head
  if (!opts.simple) {
    ctx.save()
    ctx.strokeStyle = rgba(rim, 0.5)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(g.headC.x - 1.5, g.headC.y - 0.5, 8.6, Math.PI * 0.62, Math.PI * 1.32)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 6. glowing eyes (the only light on the body) ----
  if (!opts.simple) {
    const blink = 0.85 + 0.15 * Math.sin(t * 3.1)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rgba(style.glow, 0.95 * blink)
    // two eye slits on the forward face, angled with intent
    ctx.beginPath()
    ctx.ellipse(g.headC.x + 3.4, g.headC.y - 1.4, 2.0, 1.15, -0.18, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(g.headC.x + 6.4, g.headC.y - 2.2, 1.25, 0.9, -0.18, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ---- 7. hit flash overlay (whole body flashes) ----
  const flash = clamp01(opts.flash ?? 0)
  if (flash > 0.02) {
    const fc = opts.flashColor ?? '#ffffff'
    fillTaper(ctx, g.hipPtR.x, g.hipPtR.y, g.kneeR.x, g.kneeR.y, 6.5, 4.7, fc, flash)
    fillTaper(ctx, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y, 4.4, 2.9, fc, flash)
    fillTaper(ctx, g.hipPtL.x, g.hipPtL.y, g.kneeL.x, g.kneeL.y, 5.8, 4.3, fc, flash * 0.8)
    fillTaper(ctx, g.shoulderR.x, g.shoulderR.y, g.elbR.x, g.elbR.y, 4.9, 3.6, fc, flash)
    fillTaper(ctx, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y, 3.5, 2.6, fc, flash)
    fillTaper(ctx, g.waist.x, g.waist.y, g.chest.x, g.chest.y, 6.6, 10.4, fc, flash)
    fillTaper(ctx, g.hip.x, g.hip.y, g.waist.x, g.waist.y, 9.6, 6.6, fc, flash)
    ctx.fillStyle = fc
    ctx.save()
    ctx.globalAlpha *= flash
    ctx.beginPath()
    ctx.ellipse(g.headC.x, g.headC.y - 0.4, 8.2, 9.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}
