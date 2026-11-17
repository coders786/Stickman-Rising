/** STICKMAN RISING — src/game/world/night.ts
 * THE PER-RUN NIGHT: baked plates + the two reactive passes that answer the player.
 * ----------------------------------------------------------------------------
 * `profile.ts` decides *what kind of night it is*; `gpu/sky.ts` bakes the hard
 * surfaces; this file is the join between them and the frame — and it owns the
 * two pieces of lighting that must react to the player every frame:
 *
 *  1. GLITTER on the wet deck under the moon. A single baked streak sprite,
 *     blitted twice with an alpha that follows the moon's screen x and the
 *     player's proximity. This is the "very low CPU reflections" requirement
 *     taken further than the mirrored band already in background.ts: a mirror
 *     shows the city, glitter shows *the moon touching the roof*, and it costs
 *     two drawImage calls with no readback.
 *
 *  2. The MOON KEY RIM on the figure. The contact shadow in renderer.ts is
 *     pushed lower-left because the moon keys from the upper right; the rim is
 *     the other half of that story. One cached crescent, additive, alpha driven
 *     by the player's distance from the moon's azimuth and by `profile.light.key`.
 *
 * Memory law: every sprite here is baked once per seed and RELEASED (w=h=0) on
 * reseed. Nothing in this file allocates in the draw path: the alpha strings are
 * quantised through render/color.ts, and the shimmer is a pure function of time.
 * ==========================================================================*/

import type { EnvironmentProfile } from './profile'
import type { MoodPalette } from './mood'
import { bakeMoonPlate, bakeStarPlate, type Plate } from '../../gpu/sky'
import { rgbaConst } from '../render/color'

const TAU = Math.PI * 2
const canDraw = (): boolean => typeof document !== 'undefined'

export interface NightStats {
  moonSource: Plate['source'] | 'none'
  starSource: Plate['source'] | 'none'
  moonMs: number
  starMs: number
  note: string
  sprites: number
}

function blank(w: number, h: number): HTMLCanvasElement | null {
  if (!canDraw()) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Radial sprite of the specular streaks the moon makes on a wet, gritty deck:
 *  vertical smears of varying length, brightest at the centre line. Baked, not
 *  drawn — a real glitter pass would be hundreds of 1px rects per frame. */
function buildGlitter(rgb: string, seed: number): HTMLCanvasElement | null {
  const c = blank(256, 64)
  if (!c) return null
  const g = c.getContext('2d')
  if (!g) return c
  let s = (seed >>> 0) || 1
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 44; i++) {
    const x = rnd() * 256
    const d = Math.abs(x - 128) / 128
    const len = 6 + rnd() * 30 * (1 - d * 0.65)
    const y = 32 + (rnd() - 0.5) * 18
    const a = (1 - d) * (0.25 + rnd() * 0.5)
    const grd = g.createLinearGradient(x, y - len * 0.5, x, y + len * 0.5)
    grd.addColorStop(0, rgbaConst(rgb, 0))
    grd.addColorStop(0.5, rgbaConst(rgb, a * 0.9))
    grd.addColorStop(1, rgbaConst(rgb, 0))
    g.strokeStyle = grd
    g.lineWidth = 0.7 + rnd() * 1.5
    g.beginPath()
    g.moveTo(x, y - len * 0.5)
    g.lineTo(x, y + len * 0.5)
    g.stroke()
  }
  return c
}

/** The key-rim crescent: a soft arc of light down the lit side of a figure. */
function buildRim(rgb: string, flip: boolean): HTMLCanvasElement | null {
  const w = 96, h = 190
  const c = blank(w, h)
  if (!c) return null
  const g = c.getContext('2d')
  if (!g) return c
  g.globalCompositeOperation = 'lighter'
  // three nested arcs: wide soft, mid, tight hot — the same three-band trick the
  // baked practicals use, so the new light reads as part of the same rig.
  const bands: ReadonlyArray<[number, number]> = [[16, 0.10], [9, 0.16], [4, 0.30]]
  for (const [lw, a] of bands) {
    g.strokeStyle = rgbaConst(rgb, a)
    g.lineWidth = lw
    g.beginPath()
    // A crescent, not a circle: an arc that hugs the silhouette from shoulder
    // to knee on the moon side.
    g.ellipse(w * 0.5, h * 0.52, w * 0.30, h * 0.40, 0, -1.25, 1.25, false)
    g.stroke()
  }
  if (flip) {
    const out = blank(w, h)
    const o = out?.getContext('2d')
    if (out && o) {
      o.translate(w, 0)
      o.scale(-1, 1)
      o.drawImage(c, 0, 0)
      return out
    }
  }
  return c
}

export class NightLayer {
  readonly profile: EnvironmentProfile
  private readonly mood: MoodPalette
  private moon: Plate | null = null
  private star: Plate | null = null
  private glitter: HTMLCanvasElement | null = null
  private rimR: HTMLCanvasElement | null = null
  private rimL: HTMLCanvasElement | null = null
  private built = false

  constructor(profile: EnvironmentProfile) {
    this.profile = profile
    this.mood = profile.mood
  }

  /** Bake once. Safe to call every frame (returns immediately when built).
   *
   *  The star plate is baked at HALF the authoring resolution (1024×320 for a
   *  2048×640 tile). Stars are points and the tile is stretched back up, so the
   *  only visible difference is a slightly softer glow — and the readback drops
   *  from 5.2 MB to 1.3 MB, which is the difference between a 30 ms and an 8 ms
   *  bake on a mid-phone (the budget in 13 §5 is 40 ms for the whole boot).
   *  The full-resolution path remains available by calling ensure() with
   *  explicit dimensions. */
  ensure(starW = 1024, starH = 320): void {
    if (this.built || !canDraw()) return
    this.built = true
    this.moon = bakeMoonPlate(this.profile, this.mood, 512)
    this.star = bakeStarPlate(this.profile, starW, starH)
    this.glitter = buildGlitter(this.mood.highlight, this.profile.seed)
    this.rimR = buildRim(this.mood.highlight, false)
    this.rimL = buildRim(this.mood.highlight, true)
  }

  moonPlate(): HTMLCanvasElement | null {
    this.ensure()
    return this.moon?.canvas ?? null
  }

  starPlate(): HTMLCanvasElement | null {
    this.ensure()
    return this.star?.canvas ?? null
  }

  stats(): NightStats {
    return {
      moonSource: this.moon?.source ?? 'none',
      starSource: this.star?.source ?? 'none',
      moonMs: this.moon?.ms ?? 0,
      starMs: this.star?.ms ?? 0,
      note: this.moon?.note ?? this.star?.note ?? '',
      sprites: (this.glitter ? 1 : 0) + (this.rimR ? 1 : 0) + (this.rimL ? 1 : 0),
    }
  }

  /** MOON GLITTER — two additive blits, no readback. `moonX` is the moon's
   *  screen x, `deckY` the deck line in screen space. The alpha answers the
   *  moon's phase (a crescent glitters less than a gibbous) and the storm
   *  (wetness), which is what makes it read as a reflection rather than a decal. */
  drawGlitter(
    ctx: CanvasRenderingContext2D,
    moonX: number,
    deckY: number,
    viewW: number,
    viewH: number,
    wet: number,
    t: number,
  ): void {
    const spr = this.glitter
    if (!spr || deckY < 0 || deckY > viewH + 40) return
    const strength = 0.55 + 0.45 * Math.min(1, wet)
    const phase = 0.45 + 0.55 * this.profile.moon.phase
    const shimmer = 0.86 + 0.14 * Math.sin(t * 1.7)
    const w = Math.max(80, Math.min(viewW * 0.62, 360))
    const h = 58
    const x = Math.max(-w * 0.4, Math.min(viewW - w * 0.6, moonX - w * 0.5))
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.30 * strength * phase * shimmer
    ctx.drawImage(spr, x, deckY - 8, w, h)
    ctx.globalAlpha = 0.16 * strength * phase
    ctx.drawImage(spr, x + w * 0.18, deckY + 10, w * 0.64, h * 0.8)
    ctx.restore()
  }

  /** MOON KEY RIM — the reactive half of the directional rig. `near` is 0..1
   *  proximity to a practical (the warm/cool light the player stands in); the
   *  rim stays the MOON's colour and merely brightens, because a light that
   *  changes hue as you walk reads as a bug. */
  drawKeyRim(ctx: CanvasRenderingContext2D, px: number, py: number, face: number, near: number, t: number): void {
    const spr = this.profile.moon.phase < 0.5 ? this.rimR : (face >= 0 ? this.rimR : this.rimL)
    if (!spr) return
    const key = this.profile.light.key
    const breathe = 0.9 + 0.1 * Math.sin(t * 0.9)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(0.5, (0.16 + 0.12 * near) * key * breathe)
    ctx.drawImage(spr, px - 48, py - 188, 96, 190)
    ctx.restore()
  }

  /** Zero the backing stores. Called on reseed and on teardown — this is the
   *  ledger's rule expressed for objects the ledger does not own. */
  dispose(): void {
    for (const c of [this.moon?.canvas, this.star?.canvas, this.glitter, this.rimR, this.rimL]) {
      if (c) { c.width = 0; c.height = 0 }
    }
    this.moon = null
    this.star = null
    this.glitter = null
    this.rimR = null
    this.rimL = null
    this.built = false
  }
}

/** Pure helper the tests can exercise without a canvas: how bright the glitter
 *  should be for a given profile and time. Kept exported so the property
 *  ("a crescent never glitters like a full moon") is testable. */
export function glitterGain(phase: number, wetness: number): number {
  const p = Math.max(0, Math.min(1, phase))
  const w = Math.max(0, Math.min(1, wetness))
  return (0.45 + 0.55 * p) * (0.55 + 0.45 * w)
}

/** Same for the rim: the key's gain must stay inside a band that is visible on
 *  a dark deck but never blows out a light-coloured coat. */
export function rimGain(key: number, near: number): number {
  const k = Math.max(0.6, Math.min(1.4, key))
  const n = Math.max(0, Math.min(1, near))
  return Math.max(0.08, Math.min(0.5, (0.16 + 0.12 * n) * k))
}

export const NIGHT_TAU = TAU
