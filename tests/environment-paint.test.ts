import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { gameLedger } from '../src/game/render/ledger'
import { BRIDGE_CLIMATE, composeBridgeRun } from '../src/game/stage/run-layout'
import { ROAD } from '../src/game/stage/road-section'
import type { Viaduct } from '../src/game/stage/viaduct'
import { BRIDGE_ART } from '../src/game/world/art-grade'
import { CyberBackground } from '../src/game/world/background'
import { ExposedWeather, worldBounds } from '../src/game/world/exposed-weather'
import { EnvironmentFront } from '../src/game/world/fronts'

const seed = 8
const plan = composeBridgeRun(seed)
const camera = { x: 1257, y: -153, zoom: 1.08, rot: .075 }
const canvas2d = (g: unknown) => g as CanvasRenderingContext2D
const makeBg = () => new CyberBackground('low', undefined, BRIDGE_ART, 'combined-run')

function installLedgerDocument(run: () => void) {
  const doc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => createCanvas(1, 1) } })
  try { run() } finally {
    gameLedger.releaseAll()
    if (doc) Object.defineProperty(globalThis, 'document', doc)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

function rainProof(quiet: boolean, roll: number, w = 670, h = 520, zoom = camera.zoom, x = camera.x) {
  const screen = createCanvas(w, h), g = screen.getContext('2d')
  const f = new EnvironmentFront(seed, BRIDGE_CLIMATE)
  f.advance(1400); f.interpolate(1)
  const rain = new ExposedWeather(plan.exposure)
  rain.seed(seed)
  const view = worldBounds({ left: 0, right: 0, top: 0, bottom: 0 }, w, h, { ...camera, x, rot: roll, zoom })
  g.translate(w / 2, h / 2); g.rotate(roll); g.scale(zoom, zoom); g.translate(-x, -camera.y)
  rain.draw(canvas2d(g), f, view, 'ultra', quiet)
  const pixels = g.getImageData(0, 0, w, h).data
  const lit = [0, 0, 0]
  let leak = 0
  for (let i = 3; i < pixels.length; i += 4) {
    if (!pixels[i]) continue
    const p = Math.floor(i / 4), dx = p % w + .5 - w / 2, dy = Math.floor(p / w) + .5 - h / 2
    const wx = x + (dx * Math.cos(roll) + dy * Math.sin(roll)) / zoom
    const z = plan.exposure.at(wx)
    if (wx < z.left + 1.5 || wx > z.right - 1.5) continue // edge antialiasing
    if (z.access.precipitation === 0) leak++
    else lit[plan.exposure.exposed.indexOf(z)]++
  }
  return { lit, leak, ...rain.stats }
}

test('rain, runoff and splashes use both roof seams with a rolled camera', () => {
  for (const [rot, w, h, zoom] of [[-.11, 670, 520, 1.08], [.10, 390, 844, .83], [0, 670, 520, 1.08]]) {
    const a = rainProof(false, rot, w, h, zoom)
    assert.equal(a.leak, 0, JSON.stringify(a))
    assert.ok(a.lit[0] > 50 && a.lit[1] > 50 && a.streaks > 6 && a.openClips === 2, JSON.stringify(a))
    assert.ok(a.streaks <= 180 && a.splashes <= 14 && a.wetMarks <= 14)
  }
  const quiet = rainProof(true, camera.rot), full = rainProof(false, camera.rot)
  assert.equal(quiet.leak, 0)
  assert.equal(quiet.splashes, 0)
  assert.ok(quiet.streaks && quiet.streaks < full.streaks)
  const wide = rainProof(false, -.09, 1540, 460, .55, 1350)
  assert.equal(wide.leak, 0)
  assert.equal(wide.openClips, 3)
  assert.ok(wide.lit.every(n => n > 50), JSON.stringify(wide))
  assert.ok(wide.streaks <= 180 && wide.splashes <= 14 && wide.wetMarks <= 28)
})

test('zero precipitation and runoff submissions in a completely sheltered view', () => {
  const rain = new ExposedWeather(plan.exposure)
  rain.seed(seed)
  const f = new EnvironmentFront(seed, BRIDGE_CLIMATE)
  const g = canvas2d(createCanvas(280, 550).getContext('2d'))
  for (const { left, right } of plan.shelters) {
    rain.draw(g, f, { left: left + 1, right: right - 1, top: -505, bottom: 100 }, 'ultra', false)
    assert.deepEqual(rain.stats, { openClips: 0, streaks: 0, splashes: 0, wetMarks: 0 })
  }
})

for (const decline of [true, false]) {
  test(`city and both shelters survive optional bank ${decline ? 'denial' : 'context failure'}`, t => installLedgerDocument(() => {
    const ask = gameLedger.tryAcquire
    let attempts = 0
    const failed: { width: number; height: number }[] = []
    t.mock.method(gameLedger, 'tryAcquire', function (this: typeof gameLedger, ...args: Parameters<typeof ask>) {
      if (args[3] !== 'environment-optional-bank') return ask.apply(this, args)
      attempts++
      if (decline) return null
      const surface = ask.apply(this, args)!
      failed.push(surface)
      surface.getContext = () => null
      return surface
    })
    const bg = makeBg()
    bg.setRunSeed(seed); bg.warm()
    assert.equal(attempts, 1)
    assert.equal(bg.skyBackend?.(), 'city-decks')
    assert.ok(failed.every(({ width, height }) => width === 0 && height === 0))
    assert.ok(!gameLedger.list().some(s => s.tag === 'environment-optional-bank'))
    const w = 515, h = 393, g = createCanvas(w, h).getContext('2d')
    bg.resize(w, h)
    const paintSky = () => {
      bg.drawSky(canvas2d(g), camera)
      const data = g.getImageData(0, 0, w, h).data
      for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255)
      return createHash('sha256').update(data).digest('hex')
    }
    const opening = paintSky(), before = gameLedger.stats()
    bg.advanceActiveTicks?.(1200, 1)
    assert.notEqual(paintSky(), opening)
    assert.equal(gameLedger.stats().acquired, before.acquired)
    assert.equal(gameLedger.stats().resized, before.resized)
    bg.dispose()
    assert.deepEqual(gameLedger.list(), [])
  }))
}

test('paving, eaves and practicals share baked world positions and survive A/B/A reseeding', () => installLedgerDocument(() => {
  const bg = makeBg()
  const kit = () => gameLedger.list().filter(s => s.tag === 'stage-bake').map(({ key, w, h }) => `${key}:${w}×${h}`).sort()
  const capture = (x: number) => {
    const w = 520, h = 454, view = { x, y: -136, zoom: 1, rot: 0 }
    const g = createCanvas(w, h).getContext('2d')
    bg.resize(w, h); bg.drawSky(canvas2d(g), view, view)
    g.translate(w / 2 - x, h / 2 - view.y)
    bg.drawArena(canvas2d(g), true, view)
    return createHash('sha256').update(g.getImageData(0, 0, w, h).data).digest('hex')
  }
  const checkReceiver = () => {
    const { left, right, source } = bg.runLayout()!.shelters[0]
    const x = (left + right) >> 1
    // Verify the baked shelf itself is opaque across the seam, has a
    // different surface on either side, and still meets the same fascia.
    const street = (bg as unknown as { street: Viaduct }).street
    const sw = right - left + 24, g = createCanvas(sw, 140).getContext('2d')
    g.translate(12 - left, -ROAD.rear)
    street.drawRoad(canvas2d(g), left - 12, right + 12)
    for (const u of [11, 12, x - left + 12, right - left + 11, right - left + 12]) {
      assert.equal(g.getImageData(u, -ROAD.rear, 1, 1).data[3], 255)
      assert.equal(g.getImageData(u, ROAD.front - ROAD.rear + 1, 1, 1).data[3], 255)
    }
    const pixel = (u: number, y: number) => [...g.getImageData(u, y - ROAD.rear, 1, 1).data]
    assert.notDeepEqual(pixel(11, 0), pixel(12, 0))
    assert.notDeepEqual(pixel(right - left + 11, 0), pixel(right - left + 12, 0))
    const fascia = pixel(11, ROAD.front + 1), next = pixel(12, ROAD.front + 1)
    assert.ok(fascia.every((v, i) => Math.abs(v - next[i]) <= 2), 'fascia has a colour step under the eave')
    assert.equal(street.wetness(x, .65), 0)
    assert.ok(street.wetness(left - 1, .65) > 0)
    assert.equal(bg.lightAt(source.x + 24, -70).best?.id, source.id)
  }
  bg.setRunSeed(seed); bg.warm()
  checkReceiver()
  const a = capture(camera.x), fixed = kit(), identity = bg.runLayout(), start = gameLedger.stats()
  assert.equal(fixed.length, 5)
  for (const q of ['ultra', 'low'] as const) {
    bg.setReducedMotion(q === 'ultra'); bg.resize(390, 844); bg.setQuality(q)
    bg.advanceActiveTicks?.(5, .5)
    assert.equal(bg.runLayout(), identity)
    assert.deepEqual(kit(), fixed)
    assert.equal(gameLedger.stats().acquired, start.acquired)
  }
  bg.setRunSeed(42); bg.warm()
  assert.notDeepEqual(bg.runLayout()?.shelters, plan.shelters)
  assert.notEqual(capture(camera.x), a)
  checkReceiver()
  bg.setRunSeed(seed); bg.warm()
  assert.deepEqual(bg.runLayout(), plan)
  assert.equal(capture(camera.x), a)
  assert.deepEqual(kit(), fixed)
  bg.advanceActiveTicks?.(4, 1)
  const reused = bg.runLayout()
  bg.setRunSeed(seed)
  assert.equal(bg.runLayout(), reused)
  const wx = bg.weatherState()
  assert.ok(wx && 'tick' in wx)
  assert.equal(wx.tick, 0)
  assert.equal(bg.lightningI(), 0)
  assert.equal(bg.storm.rainScale, 0)
  assert.ok(bg.usesBakedOptics())
  assert.ok(gameLedger.list().every(s => !['refl', 'practical-work', 'city-work'].includes(s.tag)))
  bg.dispose()
  assert.deepEqual(gameLedger.list(), [])
}))

test('failed first shelter bake releases its partial kit and can be retried', () => installLedgerDocument(() => {
  const bg = makeBg()
  const acquire = gameLedger.acquire
  let built = 0
  gameLedger.acquire = function (...args: Parameters<typeof acquire>) {
    if (args[3] === 'stage-bake' && ++built === 5) throw new Error('shelter preparation failed')
    return acquire.apply(this, args)
  }
  try {
    assert.throws(() => bg.warm(), /shelter preparation failed/)
    assert.equal(gameLedger.stats().surfaces, 0)
  } finally { gameLedger.acquire = acquire }
  bg.warm()
  assert.equal(gameLedger.list().filter(e => e.tag === 'stage-bake').length, 5)
  bg.dispose()
  assert.equal(gameLedger.stats().surfaces, 0)
}))
