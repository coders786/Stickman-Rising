/** Ultra screen lighting. One capture in backing pixels, squared at 1/8 CSS
 * resolution. Bloom is registered to the source at both scales. Rays scatter
 * only a feathered patch around each emitter, never a translated whole frame. */
import { SurfaceScope, hasPixels } from './ledger'

/** Blits the bloom pass may issue: capture + copy + square + downsample + 2 additive scales. */
export const BLOOM_BLITS = 6
/** Additive taps the ray pass may issue (on top of its own capture+square). */
export const RAY_BLITS = 8

/** How far the ray taps travel, as a fraction of the frame's short side. */
const RAY_REACH = 0.22
/** Weight of the first tap of a full-strength source. */
const RAY_GAIN = 0.012
/** Each subsequent tap is this × the last. */
const RAY_DECAY = 0.62
/** Per-tap ceiling, so one bright source can never own the whole budget. */
const RAY_CLAMP = 0.01
/** The two additive bloom scales (tight carry + wide skirt). */
const BLOOM_TIGHT = 0.15
const BLOOM_WIDE = 0.042

/** Screen position, gain and optional fixed share of the tap budget. */
export type RaySource = readonly [x: number, y: number, weight: number, taps?: number]

/** THE RAY TAPS, as a pure function.
 *
 *  Kept apart from the drawing so the budget is testable without a canvas:
 *  given the on-screen sources this returns exactly the blits `godRays` will
 *  issue — never more than `RAY_BLITS`, marching outward from the frame centre
 *  towards each source, alpha decay already applied. */
export function rayPlan(
  lights: readonly RaySource[],
  strength: number,
  w: number,
  h: number,
): Array<{ lx: number; ly: number; dx: number; dy: number; alpha: number }> {
  const out: Array<{ lx: number; ly: number; dx: number; dy: number; alpha: number }> = []
  if (strength <= 0.001 || w < 32 || h < 32) return out
  const reach = Math.min(w, h) * RAY_REACH
  for (const [lx, ly, weight, count = 4] of lights) {
    if (weight <= 0.02 || lx < -120 || lx > w + 120 || ly < -120 || ly > h + 120) continue
    // Bring the first tap up from zero instead of jumping at the cull threshold.
    let alpha = RAY_GAIN * Math.min(1, (weight - 0.02) / 0.98) * strength
    for (let i = 1; i <= count && out.length < RAY_BLITS; i++) {
      const t = (i / count) * reach
      out.push({
        lx,
        ly,
        dx: ((lx - w * 0.5) / Math.max(1, w * 0.5)) * t,
        dy: ((ly - h * 0.5) / Math.max(1, h * 0.5)) * t,
        alpha: Math.min(RAY_CLAMP, alpha),
      })
      alpha *= RAY_DECAY
    }
    if (out.length >= RAY_BLITS) break
  }
  return out
}

export class PostStack {
  private readonly surfaces = new SurfaceScope('post')

  dispose(): void {
    this.surfaces.releaseAll()
    this.buf = this.sq = this.patch = null
    this.feather = null
  }

  /** The downscale (`buf`) and its squared copy (`sq`). Both pinned: they live
   *  for the whole run, so re-acquiring them per frame would be churn. */
  private buf: HTMLCanvasElement | null = null
  private sq: HTMLCanvasElement | null = null
  private bufW = 0
  private bufH = 0
  private patch: HTMLCanvasElement | null = null
  private feather: CanvasGradient | null = null

  /** Blits issued last frame — this pass's receipt, shown in the debug overlay. */
  lastBloomBlits = 0
  lastRayBlits = 0
  lastLensBlits = 0

  /** One capture for both effects. Zero strengths omit the respective pass. */
  compose(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    lights: readonly RaySource[],
    rays: number,
    bloom: number,
  ): void {
    this.lastBloomBlits = this.lastRayBlits = this.lastLensBlits = 0
    if (w < 32 || h < 32 || (bloom <= 0.001 && (!lights.length || rays <= 0.001))) return
    const sq = this.captureSquared(ctx, w, h, 8)
    if (!sq || !this.buf) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const taps = rayPlan(lights, rays, w, h)
    if (taps.length) {
      // A cropped source footprint with a soft border. A bright sword at the
      // opposite edge of the screen must not radiate from this lamp.
      const n = 32,
        size = Math.min(240, w * 0.35, h * 0.45)
      if (!this.patch || !hasPixels(this.patch)) {
        this.patch = this.surfaces.acquire('source', n, n, 'post')
        this.feather = null
      }
      const g = this.patch.getContext('2d')
      if (g && hasPixels(this.patch)) {
        if (!this.feather) {
          this.feather = g.createRadialGradient(n / 2, n / 2, 1, n / 2, n / 2, n / 2)
          this.feather.addColorStop(0, '#fff')
          this.feather.addColorStop(1, 'rgba(255,255,255,0)')
        }
        let lastX = NaN,
          lastY = NaN
        for (const tap of taps) {
          const x = tap.lx - size / 2,
            y = tap.ly - size / 2
          if (x !== lastX || y !== lastY) {
            g.globalCompositeOperation = 'source-over'
            g.clearRect(0, 0, n, n)
            g.drawImage(
              sq,
              (x * this.bufW) / w,
              (y * this.bufH) / h,
              (size * this.bufW) / w,
              (size * this.bufH) / h,
              0,
              0,
              n,
              n,
            )
            g.globalCompositeOperation = 'destination-in'
            g.fillStyle = this.feather
            g.fillRect(0, 0, n, n)
            // Anamorphic highlight: stretch only the masked bright core into a
            // fine horizontal glint. One small blit per sampled emitter; the
            // stage has at most five including the moon, and uses one capture.
            const width = size * 0.8, height = size * 0.035
            ctx.globalAlpha = Math.min(0.13, tap.alpha * 48)
            ctx.drawImage(this.patch, tap.lx - width / 2, tap.ly - height / 2, width, height)
            this.lastLensBlits++
            lastX = x
            lastY = y
          }
          ctx.globalAlpha = tap.alpha
          ctx.drawImage(this.patch, x + tap.dx, y + tap.dy, size, size)
          this.lastRayBlits++
        }
      }
    }
    if (bloom > 0.001) {
      // Broaden the footprint by downsampling, not scaling about the viewport
      // centre (which produces displaced copies of highlights near the edges).
      const cw = Math.max(2, Math.floor(this.bufW / 3)),
        ch = Math.max(2, Math.floor(this.bufH / 3))
      const g = this.buf.getContext('2d')!
      g.clearRect(0, 0, cw, ch)
      g.drawImage(sq, 0, 0, cw, ch)
      const tight = Math.min(0.22, BLOOM_TIGHT * bloom)
      const mix = sq.getContext('2d')!
      mix.save()
      mix.globalCompositeOperation = 'lighter'
      mix.globalAlpha = Math.min(0.09, BLOOM_WIDE * bloom) / tight
      mix.drawImage(this.buf, 0, 0, cw, ch, 0, 0, this.bufW, this.bufH)
      mix.restore()
      ctx.globalAlpha = tight
      ctx.drawImage(sq, 0, 0, w, h)
      this.lastBloomBlits = BLOOM_BLITS
    }
    ctx.restore()
  }

  /** Capture the frame at 1/`div` scale and square it (a cheap luminance
   *  cut-off). Three blits: capture, copy, multiply. Returns the squared buffer. */
  private captureSquared(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    div: number,
  ): HTMLCanvasElement | null {
    const bw = Math.max(8, Math.ceil(w / div))
    const bh = Math.max(8, Math.ceil(h / div))
    const pair = this.ensure(bw, bh)
    if (!pair) return null
    const [buf, sq] = pair
    const g = buf.getContext('2d')
    const h2 = sq.getContext('2d')
    if (!g || !h2) return null
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    // Prefilter the minification: default bilinear sampling can skip an
    // entire sign stroke at 1/8 scale and sample its full brightness a pixel later.
    g.imageSmoothingQuality = 'medium'
    g.clearRect(0, 0, bw, bh)
    g.drawImage(ctx.canvas, 0, 0, bw, bh)
    h2.globalCompositeOperation = 'source-over'
    h2.globalAlpha = 1
    h2.clearRect(0, 0, bw, bh)
    h2.drawImage(buf, 0, 0, bw, bh, 0, 0, bw, bh)
    // multiply with itself: value² — the threshold this pass cannot afford
    h2.globalCompositeOperation = 'multiply'
    h2.drawImage(buf, 0, 0, bw, bh, 0, 0, bw, bh)
    return sq
  }

  /** The buffer pair, through the ledger (counted, marked pinned, never evicted). */
  private ensure(w: number, h: number): [HTMLCanvasElement, HTMLCanvasElement] | null {
    if (typeof document === 'undefined') return null
    if (this.bufW === w && this.bufH === h && hasPixels(this.buf) && hasPixels(this.sq)) {
      return [this.buf, this.sq]
    }
    const a = this.surfaces.acquire('buf', w, h, 'post')
    const b = this.surfaces.acquire('sq', w, h, 'post')
    if (!hasPixels(a) || !hasPixels(b)) return null
    this.buf = a
    this.sq = b
    this.bufW = w
    this.bufH = h
    return [a, b]
  }

  /** One line for the debug overlay. */
  summary(): string {
    if (this.lastBloomBlits === 0 && this.lastRayBlits === 0) return 'post off'
    return `post b${this.lastBloomBlits} r${this.lastRayBlits} lens${this.lastLensBlits}`
  }

  /** For the tests / QA: the live buffer size, or null when nothing is allocated. */
  bufferSize(): readonly [number, number] | null {
    return this.buf && hasPixels(this.buf) ? [this.bufW, this.bufH] : null
  }
}
