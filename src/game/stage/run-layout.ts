import { FLOOD } from '../lighting/emitters'
import { ExposureMap, OPEN_AIR, type ReceiverZone } from '../world/exposure'
import { environmentRandom, type FrontRecipe } from '../world/fronts'
import type { PointLight } from '../world/lightfield'
import { FLAT_LANE } from './flat-lane'
import { ROAD } from './road-section'

export const BRIDGE_CLIMATE: FrontRecipe = {
  version: 1, salt: 0x3b76adc2, openings: ['drizzle', 'rain'],
  openingHold: [9, 13], dwell: [23, 34], duration: 10,
}

/** Fixed kit dimensions, not fixed world locations. A seed places the kit on
 * the continuous span; Retry reuses its art. These use deck/world y, never
 * screen pixels. */
export const SHELTER_KIT = {
  concourse: { width: 344, ridgeY: -332, eaveY: -248, lampX: 191, lampY: -223, radius: 354, gain: 1.14 },
  service: { width: 232, ridgeY: -282, eaveY: -220, lampX: 122, lampY: -195, radius: 270, gain: .96 },
} as const
export type ShelterKind = keyof typeof SHELTER_KIT
export const SHELTER_KINDS = ['concourse', 'service'] as const

/** Recess mouth is just inside the same posts painted by the route kit.
 * Depth is an oblique projection dimension, not a gameplay coordinate. */
export function shelterPortal(s: { kind: ShelterKind; left: number; right: number }) {
  const kit = SHELTER_KIT[s.kind]
  return { left: s.left + 24, right: s.right - 27, lintel: -(kit.eaveY + 76), depth: s.kind === 'service' ? 96 : 116 }
}


export interface RunShelter {
  readonly kind: ShelterKind
  readonly left: number
  readonly right: number
  readonly source: PointLight
}
export interface BridgeRunPlan {
  readonly seed: number
  readonly version: number
  readonly shelters: readonly RunShelter[]
  readonly exposure: ExposureMap
}

// A short shelter throws light forward into the fight lane, unlike the
// tall, narrower approach flood. Shared by transport and lens art.
export const SHELTER_FLOOD = { ...FLOOD, aimX: .13, aimZ: .58, innerCos: Math.cos(.28), outerCos: Math.cos(.65) }

const ART_LEFT = FLAT_LANE.artLeft - FLAT_LANE.artOverhang
const ART_RIGHT = FLAT_LANE.artRight + FLAT_LANE.artOverhang
const COVER = Object.freeze({ exteriorLight: .19, precipitation: 0, wind: .28, outsideAudio: .27 })

/** The fixture painter and the world probe call the same address rule. Probe
 * heights are relative to the rear-shoulder transform used by the bridge. */
export function shelterLight(kind: ShelterKind, left: number): PointLight {
  const mount = SHELTER_KIT[kind]
  return { id: `shelter:${kind}`, x: left + mount.lampX, y: mount.lampY - ROAD.fixtureOffset,
    kind: 'bulb', shape: SHELTER_FLOOD, radius: mount.radius, gain: mount.gain, flicker: 0, flickerHz: 0, phase: 0 }
}

/** Resolve only art sockets. The original playable bounds, spawn, footing,
 * props, wave queues and camera do not consume this plan. No reject/retry loop
 * or shared combat RNG; each decision has a separate salted channel. */
export function composeBridgeRun(seed: number): BridgeRunPlan {
  seed >>>= 0
  const west = environmentRandom(seed, 0x1e3ae7a5) < .50
  const service = (west ? 199 : 2024) + Math.floor(environmentRandom(seed, 0x10ae65e7) * (west ? 126 : 168))
  // Keep the transit canopy near entry but away from the lamp, beacon and
  // signal hardware. The side canopy sits between fixtures, not on top of one.
  const concourse = 1058 + Math.floor(environmentRandom(seed, 0x7d3fc045) * 80)
  const place = (kind: ShelterKind, left: number): RunShelter => ({
    kind, left, right: left + SHELTER_KIT[kind].width, source: shelterLight(kind, left),
  })
  const main = place('concourse', concourse), bay = place('service', service)
  const shelters = west ? [bay, main] : [main, bay]
  const zones: ReceiverZone[] = []
  let edge = ART_LEFT
  for (const { kind, left, right } of shelters) {
    zones.push({ id: `open-before:${kind}`, left: edge, right: left, material: 'wet-asphalt', access: OPEN_AIR, splashes: true })
    zones.push({ id: kind, left, right, material: 'matte-paving', access: COVER, splashes: false })
    edge = right
  }
  zones.push({ id: 'open-tail', left: edge, right: ART_RIGHT, material: 'wet-asphalt', access: OPEN_AIR, splashes: true })
  return { seed, version: 1, shelters, exposure: new ExposureMap(zones, 22) }
}
