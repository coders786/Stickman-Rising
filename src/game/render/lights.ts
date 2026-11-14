/**
 * 2D LIGHT TRANSPORT — Unreal-style lights on the web canvas.
 *
 * The scene had a veil problem: brightness was painted as full-frame lifts
 * (glow pockets, pools, inscatter bands) that floated OVER the art instead
 * of light arriving FROM sources and landing ON surfaces. This module is
 * the fix — a real light rig:
 *
 *   • DirectionalLight (the moon)  — parallel-ish field from the source's
 *     live position; surfaces brighten toward it and fall off away from it.
 *   • PointLight (door / lantern)  — inverse-square falloff pools that only
 *     touch what is near the practical.
 *   • SpotLight (god-ray pools)    — the shaft fan LANDS on the deck as
 *     elliptical light pools, modulated by the cloud gaps.
 *   • AmbientLight (sky fill)      — the dark cool base everything sits in.
 *
 * Pipeline (a 2D deferred pass, the canvas answer to UE's light types):
 *   1. the scene is drawn as plain albedo (as before),
 *   2. a LIGHT MAP is rendered at half res: ambient + every light's falloff,
 *   3. the map multiplies the scene — light LANDS with real falloff,
 *   4. a faint colored bounce copy lifts the shadows the way lit surfaces
 *      throw light back at their surroundings,
 *   5. per-figure surface washes (N·L in 2D) put the source ON the bodies:
 *      the lit edge faces the moon, warm bounce arrives from the practicals.
 *
 * Everything is allocation-bounded: one map canvas reused across frames,
 * one wash gradient per figure per light.
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
  private mw = 0
  private mh = 0
  /** half-res map: real falloff curves at a quarter of the fill cost */
  private static readonly SCALE = 0.5

  private ensure(w: number, h: number): CanvasRenderingContext2D | null {
    const mw = Math.max(2, Math.round(w * LightRig.SCALE))
    const mh = Math.max(2, Math.round(h * LightRig.SCALE))
    if (!this.map || this.mw !== mw || this.mh !== mh) {
      const c = document.createElement('canvas')
      c.width = mw
      c.height = mh
      this.map = c
      this.mw = mw
      this.mh = mh
    }
    return this.map.getContext('2d')
  }

  /** paint the light map: ambient base + additive falloff fields */
  render(w: number, h: number, ambient: RGB, lights: readonly LightInput[]): void {
    const g = this.ensure(w, h)
    if (!g) return
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
        // DIRECTIONAL FIELD — the frame sits INSIDE the falloff radius, so the
        // modulation is gentle: bright toward the source's side, dimming away
        // from it (light LANDS on surfaces with directionality, no veil).
        const R = Math.hypot(w, h) * 1.35
        const q = g.createRadialGradient(L.x, L.y, R * 0.12, L.x, L.y, R)
        q.addColorStop(0, `rgba(${r},${gr},${b},${Math.min(1, a)})`)
        q.addColorStop(0.45, `rgba(${r},${gr},${b},${a * 0.6})`)
        q.addColorStop(1, `rgba(${r},${gr},${b},${a * 0.18})`)
        g.fillStyle = q
        g.fillRect(0, 0, w, h)
      } else {
        // POINT — inverse-square-ish falloff: tight hot core, long tail.
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
    g.globalCompositeOperation = 'source-over'
  }

  /** multiply the albedo by the map (light lands), then a faint colored
   *  bounce so shadow sides pick up spill instead of going dead. */
  composite(ctx: CanvasRenderingContext2D, w: number, h: number, bounce = 0.05): void {
    if (!this.map) return
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = 1
    ctx.drawImage(this.map, 0, 0, w, h)
    if (bounce > 0) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = bounce
      ctx.drawImage(this.map, 0, 0, w, h)
    }
    ctx.restore()
  }
}

/** N·L SURFACE WASH (2D) — the source ON a body: a soft linear gradient
 *  across the figure along the source direction, lit edge toward the light,
 *  falling into shadow away from it, intensity gated by the light's own
 *  energy (a cloud crossing the moon dims every figure). One gradient per
 *  figure per light. World coordinates. */
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
  top = 150,
): void {
  if (!(intensity > 0.012)) return
  const dx = lightX - ex
  const dy = lightY - (ey - 66)
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const cx = ex + ux * spread * 0.5
  const cy = ey - 66 + uy * spread * 0.5
  const g = ctx.createLinearGradient(cx - ux * spread, cy - uy * spread, cx + ux * spread, cy + uy * spread)
  const [r, gr, b] = color
  const a = Math.min(1, intensity)
  g.addColorStop(0, `rgba(${r},${gr},${b},${a * 0.5})`)
  g.addColorStop(0.55, `rgba(${r},${gr},${b},${a * 0.14})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(ex - halfW, ey - top, halfW * 2, top + 12)
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
