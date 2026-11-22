import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import { unpackBridgePlanes } from '../src/graphics/bridge/BridgeAssetCodec'
import { BridgeAtmosphere, lunarProjection, StratumAClock } from '../src/graphics/bridge/BridgeAtmosphere'
import { bakeHorizonStrips, bakeLunarSurface, bakeStormAtlas, CLOUD_ATLAS_H, CLOUD_H, CLOUD_W, decodeSkyBasis, HORIZON_H, HORIZON_W,
  CLOUD_PHASE_ROW, CLOUD_PHASE_W, MOON_EDGE, SKY_BASIS_BYTES, SKY_BASIS_URL, SKY_PACK_LAYOUT, SKY_PACK_TAG } from '../src/graphics/bridge/SkyBasis'
import { CanvasSkyOptics, CITY_DISTANCE, LUNAR_TAPS, cityAirFill, cityHazeDepth, lunarPhaseEnergy, lunarRadiance, lunarWeight,
  mistDepth, opticalTransmission, sampleSkyPlane } from '../src/graphics/bridge/SkyOptics'
import { BridgeEnvAtlas, catwalkSlab, ENV_BOTTOM, ENV_H, ENV_TOP, ENV_W, LIGHT_H, LIGHT_W, sampleChunkLight, bakeChunkLight, shadowRow } from '../src/graphics/bridge/EnvBasis'
import { BridgeRoute } from '../src/game/stage/route'
import { SHELTER_KIT } from '../src/game/stage/run-layout'
import { LIGHT_SAMPLES, MOON_SLOPE, chunkLightData, roadFixtureVisibility, softVisibility, rayVisible, type Blocker } from '../src/graphics/bridge/NoirGeometry'
import { cityHorizonAccess, skylineHeight } from '../src/graphics/bridge/CityGeometry'
import { MOON_CAST_ENERGY, packLightVector, reconstructCastDirections, unpackLightVector } from '../src/graphics/bridge/LightVectorGrid'
import { decodeRGB9E5, encodeRGB9E5 } from '../src/graphics/sacr/SACRAtlas'
import { castKey } from '../src/game/render/bridge-casts'
import { Player } from '../src/game/entities/player'
import { BridgeSACRFrame } from '../src/graphics/sacr/BridgeSACRFrame'
import { evaluateSACR_Ref, SACR_ACTOR_Z, SACR_NEAR_Z, sacrFootAO, worldToSACRX, type SACRTrace } from '../src/graphics/sacr/SACRMath'
import { packCapsulePrim, packOpaqueBar, readColumnSlot, SACRColumnBinner, SACR_MASTER_K, SACR_MOBILE_K, SACR_PRIORITY, SACR_SOLID_ID, SACRUniformBuffer,
  unpackCapsuleMeta, unpackHalf2x16, type SACRBinItem, type Vec3 } from '../src/graphics/sacr/SACRPacker'

const baked = readFileSync(new URL(`../public${SKY_BASIS_URL}`, import.meta.url))
const authored = unpackBridgePlanes(brotliDecompressSync(baked), SKY_PACK_LAYOUT, SKY_PACK_TAG)
const basis = decodeSkyBasis(authored.buffer)
const close = (actual: number, expected: number, error = 1e-6) => assert.ok(Math.abs(actual - expected) < error, `${actual} ≠ ${expected}`)

test('lunar relief, two optical slabs, a wrapped evolution tile, and three city horizons reproduce the shipped linear bytes', () => {
  assert.equal(authored.length, SKY_BASIS_BYTES)
  assert.ok(baked.length < 260_000, 'atmospheric wire budget')
  assert.throws(() => decodeSkyBasis(new ArrayBuffer(12)), /sky basis bytes/)
  assert.deepEqual(basis.lunar, bakeLunarSurface())
  assert.deepEqual(basis.cloud, bakeStormAtlas())
  assert.deepEqual(basis.horizon, bakeHorizonStrips())
  assert.equal(basis.lunar.length, MOON_EDGE ** 2 * 4)
  assert.equal(basis.cloud.length, CLOUD_W * CLOUD_ATLAS_H * 4)
  const c = CLOUD_PHASE_ROW * CLOUD_W * 4
  assert.deepEqual(basis.cloud.slice(c, c + 4), basis.cloud.slice(c + CLOUD_PHASE_W * 4, c + CLOUD_PHASE_W * 4 + 4))
  assert.deepEqual(basis.cloud.slice(c + 4, c + 8), basis.cloud.slice(c + (CLOUD_PHASE_W + 1) * 4, c + (CLOUD_PHASE_W + 2) * 4))
  const moon = (x: number, y: number, lane: number) => basis.lunar[(y * MOON_EDGE + x) * 4 + lane]
  assert.ok(moon(40, 90, 2) + 30 < moon(82, 85, 2), 'maria are darker than highland')
  assert.ok(basis.lunar.some((v, i) => i % 4 === 0 && v < 83), 'lunar relief contains steep slopes')
  assert.ok(basis.lunar.some((v, i) => i % 4 === 3 && v > 66), 'ejecta present independently')
  for (let s = 0; s < 3; s++) {
    const y0 = (s * HORIZON_H * HORIZON_W + 97) * 4
    const y1 = y0 + (HORIZON_H - 1) * HORIZON_W * 4
    assert.ok(basis.horizon[y0 + 2] > basis.horizon[y1 + 2])
  }
  const strip = HORIZON_H * HORIZON_W * 4
  assert.ok(basis.horizon.subarray(strip, 2 * strip).some((v, i) => i % 4 === 0 && v > basis.horizon[i]), 'Market horizon carries warmer city bounce')
  assert.ok(basis.city[0].some((v, i) => i % 4 === 1 && v === 255), 'at least one exposed skyline edge')
  assert.ok(basis.city[1].some((v, i) => i % 4 === 3 && v > 64), 'lit overpass/windows have independent local bounce')
})

const weather = { time: 9.2, drift: 0, cover: .25, haze: .46, flash: 0 }
const camera = { x: 832, y: -135, zoom: 1.14 }

test('batched Canvas sky and mist use the exact reference samples, including flash and wrapped slabs', () => {
  const opt = new CanvasSkyOptics(), ref = new CanvasSkyOptics(), a = new BridgeAtmosphere()
  const rgb = new Float32Array(3), target = new Float32Array(3)
  for (const d of [basis, null]) for (const [w, h] of [[1180, 660], [400, 844]]) {
    a.update(d, { ...camera, x: 13_381 }, w, h, 43, 1.38, { ...weather, drift: 79.2, flash: .73 })
    const coord = (i: number) => (i + .5) / 77
    opt.project(a, 77, coord)
    for (let y = 0; y < 31; y++) {
      const v = 1 - (y + .5) / 31, row = opt.skyRow(a, v, true)
      for (let x = 0; x < 77; x++) {
        opt.skyColumn(a, x, row, rgb, .11); ref.sky(a, coord(x), v, target, .11)
        assert.deepEqual(rgb, target)
      }
    }
    opt.project(a, 77, coord, true)
    for (let y = 0; y < 31; y++) {
      const v = (a.air[3] + (1 - (y + .5) / 31) * .52) / a.air[0], profile = opt.projectedMistRow(a, v)
      for (let x = 0; x < 77; x++) assert.equal(opt.mistColumn(a, x, v, profile), ref.mist(a, coord(x), v))
    }
  }
})

test('a round moon holds its bearing and solar phase across route travel, weather, tier and aspect', () => {
  const w = 1180, h = 660
  const from = lunarProjection(w, h, 42)
  assert.ok(from.x < w / 2 && from.y > from.radius)
  const a = new BridgeAtmosphere()
  a.update(basis, camera, w, h, 42, 0, weather, 'master')
  const phase = Array.from(a.sun), energy = a.phaseEnergy, scale = a.stormDeck[1] / w * (a.skyHeight / a.stormDeck[3])
  assert.ok(energy > .48 && energy < .9); close(Math.hypot(...phase), 1)
  a.update(basis, { ...camera, y: -80, zoom: 1.55 }, 400, 844, 42, 2, { ...weather, time: 90, cover: .92 }, 'mobile')
  assert.deepEqual(Array.from(a.sun), phase); close(a.phaseEnergy, energy)
  close(a.moon[2] * 400, a.moon[3] * a.skyHeight, 1e-5)
  close(a.stormDeck[1] / 400 * (a.skyHeight / a.stormDeck[3]), scale)
  assert.ok(a.moonY > a.radius && a.moonX > a.radius)
  close(lunarPhaseEnergy(1), 1); close(lunarPhaseEnergy(-1), 0)
  assert.ok(lunarRadiance(.99, 0, a.sun, 0, 0, .7, .1) < .004, 'dark limb has no white ring')
  assert.ok(lunarRadiance(-.55, 0, a.sun, 0, 0, .7, .1) > .25)
})

test('four seeded lunar variants vary phase, color and size without changing their world bearing', () => {
  const a = new BridgeAtmosphere(), ref: ReturnType<BridgeAtmosphere['receipt']>[] = []
  for (let i = 40; i < 44; i++) {
    a.update(basis, camera, 880, 540, i, 0, { ...weather, cover: .1 })
    ref.push(a.receipt())
    const before = a.receipt(), maps = [a.highDeck[0], a.stormDeck[0], a.mistDeck[0]]
    a.update(basis, { ...camera, x: camera.x + 50 }, 880, 540, i, 0, { ...weather, cover: .1 })
    assert.deepEqual(a.receipt().moonCss, before.moonCss)
    const delta = [a.highDeck[0], a.stormDeck[0], a.mistDeck[0]].map((v, j) => (v - maps[j] + 1) % 1)
    assert.deepEqual(delta.slice(0, 2), [0, 0]); assert.ok(delta[2] > 0)
    close(a.key[0], a.phaseEnergy * a.moonTransmission)
  }
  assert.equal(new Set(ref.map(v => v.moonVariant)).size, 4)
  assert.equal(new Set(ref.map(v => v.moonDiameterCss)).size, 4)
  assert.ok(ref[0].phaseEnergy > .85 && ref[3].phaseEnergy < .25)
  assert.ok(ref[1].moonTint[0] > ref[1].moonTint[2])
})

test('bilinear slab boundaries never mix decks; advection uses integrated wind and independent deck speeds', () => {
  const a = new BridgeAtmosphere(), color = new Float32Array(4)
  const tex = new Uint8Array(3 * 2 * 2 * 4)
  tex.set([10, 20, 30, 40], 4); tex.fill(240, tex.length / 2)
  sampleSkyPlane(tex, 3, 2, 0, .5, 0, color); close(color[2], 30 / 255)
  sampleSkyPlane(tex, 3, 2, 0, .5, 1, color); close(color[2], 0)
  sampleSkyPlane(tex, 3, 2, 1, -1.5, -2, color); close(color[2], 240 / 255)
  tex[2] = 50; tex[10] = 110
  for (const edge of [-12, 0, 71]) {
    sampleSkyPlane(tex, 3, 2, 0, edge, 0, color); close(color[2], 80 / 255)
    sampleSkyPlane(tex, 3, 2, 0, edge - 1 / 12, 0, color); close(color[2], 95 / 255)
    sampleSkyPlane(tex, 3, 2, 0, edge + 1 / 12, 0, color); close(color[2], 65 / 255)
  }
  const update = (time: number, drift: number) => a.update(basis, camera, 880, 540, 42, 0, { ...weather, time, drift })
  const maps = () => [a.highDeck, a.stormDeck, a.mistDeck].map(m => Array.from(m))
  update(1, 0); const start = maps(); update(3400, 0); assert.deepEqual(maps(), start, 'elapsed time is not instantaneous velocity')
  update(3400, 7); const speeds = maps().map((m, i) => (start[i][0] - m[0] + 1) % 1)
  assert.ok(speeds[0] > 0 && speeds[0] < speeds[1] && speeds[1] < speeds[2]); close(a.lightning(a.epicenter), 0)
  a.update(null, camera, 880, 540, 42, 0, { ...weather, flash: .7 })
  close(a.lightning(a.epicenter), .7); close(a.lightning(a.epicenter + 1 / a.stormFalloff), 0)
  new CanvasSkyOptics().sky(a, .4, .6, color, .022)
  assert.ok(color[0] > 0 && color[2] > color[0], 'the missing-asset sky paints sensible radiance')
})

test('a cloud hides just its pixels, while area-integrated lunar flux drives light on the bridge', () => {
  const a = new BridgeAtmosphere(), m = new CanvasSkyOptics(), shade = new Float32Array(3)
  const cloud = new Uint8Array(basis.cloud.length), atlas = { ...basis, cloud }
  const setup = () => a.update(atlas, camera, 880, 540, 42, 0, { ...weather, cover: .99 })
  const px = (dx: number, dy: number) => {
    m.sky(a, a.moon[0] + dx * a.moon[2], a.moon[1] + dy * a.moon[3], shade, .025)
    return shade[2]
  }
  setup()
  const upper = px(-.43, .35), lower = px(-.43, -.35), energy = a.key[0]
  assert.ok(upper > .24 && lower > .24)
  const row = Math.ceil((a.stormDeck[2] + a.stormDeck[3] * a.moon[1]) * (CLOUD_H - 1))
  for (let y = row; y < CLOUD_H; y++) for (let x = 0; x < CLOUD_W; x++) cloud[((y + CLOUD_H) * CLOUD_W + x) * 4] = 255
  setup()
  assert.ok(px(-.43, .35) < upper * .22); close(px(-.43, -.35), lower)
  assert.ok(a.key[0] > energy * .20 && a.key[0] < energy * .82, 'partial occultation gradually dims casts')
  const weightAt = ([x, y]: readonly [number, number]) => lunarWeight(x, y, a.sun)
  const mean = LUNAR_TAPS.reduce((sum, tap) => sum + weightAt(tap) * a.transmission(a.moon[0] + tap[0]*a.moon[2], a.moon[1] + tap[1]*a.moon[3]), 0) /
    LUNAR_TAPS.reduce((sum, tap) => sum + weightAt(tap), 0)
  close(a.key[0], mean * a.phaseEnergy)
  assert.ok(Math.abs(a.moonTransmission - a.centerTransmission) > .03, 'a single center sample cannot drive a penumbra')
  for (let i = CLOUD_H * CLOUD_W * 4; i < 2 * CLOUD_H * CLOUD_W * 4; i += 4) cloud[i] = 255
  setup(); assert.ok(a.key[0] < energy * .004, 'optically thick overcast extinguishes the key')
})

test('camera travel cannot move the optical sky; only the seeded clock varies its baked cloud mass', () => {
  const a = new BridgeAtmosphere(), o = new CanvasSkyOptics(), rgb = new Float32Array(3)
  const render = (cam: typeof camera, seed = 42, time = weather.time) => {
    a.update(basis, cam, 940, 620, seed, .8, { ...weather, time })
    const pixels: number[] = []
    for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) {
      o.sky(a, (x + .5) / 20, (y + .5) / 10, rgb, .022); pixels.push(...rgb)
    }
    return { pixels, moon: [...a.moon], weather: [...a.stormDeck, ...a.highDeck], phase: [...a.cloudPhase], mid: [...a.cityMid], mist: [...a.mistDeck] }
  }
  const ref = render(camera), move = render({ x: 985_143, y: -325, zoom: 1.63 })
  assert.deepEqual(move.pixels, ref.pixels)
  assert.deepEqual(move.moon, ref.moon); assert.deepEqual(move.weather, ref.weather)
  assert.notDeepEqual(move.mid, ref.mid); assert.notDeepEqual(move.mist, ref.mist)
  const next = render(camera, 42, weather.time + 1 / 60), later = render(camera, 42, weather.time + 47)
  const diff = (frame: typeof ref) => Math.max(...frame.pixels.map((v,i) => Math.abs(v - ref.pixels[i])))
  assert.deepEqual(later.weather, ref.weather, 'evolution changes optical density, not the spatial phase or camera offset')
  assert.deepEqual(later.moon, ref.moon)
  assert.ok(diff(next) < .001 && diff(later) > .003 && diff(later) < .12, 'gradual and bounded')
  assert.notDeepEqual(render(camera, 51).phase, ref.phase)
  assert.deepEqual(render(camera), ref)
})

test('height fog separates skyline depths and the advecting mist is off above and below its volume', () => {
  const near = cityHazeDepth(.7, CITY_DISTANCE[1], .2), far = cityHazeDepth(.7, CITY_DISTANCE[0], .2)
  assert.ok(opticalTransmission(far) < opticalTransmission(near))
  assert.ok(cityHazeDepth(.7, CITY_DISTANCE[0], .62) < far)
  assert.ok(cityHazeDepth(.12, CITY_DISTANCE[0], .2) < far)
  const horizon = (band: 0 | 1) => opticalTransmission(cityHazeDepth(.3, CITY_DISTANCE[band], 0))
  assert.ok(horizon(1) > .61 && horizon(0) < .55 && horizon(1) - horizon(0) > .16, 'a clear separation at the low skyline')
  assert.ok(cityAirFill(0) > cityAirFill(.5) && cityAirFill(0) < .80, 'airlight must not wash the city to white')
  assert.equal(mistDepth(.8, -.05, .9), 0); assert.equal(mistDepth(.8, .53, .9), 0)
  assert.ok(mistDepth(.8, .065, .9) > mistDepth(.8, .32, .9) * 3)
  assert.ok(mistDepth(.8, .065, .9) > mistDepth(.8, .065, .12) * 3)
})

test('Mobile holds radiance and moon inputs on alternate submits; storm, quiet, seed and resize invalidate', () => {
  const mobile = new StratumAClock('mobile'), master = new StratumAClock('master')
  const flashes = [0, 0, 0, .78, .44, .44, 0, 0]
  const sample = (clock: StratumAClock) => flashes.map(f => clock.advance(f, 42, 400, 844))
  assert.deepEqual(sample(mobile), [true, false, true, true, true, false, true, false])
  assert.deepEqual(sample(master), flashes.map(() => true))
  assert.equal(mobile.updates, 5); assert.equal(master.updates, 8)
  assert.equal(mobile.advance(0, 43, 400, 844), true)
  assert.equal(mobile.advance(0, 43, 399, 844), true)
  assert.equal(mobile.advance(0, 43, 399, 844), true)
  assert.equal(mobile.advance(0, 43, 399, 844, true), true)
  const a = new BridgeAtmosphere(), cam = { x: 600, y: -130, zoom: 1 }
  a.update(basis, cam, 400, 844, 42, 0, weather, 'mobile')
  const before = a.receipt(), beforeCity = a.cityMid[0], sweep = a.key[2]
  a.update(basis, { ...cam, x: 604, y: -132 }, 400, 844, 42, 0, { ...weather, drift: 1, haze: .51 }, 'mobile', true)
  assert.equal(a.key[0], before.moonVis); assert.equal(a.moonTransmission, before.moonTransmission)
  close(a.air[1], weather.haze)
  assert.deepEqual([a.moonX, a.moonY], before.moonCss)
  assert.notEqual(a.cityMid[0], beforeCity, 'architecture keeps moving on held frames')
  assert.notEqual(a.key[2], sweep, 'slow diffuse sweep is independent of the radiance refresh')
})

test('seven area samples show progressive geometric penumbra without tint leakage', () => {
  const slab: Blocker = { left: -20, right: 20, top: -42, bottom: -31, kind: 'catwalk' }
  const sample = [-1, -2/3, -1/3, 0, 1/3, 2/3, 1]
  const point = { ...chunkLightData(new BridgeRoute(42).chunk(0)).points[0], x: 0, y: -108, physicalRadius: 8 }
  const row = new Uint8Array(256), widths: number[] = []
  for (const height of [-30, -7, 24]) {
    shadowRow(row, -127.5, 1, height, [slab], sample, point)
    let partial = 0
    for (let i = 0; i < row.length; i++) {
      const count = sample.filter((_, j) => !(row[i] & (1 << j))).length
      close(count / LIGHT_SAMPLES, softVisibility(i - 127.5, height, point.x, point.y, point.physicalRadius, [slab]))
      partial += +(count > 0 && count < LIGHT_SAMPLES)
    }
    widths.push(partial)
  }
  assert.ok(widths[0] < widths[1] && widths[1] < widths[2], `contact→falloff: ${widths}`)
  assert.ok(!rayVisible(0, 5, 0, -108, [slab]) && rayVisible(48, -19, 30, -108, [slab]))
})

test('a finite raised slab masks only the real road depth; the brush and baked lens agree', () => {
  const slab: Blocker = { left: -50, right: 50, top: -115, bottom: -97, kind: 'catwalk', depth: [3.1, 4.6] }
  const p = { ...chunkLightData(new BridgeRoute(42).chunk(0)).points[0], x: -3, y: -151, z: 4.1, physicalRadius: 8 }
  const shifts = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1], bits = new Uint8Array(200)
  for (const z of [1.45, 3.5, 5.35]) {
    shadowRow(bits, -99.75, 1, 7, [slab], shifts, p, z)
    for (let i = 0; i < bits.length; i++) {
      const visible = shifts.filter((_, j) => !(bits[i] & (1 << j))).length / LIGHT_SAMPLES
      close(visible, roadFixtureVisibility(-99.75 + i, 7, z, p, p.z, [slab]))
    }
  }
  const sun = shifts.map(s => MOON_SLOPE + s * .071)
  // Compare the same XY address on the lit edge and in the slab's umbra.
  // The depthless strip used to block every road depth at this X.
  shadowRow(bits, 64.25, 1, 0, [slab], sun, undefined, 1.45)
  assert.equal(bits[0], 0)
  shadowRow(bits, 64.25, 1, 0, [slab], sun, undefined, 3.2)
  assert.equal(bits[0], 127)
  const steps = new Set<number>()
  for (let z = 2; z < 2.7; z += .025) {
    shadowRow(bits, 64.25, 1, 0, [slab], sun, undefined, z)
    steps.add(bits[0])
  }
  assert.ok(steps.size > 3, 'finite depth has a penumbra, not a single discontinuity')
})

test('road strip and world atlas share exposed roof, shutter cavity and a true catwalk shadow', () => {
  const route = new BridgeRoute(42), chunks = [...route.between(0, 18000)]
  const service = chunks.find(c => c.shelter?.kind === 'service')!, s = service.shelter!
  const under = sampleChunkLight(route, s.terminal, 0, true), roof = sampleChunkLight(route, s.terminal, SHELTER_KIT.service.ridgeY - 5)
  assert.equal(under.moon, 0); assert.ok(under.sky >= .076 && under.sky <= .083 && under.r > under.g && under.g > under.b)
  assert.equal(roof.moon, 1); assert.ok(roof.flash >= .94)
  assert.ok(under.r >= .09 && under.ao < .88 && under.flash === 0)
  const c = chunks.find(c => c.role === 'catwalk')!, slab = catwalkSlab(c)!, x = (slab.left + slab.right) / 2 + 90
  assert.equal(route.shelterAt(x), null)
  assert.ok(sampleChunkLight(route, x, 0, true).moon < .16)
  assert.ok(sampleChunkLight(route, slab.left + 70, slab.top - 10).moon > .68)
  assert.ok(sampleChunkLight(route, slab.left + 960, 0, true).moon > .80, 'an exposed lane beyond the catwalk and pavilion keeps its lunar key')
  const t = bakeChunkLight(c)
  assert.equal(t.shadow.length, LIGHT_W * ENV_H * 4); assert.equal(t.irradiance.length, LIGHT_W * ENV_H)
  assert.ok(t.irradiance.some(word => word > 0))
})

test('streamed RGBA8 and RGB9_E5 stay registered through pan and a far rebase', () => {
  const route = new BridgeRoute(42), a = new BridgeEnvAtlas()
  a.update(route, 120, 1470)
  const old = a.origin, version = a.version
  a.update(route, 163, 1557); assert.equal(a.version, version)
  const check = (sampleX: number, sampleY: number) => {
    const step = a.width / ENV_W, dy = (ENV_BOTTOM - ENV_TOP) / LIGHT_H
    const x = Math.floor((sampleX - a.origin) / step), y = Math.floor((sampleY - ENV_TOP) / dy)
    const wx = a.origin + (x + .5) * step, wy = ENV_TOP + (y + .5) * dy
    const i = (y * ENV_W + x) * 4, e = sampleChunkLight(route, wx, wy)
    assert.deepEqual([...a.data.subarray(i, i + 4)], [e.moon, e.sky, e.ao, e.scatter].map(v => Math.round(v * 255)))
  }
  check(575, -24); check(902, -8)
  a.update(route, 2630, 4138)
  assert.ok(a.origin > old && a.origin < old + 4096)
  check(2793, -63); check(3872, 42)
  a.update(route, 601600, 602900)
  check(602171, -118)
  a.update(route, 120, 1470); check(575, -24)
})

test('skyline and angular key are aligned to the repeatable authored tower geometry', () => {
  const horizon = Array.from({ length: 100 }, (_, i) => cityHorizonAccess(i * 310))
  assert.ok(Math.min(...horizon) <= .83 && Math.max(...horizon) >= .99)
  for (let x = 0; x < 1; x += 1 / 128) {
    assert.equal(skylineHeight(1, x), skylineHeight(1, x + 7))
    assert.ok(skylineHeight(0, x) >= 0 && skylineHeight(1, x) <= 280)
  }
  const card = basis.city[1]
  assert.ok(card.some((v, i) => i % 4 === 0 && v === 0 && card[i + 2] > 40))
})

test('RGB9_E5 packing agrees with the logarithmic reference at exponent carry boundaries', () => {
  const reference = (r: number, g: number, b: number) => {
    if (r < 2 ** -25) return 0
    let exp = Math.max(0, Math.floor(Math.log2(r)) + 16), step = 2 ** (exp - 24)
    if (Math.floor(r / step + .5) === 512) { exp++; step *= 2 }
    return (Math.floor(r / step + .5) | Math.floor(g / step + .5) << 9 | Math.floor(b / step + .5) << 18 | exp << 27) >>> 0
  }
  for (let n = -30; n < 17; n++) for (const k of [.75, .99, 511.49 / 512, 511.5 / 512, 1 - 2 ** -28, 1, 1.01, 1.3]) {
    const r = Math.min(65408, 2 ** n * k), g = r * .56, b = r * .13
    assert.equal(encodeRGB9E5(r, g, b), reference(r, g, b))
  }
  assert.deepEqual(decodeRGB9E5(encodeRGB9E5(0, 0, 0)), [0, 0, 0])
})

test('raised support uses the same primitive pool, geometric support record and a separate boot receiver', () => {
  const route = new BridgeRoute(42), c = [...route.between(0, 18000)].find(c => c.role === 'catwalk')!, deck = c.platform!
  const x = (deck.left + deck.right) * .5, p = new Player()
  p.reset(x); p.y = p.floorY = deck.y
  // A solved planted pose, not Player.reset()'s zeroed joint cache.
  const y = (deck.y - p.hipY) / p.scale
  Object.assign(p.geom.ankleL, { x: -8, y: y - 1 }); Object.assign(p.geom.toeL, { x: -5, y })
  Object.assign(p.geom.ankleR, { x: 9, y: y - 1 }); Object.assign(p.geom.toeR, { x: 12, y })
  const f = new BridgeSACRFrame(), left = x - 440, right = x + 440
  f.begin(left, right, x, SACR_MASTER_K, route); f.architecture(route, left, right); f.actor(p, 0, SACR_PRIORITY.player); f.seal()
  assert.deepEqual([f.casters, f.elevatedCasters, f.undersides, f.feet], [1, 1, 1, 2])
  const k = SACRUniformBuffer.OFF_FOOTAO, [fx, z, radius, lift] = f.packet.f32.subarray(k, k + 4)
  assert.ok(radius > 0 && lift < 0)
  assert.equal(sacrFootAO(f.packet, fx, z), 1)
  assert.ok(sacrFootAO(f.packet, fx, z, -deck.y / 48) < .6)
  const supports = Array.from({ length: f.supports }, (_, i) => f.packet.f32.subarray(SACRUniformBuffer.OFF_SUPPORTS + i * 4, SACRUniformBuffer.OFF_SUPPORTS + (i + 1) * 4))
  const [lo, hi, height] = supports.find(([a, b]) => a <= fx && b > fx)!
  close(lo, (deck.left - left) / 48, .001); close(hi, (deck.right - left) / 48, .001); close(height, -deck.y / 48, .001)
})

test('both tiers retain sole links; emission displaces cloth only when K has a spare direct slot', () => {
  const route = new BridgeRoute(42), x = 350, left = x - 200, right = x + 200
  const p = new Player(); p.reset(x)
  Object.assign(p.geom.toeL, { x: -14, y: 50 }); Object.assign(p.geom.toeR, { x: 13, y: 50 })
  Object.assign(p.geom.kneeL, { x: -7, y: 20 }); Object.assign(p.geom.kneeR, { x: 5, y: 25 })
  Object.assign(p.geom.chest, { x: 0, y: -33 }); Object.assign(p.geom.headC, { x: 0, y: -58 })
  const f = new BridgeSACRFrame(), scarf = [{ x: 0, y: -39 }, { x: -17, y: -36 }, { x: -28, y: -35 }]
  for (const k of [SACR_MOBILE_K, SACR_MASTER_K] as const) for (const y of [40, 60]) {
    p.geom.toeL.y = y
    f.begin(left, right, x, k, route, null)
    f.actor(p, 0, SACR_PRIORITY.player, undefined, scarf)
    f.impulse(x - 10, -27, x + 10, -19, 3.2, 0x62bffa, 7)
    f.seal()
    const col = 40, words = f.packet.u32, slots = Array.from({ length: k }, (_, j) => j)
    const direct = slots.map(j => (words[SACRUniformBuffer.OFF_SHADOWBINS + col * 2 + (j >>> 2)] >>> ((j & 3) * 8)) & 255).filter(Boolean)
    const endX = direct.map(id => unpackHalf2x16(words[SACRUniformBuffer.OFF_PRIMPOOL + (id - 1) * 4 + 1])[0])
    assert.equal(direct.length, k === SACR_MOBILE_K ? 3 : 6)
    for (const toe of [p.geom.toeL, p.geom.toeR]) {
      const at = worldToSACRX(x + toe.x * p.scale, left)
      assert.ok(endX.some(v => Math.abs(v - at) < .0025))
    }
    assert.equal(f.scarves, 2)
    const directIds = slots.map(j => readColumnSlot(f.packet, col, j))
    assert.equal(directIds.includes(f.primitives), k === SACR_MOBILE_K,
      k === SACR_MOBILE_K
        ? 'Mobile spends its spare slot on the live emitter rather than non-casting scarf cloth'
        : 'Master K6 keeps its six connected caster segments ahead of the optional emitter')
  }
})

test('the Canvas cast fades through rank ties without aiming between two emitters', () => {
  assert.ok(MOON_SLOPE > .8)
  const practical = { x: -.43, y: .50, z: .75, energy: .25, visibility: 1, id: -1 }
  const sky = castKey(-.72, 1, 1, [practical]), cloud = castKey(-.72, .20, 1, [practical])
  close(sky.slope, -.72); close(cloud.slope, .86)
  assert.ok(sky.gain > cloud.gain && cloud.gain > .3)
  for (const e of [-.001, 0, .001]) {
    const r = castKey(-.72, practical.energy / MOON_CAST_ENERGY + e, 1, [practical])
    assert.ok(r.gain < .002 && r.slope === (e < 0 ? .86 : -.72))
  }
  close(castKey(-.72, 1, 0, [practical]).slope, .86)
  close(castKey(-.72, 1, 1, [practical], -.19, 1).slope, -.19)
})

test('vector reconstruction conserves energy through a lane swap and never interpolates opposing lights', () => {
  const a = packLightVector(-.52, .67, .59, .82), b = packLightVector(.63, .56, .54, .35)
  const a2 = packLightVector(-.60, .64, .58, .29), b2 = packLightVector(.57, .58, .57, .65)
  const mid = reconstructCastDirections([a, b], [b2, a2], .5).filter(x => x.energy > 0)
  assert.equal(mid.length, 2)
  close(mid[0].energy, (unpackLightVector(a).energy + unpackLightVector(a2).energy) * .5)
  close(mid[1].energy, (unpackLightVector(b).energy + unpackLightVector(b2).energy) * .5)
  assert.ok(mid[0].x < -.4 && mid[1].x > .45)
  const split = reconstructCastDirections([a, 0], [b2, 0], .4).filter(x => x.energy > 0)
  assert.equal(split.length, 2)
  close(split[0].x, unpackLightVector(a).x); close(split[1].x, unpackLightVector(b2).x)
  close(split[0].energy, unpackLightVector(a).energy * .6); close(split[1].energy, unpackLightVector(b2).energy * .4)
  assert.deepEqual(reconstructCastDirections([a, b], [b2, a2], 0).slice(0, 2), [unpackLightVector(a), unpackLightVector(b)])
})

test('opaque ID-63 bar blocks only intersecting rays and preserves foreground emitters, in both K tiers', () => {
  const z = SACR_NEAR_Z + .13, p: Vec3 = [5, 0, 1.5], ray: Vec3 = [0, 1, 1]
  for (const maxK of [SACR_MOBILE_K, SACR_MASTER_K] as const) {
    const buf = new SACRUniformBuffer(), items: SACRBinItem[] = [{ index: 0, minX: 3, maxX: 8, zObj: z, priority: SACR_PRIORITY.architecture, distance: 0 }]
    packOpaqueBar(buf, 0, 3, 8, 1.7, .16, z, 4.8, 0x344655)
    const impulse = (id: number, x: number, z: number) => {
      const h = z - p[2]
      items.push({ index: id, minX: x - .12, maxX: x + .12, zObj: z, priority: SACR_PRIORITY.emissive, distance: id })
      packCapsulePrim(buf, id, x, h, x, h, .12, z, .12, 255, 161, 251, 4, 2)
    }
    impulse(1, 5, 1.75); impulse(2, 5, 4); impulse(3, 13, 4)
    new SACRColumnBinner().write(buf, items, 24, maxK)
    const trace = (at: Vec3, dir = ray, wetness = 1, sky: Vec3 = [.7, .8, .9]) => {
      const s: SACRTrace = { buf, p: at, ray: dir, maxK, viewWidthMeters: 24, camWorldX: 0,
        stratumOriginX: 0, stratumWidthMeters: 64, roughness: .45, wetness, sky }
      return evaluateSACR_Ref(s)
    }
    const blocked = trace(p), outside = trace([13, 0, 1.5]), miss = trace(p, [0, .12, 1])
    assert.equal(blocked.undersideAlpha, 1); assert.equal(blocked.skyTransmission, 0)
    assert.deepEqual(blocked.outReflRadiance, trace(p, ray, 1, [0, 0, 0]).outReflRadiance)
    assert.ok(blocked.emissiveRadiance[0] > 1, 'near light still visible')
    close(outside.emissiveRadiance[0], blocked.emissiveRadiance[0])
    assert.equal(outside.skyTransmission, 1); assert.equal(miss.skyTransmission, 1)
    const dry = trace(p, ray, 0); assert.equal(dry.undersideAlpha, 0); assert.deepEqual(dry.outReflRadiance, [0, 0, 0])
  }
})

test('crowd admission cannot evict a visible authored underside from a K4 or K6 bin', () => {
  const route = new BridgeRoute(42), chunk = [...route.between(0, 18000)].find(c => c.role === 'catwalk')!
  const slab = catwalkSlab(chunk)!, x = (slab.left + slab.right) / 2, left = x - 300, right = x + 300
  for (const maxK of [SACR_MOBILE_K, SACR_MASTER_K] as const) {
    const f = new BridgeSACRFrame()
    f.begin(left, right, x, maxK, route); f.architecture(route, left, right)
    for (let i = 0; i < 64; i++) f.capsule(x - 12, -70, x + 20, -70, 4, 4, SACR_ACTOR_Z,
      0xffffff, 0, 0, SACR_PRIORITY.player, 0)
    f.seal()
    const col = Math.floor(worldToSACRX(x, left) * 80 / f.viewWidthMeters)
    const id = readColumnSlot(f.packet, col, 0)
    const meta = unpackCapsuleMeta(f.packet.u32[SACRUniformBuffer.OFF_PRIMPOOL + (id - 1) * 4 + 3])
    assert.equal(f.primitives, 64); assert.equal(f.undersides, 1)
    assert.equal(meta.charID, SACR_SOLID_ID); assert.equal(meta.emis, 0)
    assert.notEqual(readColumnSlot(f.packet, col, maxK - 1), 0)
  }
})
