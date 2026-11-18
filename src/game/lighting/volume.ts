/** Object-space normal tiles. A tile shades an entire brush; stamping it in
 * the existing path changes neither the silhouette nor the draw count. */
import { gameLedger, hasPixels } from '../render/ledger'
import type { SurfaceLight } from './ribbons'

const N = 32,
  dirs = 32
const lobes = new Map<number, Uint8Array>()
function lobe(dir: number, tube: boolean, matte: boolean): Uint8Array {
  const key = dir + dirs * (Number(tube) + 2 * Number(matte)),
    hit = lobes.get(key)
  if (hit) return hit
  const data = new Uint8Array(N * N * 2),
    theta = (dir * Math.PI * 2) / dirs
  // The key has an oblique view component. N.L models incidence and N.H
  // gives enamel a narrower specular lobe than the player's rough cloth.
  const lx = Math.cos(theta) * 0.84,
    ly = Math.sin(theta) * 0.84,
    lz = Math.sqrt(1 - 0.84 ** 2)
  const hl = Math.hypot(lx, ly, lz + 1)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let nx = (2 * x + 1) / N - 1,
        ny = tube ? 0 : (2 * y + 1) / N - 1
      const radius = Math.hypot(nx, ny)
      if (radius > 1) {
        nx /= radius
        ny /= radius
      }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)),
        i = (y * N + x) * 2
      data[i] = Math.round(255 * Math.max(0, nx * lx + ny * ly + nz * lz))
      data[i + 1] = Math.round(
        255 *
          Math.max(0, (nx * lx + ny * ly + nz * (lz + 1)) / hl) **
            (matte ? 8 : 24),
      )
    }
  lobes.set(key, data)
  return data
}
const brushes = new WeakMap<
  CanvasRenderingContext2D,
  Map<string, CanvasPattern>
>()
const staging = new WeakMap<
  CanvasRenderingContext2D,
  { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; img: ImageData }
>()
export function volumeBrush(
  ctx: CanvasRenderingContext2D,
  base: string,
  light: SurfaceLight | undefined,
  face: number,
  x: number,
  y: number,
  rx: number,
  ry: number,
  angle: number,
  tube: boolean,
  fallback: string | CanvasGradient,
  localRotation = 0,
): string | CanvasGradient | CanvasPattern {
  if (!light?.volume || typeof document === 'undefined') return fallback
  // Convert world light to receiver-local axes, including the actor's flip.
  const theta =
    Math.atan2(light.dy - 0.38, (light.dx + light.keyX * 0.32) * face) -
    angle -
    localRotation
  const dir = (Math.round((theta * dirs) / (2 * Math.PI)) + dirs * 2) % dirs
  const bin = (e: number) => Math.min(32, Math.max(0, Math.round(e * 16)))
  const r = bin(light.r + 0.3 * light.keyGain),
    g = bin(light.g + 0.39 * light.keyGain),
    b = bin(light.b + 0.53 * light.keyGain)
  const key = `${dir}:${+tube}:${base}:${r},${g},${b}`
  let cache = brushes.get(ctx)
  if (!cache) {
    cache = new Map()
    brushes.set(ctx, cache)
  }
  let pattern = cache.get(key)
  if (!pattern) {
    let scratch = staging.get(ctx)
    if (!scratch || !hasPixels(scratch.canvas)) {
      const canvas = gameLedger.acquire('material:normal-staging', N, N, 'lighting', true) as HTMLCanvasElement
      const g = canvas.getContext('2d')
      if (!g) return fallback
      scratch = { canvas, g, img: g.createImageData(N, N) }
      staging.set(ctx, scratch)
    }
    const { canvas: tile, g: tc, img } = scratch
    const mat = parseInt(base.slice(1), 16),
      matte = mat === 0,
      terms = lobe(dir, tube, matte)
    const albedo = [mat >> 16, (mat >> 8) & 255, mat & 255],
      energy = [r / 16, g / 16, b / 16]
    for (let i = 0; i < N * N; i++) {
      const diffuse = terms[i * 2] / 255,
        spec = terms[i * 2 + 1] / 255
      for (let c = 0; c < 3; c++)
        img.data[4 * i + c] =
          albedo[c] * 0.39 +
          energy[c] *
            ((matte ? 31 : albedo[c] * 0.79) * diffuse +
              (matte ? 9 : 64) * spec)
      img.data[4 * i + 3] = 255
    }
    tc.putImageData(img, 0, 0)
    pattern = ctx.createPattern(tile, 'repeat') ?? undefined
    if (!pattern) return fallback
    if (cache.size >= 128) cache.delete(cache.keys().next().value!)
    cache.set(key, pattern)
  }
  const cs = Math.cos(angle),
    sn = Math.sin(angle),
    a = (cs * 2 * rx) / N,
    b0 = (sn * 2 * rx) / N,
    c = (-sn * 2 * ry) / N,
    d = (cs * 2 * ry) / N
  pattern.setTransform({
    a,
    b: b0,
    c,
    d,
    e: x - ((a + c) * N) / 2,
    f: y - ((b0 + d) * N) / 2,
  })
  return pattern
}
