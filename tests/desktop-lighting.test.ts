import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { DesktopCadence, QualityLadder } from '../src/game/render/quality'
import { volumeBrush } from '../src/game/lighting/volume'

const withCanvas = (fn: () => void) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => createCanvas(1, 1) },
  })
  try {
    fn()
  } finally {
    if (old) Object.defineProperty(globalThis, 'document', old)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}
test('a sixty-Hz display never chases 120; sustained short intervals earn the faster budget', () => {
  const c = new DesktopCadence()
  for (let i = 0; i < 180; i++)
    assert.equal(c.observe(i % 7 ? 16.67 : 8.33), 60)
  for (let i = 0; i < 30; i++) c.observe(8.33)
  assert.equal(c.target, 120)
  for (let i = 0; i < 800; i++) c.observe(16.67)
  assert.equal(c.target, 60)
  const high = new QualityLadder('ultra', { windowSec: 0.2 }),
    normal = new QualityLadder('ultra', { windowSec: 0.2 })
  for (let i = 0; i < 18; i++) {
    high.frame(13, 0.013, 120)
    normal.frame(13, 0.013)
  }
  assert.equal(high.current, 'high')
  assert.equal(normal.current, 'ultra')
})
test('helmet normal tile moves its highlight with light direction, leaving the paint mask unchanged', () =>
  withCanvas(() => {
    const c = createCanvas(64, 64),
      ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D
    const render = (dx: number) => {
      ctx.clearRect(0, 0, 64, 64)
      ctx.fillStyle = volumeBrush(
        ctx,
        '#707070',
        { volume: true, r: 1, g: 1, b: 1, dx, dy: 0.38, keyX: 0, keyGain: 0 },
        1,
        32,
        32,
        22,
        22,
        0,
        false,
        '#707070',
      )
      ctx.beginPath()
      ctx.arc(32, 32, 22, 0, 2 * Math.PI)
      ctx.fill()
      return ctx.getImageData(0, 0, 64, 64).data
    }
    const left = render(-1),
      right = render(1),
      px = (32 * 64 + 46) * 4
    assert.ok(right[px] > left[px] + 20)
    assert.equal(right[3], 0)
  }))
