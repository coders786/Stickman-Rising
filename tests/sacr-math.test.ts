import test from 'node:test'
import assert from 'node:assert/strict'
import { arcCenterlineDistance, evaluateSACR_Ref, sacrCoordinates, traceSACRPortal, worldToSACRX,
  SACR_CURB_Z, type SACRTrace } from '../src/graphics/sacr/SACRMath'
import { packArchProfile, packCapsulePrim, packFootAO, SACRColumnBinner, SACR_PRIORITY,
  SACRUniformBuffer, SACR_MASTER_K, SACR_MOBILE_K, type SACRBinItem } from '../src/graphics/sacr/SACRPacker'
import { probeExpected, probeMips, probePacket, PROBE_SOFFIT } from '../src/debug/sacr-probes'
import { bridgeRoadWater } from '../src/game/stage/bridge-road-water'

const close = (a: number, b: number, eps = 1e-7) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} ±${eps}`)
function defaults(buf = new SACRUniformBuffer()): SACRTrace {
  return { buf, p: [4, 0, 1.5], ray: [0, 1, 1], maxK: SACR_MASTER_K, roughness: .45, wetness: 1,
    camWorldX: 0, stratumOriginX: -10, stratumWidthMeters: 64, viewWidthMeters: 24 }
}

test('270° arc R=2: center and +1e-6 do not normalize zero or become a filled disk', () => {
  for (const dx of [0, 1e-6]) {
    const d = arcCenterlineDistance(dx, 0, 2, 1, 0, 3 * Math.PI / 4)
    assert.ok(Number.isFinite(d) && d >= 1.99)
    const o = evaluateSACR_Ref({ ...defaults(probePacket(2, SACR_MASTER_K)), p: [4, dx, 1.5] })
    assert.equal(o.opaqueAlpha, 0); assert.deepEqual(o.emissiveRadiance, [0, 0, 0]); assert.deepEqual(o.outReflRadiance, [0, 0, 0])
  }
  close(arcCenterlineDistance(0, -2, 2, 1, 0, 3 * Math.PI / 4), 0)
  assert.ok(arcCenterlineDistance(-2, 0, 2, 1, 0, 3 * Math.PI / 4) > 1.5, 'open wedge is not a ring fill')
})

test('2 m deep, 3 m high actual portal test: 1.5 m entry hits warm interior or soffit depending on slope', () => {
  const b = new SACRUniformBuffer()
  packArchProfile(b, 0, 12, 17, 2, 3, PROBE_SOFFIT)
  const params = { ...defaults(b), p: [4, 0, SACR_CURB_Z - 4] as const, ray: [0, .375, 1] as const }
  const interior = traceSACRPortal(params)
  assert.equal(interior.kind, 'interior')
  close(interior.u, 14 / 64); close(interior.v, .504 + .492 * (.75))
  const soffit = traceSACRPortal({ ...params, p: [4, 0, SACR_CURB_Z - .75], ray: [0, 2, 1] })
  assert.equal(soffit.kind, 'soffit'); assert.equal(soffit.v, -1)
  for (let i = 0; i < 3; i++) close(soffit.rgba![i], PROBE_SOFFIT[i], 1 / 255)
  assert.equal(traceSACRPortal({ ...params, p: [4, 0, SACR_CURB_Z - 4], ray: [0, .8, 1] }).kind, 'exterior')
  assert.equal(traceSACRPortal({ ...params, p: [1.5, 0, SACR_CURB_Z - 4], ray: [0, .375, 1] }).kind, 'exterior')
  assert.equal(traceSACRPortal({ ...params, p: [6.25, 0, SACR_CURB_Z - 4], ray: [.125, .375, 1] }).kind, 'soffit', 'side-wall clipping')
})

test('dry deck multiplies diffuse by grounded boot AO (<.6), not by slash, nor by a 2m roof', () => {
  const b = probePacket(1, SACR_MASTER_K), p: SACRTrace = { ...defaults(b), wetness: 0, sky: [1, 1, 1],
    sampleStratum: () => { throw Error('dry receivers must not sample the atlas') } }
  const boot = evaluateSACR_Ref({ ...p, p: [2, 0, 1.5] }), slash = evaluateSACR_Ref({ ...p, p: [7, 0, 1.5] })
  assert.ok(boot.outContactAO < .6); assert.equal(slash.outContactAO, 1)
  assert.equal(boot.portal, null); assert.equal(slash.portal, null)
  assert.deepEqual(boot.outReflRadiance, [0, 0, 0]); assert.deepEqual(slash.outReflRadiance, [0, 0, 0])
  packFootAO(b, 1, 7, 1.5, 1, 2)
  assert.equal(evaluateSACR_Ref({ ...p, p: [7, 0, 1.5] }).outContactAO, 1)
})

test('dual e=10 arcs at roughness .45 add >1.8× radiance without changing the same-ID opaque union', () => {
  for (const maxK of [SACR_MOBILE_K, SACR_MASTER_K] as const) {
    const p = { ...defaults(probePacket(4, maxK)), maxK }
    const one = evaluateSACR_Ref({ ...p, p: [3, 0, 1.5] }), two = evaluateSACR_Ref({ ...p, p: [12, 0, 1.5] })
    assert.ok(one.outReflRadiance[0] > .4)
    for (let k = 0; k < 3; k++) {
      assert.ok(two.outReflRadiance[k] > 1.8 * one.outReflRadiance[k])
      close(two.emissiveRadiance[k], 2 * one.emissiveRadiance[k])
    }
    assert.ok(one.opaqueAlpha > 0 && one.opaqueAlpha < 1)
    close(one.opaqueAlpha, two.opaqueAlpha)
    // Swap the second capsule's ID to prove the probe isn't alpha=1 or 0
    // and that it sees the distinction between union and compositing.
    const b = p.buf, q = 160 + 4 * 1 + 3
    b.u32[q] = ((b.u32[q] & 0x03ffffff) | 8 << 26) >>> 0
    assert.ok(evaluateSACR_Ref({ ...p, p: [12, 0, 1.5] }).opaqueAlpha > one.opaqueAlpha + .01)
  }
})

test('rebase 0 m → 1250 m: camera view, packed P-relative capsule, curb sample C and FootAO are invariant (atlas origin → 1240 m)', () => {
  const run = (move: number) => {
    const m = 48, v = sacrCoordinates(move * m, (move + 24) * m, (move + 12) * m)
    const x = worldToSACRX((move + 4) * m, move * m), b = new SACRUniformBuffer()
    const items: SACRBinItem[] = [{ index: 0, minX: x - 1, maxX: x + 1, priority: SACR_PRIORITY.player, zObj: 1.5, distance: 8 }]
    packCapsulePrim(b, 0, x, 0, x, .5, .12, 1.5, .16, 52, 96, 124, 0, 1)
    packFootAO(b, 0, x + .1, 1.5, .28, .0125)
    packArchProfile(b, 0, 12, 17, 2, 3, PROBE_SOFFIT)
    new SACRColumnBinner().write(b, items, v.viewWidthMeters, SACR_MASTER_K)
    const s = evaluateSACR_Ref({ ...defaults(b), p: [x, 0, 1.5], ray: [0, .375, 1], camWorldX: v.camWorldX,
      stratumOriginX: move - 10, sampleStratum: (u, v) => [u, v, u * v] })
    return { q: Array.from(b.u32), c: v.pOffsetMeters, s }
  }
  const a = run(0), b = run(1250)
  assert.deepEqual(a.q, b.q); assert.equal(a.c, b.c)
  assert.ok(a.s.portal && b.s.portal)
  assert.equal(a.s.portal.kind, 'interior'); close(a.s.portal.u, b.s.portal.u); close(a.s.portal.v, b.s.portal.v)
  assert.deepEqual(a.s.stratumC, b.s.stratumC); assert.deepEqual(a.s.outReflRadiance, b.s.outReflRadiance)
  assert.equal(a.s.outContactAO, b.s.outContactAO); assert.ok(a.s.outContactAO < .6)
})

test('all four browser fixture expectations are nontrivial, oriented and in their target ranges', () => {
  const mips = probeMips()
  const sample = (n: number, u: number, v: number) => probeExpected(probePacket(n, 4), mips, 4, n, u, v)
  assert.ok(sample(1, .26, .3)[0] < .6); assert.equal(sample(1, .75, .3)[0], 1)
  assert.deepEqual(sample(2, .26, .3), [0, 0, 0, 0]); assert.deepEqual(sample(2, .75, .3), [0, 0, 0, 0])
  assert.ok(sample(3, .1, .8)[1] > .4 && sample(3, .1, .3)[1] < .2, 'no Y flip')
  assert.ok(sample(3, .26, .3)[2] > .5); assert.equal(sample(3, .26, .3)[3], .5)
  assert.equal(sample(3, .75, .3)[3], 1)
  assert.ok(sample(4, .75, .3)[0] > 1.8 * sample(4, .26, .3)[0])
  assert.equal(sample(4, .75, .3)[3], sample(4, .26, .3)[3])
})


test('Ultra finite-source reference retains contact and widens only the distant penumbra', () => {
  const b = probePacket(9, SACR_MASTER_K), mips = probeMips()
  const sample = (u: number, v: number) => probeExpected(b, mips, SACR_MASTER_K, 9, u, v)
  assert.deepEqual(sample(.50, .2).slice(0, 2), [1, 1])
  assert.ok(sample(.50, .8)[1] > .99, 'still a dark central shadow')
  assert.deepEqual(sample(.76, .2).slice(0, 2), [0, 0])
  const soft = sample(.76, .8)
  assert.equal(soft[0], 0)
  assert.ok(soft[1] > .15 && soft[1] < .35 && soft[2] > 4 * sample(.76, .2)[2])
  const edge = .5 + .20 / 1.12
  close(sample(edge, .8)[0], .5); close(sample(edge, .8)[1], .5)
})

test('Ultra material reference separates a damp film from water without wetting the eave', () => {
  const b = probePacket(10, SACR_MASTER_K), mips = probeMips()
  const sample = (u: number, v: number) => probeExpected(b, mips, SACR_MASTER_K, 10, u, v)
  const dry = sample(.98, .15), damp = sample(.02, .62), pool = sample(.98, .62), underRoof = sample(.98, .85)
  assert.equal(dry[1], 0); assert.equal(damp[1], 0, 'no depth trace for a thin film outside basins')
  assert.ok(damp[0] < dry[0] && damp[0] > 5 * pool[0] && damp[3] > 10 * pool[3], 'rough film retains a wider off-angle lobe')
  assert.ok(pool[1] > .90 && pool[2] < damp[2] && damp[2] < dry[2])
  assert.deepEqual(underRoof.slice(0, 3), [.85, 0, 1])
  // The driver probe samples this mid-ramp pixel, not only the dry/pool
  // endpoints. Keep its CPU oracle synchronized with Canvas water physics.
  const midU = 7.5 / 16, midV = 8.5 / 16, mid = sample(midU, midV)
  const reference = bridgeRoadWater(.92, midU, .58, false)
  close(mid[0], reference.rough); close(mid[1], reference.traceWet); close(mid[2], reference.diffuse)
})

test('Stratum A adds sky to the exterior reflection only; it never lights an arch backwall or soffit', () => {
  const params = { ...defaults(probePacket(3, SACR_MASTER_K)), camWorldX: 1250, stratumOriginX: 1240,
    ray: [0, .375, 1] as const, sampleStratum: () => [.2, .3, .4] as const }
  for (const x of [4, 16]) {
    const coords = { ...params, p: [x, 0, SACR_CURB_Z - 4] as const }
    const off = evaluateSACR_Ref(coords), on = evaluateSACR_Ref({ ...coords, sky: [.03, .07, .1] })
    assert.deepEqual(on.background, off.background)
    assert.ok(off.outReflRadiance[0] > 0)
    if (x === 4) assert.deepEqual(on.outReflRadiance, off.outReflRadiance)
    else for (let k = 0; k < 3; k++) assert.ok(on.outReflRadiance[k] > off.outReflRadiance[k])
  }
})
