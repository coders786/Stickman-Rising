import { Ribbon, DECK_W, DECK_H } from '../src/game/lighting/ribbons'
import { makeStageLights } from '../src/game/world/lightfield'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { CyberBackground } from '../src/game/world/background'

function withCanvasDocument(run: () => void): void {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement: () => createCanvas(1, 1) },
  })
  try { run() } finally {
    if (old) Object.defineProperty(globalThis, 'document', old)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

test('fractional skyline and parallax joins never open a transparent screen row', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra')
  bg.setRunSeed(543)
  for (const [w, h, x, y, zoom] of [[640, 360, 0, -95.47, 0.91], [320, 740, 6826.5, -60.8, 1.16]]) {
    bg.resize(w, h)
    const g = createCanvas(w, h).getContext('2d')
    bg.drawSky(g as unknown as CanvasRenderingContext2D, { x, y, zoom })
    const data = g.getImageData(0, 0, w, h).data
    for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255, `alpha at pixel ${(i - 3) / 4}`)
  }
}))

test('capture reflection follows the rolled lane without spilling beyond the span or deck', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra')
  const w = 480, h = 280, g = createCanvas(w * 2, h * 2).getContext('2d')
  const ctx = g as unknown as CanvasRenderingContext2D
  bg.resize(w, h)
  g.scale(2, 2)
  for (const rot of [0, 0.06, -0.06]) {
    // Put the span's left end at screen centre. Red in the source means
    // we can distinguish mirror pixels from both black deck and sky glitter.
    const cam = { x: -1174, y: 0, zoom: 1, rot }
    const lanePixel = (localX: number, localY: number) => g.getImageData(
      Math.round(2 * (w / 2 + localX * Math.cos(rot) - localY * Math.sin(rot))),
      Math.round(2 * (h / 2 + localX * Math.sin(rot) + localY * Math.cos(rot))), 1, 1,
    ).data[0]
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    g.save()
    g.translate(w / 2, h / 2)
    g.rotate(rot)
    g.fillStyle = '#f00'
    g.fillRect(-w, -h, 2 * w, h)
    g.restore()
    bg.drawReflections(ctx, cam, 'ultra', false)
    assert.ok(lanePixel(160, 5) > 15, `reflection detached from lane at roll ${rot}`)
    assert.equal(lanePixel(-100, 15), 0, 'reflection escaped the span')
    assert.equal(lanePixel(160, 54), 0, 'reflection escaped across the front girder')
  }
}))

test('the city light bake has no luminous bottom row to turn into a horizon strip', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra')
  bg.warm()
  const { cityGlow: plate } = bg as unknown as { cityGlow: ReturnType<typeof createCanvas> }
  const g = plate.getContext('2d')
  const bottom = g.getImageData(0, plate.height - 1, plate.width, 1).data
  const core = g.getImageData(0, Math.floor(plate.height * .75), plate.width, 1).data
  for (let i = 3; i < bottom.length; i += 4) assert.equal(bottom[i], 0)
  assert.ok(core.some((v, i) => i % 4 === 3 && v > 20), 'feathering must not remove the body of the glow')
}))

test('a vertical reflection remains horizontally continuous through the wet deck', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra')
  const w = 420, h = 280, g = createCanvas(w, h).getContext('2d')
  bg.resize(w, h)
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#f00'; g.fillRect(210, 50, 12, 90)
  bg.drawReflections(g as unknown as CanvasRenderingContext2D, { x: 900, y: 0, zoom: 1 }, 'ultra', false)
  const centroid = (y: number) => {
    const row = g.getImageData(203, y, 26, 1).data
    let sum = 0, weighted = 0
    for (let x = 0; x < 26; x++) { sum += row[x * 4]; weighted += x * row[x * 4] }
    assert.ok(sum > 30, `reflection has a blank row at ${y}`)
    return weighted / sum
  }
  const base = centroid(147)
  for (let y = 148; y <= 176; y++) assert.ok(Math.abs(centroid(y) - base) < 1, `lateral seam at row ${y}`)
}))


test('practical light atlas fades to zero at both asphalt boundaries', () => {
  const [, lamp] = makeStageLights(null, 52, true)
  const pixels = new Uint8ClampedArray(DECK_W * DECK_H * 4)
  new Ribbon(lamp, [], 10).bakeDeck(pixels, 0)
  for (let x = 0; x < DECK_W; x++) {
    assert.equal(pixels[x * 4 + 3], 0)
    assert.equal(pixels[((DECK_H - 1) * DECK_W + x) * 4 + 3], 0)
  }
  assert.ok(pixels.some((v, i) => i % 4 === 3 && v > 0), 'lamp must still illuminate the deck')
})
