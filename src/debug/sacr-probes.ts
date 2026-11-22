import { bridgeRoadWater } from '../game/stage/bridge-road-water'
import { packLightVector, unpackLightVector } from '../graphics/bridge/LightVectorGrid'
import { bakeStratumMips, sampleStratumMips, STRATUM_H, STRATUM_W } from '../graphics/sacr/SACRAtlas'
import { evaluateSACR_Ref, SACR_CURB_Z, sacrFootAO, shadowCapsuleCoverage } from '../graphics/sacr/SACRMath'
import { packArcPrim, packArchProfile, packCapsulePrim, packFootAO, packOpaqueBar, SACRColumnBinner, SACR_PRIORITY,
  SACRUniformBuffer, SACR_MASTER_K, type SACRBinItem, type SACRMaxK, type Vec3 } from '../graphics/sacr/SACRPacker'

export const SACR_PROBES = ['Dry AO', 'Arc Center', 'Bay Interior', 'Dual Arc', 'Catwalk Underside', 'Crossing dry shadows / baked umbra', 'Catwalk blocker / RGB9_E5', 'Finite emitter penumbra', 'Damp aggregate / pooled water'] as const
export const SACR_PROBE_IDS = [1, 2, 3, 4, 5, 7, 8, 9, 10] as const
export const MOBILE_PROBE_COUNT = 7
export const PROBE_VECTOR_WORDS = [packLightVector(.64, .55, .61, .58), packLightVector(-.64, .55, .61, .41)] as const
export const PROBE_IRR = [.657, .48, .259] as const
export const PROBE_SIZE = 16
export const PROBE_WIDTH_METRES = 24
export const PROBE_WORLD_X = 1250
export const PROBE_ATLAS_ORIGIN = 1240
export const PROBE_ATLAS_WIDTH = 64
export const PROBE_SOFFIT = [.27, .12, .045] as const
export type ProbePixel = readonly [number, number, number, number]

export function probeMips() {
  const linear = new Float32Array(STRATUM_W * STRATUM_H * 3)
  for (let y = 0; y < STRATUM_H; y++) for (let x = 0; x < STRATUM_W; x++) {
    const t = (y % (STRATUM_H / 2) + .5) / (STRATUM_H / 2), interior = y >= STRATUM_H / 2, u = (x + .5) / STRATUM_W
    const i = (y * STRATUM_W + x) * 3
    linear[i] = interior ? .45 + .31 * t + .04 * u : .04 + .07 * t
    linear[i + 1] = interior ? .15 + .17 * t : .13 + .54 * t
    linear[i + 2] = interior ? .07 : .72
  }
  return bakeStratumMips(linear)
}

export function probePacket(probe: number, maxK: SACRMaxK): SACRUniformBuffer {
  const buf = new SACRUniformBuffer(), items: SACRBinItem[] = []
  const z = 1.5
  const add = (minX: number, maxX: number, opaque = false) => {
    const index = items.length
    items.push({ index, minX, maxX, distance: index, zObj: z, priority: opaque ? SACR_PRIORITY.player : SACR_PRIORITY.emissive })
    return index
  }
  const arc = (x: number, r: number, e: number, angle = Math.PI * .75) =>
    packArcPrim(buf, add(x - r - .04, x + r + .04), x, 0, 1, 0, r, z, .04, angle, 255, 174, 255, e)
  if (probe === 1) { packFootAO(buf, 0, 2, z, .34, 0); arc(6, 1, 20) }
  if (probe === 2) arc(4, 2, 15)
  if (probe === 3) packArchProfile(buf, 0, PROBE_WORLD_X - PROBE_ATLAS_ORIGIN + 2, PROBE_WORLD_X - PROBE_ATLAS_ORIGIN + 7, 2, 3, PROBE_SOFFIT)
  const opaque = (x: number, r: number) =>
    packCapsulePrim(buf, add(x - .5, x + .5, true), x, .14, x, .14, r, z, r, 32, 72, 98, 0, 7)
  if (probe === 4) {
    opaque(3, .12); opaque(12, .10); opaque(12, .12)
    arc(1, 2, 10); arc(10, 2, 10); arc(10, 2, 10)
  }
  if (probe === 5) {
    const depth = 1.57
    items.push({ index: 0, minX: 2.5, maxX: 6, distance: 0, zObj: depth, priority: SACR_PRIORITY.architecture })
    packOpaqueBar(buf, 0, 2.5, 6, 1.34, .16, depth, 4.8, 0x344655)
    for (const x of [4, 12]) {
      const i = items.length, z = 3.4
      items.push({ index: i, minX: x - .2, maxX: x + .2, distance: i, zObj: z, priority: SACR_PRIORITY.emissive })
      packCapsulePrim(buf, i, x, z - 1.5, x, z - 1.5, .12, z, .12, 255, 125, 135, 4, 3)
    }
  }
  if (probe === 7) {
    items.push({ index: 0, minX: 7.77, maxX: 8.23, distance: 0, zObj: 3.4, priority: SACR_PRIORITY.player, caster: true, representative: true })
    packCapsulePrim(buf, 0, 8, .4, 8, 1.66, .23, 3.4, .23, 41, 55, 63, 0, 5)
    // Emissive overlapping the unmapped sample must not produce shadow.
    arc(11, 1.4, 20)
    packFootAO(buf, 0, 8, 2.4, .27, 0)
  }
  if (probe === 9) {
    items.push({ index: 0, minX: 7.8, maxX: 8.2, distance: 0, zObj: 3.4, priority: SACR_PRIORITY.player, caster: true })
    packCapsulePrim(buf, 0, 8, .14, 8, 1.66, .20, 3.4, .20, 41, 55, 63, 0, 5)
  }
  if (probe === 8) buf.f32.set([-1.15, -2.1, 1.15, -1.3], SACRUniformBuffer.OFF_BLOCKERS)
  const bins = new SACRColumnBinner()
  bins.write(buf, items, PROBE_WIDTH_METRES, maxK)
  bins.write(buf, items, PROBE_WIDTH_METRES, maxK, items.length, true)
  return buf
}

export function probeExpected(buf: SACRUniformBuffer, mips: ReturnType<typeof probeMips>, maxK: SACRMaxK, probe: number, u: number, v: number): ProbePixel {
  if (probe === 9) {
    const gap = v < .5 ? .24 : 2
    const distance = Math.abs((u - .5) * 1.12)
    const small = .018 + gap * .028, wide = .018 + gap * .092
    return [shadowCapsuleCoverage(distance, .20, small), shadowCapsuleCoverage(distance, .20, wide), wide, 1]
  }
  if (probe === 10) {
    const moisture = v < .25 ? 0 : v < .5 ? .35 : .92
    const water = bridgeRoadWater(moisture, u, .58, v >= .75)
    const width = .014 + .21 * water.rough ** 2
    return [water.rough, water.traceWet, water.diffuse, (width / (width + 1 - .92 ** 2)) ** 2]
  }
  if (probe === 8) return [+(u > .5), PROBE_IRR[0], PROBE_IRR[1], PROBE_IRR[2]]
  if (probe === 7) {
    // At these locations the aperture hits the centre of the opaque spine
    // (or misses completely). Only its own admitted angular lane can lose.
    const a = unpackLightVector(PROBE_VECTOR_WORDS[0]).energy, b = unpackLightVector(PROBE_VECTOR_WORDS[1]).energy
    const expected = v > .5 ? 0 : u < .25 ? a / (a + b) : u > .5 && u < .75 && maxK === SACR_MASTER_K ? b / (a + b) : 0
    return [expected, sacrFootAO(buf, u < .25 ? 7 : u < .5 ? 8 : u < .75 ? 9 : 11, 2.4), 0, 1]
  }
  const right = u > .5, top = v > .5, exterior = u < .25
  const p: Vec3 = probe === 1 ? [right ? 7 : 2, 0, 1.5] : probe === 2 ? [4, right ? 1e-6 : 0, 1.5] :
    probe === 3 ? [exterior ? 16 : 4, 0, SACR_CURB_Z - (right ? .75 : 4)] : [right ? 12 : probe === 5 ? 4 : 3, 0, 1.5]
  const ray: Vec3 = probe === 3 ? [0, exterior ? top ? 1 : 0 : right ? 2 : .375, 1] : [0, probe === 5 && top ? .08 : 1, 1]
  const o = evaluateSACR_Ref({ buf, p, ray, maxK, roughness: .45, wetness: probe === 1 ? 0 : 1, sky: probe === 5 ? [.54, .62, .79] : undefined,
    camWorldX: PROBE_WORLD_X, stratumOriginX: PROBE_ATLAS_ORIGIN, stratumWidthMeters: PROBE_ATLAS_WIDTH,
    viewWidthMeters: PROBE_WIDTH_METRES, lod: probe === 3 && top ? 2.75 : 0,
    sampleStratum: (a, b, l) => sampleStratumMips(mips, a, b, l) })
  if (probe === 1) return [o.outContactAO, o.opaqueAlpha, o.emissiveRadiance[0], 1]
  if (probe === 3 && o.portal) {
    const c = o.background
    return [c[0], c[1], Math.max(0, o.portal.v), o.portal.kind === 'soffit' ? 1 : o.portal.kind === 'interior' ? .5 : 0]
  }
  if (probe === 5) return [o.outReflRadiance[0] * .38, o.emissiveRadiance[0] / 32, o.undersideAlpha, o.skyTransmission]
  return [o.emissiveRadiance[0] / 32, o.emissiveRadiance[1] / 32, o.emissiveRadiance[2] / 32, o.opaqueAlpha]
}
