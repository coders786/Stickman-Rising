import { readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import { packedBytes, packedSettled } from '../src/gpu/bridge-packed-assets'
import { BAKED_ROOT, DECK_PACK, gradePack, packBridgePlanes, unpackBridgePlanes } from '../src/graphics/bridge/BridgeAssetCodec'
import { DECK_PACK_LAYOUT, DECK_PACK_TAG, gradePackLayout, gradePackTag } from '../src/game/stage/bridge-packed-material'
import assert from 'node:assert/strict'
import test from 'node:test'
import { BridgeWindowBake } from '../src/graphics/bridge/BridgeWindowBake'
import { decodeWindow, WINDOW_BYTES, type BakeReply, type BakeRequest } from '../src/graphics/bridge/BridgeBakeProtocol'
import { packBake, unpackBake } from '../src/graphics/bridge/BridgeLZ4'
import { BridgeStreaming } from '../src/graphics/bridge/BridgeStreaming'
import { ENV_H, LIGHT_W, chunkLightTile, enableLightTileArchive, packLightTile, unpackLightTile } from '../src/graphics/bridge/EnvBasis'
import { packLightVector, unpackLightVector, selectShadowLights, VECTOR_H, VECTOR_W } from '../src/graphics/bridge/LightVectorGrid'
import { BridgeAtmosphere } from '../src/graphics/bridge/BridgeAtmosphere'
import { makeRailSchedule, RailSchedule, RAIL_EVENT_COUNT } from '../src/graphics/bridge/RailSchedule'
import { SACRColumnBinner, SACR_MASTER_K, SACR_MOBILE_K, SACRUniformBuffer, SACR_PRIORITY, packCapsulePrim, type SACRBinItem } from '../src/graphics/sacr/SACRPacker'
import { BRIDGE_CHUNK_PX, BridgeRoute, entryBridgeSector, ROUTE_START, travelledMetres } from '../src/game/stage/route'
import { bakeBridgeDeckMask, bakeBridgePuddleRuns, bakeBridgeLutStrip, bridgeGrade, drainageOffset, unpackBridgeLut, buildBridgeDeckMask, type LookIndex } from '../src/game/stage/bridge-material'
import { chunkLightData } from '../src/graphics/bridge/NoirGeometry'
import { lockQualityPreset, featuresFor } from '../src/game/render/graphics'
import { BridgeFrame, MOBILE_FLASH_LIMIT } from '../src/game/render/bridge-frame'
import { FX } from '../src/game/fx/fx'

import { BRIDGE_PUDDLE_RUNS } from '../src/game/stage/bridge-puddle-runs'

test('Canvas clips are exactly the packed material puddle runs', () => {
  assert.deepEqual(BRIDGE_PUDDLE_RUNS, bakeBridgePuddleRuns())
})

test('opening grade sources distinguish pending bytes from a resolved fallback', async t => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  const fetches = new Map<string, (response: Response) => void>()
  t.mock.method(globalThis, 'fetch', (url: string) => new Promise<Response>(resolve => { fetches.set(url, resolve) }))
  const packed = 'qa-grade-ready.br', denied = 'qa-grade-denied.br'
  try {
    assert.equal(packedSettled(packed), false)
    assert.equal(packedSettled(denied), false)
    assert.equal(packedBytes(packed), null)
    assert.equal(fetches.size, 2)
    fetches.get(`${BAKED_ROOT}${packed}`)!(new Response(new Uint8Array([40, 80, 120, 255])))
    fetches.get(`${BAKED_ROOT}${denied}`)!(new Response(null, { status: 404 }))
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(packedSettled(packed), true)
    assert.deepEqual(packedBytes(packed), new Uint8Array([40, 80, 120, 255]))
    assert.equal(packedSettled(denied), true)
    assert.equal(packedBytes(denied), null)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('packed LZ4 archive round-trips arbitrary bytes and rejects malformed blocks', () => {
  for (const size of [0, 12, 31, 800, 65537, 1024 * 768]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (Math.imul(i % 401, 1973) ^ i % 23) & 255)
    const blob = packBake(data.buffer)
    assert.deepEqual(new Uint8Array(unpackBake(blob)), data)
  }
  const repetitive = new Uint8Array(8192).fill(5), packed = packBake(repetitive.buffer)
  assert.ok(packed.lz4 && packed.bytes.byteLength < 60)
  assert.throws(() => unpackBake({ ...packed, bytes: packed.bytes.slice(0, 3) }), RangeError)
  assert.throws(() => unpackBake(packed, 16), RangeError)
})

test('LZ4 long matches repeat only initialized data, including overlap and RLE', () => {
  for (const period of [1, 2, 3, 13, 51, 97, 512]) {
    const repeated = Uint8Array.from({ length: 14_111 }, (_, i) => (Math.imul(i % period, 0x45d9f3b) >>> 15) & 255)
    const packed = packBake(repeated.buffer)
    assert.ok(packed.lz4)
    assert.deepEqual(new Uint8Array(unpackBake(packed)), repeated)
  }
})

test('the raster lane prioritizes three slots and closes stale, evicted and retired bitmaps', () => {
  const workers = new Map<string, Lane>()
  class Lane {
    requests: BakeRequest[] = []
    onmessage?: (event: { data: BakeReply }) => void
    dead = false
    constructor(_url: URL, options: WorkerOptions) { workers.set(options.name!, this) }
    postMessage(request: BakeRequest) { this.requests.push(request) }
    terminate() { this.dead = true }
    plate(request: BakeRequest) {
      assert.equal(request.type, 'plate')
      let closes = 0
      const bitmap = { width: 4, height: 2, close: () => { closes++ } }
      this.onmessage?.({ data: { ...request, bakeMs: .1, bitmap: bitmap as ImageBitmap } })
      return { bitmap, closes: () => closes }
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: Lane })
  const stream = new BridgeStreaming(42)
  try {
    const wide = [3, 4, 5, 6, 7, 8]
    stream.planPlates(6, wide, true, false)
    assert.equal(stream.running, false, 'provisional submits do not create workers')
    stream.planPlates(6, wide, true)
    const raster = workers.get('bridge-art')!
    assert.equal(raster.requests.length, 1)
    stream.requestWindow(5400, 9000, 7000)
    assert.equal(workers.get('bridge-bake')?.requests[0]?.type, 'window', 'optics is not waiting for the raster reply')
    const pending = raster.requests.shift()!
    stream.planPlates(6, wide, false)
    assert.equal(raster.requests.length, 0, 'only one unfinished raster message')
    assert.equal(raster.plate(pending).closes(), 1, 'a previous-tier reply is closed')
    const live = [0, 1, 2].map(() => raster.plate(raster.requests.shift()!))
    assert.deepEqual(stream.indices(), [6, 7, 5])
    assert.equal(stream.plate(6, false), live[0].bitmap)
    assert.equal(stream.plate(6, true), null)
    assert.equal(stream.receipt().plateBytes, 3 * 4 * 2 * 4)
    assert.equal(raster.requests.length, 0)
    stream.planPlates(11, [10, 11, 12], false)
    assert.deepEqual(live.map(p => p.closes()), [1, 1, 1])
    const retired = raster.requests.shift()!, oldOptics = workers.get('bridge-bake')!
    // Even a same-seed Retry owns a different opening. Both old jobs are
    // deliberately unfinished; neither can delay the new workers.
    stream.reset(42)
    assert.ok(raster.dead && oldOptics.dead)
    assert.equal(stream.receipt().retiredJobs, 2)
    assert.equal(stream.receipt().plateBytes, 0)
    stream.requestWindow(1900, 2700, 2350)
    assert.notEqual(workers.get('bridge-bake'), oldOptics)
    stream.planPlates(2, [2], true, true, false)
    const next = workers.get('bridge-art')!
    assert.notEqual(next, raster)
    assert.equal(next.requests[0]?.seed, 42)
    assert.equal(raster.plate(retired).closes(), 1, 'even a queued reply from a terminated worker is closed')
    assert.equal(stream.receipt().plates, 0)
    const fresh = next.plate(next.requests.shift()!)
    assert.equal(next.requests.length, 0, 'opening plans do not queue an offscreen neighbour')
    stream.reset(43)
    assert.ok(!next.dead, 'idle workers can serve the next seed without reloading code')
    assert.equal(fresh.closes(), 1)
    stream.dispose()
    assert.ok(next.dead)
  } finally {
    stream.dispose()
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
    else Reflect.deleteProperty(globalThis, 'Worker')
  }
})

test('512×128 transport, 8 KiB vectors, explicit linear mips and coherent transferred portal words', () => {
  const route = new BridgeRoute(42), chunk = route.chunk(3), x = chunk.shelter!.terminal
  const tile = chunkLightTile(route, chunk), packed = packLightTile(tile)
  assert.deepEqual([LIGHT_W, ENV_H, tile.vectors.byteLength], [512, 128, VECTOR_H * VECTOR_W * 4])
  assert.equal(tile.vectors.length, 8192)
  assert.ok(tile.shadow.buffer === tile.irradiance.buffer && tile.irradiance.buffer === tile.vectors.buffer)
  assert.deepEqual(packed, packLightTile({ shadow: tile.shadow.slice(), irradiance: tile.irradiance.slice(), vectors: tile.vectors.slice() }))
  assert.deepEqual(unpackLightTile(packed), tile)
  assert.ok(packed.lz4 && packed.bytes.byteLength < packed.rawSize * .88)
  const worker = new BridgeWindowBake(route)
  const wire = worker.bake(7, x - 450, x + 420)
  const w = decodeWindow(wire)
  assert.equal(w.id, 7); assert.equal(w.seed, 42); assert.equal(wire.blob.rawSize, WINDOW_BYTES)
  assert.ok(w.origin < x && w.origin + w.width > x)
  assert.ok(w.architecture.some(Boolean))
  assert.deepEqual(w.light.map(m => [m.w, m.h]), [[1024, 128], [512, 64], [256, 32]])
  assert.equal(new Set([w.shadow.buffer, w.vectors.buffer, w.light[0].data.buffer, w.curb[3].data.buffer, w.architecture.buffer]).size, 1)
  const frame = new BridgeFrame()
  frame.streamWindow = frame.probeWindow = w
  frame.sacr.stratum.accept(w, frame.sacr.packet)
  assert.equal(frame.sacr.stratum.mips, w.curb)
  frame.retireRoute()
  assert.equal(frame.streamWindow, null)
  assert.equal(frame.probeWindow, null)
  assert.deepEqual(frame.sacr.stratum.mips, [], 'no view pins an old rolling payload')
  const raw = worker.bake(7, x - 450, x + 420, false)
  assert.deepEqual(decodeWindow(raw), w)
  const far = decodeWindow(worker.bake(8, x + 9930, x + 11200, false))
  assert.ok(far.origin > w.origin + w.width && far.curbOrigin > w.curbOrigin)
  assert.notDeepEqual(far.architecture, w.architecture)
})

test('an archived return restores the exact vector/mip/portal window', () => {
  const route = new BridgeRoute(42); enableLightTileArchive(route)
  const bake = new BridgeWindowBake(route)
  const before = bake.bake(1, 1010, 2410, false)
  // Exceed the eight hot tiles, but stay within the cold LZ4 archive.
  for (let i = 3; i < 22; i += 2) bake.bake(i, 1010 + i * BRIDGE_CHUNK_PX, 2410 + i * BRIDGE_CHUNK_PX, false)
  const after = bake.bake(23, 1010, 2410, false)
  assert.equal(after.origin, before.origin)
  assert.ok(Buffer.from(after.blob.bytes.buffer).equals(Buffer.from(before.blob.bytes.buffer)))
})

test('eight light candidates and six opaque enemies: rank attenuated energy, preserve contact, exclude arc and umbra', () => {
  const lights = [
    [9, 0], [6, .01], [1.7, .43], [1.1, .82], [.17, .75], [.09, 1], [.21, .08], [.12, .1],
  ].map(([energy, visibility], id) => ({ x: id & 1 ? -.61 : .61, y: .50, z: .61, energy, visibility, id }))
  assert.deepEqual(selectShadowLights(lights, 2).directionals.map(l => l.id), [3, 2])
  assert.deepEqual(selectShadowLights(lights, 1).directionals.map(l => l.id), [3])
  const lone = selectShadowLights([lights[3], lights[1]], 2)
  assert.deepEqual(lone.directionals.map(l => l.id), [3])
  assert.deepEqual(selectShadowLights(lights, 2, 0), { contact: 1, directionals: [] })
  for (const z of [.61, -.61]) {
    const d = unpackLightVector(packLightVector(.61, -.54, z, .74))
    assert.ok(Math.abs(d.energy - .74) < .035 && Math.sign(d.z) === Math.sign(z))
    assert.ok((d.x * .61 - d.y * .54 + d.z * z) / Math.hypot(.61, .54, z) > .995)
  }
  for (const K of [SACR_MOBILE_K, SACR_MASTER_K] as const) {
    const p = new SACRUniformBuffer(), items: SACRBinItem[] = []
    for (let i = 0; i < 8; i++) {
      const emissive = i === 6, solid = i === 7, caster = !emissive && !solid
      items.push({ index: i, minX: 3.8, maxX: 4.2, distance: i, zObj: 3.4, priority: i === 0 ? SACR_PRIORITY.player : SACR_PRIORITY.enemy, caster, representative: true })
      packCapsulePrim(p, i, 4, .4, 4, 1.5, .2, 3.4, .16, 41, 47, 60, emissive ? 10 : 0, solid ? 63 : i)
    }
    new SACRColumnBinner().write(p, items, 10, K, items.length, true)
    const n = SACRUniformBuffer.OFF_SHADOWBINS + 32 * 2
    const opaque = Array.from({ length: 8 }, (_, i) => p.u32[n + (i >> 2)] >>> ((i & 3) * 8) & 255).filter(Boolean)
    assert.deepEqual(opaque, K === 4 ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6])
  }
})

test('seed at 0m drives entry, fixtures, moon, drainage, and all four train types on an irregular bounded timetable', () => {
  assert.equal(travelledMetres(ROUTE_START), 0)
  const variants = new Set(), moons = new Set(), sockets = new Set(), drainage = new Set()
  for (let seed = 40; seed < 48; seed++) {
    const route = new BridgeRoute(seed), c = route.at(ROUTE_START)
    variants.add(c.visualBand); sockets.add(chunkLightData(c).points[0].x); drainage.add(drainageOffset(seed))
    assert.equal(c.visualBand, entryBridgeSector(seed))
    for (let i = 0; i < 24; i++) assert.equal(route.chunk(i).right - route.chunk(i).left, BRIDGE_CHUNK_PX)
    const a = new BridgeAtmosphere()
    a.update(null, { x: ROUTE_START, y: -166, zoom: 1 }, 1180, 660, seed, c.visualBand, { time: 0, drift: 0, cover: .43, haze: .3, flash: 0 }, 'master')
    moons.add([a.moonX, ...a.sun].join(':'))
    const s = makeRailSchedule(seed)
    assert.deepEqual(s, makeRailSchedule(seed))
    assert.equal(s.events.length, RAIL_EVENT_COUNT)
    assert.deepEqual([...new Set(s.events.map(e => e.kind))].sort(), [0, 1, 2, 3])
    s.events.forEach((e, i) => {
      assert.ok(e.speed >= 950 && e.speed <= 1600)
      const next = (s.events[i + 1]?.at ?? s.period) - e.at
      assert.ok(next >= .34 && next <= 35)
      if (next < 1) assert.equal(e.dir, -s.events[i + 1].dir)
      if (e.kind === 1) assert.ok(e.cars >= 5 && e.cars <= 9)
    })
    const r = new RailSchedule(seed), first = r.offset
    assert.equal(r.wake(first + .399, 0), 0)
    assert.ok(Math.abs(r.wake(first + .52, 0)) > .17)
    assert.equal(r.wake(first + 1.85, 0), 0)
  }
  assert.equal(variants.size, 3); assert.equal(drainage.size, 8); assert.equal(moons.size, 8); assert.ok(sockets.size >= 4)
  assert.notDeepEqual(makeRailSchedule(43), makeRailSchedule(42))
})

test('mostly matte drainage, neutral black floor, truthful Master lock and a short blocked hit impulse', () => {
  const classes = [0, 0, 0], d = bakeBridgeDeckMask()
  for (let i = 2; i < d.length; i += 4) classes[d[i] < 52 ? 0 : d[i] < 166 ? 1 : 2]++
  const ratios = classes.map(n => n * 4 / d.length)
  assert.ok(ratios[0] >= .52 && ratios[0] <= .67 && ratios[1] >= .10 && ratios[1] <= .23 && ratios[2] >= .18 && ratios[2] <= .32, `matte/damp/gloss: ${ratios}`)
  for (let i = 0; i < 4; i++) for (const lum of [0, .025, .05]) assert.ok(Math.max(...bridgeGrade(i as LookIndex, lum, lum, lum)) < .08)
  const s = lockQualityPreset({ quality: 'low', adaptiveQuality: true }, 'ultra')
  assert.deepEqual(s, { quality: 'ultra', adaptiveQuality: false }); assert.ok(featuresFor(s.quality).dprCap >= 1.25)
  const f = new BridgeFrame(), route = new BridgeRoute(42), fx = new FX()
  const start = () => { f.begin({ x: 0, y: -70, zoom: 1 }, 640, 420, 0, 0, .3, 1, 0, 0, 0, 0); f.impulseLimit = MOBILE_FLASH_LIMIT }
  fx.impact(0, -110, 0, true, '#ff9755', '#ffd7ae')
  start(); fx.bridgeEmitters(f); assert.equal(f.impulseCount, 1)
  fx.update(.065, .065); start(); fx.bridgeEmitters(f); assert.ok(f.impulseGain > .10 && f.impulseGain < .65)
  f.blockers.push({ left: -9, right: 9, top: -76, bottom: -68, kind: 'catwalk' })
  assert.equal(f.transmitted(0, 0, 0, -110), false)
  fx.update(.074, .074); start(); fx.bridgeEmitters(f); assert.equal(f.impulseCount, 0)
  for (let i = 0; i < 6; i++) fx.impact(20 * i, -90, 0, true, '#ff9755', '#ffd7ae')
  start(); f.impulseLimit = 4; fx.bridgeEmitters(f); assert.equal(f.impulseCount, 3)
  start(); fx.bridgeEmitters(f); assert.equal(f.impulseCount, 1)
  fx.dispose(); assert.equal(route.seed, 42)
})


test('release grade volumes and reduced deck payload restore the original linear samples', () => {
  const file = (key: string) => readFileSync(`public${BAKED_ROOT}${key}`)
  for (const n of [16, 32] as const) {
    const bytes = file(gradePack(n)), table = unpackBridgePlanes(brotliDecompressSync(bytes), gradePackLayout(n), gradePackTag(n))
    const authored = Buffer.concat(([0, 1, 2, 3] as LookIndex[]).map(i => unpackBridgeLut(bakeBridgeLutStrip(n, i), n)))
    assert.deepEqual(Buffer.from(table), authored)
    assert.ok(bytes.length < (n === 16 ? 15_000 : 65_000), 'grade wire budget')
  }
  const bytes = file(DECK_PACK), pool = unpackBridgePlanes(brotliDecompressSync(bytes), DECK_PACK_LAYOUT, DECK_PACK_TAG)
  const packedRebuild = buildBridgeDeckMask(pool)
  let result = packedRebuild.next()
  while (!result.done) result = packedRebuild.next()
  const original = bakeBridgeDeckMask()
  for (let i = 0; i < pool.length; i++) assert.equal(pool[i], original[4 * i + 2])
  assert.deepEqual(result.value, original)
  assert.ok(bytes.length < 36_000, 'deck wire budget')
})

test('plane conditioning is reversible for every byte, including row resets and auxiliary channels', () => {
  const layout = [[41, 11, 4], [9, 23, 1]] as const
  const data = Uint8Array.from({ length: 41 * 11 * 4 + 9 * 23 }, (_, i) => (i * 71 ^ i >>> 6) & 255)
  const pack = packBridgePlanes(data, layout, 'TEST')
  assert.deepEqual(unpackBridgePlanes(pack, layout, 'TEST'), data)
  assert.throws(() => unpackBridgePlanes(pack, layout, 'OLD!'), /version/)
  assert.throws(() => unpackBridgePlanes(pack.subarray(1), layout, 'TEST'), /length/)
  assert.throws(() => packBridgePlanes(data.subarray(1), layout, 'TEST'), /layout/)
})
