import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { FX } from '../src/game/fx/fx'
import { PostStack } from '../src/game/render/post'

const cam = { x: 0, y: 0, offX: 0, offY: 0, rot: 0, zoom: 1 }
function pixels(fx: FX) {
  const g = createCanvas(160, 100).getContext('2d')
  g.fillStyle = '#808080'
  g.fillRect(0, 0, 160, 100)
  fx.drawImpactFocus(g as unknown as CanvasRenderingContext2D, 160, 100, cam)
  return [g.getImageData(1, 1, 1, 1).data[0], g.getImageData(80, 50, 1, 1).data[0]]
}

test('ordinary impacts are local; an accepted beat darkens only the periphery and expires through hitstop', () => {
  const fx = new FX()
  for (const heavy of [true, false]) fx.impact(0, 0, 1, heavy, '#ffffff', '#ffaa00')
  assert.deepEqual(pixels(fx), [128, 128])
  assert.equal(fx.flashAlpha, 0)
  assert.ok(fx.impactFrame(0, 0, '#fff', 'guardBreak'))
  fx.update(0, 0.08)
  const [corner, centre] = pixels(fx)
  assert.ok(corner >= 100 && corner < 120)
  assert.equal(centre, 128)
  assert.equal(fx.impactFrame(0, 0, '#fff', 'perfectParry'), false)
  fx.update(0, 0.1)
  assert.deepEqual(pixels(fx), [128, 128])
  assert.equal(fx.flashAlpha, 0)
  assert.equal(fx.impactFrame(0, 0, '#fff', 'execution'), false)
  fx.update(0, 1.5)
  assert.ok(fx.impactFrame(0, 0, '#fff', 'execution'))
})

test('disabling screen accents cancels an active beat and still permits local FX', () => {
  const fx = new FX()
  fx.impactFrame(0, 0, '#fff', 'bossDefeat')
  fx.update(0, 0.08)
  fx.setScreenStrength(0)
  fx.screenFlash('#fff', 0.8)
  assert.equal(fx.flashAlpha, 0)
  assert.deepEqual(pixels(fx), [128, 128])
  fx.clear()
  assert.equal(fx.impactFrame(0, 0, '#fff', 'guardBreak'), false)
  fx.setScreenStrength(1)
  assert.ok(fx.impactFrame(0, 0, '#fff', 'guardBreak'))
})

test('Ultra lens stamps share the emitter budget, and disappear without a source', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => createCanvas(1, 1) },
  })
  try {
    const ctx = createCanvas(360, 160).getContext('2d') as unknown as CanvasRenderingContext2D
    const post = new PostStack()
    post.compose(
      ctx,
      360,
      160,
      [
        [20, 60, 1],
        [80, 60, 0.9],
        [120, 60, 1],
      ],
      0.2,
      1,
    )
    assert.equal(post.lastLensBlits, 2)
    assert.equal(post.lastRayBlits, 8)
    post.compose(ctx, 360, 160, [], 0.2, 1)
    assert.equal(post.lastLensBlits, 0)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
