/** Deterministic data (including skyline shape masks derived from the real
 * shipped plates). No browser, camera, or color-managed RGBA upload. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
import { packBridgePlanes } from '../src/graphics/bridge/BridgeAssetCodec'
import { bridgeArtPixels } from './bridge-art-pixels'
import { createCanvas } from '@napi-rs/canvas'
import { CITY_CARD_W, CITY_CARD_H, paintCityCard } from '../src/game/stage/bridge-city'
import { bakeHorizonStrips, bakeLunarSurface, bakeStormAtlas, CITY_MASK_H, CITY_MASK_W,
  SKY_BASIS_BYTES, SKY_BASIS_URL, SKY_PACK_LAYOUT, SKY_PACK_TAG, sat } from '../src/graphics/bridge/SkyBasis'

async function skyline(index: 0 | 1) {
  const w = CITY_MASK_W, h = CITY_MASK_H[index]
  const paint = (emission: boolean) => {
    const c = createCanvas(CITY_CARD_W, CITY_CARD_H[index])
    paintCityCard(c.getContext('2d') as unknown as CanvasRenderingContext2D, index, true, emission)
    return bridgeArtPixels(c).resize(w, h).raw().toBuffer()
  }
  // Derive the signal from the authoring pixels, never a compressed display plate.
  const [data, glazing] = await Promise.all([paint(false), paint(true)])
  const p = new Uint8Array(w * h * 4), bin = (x: number, y: number) => (Math.min(h - 1, Math.max(0, y)) * w + (x + w) % w) * 4
  const a = (x: number, y: number) => y < 0 ? 0 : data[bin(x, y) + 3] / 255
  const luma = (i: number) => (data[i] * .22 + data[i + 1] * .70 + data[i + 2] * .08) / 255
  const silhouettes = Array.from({ length: w }, (_, x) => {
    for (let y = 0; y < h; y++) if (a(x, y) >= .52) return y
    return h
  })
  // Intersect the rays with the skyline from the *same* painted silhouettes.
  // A small start offset leaves the receiving cornice itself out of the test.
  const access = (x: number, y: number, direction: number, slope: number) => {
    for (let step = 3; step < 43 && y - step * slope > 0; step += 2)
      if (silhouettes[(x + direction * step + w) % w] < y - step * slope) return 0
    return 1
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = bin(x, y), o = ((h - 1 - y) * w + x) * 4
    const roof = Math.max(0, a(x, y) - a(x, y - 2)), side = Math.max(Math.abs(a(x, y) - a(x - 1, y)), Math.max(0, luma(c) - luma(bin(x + 1, y))) * .65)
    const v = y / h, wall = a(x, y)
    const lunar = (access(x, y - 1, -1, .68) + access(x, y - 1, -1, .86) + access(x, y - 1, -1, 1.04)) / 3
    const sky = (lunar + access(x, y - 1, 1, .56) + access(x, y - 1, 1, .92) + access(x, y - 1, -1, 1.46)) * .25
    p[o] = Math.round(255 * sat(lunar * (.52 + .48 * roof)))
    p[o + 1] = Math.round(255 * sat(sky * (.32 + .83 * roof + .23 * side)))
    p[o + 2] = Math.round(255 * sat(.42 + .42 * sky - .23 * v + .40 * roof + .12 * side))
    p[o + 3] = Math.round(255 * Math.max(roof * sky * .26, glazing[c] / 255 * glazing[c + 3] / 255) * wall)
  }
  return p
}

async function main() {
  const c = await Promise.all([skyline(0), skyline(1)])
  const data = Buffer.concat([bakeLunarSurface(), bakeStormAtlas(), bakeHorizonStrips(), ...c])
  if (data.length !== SKY_BASIS_BYTES) throw new RangeError('Sky basis length mismatch')
  const path = process.argv[2] ?? `public${SKY_BASIS_URL}`
  const bytes = path.endsWith('.br') ? brotliCompressSync(packBridgePlanes(data, SKY_PACK_LAYOUT, SKY_PACK_TAG), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }) : data
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  console.log(`${path}: ${bytes.length} on disk, ${data.length} restored (linear RGBA8, ground-up)`)
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
