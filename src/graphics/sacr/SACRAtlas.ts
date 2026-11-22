import type { RGB } from './SACRPacker'

export const STRATUM_W = 512
export const STRATUM_H = 128
export const STRATUM_MAX_LOD = 3 // 512×128 → 256×64 → 128×32 → 64×16
export const STRATUM_CURB_HEIGHT = 6.5
export interface StratumMip { readonly w: number; readonly h: number; readonly data: Uint32Array<ArrayBuffer> }

/** Shared exponent, unsigned REV format. R occupies the lowest nine bits. */
const floatView = new Float32Array(1), bitsView = new Uint32Array(floatView.buffer)
const invStep = Float64Array.from({ length: 32 }, (_, e) => 2 ** (24 - e))

export function encodeRGB9E5(r: number, g: number, b: number): number {
  const limit = 65408
  r = Math.min(Math.max(0, r), limit); g = Math.min(Math.max(0, g), limit); b = Math.min(Math.max(0, b), limit)
  const maxC = Math.max(r, g, b)
  if (!(maxC >= 2 ** -25)) return 0
  // Exponent lookup replaces log2/pow in the inner atlas bake. A float32
  // round-up across a power of two already needs the next 9-bit exponent.
  floatView[0] = maxC
  let exp = Math.max(0, (bitsView[0] >>> 23) - 111), mul = invStep[exp]
  if (maxC * mul >= 511.5) { exp++; mul *= .5 }
  return (((r * mul + .5) | 0) | (((g * mul + .5) | 0) << 9) | (((b * mul + .5) | 0) << 18) | (exp << 27)) >>> 0
}

export function decodeRGB9E5(word: number): RGB {
  const m = 2 ** ((word >>> 27) - 24)
  return [(word & 511) * m, ((word >>> 9) & 511) * m, ((word >>> 18) & 511) * m]
}

/** CPU-side prefilter of two independent bands in *linear* space before
 * encoding each level. The rolling atlas's row zero is ground level, so no
 * upload-time Y flip is needed (nor is it legal for these typed arrays). */
export function bakeStratumMips(rgbLinear: Float32Array): StratumMip[] {
  if (rgbLinear.length !== STRATUM_W * STRATUM_H * 3) throw new RangeError('Stratum B must be 512×128 RGB')
  const mips: StratumMip[] = []
  let w = STRATUM_W, h = STRATUM_H, src = rgbLinear
  for (let level = 0; level <= STRATUM_MAX_LOD; level++) {
    const data = new Uint32Array(w * h)
    for (let i = 0, s = 0; i < data.length; i++, s += 3) data[i] = encodeRGB9E5(src[s], src[s + 1], src[s + 2])
    mips.push({ w, h, data })
    if (level === STRATUM_MAX_LOD) break
    const nw = w >> 1, nh = h >> 1
    const out = new Float32Array(nw * nh * 3)
    for (let band = 0; band < 2; band++) {
      const srcY = band * (h >> 1), dstY = band * (nh >> 1)
      for (let y = 0; y < nh / 2; y++) for (let x = 0; x < nw; x++) {
        const a = ((srcY + y * 2) * w + x * 2) * 3, b = a + w * 3
        const d = ((dstY + y) * nw + x) * 3
        for (let k = 0; k < 3; k++) out[d + k] = (src[a + k] + src[a + 3 + k] + src[b + k] + src[b + 3 + k]) * .25
      }
    }
    src = out; w = nw; h = nh
  }
  return mips
}

/** A base-level half-texel guard is too small at mip 3. Clamp against the
 * coarsest sampled level *also* in the shader, to prevent trilinear bleed. */
export function stratumV(height: number, interior: boolean, lod: number): number {
  const lo = interior ? .5 : 0, hi = lo + .5
  const inset = .5 * 2 ** Math.ceil(Math.max(0, Math.min(STRATUM_MAX_LOD, lod))) / STRATUM_H
  const t = Math.max(0, Math.min(1, height))
  return Math.max(lo + inset, Math.min(hi - inset, lo + .004 + t * .492))
}

/** CPU sampler for deterministic comparisons against the actual packed levels. */
export function sampleStratumMips(mips: readonly StratumMip[], u: number, v: number, level: number): RGB {
  const lod = Math.max(0, Math.min(STRATUM_MAX_LOD, level)), l = Math.floor(lod), k = Math.min(l + 1, STRATUM_MAX_LOD)
  const one = ({ w, h, data }: StratumMip): RGB => {
    const x = u * w - .5, y = v * h - .5, x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0
    const at = (x: number, y: number) => decodeRGB9E5(data[Math.max(0, Math.min(h - 1, y)) * w + ((x % w) + w) % w])
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1)
    const lerp = (i: number) => (a[i] * (1 - tx) + b[i] * tx) * (1 - ty) + (c[i] * (1 - tx) + d[i] * tx) * ty
    return [lerp(0), lerp(1), lerp(2)]
  }
  const a = one(mips[l]), b = one(mips[k]), t = lod - l
  return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t]
}
