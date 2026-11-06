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

export const PLAYER_SPEC: SkelSpec = {
  torso: 34,
  neck: 7,
  headR: 8.6,
  upperArm: 21,
  foreArm: 19,
  hand: 6,
  thigh: 25,
  shin: 24,
  foot: 9,
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
  const tl = al + fl
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
  const tr = ar + fr
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
}

export const PLAYER_STYLE: StickStyle = {
  body: '#dfe7ee',
  dark: '#8b98a6',
  outline: '#04060a',
  glow: '#35f2ff',
  lineW: 5,
  headStyle: 'visor',
  armor: true,
  core: '#ff3b57',
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
}

function limb(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.lineTo(cx, cy)
  ctx.stroke()
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
    ctx.arc(g.headC.x, g.headC.y, style === PLAYER_STYLE ? 8.6 : 8, 0, Math.PI * 2)
    ctx.stroke()
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
  const hr = 8.6
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
