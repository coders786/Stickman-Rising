import { LIGHT_W, chunkLightTile, lightRow, type ChunkLightTile } from '../../graphics/bridge/EnvBasis'
import { ROAD } from './road-section'
import type { BridgeRoute, RouteChunk } from './route'

const inverse = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
})
const display = Uint8Array.from({ length: 4096 }, (_, i) => {
  const v = i / 1600, c = Math.min(1, v * (2.51 * v + .03) / (v * (2.43 * v + .59) + .14))
  const u = c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055
  return Math.round(u * 249 + 4)
})
const exponent = Float32Array.from({ length: 32 }, (_, i) => 2 ** (i - 24))
const encode = (n: number) => display[Math.min(4095, Math.max(0, Math.round(n * 1600)))]

/** Apply the original section-authored radiance and tone curve. The plate
 * can be cropped without changing its world Y, receiver band or irradiance. */
export function finishCanvasChunk(pixels: Uint8ClampedArray, w: number, h: number, top: number,
  tile: Pick<ChunkLightTile, 'shadow' | 'irradiance'>): void {
  const { shadow, irradiance } = tile, cols = new Int32Array(w)
  for (let x = 0; x < w; x++) cols[x] = 4 * Math.min(LIGHT_W - 1, Math.floor((x + .5) / w * LIGHT_W))
  for (let y = 0, i = 0; y < h; y++) {
    const wy = top + y, road = wy >= ROAD.rear && wy < ROAD.front
    const at = lightRow(wy + .5, road) * LIGHT_W * 4, bright = road ? .82 : .66
    for (let x = 0; x < w; x++, i += 4) if (pixels[i + 3] !== 0) {
      const k = at + cols[x], light = irradiance[k >>> 2], e = exponent[light >>> 27], ao = shadow[k + 2] / 255
      const fill = .208 + .34 * (shadow[k + 1] / 255), moon = (shadow[k] / 255) * bright * .83
      pixels[i] = encode(inverse[pixels[i]] * (fill + .78 * moon + (light & 511) * e) * ao)
      pixels[i + 1] = encode(inverse[pixels[i + 1]] * (fill + .94 * moon + ((light >>> 9) & 511) * e) * ao)
      pixels[i + 2] = encode(inverse[pixels[i + 2]] * (fill + moon + ((light >>> 18) & 511) * e) * ao)
    }
  }
}

/** Semi-bake the dry plate once, in a worker. This is neither a second
 * lighting solver nor a readback of the displayed world. Rain stays live. */
export function bakeCanvasChunkLighting(g: OffscreenCanvasRenderingContext2D,
  route: BridgeRoute, c: RouteChunk, top: number): void {
  const { width: w, height: h } = g.canvas, art = g.getImageData(0, 0, w, h)
  finishCanvasChunk(art.data, w, h, top, chunkLightTile(route, c))
  g.putImageData(art, 0, 0)
}
