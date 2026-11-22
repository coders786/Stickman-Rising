import assert from 'node:assert/strict'
import test from 'node:test'
import { DROP_FRAMES, RECOVERY_FRAMES, RenderScaleControl } from '../src/game/render/render-scale'
import { featuresFor } from '../src/game/render/graphics'

const drive = (c: RenderScaleControl, ms: number, frames: number) => {
  const steps: number[] = []
  for (let i = 0; i < frames; i++) if (c.frame(ms)) steps.push(c.value)
  return steps
}

test('all four presets lock the backing under alternating high/low load', () => {
  for (const [preset, scale] of [['low', .75], ['medium', 1], ['high', 1.15], ['ultra', 1.25]] as const) {
    const c = new RenderScaleControl(preset, false)
    assert.equal(c.value, scale)
    assert.deepEqual(drive(c, 150, 900).concat(drive(c, 6, 1200)), [])
    assert.equal(c.value, featuresFor(preset).dprCap)
  }
})

test('drop promptly after sustained slow means; recover only after 270 fast means at original tier', () => {
  const c = new RenderScaleControl('ultra', true)
  assert.deepEqual(drive(c, 22, DROP_FRAMES - 1), [])
  assert.deepEqual(drive(c, 22, 1), [1.15])
  assert.deepEqual(drive(c, 25, DROP_FRAMES * 6), [1.05, .95, .85, .75])
  c.interrupt()
  assert.deepEqual(drive(c, 8, RECOVERY_FRAMES - 1), [])
  assert.deepEqual(drive(c, 8, 1), [.85])
  assert.deepEqual(drive(c, 8, RECOVERY_FRAMES * 6), [.95, 1.05, 1.15, 1.25])
  assert.equal(featuresFor('ultra').shadows, 'cast+props')
})

test('spikes and gaps cannot turn into a sustained window; locking restores the preset', () => {
  const c = new RenderScaleControl('high', true)
  const lifted: number[] = []
  for (let i = 0; i < 500; i++) if (c.frame(i % 31 === 30 ? 2_000 : 16.67)) lifted.push(c.value)
  assert.deepEqual(lifted, [])
  assert.deepEqual(drive(c, 20, 400), [])
  c.interrupt()
  assert.deepEqual(drive(c, 50, DROP_FRAMES - 1), [])
  c.interrupt()
  assert.deepEqual(drive(c, 50, DROP_FRAMES - 1), [])
  for (const v of [Infinity, NaN, 0, -1]) assert.equal(c.frame(v), false)
  assert.deepEqual(drive(c, 50, 1), [1.05])
  c.configure('high', false)
  assert.equal(c.value, 1.15)
  assert.deepEqual(drive(c, 50, 900), [])
})
