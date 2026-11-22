import { RAIN_GUST } from './bridge-weather-data'
import { bridgeHash } from './bridge-material'
import type { RouteChunk } from './route'

export const DISTRICT_ACCENT = ['#8acdd0', '#e0ad83', '#a5c9b1'] as const
export const DECK_WIRE = { x: 4, y: -247, foot: -59 } as const
export const deckGuideSocket = (c: RouteChunk) => c.left + (c.index === 0 ? 262 : c.shelter ? 285 : 718)
export const GUIDE_LENS_Y = -71
export const DISTRICT_PANEL = [
  { left: -82, right: 102, top: -207, bottom: -83, returnX: 17, returnY: -9, sign: 'METRO LINK', use: 'NORTH LOOP · PLATFORM 02' },
  { left: -151, right: 116, top: -246, bottom: -78, returnX: 24, returnY: -13, sign: 'NIGHT MARKET', use: 'FOOD HALL · OPEN LATE' },
  { left: -87, right: 159, top: -232, bottom: -79, returnX: 21, returnY: -13, sign: 'SKY GARDEN', use: 'PUBLIC TERRACE · LEVEL 02' },
] as const
export const districtSocket = (chunk: RouteChunk) => chunk.left + Math.floor((chunk.right - chunk.left) * .67)

/** Continuous gust shared by suspended cables, cloth and canopy details. */
export function routeWind(x: number, t: number, wind: number, impulse = 0): number {
  const g = RAIN_GUST
  return wind * g.base + g.a * Math.sin(x * g.x + t * g.first) + g.b * Math.sin(x * g.y - t * g.second) + impulse * .9 * Math.sin(t * 28 + x * .08)
}

/** Smooth interpolation between sparse seeded variations. Never toggle a
 * sprite on a per-render RNG, and keep the signed fixture intensity stable. */
export function flickerGain(seed: number, time: number): number {
  const s = time * 6.4, i = Math.floor(s), f = s - i, t = f * f * (3 - 2 * f)
  const a = bridgeHash(i, seed, 364), b = bridgeHash(i + 1, seed, 364)
  return .78 + .22 * (a * (1 - t) + b * t)
}

/** A paired curb lamp on exposed approaches, aimed back towards its mate. */
export const fillLampSocket = (c: RouteChunk) => !c.shelter && (c.index % 3 === 1 || c.index % 7 === 3) ? c.lamp - 224 : null
export const lampHealth = (c: RouteChunk) => c.seed % 11 === 2 ? .16 : c.seed % 5 === 0 ? .70 : 1
