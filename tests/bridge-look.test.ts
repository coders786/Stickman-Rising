import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { BRIDGE_COVER_BUDGET, BRIDGE_FACE_BUDGET, BRIDGE_LIGHT, BridgeFrame } from '../src/game/render/bridge-frame'
import { bakeBridgeDeckMask, bakeBridgeLutStrip, bakeBridgeMaterialTiles, bridgeGrade, deckY, materialRoughness, MATERIAL_TILE,
  PUDDLE_PITCH, puddleMask, unpackBridgeLut, WET_ROUGHNESS, atmosphereTransmission } from '../src/game/stage/bridge-material'
import { BridgeRoute } from '../src/game/stage/route'
import { ROAD } from '../src/game/stage/road-section'
import { bridgeCanvasRoadAbsorption, bridgeRoadWater } from '../src/game/stage/bridge-road-water'
import { flickerGain } from '../src/game/stage/bridge-sockets'
import { RouteWeather } from '../src/game/world/route-weather'
import { MOBILE_RAIN_LIMIT, MASTER_MOTE_SLOTS, MASTER_RAIN_SLOTS } from '../src/game/stage/bridge-weather-data'
import { newProbe } from '../src/game/lighting/ribbons'
import { Enemy } from '../src/game/entities/enemy'
import { Player } from '../src/game/entities/player'
import { drawFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_STYLE, solveSkeleton } from '../src/game/anim/skeleton'

const eps = 1e-6

test('the Ronin contour, hands and scarf are literal flat black; depth metadata cannot change the ink', () => {
  const canvas = createCanvas(240, 280), ctx = canvas.getContext('2d'), p = new Player()
  p.reset(0)
  ctx.translate(120, 140); ctx.scale(2, 2)
  const draw = (g: typeof p.geom) => {
    ctx.clearRect(-60, -70, 120, 140)
    drawFighter3D(ctx as unknown as CanvasRenderingContext2D, g, PLAYER_STYLE, {
      scarfCount: 4, scarfNodes: [{x: -2, y: -40}, {x: -9, y: -43}, {x: -16, y: -40}, {x: -23, y: -42}],
      hands: { leftOpen: .88, rightOpen: .2, leftRoll: .1, rightRoll: 0 }, time: 2.7,
    })
    return ctx.getImageData(0, 0, 240, 280).data
  }
  const bare = draw(p.geom), differentDepth = structuredClone(p.geom)
  for (const joint of Object.values(differentDepth)) if (typeof joint === 'object') joint.z = -joint.z * 4 + 80
  assert.deepEqual(draw(differentDepth), bare)
  let body = 0, edges = 0
  for (let i = 0; i < bare.length; i += 4) {
    assert.equal(bare[i] | bare[i + 1] | bare[i + 2], 0)
    body += +(bare[i + 3] === 255)
    edges += +(bare[i + 3] > 0 && bare[i + 3] < 255)
  }
  assert.ok(body > 1000 && edges > 100)
})

test('exposure is projected around the incumbent lane, with stable organic receivers', () => {
  assert.equal(deckY(0), ROAD.rear)
  assert.equal(deckY(1), ROAD.front)
  assert.ok(deckY(.5) < 0, 'far curb compresses more than the near parapet')
  let damp = 0, pools = 0
  for (let x = 0; x < PUDDLE_PITCH; x += 9) for (let y = ROAD.rear; y < ROAD.front; y += 4) {
    const m = puddleMask(x, y)
    assert.ok(Math.abs(m - puddleMask(x + PUDDLE_PITCH * 11, y)) < eps)
    assert.ok(Math.abs(m - puddleMask(x - PUDDLE_PITCH * 11, y)) < eps)
    damp += +(m > .02 && m < .98); pools += +(m > .98)
    assert.equal(puddleMask(x, ROAD.soffit), 0)
  }
  assert.ok(damp > 1000 && pools > 100)
  assert.ok(atmosphereTransmission(4, .4) < atmosphereTransmission(1, .4))
})

test('exposed stone absorbs as it wets, but only basins pool and shelters stay dry', () => {
  const rough = .58, dry = bridgeRoadWater(0, .9, rough, false)
  assert.deepEqual(dry, { film: 0, traceWet: 0, pool: 0, rough, diffuse: 1 })
  const film = bridgeRoadWater(.94, .03, rough, false), pool = bridgeRoadWater(.94, .94, rough, false)
  assert.equal(film.traceWet, 0, 'damp aggregate should not trace a reflection')
  assert.ok(film.diffuse <= .74 && film.rough < dry.rough)
  assert.ok(Math.abs(pool.rough - WET_ROUGHNESS) < eps)
  assert.ok(pool.diffuse < film.diffuse && pool.traceWet > .90)
  assert.deepEqual(bridgeRoadWater(1, 1, rough, true), bridgeRoadWater(0, 1, rough, true))
  assert.deepEqual(bridgeCanvasRoadAbsorption(0), { film: 0, pool: 0 })
  const a = bridgeCanvasRoadAbsorption(.94), b = bridgeCanvasRoadAbsorption(.3)
  assert.ok(a.film > b.film && a.pool > b.pool)
  assert.ok(Math.abs((1 - a.film) ** 2 - film.diffuse) < eps)
})

test('a lossless data atlas retains normal XY, AO and independent material roughness', () => {
  const a = bakeBridgeMaterialTiles(), size = MATERIAL_TILE * MATERIAL_TILE * 4
  assert.equal(a.length, size * 4)
  assert.deepEqual(a, bakeBridgeMaterialTiles())
  for (let m = 0; m < 4; m++) {
    let sum = 0, positive = 0, negative = 0
    for (let i = size * m; i < size * (m + 1); i += 4) {
      assert.ok(a[i + 3] > 126, 'AO must have a material floor')
      const x = a[i] / 127.5 - 1, y = a[i + 1] / 127.5 - 1
      assert.ok(x * x + y * y < 1, 'reconstructed Z is real')
      if (y > .04) positive++
      if (y < -.04) negative++
      sum += a[i + 2] / 255
    }
    assert.ok(positive > 0 && negative > 0)
    assert.ok(Math.abs(sum / (size / 4) - materialRoughness[m]) < .02)
    assert.ok(WET_ROUGHNESS < materialRoughness[m])
  }
})

test('the packed deck mask stays wet only in the authored basins and has no diffuse emission', () => {
  const data = bakeBridgeDeckMask()
  assert.equal(data.length, PUDDLE_PITCH * (ROAD.front - ROAD.rear) * 4)
  for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 0)
  for (let y = 0; y < ROAD.front - ROAD.rear; y += 4) for (let x = 0; x < PUDDLE_PITCH; x += 11) {
    assert.equal(data[(y * PUDDLE_PITCH + x) * 4 + 2], Math.round(255 * puddleMask(x + .5, y + ROAD.rear + .5)))
  }
})

test('authoring LUT strips unpack to hardware trilinear nodes, with four different grades', () => {
  const r = 7, g = 8, b = 9
  const looks = ([0, 1, 2, 3] as const).map(look => {
    for (const n of [16, 32] as const) {
      const strip = bakeBridgeLutStrip(n, look), vol = unpackBridgeLut(strip, n)
      assert.equal(strip.length, n ** 3 * 4)
      const sr = (g * n * n + b * n + r) * 4, vr = (b * n * n + g * n + r) * 4
      assert.deepEqual(vol.slice(vr, vr + 4), strip.slice(sr, sr + 4))
      const expected = bridgeGrade(look, r / (n - 1), g / (n - 1), b / (n - 1))
      assert.deepEqual([...vol.slice(vr, vr + 4)], [...expected.map(x => Math.round(255 * x)), 255])
    }
    return bridgeGrade(look, .40, .40, .40)
  })
  assert.equal(new Set(looks.map(c => c.join(','))).size, 4)
})

test('one bounded frame packet gives the master path actual faces, sockets and eaves', () => {
  const route = new BridgeRoute(42), f = new BridgeFrame()
  const frame = (x: number) => f.begin({ x, y: -112, zoom: 1.22, rot: .09 }, 1180, 660, 11.95, .48, .56, .83, .7, 0, 0, 0)
  const s = route.chunk(3).shelter!
  frame(s.terminal); f.gatherBlockers(route)
  f.light(BRIDGE_LIGHT.impulse, s.right + 22, -76, 200, '#9ae8ff', 3.4, 4)
  f.gather(route, undefined, undefined, false, true)
  assert.ok(f.vertexCount > 18 && f.vertexCount <= BRIDGE_FACE_BUDGET * 6)
  assert.ok(f.roofs <= BRIDGE_COVER_BUDGET && !f.overflow)
  assert.equal(f.cover[0] + s.terminal, s.left)
  assert.equal(f.cover[1] + s.terminal, s.right)
  assert.ok(f.exposure > .95)
  // The eave cannot be crossed by the dynamic hit light (even inside the radius).
  const probe = newProbe()
  assert.equal(f.impulseAt(s.right - 35, -60, probe, route), undefined)
  assert.equal(probe.r + probe.g + probe.b, 0)
  assert.ok(f.impulseAt(s.right + 5, -60, probe, route) !== undefined)
  assert.ok(probe.b > .1 && probe.castW > 0)
  for (let i = 0; i < 40; i++) f.light(BRIDGE_LIGHT.point, s.right, -60, 200, '#ffc5a2', 1, 8)
  assert.equal(f.count, 4, 'production dynamic budget is four; the array is larger than admission')
  frame(14240); f.gather(route, undefined, undefined, false, true)
  assert.ok(f.vertexCount >= 24 && f.receipt().quads <= BRIDGE_FACE_BUDGET)
  assert.ok(f.source.slice(0, f.count * 4).every(Number.isFinite))
  assert.ok(Math.abs(flickerGain(42, 4 / 6.4 - eps) - flickerGain(42, 4 / 6.4 + eps)) < eps)
})

test('three weather depths keep the Mobile cap and accept only genuine puddle contacts', () => {
  const route = new BridgeRoute(42), rain = new RouteWeather(route)
  rain.advance(180, 1)
  const c = createCanvas(480, 480).getContext('2d') as unknown as CanvasRenderingContext2D
  let pool = 7 * PUDDLE_PITCH
  while (puddleMask(pool, ROAD.lane) < .65 || route.shelterAt(pool)) pool += 2
  const bay = route.chunk(0).shelter!
  assert.ok(rain.footfall(pool, 0, .8, 380))
  assert.equal(rain.footfall(pool, -142, .8, 380), false)
  assert.equal(rain.footfall(bay.terminal, 0, .8, 380), false)
  const view = { left: pool - 600, right: pool + 600, top: -500, bottom: 77 }
  rain.advance(4, 1)
  for (const master of [false, true]) {
    for (const near of [false, true]) rain.draw(c, view, pool, 'ultra', near, false, master)
    if (!master) assert.ok(rain.work.streaks > 0 && rain.work.streaks <= MOBILE_RAIN_LIMIT)
    else assert.equal(rain.work.streaks, 0, 'Master never doubles the instanced rain with the Canvas stroke batch')
    assert.equal(rain.work.wetMarks, 1)
    assert.ok(rain.work.splashes <= 12)
  }
  assert.equal(MASTER_RAIN_SLOTS.reduce((a: number, b) => a + b, 0) + MASTER_MOTE_SLOTS, 434)
})

test('Gemini hit presentation adds a rim without whitening the chassis or changing its pose', () => {
  const e = new Enemy('boss', 125, 1)
  e.arriveOnRoute(-1)
  solveSkeleton(e.pose, { torso: 32, neck: 3.9, headR: 8, shoulderFwd: 2.7, shoulderDrop: 2.8,
    upperArm: 21, foreArm: 19, hand: 6, thigh: 24, shin: 22, foot: 8, blade: 40 }, e.geom)
  const paint = (flash: number, bridge: boolean) => {
    const c = createCanvas(460, 414), ctx = c.getContext('2d')
    ctx.fillStyle = '#142433'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.translate(106, 368)
    e.flashT = flash
    e.draw(ctx as unknown as CanvasRenderingContext2D, 0, undefined, false, bridge)
    return ctx.getImageData(0, 0, c.width, c.height).data
  }
  const pose = JSON.stringify(e.geom)
  const idle = paint(0, true), hit = paint(1, true), old = paint(1, false)
  // Read a plate interior, not a lit bevel, visor, or saber halo.
  let bridgeGain = 0, oldGain = 0, samples = 0
  const plain = paint(0, false)
  for (let i = 0; i < idle.length; i += 4) {
    if (idle[i] === 20 && idle[i + 1] === 36 && idle[i + 2] === 51) continue
    const gainOld = old[i + 1] - plain[i + 1]
    if (gainOld < 32 || plain[i + 1] < 110) continue
    bridgeGain += Math.max(0, hit[i + 1] - idle[i + 1])
    oldGain += gainOld; samples++
  }
  assert.notDeepEqual(hit, idle, 'the material response is visible')
  assert.ok(samples > 280, `plate pixels: ${samples}`)
  assert.ok(bridgeGain < oldGain * .85, `interior green gain: ${bridgeGain} vs ${oldGain}`)
  assert.equal(JSON.stringify(e.geom), pose)
})
