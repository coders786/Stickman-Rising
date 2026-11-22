import { clamp01 } from '../core/utils'
import { ROAD } from './road-section'

// Shared by the oblique cards, wet clip and the GPU receiver mesh. No
// physics queries this projection: the fighting rail and deck tops stay put.
export const RETURN_X = 14
export const RETURN_Y = -8
export const MATERIAL_TILE = 64
export const MATERIAL_COUNT = 4
export const PUDDLE_PITCH = 2048
export const drainageOffset = (seed: number) => (Math.imul(seed ^ 42, 0x9e3779b1) >>> 10) % PUDDLE_PITCH

export const Material = { asphalt: 0, concrete: 1, shutter: 2, steel: 3 } as const
export const materialRoughness = [.58, .85, .49, .27] as const
export const WET_ROUGHNESS = .08
export const deckShear = (y: number): number => -.37 * y
export const deckY = (fraction: number): number => ROAD.rear + (ROAD.front - ROAD.rear) * (fraction * .63 + fraction * fraction * .37)

const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t) }
function waterNoise(u: number, y: number, period: number, rows: number, seed: number): number {
  const X = u * period, Y = y * rows, i = Math.floor(X), j = Math.floor(Y)
  const a = (i % period + period) % period, b = (a + 1) % period, f = ease(X - i), v = ease(Y - j)
  const k = bridgeHash(a, j, seed), l = bridgeHash(a, j + 1, seed)
  return (k + (bridgeHash(b, j, seed) - k) * f) * (1 - v) + (l + (bridgeHash(b, j + 1, seed) - l) * f) * v
}
/** A drainage height field, not a set of decal shapes. Worn wheel ruts and
 * gutter depressions bias four periodic octaves with slow domain warp. */
export function puddleMask(x: number, y: number): number {
  if (y <= ROAD.rear + 1 || y >= ROAD.front - 1) return 0
  const u = x / PUDDLE_PITCH, v = (y - ROAD.rear) / DECK_MASK_H
  const warp = (waterNoise(u, v, 8, 3, 62) - .5) * .105
  const n = .53 * waterNoise(u + warp * .48, v + warp, 12, 4, 564) + .25 * waterNoise(u, v + warp, 29, 13, 7)
    + .15 * waterNoise(u - warp * .32, v, 65, 23, 419) + .07 * waterNoise(u, v, 129, 38, 73)
  const gutter = Math.max(0, 1 - Math.abs(v - .10 - warp * .4) * 6.1)
  const rearRut = Math.max(0, 1 - Math.abs(v - .53 + warp) * 4.9)
  const lip = Math.max(0, 1 - Math.abs(v - .89 + warp * .37) * 7.9)
  const depress = .20 * gutter + .125 * rearRut + .10 * lip
  return ease((n + depress - .573) / .205) * ease(Math.min(v, 1 - v) * 30)
}

export function bridgeHash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x ^ salt, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35)
  return ((h ^ (h >>> 13)) >>> 0) / 0x100000000
}

function height(x: number, y: number, mat: number): number {
  x = (x + MATERIAL_TILE) % MATERIAL_TILE; y = (y + MATERIAL_TILE) % MATERIAL_TILE
  const grit = bridgeHash(x, y, mat + 19) - .5
  if (mat === Material.shutter) return .8 * Math.sin(y * Math.PI / 4) + grit * .15
  if (mat === Material.steel) return .24 * Math.sin((x + y * 8) * Math.PI / 4) + grit * .16
  const stone = bridgeHash(x >> 2, y >> 2, mat + 2) - .5
  return (mat === Material.asphalt ? .93 : .48) * grit + .7 * stone + .16 * Math.sin((x * 2 + y) * Math.PI / 16)
}

/** Small, lossless data atlas: normal XY in RG (reconstruct Z), roughness B,
 * ambient occlusion A. This is data, not a color texture. Layers are seamless
 * and mip-filterable; generation/transfer happens once, never on a chunk seam. */
export function bakeBridgeMaterialTiles(): Uint8Array<ArrayBuffer> {
  const n = MATERIAL_TILE, bytes = new Uint8Array(n * n * MATERIAL_COUNT * 4)
  let i = 0
  for (let mat = 0; mat < MATERIAL_COUNT; mat++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const nx = height(x - 1, y, mat) - height(x + 1, y, mat)
    const ny = height(x, y - 1, mat) - height(x, y + 1, mat)
    const len = Math.hypot(nx, ny, 1.7)
    bytes[i++] = Math.round((.5 + .5 * nx / len) * 255)
    bytes[i++] = Math.round((.5 + .5 * ny / len) * 255)
    bytes[i++] = Math.round(clamp01(materialRoughness[mat] + (bridgeHash(x, y, mat) - .5) * .14) * 255)
    bytes[i++] = Math.round(clamp01(.88 + height(x, y, mat) * .18) * 255)
  }
  return bytes
}

export const DECK_MASK_H = ROAD.front - ROAD.rear

/** Authored receiver channels (AO, roughness, pool mask, emissive).
 * The asphalt is never an emitter. Brighter reflective paint in the
 * albedo card must not qualify as HDR light. */
let deckMask: Uint8Array<ArrayBuffer> | undefined
export function* buildBridgeDeckMask(pool?: Uint8Array): Generator<number, Uint8Array<ArrayBuffer>> {
  if (pool && pool.length !== PUDDLE_PITCH * DECK_MASK_H) throw new RangeError('Wrong baked pool extent')
  if (!pool && deckMask) return deckMask
  // R and G are cheap, deterministic functions of the same wear noise.
  // A is zero on the road. Bake/transfer only the costly drainage field.
  const rowsPerSlice = pool ? 52 : 13
  const data = new Uint8Array(PUDDLE_PITCH * DECK_MASK_H * 4)
  for (let y = 0; y < DECK_MASK_H; y++) {
    const wy = y + ROAD.rear, curb = Math.min(1, Math.min(y, DECK_MASK_H - 1 - y) * .070)
    const baseAO = .74 + .15 * curb
    for (let x = 0; x < PUDDLE_PITCH; x++) {
      const i = (y * PUDDLE_PITCH + x) * 4
      const joint = Math.min(1, Math.abs((x + 1024 + wy * .22) % 176 - 88) * .16)
      const n = bridgeHash(x, y, 11)
      data[i] = Math.round((baseAO + .064 * joint + n * .026) * 255)
      data[i + 1] = Math.round((materialRoughness[Material.asphalt] + (n - .5) * .14) * 255)
      data[i + 2] = pool ? pool[i >>> 2] : Math.round(puddleMask(x + .5, wy + .5) * 255)
    }
    if ((y + 1) % rowsPerSlice === 0 && y + 1 < DECK_MASK_H) yield y + 1
  }
  return pool ? data : (deckMask = data)
}

export function bakeBridgeDeckMask(): Uint8Array<ArrayBuffer> {
  const rows = buildBridgeDeckMask()
  for (let status = rows.next();; status = rows.next()) if (status.done) return status.value
}

/** Compact shade/clip runs, derived offline from the identical mask texels. */
export function bakeBridgePuddleRuns(mask = bakeBridgeDeckMask()): number[] {
  const runs: number[] = [], step = 3
  for (let j = 0; j < DECK_MASK_H; j += step) {
    const row = Math.min(j + 1, DECK_MASK_H - 1) * PUDDLE_PITCH
    for (let x = 0; x < PUDDLE_PITCH;) {
      if (mask[4 * (row + x) + 2] < 75) { x++; continue }
      const first = x++
      while (x < PUDDLE_PITCH && mask[4 * (row + x) + 2] >= 75) x++
      runs.push(first, j + ROAD.rear, x - first, Math.min(step, DECK_MASK_H - j))
    }
  }
  return runs
}

export type LookIndex = 0 | 1 | 2 | 3
// Display-referred after ACES. Neutral blacks and a restrained sector temperature;
// distant lamp color comes from its spectrum, not a district tint wash.
const LOOK = [
  { toe: [.015, .020, .027], trim: [.986, .996, 1.013], sat: .74 },
  { toe: [.024, .017, .019], trim: [1.014, .997, .968], sat: .70 },
  { toe: [.014, .019, .020], trim: [1.003, 1.001, .984], sat: .70 },
  { toe: [.020, .016, .018], trim: [1.010, .994, .978], sat: .77 },
] as const

export function bridgeGrade(index: LookIndex, r: number, g: number, b: number): readonly [number, number, number] {
  const look = LOOK[index], lum = .2126 * r + .7152 * g + .0722 * b
  const high = ease((lum - .48) / .52), w = 1 - ease(lum * 6)
  // Saturation survives narrow combat highlights; deep and very bright
  // colors roll off instead of covering a whole route in a chroma grade.
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  const saturation = look.sat + (1 - look.sat) * ease((chroma - .20) / .54) * .73 - .12 * high
  const channel = (x: number, i: number) => clamp01((lum + (x - lum) * saturation) * look.trim[i] * (.79 + .21 * ease(lum * 2.6)) + look.toe[i] * w)
  return [channel(r, 0), channel(g, 1), channel(b, 2)]
}

/** Authoring strip: width n², height n. The GPU uses a trilinear volume. */
export function bakeBridgeLutStrip(size: 16 | 32, look: LookIndex): Uint8Array<ArrayBuffer> {
  const strip = new Uint8Array(size ** 3 * 4)
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size * size + z * size + x) * 4
    const rgb = bridgeGrade(look, x / (size - 1), y / (size - 1), z / (size - 1))
    strip[i] = Math.round(rgb[0] * 255); strip[i + 1] = Math.round(rgb[1] * 255); strip[i + 2] = Math.round(rgb[2] * 255); strip[i + 3] = 255
  }
  return strip
}

export function unpackBridgeLut(strip: Uint8Array, size: 16 | 32): Uint8Array<ArrayBuffer> {
  if (strip.length !== size ** 3 * 4) throw new RangeError('Invalid Bridge LUT strip')
  const volume = new Uint8Array(strip.length)
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) {
    const row = (y * size * size + z * size) * 4
    volume.set(strip.subarray(row, row + size * 4), (z * size * size + y * size) * 4)
  }
  return volume
}

export function atmosphereTransmission(depth: number, density: number): number {
  return Math.exp(-Math.max(0, depth) * Math.max(0, density))
}
