import { BAKED_ROOT, unpackBridgePlanes, type PlaneLayout } from './BridgeAssetCodec'

/** Byte-linear authoring data, never an sRGB image decode (A is a signal,
 * not transparency). Rows in every packed plane run ground-up. */
export const MOON_EDGE = 160
export const MOON_UV_SCALE = .46
export const CLOUD_W = 640, CLOUD_H = 144, CLOUD_LAYERS = 2
export const CLOUD_PHASE_W = 160, CLOUD_PHASE_H = 44
export const CLOUD_PHASE_ROW = CLOUD_H * CLOUD_LAYERS
export const CLOUD_ATLAS_H = CLOUD_PHASE_ROW + CLOUD_PHASE_H
export const HORIZON_W = 256, HORIZON_H = 64, HORIZON_SECTORS = 3
export const CITY_MASK_W = 256, CITY_MASK_H = [60, 70] as const
export const SKY_BASIS_URL = `${BAKED_ROOT}sky.bin.br`
export const SKY_PACK_TAG = 'BSK1'
export const SKY_PACK_LAYOUT: PlaneLayout = [
  [MOON_EDGE, MOON_EDGE, 4],
  ...Array.from({ length: CLOUD_LAYERS }, () => [CLOUD_W, CLOUD_H, 4] as const),
  [CLOUD_W, CLOUD_PHASE_H, 4],
  ...Array.from({ length: HORIZON_SECTORS }, () => [HORIZON_W, HORIZON_H, 4] as const),
  ...CITY_MASK_H.map(h => [CITY_MASK_W, h, 4] as const),
]
export const FAR_CITY = { factor: .10, vf: .82, lift: -74, size: 480, aperture: .75 }
export const MID_CITY = { factor: .21, vf: .901, lift: -26, size: 560, aperture: .89 }
export const CITY_PERIOD = 2048
const bytes = (w: number, h: number) => w * h * 4
export const SKY_BASIS_BYTES = bytes(MOON_EDGE, MOON_EDGE) + bytes(CLOUD_W, CLOUD_ATLAS_H) +
  bytes(HORIZON_W, HORIZON_H * HORIZON_SECTORS) + bytes(CITY_MASK_W, CITY_MASK_H[0] + CITY_MASK_H[1])

export type SkyBasis = { lunar: Uint8Array<ArrayBuffer>; cloud: Uint8Array<ArrayBuffer>; horizon: Uint8Array<ArrayBuffer>;
  city: readonly [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>] }

export const sat = (x: number) => Math.max(0, Math.min(1, x))
export const mix = (a: number, b: number, x: number) => a + (b - a) * x
export const unit = (x: number) => x - Math.floor(x)
export const unitSmooth = (x: number) => { x = sat(x); return x * x * (3 - 2 * x) }
export const smoothRange = (a: number, b: number, x: number) => unitSmooth((x - a) / (b - a))
const byte = (v: number) => Math.round(sat(v) * 255)

export function skyHash(x: number, y: number, seed: number) {
  let h = (Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x27d4eb2d) ^ seed) >>> 0
  h = Math.imul(h ^ h >>> 16, 0x85ebca6b)
  h = Math.imul(h ^ h >>> 13, 0xc2b2ae35)
  return ((h ^ h >>> 16) >>> 0) / 0x100000000
}

const wrap = (i: number, n: number) => (i % n + n) % n
function noise(u: number, v: number, nx: number, ny: number, seed: number) {
  u *= nx; v *= ny
  const x = Math.floor(u), y = Math.floor(v), t = unitSmooth(u - x), s = unitSmooth(v - y)
  const a = wrap(x, nx), b = wrap(x + 1, nx)
  return mix(mix(skyHash(a, y, seed), skyHash(b, y, seed), t), mix(skyHash(a, y + 1, seed), skyHash(b, y + 1, seed), t), s)
}

/** Integrated cloud slabs. R is column mass, G is exposed upper volume, B
 * is fine optical structure, A is lightning in the interior. Each layer
 * wraps horizontally and has its own projection, weather gain and wind.
 * A compact guarded tile at the end stores two independent, signed evolution modes per cloud deck. */
export function bakeStormAtlas(): Uint8Array<ArrayBuffer> {
  const p = new Uint8Array(bytes(CLOUD_W, CLOUD_ATLAS_H))
  const cirrus = (u: number, v: number) => {
    const curl = (noise(u, v, 5, 4, 623) - .5) * .34
    const drift = v + curl + .095 * Math.sin(u * Math.PI * 6 + .7)
    const n = noise(u, drift, 7, 21, 913) * .55 + noise(u, drift, 18, 56, 182) * .30 + noise(u, drift, 43, 117, 38) * .15
    const crest = .73 + .14 * (noise(u, .6, 6, 2, 4) - .5)
    const band = .44 + .56 * Math.exp(-((v - crest) ** 2) * 31)
    return smoothRange(.43, .78, n) * band * smoothRange(.26, .52, v)
  }
  const cell = (u: number, v: number, z: number) => {
    const warp = noise(u + z * .06, v - z * .08, 5, 4, 129)
    const q = u + (warp - .5) * .103 + (z - .5) * .075
    const y = v + (noise(q, v, 8, 6, 433) - .5) * .152 - (z - .5) * .12
    const crest = .58 + .37 * noise(u, .44 + z * .19, 6, 3, 593)
    const base = .15 + .15 * noise(u, z * .54, 4, 2, 407)
    const slab = smoothRange(base - .14, base + .13, y) * (1 - smoothRange(crest - .12, crest + .10, y))
    const billow = .62 * noise(q, y, 9, 7, 23) + .24 * noise(q, y, 23, 13, 503) + .10 * noise(q, y, 53, 31, 7) + .04 * noise(q, y, 108, 81, 137)
    return smoothRange(.27, .76, billow) * slab
  }
  // Fixed depth quadrature. Store the visible order of mass, not an
  // artist-drawn outline: exposed tops catch light, deeper bodies don't.
  const stack = new Float32Array(CLOUD_W * CLOUD_H)
  for (let y = 0; y < CLOUD_H; y++) for (let x = 0; x < CLOUD_W; x++) {
    const u = (x + .5) / CLOUD_W, v = y / (CLOUD_H - 1), i = y * CLOUD_W + x
    const d = cirrus(u, v), filament = noise(u, v, 16, 63, 69)
    p[4*i] = byte(d * .74); p[4*i + 1] = byte(.37 + .38 * filament)
    p[4*i + 2] = byte(.26 + .62 * filament); p[4*i + 3] = byte(d * .26)
    let mass = 0
    for (let j = 0; j < 7; j++) {
      const z = (j + .5) / 7
      mass += cell(u, v, z) * (.62 + .38 * Math.sin(z * Math.PI))
    }
    stack[i] = sat(mass * .228)
  }
  // The phase tile is lower resolution (it's a slow envelope). Guard
  // columns wrap its own bilinear footprint inside the common atlas.
  for (let y = 0; y < CLOUD_PHASE_H; y++) for (let x = -1; x <= CLOUD_PHASE_W; x++) {
    const u = (wrap(x, CLOUD_PHASE_W) + .5) / CLOUD_PHASE_W, v = y / (CLOUD_PHASE_H - 1)
    const at = 4 * ((CLOUD_PHASE_ROW + y) * CLOUD_W + x + 1)
    for (let k = 0; k < 4; k++) {
      const seed = 1733 + k * 371, nx = k < 2 ? 9 : 6, ny = k < 2 ? 7 : 5
      const n = noise(u, v, nx, ny, seed) * .82 + .18 * noise(u, v, nx * 3, ny * 3, seed + 17)
      p[at + k] = byte(n)
    }
  }
  const field = (x: number, y: number) => stack[Math.max(0, Math.min(CLOUD_H - 1, y)) * CLOUD_W + wrap(x, CLOUD_W)]
  for (let y = 0; y < CLOUD_H; y++) for (let x = 0; x < CLOUD_W; x++) {
    const i = 4 * ((y + CLOUD_H) * CLOUD_W + x), d = field(x, y)
    const shadow = field(x - 4, y + 3) * .58 + field(x - 14, y + 10) * .42
    const relief = Math.max(0, d - shadow) * 2.3
    p[i] = byte(d)
    p[i + 1] = byte((.29 + .57 * relief) * Math.exp(-2.8 * shadow))
    p[i + 2] = byte(.18 + .68 * relief + .12 * Math.abs(field(x + 2, y) - field(x - 2, y)) * 5)
    p[i + 3] = byte(.58 * d + .42 * Math.sqrt(d))
  }
  return p
}

/** A neutral regolith atlas. Slopes in RG are tangent perturbations, B is
 * intrinsic albedo and A a bright fine-ejecta signal. The limb and phase
 * are analytic at display resolution; nothing rings the baked edge. */
export function bakeLunarSurface(): Uint8Array<ArrayBuffer> {
  const w = MOON_EDGE, p = new Uint8Array(bytes(w, w))
  const height = new Float32Array(w*w), rock = new Float32Array(w*w), ejecta = new Float32Array(w*w)
  const craters = Array.from({ length: 89 }, (_, j) => {
    const a = skyHash(j, 0, 789) * Math.PI * 2, l = Math.sqrt(skyHash(j, 1, 789)) * 1.04
    const r = .017 + skyHash(j, 2, 789) ** 2.8 * .139
    return { x: Math.cos(a) * l, y: Math.sin(a) * l, r, depth: r * (.15 + .17 * skyHash(j, 3, 789)) }
  })
  craters.push({ x: .07, y: -.63, r: .071, depth: .026 }) // bright southern impact
  // Large connected, uneven basalt plains; these are much darker than the
  // cratered highlands, rather than a random pattern of circular divots.
  const seas = [[-.39,.24,.42,.29,-.54],[-.23,.55,.25,.19,.23],[.22,.30,.26,.22,-.6],
    [.35,.02,.31,.21,.48],[.62,.25,.16,.12,.24],[-.42,-.25,.19,.14,-.65],[-.03,-.15,.15,.10,.32]]
    .map(([x,y,rx,ry,a]) => ({ x,y,rx,ry, c: Math.cos(a), s: Math.sin(a) }))
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const u = (x + .5) / w, v = (y + .5) / w, a = (u - .5) / MOON_UV_SCALE, b = (v - .5) / MOON_UV_SCALE
    const i = y*w+x, n = noise(u, v, 39, 41, 191), fine = noise(u, v, 85, 92, 593)
    const wx = a + (noise(u, v, 16, 15, 613) - .5) * .13, wy = b + (noise(u, v, 12, 14, 837) - .5) * .15
    let maria = 0, h = (n - .5) * .008 + (fine - .5) * .0037, ash = 0
    for (const m of seas) {
      const dx = wx - m.x, dy = wy - m.y
      const d2 = ((dx * m.c - dy * m.s) / m.rx) ** 2 + ((dx * m.s + dy * m.c) / m.ry) ** 2
      maria = Math.max(maria, 1 - smoothRange(.60, 1.22, d2))
    }
    for (const c of craters) {
      const dx = a - c.x, dy = b - c.y
      if (Math.abs(dx) > c.r*1.39 || Math.abs(dy) > c.r*1.39) continue
      const d = Math.hypot(dx, dy) / c.r
      if (d > 1.39) continue
      const wall = Math.exp(-((d - .93) ** 2) * 63), pit = 1 - smoothRange(.3, .97, d)
      h += c.depth * (.49 * wall - pit)
      ash += wall * (.16 + .22 * n)
    }
    const rayX = a - .07, rayY = b + .63, r = Math.hypot(rayX, rayY), phi = Math.atan2(rayY, rayX)
    const rays = (.52 + .48 * Math.cos(phi * 19 + Math.sin(phi * 7) * .8)) ** 8
    ash += rays * Math.exp(-r * 4.2) * (.65 + fine * .35)
    height[i] = h; ejecta[i] = ash
    rock[i] = .55 + .19 * n + .094 * fine - maria * (.33 + .09 * fine) + .12 * ash
  }
  const step = w * MOON_UV_SCALE * .5
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const i = y*w+x, a = i*4
    const dx = (height[y*w+Math.min(w-1,x+1)] - height[y*w+Math.max(0,x-1)]) * step
    const dy = (height[Math.min(w-1,y+1)*w+x] - height[Math.max(0,y-1)*w+x]) * step
    p[a] = byte(.5 - .5 * Math.tanh(dx * 1.9)); p[a+1] = byte(.5 - .5 * Math.tanh(dy * 1.9))
    p[a+2] = byte(rock[i]); p[a+3] = byte(ejecta[i])
  }
  return p
}

export const CITY_GLOW = [[.055, .053, .054], [.061, .048, .044], [.049, .050, .050]] as const
export function bakeHorizonStrips(): Uint8Array<ArrayBuffer> {
  const p = new Uint8Array(bytes(HORIZON_W, HORIZON_H * HORIZON_SECTORS))
  for (let s = 0; s < HORIZON_SECTORS; s++) for (let y = 0; y < HORIZON_H; y++) for (let x = 0; x < HORIZON_W; x++) {
    const v = (y + .5) / HORIZON_H, u = (x + .5) / HORIZON_W
    const cap = .45 + .55 * noise(u, .08, 4, 2, s + 78)
    const glow = (1 - v) ** 3.4 * cap, air = (1 - v) ** 1.72
    const i = ((s * HORIZON_H + y) * HORIZON_W + x) * 4
    p[i] = byte(.007 + .035 * air + CITY_GLOW[s][0] * glow * .25)
    p[i + 1] = byte(.011 + .043 * air + CITY_GLOW[s][1] * glow * .22)
    p[i + 2] = byte(.019 + .052 * air + CITY_GLOW[s][2] * glow * .21)
    // Sparse star points in A, diminished by the same moving cloud density.
    const star = skyHash(x, y, 1397)
    p[i + 3] = byte(v > .44 && star > .993 ? .24 + .66 * skyHash(x, y, 771) : 0)
  }
  return p
}

export function decodeSkyBasis(data: ArrayBuffer): SkyBasis {
  if (data.byteLength !== SKY_BASIS_BYTES) throw new RangeError(`Expected ${SKY_BASIS_BYTES} sky basis bytes`)
  let at = 0
  const plane = (w: number, h: number) => { const q = new Uint8Array(data, at, bytes(w, h)); at += q.length; return q }
  return { lunar: plane(MOON_EDGE, MOON_EDGE), cloud: plane(CLOUD_W, CLOUD_ATLAS_H), horizon: plane(HORIZON_W, HORIZON_H * HORIZON_SECTORS),
    city: [plane(CITY_MASK_W, CITY_MASK_H[0]), plane(CITY_MASK_W, CITY_MASK_H[1])] }
}

let data: SkyBasis | null = null, transfer: AbortController | undefined, settled = false
/** Start during the attract painter or at Engage, whichever is earlier.
 * A missing/corrupt asset can still use the authored Canvas sky fallback. */
export function bridgeSkyBasis(): SkyBasis | null {
  if (!settled && !transfer && typeof window !== 'undefined') {
    const request = transfer = new AbortController()
    void fetch(SKY_BASIS_URL, { signal: request.signal }).then(r => {
      if (!r.ok) throw new Error(`sky basis HTTP ${r.status}`)
      return r.arrayBuffer()
    }).then(a => {
      if (transfer === request) data = decodeSkyBasis(unpackBridgePlanes(new Uint8Array(a), SKY_PACK_LAYOUT, SKY_PACK_TAG).buffer)
    }).catch(error => {
      if (transfer === request) console.warn('Using procedural sky fallback:', error)
    }).finally(() => {
      if (transfer === request) { transfer = undefined; settled = true }
    })
  }
  return data
}

export function discardPendingBridgeSky(): void {
  const request = transfer
  transfer = undefined
  request?.abort()
}

export function bridgeSkyBasisSettled(): boolean {
  bridgeSkyBasis()
  return settled || typeof window === 'undefined'
}
