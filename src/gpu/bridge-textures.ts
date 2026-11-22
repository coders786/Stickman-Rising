import { packedBytes } from './bridge-packed-assets'
import { DECK_PACK, gradePack, unpackBridgePlanes } from '../graphics/bridge/BridgeAssetCodec'
import { DECK_PACK_LAYOUT, DECK_PACK_TAG, gradePackLayout, gradePackTag } from '../game/stage/bridge-packed-material'
import { buildBridgeDeckMask, bakeBridgeLutStrip, unpackBridgeLut, bakeBridgeMaterialTiles, bridgeHash,
  DECK_MASK_H, MATERIAL_COUNT, MATERIAL_TILE, PUDDLE_PITCH, type LookIndex } from '../game/stage/bridge-material'

let materialPixels: Uint8Array<ArrayBuffer> | undefined
type Origin = 'brotli' | 'local'
interface Pixels<T> { data: T; origin: Origin }
let deckPixels: Pixels<Uint8Array<ArrayBuffer>> | undefined
const lookVolumes = new Map<16 | 32, Uint8Array<ArrayBuffer> | null>()

export function materialTiles(gl: WebGL2RenderingContext): void {
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, MATERIAL_TILE, MATERIAL_TILE, MATERIAL_COUNT, 0, gl.RGBA, gl.UNSIGNED_BYTE, materialPixels ??= bakeBridgeMaterialTiles())
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
}
export function* deckTile(gl: WebGL2RenderingContext): Generator<string, Origin> {
  if (!deckPixels) {
    let pool: Uint8Array | undefined
    const packed = packedBytes(DECK_PACK)
    if (packed) {
      try { pool = unpackBridgePlanes(packed, DECK_PACK_LAYOUT, DECK_PACK_TAG) }
      catch { /* a malformed bake uses exactly the procedural mask */ }
    }
    const rows = buildBridgeDeckMask(pool)
    for (;;) {
      const next = rows.next()
      if (next.done) { deckPixels = { data: next.value, origin: pool ? 'brotli' : 'local' }; break }
      yield `deck-rows-${next.value}`
    }
  }
  const { data, origin } = deckPixels
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PUDDLE_PITCH, DECK_MASK_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.generateMipmap(gl.TEXTURE_2D)
  return origin
}
/** Same four RGB grades, sampled as hardware trilinear volumes. The
 * authoring strip and its round-trip tests use the same voxel order. */
export function lookVolume(gl: WebGL2RenderingContext, size: 16 | 32, i: number): Origin {
  if (!lookVolumes.has(size)) {
    const p = packedBytes(gradePack(size))
    let data: Uint8Array<ArrayBuffer> | null = null
    if (p) {
      try { data = unpackBridgePlanes(p, gradePackLayout(size), gradePackTag(size)) }
      catch { /* malformed payload, use local look */ }
    }
    lookVolumes.set(size, data)
  }
  const all = lookVolumes.get(size), bytes = size ** 3 * 4
  const data = all?.subarray(i * bytes, (i + 1) * bytes) ?? unpackBridgeLut(bakeBridgeLutStrip(size, i as LookIndex), size)
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  return all ? 'brotli' : 'local'
}

let ripple: Uint8Array<ArrayBuffer> | undefined
export function bakeRippleTile(): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(64 * 64 * 2), tau = Math.PI * 2
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = (x * 3 + y * 5) * tau / 64, u = (x * 7 - y * 2) * tau / 64, n = bridgeHash(x, y, 401) - .5
    const i = (y * 64 + x) * 2
    data[i] = Math.round((.5 + .19 * Math.cos(v) + .14 * Math.sin(u) + .15 * n) * 255)
    data[i + 1] = Math.round((.5 + .18 * Math.cos(v) - .14 * Math.sin(u) - .15 * n) * 255)
  }
  return data
}
export function rippleTile(gl: WebGL2RenderingContext): void {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 64, 64, 0, gl.RG, gl.UNSIGNED_BYTE, ripple ??= bakeRippleTile())
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.generateMipmap(gl.TEXTURE_2D)
}
