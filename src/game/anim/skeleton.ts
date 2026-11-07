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
  neck: number
  headR: number
  upperArm: number
  foreArm: number
  hand: number
  thigh: number
  shin: number
  foot: number
  blade: number
}

/** Humanoid proportions (research: da Vinci Vitruvian ratios adapted to a
 * silhouette fighter): torso 37 + neck 7.5 + head 8.8 ≈ upper body; legs
 * thigh 25 + shin 24 = 49 (HIP_H 64 stays valid: 49 × SCALE ≈ 64.7).
 * Blade 56 ≈ 54% of the ~104u standing height (plus tsuka ≈ 17 → 70%
 * overall) — a REAL long-katana proportion; 44 read as a knife, 52 still
 * a touch short in playtesting. 56 is the "legit" read: the kissaki
 * clears the knee sheathed, breaks overhead raised — classic iai
 * silhouette landmarks. */
export const PLAYER_SPEC: SkelSpec = {
  torso: 37,
  neck: 7.5,
  headR: 8.8,
  upperArm: 22,
  foreArm: 20,
  hand: 6.5,
  thigh: 25,
  shin: 24,
  foot: 10,
  blade: 56,
}

export interface SkelGeom {
  hip: Vec2
  chest: Vec2
  neckBase: Vec2
  headC: Vec2
  headAng: number
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
    hip: z(), chest: z(), neckBase: z(), headC: z(), headAng: 0,
    kneeL: z(), ankleL: z(), toeL: z(),
    kneeR: z(), ankleR: z(), toeR: z(),
    elbL: z(), handL: z(), elbR: z(), handR: z(),
    bladeAngle: 0, torsoAngle: 0,
  }
}

/** Solve joint positions. Reuses `out`. */
export function solveSkeleton(pose: Pose, spec: SkelSpec, out: SkelGeom): SkelGeom {
  const rot = pose[2]
  const spine = pose[3]
  const head = pose[4]

  // torso chain: hip → mid → chest (spine bends the upper half)
  out.hip.x = pose[0]
  out.hip.y = pose[1]
  const t1 = rot
  const mx = out.hip.x + Math.sin(t1) * spec.torso * 0.55
  const my = out.hip.y - Math.cos(t1) * spec.torso * 0.55
  const t2 = rot + spine
  out.chest.x = mx + Math.sin(t2) * spec.torso * 0.45
  out.chest.y = my - Math.cos(t2) * spec.torso * 0.45
  out.torsoAngle = t2

  // head
  const ha = t2 + head
  out.neckBase.x = out.chest.x + Math.sin(ha) * spec.neck * 0.45
  out.neckBase.y = out.chest.y - Math.cos(ha) * spec.neck * 0.45
  out.headC.x = out.neckBase.x + Math.sin(ha) * spec.neck * 0.7
  out.headC.y = out.neckBase.y - Math.cos(ha) * spec.neck * 0.7
  out.headAng = ha

  // legs (angle from straight-down, positive = forward)
  const hl = pose[5]
  const kl = pose[6]
  const fl = pose[7]
  out.kneeL.x = out.hip.x + Math.sin(hl) * spec.thigh
  out.kneeL.y = out.hip.y + Math.cos(hl) * spec.thigh
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
  out.kneeR.x = out.hip.x + Math.sin(hr) * spec.thigh
  out.kneeR.y = out.hip.y + Math.cos(hr) * spec.thigh
  const ar = hr + kr
  out.ankleR.x = out.kneeR.x + Math.sin(ar) * spec.shin
  out.ankleR.y = out.kneeR.y + Math.cos(ar) * spec.shin
  const tr = Math.PI / 2 + ar * 0.35 + fr * 0.5
  out.toeR.x = out.ankleR.x + Math.sin(tr) * spec.foot
  out.toeR.y = out.ankleR.y + Math.cos(tr) * spec.foot

  // arms (angle from straight-down, positive = forward)
  const sl = pose[11]
  const el = pose[12]
  out.elbL.x = out.chest.x + Math.sin(sl) * spec.upperArm
  out.elbL.y = out.chest.y + Math.cos(sl) * spec.upperArm
  const wl = sl + el
  out.handL.x = out.elbL.x + Math.sin(wl) * spec.foreArm
  out.handL.y = out.elbL.y + Math.cos(wl) * spec.foreArm

  const sr = pose[14]
  const er = pose[15]
  out.elbR.x = out.chest.x + Math.sin(sr) * spec.upperArm
  out.elbR.y = out.chest.y + Math.cos(sr) * spec.upperArm
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
  dark: '#131b28', // back-limb depth shade — reads against the pure-black mass
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
    limb(ctx, g.hip.x, g.hip.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
    limb(ctx, g.hip.x, g.hip.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
    limb(ctx, g.chest.x, g.chest.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)
    limb(ctx, g.chest.x, g.chest.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
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
    limb(ctx, g.hip.x, g.hip.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
    limb(ctx, g.hip.x, g.hip.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
    limb(ctx, g.chest.x, g.chest.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)
    limb(ctx, g.chest.x, g.chest.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
    ctx.lineTo(g.chest.x, g.chest.y)
    ctx.stroke()
  }

  // ---- 2. back limbs ----
  ctx.strokeStyle = style.dark
  ctx.lineWidth = lineW
  limb(ctx, g.hip.x, g.hip.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
  ctx.strokeStyle = rgba(style.dark, 0.82)
  limb(ctx, g.chest.x, g.chest.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)

  // ---- 3. torso (thicker, armored core) ----
  ctx.strokeStyle = style.body
  ctx.lineWidth = lineW * 1.42
  ctx.beginPath()
  ctx.moveTo(g.hip.x, g.hip.y)
  ctx.lineTo(g.chest.x, g.chest.y)
  ctx.stroke()

  // ---- 4. front limbs ----
  ctx.strokeStyle = style.body
  ctx.lineWidth = lineW
  limb(ctx, g.hip.x, g.hip.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
  limb(ctx, g.chest.x, g.chest.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)

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
    limb(ctx, g.hip.x, g.hip.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
    limb(ctx, g.hip.x, g.hip.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
    limb(ctx, g.chest.x, g.chest.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)
    limb(ctx, g.chest.x, g.chest.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)
    ctx.lineWidth = lineW * 1.4
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
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
 * Limbo/INSIDE-style silhouette, re-modeled with real anatomy:
 * trapezius neck → deltoid caps → tapered arms → fists; skull dome + jaw
 * + swept hood crest; pelvis → lat taper → chest mass. Draw order
 * back-to-front: rim → back limbs → torso wedge → front limbs → hands/feet
 * → head → eyes → hit flash. Local space, ctx pre-flipped for facing.
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

  // torso mid point (waist) for the tapered wedge
  const mx = (g.hip.x + g.chest.x) * 0.5
  const my = (g.hip.y + g.chest.y) * 0.5

  // ---- 0. rim pass (separates pure black from the night city) ----
  if (!opts.simple) {
    ctx.save()
    ctx.globalAlpha *= 0.78
    ctx.strokeStyle = rim
    ctx.lineWidth = lineW + 3.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    limb(ctx, g.hip.x, g.hip.y, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y)
    limb(ctx, g.hip.x, g.hip.y, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y)
    limb(ctx, g.chest.x, g.chest.y, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y)
    limb(ctx, g.chest.x, g.chest.y, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y)
    ctx.lineWidth = (lineW + 3.6) * 1.55
    ctx.beginPath()
    ctx.moveTo(g.hip.x, g.hip.y)
    ctx.lineTo(g.chest.x, g.chest.y)
    ctx.stroke()
    ctx.restore()
  }

  // ---- 1. back limbs (recessed — depth cue), with anatomy ----
  // back leg: thigh (quad mass) → calf taper
  fillTaper(ctx, g.hip.x, g.hip.y, g.kneeL.x, g.kneeL.y, 6.0, 4.4, back)
  fillTaper(ctx, g.kneeL.x, g.kneeL.y, g.ankleL.x, g.ankleL.y, 4.1, 2.9, back)
  fillFoot(ctx, g.ankleL.x, g.ankleL.y, g.toeL.x, g.toeL.y, back)
  // back arm: deltoid nub + triceps taper + forearm
  fillTaper(ctx, g.chest.x, g.chest.y, g.elbL.x, g.elbL.y, 4.9, 3.5, back)
  fillTaper(ctx, g.elbL.x, g.elbL.y, g.handL.x, g.handL.y, 3.3, 2.6, back)

  // ---- 2. torso: pelvis + waist taper + lat-swept chest + trapezius ----
  fillTaper(ctx, g.hip.x, g.hip.y, mx, my, 8.6, 7.0, black)
  fillTaper(ctx, mx, my, g.chest.x, g.chest.y, 7.0, 10.6, black)
  // trapezius: neck slopes wide into the shoulders — the V of the back
  const neckDx = g.neckBase.x - g.chest.x
  const neckDy = g.neckBase.y - g.chest.y
  const nLen = Math.hypot(neckDx, neckDy) || 1
  const perpX = -neckDy / nLen
  const perpY = neckDx / nLen
  ctx.save()
  ctx.fillStyle = black
  ctx.beginPath()
  ctx.moveTo(g.neckBase.x + perpX * 3.1, g.neckBase.y + perpY * 3.1)
  ctx.lineTo(g.chest.x + perpX * 10.4, g.chest.y + perpY * 10.4)
  ctx.lineTo(g.chest.x - perpX * 10.4, g.chest.y - perpY * 10.4)
  ctx.lineTo(g.neckBase.x - perpX * 3.1, g.neckBase.y - perpY * 3.1)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  // neck column
  fillTaper(ctx, g.chest.x, g.chest.y, g.neckBase.x, g.neckBase.y, 4.4, 3.6, black)

  // ---- 3. front limbs (solid black, anatomical) ----
  fillTaper(ctx, g.hip.x, g.hip.y, g.kneeR.x, g.kneeR.y, 6.7, 4.8, black)
  fillTaper(ctx, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y, 4.5, 3.0, black)
  fillFoot(ctx, g.ankleR.x, g.ankleR.y, g.toeR.x, g.toeR.y, black)
  // deltoid cap on the sword shoulder — the arm reads from the shoulder
  ctx.fillStyle = black
  ctx.beginPath()
  ctx.arc(g.chest.x, g.chest.y, 5.6, 0, Math.PI * 2)
  ctx.fill()
  // bicep → forearm taper
  fillTaper(ctx, g.chest.x, g.chest.y, g.elbR.x, g.elbR.y, 5.1, 3.7, black)
  fillTaper(ctx, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y, 3.6, 2.7, black)
  // elbow sphere (silhouette joint)
  ctx.beginPath()
  ctx.arc(g.elbR.x, g.elbR.y, 3.8, 0, Math.PI * 2)
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
    ctx.moveTo(g.chest.x, g.chest.y)
    ctx.lineTo(g.elbR.x, g.elbR.y)
    ctx.lineTo(g.handR.x, g.handR.y)
    ctx.stroke()
    // torso leading edge (the lit side of the ribcage)
    ctx.beginPath()
    ctx.moveTo(g.hip.x + 5.2, g.hip.y - 1)
    ctx.quadraticCurveTo(mx + 6.5, my - 1, g.chest.x + 8.2, g.chest.y + 1.5)
    ctx.stroke()
    // front thigh quad — the forward leg catches the spill
    ctx.beginPath()
    ctx.moveTo(g.hip.x + 4.4, g.hip.y + 1)
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
    fillTaper(ctx, g.hip.x, g.hip.y, g.kneeR.x, g.kneeR.y, 6.7, 4.8, fc, flash)
    fillTaper(ctx, g.kneeR.x, g.kneeR.y, g.ankleR.x, g.ankleR.y, 4.5, 3.0, fc, flash)
    fillTaper(ctx, g.hip.x, g.hip.y, g.kneeL.x, g.kneeL.y, 6.0, 4.4, fc, flash * 0.8)
    fillTaper(ctx, g.chest.x, g.chest.y, g.elbR.x, g.elbR.y, 5.1, 3.7, fc, flash)
    fillTaper(ctx, g.elbR.x, g.elbR.y, g.handR.x, g.handR.y, 3.6, 2.7, fc, flash)
    fillTaper(ctx, mx, my, g.chest.x, g.chest.y, 7.0, 10.6, fc, flash)
    ctx.fillStyle = fc
    ctx.save()
    ctx.globalAlpha *= flash
    ctx.beginPath()
    ctx.ellipse(g.headC.x, g.headC.y - 0.4, 8.2, 9.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}
