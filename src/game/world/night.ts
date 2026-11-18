/** Per-run sky plates and wet-deck glitter. Actor lighting lives in render/surface-light. */
import type { EnvironmentProfile } from './profile'
import type { MoodPalette } from './mood'
import { bakeMoonPlate, bakeStarPlate, type Plate } from '../../gpu/sky'
import { rgbaConst } from '../render/color'
import { SurfaceGen } from '../render/ledger'

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

/** This run's plated sprites. One generation: `dispose()` releases all of them
 *  at once, which is exactly what a reseed does (render/ledger.ts). */
const nightGen = new SurfaceGen('night:')

function blank(w: number, h: number): HTMLCanvasElement | null {
  if (!canDraw()) return null
  return nightGen.next(w, h, 'night').c
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

export class NightLayer {
  readonly profile: EnvironmentProfile
  private readonly mood: MoodPalette
  private moon: Plate | null = null
  private star: Plate | null = null
  private glitter: HTMLCanvasElement | null = null
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

  /** Zero the backing stores. Called on reseed and on teardown — this is the
   *  ledger's rule expressed for objects the ledger does not own. */
  dispose(): void {
    // The ledger owns the backing stores: releasing the generation zeroes them
    // and frees the accounting in one call.
    nightGen.begin()
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
