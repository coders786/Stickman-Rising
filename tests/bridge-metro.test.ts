import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { Camera, LOGICAL_HEIGHT, PLAY_ZOOM } from '../src/game/core/camera'
import { BridgeRoute } from '../src/game/stage/route'
import { applySectionView, railProject, sectionSpan, sectionY } from '../src/game/stage/bridge-depth'
import { BridgeFrame, BRIDGE_LIGHT, MOBILE_FLASH_LIMIT } from '../src/game/render/bridge-frame'
import { localLightBrush } from '../src/game/lighting/receiver'
import { DECK_WIRE, GUIDE_LENS_Y, deckGuideSocket } from '../src/game/stage/bridge-sockets'
import { BridgeAtmosphere } from '../src/graphics/bridge/BridgeAtmosphere'
import { BRIDGE_TOWERS, CITY_USES, cityPhase } from '../src/graphics/bridge/CityGeometry'
import { unit } from '../src/graphics/bridge/SkyBasis'
import { chunkLightData } from '../src/graphics/bridge/NoirGeometry'
import { RailSchedule, RAIL_MODEL_SCALE, RAIL_Y, railLocalOffset } from '../src/graphics/bridge/RailSchedule'
import { newReceiverLight } from '../src/graphics/sacr/SACRLocalLight'

for (const [w, h] of [[400, 844], [1280, 720]]) {
  test(`Bridge tracking holds its road through idle footwork, hits and stopping (${w}×${h})`, () => {
    const c = new Camera(), x = 4400
    c.setTravelFraming(true); c.setArena(0, Infinity); c.setViewport(w, h); c.startOnRoad(x)
    const zoom = h / LOGICAL_HEIGHT, dt = 1/60
    const step = (p: number, vx: number) => { c.focus(p, 0, vx, 0); c.setZoom(PLAY_ZOOM); c.update(dt) }
    for (let i = 0; i < 120; i++) {
      c.addTrauma(.2); step(x, i % 2 ? -593 : 593)
      assert.deepEqual([c.x, c.zoom, c.offX, c.rot], [x, zoom, 0, 0])
    }
    for (let n = 1; n <= 120; n++) {
      const px = c.x
      step(x + n * 5, 300)
      assert.ok(c.x >= px && c.x <= px + 5.00001)
    }
    const last = c.x
    assert.ok(last > x + 500)
    for (let n = 0; n < 180; n++) { step(x + 600, 0); assert.equal(c.x, last) }
  })
}

test('portrait checkpoint framing is spatial and independent of fight state', () => {
  const route = new BridgeRoute(42), gate = route.gateX(0), x = gate - 238, c = new Camera()
  c.setTravelFraming(true); c.setArena(0, Infinity); c.setViewport(400, 844); c.startOnRoad(x)
  c.focus(x, 0, 0, 0, gate); c.update(1/60)
  const shot = [c.x, c.zoom]
  const boss = 200 + (gate - 92 - c.x) * c.zoom
  assert.ok(boss > 60 && boss < 385)
  for (let i = 0; i < 180; i++) {
    c.focus(x, 0, 0, 0, gate); c.update(1/60)
    assert.deepEqual([c.x, c.zoom], shot)
  }
})

test('rare rail overlaps are independent opposite-direction arrivals, not an archetype', () => {
  let totalSingles = 0, totalPairs = 0, authoredPairs = 0
  for (let seed = 36; seed < 48; seed++) {
    const rail = new RailSchedule(seed), x = 7700 + seed * 146
    for (let i = 1; i < rail.events.length; i++) {
      const a = rail.events[i - 1], b = rail.events[i], gap = b.at - a.at
      if (gap >= 1) continue
      const meet = gap / (railLocalOffset(1) * (a.dir / a.speed - b.dir / b.speed))
      assert.ok(meet > 100 && meet < 500, 'paired departures must cross on the bridge')
      rail.sample(rail.crossingTime(a, meet), meet, 320)
      assert.deepEqual([...rail.indices.slice(0, rail.count)], [i-1, i])
      assert.ok(rail.time.slice(0, rail.count).every(t => Math.abs(t) < 1e-8))
      authoredPairs++
    }
    for (let t = rail.offset; t < rail.offset + rail.period; t += .097) {
      rail.sample(t, x, 600)
      assert.ok(rail.count <= 2)
      if (rail.count === 1) totalSingles++
      if (rail.count === 2) {
        totalPairs++
        assert.notEqual(rail.events[rail.indices[0]].dir, rail.events[rail.indices[1]].dir)
      }
    }
    rail.sample(rail.offset + .08, 0, 600)
    const ix = rail.indices.slice(0, rail.count), ages = rail.time.slice(0, rail.count)
    rail.sample(rail.offset + .08 + rail.period, 0, 600)
    assert.deepEqual(rail.indices.slice(0, rail.count), ix)
    assert.ok(ages.every((a, i) => Math.abs(a - rail.time[i]) < 1e-8))
  }
  assert.ok(authoredPairs > 0 && totalPairs > 0 && totalPairs < .11 * totalSingles, `${totalPairs} vs ${totalSingles}`)
  assert.ok(Math.abs((railLocalOffset(1562.51) - railLocalOffset(1562.49)) * RAIL_MODEL_SCALE - .02) < 1e-9)
})

test('rail stock and footings share continuous world addresses in both directions', async () => {
  const { streetProject, STREET_FRONT_Y, STREET_REAR_Y, STREET_SCALE } = await import('../src/game/stage/bridge-city')
  const rail = new RailSchedule(42)
  for (const dir of [-1, 1]) {
    const e = rail.events.find(e => e.dir === dir)!
    for (const x of [750, 250_000, 25_000_000]) {
      const t = rail.crossingTime(e, x) + rail.period * 730
      const lead = (at: number, cx: number) => {
        rail.sample(at, cx, 740)
        const i = rail.indices.subarray(0, rail.count).indexOf(rail.events.indexOf(e))
        assert.notEqual(i, -1)
        return rail.time[i] * e.dir * e.speed
      }
      assert.ok(Math.abs(lead(t, x)) < .00001)
      assert.ok(Math.abs(lead(t, x + 10) + railLocalOffset(10)) < .00001)
      assert.ok(Math.abs(lead(t + .1, x) - e.dir * e.speed * .1) < .00001)
    }
  }
  for (const [w, h] of [[580, 300], [960, 540], [400, 844]]) {
    const cam = { y: w < h ? -85 : -112, zoom: h / LOGICAL_HEIGHT }
    const track = railProject(cam, h), street = streetProject(cam, h)
    const jumped = { y: cam.y - 142, zoom: cam.zoom * .94 }
    const airborne = railProject(jumped, h), upperStreet = streetProject(jumped, h)
    assert.equal(track.scale, cam.zoom * RAIL_MODEL_SCALE)
    assert.equal(airborne.scale, jumped.zoom * RAIL_MODEL_SCALE)
    assert.equal(upperStreet.scale, jumped.zoom * STREET_SCALE)
    for (const [view, r, s] of [[cam, track, street], [jumped, airborne, upperStreet]] as const) {
      assert.ok(Math.abs((s.rear - r.rail) / view.zoom - (STREET_REAR_Y - RAIL_Y)) < 1e-9)
      assert.ok(Math.abs((s.front - s.rear) / view.zoom - (STREET_FRONT_Y - STREET_REAR_Y)) < 1e-9)
    }
    const justLift = { ...cam, y: cam.y - 142 }, rise = 142 * cam.zoom
    assert.ok(Math.abs(railProject(justLift, h).rail - track.rail - rise) < 1e-9)
    assert.ok(Math.abs(streetProject(justLift, h).rear - street.rear - rise) < 1e-9)
  }
})

test('the continuous camera keeps a jumped or zoomed fighter above the lane controls', () => {
  const c = new Camera(), v = { w: 400, h: 844 }, head = -480, sole = -270
  c.setTravelFraming(true); c.setArena(0, Infinity); c.setViewport(v.w, v.h); c.startOnRoad(1150)
  c.zoom = 2.1; c.offY = 22
  const x = c.x
  const project = (y: number) => v.h * .5 + (y - c.y - c.offY) * c.zoom
  assert.ok(project(head) < 0)
  c.fitTravelBody(head, sole, 158, 162)
  assert.equal(c.x, x)
  assert.ok(project(head) >= 158 - 1e-9 && project(sole) <= 682 + 1e-9)
})

test('the glass city has distinct uses and zoom does not slide the card phase', () => {
  assert.ok(BRIDGE_TOWERS[0].length + BRIDGE_TOWERS[1].length > 46)
  assert.deepEqual(new Set(BRIDGE_TOWERS[1].map(t => t.use)), new Set(CITY_USES))
  const a = new BridgeAtmosphere(), w = 820, h = 520, x = 34577
  const opts = { time: 0, drift: 0, cover: .2, haze: .28, flash: 0 }
  for (const zoom of [.85, 1, 1.2, 1.43]) {
    a.update(null, { x, y: -110, zoom }, w, h, 42, 1, opts)
    for (const [i, band] of [a.cityFar, a.cityMid].entries()) {
      const want = unit(cityPhase(x, 42, i as 0 | 1)), actual = unit(band[0] + band[1] * .5)
      assert.ok(Math.abs(actual - want) < 1e-6)
    }
  }
  const c = new BridgeRoute(42).chunk(2), { points, blockers } = chunkLightData(c)
  assert.ok(points.some(p => p.x === deckGuideSocket(c) && p.y === GUIDE_LENS_Y && p.strength > .5))
  assert.ok(blockers.some(b => b.kind === 'lamp' && c.lamp + DECK_WIRE.x > b.left && c.lamp + DECK_WIRE.x < b.right && DECK_WIRE.y >= b.top && DECK_WIRE.y <= b.bottom))
})

test('local SACR line transfer is ranged, depth-aware, rebased and occluded', () => {
  const f = new BridgeFrame(), q = newReceiverLight(), x = 23926, cam = { x, y: -140, zoom: 1 }
  const start = (cx: number) => {
    f.begin({ ...cam, x: cx }, 640, 460, 0, .8, .3, 1, 0, 0, 0, 0)
    f.impulseLimit = MOBILE_FLASH_LIMIT
    assert.ok(f.light(BRIDGE_LIGHT.impulse, x - 112, -93, 98, '#40e2ff', 2.9, 3, x + 83, -93))
  }
  start(x)
  const end = { ...f.receive(x + 91, -105, -5, q) }
  assert.ok(end.b > 1 && end.b > end.g && end.g > end.r)
  const far = { ...f.receive(x + 91, -105, 170, q) }
  assert.equal(far.strength, 0)
  assert.equal(f.receive(x + 200, -105, 0, q).strength, 0)
  start(x + 285)
  assert.deepEqual(f.receive(x + 91, -105, -5, q), end)
  f.blockers.push({ left: x - 95, right: x + 95, top: -116, bottom: -111, kind: 'catwalk' })
  assert.equal(f.receive(x + 52, -134, -5, q).strength, 0)
  assert.ok(f.receive(x + 52, -84, -5, q).b > 1)
  f.begin(cam, 640, 460, .2, .8, .3, 1, 0, 0, 0, 0)
  assert.equal(f.receive(x, -92, -5, q).strength, 0, 'a prior emitter cannot survive begin()')
})

test('the existing contour brush lights the incident side, including world-facing flips', () => {
  const c = createCanvas(40, 40), g = c.getContext('2d'), ctx = g as unknown as CanvasRenderingContext2D
  const a = newReceiverLight(); Object.assign(a, { r: 1, g: .12, b: .04, dx: 1, dy: 0, dz: 0, strength: 1 })
  for (const flip of [1, -1]) {
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, 40, 40)
    ctx.fillStyle = localLightBrush(ctx, a, flip, 20, 20, 18, 18, .64)!
    ctx.fillRect(4, 8, 32, 24)
    const left = g.getImageData(8, 20, 1, 1).data, right = g.getImageData(32, 20, 1, 1).data
    const lit = flip > 0 ? right : left, unlit = flip > 0 ? left : right
    assert.ok(lit[0] > unlit[0] + 42 && lit[0] > lit[1] + 21)
    assert.deepEqual([...g.getImageData(2, 20, 1, 1).data], [10, 10, 10, 255])
  }
})

test('every in-view catenary endpoint lands in its insulator, including edge spans', async () => {
  const { BridgeRail } = await import('../src/game/stage/bridge-rail')
  const { RAIL_SUPPORT, RAIL_SUPPORT_PITCH } = await import('../src/graphics/bridge/RailSchedule')
  const { RouteScenery } = await import('../src/game/stage/route-art')
  const { CanvasLedger, SurfaceScope } = await import('../src/game/render/ledger')
  const ends: number[][] = [], drawn: number[][] = [], supports: number[][] = []
  const matrix = createCanvas(760, 460).getContext('2d')
  const noop = () => undefined
  const g = {
    save: () => matrix.save(), restore: () => matrix.restore(), scale: matrix.scale.bind(matrix),
    rotate: matrix.rotate.bind(matrix), translate: matrix.translate.bind(matrix), beginPath: noop, closePath: noop, drawImage: noop,
    moveTo: (x: number, y: number) => ends.push([x,y]), lineTo: noop,
    quadraticCurveTo: (mx: number, my: number, x: number, y: number) => { ends.push([x, y]); void mx; void my },
    createLinearGradient: () => ({ addColorStop: noop }), stroke: noop, fill: noop,
    fillRect: (x: number, y: number, w: number, h: number) => {
      drawn.push([x,y,w,h])
      if (y === RAIL_SUPPORT.wire - 2 && w === 6 && h === 1.2) {
        const m = matrix.getTransform()
        supports.push([m.a * (x + 3) + m.c * (y + 2) + m.e, m.b * (x + 3) + m.d * (y + 2) + m.f])
      }
    },
  } as unknown as CanvasRenderingContext2D
  const ledger = new CanvasLedger((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement)
  const scope = new SurfaceScope('rail-test', ledger)
  const rail = new BridgeRail(scope), cam = { x: 12507, zoom: 1, y: -110 }
  const streetY = 98, span = 760 / railProject(cam, 460).scale
  rail.paint(g, 760, 460, cam, streetY, 0, true, 42, false)
  assert.equal(rail.last.footingY, sectionY(cam, 460, streetY))
  assert.ok(rail.last.bearings >= 2)
  const anchors = ends.filter(([x, y]) => x >= 0 && x <= span && y === RAIL_SUPPORT.wire)
  assert.ok(anchors.length >= 4)
  for (const [x, y] of anchors) assert.ok(drawn.some(([l, t, w, h]) => l + 3 === x && t === y - 2 && w === 6 && h === 1.2))
  // Compare the actual insulator draw matrix with the playable deck's
  // projection of an independently computed lattice of fixed world bolts.
  for (const v of [cam, { ...cam, x: cam.x + 84, y: -194, zoom: .86, rot: .11 }]) {
    supports.length = 0
    rail.paint(g, 760, 460, v, streetY, 0, true, 42, false)
    applySectionView(g, v, 760, 460)
    const m = matrix.getTransform(), wy = RAIL_Y + RAIL_SUPPORT.wire * RAIL_MODEL_SCALE
    const wx = (RAIL_SUPPORT_PITCH * 40 + RAIL_SUPPORT.arm) * RAIL_MODEL_SCALE
    const x = wx * m.a + wy * m.c + m.e, y = wx * m.b + wy * m.d + m.f
    matrix.resetTransform()
    assert.ok(supports.some(([px, py]) => Math.hypot(px - x, py - y) < .003), JSON.stringify({ v, x, y, supports }))
    assert.ok(sectionSpan(v, 760, 460) >= 760)
  }
  scope.releaseAll()
  const route = new BridgeRoute(42), scenery = new RouteScenery(route)
  const view = { left: route.chunk(3).lamp + 40, right: route.chunk(4).lamp - 25, top: -540, bottom: 210 }
  ends.length = 0
  scenery.drawCables(g, view, 0, .3, true)
  assert.deepEqual(ends, [[route.chunk(3).lamp + DECK_WIRE.x, DECK_WIRE.y], [route.chunk(4).lamp + DECK_WIRE.x, DECK_WIRE.y]])
  scenery.dispose()
})

test('a lightning restrike lights new rendered spans while keeping its contacts pinned', async () => {
  const { LightningSystem } = await import('../src/game/fx/lightning')
  const fx = new LightningSystem(), f = new BridgeFrame()
  fx.cast({ enemies: [], minX: 0, maxX: 2000 }, 300, -92, 1, .18, { color: '#41f6ff', maxLen: 150 })
  const bolt = fx['bolts'].find(b => b.active)!, path = bolt.base.slice()
  const emit = () => {
    f.begin({ x: 345, y: -120, zoom: 1 }, 640, 480, 0, .6, .2, 1, 0, 0, 0, 0)
    fx.bridgeEmitters(f)
    const a = bolt.legs[0]
    assert.ok(f.impulseCount <= 4)
    assert.ok(Math.abs(f.shape[0] + f.cam.x - a[2]) < .0001 && Math.abs(f.shape[1] - a[3]) < .0001)
    return [f.shape[0], f.shape[1]]
  }
  const before = emit()
  fx.update(.069)
  assert.deepEqual(bolt.base, path)
  assert.notDeepEqual(emit(), before)
  fx.update(.144)
  f.begin({ x: 345, y: -120, zoom: 1 }, 640, 480, .22, .6, .2, 1, 0, 0, 0, 0)
  fx.bridgeEmitters(f)
  assert.equal(f.impulseCount, 0)
})

test('quiet city activity stays behind fixed glass and lifts mostly dwell at landings', async () => {
  const { CITY_ACTIVITY_ROOMS, CITY_LIFTS, CITY_CARD_H } = await import('../src/game/stage/bridge-city')
  const { cityLiftPosition, cityRoomLight } = await import('../src/graphics/bridge/CityActivity')
  const { BridgeCanvasSky } = await import('../src/game/stage/bridge-sky-canvas')
  const { SurfaceScope } = await import('../src/game/render/ledger')
  const sky = new BridgeCanvasSky(new SurfaceScope('aperture-test'))
  const a = new BridgeAtmosphere(), w = 1024, h = 420
  a.cityMid.set([0, 1, 0, CITY_CARD_H[1] / h]); a.seed = 42
  a.cityFar.set([0, 1, .1, .42]); a.skyHeight = h
  const y0 = h - CITY_CARD_H[1]
  assert.ok(CITY_LIFTS.length > 1 && CITY_LIFTS.length < 10)
  assert.ok(CITY_ACTIVITY_ROOMS.length > 2 && CITY_ACTIVITY_ROOMS.length < 10)
  const draw = (time: number, quiet: boolean) => {
    const cabs: number[][] = [], rooms: number[][] = []
    const g = { fillStyle: '', globalAlpha: 1, fillRect(x: number, y: number, w: number, h: number) {
      if (this.fillStyle === '#737d74') { assert.ok(this.globalAlpha <= .43); cabs.push([x, y, w, h]) }
      if (this.fillStyle === '#b9a47e') rooms.push([x, y, w, h])
    } }
    a.time = time
    sky.life(g as unknown as CanvasRenderingContext2D, a, w, h, quiet)
    assert.equal(g.globalAlpha, 1)
    assert.equal(cabs.length, CITY_LIFTS.length)
    for (const [i, [l, t, width, height]] of cabs.entries()) {
      const shaft = CITY_LIFTS[i]
      assert.ok(l > shaft.x && l + width < shaft.x + shaft.w)
      assert.ok(t >= y0 + shaft.y - .001 && t + height <= y0 + shaft.bottom + .001)
    }
    for (const [x,y,w,h] of rooms) assert.ok(CITY_ACTIVITY_ROOMS.some(r => [r.x, y0 + r.y, r.w, r.h].every((v,i) => Math.abs(v-[x,y,w,h][i]) < .001)))
    return { cabs, rooms }
  }
  const early = draw(0, false)
  const positions = Array.from({ length: 320 }, (_,i) => CITY_LIFTS.map(s=>cityLiftPosition(s.id, 42, i * .45,false)))
  const deltas = positions.slice(1).map((now,i)=>now.map((v,j)=>Math.abs(v-positions[i][j])))
  assert.ok(deltas.some(d=>d.some(x=>x > .019)), 'at least one slow physical trip')
  assert.ok(deltas.every(d=>d.every(x=>x < .10)), 'no jumps mid-shaft')
  for(const [i,s] of CITY_LIFTS.entries()) assert.ok(deltas.filter(d=>d[i]===0).length > 280, `shaft ${s.id} spends most of the time parked`)
  assert.ok(deltas.filter(d=>d.filter(x=>x > .001).length > 1).length < 25, 'trips do not move in lockstep')
  const late = draw(48, false)
  assert.deepEqual(early.cabs.map(p => p[0]), late.cabs.map(p => p[0]))
  assert.deepEqual(draw(1, true), draw(88, true))
  const id = CITY_ACTIVITY_ROOMS[0].id
  const room = Array.from({length:130},(_,i)=>cityRoomLight(id,42,i))
  assert.ok(room.filter(x=>x===1).length > 34 && room.filter(x=>x===0).length > 34)
})
