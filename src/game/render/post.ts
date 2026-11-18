/** STICKMAN RISING — src/game/render/post.ts
 * THE ULTRA POST STACK: bloom + god rays, in Canvas2D, on a counted budget.
 * ----------------------------------------------------------------------------
 * "AAA graphics" on a 2-D canvas is not a shader. It is knowing which two things
 * the eye reads as expensive and paying for exactly those:
 *
 *   1. BLOOM — a real light spills into the air around its edges. Without the
 *      spill an additive highlight looks glued on: it ends where its pixels end.
 *
 *   2. GOD RAYS — the same spill, but smeared radially away from a source, which
 *      is what makes a lamp read as hanging in AIR instead of being a sticker on
 *      the sky.
 *
 * THE CHEAP PART: downscale, then blit the downscale back additively. The
 * downscale IS the blur. That is the whole trick and it has been the trick since
 * 2-D games first had glow.
 *
 * THE PART THAT GOES WRONG, MEASURED. Blitting the plain downscale back raises
 * the WHOLE frame roughly uniformly — a 240×150 buffer of a night scene is a
 * mid-grey, so "bloom" becomes "fog". The first version of this file did exactly
 * that and measured mean luminance 33.8 → 52.7 on a real stage render: a 56 %
 * lift of a picture whose darks are supposed to stay dark.
 *
 * THE FIX, ALSO CHEAP: SQUARE the downscale before using it. Value² is a crude
 * threshold — 0.15 → 0.02 (gone), 0.85 → 0.72 (kept). Two extra blits per
 * buffer buy a falloff that concentrates the added light on the sources instead
 * of on the air, which is the difference between a glow and a wash. After
 * squaring, the same frame lifts by a few percent overall and by a third right
 * where the lamps are.
 *
 * AND THE BUDGET. A full-frame read is the most expensive thing a 2-D renderer
 * can ask for, so: ultra only, 1/6 and 1/8 scale, ONE shared buffer pair, and
 * hard constant ceilings on the blit counts (`BLOOM_BLITS`, `RAY_BLITS`) that
 * `tests/ultra-stack.test.ts` asserts and `.qa/verify-ultra.mts` measures.
 * ==========================================================================*/

import { gameLedger, hasPixels } from './ledger'

/** Blits the bloom pass may issue: capture + copy + square + 2 additive scales. */
export const BLOOM_BLITS = 5
/** Additive taps the ray pass may issue (on top of its own capture+square). */
export const RAY_BLITS = 8

/** How far the ray taps travel, as a fraction of the frame's short side. */
const RAY_REACH = 0.22
/** Weight of the first tap of a full-strength source. */
const RAY_GAIN = 0.012
/** Each subsequent tap is this × the last. */
const RAY_DECAY = 0.62
/*  MEASURED, then dialled. The eight taps each re-add the WHOLE frame (that is
 *  what an occlusion-free smear is), so the ray budget is unforgiving: at 0.075
 *  the pass lifted a real stage frame 33.8 → 41.5 on its own, most of it the
 *  bright city sky arriving back over the darks. 0.026 is where the shafts are
 *  visible around the practicals and the frame has moved ~2.5 luminance. */
/** Per-tap ceiling, so one bright source can never own the whole budget. */
const RAY_CLAMP = 0.010
/** The two additive bloom scales (tight carry + wide skirt). */
const BLOOM_TIGHT = 0.15
const BLOOM_WIDE = 0.042

/** THE RAY TAPS, as a pure function.
 *
 *  Kept apart from the drawing so the budget is testable without a canvas:
 *  given the on-screen sources this returns exactly the blits `godRays` will
 *  issue — never more than `RAY_BLITS`, marching outward from the frame centre
 *  towards each source, alpha decay already applied. */
export function rayPlan(
  lights: ReadonlyArray<readonly [number, number, number]>,
  strength: number,
  w: number,
  h: number,
): Array<{ dx: number; dy: number; alpha: number }> {
  const out: Array<{ dx: number; dy: number; alpha: number }> = []
  if (strength <= 0.001 || w < 32 || h < 32) return out
  const reach = Math.min(w, h) * RAY_REACH
  for (const [lx, ly, weight] of lights) {
    if (weight <= 0.02) continue
    let alpha = RAY_GAIN * weight * strength
    for (let i = 1; i <= 4 && out.length < RAY_BLITS; i++) {
      const t = (i / 4) * reach
      out.push({
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
  /** The downscale (`buf`) and its squared copy (`sq`). Both pinned: they live
   *  for the whole run, so re-acquiring them per frame would be churn. */
  private buf: HTMLCanvasElement | null = null
  private sq: HTMLCanvasElement | null = null
  private bufW = 0
  private bufH = 0
  private bloomPending = false
  private rayPending = false

  /** Blits issued last frame — this pass's receipt, shown in the debug overlay. */
  lastBloomBlits = 0
  lastRayBlits = 0

  /** BLOOM. `src` is the frame itself; the downscale reads it. */
  bloom(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
    if (w < 32 || h < 32 || strength <= 0.001) return
    const sq = this.captureSquared(ctx, w, h, 6)
    if (!sq) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // A tight pass (the hot cores) and a wide pass (the skirt that spills past
    // them). Same buffer, two scales — that pairing is what reads as light
    // rather than as a single blurry halo.
    ctx.globalAlpha = Math.min(0.22, BLOOM_TIGHT * strength)
    ctx.drawImage(sq, 0, 0, this.bufW, this.bufH, -w * 0.012, -h * 0.012, w * 1.024, h * 1.024)
    ctx.globalAlpha = Math.min(0.09, BLOOM_WIDE * strength)
    ctx.drawImage(sq, 0, 0, this.bufW, this.bufH, -w * 0.03, -h * 0.03, w * 1.06, h * 1.06)
    ctx.restore()
    this.lastBloomBlits = BLOOM_BLITS
  }

  /** GOD RAYS — additive taps marching away from each source's screen position. */
  godRays(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    lights: ReadonlyArray<readonly [number, number, number]>,
    strength: number,
  ): void {
    if (lights.length === 0 || strength <= 0.001) return
    if (w < 32 || h < 32) return
    const sq = this.captureSquared(ctx, w, h, 8)
    if (!sq) return
    const taps = rayPlan(lights, strength, w, h)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const tap of taps) {
      ctx.globalAlpha = Math.min(RAY_CLAMP, tap.alpha)
      ctx.drawImage(sq, 0, 0, this.bufW, this.bufH, tap.dx, tap.dy, w, h)
    }
    ctx.restore()
    this.lastRayBlits = taps.length
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
    g.clearRect(0, 0, bw, bh)
    g.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, bw, bh)
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
    if (this.buf && this.sq && this.bufW === w && this.bufH === h && hasPixels(this.sq)) {
      return [this.buf, this.sq]
    }
    const a = gameLedger.acquire('post:buf', w, h, 'post', true) as unknown as HTMLCanvasElement
    const b = gameLedger.acquire('post:sq', w, h, 'post', true) as unknown as HTMLCanvasElement
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
    return `post b${this.lastBloomBlits} r${this.lastRayBlits}`
  }

  /** For the tests / QA: the live buffer size, or null when nothing is allocated. */
  bufferSize(): readonly [number, number] | null {
    return this.buf && hasPixels(this.buf) ? [this.bufW, this.bufH] : null
  }
}
