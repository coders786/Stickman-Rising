import { OPENING_MAX_GAP_MS, OpeningPace } from '../src/game/render/opening-pace'
import { bridgeOpeningPlatesSettled, bridgePlate, discardPendingBridgePlates } from '../src/game/stage/bridge-webp'
import { GLASS_ATLAS_H, GLASS_ENV_W, GLASS_PLATE } from '../src/graphics/bridge/ShopGlassOptics'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { Player } from '../src/game/entities/player'
import { Enemy } from '../src/game/entities/enemy'
import { advancePaint, finishPaint } from '../src/game/render/paint-slices'
import { BridgePresentation } from '../src/game/render/bridge-presentation'
import { CanvasLedger, SurfaceScope, type Surface } from '../src/game/render/ledger'
import { opaqueRoadBand } from '../src/game/stage/bridge-depth'
import { ROAD, ROAD_PLATE_TOP } from '../src/game/stage/road-section'
import { BridgeRoute } from '../src/game/stage/route'
import { BridgeCanvasSky } from '../src/game/stage/bridge-sky-canvas'
import { BridgeAtmosphere } from '../src/graphics/bridge/BridgeAtmosphere'
import { RouteWeather } from '../src/game/world/route-weather'
import { bridgePrecipitation, bridgeRetention, bridgeVentX } from '../src/game/stage/bridge-weather-data'
import { newFixtureLobes, localLightBrush } from '../src/game/lighting/receiver'
import { sampleFixturePair } from '../src/graphics/bridge/LightVectorGrid'
import type { LightPoint } from '../src/graphics/bridge/NoirGeometry'
import { BRIDGE_PROP_KINDS, hitsRouteProp, propVariant, routePropShape, traceRouteProp } from '../src/game/stage/bridge-prop-art'

test('an opening paint yields on elapsed budget and can be retired without finishing it', () => {
  let now = 0, cancelled = false
  const order: number[] = []
  function* draw(): Generator<void, string | undefined> {
    try {
      for (const id of [1, 2, 3, 4, 5]) { now += 3; order.push(id); yield }
      return 'frame'
    } finally { cancelled = order.at(-1) !== 5 }
  }
  const draft = draw()
  assert.equal(advancePaint(draft, 6, () => now), false)
  assert.deepEqual(order, [1, 2])
  draft.return(undefined)
  assert.ok(cancelled)
  assert.deepEqual(order, [1, 2], 'no more work after cancel')
  order.length = now = 0
  assert.equal(finishPaint(draw()), 'frame')
  assert.deepEqual(order, [1, 2, 3, 4, 5], 'the same painter can submit a complete live frame')
})

test('new-life and Retry skeletons are a complete pose at tick zero', () => {
  const hero = new Player()
  const pose = (p: Player | Enemy) => [p.geom.headC, p.geom.chest, p.geom.kneeR, p.geom.toeR, p.geom.toeL].map(j => [j.x, j.y])
  hero.reset(240)
  const there = pose(hero), initialHp = hero.hp
  assert.ok(hero.geom.headC.y < -20 && hero.geom.kneeR.y > 10)
  assert.ok(Math.max(hero.geom.toeL.y, hero.geom.toeR.y) * hero.scale + hero.hipY > -6)
  hero.geom.headC.y = 0; hero.hp = 12; hero.y = -90
  hero.reset(333)
  assert.deepEqual([hero.hp, hero.x, hero.y, pose(hero)], [initialHp, 333, 0, there])
  const threat = new Enemy('grunt', 342, 1)
  threat.arriveOnRoute(-1)
  assert.equal(threat.stateT, 0)
  assert.ok(!threat.spawning && threat.geom.headC.y < -21 && threat.geom.kneeR.y > 9)
})

test('a work backing stays hidden until commit and a lost front is invalid until repainted', () => {
  const surface = (renderLayer: string) => {
    let lost = false
    const canvas = { style: { visibility: 'visible' }, dataset: { renderLayer }, width: 640, height: 400 }
    return Object.assign({ canvas, isContextLost: () => lost }, { lose(v: boolean) { lost = v } })
  }
  const a = surface('scene'), b = surface('scene-work')
  const context = (c: typeof a) => c as unknown as CanvasRenderingContext2D
  const p = new BridgePresentation(context(a), context(b))
  assert.equal(p.fallbackReady, false)
  p.commit(context(a)); p.work().canvas.width = 820
  assert.deepEqual([a.canvas.width, a.canvas.style.visibility, b.canvas.style.visibility], [640, 'visible', 'hidden'])
  assert.equal(p.fallbackReady, true)
  p.invalidate(b.canvas as unknown as EventTarget)
  assert.equal(p.fallbackReady, true)
  a.lose(true); p.invalidate(a.canvas as unknown as EventTarget); a.lose(false)
  assert.equal(p.fallbackReady, false, 'restoring a context does not restore its pixels')
  p.commit(context(b))
  assert.deepEqual([p.fallbackReady, p.fallbackLayer, a.canvas.style.visibility], [true, 'scene-work', 'hidden'])
})

test('Canvas skyline reuses two distinct fog cards through pan and repaints on weather or restored backing', () => {
  let paints = 0
  const stores: { restore?: () => void; canvas: Surface }[] = []
  const ledger = new CanvasLedger((w, h) => {
    const c = createCanvas(w, h), g = c.getContext('2d'), clear = g.clearRect.bind(g)
    g.clearRect = (x, y, w, h) => { paints++; clear(x, y, w, h) }
    const canvas = c as unknown as Surface, entry = { canvas, restore: undefined as (() => void) | undefined }
    Object.assign(c, { addEventListener: (type: string, f: () => void) => { if (type === 'contextrestored') entry.restore = f } })
    stores.push(entry)
    return canvas
  })
  const scope = new SurfaceScope('test-city', ledger), sky = new BridgeCanvasSky(scope), atmo = new BridgeAtmosphere()
  const width = 660, height = 460, dst = createCanvas(width, height), ctx = dst.getContext('2d')
  const cam = { x: 832, y: -135, zoom: 1.14 }, weather = { time: 9, drift: 0, cover: .25, haze: .46, flash: 0 }
  const draw = (x: number, haze = weather.haze, painter = sky) => {
    atmo.update(null, { ...cam, x }, width, height, 42, 0.5, { ...weather, haze })
    ctx.clearRect(0, 0, width, height)
    painter.city(ctx as unknown as CanvasRenderingContext2D, atmo, width, height)
    return dst.toBuffer('image/png')
  }
  // Image is unavailable in this fixture: the procedural source gets the
  // same retention contract as an admitted WebP without requiring a DOM.
  const first = draw(cam.x)
  assert.equal(paints, 2)
  assert.deepEqual(draw(cam.x), first)
  assert.notDeepEqual(draw(cam.x + 360), first, 'reusing the card must not freeze parallax')
  assert.equal(paints, 2)
  const fogged = draw(cam.x, .91)
  assert.notDeepEqual(fogged, first)
  assert.equal(paints, 4)
  stores[0].restore?.()
  assert.deepEqual(draw(cam.x, .91), fogged)
  assert.equal(paints, 5, 'one empty restored backing should repaint')
  scope.releaseAll()
  assert.equal(ledger.stats().surfaces, 0)
  const denied = new CanvasLedger(() => { throw new Error('budget refused optional card') }, { maxBytes: 0 })
  const bare = new BridgeCanvasSky(new SurfaceScope('test-city-denied', denied))
  draw(cam.x, .91, bare)
  assert.ok(ctx.getImageData(0, 0, width, height).data.some((v, i) => i % 4 === 3 && v > 30), 'budget denial must keep the skyline')
  assert.equal(denied.stats().surfaces, 0)
})

test('interrupted and restored sky backing repaints at the same fixed clock', () => {
  let uploads = 0, fail = true, restoreBank: (() => void) | undefined
  const ledger = new CanvasLedger((w, h) => {
    const canvas = createCanvas(w, h)
    if (w === 192) {
      const g = canvas.getContext('2d'), put = g.putImageData.bind(g)
      g.putImageData = (im, x, y) => {
        uploads++
        if (fail) throw new Error('interrupted bank upload')
        put(im, x, y)
      }
      Object.assign(canvas, { addEventListener: (type: string, f: () => void) => { if (type === 'contextrestored') restoreBank = f } })
    }
    return canvas as unknown as Surface
  })
  const scope = new SurfaceScope('test-sky', ledger), sky = new BridgeCanvasSky(scope), atmo = new BridgeAtmosphere()
  const dst = createCanvas(440, 260), g = dst.getContext('2d')
  atmo.update(null, { x: 153, y: -100, zoom: 1 }, dst.width, dst.height, 42, .55, { time: 3, drift: 6, cover: .45, haze: .27, flash: 0 })
  const draw = () => sky.draw(g as unknown as CanvasRenderingContext2D, atmo, dst.width, dst.height)
  assert.throws(draw, /interrupted bank upload/)
  fail = false; draw()
  const skyRGB = Array.from(g.getImageData(200, 65, 1, 1).data.slice(0, 3))
  assert.notDeepEqual(skyRGB, [22, 25, 28], 'a failed paint must not stamp the underpaint as ready')
  draw(); assert.equal(uploads, 2)
  assert.ok(restoreBank)
  restoreBank(); draw(); assert.equal(uploads, 3)
  assert.deepEqual(Array.from(g.getImageData(200, 65, 1, 1).data.slice(0, 3)), skyRGB)
  scope.releaseAll(); assert.equal(ledger.stats().surfaces, 0)
})

test('practical receivers retain separate spectra and directions, unless a real section occludes one', () => {
  const lamp = (x: number, rgb: LightPoint['rgb']): LightPoint => ({ x, y: -105, reach: 260, physicalRadius: 5, strength: 2.1,
    color: '#ffffff', kelvin: 4200, rgb, kind: 'bulb', axisX: 0, axisY: 1, coneCos: 0, halfWidth: 0, z: 5.5 })
  const near = [lamp(-71, [1, .16, .025]), lamp(105, [.05, .32, 1])], out = newFixtureLobes()
  sampleFixturePair(near, [], 0, -50, 0, out)
  const [hot, cold] = out
  assert.ok(hot.dx < -.46 && hot.dy < -.3 && hot.r > hot.b * 8 && hot.strength > .2)
  assert.ok(cold.dx > .6 && cold.dz > .4 && cold.b > cold.r * 8 && cold.strength > .18)
  const c = createCanvas(46, 24), ctx = c.getContext('2d')
  ctx.fillStyle = localLightBrush(ctx as unknown as CanvasRenderingContext2D, hot, 1, 23, 12, 23, 15, .7)!
  ctx.fillRect(0, 0, 46, 24)
  const sample = (x: number) => ctx.getImageData(x, 10, 1, 1).data[3]
  assert.ok(sample(3) > sample(43) * 4, 'incidence must have an unlit side')
  sampleFixturePair(near, [{ left: -45, right: -31, top: -144, bottom: -35, kind: 'jamb' }], 0, -50, 0, out)
  assert.ok(out[0].dx > .6 && out[1].strength === 0, 'occluder did not suppress the matched warm source')
  sampleFixturePair(near, [], 410, -50, 0, out)
  assert.ok(out.every(l => !l.strength), 'fixture exceeded its finite reach')
})

test('seeded prop outlines, mask pixels and strike boundaries match for every variant', () => {
  const g = createCanvas(84, 84).getContext('2d'), variants = new Set(Array.from({ length: 128 }, (_, n) => propVariant(Math.imul(n, 0x9e3779b1))))
  assert.deepEqual([...variants].sort(), [0, 1, 2])
  for (const kind of BRIDGE_PROP_KINDS) {
    const signatures = new Set<string>()
    for (const v of variants) {
      const s = routePropShape(kind, v), x = 42, foot = 78
      signatures.add(`${s.half}×${s.height}`)
      g.resetTransform(); g.clearRect(0, 0, 84, 84); g.translate(x, foot)
      traceRouteProp(g as unknown as CanvasRenderingContext2D, s); g.fill()
      const line = (from: number, to: number, y: number) => ({ bx: from, by: y, tx: to, ty: y })
      assert.ok(hitsRouteProp(s, x, line(x - 70, x + 70, -s.height * .7)))
      assert.ok(!hitsRouteProp(s, x, line(x - 70, x + 70, -s.height - .5)))
      assert.ok(!hitsRouteProp(s, x, line(x + s.half + .2, x + 80, -s.height * .5)))
      for (let y = 0; y < foot + 2; y += 2) for (let u = 10; u < 75; u += 2) {
        const a = g.getImageData(u, y, 1, 1).data[3]
        if (a <= 5 || a >= 250) assert.equal(hitsRouteProp(s, x, line(u + .5, u + .5, y + .5 - foot)), a >= 250)
      }
    }
    assert.equal(signatures.size, 3)
  }
})

test('runoff drains after a shower and gust/travel samples do not depend on batch size', () => {
  const route = new BridgeRoute(8), a = new RouteWeather(route), b = new RouteWeather(route)
  a.advance(1560, 1)
  for (let i = 0; i < 390; i++) b.advance(4, 1)
  assert.deepEqual([a.runoff, a.rainTime, a.gustAt(409), a.clock.sample], [b.runoff, b.rainTime, b.gustAt(409), b.clock.sample])
  const starting = a.runoff
  // Force a calm interval without waiting for another indexed front.
  const sample = a.clock.sample as { rain: number }
  sample.rain = 0
  a.advance(122, 1)
  assert.ok(a.runoff < starting && a.runoff > starting * .6, 'eave should keep draining in clear air')
  for (let look = 0; look <= 3; look += .2) assert.equal(bridgePrecipitation(0, look), 0)
  assert.ok(bridgeRetention(.54, 2) > bridgeRetention(.54, 1) && bridgeRetention(0, 3) === 0)
  let vents = 0
  for (const c of route.between(0, 20_000)) {
    const x = bridgeVentX(c)
    if (x === null) continue
    vents++
    assert.equal(x % 112, 46)
    assert.ok(x > c.left + 80 && x < c.right - 80 && !route.shelterAt(x, 58))
  }
  assert.ok(vents >= 4)
})

test('the Canvas sky publishes complete slices together but never defers a lightning change', () => {
  let uploads = 0
  const ledger = new CanvasLedger((w, h) => {
    const c = createCanvas(w, h), ctx = c.getContext('2d'), put = ctx.putImageData.bind(ctx)
    if (w === 192) ctx.putImageData = (im, x, y) => { uploads++; put(im, x, y) }
    return c as unknown as Surface
  })
  const scope = new SurfaceScope('test-sliced-bank', ledger), sky = new BridgeCanvasSky(scope)
  const w = 480, h = 270, sample = createCanvas(w, h)
  const a = new BridgeAtmosphere(), cam = { x: 31, y: -90, zoom: 1 }, time = { time: 6, drift: 0, cover: .55, haze: .27, flash: 0 }
  const draw = (painter: BridgeCanvasSky) => {
    painter.draw(sample.getContext('2d') as unknown as CanvasRenderingContext2D, a, w, h)
    return sample.toBuffer('image/png')
  }
  a.update(null, cam, w, h, 42, .1, time)
  const first = draw(sky)
  a.update(null, cam, w, h, 42, .1, { ...time, time: 6.3, drift: 3 })
  for (let frame = 0; frame < 3; frame++) assert.deepEqual(draw(sky), first, 'a partial bank must not publish')
  assert.equal(uploads, 1)
  const settled = draw(sky)
  assert.notDeepEqual(settled, first)
  assert.equal(uploads, 2)
  const ref = new SurfaceScope('test-bank-reference', ledger)
  assert.deepEqual(draw(new BridgeCanvasSky(ref)), settled, 'stripes share the original optical pose')
  a.update(null, cam, w, h, 42, .1, { ...time, time: 6.4, drift: 4, flash: .8 })
  assert.notDeepEqual(draw(sky), settled)
  assert.equal(uploads, 4, 'the flash frame itself must publish')
  scope.releaseAll(); ref.releaseAll()
  assert.equal(ledger.stats().surfaces, 0)
})


test('the Canvas backdrop scissor is inside the opaque road at all rolled viewport edges', () => {
  for (const [w, h] of [[480, 290], [1180, 660], [400, 844]]) for (const rot of [-.10, 0, .085]) {
    const cam = { x: 1550, y: -124, zoom: 1.12, rot }, band = opaqueRoadBand(cam, w, h)
    assert.ok(band, `expected interior at ${w}x${h}, roll ${rot}`)
    for (const x of [0, w]) for (const y of band) {
      const worldY = ((y - h / 2) * Math.cos(rot) - (x - w / 2) * Math.sin(rot)) / cam.zoom + cam.y
      assert.ok(worldY > ROAD_PLATE_TOP + 2 && worldY < ROAD.soffit - 2, `unsafe band: ${w}x${h} at ${rot}`)
    }
  }
  assert.equal(opaqueRoadBand({ x: 0, y: -124, zoom: 1.12, rot: 1.2 }, 1180, 660), null)
})


test('wait for paced complete world frames and a paint opportunity after the last submit', () => {
  const pace = new OpeningPace()
  pace.submitted(30)
  assert.ok(!pace.ready(46), 'a first submit does not reveal')
  assert.ok(!pace.ready(62), 'idle rAFs are not frames')
  pace.submitted(62); pace.submitted(78)
  assert.ok(!pace.ready(78), 'same-turn publication is not a paint opportunity')
  assert.ok(pace.ready(94))
  assert.ok(!pace.ready(78 + OPENING_MAX_GAP_MS + 1), 'a hitch right after submit restores the gate')
  pace.submitted(400); pace.submitted(430); pace.submitted(460)
  assert.ok(pace.ready(477))
  pace.reset() // visibility, backing change, or render failure
  assert.ok(!pace.ready(494))
  pace.submitted(500); pace.submitted(516); pace.submitted(700); pace.submitted(716)
  assert.ok(!pace.ready(732), 'one fresh interval after a stall is not sufficient')
})


test('opening waits for the authored glazing decode and can re-request an abandoned transfer', async () => {
  class DecodingImage {
    src = ''
    naturalWidth = GLASS_ENV_W
    naturalHeight = GLASS_ATLAS_H
    removed = false
    completeDecode!: () => void
    decode(): Promise<void> {
      return new Promise(resolve => { this.completeDecode = resolve; requests.set(this.src, this) })
    }
    removeAttribute(attribute: string) { assert.equal(attribute, 'src'); this.removed = true }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Image'), requests = new Map<string, DecodingImage>()
  const glass = `/bridge/${GLASS_PLATE}.webp`
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: DecodingImage })
  try {
    assert.ok(!bridgeOpeningPlatesSettled())
    const abandoned = requests.get(glass)!
    assert.ok(abandoned)
    for (const [name, image] of requests) if (name !== glass) image.completeDecode()
    await Promise.resolve()
    assert.ok(!bridgeOpeningPlatesSettled(), 'all other plates are ready; glass still holds')
    assert.equal(bridgePlate(GLASS_PLATE), null)
    discardPendingBridgePlates()
    assert.ok(abandoned.removed)
    assert.ok(!bridgeOpeningPlatesSettled())
    const active = requests.get(glass)!
    assert.notEqual(active, abandoned)
    abandoned.completeDecode()
    await Promise.resolve()
    assert.ok(!bridgeOpeningPlatesSettled(), 'obsolete decode does not ready a newer request')
    active.completeDecode()
    await Promise.resolve()
    assert.ok(bridgeOpeningPlatesSettled())
    assert.equal(bridgePlate(GLASS_PLATE), active)
  } finally {
    if (original) Object.defineProperty(globalThis, 'Image', original)
    else Reflect.deleteProperty(globalThis, 'Image')
  }
})
