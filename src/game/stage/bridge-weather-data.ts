import { clamp01 } from '../core/utils'
import { ROAD } from './road-section'
import type { RouteChunk } from './route'

/** A common physical vocabulary for the Mobile stroke batches and the
 * instanced Master weather pass. Positions are world-space behind the HUD. */
export const RAIN_CELL = 192
export const RAIN_HEIGHT = 720
export const MOBILE_RAIN_LIMIT = 80
export const MASTER_RAIN_SLOTS = [82, 118, 150] as const
export const MASTER_MOTE_SLOTS = 84
export const BRIDGE_VENT_BUDGET = 3
/** Some of the already painted 112px service grates breathe. The outlet
 * shares the actual road ordinate; the steam never starts in mid-air. */
export function bridgeVentX(c: RouteChunk): number | null {
  if (c.visualBand !== 2 && c.seed % 3 !== 1) return null
  const raw = c.left + 169 + (c.seed >>> 12) % 602, x = Math.round((raw - 46) / 112) * 112 + 46
  if (c.shelter && x > c.shelter.left - 68 && x < c.shelter.right + 68) return null
  return x
}
export const BRIDGE_VENT_Y = ROAD.front - 9
export const RAIN_PLANES = [
  { parallax: .4, salt: 0x1986b3ad, paint: '#889fbb', width: .75, gain: .38, base: 194, speed: 104, length: 8, floor: ROAD.rear + 8 },
  { parallax: 1, salt: 0x2cde8143, paint: '#a5bed1', width: .95, gain: .49, base: 311, speed: 124, length: 13, floor: ROAD.lane + 15 },
  { parallax: 1.4, salt: 0xfa092d99, paint: '#c5d5eb', width: 1.44, gain: .31, base: 482, speed: 169, length: 20, floor: ROAD.front },
] as const

// Districts amplify wet fronts; they do not manufacture rain under a clear sky.
export const bridgePrecipitation = (rain: number, district: number) => clamp01(rain * (.84 + .18 * district))
export const bridgeRetention = (wet: number, district: number) => clamp01(wet * (1 + Math.max(0, district - 1) * .28))
export const RAIN_GUST = { x: .0081, y: .021, first: 1.7, second: 2.49, a: .38, b: .21, base: .73 } as const
