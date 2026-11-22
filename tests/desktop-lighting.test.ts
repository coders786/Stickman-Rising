import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { disposeVolumeBrushes, volumeBrush } from '../src/game/lighting/volume'
import { gameLedger } from '../src/game/render/ledger'

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
    disposeVolumeBrushes(ctx)
  }))


test('normal brush staging is released with its output context, not another owner', () =>
  withCanvas(() => {
    const a = createCanvas(64, 64).getContext('2d') as unknown as CanvasRenderingContext2D
    const b = createCanvas(64, 64).getContext('2d') as unknown as CanvasRenderingContext2D
    const staging = () => gameLedger.list().filter(e => e.tag === 'lighting')
    const brush = (ctx: CanvasRenderingContext2D) => volumeBrush(ctx, '#707070',
      { volume: true, r: 1, g: 1, b: 1, dx: 1, dy: 0.38, keyX: 0, keyGain: 0 },
      1, 32, 32, 22, 22, 0, false, '#707070')
    try {
      assert.notEqual(brush(a), '#707070')
      const plateA = staging()[0]?.key
      assert.ok(plateA)
      const patternB = brush(b)
      assert.notEqual(patternB, '#707070')
      assert.equal(staging().length, 2)
      disposeVolumeBrushes(a)
      assert.equal(staging().length, 1)
      assert.notEqual(staging()[0].key, plateA)
      assert.equal(brush(b), patternB, 'remaining owner still uses its original pattern')
    } finally {
      disposeVolumeBrushes(a)
      disposeVolumeBrushes(b)
    }
    assert.equal(staging().length, 0)
  }))
