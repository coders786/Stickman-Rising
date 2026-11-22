/** Versioned, lossless conditioning before HTTP Brotli. Each component is
 * stored in its own plane, with modulo-256 horizontal differences and a
 * fresh predictor on each row. A is data, never premultiplied or gamma mapped.
 * Dimensions come from the consuming renderer, not from an allocation size
 * in the payload. Rows and component order round-trip exactly. */
export type PlaneLayout = readonly (readonly [width: number, height: number, channels: number])[]
export const BAKED_ROOT = '/bridge/baked-v1/'
export const DECK_PACK = 'deck.bin.br'
export const gradePack = (n: 16 | 32) => `look-${n}.bin.br`

const sizeOf = (layout: PlaneLayout) => layout.reduce((n, [w, h, c]) => n + w * h * c, 0)
const TAG_BYTES = 4

export function packBridgePlanes(data: Uint8Array, layout: PlaneLayout, tag: string): Uint8Array<ArrayBuffer> {
  if (tag.length !== TAG_BYTES || data.length !== sizeOf(layout)) throw new RangeError('Wrong Bridge bake layout')
  const out = new Uint8Array(TAG_BYTES + data.length)
  for (let i = 0; i < TAG_BYTES; i++) out[i] = tag.charCodeAt(i)
  let src = 0, dst = TAG_BYTES
  for (const [w, h, channels] of layout) {
    for (let c = 0; c < channels; c++) for (let y = 0; y < h; y++) {
      let prev = 0, i = src + y * w * channels + c
      for (let x = 0; x < w; x++, i += channels) {
        const next = data[i]
        out[dst++] = next - prev; prev = next
      }
    }
    src += w * h * channels
  }
  return out
}

export function unpackBridgePlanes(data: Uint8Array, layout: PlaneLayout, tag: string): Uint8Array<ArrayBuffer> {
  const length = sizeOf(layout)
  if (tag.length !== TAG_BYTES || data.length !== TAG_BYTES + length) throw new RangeError('Wrong Bridge bake length')
  for (let i = 0; i < TAG_BYTES; i++) if (data[i] !== tag.charCodeAt(i)) throw new RangeError('Wrong Bridge bake version')
  const out = new Uint8Array(length)
  let src = TAG_BYTES, dst = 0
  for (const [w, h, channels] of layout) {
    for (let c = 0; c < channels; c++) for (let y = 0; y < h; y++) {
      let prev = 0, i = dst + y * w * channels + c
      for (let x = 0; x < w; x++, i += channels) {
        prev = (prev + data[src++]) & 255
        out[i] = prev
      }
    }
    dst += w * h * channels
  }
  return out
}
