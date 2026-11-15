/** M01 — step-owned input edges: a press must survive every render that
 *  runs no simulation step and be consumed by EXACTLY the next step.
 *  Old source cleared pressed()/released() at the bottom of every render,
 *  so an 8 ms zero-step frame deleted a parry press before any step saw it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Input } from '../src/game/core/input'

function pressVirtual(input: Input, a: 'light' | 'parry' | 'jump'): void {
  input.setVirtual(a, true)
  input.setVirtual(a, false)
}

test('a press survives zero-step renders until the next simulation step', () => {
  const input = new Input()
  pressVirtual(input, 'parry')
  assert.equal(input.pressed('parry'), true)

  // renders with no substep: only raw editor edges may be cleared
  input.endRenderFrame()
  input.endRenderFrame()
  assert.equal(input.pressed('parry'), true, 'zero-step renders must not consume gameplay edges')

  // first legal simulation step sees the press…
  assert.equal(input.pressed('parry'), true)
  input.endFrame(1 / 60)
  // …and it is consumed exactly once
  assert.equal(input.pressed('parry'), false)
  input.endFrame(1 / 60)
  assert.equal(input.pressed('parry'), false, 'never duplicated after consumption')
})

test('multiple zero-step frames then two substeps: one consumption only', () => {
  const input = new Input()
  pressVirtual(input, 'jump')
  input.endRenderFrame() // frame 1, no step
  input.endRenderFrame() // frame 2, no step
  // frame 3 runs two substeps — the press fires in the FIRST, not both
  let seen = 0
  if (input.pressed('jump')) seen++
  input.endFrame(1 / 60)
  if (input.pressed('jump')) seen++
  input.endFrame(1 / 60)
  assert.equal(seen, 1, 'edge lifetime is one substep, however long it waited')
})

test('releases follow the same step ownership as presses', () => {
  const input = new Input()
  input.setVirtual('dash', true)
  input.endFrame(1 / 60) // step consumed the press
  input.endRenderFrame()
  input.setVirtual('dash', false)
  input.endRenderFrame()
  assert.equal(input.released('dash'), true, 'release survives a zero-step render')
  input.endFrame(1 / 60)
  assert.equal(input.released('dash'), false)
})

test('endRenderFrame clears raw editor edges but keeps gameplay edges', () => {
  const input = new Input()
  input.setVirtual('light', true)
  assert.equal(input.rawPressed('Period'), false)
  // simulate a raw editor keydown (raw set is internal; use the public API)
  ;(input as unknown as { rawPresses: Set<string> }).rawPresses.add('Period')
  input.endRenderFrame()
  assert.equal(input.rawPressed('Period'), false, 'raw editor edges stay per-render')
  assert.equal(input.pressed('light'), true, 'gameplay edge untouched by the render tick')
})

test('clearEdges is an intentional full reset (pause/phase boundaries)', () => {
  const input = new Input()
  input.setVirtual('heavy', true)
  assert.equal(input.buffered('heavy'), true)
  input.clearEdges()
  assert.equal(input.pressed('heavy'), false)
  assert.equal(input.buffered('heavy'), false)
  // hold state policy: clearEdges targets edges/buffers; down states are
  // owned by setEnabled(false)/reset for pause — verify buffered cannot
  // resurrect from a stale timestamp
  assert.equal(input.takeBuffered('heavy'), false)
})
