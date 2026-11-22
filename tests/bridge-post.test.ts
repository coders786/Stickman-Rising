import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { bakeBridgeLensAtlas, bridgeTrailTint } from '../src/game/render/bridge-post'
import { BLOOM_DIVISORS, BLOOM_TARGET_DIVISORS, bloomSize } from '../src/gpu/bridge-bloom'

test('the HDR blur budget stays small even on an odd portrait backing', () => {
  const old = [2, 4, 8, 16, 2, 4, 8]
  const area = (w: number, h: number, steps: readonly number[]) => steps.reduce((sum, d) => {
    const [x, y] = bloomSize(w, h, d)
    return sum + x * y
  }, 0)
  for (const [w, h] of [[1920, 1080], [1081, 1921], [701, 443]]) {
    // Same bytes/pixel on a half-float-only device. Packed blur halves it again.
    assert.ok(area(w, h, BLOOM_DIVISORS) / area(w, h, old) < .13)
    assert.ok(area(w, h, BLOOM_TARGET_DIVISORS) / area(w, h, old) < .23)
  }
  assert.deepEqual(BLOOM_DIVISORS.map(d => bloomSize(7, 1, d)), [[2, 1], [1, 1], [1, 1]])
})

test('lens atlas keeps the bloom centered and the motion core ahead of a feathered tail', () => {
  const g = createCanvas(448, 88).getContext('2d')
  bakeBridgeLensAtlas(g as unknown as CanvasRenderingContext2D)
  const { data } = g.getImageData(0, 0, 448, 88)
  const pixel = (x: number, y: number) => Array.from(data.subarray(4 * (y * 448 + x), 4 * (y * 448 + x) + 4))
  const alpha = (x: number, y: number) => pixel(x, y)[3]
  const amber = bridgeTrailTint('#cc8e4b') * 64, mercury = bridgeTrailTint('#869eb3') * 64
  assert.notEqual(amber, mercury)
  assert.equal(bridgeTrailTint('#fff'), bridgeTrailTint('#dddddd'))
  assert.ok(alpha(amber + 32, 32) > 240 && alpha(amber + 19, 32) > alpha(amber + 5, 32))
  assert.ok(pixel(amber + 32, 32)[0] > pixel(amber + 32, 32)[2])
  assert.ok(pixel(mercury + 32, 32)[2] > pixel(mercury + 32, 32)[0])
  assert.equal(alpha(amber, 0), 0)
  assert.ok(alpha(57, 76) > 175 && alpha(57, 76) > 4 * alpha(11, 76))
  assert.ok(alpha(57, 76) > 9 * alpha(57, 64))
  assert.equal(alpha(416, 29), 0, 'no extra fog across the fighter at the center')
  assert.ok(alpha(384, 0) > 33, 'broad gloom toward the edge')
})
