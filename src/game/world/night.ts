/** Per-run sky plates and wet-deck glitter. Actor lighting lives in render/surface-light. */
import type { EnvironmentProfile } from './profile'
import type { MoodPalette } from './mood'
import { bakeMoonPlate, bakeSkyPlateDeferred, bakeStarPlate, type Plate } from '../../gpu/sky'
import { rgbaConst } from '../render/color'
import { hasPixels, SurfaceScope } from '../render/ledger'

const TAU = Math.PI * 2
// Includes context creation and both plates; never ask a player to sit
// through a multi-second fence wait for decorative detail.
const SKY_BAKE_BUDGET_MS = 96
const canDraw = (): boolean => typeof document !== 'undefined'

export interface NightStats {
  moonSource: Plate['source'] | 'none'
  starSource: Plate['source'] | 'none'
  moonMs: number
  starMs: number
  note: string
  sprites: number
}

/** Radial sprite of the specular streaks the moon makes on a wet, gritty deck:
 *  vertical smears of varying length, brightest at the centre line. Baked, not
 *  drawn — a real glitter pass would be hundreds of 1px rects per frame. */
function paintGlitter(c: HTMLCanvasElement, rgb: string, seed: number): void {
  const g = c.getContext('2d')
  if (!g) return
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
}

export class NightLayer {
  readonly profile: EnvironmentProfile
  private readonly mood: MoodPalette
  private readonly surfaces = new SurfaceScope('night')
  private moon: Plate | null = null
  private star: Plate | null = null
  private glitter: HTMLCanvasElement | null = null
  private built = false

  constructor(profile: EnvironmentProfile, private readonly wetGlitter = true) {
    this.profile = profile
    this.mood = profile.mood
  }

  /** Bake once. Safe to call every frame (returns immediately when built).
   *
   *  The star plate is baked at HALF the authoring resolution (1024×320 for a
   *  2048×640 tile). Stars are points and the tile is stretched back up, so the
   *  only visible difference is a slightly softer glow — and the readback drops
   *  from 5.2 MB to 1.3 MB. Explicit dimensions allow full-resolution captures.
   *  For the title, skip even creating a GL context. */
  ensure(starW = 1024, starH = 320, canvasOnly = false): void {
    if (this.built || !canDraw()) return
    try {
      this.moon = bakeMoonPlate(this.profile, this.mood, 512, (w, h) => this.surfaces.acquire('moon', w, h, 'night'), canvasOnly)
      this.star = bakeStarPlate(this.profile, starW, starH, (w, h) => this.surfaces.acquire('stars', w, h, 'night'), canvasOnly)
      this.finish()
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  /** For an unpublished night only. It owns at most two sky plates and a
   * glitter sprite; the active city's canvas generation is not duplicated. */
  async warmDeferred(signal: AbortSignal): Promise<void> {
    if (this.built || !canDraw() || signal.aborted) return
    const deadline = performance.now() + SKY_BAKE_BUDGET_MS
    try {
      this.moon = await bakeSkyPlateDeferred('moon', this.profile, signal,
        (w, h) => this.surfaces.acquire('moon', w, h, 'night'), deadline)
      if (signal.aborted) return
      this.star = await bakeSkyPlateDeferred('stars', this.profile, signal,
        (w, h) => this.surfaces.acquire('stars', w, h, 'night'), deadline, this.moon?.source === 'gpu')
      if (signal.aborted) return
      this.finish()
    } finally {
      if (!this.built) this.dispose()
    }
  }

  private finish(): void {
    if (this.wetGlitter) {
      this.glitter = this.surfaces.acquire('glitter', 256, 64, 'night')
      paintGlitter(this.glitter, this.mood.highlight, this.profile.seed)
    }
    this.built = true
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
      sprites: (this.glitter ? 1 : 0),
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
    zoom: number,
    wet: number,
    t: number,
  ): void {
    const spr = this.glitter
    if (!hasPixels(spr)) return
    // The caller clips against the rolled asphalt. The lane itself can be
    // off-screen while its wet front edge is still visible.
    const gain = glitterGain(this.profile.moon.phase, wet)
    const shimmer = 0.86 + 0.14 * Math.sin(t * 1.7)
    const w = Math.max(80, Math.min(viewW * 0.62, 360))
    const h = 58 * zoom
    const x = Math.max(-w * 0.4, Math.min(viewW - w * 0.6, moonX - w * 0.5))
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.30 * gain * shimmer
    ctx.drawImage(spr, x, deckY - 8 * zoom, w, h)
    ctx.globalAlpha = 0.16 * gain
    ctx.drawImage(spr, x + w * 0.18, deckY + 10 * zoom, w * 0.64, h * 0.8)
    ctx.restore()
  }

  /** The retained output, whether baked on GPU or CPU, has one owner. */
  dispose(): void {
    this.surfaces.releaseAll()
    this.moon = null
    this.star = null
    this.glitter = null
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
