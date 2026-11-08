/** STICKMAN RISING — LIGHTING & SHADOW ENGINE (lighting).
 *
 * A 3D-game-style lighting model for the 2D canvas:
 *
 *   · KEY LIGHT — one dynamic directional light that blends the ambient
 *     moonlight (high elevation, soft, cool) with the storm's lightning
 *     strobes (low elevation, hard, from the bolt's azimuth). Everything
 *     downstream reads from this single source of truth.
 *   · PROJECTED SKELETON SHADOWS — instead of a static "blob" ellipse
 *     glued under each entity, every solved JOINT of the articulated body
 *     (and the blade) is projected along the key light's rays onto the
 *     ground plane, and the projected skeleton is re-drawn as a soft,
 *     multi-pass stroke figure — the shadow DEFORMS WITH THE POSE: knees
 *     bend, the sword arm sweeps, the blade throws its own slanted streak,
 *     a lunging torso stretches the silhouette. This is the "ray-traced"
 *     read of a 3D engine's character shadow, in 2D vector form.
 *   · PENUMBRA — a hard light casts hard-edged shadows; a soft light
 *     (moon) spreads a graduated penumbra. Emulated with 2–3 nested
 *     stroke passes of growing width and falling alpha.
 *   · CONTACT OCCLUSION — a tight, dark core exactly under each PLANTED
 *     foot (fed by the legik gait anchors — the exact ground-contact
 *     points) plus a body-core ellipse: the ambient-occlusion "weight"
 *     that keeps characters visually glued to the floor.
 *   · HEIGHT FALLOFF — airborne entities cast shadows that detach, slide
 *     along the light direction, fade and soften with altitude (the
 *     platformer "height = lighter + offset" law, but driven by the same
 *     physical projection).
 */

import { clamp, clamp01, lerp } from '../core/utils'
import { rgba } from '../core/utils'
/* ------------------------------------------------------------------ */
/* Key light                                                           */
/* ------------------------------------------------------------------ */

export interface KeyLight {
  /** horizontal direction shadows lean along (unit-ish, +X = right) */
  dirX: number
  /** elevation above the horizon, radians: high → short shadows */
  elev: number
  /** 0 = soft ambient … 1 = hard directional (strobes) */
  hard: number
  /** overall intensity */
  i: number
  /** shadow tint (near-black; storms cool it further) */
  color: string
}

const MOON: KeyLight = {
  dirX: -0.42,   // moon rides upper-right → shadows lean left
  elev: 1.02,    // steep: short, tight shadows
  hard: 0.14,
  i: 0.55,
  color: '#020409',
}

/** Blend the ambient moonlight with a lightning strobe.
 * @param li   storm intensity 0..1 (bg.lightningI())
 * @param az   strike azimuth −1..1 (bg.lightningAz(); shadows lean OPPOSITE) */
export function keyLightFromStorm(li: number, az: number): KeyLight {
  const k = clamp01(li)
  if (k <= 0.001) return { ...MOON }
  const boltDir = az >= 0 ? -0.92 : 0.92
  return {
    dirX: lerp(MOON.dirX, boltDir, k),
    elev: lerp(MOON.elev, 0.3, k),       // low bolts throw LONG raking shadows
    hard: lerp(MOON.hard, 1, k),
    i: MOON.i + k * 0.75,
    color: '#010307',
  }
}

/* ------------------------------------------------------------------ */
/* Projected skeleton shadow                                           */
/* ------------------------------------------------------------------ */

export interface ShadowFigure {
  /** stroke chains in WORLD space: flat [x0,y0, x1,y1, ...] per chain
   * (y negative = above the ground line) */
  chains: number[][]
  /** head joint for the skull ellipse (world) */
  head: { x: number; y: number; r: number } | null
  /** optional weapon chain already included in chains; kept separate here
   * so it can carry a wider streak */
  blade?: { x0: number; y0: number; x1: number; y1: number } | null
}

export interface CastShadowOpts {
  /** base opacity multiplier */
  alpha?: number
  /** base stroke width (world px) — roughly limb width */
  width?: number
  /** penumbra passes (2 cheap / 3 player) */
  passes?: number
  /** body scale (widths scale) */
  scale?: number
  /** whole-body extra height (airborne; negative = above ground) */
  height?: number
  /** planted-foot contact points for the AO cores (world x) */
  contacts?: number[]
  /** light intensity boost (strobes) — defaults from light */
  lightBoost?: number
}

/* ------------------------------------------------------------------ */
/* Strobe rim light                                                    */
/* ------------------------------------------------------------------ */

/** STROBE RIM — the other half of the lighting model: the light that
 * CASTS the shadow must also LIGHT the caster. During lightning strobes
 * an additive edge pass strokes the figure's silhouette, offset toward
 * the source, in the bolt's cool color — the character's lit side catches
 * the flash while the far side stays black. Chains are LOCAL space (the
 * ctx is expected to already carry the entity transform). */
export function drawStrobeRim(
  ctx: CanvasRenderingContext2D,
  light: KeyLight, k: number,
  chains: number[][],
  head: { x: number; y: number; r: number },
  face: number, lineW: number,
): void {
  if (k <= 0.04) return
  // slide toward the source so the rim peeks off the LIT edge only
  const off = -light.dirX * face * 2.6
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = rgba('#cfe4ff', 0.32 * k)
  ctx.lineWidth = lineW + 1.6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (const ch of chains) {
    if (ch.length < 4) continue
    ctx.moveTo(ch[0] + off, ch[1])
    for (let i = 2; i < ch.length; i += 2) ctx.lineTo(ch[i] + off, ch[i + 1])
  }
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(head.x + off * 0.8, head.y, head.r + 0.9, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

const scratchProj: number[] = []

/**
 * Draw the projected-skeleton cast shadow for one figure onto the ground
 * line (y = 0). The chains are re-projected per pass with growing width
 * and falling alpha — the cheap penumbra. Contact AO cores render under
 * the given planted-foot anchors.
 */
export function drawCastShadow(
  ctx: CanvasRenderingContext2D,
  fig: ShadowFigure,
  light: KeyLight,
  opts: CastShadowOpts = {},
): void {
  const height = opts.height ?? 0
  // whole-figure falloff with altitude (detached, fading, softening) —
  // gentler than pure inverse so an apex jump shadow still reads on screen
  const hFall = Math.max(0.34, 1 / (1 + Math.max(0, -height) / 210))
  const aBase = (opts.alpha ?? 0.6) * clamp01(0.72 + light.i * 0.5) * hFall
  if (aBase < 0.02) return
  const wBase = (opts.width ?? 6.2) * (opts.scale ?? 1) * (1 + Math.max(0, -height) / 240)
  const passes = opts.passes ?? 2
  // penumbra spread: soft light spreads wide, hard light stays tight
  const spread = (1 - light.hard) * 1.35 + 0.18
  // strobes rake wider, harder strokes — the peak flash owns the ground
  const hardBoost = 1 + light.hard * 0.4
  const elev = Math.max(0.2, light.elev)
  const cot = 1 / Math.tan(elev)
  const dx = light.dirX
  const passesAlpha = [1, 0.42, 0.18]

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // ---- penumbra passes over every chain ----
  for (let k = 0; k < passes; k++) {
    const wPass = wBase * (1 + k * spread) * hardBoost
    const aPass = aBase * passesAlpha[Math.min(k, 2)]
    if (aPass < 0.012) continue
    ctx.strokeStyle = rgba(light.color, Math.min(0.8, aPass))
    ctx.lineWidth = wPass
    for (const chain of fig.chains) {
      const n = chain.length
      if (n < 4) continue
      // chain height fade: tall chains cast lighter (distance soft)
      let meanH = 0
      for (let i = 1; i < n; i += 2) meanH += chain[i]
      meanH = -meanH / ((n - 1) / 2) + Math.max(0, -height) * 0.35
      const cFall = 1 / (1 + Math.max(0, meanH) / 170)
      const aChain = aPass * cFall
      if (aChain < 0.015) continue
      ctx.strokeStyle = rgba(light.color, Math.min(0.8, aChain))
      ctx.beginPath()
      // project each joint along the light ray to the ground plane
      for (let i = 0; i < n; i += 2) {
        const px = chain[i] + (-chain[i + 1]) * cot * dx
        const py = 2.5 + k * 1.4 // hug the walkway line; widen slightly per pass
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
    // head: projected skull ellipse
    if (fig.head) {
      const hx = fig.head.x + (-fig.head.y + Math.max(0, -height)) * cot * dx
      const hy = 2.5 + k * 1.4
      const hr = fig.head.r * (1.5 + k * spread * 0.8)
      ctx.fillStyle = rgba(light.color, Math.min(0.85, aPass * 0.85))
      ctx.beginPath()
      ctx.ellipse(hx, hy, hr, hr * 0.42, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    // blade streak: the steel casts its own wide soft line
    if (fig.blade) {
      const b = fig.blade
      const ax = b.x0 + (-b.y0) * cot * dx
      const bx = b.x1 + (-b.y1) * cot * dx
      const midFall = 1 / (1 + Math.max(0, -(b.y0 + b.y1) / 2) / 170)
      ctx.strokeStyle = rgba(light.color, Math.min(0.78, aPass * 0.75 * midFall))
      ctx.lineWidth = wBase * 1.05 * (1 + k * spread)
      ctx.beginPath()
      ctx.moveTo(ax, 2.5 + k * 1.4)
      ctx.lineTo(bx, 2.5 + k * 1.4)
      ctx.stroke()
    }
  }

  // ---- CONTACT OCCLUSION: tight dark cores exactly under planted feet ----
  if (opts.contacts && opts.contacts.length) {
    const s = opts.scale ?? 1
    for (const cx of opts.contacts) {
      ctx.fillStyle = rgba('#010307', Math.min(0.6, aBase * 1.15 * hFall))
      ctx.beginPath()
      ctx.ellipse(cx, 3.5, 8.5 * s, 3.1 * s, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
  void scratchProj
}
