import type { SurfaceLight } from './ribbons'

// Quantize the *irradiance*, not the source identity. Overlapping warm/cool
// lights mix continuously before quantization. The matte and enamel receivers
// share transport but differ in reflectance and grazing sheen.
const brushes = new WeakMap<
  CanvasRenderingContext2D,
  Map<string, CanvasGradient>
>()
export function material(
  ctx: CanvasRenderingContext2D,
  base: string,
  l: SurfaceLight | undefined,
  face: number,
): string | CanvasGradient {
  if (!l) return base
  const dx = (l.dx + l.keyX * 0.25) * face,
    dy = l.dy - 0.38
  const length = Math.hypot(dx, dy) || 1
  const x = Math.round((5 * dx) / length),
    y = Math.round((5 * dy) / length)
  const bin = (v: number) => Math.round(16 * Math.min(2.5, v))
  const r = bin(l.r + 0.21 * l.keyGain),
    g = bin(l.g + 0.29 * l.keyGain),
    b = bin(l.b + 0.4 * l.keyGain)
  const key = `${base}:${x}:${y}:${r}:${g}:${b}`
  let cache = brushes.get(ctx)
  if (!cache) {
    cache = new Map()
    brushes.set(ctx, cache)
  }
  const hit = cache.get(key)
  if (hit) return hit
  const mat = parseInt(base.slice(1), 16),
    matte = mat === 0
  const gradient = ctx.createLinearGradient(
    -x * 4,
    -18 - y * 6,
    x * 4,
    -18 + y * 6,
  )
  const shade = (diffuse: number, spec: number) => {
    const ch = (shift: number, energy: number) => {
      const albedo = (mat >> shift) & 255,
        incident = energy / 16
      const v =
        albedo * (0.49 + diffuse * incident) +
        (matte ? 46 : 70) * spec * incident
      return Math.min(255, Math.round(v))
    }
    return `rgb(${ch(16, r)},${ch(8, g)},${ch(0, b)})`
  }
  gradient.addColorStop(0, shade(0.12, 0.045))
  gradient.addColorStop(0.46, shade(0.49, 0.13))
  gradient.addColorStop(0.84, shade(0.85, 0.48))
  gradient.addColorStop(1, shade(0.9, 0.94))
  if (cache.size >= 256) cache.delete(cache.keys().next().value!)
  cache.set(key, gradient)
  return gradient
}
