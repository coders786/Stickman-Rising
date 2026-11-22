import { CITY_PERIOD, FAR_CITY, MID_CITY, skyHash as hash, unit } from './SkyBasis'

export const CITY_CARD_W = 1024
export const CITY_CARD_H = [240, 280] as const
export const CITY_CENTRE = [214, 493] as const
export const CITY_USES = ['office', 'residence', 'hotel', 'civic', 'terrace', 'loft'] as const
export type CityUse = typeof CITY_USES[number]
export type Tower = Readonly<{
  x: number; w: number; h: number; top: number; ledge: number; crown: number; mast: boolean; id: number; use: CityUse
  inset: number; roofStep: number; landmark: boolean
}>

function towers(depth: 0 | 1): Tower[] {
  const entries: Tower[] = [], n = depth ? 18 : 33, pitch = CITY_CARD_W / n, height = CITY_CARD_H[depth]
  for (let i = 0; i < n; i++) {
    const id = i + depth * 71, a = hash(id, 2, 156), b = hash(id, 6, 186), c = hash(id, 8, 179)
    const landmark = !!depth && (i === 2 || i === 8 || i === 14)
    const use = landmark ? (i === 2 ? 'office' : i === 8 ? 'hotel' : 'residence') : CITY_USES[(i + Math.floor(a * 3)) % CITY_USES.length]
    const x = 2 + pitch * i + 6 * a
    const w = Math.min(CITY_CARD_W - x, pitch * (use === 'civic' ? .93 + b * .21 : .62 + b * (depth ? .42 : .54)))
    const low = use === 'civic' || use === 'loft' || use === 'terrace'
    const h = landmark ? 215 + c * 26 : use === 'civic' ? 45 + c * 54 : (low ? 49 : 88) + (depth ? 130 : 101) * c ** 1.6
    const top = height - h, ledge = Math.min(w * .24, 6 + 8 * a), inset = use === 'office' ? w * .21 : use === 'hotel' ? w * .17 : w * .09
    const roofStep = (depth ? 17 : 9) + b * (use === 'office' || landmark ? 19 : 7)
    entries.push({ x, w, h, top, ledge, id, use, roofStep, inset, landmark,
      crown: Math.max(4, top - roofStep), mast: landmark || !low && id % 9 === 1 })
  }
  // Tall towers are behind closer lofts and podiums in the same tile.
  return entries.sort((a, b) => b.h - a.h)
}

/** One source of truth for skyline albedo, apertures and occupancy. */
export const BRIDGE_TOWERS = [towers(0), towers(1)] as const
const profile = BRIDGE_TOWERS.map((band, d) => {
  const row = new Float32Array(CITY_CARD_W), height = CITY_CARD_H[d]
  for (const s of band) for (let j = Math.floor(s.x); j < Math.ceil(s.x + s.w); j++) {
    const u = j + .5 - s.x
    const crown = u > s.inset && u < s.w - s.ledge * 1.3 ? s.crown - 2 : s.top - s.ledge * .5
    row[j % CITY_CARD_W] = Math.max(row[j % CITY_CARD_W], height - crown)
  }
  return row
})

export function skylineHeight(band: 0 | 1, phase: number): number {
  return profile[band][Math.floor(unit(phase) * CITY_CARD_W)]
}

// Card addresses have a world-anchored centre; zoom changes repeat scale,
// never the phase of a distant building or the optical window centre.
export const citySeedShift = (seed: number, band: 0 | 1) => Math.round((hash(seed, band, 337) - hash(42, band, 337)) * 712)
export const citySeedScale = (seed: number, band: 0 | 1) => 1 + (hash(seed, band, 441) - hash(42, band, 441)) * .25
export const cityPhase = (x: number, seed: number, band: 0 | 1) => (x * (band ? MID_CITY : FAR_CITY).factor + CITY_CENTRE[band] + citySeedShift(seed, band)) / CITY_PERIOD
const beam = [[-.39, .14], [.14, .24], [.46, .39]] as const

/** Low-angle hemisphere through the two skyline depth planes. */
export function cityHorizonAccess(worldX: number, seed = 42): number {
  let open = 0
  for (const [dx, slope] of beam) {
    const mid = skylineHeight(1, cityPhase(worldX + 430 * dx, seed, 1))
    const far = skylineHeight(0, cityPhase(worldX + 840 * dx, seed, 0))
    open += +(mid * citySeedScale(seed, 1) - 26 <= slope * 430 && far * citySeedScale(seed, 0) - 74 <= slope * 840)
  }
  return .72 + open * (.28 / 3)
}

/** Seven aperture samples traverse both depth planes. A silhouette shadow is
 * part of baked R, not a screen multiply over local practical lighting. */
export function cityMoonAccess(x: number, seed: number): number {
  const u = x * MID_CITY.factor + citySeedShift(seed, 1) - 53
  const v = x * FAR_CITY.factor + citySeedShift(seed, 0) - 86
  const hm = citySeedScale(seed, 1), hf = citySeedScale(seed, 0)
  let open = 0
  for (let i = -3; i <= 3; i++) {
    const a = skylineHeight(1, (u + i * 2.7) / CITY_PERIOD)
    const b = skylineHeight(0, (v + i * 1.9) / CITY_PERIOD)
    open += +(a * hm < 159 + i * 1.5 && b * hf < 174 + i)
  }
  return open / 7
}
