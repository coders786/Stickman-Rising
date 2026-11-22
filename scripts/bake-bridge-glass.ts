/** Opposite-bank radiance, filtered offline through rough glass. All filtering
 * is in linear light. There is no game camera, framebuffer or input screenshot. */
import { createCanvas } from '@napi-rs/canvas'
import sharp from 'sharp'
import { CITY_CARD_W, CITY_CARD_H, paintCityCard } from '../src/game/stage/bridge-city'
import { concourseShop } from '../src/game/stage/bridge-shop-layout'
import { CITY_PERIOD, mix, sat, smoothRange } from '../src/graphics/bridge/SkyBasis'
import { GLASS_ATLAS_H, GLASS_CITY_BOTTOM, GLASS_CITY_TOP, GLASS_ENV_BOTTOM, GLASS_ENV_H, GLASS_ENV_TOP, GLASS_ENV_W,
  GLASS_FAR_Z, GLASS_PLATE, GLASS_PROFILES, GLASS_RADIANCE_RANGE, glassDistance, glassEnvironmentRow, glassLobe } from '../src/graphics/bridge/ShopGlassOptics'

const w = GLASS_ENV_W, h = GLASS_ENV_H, span = GLASS_ENV_BOTTOM - GLASS_ENV_TOP
const encode = (l: number) => Math.round(255 * sat(l <= .0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - .055))
const storeLinear = (l: number) => Math.round(255 * sat(l / GLASS_RADIANCE_RANGE))
const decode = Float64Array.from({ length: 256 }, (_, i) => i / 255 <= .04045 ? i / (255 * 12.92) : ((i / 255 + .055) / 1.055) ** 2.4)

function blur(input: Float32Array, sigma: number, horizontal: boolean) {
  const radius = Math.ceil(sigma * 3), inv = .5 / (sigma * sigma)
  const k = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) * inv))
  const normal = k.reduce((a, b) => a + b), dst = new Float32Array(input.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const out = (y * w + x) * 3
    for (let i = -radius; i <= radius; i++) {
      const sx = horizontal ? (x + i + w) % w : x
      const sy = horizontal ? y : Math.max(0, Math.min(h - 1, y + i))
      const src = (sy * w + sx) * 3, weight = k[i + radius] / normal
      for (let c = 0; c < 3; c++) dst[out + c] += weight * input[src + c]
    }
  }
  return dst
}

function bake() {
  const city = createCanvas(w, h), g = city.getContext('2d'), ch = CITY_CARD_H[1]
  const art = (emit: boolean) => {
    g.clearRect(0, 0, w, h); g.save();
    g.translate(0, (GLASS_CITY_TOP - GLASS_ENV_TOP) / span * h)
    g.scale(w / CITY_CARD_W, (GLASS_CITY_BOTTOM - GLASS_CITY_TOP) / span * h / ch)
    paintCityCard(g as unknown as CanvasRenderingContext2D, 1, true, emit)
    g.restore(); return g.getImageData(0, 0, w, h).data
  }
  const albedo = art(false), emit = art(true), atlas = Buffer.alloc(w * GLASS_ATLAS_H * 4)
  for (const exposed of [false, true]) {
    const field = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wx = (x + .5) / w * 2 * Math.PI, wy = GLASS_ENV_TOP + (y + .5) / h * span
      const cloud = .70 + .17 * Math.cos(wx * 2 + wy * .006) + .09 * Math.sin(wx * 5 - wy * .012)
      const horizon = Math.exp(-(((wy + 82) / 440) ** 2)), below = smoothRange(-54, 40, wy)
      const opacity = albedo[(y * w + x) * 4 + 3] / 255 * (1 - smoothRange(-87, GLASS_CITY_BOTTOM, wy))
      for (let k = 0; k < 3; k++) {
        // A distant, diffuse horizon and a near-black embankment beneath it.
        const air = mix([.008, .014, .024][k], [.075,.128,.196][k], horizon * cloud)
        const sky = (exposed ? air + [.23,.33,.44][k] * horizon : air) * (1 - below * .90)
        const i = (y * w + x) * 4, emission = decode[emit[i]] * emit[i + 3] / 255
        // Beer-Lambert distance through mist, plus the emitting window mask.
        const t = Math.exp(-(.16 + horizon * .27)), light = exposed ? 1.32 : .61
        const lit = decode[albedo[i + k]] * light + emission * [.95, 1.15, 1.36][k]
        field[(y * w + x) * 3 + k] = mix(sky, sky * (1 - t) + lit * t, opacity)
      }
    }
    for (const [i, roughness] of GLASS_PROFILES.entries()) {
      // Convolve a normalized specular core and its broad, low-energy wing.
      // Wrap azimuth, clamp elevation, then encode the combined radiance.
      const footprint = glassLobe(roughness) * glassDistance(concourseShop.z, GLASS_FAR_Z)
      const filtered = (spread: number) => blur(blur(field, footprint * w / (CITY_PERIOD * 1.42) * spread, true), footprint * h / span * spread, false)
      const core = filtered(.72), wing = filtered(1.85)
      for (const linear of [true, false]) {
        const row = glassEnvironmentRow(i, exposed, linear), write = linear ? storeLinear : encode
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dst = ((row + y) * w + x) * 4, src = (y * w + x) * 3
          for (let k = 0; k < 3; k++) atlas[dst + k] = write(mix(core[src + k], wing[src + k], .19))
          atlas[dst + 3] = 255
        }
      }
    }
  }
  return atlas
}

const file = process.argv[2] ?? `public/bridge/${GLASS_PLATE}.webp`
void sharp(bake(), { raw: { width: w, height: GLASS_ATLAS_H, channels: 4 } }).webp({ lossless: true, effort: 5 }).toFile(file)
  .then(info => console.log(`${file}: ${info.width}×${info.height}, ${info.size} bytes`))
  .catch(error => { console.error(error); process.exitCode = 1 })
