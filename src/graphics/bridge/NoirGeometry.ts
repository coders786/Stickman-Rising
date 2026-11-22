import { DECK_WIRE, DISTRICT_ACCENT, DISTRICT_PANEL, GUIDE_LENS_Y, deckGuideSocket, districtSocket, fillLampSocket, lampHealth } from '../../game/stage/bridge-sockets'
import { CATWALK_DECK, CARGO_DECK, TOP_LANE, type DeckFace } from '../../game/stage/bridge-deck-face'
import { ROAD } from '../../game/stage/road-section'
import type { RouteChunk } from '../../game/stage/route'
import { SHELTER_KIT, shelterLight } from '../../game/stage/run-layout'
import { smoothRange } from './SkyBasis'
import { SACR_ACTOR_Z } from '../sacr/SACRMath'

/** Presentation coordinates only: X along the bridge, Y down in the side
 * elevation. No scenery box is added to the gameplay collision world. */
export const MOON_KEY = [-.62, -.74, .24] as const
export const MOON_SLOPE = MOON_KEY[0] / MOON_KEY[1]
export const LIGHT_SAMPLES = 7
export const BLOCKER_LIMIT = 24
export const WORLD_BLOCKER_LIMIT = 17 // Remaining records are in the distant rail plane.
export const SHADOW_REACH = 440
export const SODIUM = '#cc8e4b', MERCURY = '#869eb3', TUNGSTEN = '#c47b38'
export type Blocker = { left: number; top: number; right: number; bottom: number;
  depth?: readonly [number, number]; kind: 'catwalk' | 'roof' | 'jamb' | 'lintel' | 'bench' | 'cargo' | 'parapet' | 'kiosk' | 'pier' | 'lamp' | 'barrier' }
export type LightPoint = { x: number; y: number; reach: number; physicalRadius: number; strength: number; kelvin: number;
  rgb: readonly [number, number, number]; color: string; kind: 'spot' | 'bulb' | 'strip' | 'window'; z?: number;
  axisX: number; axisY: number; coneCos: number; halfWidth: number }
export type ChunkLightData = { moon: typeof MOON_KEY; points: readonly LightPoint[]; blockers: readonly Blocker[]; rearSurfaces: readonly Blocker[] }
const rgba = (s: string) => [1, 3, 5].map(i => (parseInt(s.slice(i, i + 2), 16) / 255) ** 2.2) as [number, number, number]
const records = new WeakMap<RouteChunk, ChunkLightData>()

export function catwalkSlab(chunk: RouteChunk) {
  const p = chunk.platform
  return chunk.role === 'catwalk' && p ? { left: p.left, right: p.right + CATWALK_DECK.returnX, top: p.y, bottom: p.y + CATWALK_DECK.thickness } : null
}

export function chunkLightData(c: RouteChunk): ChunkLightData {
  const old = records.get(c)
  if (old) return old
  const points: LightPoint[] = [], blockers: Blocker[] = [], rearSurfaces: Blocker[] = []
  const light = (x: number, y: number, reach: number, physicalRadius: number, strength: number, color: string,
    kind: LightPoint['kind'], axisX = 0, axisY = 1, coneCos = 0, halfWidth = 0, z = 5.8) => {
    points.push({ x, y, reach, physicalRadius, strength, kelvin: color === MERCURY ? 4200 : color === SODIUM ? 2600 : kind === 'bulb' ? 2900 : 4100, rgb: rgba(color), color, kind, axisX, axisY, coneCos, halfWidth, z })
  }
  const box = (left: number, top: number, right: number, bottom: number, kind: Blocker['kind'], deck?: DeckFace) => {
    const depth = deck ? [SACR_ACTOR_Z - deck.near, SACR_ACTOR_Z + deck.near * (1 / TOP_LANE - 1)] as const : undefined
    blockers.push({ left, top, right, bottom, kind, depth })
  }
  const band = c.visualBand
  const pole = (x: number, secondary: boolean) => {
    const off = secondary ? 15 : -15
    light(x + off, -217, 342, 9, (secondary ? 2.95 : band === 2 ? 3.75 : 3.13) * lampHealth(c),
      band === 2 ? MERCURY : SODIUM, 'spot', secondary ? .333 : -.233, secondary ? .943 : .972, .77, 0, 5.44)
    box(x - 1, secondary ? -219 : DECK_WIRE.y - 13, x + 6, -57, 'lamp')
    box(x + off - 16, -229, x + off + 19, -220, 'lamp')
  }
  pole(c.lamp, false)
  const paired = fillLampSocket(c)
  if (paired !== null) pole(paired, true)
  const guide = deckGuideSocket(c)
  light(guide, GUIDE_LENS_Y, 116, 4, .94, DISTRICT_ACCENT[band], 'bulb', 0, 1, 0, 0, 4.95)
  const slab = catwalkSlab(c)
  if (slab) {
    box(slab.left, slab.top, slab.right, slab.bottom, 'catwalk', CATWALK_DECK)
    for (const x of [slab.left + 22, slab.right - CATWALK_DECK.returnX - 30]) box(x, slab.bottom, x + 12, -63, 'pier')
    light((slab.left + slab.right) * .5, slab.bottom + 2, 21, 1.5, .40, MERCURY, 'strip', 0, 1, 0, (slab.right - slab.left) * .44)
  } else if (c.platform) {
    const p = c.platform
    box(p.left, p.y, p.right + CARGO_DECK.returnX, CARGO_DECK.bottom + CARGO_DECK.returnY, 'cargo', CARGO_DECK)
  }
  // Two solid parapet housings, not the permeable run of railing.
  const pier = c.left + 134 + c.seed % 95
  box(pier - 10, -62, pier + 24, -48, 'parapet')
  if (c.wetSign !== null) {
    const x = c.wetSign
    box(x - 60, -180, x + 61, -139, 'kiosk')
    box(x - 41, -139, x - 35, -65, 'pier')
  }
  const cityX = c.left + (c.right - c.left) * (.32 + (c.seed % 53) * .007)
  light(cityX, -112, 184, 20, .16, '#9b8062', 'window', 0, 1, 0, 0, 7.15)
  const s = c.shelter
  if (s) {
    const { ridgeY, eaveY } = SHELTER_KIT[s.kind]
    const wide = s.kind === 'concourse'
    box(s.left, ridgeY, s.right, eaveY + 4, 'roof')
    box(s.left + 5, eaveY + 8, s.left + 18, 43, 'jamb')
    box(s.right - 19, eaveY + 8, s.right - 6, 43, 'jamb')
    box(s.left + 18, eaveY + 7, s.right - 19, eaveY + 16, 'lintel')
    rearSurfaces.push({ left: s.left + 27, top: eaveY + 53, right: s.right - 37, bottom: ROAD.rear, kind: 'lintel' })
    if (wide) {
      box(s.left + 40, -100, s.left + 98, -65, 'bench')
      light(s.left + 69, -67, 21, 1.5, .40, MERCURY, 'strip', 0, 1, 0, 25)
    }
    const a = shelterLight(s.kind, s.left)
    light(a.x, Math.max(eaveY + 21, a.y + ROAD.fixtureOffset + 4), wide ? 172 : 228, wide ? 9 : 13,
      wide ? 1.72 : 3.8, wide ? '#af9a80' : TUNGSTEN, 'bulb', 0, 1, 0, 0, 5.65)
  } else {
    const x = districtSocket(c), d = DISTRICT_PANEL[band]
    const canopy = d.top + 28
    box(x + d.left - 6, canopy - 6, x + d.right + 13, canopy + 9, 'lintel')
    rearSurfaces.push({ left: x + d.left + 9, right: x + d.right - 8, top: canopy + 10, bottom: d.bottom, kind: 'kiosk' })
    for (const k of [d.left + 42, d.right - 38]) light(x + k, canopy + 17, 156, 6, 1.23, DISTRICT_ACCENT[band], 'bulb', 0, 1, 0, 0, 5.8)
  }
  const data = { moon: MOON_KEY, points, blockers, rearSurfaces }
  records.set(c, data)
  return data
}

const EPS = .0001
export function insideBlocker(x: number, y: number, b: Blocker): boolean {
  return x > b.left + EPS && x < b.right - EPS && y > b.top + EPS && y < b.bottom - EPS
}

/** Inclusive section bounds, with endpoints removed so neither a lens nor
 * the first face of the receiving solid counts as a blocker. */
export function blockerHit(x: number, y: number, tx: number, ty: number, b: Blocker, z?: number, tz?: number): boolean {
  const dx = tx - x, dy = ty - y
  let near = .001, far = .999
  if (Math.abs(dx) < EPS) { if (x <= b.left || x >= b.right) return false }
  else {
    const a = (b.left - x) / dx, z = (b.right - x) / dx
    near = Math.max(near, Math.min(a, z)); far = Math.min(far, Math.max(a, z))
  }
  if (Math.abs(dy) < EPS) { if (y <= b.top || y >= b.bottom) return false }
  else {
    const a = (b.top - y) / dy, z = (b.bottom - y) / dy
    near = Math.max(near, Math.min(a, z)); far = Math.min(far, Math.max(a, z))
  }
  if (b.depth && z !== undefined && tz !== undefined) {
    const [l, r] = b.depth, dz = tz - z
    if (Math.abs(dz) < EPS) { if (z < l || z > r) return false }
    else {
      const a = (l - z) / dz, b = (r - z) / dz
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b))
    }
  }
  return far > near
}

export function rayVisible(x: number, y: number, tx: number, ty: number, blockers: readonly Blocker[]): boolean {
  for (const b of blockers) {
    if (insideBlocker(x, y, b) || insideBlocker(tx, ty, b)) continue
    if (blockerHit(x, y, tx, ty, b)) return false
  }
  return true
}

export function softVisibility(x: number, y: number, tx: number, ty: number, radius: number, blockers: readonly Blocker[]): number {
  let sum = 0
  for (let i = 0; i < LIGHT_SAMPLES; i++) sum += +rayVisible(x, y, tx + (i / 3 - 1) * radius, ty, blockers)
  return sum / LIGHT_SAMPLES
}

/** A static fixture's share on the road. For raised slabs only, test at
 * optical elevation zero and clip to finite Z, just like the worker row. */
export function roadFixtureVisibility(x: number, y: number, z: number, p: LightPoint, lightZ: number, blockers: readonly Blocker[]): number {
  let visible = 0
  for (let i = 0; i < LIGHT_SAMPLES; i++) {
    const tx = p.x + (i / 3 - 1) * p.physicalRadius
    let lit = true
    for (const b of blockers) {
      if (!b.depth && (insideBlocker(x, y, b) || insideBlocker(tx, p.y, b))) continue
      if (b.depth && lightZ >= b.depth[0] && lightZ <= b.depth[1] && insideBlocker(tx, p.y, b)) continue
      if (blockerHit(x, b.depth ? ROAD.lane : y, tx, p.y, b, z, lightZ)) { lit = false; break }
    }
    visible += +lit
  }
  return visible / LIGHT_SAMPLES
}

/** Analytic cosine-power cookie with a soft cutoff, and inverse-square
 * attenuation regularised by a finite emitter. Distances are world units. */
export function staticFalloff(p: LightPoint, dx: number, dy: number): number {
  if (p.kind === 'strip') dx = Math.max(0, Math.abs(dx) - p.halfWidth)
  const r2 = dx * dx + dy * dy, range2 = p.reach * p.reach
  if (r2 >= range2) return 0
  const distanceFade = 1 - smoothRange(.42, 1, r2 / range2)
  const fall = p.strength * distanceFade / (1 + r2 / (p.kind === 'strip' ? 85 : p.kind === 'spot' ? 39500 : 13000))
  if (p.kind !== 'spot') return fall
  const cos = (dx * p.axisX + dy * p.axisY) / Math.sqrt(Math.max(1, r2))
  return fall * smoothRange(p.coneCos, .98, cos) * cos * cos
}

export function strongestPractical(x: number, y: number, data: ChunkLightData) {
  let gain = 0, point: LightPoint | undefined
  for (const p of data.points) {
    if (p.kind === 'strip') continue
    const a = staticFalloff(p, x - p.x, y - p.y)
    if (a <= gain) continue
    const v = a * softVisibility(x, y, p.x, p.y, p.physicalRadius, data.blockers)
    if (v > gain) { gain = v; point = p }
  }
  return { point, gain }
}
