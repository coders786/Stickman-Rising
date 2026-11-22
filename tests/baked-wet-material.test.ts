import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { gameLedger } from '../src/game/render/ledger'
import { ROAD } from '../src/game/stage/road-section'
import { fixtureMirrorY, sampleWetFixture } from '../src/game/stage/sheet-water'
import { Viaduct } from '../src/game/stage/viaduct'
import { ART_GRADES, BRIDGE_ART, STATION_ART } from '../src/game/world/art-grade'
import { CyberBackground } from '../src/game/world/background'

const target = (w: number, h: number) => {
  const c = createCanvas(w, h)
  return { c: c as unknown as HTMLCanvasElement, g: c.getContext('2d') as unknown as CanvasRenderingContext2D }
}
function withDocument(run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => createCanvas(1, 1) } })
  try { run() } finally {
    gameLedger.releaseAll()
    if (original) Object.defineProperty(globalThis, 'document', original)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}
const asphalt = ART_GRADES['deep-noir']
const deck = BRIDGE_ART.finish!.deck

test('the baked fixture image reverses height, anchors to world x and leaves the deck edge dry', () => {
  const { g } = target(32, 68)
  g.fillStyle = '#fa6448'; g.fillRect(0, 0, 32, 12)
  g.fillStyle = '#5297ee'; g.fillRect(0, 56, 32, 12)
  const fixture = { left: 207, image: g.getImageData(0, 0, 32, 68) }
  const sample = (x: number, y: number) => {
    const out = new Float64Array(4)
    sampleWetFixture(fixture, x, y, 0, out)
    return [...out]
  }
  assert.deepEqual(sample(222, fixtureMirrorY(62)), [250, 100, 72, 1])
  assert.deepEqual(sample(222, fixtureMirrorY(6)), [82, 151, 238, 1])
  assert.ok(fixtureMirrorY(62) > fixtureMirrorY(6))
  assert.deepEqual(sample(175, fixtureMirrorY(62)), [0, 0, 0, 0])
  assert.deepEqual(sample(222, ROAD.front), [0, 0, 0, 0])

  const bake = (withFixture: boolean) => {
    const span = new Viaduct(42, 0, 480, asphalt.palette, target, asphalt.asphalt, deck, undefined, withFixture ? [fixture] : [])
    const { g } = target(480, 140)
    g.translate(0, -ROAD.rear)
    span.drawRoad(g, 0, 480)
    return g.getImageData(0, 0, 480, 140).data
  }
  const off = bake(false), on = bake(true)
  let changed = 0
  for (let k = 0; k < off.length; k += 4) {
    if (on[k] === off[k] && on[k + 1] === off[k + 1] && on[k + 2] === off[k + 2]) continue
    const x = (k / 4) % 480, y = Math.floor(k / (4 * 480)) + ROAD.rear
    assert.ok(x >= 200 && x < 246 && y >= ROAD.rear && y < ROAD.front, `baked mirror leaked at ${x},${y}`)
    changed++
  }
  assert.ok(changed > 60, 'there is no recognizable image in the baked receiver')
})

test('authored wet and dry materials never allocate or paint a live scene mirror', () => withDocument(() => {
  const view = { x: 1400, y: -90, zoom: 1.04, rot: .06 }, { g } = target(400, 280)
  for (const art of [BRIDGE_ART, STATION_ART]) {
    const bg = new CyberBackground('ultra', undefined, art)
    bg.resize(400, 280); bg.setRunSeed(42)
    bg.drawSky(g, view)
    assert.equal(bg.hasWetSurface(), art === BRIDGE_ART)
    const stats = gameLedger.stats()
    const draw = g.drawImage
    g.drawImage = () => { throw new Error('an authored receiver tried to blend a live mirror') }
    try {
      for (const forward of [true, false]) bg.drawReflections(g, view, 'ultra', forward)
    } finally { g.drawImage = draw }
    assert.equal(gameLedger.stats().acquired, stats.acquired)
    assert.ok(gameLedger.list().every(e => !['refl', 'water-relay', 'vignette', 'practical-work'].includes(e.tag)))
    bg.dispose()
    assert.deepEqual(gameLedger.list(), [])
  }
}))

test('screen-row rejection preserves sky and slab pixels under pan, roll and edge exposure', () => withDocument(() => {
  const w = 416, h = 288, scale = 2.25
  for (const art of [BRIDGE_ART, STATION_ART]) {
    const bg = new CyberBackground('ultra', undefined, art)
    bg.resize(w, h); bg.setRunSeed(42)
    for (const [x, y, zoom, rot] of [[830.3, -76.11, 1.021, .012], [15, -118, 1.2, -.047], [-1090, -78, 1.03, .028], [900, -512, 1.15, 0]]) {
      const cam = { x, y, zoom, rot }
      const paint = (rejectRows: boolean) => {
        const { g } = target(w * scale, h * scale)
        g.setTransform(scale, 0, 0, scale, 0, 0)
        bg.drawSky(g, cam, rejectRows ? cam : undefined)
        g.translate(w / 2, h / 2); g.rotate(rot); g.scale(zoom, zoom); g.translate(-x, -y)
        bg.drawArena(g, true, cam)
        return g.getImageData(0, 0, w * scale, h * scale).data
      }
      const cropped = paint(true), full = paint(false)
      let rounding = 0, largest = 0
      for (let i = 0; i < full.length; i++) {
        const delta = Math.abs(cropped[i] - full[i])
        if (delta && i % 4 === 3) assert.fail('a clipped edge exposed transparency')
        rounding += Number(delta > 0)
        largest = Math.max(largest, delta)
      }
      // Fractional clip boundaries can round an 8-bit colour by one step.
      assert.ok(largest <= 1 && rounding <= 32, `${art.grade}: culling changed visible pixels at ${x},${y}`)
    }
    bg.dispose()
  }
}))
