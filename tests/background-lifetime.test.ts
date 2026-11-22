import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { DECK_H, DECK_W } from '../src/game/lighting/ribbons'
import { gameLedger } from '../src/game/render/ledger'
import { BRIDGE_ART } from '../src/game/world/art-grade'
import { CyberBackground } from '../src/game/world/background'

const cleanBridge = { ...BRIDGE_ART, clean: true }
const cam = { x: 1460, y: -148, zoom: 1.04 }

async function withCanvases(run: () => void | Promise<void>, create = () => createCanvas(1, 1)): Promise<void> {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement: create },
  })
  try { await run() } finally {
    gameLedger.releaseAll()
    if (old) Object.defineProperty(globalThis, 'document', old)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

test('a resized viewport has one vignette, including when it returns to its original size', () => withCanvases(() => {
  const bg = new CyberBackground('high', undefined, { clean: true })
  bg.setRunSeed(42)
  bg.warm()
  const out = createCanvas(1280, 720).getContext('2d')
  const ctx = out as unknown as CanvasRenderingContext2D
  const draw = (w: number, h: number) => {
    bg.resize(w, h)
    bg.drawWeather(ctx, cam)
  }
  draw(1280, 720)
  const start = gameLedger.stats()
  for (let i = 0; i < 20; i++) {
    draw(1360, 760)
    draw(390, 844)
    draw(1280, 720)
  }
  const end = gameLedger.stats()
  assert.equal(end.surfaces, start.surfaces, 'resizing kept old vignette canvases')
  assert.equal(end.bytes, start.bytes, 'returning to a size must also return to its backing-store cost')
  const paints = end.acquired
  draw(1280, 720)
  assert.equal(gameLedger.stats().acquired, paints, 'a same-size draw acquired a backing store')
}))

test('the first same-size reseed frame paints the new vignette without resize or a DPR change', () => withCanvases(() => {
  const bg = new CyberBackground('high', undefined, { clean: true })
  const w = 640, h = 360
  const g = createCanvas(w, h).getContext('2d')
  const ctx = g as unknown as CanvasRenderingContext2D
  const paintCorners = (scene: CyberBackground) => {
    g.clearRect(0, 0, w, h)
    scene.drawWeather(ctx, cam)
    return [...g.getImageData(0, h - 1, 1, 1).data]
  }
  bg.resize(w, h)
  bg.setRunSeed(42)
  assert.ok(paintCorners(bg)[3] > 10)
  bg.setRunSeed(43)
  bg.warm()
  const retry = paintCorners(bg)
  assert.ok(retry[3] > 10, 'the released 0×0 plate was not replaced')

  const fresh = new CyberBackground('high', undefined, { clean: true })
  fresh.resize(w, h)
  fresh.setRunSeed(43)
  assert.deepEqual(retry, paintCorners(fresh), 'the mask kept the previous seed recipe')
}))

test('the warmed city retains its small distant outputs, not their six full-size work canvases', () => withCanvases(() => {
  const bg = new CyberBackground('low', undefined, cleanBridge)
  bg.setRunSeed(42)
  bg.warm()
  const entries = gameLedger.list()
  // The near plane still needs its sharp 2048×480 image. The three other
  // planes draw at 1/8, 1/6 and 1/3 of their source scale respectively.
  assert.deepEqual(entries.filter(e => e.w === 2048 && [420, 480, 560].includes(e.h)).map(e => e.h), [480])
  for (const [w, h] of [[256, 53], [341, 80], [683, 187]]) {
    assert.ok(entries.some(e => e.w === w && e.h === h), `missing ${w}×${h} drawable band`)
  }
}))

test('a backing-only scale change keeps the CSS mask; a released mask is repainted', () => withCanvases(() => {
  const bg = new CyberBackground('high', undefined, { clean: true })
  const w = 320, h = 240
  bg.resize(w, h)
  bg.setRunSeed(42)
  const vignette = () => gameLedger.list().find(e => e.tag === 'vignette')!
  const paint = (scale: number) => {
    const ctx = createCanvas(w * scale, h * scale).getContext('2d')
    ctx.scale(scale, scale)
    bg.drawWeather(ctx as unknown as CanvasRenderingContext2D, cam)
    return [...ctx.getImageData(0, h * scale - 1, 1, 1).data]
  }
  const corner = paint(1)
  const plate = vignette(), before = gameLedger.stats()
  assert.ok(paint(1.25)[3] > 10)
  assert.deepEqual(vignette(), plate)
  assert.equal(gameLedger.stats().resized, before.resized)
  assert.equal(gameLedger.stats().acquired, before.acquired)
  gameLedger.release(plate.key)
  assert.deepEqual(paint(1), corner)
  bg.dispose()
  assert.equal(gameLedger.stats().surfaces, 0)
}))

test('a failed wrap blur releases the city work and the partial scene, and warm can retry', () => withCanvases(() => {
  const bg = new CyberBackground('high', undefined, cleanBridge)
  bg.setRunSeed(42)
  const acquire = gameLedger.acquire
  let work = 0
  gameLedger.acquire = function (...args: Parameters<typeof acquire>) {
    if (args[3] === 'city-scratch' && ++work === 2) throw new Error('failed city wrap allocation')
    return acquire.apply(this, args)
  }
  try {
    assert.throws(() => bg.warm(), /failed city wrap allocation/)
    assert.equal(gameLedger.stats().surfaces, 0, 'partial build retained a city or night surface')
  } finally {
    gameLedger.acquire = acquire
  }
  bg.warm()
  assert.ok(gameLedger.stats().surfaces > 0)
  assert.ok(gameLedger.list().every(e => e.tag !== 'city-scratch'))
  bg.dispose()
  assert.equal(gameLedger.stats().surfaces, 0)
}))

test('a failed optical transfer context releases the scratch surface and partial stage kit', () => withCanvases(() => {
  const bg = new CyberBackground('ultra', undefined, cleanBridge)
  bg.setRunSeed(42)
  const acquire = gameLedger.acquire
  gameLedger.acquire = function (...args: Parameters<typeof acquire>) {
    const canvas = acquire.apply(this, args)
    if (args[3] === 'practical-work' && args[1] === DECK_W && args[2] === DECK_H) {
      Object.defineProperty(canvas, 'getContext', { value: () => null })
    }
    return canvas
  }
  try {
    assert.throws(() => bg.warm(), /2D canvas context unavailable/)
    assert.equal(gameLedger.stats().surfaces, 0)
  } finally { gameLedger.acquire = acquire }
  bg.warm()
  assert.equal(gameLedger.list().filter(e => e.tag === 'stage-bake').length, 3)
  assert.ok(gameLedger.list().every(e => e.tag !== 'practical-work'))
  bg.dispose()
  assert.equal(gameLedger.stats().surfaces, 0)
}))

test('a second bridge can warm, reseed, and dispose without disturbing the first bridge', () => withCanvases(() => {
  const a = new CyberBackground('high', undefined, cleanBridge)
  const b = new CyberBackground('low', undefined, cleanBridge)
  a.setRunSeed(42)
  b.setRunSeed(317)
  const g = createCanvas(480, 270).getContext('2d')
  const ctx = g as unknown as CanvasRenderingContext2D
  function paint(bg: CyberBackground) {
    bg.resize(480, 270)
    g.clearRect(0, 0, 480, 270)
    bg.drawSky(ctx, cam)
    bg.drawReflections(ctx, cam, 'high')
    bg.drawWeather(ctx, cam)
    return Buffer.from(g.getImageData(0, 0, 480, 270).data)
  }
  const expected = paint(a), initial = gameLedger.stats()
  paint(b)
  b.setRunSeed(43)
  paint(b)
  assert.deepEqual(paint(a), expected)
  assert.equal(gameLedger.list().filter(e => e.tag === 'vignette').length, 0)
  b.dispose()
  assert.equal(gameLedger.stats().bytes, initial.bytes)
  assert.deepEqual(paint(a), expected)
  a.dispose()
  assert.equal(gameLedger.stats().bytes, 0)
}))


test('the title builds a complete Canvas 2D scene once, without probing WebGL', async () => {
  let glProbes = 0
  await withCanvases(() => {
    const title = new CyberBackground('low', undefined, cleanBridge)
    try {
      title.warmAttract()
      assert.equal(title.plateStats()?.note, 'Canvas 2D title')
      assert.equal(title.plateStats()?.starSource, 'cpu')
      const allocated = gameLedger.stats().acquired
      title.warmAttract()
      assert.equal(gameLedger.stats().acquired, allocated)
      assert.equal(glProbes, 0)
    } finally { title.dispose() }
    assert.equal(gameLedger.stats().surfaces, 0)
  }, () => {
    const canvas = createCanvas(1, 1), get = canvas.getContext.bind(canvas)
    canvas.getContext = (kind, options) => {
      if (String(kind) === 'webgl2') glProbes++
      return get(kind, options)
    }
    return canvas
  })
})

test('an unpublished night cannot mutate the current profile and cancellation drops only its plates', () => withCanvases(async () => {
  const bg = new CyberBackground('high', undefined, cleanBridge)
  bg.setRunSeed(42)
  bg.warm()
  const profile = bg.getProfile(), before = gameLedger.stats().bytes
  const cancelled = bg.createNightForSeed(44)!
  const abort = new AbortController()
  const pending = cancelled.warmDeferred(abort.signal)
  abort.abort()
  await pending
  assert.equal(bg.getProfile(), profile)
  assert.equal(gameLedger.stats().bytes, before)

  const night = bg.createNightForSeed(43)!
  await night.warmDeferred(new AbortController().signal)
  assert.equal(night.stats().moonSource, 'cpu')
  assert.equal(night.stats().starSource, 'cpu')
  assert.equal(bg.getProfile(), profile)
  const moon = night.moonPlate()!
  bg.setQuality('ultra') // tiers don't alter the immutable night recipe
  bg.setRunSeed(43, night)
  bg.warm()
  assert.equal(bg.getProfile(), night.profile)
  assert.equal(night.moonPlate(), moon)
  assert.equal(bg.createNightForSeed(43), null)
  assert.equal(gameLedger.list().filter(e => e.tag === 'night').length, 2)
  bg.dispose()
  assert.equal(moon.width, 0)
  assert.equal(gameLedger.stats().bytes, 0)
}))
