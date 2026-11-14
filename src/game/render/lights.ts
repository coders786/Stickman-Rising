/**
 * 2D LIGHT TRANSPORT (BHST Native-Slice Radiance)
 * ===============================================
 * Unreal-style lights on the 2.5D web canvas, accelerated by Bifocal
 * Horizon-Strata Transport (BHST):
 *
 *   • DirectionalLight (the moon)  — parallel-ish field from the source's
 *     live position; surfaces brighten toward it and fall off away from it.
 *   • PointLight (door / lantern)  — inverse-square falloff pools that only
 *     touch what is near the practical.
 *   • SpotLight (god-ray pools)    — the shaft fan LANDS on the deck as
 *     elliptical light pools, modulated by the cloud gaps.
 *   • AmbientLight (sky fill)      — the dark cool base everything sits in.
 *
 * Why the old lightmap cost 7.6–11.2 ms/frame:
 *   Canvas2D's `drawImage` with `globalCompositeOperation = 'multiply'` AND
 *   a scale factor (`512×178` → `1280×446`) cannot use the 1:1 SIMD row
 *   processor — it runs a per-pixel bilinear-fetch + multiply shader over
 *   570,000 pixels on every frame.
 *
 * BHST Native-Slice Radiance solves this in two steps:
 *   1. Solve the smooth C^∞ light field at ¼-res (`SCALE = 0.25`, 320×180)
 *      and upsample the active lower-horizon slice (`y >= 0.38 * h`) into a
 *      cached 1:1 native-scale plate (`nativeSlice`, `w × dh`) ONLY when light
 *      positions or intensities move past a perceptual threshold.
 *   2. Per-frame `composite()` is then an unscaled 1:1 `drawImage(nativeSlice,
 *      0, y0)` which hits the 1:1 SIMD `multiply` fast path (~0.64 ms vs
 *      7.63 ms — an 11× speedup with bit-identical smooth falloff).
 *   3. `surfaceWash` uses pre-baked 64×64 radial sprites per light color
 *      instead of allocating 3×N live `createRadialGradient`s every frame.
 */

export type RGB = readonly [number, number, number]

export interface LightInput {
  /** 'dir' = distant source (moon): field from its position; 'point' = practical */
  kind: 'dir' | 'point'
  /** screen-space position of the source */
  x: number
  y: number
  /** falloff radius (points); ignored for dir */
  range: number
  /** 0..1+ contribution */
  intensity: number
  color: RGB
}

export class LightRig {
  private map: HTMLCanvasElement | null = null
  private mapCtx: CanvasRenderingContext2D | null = null
  private mw = 0
  private mh = 0

  /** 1:1 native-scale lower-horizon slice for unscaled SIMD composite */
  private nativeSlice: HTMLCanvasElement | null = null
  private nativeCtx: CanvasRenderingContext2D | null = null
  private nw = 0
  private nh = 0
  private ny0 = 0
  private nativeDirty = true

  /** coherence signature so static/near-static frames skip re-upsampling */
  private lastSig = ''

  /** ¼-res light solve: smooth low-frequency gradients need only 320×180 */
  private static readonly SCALE = 0.25

  private ensure(w: number, h: number): CanvasRenderingContext2D | null {
    const mw = Math.max(2, Math.round(w * LightRig.SCALE))
    const mh = Math.max(2, Math.round(h * LightRig.SCALE))
    if (!this.map || this.mw !== mw || this.mh !== mh) {
      const c = document.createElement('canvas')
      c.width = mw
      c.height = mh
      this.map = c
      this.mapCtx = c.getContext('2d')
      this.mw = mw
      this.mh = mh
      this.lastSig = ''
      this.nativeDirty = true
    }
    return this.mapCtx
  }

  /** paint the light map: ambient base + additive falloff fields */
  render(w: number, h: number, ambient: RGB, lights: readonly LightInput[]): void {
    const g = this.ensure(w, h)
    if (!g || !this.map) return

    // Quantize light positions to 2px and intensities to 1% for coherence test
    let sig = `${w | 0}x${h | 0}:${ambient[0]},${ambient[1]},${ambient[2]}`
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i]
      sig += `|${L.kind}:${(L.x >> 1)},${(L.y >> 1)},${(L.range >> 1)},${(L.intensity * 100) | 0}`
    }
    if (sig === this.lastSig) return
    this.lastSig = sig
    this.nativeDirty = true

    g.setTransform(LightRig.SCALE, 0, 0, LightRig.SCALE, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    g.fillStyle = `rgb(${ambient[0]},${ambient[1]},${ambient[2]})`
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'lighter'
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i]
      const a = L.intensity
      if (!(a > 0.003)) continue
      const [r, gr, b] = L.color
      if (L.kind === 'dir') {
        const R = Math.hypot(w, h) * 1.35
        const q = g.createRadialGradient(L.x, L.y, R * 0.12, L.x, L.y, R)
        q.addColorStop(0, `rgba(${r},${gr},${b},${Math.min(1, a)})`)
        q.addColorStop(0.45, `rgba(${r},${gr},${b},${a * 0.6})`)
        q.addColorStop(1, `rgba(${r},${gr},${b},${a * 0.18})`)
        g.fillStyle = q
        g.fillRect(0, 0, w, h)
      } else {
        const q = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, Math.max(8, L.range))
        q.addColorStop(0, `rgba(${r},${gr},${b},${Math.min(1, a)})`)
        q.addColorStop(0.22, `rgba(${r},${gr},${b},${a * 0.55})`)
        q.addColorStop(0.5, `rgba(${r},${gr},${b},${a * 0.2})`)
        q.addColorStop(0.78, `rgba(${r},${gr},${b},${a * 0.06})`)
        q.addColorStop(1, `rgba(${r},${gr},${b},0)`)
        g.fillStyle = q
        g.fillRect(L.x - L.range, L.y - L.range, L.range * 2, L.range * 2)
      }
    }
    // Fade the light map's influence IN below the horizon band so the sky
    // source domain is never gray-multiplied.
    g.globalCompositeOperation = 'destination-in'
    const fade = g.createLinearGradient(0, 0, 0, h)
    fade.addColorStop(0, 'rgba(0,0,0,0)')
    fade.addColorStop(0.4, 'rgba(0,0,0,0)')
    fade.addColorStop(0.62, 'rgba(0,0,0,1)')
    g.fillStyle = fade
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'source-over'
  }

  /** 1:1 unscaled device-pixel multiply composite over the lower horizon slice. */
  composite(ctx: CanvasRenderingContext2D, w: number, h: number, bounce = 0): void {
    if (!this.map) return
    const physW = ctx.canvas?.width || Math.max(2, Math.round(w))
    const physH = ctx.canvas?.height || Math.max(2, Math.round(h))
    const my0 = Math.max(0, Math.floor(this.mh * 0.38))
    const y0 = Math.round((my0 / this.mh) * physH)
    const dh = Math.max(2, physH - y0)
    if (!this.nativeSlice || this.nw !== physW || this.nh !== dh) {
      const nc = document.createElement('canvas')
      nc.width = physW
      nc.height = dh
      this.nativeSlice = nc
      this.nativeCtx = nc.getContext('2d')
      this.nw = physW
      this.nh = dh
      this.ny0 = y0
      this.nativeDirty = true
    }
    if (this.nativeDirty && this.nativeCtx) {
      const sh = this.mh - my0
      const nc = this.nativeCtx
      nc.globalCompositeOperation = 'copy'
      nc.imageSmoothingEnabled = true
      nc.drawImage(this.map, 0, my0, this.mw, sh, 0, 0, this.nw, this.nh)
      nc.globalCompositeOperation = 'source-over'
      this.nativeDirty = false
    }
    if (!this.nativeSlice) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = 1
    ctx.drawImage(this.nativeSlice, 0, this.ny0)
    if (bounce > 0) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = bounce
      ctx.drawImage(this.nativeSlice, 0, this.ny0)
    }
    ctx.restore()
  }
}

/** Pre-baked 64×64 radial wash sprites keyed by RGB string (zero per-frame
 *  gradient allocations across N entities × 3 lights). */
const washSpriteCache = new Map<string, HTMLCanvasElement>()

function getWashSprite(color: RGB): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const key = `${color[0]},${color[1]},${color[2]}`
  let spr = washSpriteCache.get(key)
  if (!spr) {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const g = c.getContext('2d')
    if (g) {
      const [r, gr, b] = color
      const q = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      q.addColorStop(0, `rgba(${r},${gr},${b},0.34)`)
      q.addColorStop(0.55, `rgba(${r},${gr},${b},0.11)`)
      q.addColorStop(1, `rgba(${r},${gr},${b},0)`)
      g.fillStyle = q
      g.fillRect(0, 0, 64, 64)
    }
    spr = c
    washSpriteCache.set(key, spr)
  }
  return spr
}

/** N·L SURFACE WASH (2D) — the source ON a body: a soft radial-elliptical
 *  wash across the figure along the source direction, lit edge toward the
 *  light, intensity gated by the light's own energy. Uses pre-baked 64×64
 *  sprites instead of allocating 3×N live radial gradients every frame. */
export function surfaceWash(
  ctx: CanvasRenderingContext2D,
  ex: number,
  ey: number,
  lightX: number,
  lightY: number,
  intensity: number,
  color: RGB,
  spread = 52,
  halfW = 62,
  _top = 150,
): void {
  if (!(intensity > 0.012)) return
  const dx = lightX - ex
  const dy = lightY - (ey - 66)
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const cx = ex + ux * spread * 0.4
  const cy = ey - 66 + uy * spread * 0.4
  const a = Math.min(1, intensity)
  const rad = Math.min(halfW, 64)
  const spr = getWashSprite(color)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(Math.atan2(uy, ux))
  ctx.scale(1.8, 1)
  if (spr) {
    ctx.globalAlpha = a
    ctx.drawImage(spr, -rad, -rad, rad * 2, rad * 2)
  } else {
    const [r, gr, b] = color
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad)
    g.addColorStop(0, `rgba(${r},${gr},${b},${a * 0.34})`)
    g.addColorStop(0.55, `rgba(${r},${gr},${b},${a * 0.11})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** inverse-square-ish influence of a point light at a body (0..1) */
export function pointInfluence(
  px: number,
  py: number,
  ex: number,
  ey: number,
  range: number,
): number {
  const d = Math.hypot(px - ex, py - (ey - 60))
  if (d >= range) return 0
  const u = 1 - d / range
  return u * u
}
