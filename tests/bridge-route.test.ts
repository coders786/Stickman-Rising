import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { BridgeRoute, ROUTE_START, BIOME_BLEND, SECTOR_LENGTH, biomeAt, biomeMix, travelledMetres } from '../src/game/stage/route'
import { RouteScenery, ROUTE_CACHE_SIZE } from '../src/game/stage/route-art'
import { RouteWeather, MAX_ROUTE_RAIN } from '../src/game/world/route-weather'
import { EncounterDirector, MAX_ROAD_ENEMIES, type LiveBody } from '../src/game/world/encounters'
import { DEFAULT_CAPS, gameLedger } from '../src/game/render/ledger'
import { chunkPlateTop, paintChunk, PLATE_BOTTOM, visiblePlateIndices } from '../src/game/stage/bridge-plate-paint'
import { paintNoirShelter } from '../src/game/stage/noir-shelter'
import { finishCanvasChunk } from '../src/game/stage/bridge-canvas-light'
import { ENV_H, ENV_TOP, LIGHT_H, LIGHT_W } from '../src/graphics/bridge/EnvBasis'
import { SHELTER_KIT } from '../src/game/stage/run-layout'
import { ROAD } from '../src/game/stage/road-section'
import { paintBridgeDeck } from '../src/game/stage/bridge-art'

const viewAt = (x: number, vx = 350) => ({ x, facing: 1 as const, vx, left: x - 550, right: x + 630 })

test('seeded route is continuous, repeatable, and keeps gate approaches and eaves legal', () => {
  for (let seed = 0; seed < 256; seed++) {
    const route = new BridgeRoute(seed), another = new BridgeRoute(seed)
    const chunks = [...route.between(0, 22_000)]
    let service = 0
    for (const c of chunks) {
      assert.ok(c.right - c.left >= 960 && c.right - c.left <= 1440)
      assert.equal(c.left, c.index === 0 ? 0 : chunks[c.index - 1].right)
      assert.equal(route.at(c.right).index, c.index + 1)
      if (c.platform) assert.ok(c.platform.left > c.left && c.platform.right < c.right && c.platform.y < 0)
      if (!c.shelter) continue
      const s = c.shelter
      assert.equal(route.shelterAt(s.left), s)
      assert.equal(route.shelterAt(s.right), null)
      assert.equal(route.stopAtCover(s.left - 150, s.right + 150, 12), s.left - 12)
      assert.equal(route.stopAtCover(s.right + 150, s.left - 150, 12), s.right + 12)
      assert.equal(route.stopAtCover(s.right + 150, s.left - 150), s.right)
      if (s.kind === 'service') { assert.ok(c.index - service === 3 || c.index - service === 4); service = c.index }
    }
    another.at(22_000)
    assert.deepEqual(chunks, [...another.between(0, 22_000)])
    for (let gate = 0; gate < 4; gate++) {
      const x = route.gateX(gate), nominal = ROUTE_START + SECTOR_LENGTH * (gate + 1)
      assert.ok(x >= nominal && x < nominal + 1000)
      assert.ok([...route.between(x - 440, x + 80)].every(c => !c.shelter || c.shelter.right <= x - 440 || c.shelter.left >= x + 80))
    }
  }
  assert.equal(travelledMetres(ROUTE_START + 10_000), 1000)
  assert.equal(biomeAt(ROUTE_START + 10_000), 'Sky Garden District')
  assert.equal(biomeMix(ROUTE_START + SECTOR_LENGTH - BIOME_BLEND / 2), 0)
  assert.equal(biomeMix(ROUTE_START + SECTOR_LENGTH), .5)
  assert.equal(biomeMix(ROUTE_START + SECTOR_LENGTH + BIOME_BLEND / 2), 1)
})

test('arrivals are near legal lanes, supported gunners are placed on real catwalks, boss reserves a slot', () => {
  let gunners = 0
  for (let seed = 0; seed < 32; seed++) {
    const route = new BridgeRoute(seed), d = new EncounterDirector(route)
    const start = d.update(0, viewAt(ROUTE_START, 0), [])
    assert.ok(start && start.kind !== 'boss' && Math.abs(start.x - ROUTE_START) <= 365)
    assert.equal(d.update(1, viewAt(route.chunk(0).shelter!.terminal), []), null)
    for (let x = 820; x < d.gate.x - 430; x += 117) {
      const bodies: LiveBody[] = [{ x: x - 60, y: 0, dead: false, spawning: false, kind: 'grunt' }]
      const s = d.update(1, viewAt(x), bodies)
      if (!s) continue
      assert.ok(!route.shelterAt(s.x, 16) && route.stopAtCover(x, s.x) === s.x)
      assert.ok(Math.abs(x - s.x) <= 960 && Math.abs(x - s.x) >= 108)
      if (s.kind === 'gunner') { gunners++; assert.equal(s.platform, route.platformAt(s.x)) }
    }
    const x = d.gate.x
    const bodies: LiveBody[] = Array.from({ length: MAX_ROAD_ENEMIES - 1 }, (_, i) => ({ x: x - 650 + i * 40, y: 0, dead: false, spawning: false, kind: 'grunt' }))
    const boss = d.update(1, viewAt(x - 400), bodies)
    assert.equal(d.limit, x)
    assert.equal(boss?.kind, 'boss')
    assert.equal(d.update(30, viewAt(x - 100), bodies), null)
    assert.equal(d.openGate(1), false)
    assert.equal(d.openGate(boss!.gate!), true)
    assert.equal(d.limit, Infinity)
    assert.equal(d.previousGate?.state, 'open')
    assert.ok(d.gate.x > x + 4000)
  }
  assert.ok(gunners > 5, `only ${gunners} marksmen`)
})

test('cropped near-world plates preserve the full coverage of each authored section and district', () => {
  const seen = new Set<string>()
  for (const seed of [42, 43, 44, 161]) {
    const route = new BridgeRoute(seed)
    for (const c of route.between(0, 36_000)) {
      const key = `${c.role}/${c.visualBand}`
      if (seen.has(key)) continue
      seen.add(key)
      const w = c.right - c.left, top = chunkPlateTop(c), h = PLATE_BOTTOM - top
      let stamp
      if (c.shelter) {
        const kind = c.shelter.kind, kit = SHELTER_KIT[kind], y = kit.ridgeY - 12
        const sprite = createCanvas(kit.width, ROAD.front - y)
        paintNoirShelter(sprite.getContext('2d') as unknown as CanvasRenderingContext2D, kind, y)
        stamp = { sprite: sprite as unknown as CanvasImageSource, y }
      }
      const paint = (t: number, height: number) => {
        const g = createCanvas(w, height).getContext('2d') as unknown as CanvasRenderingContext2D
        g.translate(0, -t); paintChunk(g, c, stamp)
        return Buffer.from(g.getImageData(0, 0, w, height).data)
      }
      const skipped = (top - ENV_TOP) * w * 4, full = paint(ENV_TOP, PLATE_BOTTOM - ENV_TOP)
      assert.ok(skipped >= 30 * w * 4 && full.subarray(0, skipped).every(v => v === 0), key)
      const cropped = paint(top, h)
      let max = 0
      for (let i = 0, j = skipped; i < cropped.length; i += 4, j += 4) {
        const alpha = cropped[i + 3]
        if (alpha !== full[j + 3]) assert.fail(`${key}: alpha changed at ${i / 4}`)
        for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(cropped[i + k] - full[j + k]) * alpha / 255)
      }
      // Canvas can round gradient stops differently at a different origin.
      assert.ok(max <= 6, `${key}: premultiplied colour delta ${max}`)
    }
  }
  assert.ok(seen.size >= 10)
})

test('the compact plate plan culls above and below even while the same X range stays visible', () => {
  const route = new BridgeRoute(42), out = [999], view = { left: 1100, right: 1700, top: -390, bottom: -297 }
  assert.equal(visiblePlateIndices(route, view, out), out)
  assert.deepEqual(out, [0], 'concourse roof may be visible without the shorter neighbouring structure')
  view.top = 91; view.bottom = 260
  assert.deepEqual(visiblePlateIndices(route, view, out), [])
  view.top = -200; view.bottom = 60
  assert.deepEqual(visiblePlateIndices(route, view, out), [0, 1])
})

test('Canvas semi-bake keeps the original authored light rows and separate road band', () => {
  const shadow = new Uint8Array(ENV_H * LIGHT_W * 4), irradiance = new Uint32Array(ENV_H * LIGHT_W)
  function fill(row: number, value: number) {
    for (let x = 0; x < LIGHT_W; x++) shadow.set([value, value, 255, 0], (row * LIGHT_W + x) * 4)
  }
  const pixels = (top: number, h: number) => {
    const rgba = new Uint8ClampedArray(4 * h)
    for (let i = 0; i < rgba.length; i += 4) rgba.set([185, 185, 185, 255], i)
    rgba[3] = 0
    finishCanvasChunk(rgba, 1, h, top, { shadow, irradiance })
    assert.deepEqual([...rgba.slice(0, 4)], [185, 185, 185, 0], 'transparent pixels stay untouched')
    return [...rgba].filter((_, i) => i % 4 === 0).slice(1)
  }
  for (let row = 0; row < LIGHT_H; row++) fill(row, row < 24 ? 255 : 0)
  const cover = pixels(-244, 15)
  assert.equal(new Set(cover).size, 2, 'a baked occlusion edge is not filtered into the next row')
  assert.ok(cover[6] > cover[7], 'the step follows the authored section row')
  for (let row = 0; row < LIGHT_H; row++) fill(row, 0)
  for (let row = LIGHT_H; row < ENV_H; row++) fill(row, 255)
  const road = pixels(ROAD.rear - 3, 7)
  assert.ok(road[0] === road[1] && road[1] < road[2] && road.slice(2).every(v => v === road[2]))
})

test('streamed roof/road backing stays bounded on wide views and releases old seeds', () => {
  const native = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => createCanvas(1, 1) } })
  const route = new BridgeRoute(42), scenery = new RouteScenery(route)
  const ctx = createCanvas(1500, 560).getContext('2d') as unknown as CanvasRenderingContext2D
  try {
    for (const x of [240, 1200, 4_800, 7_800, 10_510, 22_100, 4_800]) {
      ctx.setTransform(.38, 0, 0, .8, 750 - x * .38, 295)
      scenery.draw(ctx, { left: x - 1974, right: x + 1974, top: -369, bottom: 332 }, x)
      assert.ok(scenery.stats().indices.length <= ROUTE_CACHE_SIZE)
      assert.ok(gameLedger.list().filter(e => e.tag === 'route-chunk').length <= ROUTE_CACHE_SIZE)
      assert.equal(gameLedger.list().filter(e => e.tag === 'route-work').length, 0)
    }
    assert.ok(scenery.stats().evicted > 2)
    scenery.reset(new BridgeRoute(43))
    assert.deepEqual(scenery.stats().indices, [])
    assert.ok(gameLedger.list().every(e => e.tag !== 'route-chunk'))
  } finally {
    scenery.dispose()
    if (native) Object.defineProperty(globalThis, 'document', native)
    else Reflect.deleteProperty(globalThis, 'document')
  }
  assert.deepEqual(gameLedger.list(), [])
})

test('the negative approach keeps its authored deck separate from chunk zero', () => {
  const native = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => createCanvas(1, 1) } })
  const scenery = new RouteScenery(new BridgeRoute(42))
  const g = createCanvas(180, 120).getContext('2d') as unknown as CanvasRenderingContext2D
  g.translate(90, 60)
  try {
    scenery.draw(g, { left: -90, right: 90, top: -60, bottom: 60 }, 0, true)
    const ref = createCanvas(180, 120).getContext('2d') as unknown as CanvasRenderingContext2D
    ref.translate(90, 60)
    ref.beginPath(); ref.rect(-98, ENV_TOP, 98, PLATE_BOTTOM - ENV_TOP); ref.clip()
    paintBridgeDeck(ref, -98, 0)
    assert.deepEqual(g.getImageData(2, 16, 86, 86).data, ref.getImageData(2, 16, 86, 86).data)
    assert.equal(gameLedger.list().filter(e => e.tag === 'route-chunk').length, 1)
  } finally {
    scenery.dispose()
    if (native) Object.defineProperty(globalThis, 'document', native)
    else Reflect.deleteProperty(globalThis, 'document')
  }
  assert.deepEqual(gameLedger.list(), [])
})

test('a denied streamed slot paints the same lane directly, without forcing a backing claim', () => {
  const native = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => createCanvas(1, 1) } })
  const scenery = new RouteScenery(new BridgeRoute(42)), c = scenery.route.chunk(1), x = (c.left + c.right) / 2
  const view = { left: x - 150, right: x + 150, top: -175, bottom: 125 }
  const ctx = createCanvas(300, 300).getContext('2d')
  ctx.translate(150 - x, 175)
  const paint = () => scenery.draw(ctx as unknown as CanvasRenderingContext2D, view, x)
  try {
    paint()
    assert.equal(scenery.stats().offscreen, false, 'Node uses the HTML canvas fallback')
    const lane = ctx.getImageData(160, 175, 1, 1).data
    assert.equal(lane[3], 255)
    scenery.reset(new BridgeRoute(43)); scenery.reset(new BridgeRoute(42))
    for (let i = 0; i < DEFAULT_CAPS.maxSurfaces; i++) gameLedger.acquire(`qa-filled:${i}`, 2, 2, 'fixture', true)
    ctx.clearRect(view.left, view.top, 300, 300)
    paint()
    const direct = ctx.getImageData(160, 175, 1, 1).data
    assert.equal(direct[3], 255)
    assert.ok(direct.every((v, i) => Math.abs(v - lane[i]) <= 2), 'cache and direct lane tones diverge')
    assert.deepEqual(scenery.stats().indices, [])
    assert.equal(gameLedger.stats().overSurfaces, 0)
  } finally {
    scenery.dispose()
    for (let i = 0; i < DEFAULT_CAPS.maxSurfaces; i++) gameLedger.release(`qa-filled:${i}`)
    if (native) Object.defineProperty(globalThis, 'document', native)
    else Reflect.deleteProperty(globalThis, 'document')
  }
  assert.equal(gameLedger.stats().bytes, 0)
})

test('both rain planes clip rolled eaves; fixed clock and dry rules survive distant districts', () => {
  const route = new BridgeRoute(42), weather = new RouteWeather(route), copy = new RouteWeather(route)
  weather.advance(720, 1)
  for (let i = 0; i < 720; i++) copy.advance(1, 1)
  assert.deepEqual(weather.clock.sample, copy.clock.sample)
  const roofs = [...route.between(0, 14_000)].flatMap(c => c.shelter ?? [])
  for (const roof of roofs) {
    assert.equal(weather.wetnessAt(roof.left), 0)
    assert.equal(weather.wetnessAt(roof.right - .01), 0)
    assert.ok(weather.wetnessAt(roof.right) > 0)
    assert.ok(weather.rainAudioAt(roof.terminal) < weather.rainAudioAt(roof.right + 30) * .3)
    const ctx = createCanvas(1000, 530).getContext('2d'), x = roof.terminal, roll = .09
    ctx.translate(500, 330); ctx.rotate(roll); ctx.translate(-x, 0)
    const view = { left: x - 550, right: x + 550, top: -405, bottom: 205 }
    for (const near of [false, true]) weather.draw(ctx as unknown as CanvasRenderingContext2D, view, x, 'ultra', near, false)
    assert.ok(weather.work.streaks > 0 && weather.work.streaks <= MAX_ROUTE_RAIN)
    assert.ok(weather.work.splashes <= 12 && weather.work.runoff <= 4)
    const pixels = ctx.getImageData(0, 0, 1000, 530).data
    let open = 0, sheltered = 0
    for (let row = 0; row < 530; row++) for (let col = 0; col < 1000; col++) if (pixels[(row * 1000 + col) * 4 + 3]) {
      const wx = x + (col - 499.5) * Math.cos(roll) + (row - 329.5) * Math.sin(roll)
      if (wx >= roof.left + 2 && wx < roof.right - 2) sheltered++
      else open++
    }
    assert.equal(sheltered, 0)
    assert.ok(open > 0)
  }
  const c = createCanvas(256, 260).getContext('2d') as unknown as CanvasRenderingContext2D
  const roof = roofs[0]
  weather.draw(c, { left: roof.left + 12, right: roof.right - 8, top: -208, bottom: 58 }, roof.terminal, 'ultra', false, false)
  assert.deepEqual(weather.work, { openClips: 0, streaks: 0, splashes: 0, wetMarks: 0, runoff: 0 })
})
