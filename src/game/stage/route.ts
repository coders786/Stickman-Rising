import { mulberry32, smoothstep } from '../core/utils'
import { SHELTER_KIT } from './run-layout'
import { deckFace } from './bridge-deck-face'

export const ROUTE_START = 240
export const BRIDGE_CHUNK_PX = 1152 // 24 optical metres at 48 px/m
export const WORLD_UNITS_PER_METRE = 10
export const SECTOR_LENGTH = 500 * WORLD_UNITS_PER_METRE
export const BIOME_BLEND = 800
export const BIOMES = ['Metro Approach', 'Market Overpass', 'Sky Garden District'] as const
export const BUFFS = ['Chain Lightning Dash', 'Vampiric Execute', 'Guard-Crush Heavy'] as const
export type ServiceBuff = typeof BUFFS[number]

export type RouteRole = 'transit' | 'service' | 'catwalk' | 'cargo' | 'viaduct'
export interface Platform { readonly left: number; readonly right: number; readonly y: number }
export interface RouteShelter {
  readonly id: number
  readonly kind: 'concourse' | 'service'
  readonly left: number
  readonly right: number
  readonly terminal: number
  readonly buff: ServiceBuff
}
export interface RouteChunk {
  readonly index: number
  readonly left: number
  readonly right: number
  readonly seed: number
  readonly role: RouteRole
  readonly visualBand: 0 | 1 | 2
  readonly shelter: RouteShelter | null
  readonly platform: Platform | null
  readonly wetSign: number | null
  readonly lamp: number
  readonly propSockets: readonly number[]
}

/** Start-to-finish run address space. No frame clock, canvas or encounter RNG.
 * Append-only small descriptors let backtracking reproduce the same world;
 * backing stores are a separate, three-slot streaming cache. */
export class BridgeRoute {
  private readonly chunks: RouteChunk[] = []
  private nextService: number
  private shelterId = 0

  constructor(readonly seed: number) {
    this.nextService = 3 + (seed & 1)
  }

  private append(): RouteChunk {
    const index = this.chunks.length
    const seed = (this.seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0
    const rng = mulberry32(seed)
    const left = this.chunks.at(-1)?.right ?? 0
    const length = BRIDGE_CHUNK_PX
    const lampJitter = rng()
    const entryBand = entryBridgeSector(this.seed)
    const role: RouteRole = index === 0 ? 'transit' : index === this.nextService ? 'service' :
      (['catwalk', 'cargo', 'viaduct'] as const)[Math.floor(rng() * 3)]
    let shelter: RouteShelter | null = null
    if (role === 'transit' || role === 'service') {
      const kind = role === 'transit' ? 'concourse' : 'service'
      const start = left + 420 + (index === 0 ? 37 * entryBand : 0)
      shelter = { kind, id: ++this.shelterId, left: start, right: start + SHELTER_KIT[kind].width,
        terminal: start + SHELTER_KIT[kind].width / 2, buff: BUFFS[Math.floor(rng() * BUFFS.length)] }
      if (kind === 'service') this.nextService += 3 + Math.floor(rng() * 2)
    }
    const platform = role === 'catwalk' || role === 'cargo'
      ? { left: left + 338, right: left + 692, y: deckFace({ role }).y } : null
    const visualBand = index === 0 ? entryBand : Math.min(2, sectorAt(left + length * .5)) as 0 | 1 | 2
    const chunk = { index, left, right: left + length, seed, role, visualBand, shelter, platform,
      wetSign: index % 3 === 0 ? left + 174 + (index === 0 ? 14 * entryBand : 0) : null, lamp: left + length - 112 - Math.round(lampJitter * 38),
      propSockets: [left + 98 + Math.floor(rng() * 36), left + length - 84] }
    this.chunks.push(chunk)
    return chunk
  }

  chunk(index: number): RouteChunk {
    while (this.chunks.length <= index) this.append()
    return this.chunks[index]
  }

  at(x: number): RouteChunk {
    return this.chunk(Math.max(0, Math.floor(x / BRIDGE_CHUNK_PX)))
  }

  *between(left: number, right: number): IterableIterator<RouteChunk> {
    let chunk = this.at(left)
    while (chunk.left < right) {
      yield chunk
      if (chunk.right >= right) break
      chunk = this.chunk(chunk.index + 1)
    }
  }

  shelterAt(x: number, margin = 0): RouteShelter | null {
    // All eaves are >margin from chunk seams (margin is used for feet and rain).
    const shelter = this.at(x).shelter
    return shelter && x >= shelter.left - margin && x < shelter.right + margin ? shelter : null
  }

  platformAt(x: number): Platform | null {
    const platform = this.at(x).platform
    return platform && x >= platform.left && x < platform.right ? platform : null
  }

  /** Swept cover stop. Background and gameplay share the same eaves, but
   * body clearance is larger than a projectile's. Return the first boundary. */
  stopAtCover(from: number, to: number, clearance = 0): number {
    if (from === to) return to
    const left = Math.min(from, to) - clearance, right = Math.max(from, to) + clearance + .001
    let stop = to
    for (const { shelter } of this.between(left, right)) {
      if (!shelter) continue
      if (to > from && from < shelter.left && to >= shelter.left - clearance)
        stop = Math.min(stop, Math.max(from, shelter.left - clearance))
      else if (to < from && from >= shelter.right && to < shelter.right + clearance)
        stop = Math.max(stop, Math.min(from, shelter.right + clearance))
    }
    return stop
  }

  /** Put the gate on road with a clear approach and no roof in its footprint. */
  gateX(index: number): number {
    let x = ROUTE_START + (index + 1) * SECTOR_LENGTH
    // A shift must re-check the new approach, not just the original interval.
    // Service shelters are separated by at least three chunks.
    for (;;) {
      let block: RouteShelter | null = null
      for (const { shelter } of this.between(x - 440, x + 80)) {
        if (shelter && shelter.right > x - 440 && shelter.left < x + 80) { block = shelter; break }
      }
      if (!block) break
      x = block.right + 456
    }
    return x
  }
}

export const travelledMetres = (x: number) => Math.max(0, (x - ROUTE_START) / WORLD_UNITS_PER_METRE)
export const sectorAt = (x: number) => Math.max(0, Math.floor((x - ROUTE_START) / SECTOR_LENGTH))
export const biomeAt = (x: number) => BIOMES[Math.min(2, sectorAt(x))]

/** Continuous spatial grading, sampled at camera/player x, never snapped at a seam. */
export function biomeMix(x: number): number {
  return smoothstep((x - ROUTE_START - SECTOR_LENGTH + BIOME_BLEND / 2) / BIOME_BLEND) +
    smoothstep((x - ROUTE_START - 2 * SECTOR_LENGTH + BIOME_BLEND / 2) / BIOME_BLEND)
}

/** A seed chooses the entry's materials/weather; safety shelter, progression
 * gates and HUD distance do not move with the visual district. */
export const entryBridgeSector = (seed: number) => ((Math.imul(seed ^ 42, 0x9e3779b1) >>> 0) % 3) as 0 | 1 | 2
export const bridgeBiomeMix = (x: number, seed: number) => biomeMix(x) + entryBridgeSector(seed) * (1 - smoothstep((x - 480) / 1850))
