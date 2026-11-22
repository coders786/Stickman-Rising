/** Seed-independent Bridge skyline and street cards. No browser or live scene capture. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { bridgeArtPixels } from './bridge-art-pixels'
import { paintBridgePropAtlas } from '../src/game/world/props'
import { BRIDGE_PROP_W, BRIDGE_PROP_H } from '../src/game/stage/bridge-prop-art'
import { CITY_CARD_H, CITY_CARD_W, STREET_CARD_W, STREET_CARD_H, paintCityCard, paintStreetCard, paintUndersidePier, PIER_L, PIER_R, PIER_TOP, PIER_BOTTOM } from '../src/game/stage/bridge-city'
import { bakeHorizonStrips, HORIZON_H, HORIZON_W } from '../src/graphics/bridge/SkyBasis'

async function main() {
  const path = process.argv[2] ?? 'public/bridge'
  await mkdir(path, { recursive: true })
  const write = async (name: string, canvas: Canvas, distantAlbedo = false) => {
    // Only the distant visual plates get RGB compression. Alpha is exact,
    // and the byte-linear basis/masks never go through this color codec.
    const options = distantAlbedo ? { quality: 94, alphaQuality: 100, smartSubsample: true, effort: 4 } : { lossless: true, effort: 4 }
    const { size, width, height } = await bridgeArtPixels(canvas).webp(options).toFile(join(path, `${name}.webp`))
    console.log(`${name}.webp ${width}×${height} ${size} bytes`)
  }
  const sky = createCanvas(HORIZON_W, HORIZON_H), g = sky.getContext('2d'), data = bakeHorizonStrips()
  const p = g.createImageData(sky.width, sky.height)
  for (let y = 0; y < sky.height; y++) for (let x = 0; x < sky.width; x++) {
    const i = (y * sky.width + x) * 4, j = ((sky.height - 1 - y) * sky.width + x) * 4
    for (let k = 0; k < 3; k++) {
      const v = data[j + k] / 255, c = (v * (2.51 * v + .03)) / (v * (2.43 * v + .59) + .14)
      p.data[i + k] = Math.round(255 * (c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055))
    }
    p.data[i + 3] = 255
  }
  g.putImageData(p, 0, 0)
  const street = createCanvas(STREET_CARD_W, STREET_CARD_H)
  paintStreetCard(street.getContext('2d') as unknown as CanvasRenderingContext2D)
  const pier = createCanvas(PIER_R - PIER_L, PIER_BOTTOM - PIER_TOP), under = pier.getContext('2d')
  under.translate(-PIER_L, -PIER_TOP); paintUndersidePier(under as unknown as CanvasRenderingContext2D)
  const props = createCanvas(BRIDGE_PROP_W, BRIDGE_PROP_H)
  paintBridgePropAtlas(props.getContext('2d') as unknown as CanvasRenderingContext2D)
  await Promise.all([write('stratum-a', sky), write('metro-street', street), write('deck-pier', pier), write('props-v2', props), ...([0, 1] as const).map(d => {
    const c = createCanvas(CITY_CARD_W, CITY_CARD_H[d]); paintCityCard(c.getContext('2d') as unknown as CanvasRenderingContext2D, d)
    return write(`l${d + 1}`, c, true)
  })])
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
