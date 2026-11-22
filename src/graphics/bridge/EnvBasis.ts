import type { BridgeRoute, RouteChunk } from '../../game/stage/route'
import { ROAD } from '../../game/stage/road-section'
import { SHELTER_KIT } from '../../game/stage/run-layout'
import { LIGHT_SAMPLES, MOON_KEY, MOON_SLOPE, SHADOW_REACH, catwalkSlab, chunkLightData, softVisibility, staticFalloff, type Blocker, type LightPoint } from './NoirGeometry'
import { encodeRGB9E5, decodeRGB9E5 } from '../sacr/SACRAtlas'
import { smoothRange as smooth } from './SkyBasis'
import { cityHorizonAccess, cityMoonAccess } from './CityGeometry'
import { packBake, unpackBake, type PackedBake } from './BridgeLZ4'
import { bakeLightVectorGrid, lightDepth, VECTOR_W, VECTOR_H, VECTOR_ATLAS_W } from './LightVectorGrid'

import { SACR_CURB_Z, SACR_NEAR_Z } from '../sacr/SACRMath'
import { SACR_PX_PER_METER } from '../sacr/SACRPacker'

export { catwalkSlab } from './NoirGeometry'
export const LIGHT_W = 512, LIGHT_H = 96, GROUND_H = 32
export const ENV_W = 1024, ENV_H = LIGHT_H + GROUND_H, ENV_TOP = -368, ENV_BOTTOM = 160
export const CAST_TOP = -174, CAST_BOTTOM = ROAD.front
export type ChunkLightTile = { shadow: Uint8Array<ArrayBuffer>; irradiance: Uint32Array<ArrayBuffer>; vectors: Uint8Array<ArrayBuffer> }
const pop = Uint8Array.from({ length: 128 }, (_, n) => n.toString(2).replace(/0/g, '').length)
const SKY_RAYS = [-.82, 0, .82] as const
const MOON_RADIUS_SLOPE = .071
const MOON_Z_RADIUS_SLOPE = .042
const moonLane = Float32Array.from({ length: LIGHT_SAMPLES + 1 }, (_, n) => 1 - n / LIGHT_SAMPLES)
const skyLane = Float32Array.from({ length: SKY_RAYS.length + 1 }, (_, n) => 1 - .90 * n / SKY_RAYS.length)
export const skyExposed = (sky: number) => smooth(.52, .82, sky)
const TILE_LIMIT = 8
const archives = new WeakMap<BridgeRoute, Map<number, PackedBake>>()
export const enableLightTileArchive = (route: BridgeRoute) => archives.set(route, new Map())
const tiles = new WeakMap<BridgeRoute, Map<RouteChunk, ChunkLightTile>>()

/** OR four receivers at once in the aligned interior of a shadow span.
 * Same union of emitter bits at a blocker edge, including partial words. */
function markSpan(bits: Uint8Array, words: Uint32Array | null, first: number, last: number, bit: number): void {
  let i = first
  if (words && last - i >= 8) {
    for (; i & 3; i++) bits[i] |= bit
    const mask = bit * 0x01010101, end = last >>> 2
    for (let w = i >>> 2; w < end; w++) words[w] |= mask
    i = end << 2
  }
  for (; i < last; i++) bits[i] |= bit
}

/** Project each sample's blocker sections onto the current receiver row.
 * This is a batched analytic ray/box test: a convex box maps to one X
 * interval per emitter sample. Union its bit before counting the samples;
 * overlapping solids must not darken twice. Work scales primarily with
 * rows, not with texels × seven independent scene walks. */
export function shadowRow(bits: Uint8Array, start: number, step: number, y: number,
  blockers: readonly Blocker[], slopes: readonly number[], lamp?: LightPoint, roadZ?: number): void {
  bits.fill(0)
  const words = bits.byteOffset % 4 === 0 ? new Uint32Array(bits.buffer, bits.byteOffset, bits.length >>> 2) : null
  for (let i = 0; i < slopes.length; i++) {
    const bit = 1 << i, px = lamp ? lamp.x + slopes[i] * lamp.physicalRadius : 0, py = lamp?.y ?? y - SHADOW_REACH
    const lowY = Math.min(y, py) + .02, highY = Math.max(y, py) - .02
    for (const b of blockers) {
      let t = Math.max(lowY, b.top), d = Math.min(highY, b.bottom), receiverY = y
      const depth = b.depth
      if (roadZ !== undefined && depth) {
        // The road is an elevation-zero plane with varying optical Z. A
        // deck is a finite slab, not a curtain extending across that plane.
        // Intersect its depth first, then project just that Y interval in X.
        receiverY = ROAD.lane
        const sourceY = lamp ? py : receiverY - SHADOW_REACH
        t = Math.max(Math.min(receiverY, sourceY) + .02, b.top)
        d = Math.min(Math.max(receiverY, sourceY) - .02, b.bottom)
        const dz = lamp ? (lightDepth(lamp) - roadZ) / (receiverY - sourceY)
          : (MOON_KEY[2] / -MOON_KEY[1] + MOON_Z_RADIUS_SLOPE * (2 * i / Math.max(1, slopes.length - 1) - 1)) / SACR_PX_PER_METER
        if (Math.abs(dz) < 1e-8) { if (roadZ < depth[0] || roadZ > depth[1]) continue }
        else {
          const lo = receiverY - (depth[0] - roadZ) / dz, hi = receiverY - (depth[1] - roadZ) / dz
          t = Math.max(t, Math.min(lo, hi)); d = Math.min(d, Math.max(lo, hi))
        }
      }
      if (d <= t || lamp && px > b.left && px < b.right && py > b.top && py < b.bottom &&
        (roadZ === undefined || !depth || lightDepth(lamp) >= depth[0] && lightDepth(lamp) <= depth[1])) continue
      let l: number, r: number
      if (lamp) {
        const a = (receiverY - py) / (t - py), c = (receiverY - py) / (d - py), u = b.left - px, v = b.right - px
        l = px + Math.min(a * u, c * u); r = px + Math.max(a * v, c * v)
      } else {
        const a = (receiverY - t) * slopes[i], c = (receiverY - d) * slopes[i]
        l = b.left + Math.min(a, c); r = b.right + Math.max(a, c)
      }
      const a = Math.max(0, Math.ceil((l - start) / step)), z = Math.min(bits.length, Math.ceil((r - start) / step))
      // A sample on the surface of its own blocker is still a receiver.
      if (receiverY > b.top && receiverY < b.bottom) {
        const ownL = Math.ceil((b.left - start) / step), ownR = Math.ceil((b.right - start) / step)
        markSpan(bits, words, a, Math.min(ownL, z), bit)
        markSpan(bits, words, Math.max(a, ownR), z, bit)
      } else markSpan(bits, words, a, z, bit)
    }
  }
}

const APERTURE = Array.from({ length: LIGHT_SAMPLES }, (_, i) => i / ((LIGHT_SAMPLES - 1) * .5) - 1)
const MOON_RAYS = APERTURE.map(r => MOON_SLOPE + r * MOON_RADIUS_SLOPE)

function rearReturn(surfaces: readonly Blocker[], lamps: readonly LightPoint[], blockers: readonly Blocker[]) {
  return surfaces.map(box => {
    const x = (box.left + box.right) * .5, y = box.top + (box.bottom - box.top) * .36
    let r = 0, g = 0, b = 0
    for (const p of lamps) {
      const e = staticFalloff(p, x - p.x, y - p.y)
      if (e < .007) continue
      const v = e * softVisibility(x, y, p.x, p.y, p.physicalRadius, blockers)
      r += p.rgb[0] * v * .139; g += p.rgb[1] * v * .131; b += p.rgb[2] * v * .12
    }
    return { box, r, g, b }
  })
}

const CHUNK_BAND_BYTES = LIGHT_W * ENV_H * 4
const CHUNK_DATA_BYTES = CHUNK_BAND_BYTES * 2 + VECTOR_W * VECTOR_H * 4
function lightTileViews(bytes: ArrayBuffer): ChunkLightTile {
  return { shadow: new Uint8Array(bytes, 0, CHUNK_BAND_BYTES), irradiance: new Uint32Array(bytes, CHUNK_BAND_BYTES, CHUNK_BAND_BYTES / 4),
    vectors: new Uint8Array(bytes, CHUNK_BAND_BYTES * 2) }
}

export function bakeChunkLight(c: RouteChunk, blockers = chunkLightData(c).blockers, lamps = chunkLightData(c).points, routeSeed = 42): ChunkLightTile {
  const width = c.right - c.left, step = width / LIGHT_W, x0 = c.left + .5 * step
  const tile = lightTileViews(new ArrayBuffer(CHUNK_DATA_BYTES)), { shadow, irradiance } = tile
  const moonBits = new Uint8Array(LIGHT_W), skyBits = new Uint8Array(LIGHT_W), lampBits = new Uint8Array(LIGHT_W)
  const sums = new Float32Array(LIGHT_W * 3)
  const roof = c.shelter, roofY = roof ? SHELTER_KIT[roof.kind].eaveY + 9 : Infinity
  const platform = catwalkSlab(c), soffit = ROAD.soffit - 2
  const horizon = new Float32Array(LIGHT_W), cityMoon = new Float32Array(LIGHT_W), cavity = new Float32Array(LIGHT_W)
  const face = new Uint8Array(LIGHT_W)
  const rear = rearReturn(chunkLightData(c).rearSurfaces, lamps, blockers)
  for (let k = 0; k < LIGHT_W; k++) {
    const x = x0 + step * k
    horizon[k] = cityHorizonAccess(x, routeSeed)
    cityMoon[k] = cityMoonAccess(x, routeSeed)
    if (platform && x >= platform.left && x < platform.right) face[k] = 1
    if (roof && x >= roof.left && x < roof.right) cavity[k] = .62 + .23 * smooth(0, 52, Math.min(x - roof.left, roof.right - x))
  }
  for (let row = 0; row < ENV_H; row++) {
    const ground = row >= LIGHT_H
    const y = ground ? ROAD.rear + (row - LIGHT_H + .5) * (ROAD.front - ROAD.rear) / GROUND_H
      : ENV_TOP + (row + .5) * (ENV_BOTTOM - ENV_TOP) / LIGHT_H
    // Top view of the oblique road section: raster Y is compressed height
    // for the ray test, which keeps the shadow anchored at the curb when rolled.
    const receiverY = ground ? y * .56 : y
    const roadZ = ground ? SACR_CURB_Z + (SACR_NEAR_Z - SACR_CURB_Z) * (y - ROAD.rear) / (ROAD.front - ROAD.rear) : undefined
    const cityAbove = smooth(-214, -30, receiverY)
    shadowRow(moonBits, x0, step, receiverY, blockers, MOON_RAYS, undefined, roadZ)
    shadowRow(skyBits, x0, step, receiverY, blockers, SKY_RAYS)
    sums.fill(0)
    for (const p of lamps) {
      const dy = receiverY - p.y, dy2 = dy * dy, range2 = p.reach * p.reach, spot = p.kind === 'spot', strip = p.kind === 'strip'
      if (dy2 >= range2 || spot && dy <= 0) continue
      const r = Math.sqrt(range2 - dy2) + p.halfWidth
      let left = p.x - r, right = p.x + r
      if (spot) {
        // Conservative angular bounds for the actual cone; no visits to black texels.
        const a = Math.atan2(p.axisX, p.axisY), cut = Math.acos(p.coneCos)
        left = Math.max(left, p.x + dy * Math.tan(a - cut)); right = Math.min(right, p.x + dy * Math.tan(a + cut))
      }
      const from = Math.max(0, Math.ceil((left - x0) / step)), to = Math.min(LIGHT_W, Math.ceil((right - x0) / step))
      if (from >= to) continue
      shadowRow(lampBits, x0, step, receiverY, blockers, APERTURE, p, roadZ)
      const strength = p.strength * (ground ? 1.19 : 1.07)
      const distanceScale = 1 / (strip ? 85 : spot ? 39500 : 13000)
      const fadeScale = 1 / (.58 * range2), tint = p.rgb
      const base = x0 - p.x, side = p.axisX, down = p.axisY * dy, coneScale = 1 / (.98 - p.coneCos)
      for (let k = from; k < to; k++) {
        const visible = moonLane[pop[lampBits[k]]]
        if (visible === 0) continue
        const x = base + k * step, dx = strip ? Math.max(0, Math.abs(x) - p.halfWidth) : x
        const d2 = dx * dx + dy2, u = k * 3, l = Math.min(1, Math.max(0, (d2 - .42 * range2) * fadeScale))
        let v = strength * (1 - l * l * (3 - 2 * l)) * visible / (1 + d2 * distanceScale)
        if (spot) {
          const cos = (x * side + down) / Math.sqrt(Math.max(1, d2)), q = Math.min(1, Math.max(0, (cos - p.coneCos) * coneScale))
          v *= q * q * (3 - 2 * q) * cos * cos
        }
        sums[u] += tint[0] * v; sums[u + 1] += tint[1] * v; sums[u + 2] += tint[2] * v
      }
    }
    // One low-energy, colored diffuse return from the actual shutter or
    // kiosk backing. No unoccluded fullscreen fill under a cover ID.
    for (const { box, r, g, b } of rear) {
      if (y < box.top - 17 || y > ROAD.front || r + g + b < .001) continue
      const bounce = smooth(box.top - 17, box.top + 16, y) * (1 - smooth(box.bottom, ROAD.front + 32, y) * .77)
      const f = Math.max(0, Math.ceil((box.left - x0) / step)), z = Math.min(LIGHT_W, Math.ceil((box.right - x0) / step))
      for (let k = f; k < z; k++) {
        const v = bounce * smooth(0, 22 / step, Math.min(k - f + .5, z - k - .5)), i = k * 3
        sums[i] += r * v; sums[i + 1] += g * v; sums[i + 2] += b * v
      }
    }
    const aoY = (y >= ROAD.rear && y <= ROAD.front ? .76 + .24 * smooth(0, 14, Math.min(y - ROAD.rear, ROAD.front - y)) : .95) * (y > soffit ? .60 : 1)
    const deckAO = platform && y > platform.bottom ? .76 + .18 * smooth(0, 115, y - platform.bottom) : 1
    const inside = y >= roofY, pastEdge = y > soffit
    for (let k = 0, i = row * LIGHT_W * 4, j = 0; k < LIGHT_W; k++, i += 4, j += 3) {
      const cavityAO = inside ? cavity[k] : 0
      const lanes = pop[skyBits[k]], localSky = skyLane[lanes], ao = aoY * (face[k] ? deckAO : 1)
      const moon = cavityAO ? 0 : moonLane[pop[moonBits[k]]] * (pastEdge ? .38 : 1) * (1 - cityAbove * (1 - cityMoon[k]))
      const sky = Math.max(.08, cavityAO ? .08 : localSky * horizon[k] * (pastEdge ? .33 : 1))
      shadow[i] = (moon * 255 + .5) | 0; shadow[i + 1] = (sky * 255 + .5) | 0
      shadow[i + 2] = (ao * (cavityAO || 1) * 255 + .5) | 0
      // A = bounded static air scatter (not used as emissivity or AO).
      const fog = pastEdge ? 0 : Math.min(1, (.23 * sums[j] + .61 * sums[j + 1] + .16 * sums[j + 2]) * .88) * smooth(-220, 0, y)
      shadow[i + 3] = (fog * 255 + .5) | 0
      if (sums[j] + sums[j + 1] + sums[j + 2] > 0) irradiance[i >>> 2] = encodeRGB9E5(sums[j], sums[j + 1], sums[j + 2])
    }
  }
  // Static Canvas radiance doesn't read the directional grid. Defer the
  // seven-lane searches to actual transport/cast requests on the other worker.
  const { vectors } = tile
  let ready = false
  return { shadow, irradiance, get vectors() {
    if (!ready) { bakeLightVectorGrid(c.left, c.right, lamps, blockers, vectors); ready = true }
    return vectors
  } }
}

/** Cache is render-only and bounded even though BridgeRoute retains its seed
 * history. Adjacent geometry enters the bake so shadows cross tile seams. */
export function chunkLightTile(route: BridgeRoute, c: RouteChunk): ChunkLightTile {
  let cache = tiles.get(route)
  if (!cache) { cache = new Map(); tiles.set(route, cache) }
  const archive = archives.get(route)
  const blob = cache.has(c) ? null : archive?.get(c.index)
  let tile = cache.get(c) ?? (blob && unpackLightTile(blob))
  if (!tile) {
    const blockers: Blocker[] = [], points: LightPoint[] = []
    for (const n of route.between(c.left - SHADOW_REACH, c.right + SHADOW_REACH)) {
      const nc = chunkLightData(n)
      blockers.push(...nc.blockers); points.push(...nc.points)
    }
    tile = bakeChunkLight(c, blockers, points, route.seed)
  }
  cache.delete(c); cache.set(c, tile)
  if (cache.size > TILE_LIMIT) {
    const [old, data] = cache.entries().next().value!
    cache.delete(old)
    // Pay lossless compression only on eviction, never for the opening
    // window or repeat reads of a hot optical tile.
    if (archive && !archive.has(old.index)) {
      archive.set(old.index, packLightTile(data))
      if (archive.size > 24) archive.delete(archive.keys().next().value!)
    }
  }
  return tile
}

/** Cold generated tiles are stored losslessly in the worker. A transfer to
 * the main thread uses the same words, already inflated, without a decode
 * on the animation thread. */
export function packLightTile(tile: ChunkLightTile): PackedBake {
  const { shadow, irradiance, vectors } = tile, buffer = shadow.buffer
  if (shadow.byteOffset === 0 && buffer.byteLength === CHUNK_DATA_BYTES &&
    irradiance.buffer === buffer && irradiance.byteOffset === CHUNK_BAND_BYTES &&
    vectors.buffer === buffer && vectors.byteOffset === CHUNK_BAND_BYTES * 2) return packBake(buffer)
  // Also accept the three independent views used by callers/tools.
  const bytes = new Uint8Array(CHUNK_DATA_BYTES)
  bytes.set(shadow); bytes.set(new Uint8Array(irradiance.buffer, irradiance.byteOffset, CHUNK_BAND_BYTES), CHUNK_BAND_BYTES)
  bytes.set(vectors, CHUNK_BAND_BYTES * 2)
  return packBake(bytes.buffer)
}
export function unpackLightTile(blob: PackedBake): ChunkLightTile {
  return lightTileViews(unpackBake(blob, CHUNK_DATA_BYTES))
}

// The offset matters for both contiguous cold bakes and decompressed tiles.
const wordView = (bytes: Uint8Array<ArrayBuffer>) => new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

export const lightRow = (y: number, ground: boolean) => ground
  ? LIGHT_H + Math.min(GROUND_H - 1, Math.max(0, Math.floor((y - ROAD.rear) / (ROAD.front - ROAD.rear) * GROUND_H)))
  : Math.min(LIGHT_H - 1, Math.max(0, Math.floor((y - ENV_TOP) / (ENV_BOTTOM - ENV_TOP) * LIGHT_H)))
export const lightColumn = (c: RouteChunk, x: number) => Math.min(LIGHT_W - 1, Math.max(0, Math.floor((x - c.left) / (c.right - c.left) * LIGHT_W)))

export function sampleChunkLight(route: BridgeRoute, x: number, y: number, ground = false) {
  const c = route.at(x), t = chunkLightTile(route, c), i = (lightRow(y, ground) * LIGHT_W + lightColumn(c, x)) * 4
  const { shadow: a, irradiance: b } = t
  const [red, green, blue] = decodeRGB9E5(b[i >>> 2])
  return { moon: a[i] / 255, sky: a[i + 1] / 255, ao: a[i + 2] / 255, scatter: a[i + 3] / 255, flash: skyExposed(a[i + 1] / 255) * (ground ? .44 : 1),
    r: red, g: green, b: blue }
}

/** Camera-independent atlas window. Overlap is copied in-place, even when
 * passing a seed boundary at large world X; no changed sky input rebakes it. */
export class BridgeEnvAtlas {
  readonly data = new Uint8Array(ENV_W * ENV_H * 4)
  readonly light = new Uint32Array(ENV_W * ENV_H)
  readonly vectors = new Uint8Array(VECTOR_ATLAS_W * VECTOR_H * 4)
  private route: BridgeRoute | null = null
  private step = 0
  origin = 0
  width = 0
  version = 0

  update(route: BridgeRoute, left: number, right: number): void {
    const lo = left - 96, hi = right + 96
    let step = 4
    while (step * ENV_W < hi - lo + 1000) step *= 2
    if (this.route === route && step === this.step && lo >= this.origin && hi <= this.origin + this.width) return
    const old = this.origin, canReuse = this.route === route && this.step === step
    this.route = route; this.step = step; this.width = step * ENV_W
    const grid = step * 16
    this.origin = Math.floor((lo - 480) / grid) * grid
    if (hi > this.origin + this.width) this.origin = Math.floor(lo / grid) * grid
    const shift = (this.origin - old) / step
    const overlap = canReuse && Math.abs(shift) < ENV_W
    const from = overlap && shift >= 0 ? ENV_W - shift : 0, to = overlap && shift < 0 ? -shift : ENV_W
    if (overlap) for (const data of [new Uint32Array(this.data.buffer), this.light]) for (let y = 0; y < ENV_H; y++) {
      const row = y * ENV_W
      if (shift > 0) data.copyWithin(row, row + shift, row + ENV_W)
      if (shift < 0) data.copyWithin(row - shift, row, row + ENV_W + shift)
    }
    let c = route.at(this.origin + from * step), tile = chunkLightTile(route, c)
    const dst = new Uint32Array(this.data.buffer), lit = this.light
    let s = wordView(tile.shadow), a = tile.irradiance
    for (let x = from; x < to; x++) {
      const wx = this.origin + (x + .5) * step
      if (wx >= c.right) {
        c = route.at(wx); tile = chunkLightTile(route, c)
        s = wordView(tile.shadow); a = tile.irradiance
      }
      const ix = lightColumn(c, wx)
      for (let y = 0; y < ENV_H; y++) { dst[y * ENV_W + x] = s[y * LIGHT_W + ix]; lit[y * ENV_W + x] = a[y * LIGHT_W + ix] }
    }
    // Vector cells are independently packed; interpolate intensity through
    // the irradiance texture, never filter the bytes of an octahedral code.
    const packed = new Uint32Array(this.vectors.buffer)
    c = route.at(this.origin)
    tile = chunkLightTile(route, c)
    let v = wordView(tile.vectors)
    for (let x = 0; x < VECTOR_ATLAS_W; x++) {
      const wx = this.origin + (x + .5) * this.width / VECTOR_ATLAS_W
      if (wx >= c.right) { c = route.at(wx); tile = chunkLightTile(route, c); v = wordView(tile.vectors) }
      const ix = lightColumn(c, wx) >>> 2
      for (let y = 0; y < VECTOR_H; y++) packed[y * VECTOR_ATLAS_W + x] = v[y * VECTOR_W + ix]
    }
    this.version++
  }
}
