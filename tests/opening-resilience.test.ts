import test from 'node:test'
import assert from 'node:assert/strict'
import { OpeningPace, OPENING_SLOW_GRACE_MS } from '../src/game/render/opening-pace'
import { BridgeStreaming, BRIDGE_WORKER_JOB_TIMEOUT_MS } from '../src/graphics/bridge/BridgeStreaming'

test('slow complete frames can reveal, but idle, invalidated and stale frames cannot', () => {
  const p = new OpeningPace()
  p.submitted(0, 250)
  assert.equal(p.ready(2000, 2000), false, 'one old frame and idle time cannot reveal')
  p.submitted(2050, 2300); p.ready(2316, 2316)
  p.submitted(2400, 2650)
  assert.equal(p.ready(2666, 2666), true)
  assert.equal(p.slowFallback, true)
  p.reset()
  assert.equal(p.ready(2700, 2700), false, 'surface invalidation removes slow qualification')
  p.submitted(3000, 3250); p.submitted(3300, 3550); p.submitted(3600, 3850)
  assert.equal(p.ready(3866, 3866), false, 'three frames alone do not bypass grace')
  assert.equal(p.ready(3850 + OPENING_SLOW_GRACE_MS, 3850 + OPENING_SLOW_GRACE_MS), false, 'stale last frame cannot reveal')
})

test('hung optics job is retired and opening can use its fallback; reset clears deadline', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  const workers: FakeWorker[] = []
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: ((e: ErrorEvent) => void) | null = null
    terminated = false
    constructor() { workers.push(this) }
    postMessage() {}
    terminate() { this.terminated = true }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
  try {
    const stream = new BridgeStreaming(1)
    stream.requestWindow(0, 500, 0)
    t.mock.timers.tick(BRIDGE_WORKER_JOB_TIMEOUT_MS - 1)
    assert.equal(stream.receipt().error, null)
    assert.equal(stream.openingSettled([]), false)
    t.mock.timers.tick(1)
    assert.match(stream.receipt().error ?? '', /timed out/)
    assert.equal(workers[0].terminated, true)
    assert.equal(stream.openingSettled([]), true)
    stream.reset(2)
    stream.requestWindow(0, 500, 0)
    assert.equal(stream.receipt().error, null)
    stream.dispose()
    t.mock.timers.tick(BRIDGE_WORKER_JOB_TIMEOUT_MS)
    assert.equal(stream.receipt().error, null, 'disposed jobs cannot deny a later run')
  } finally {
    if (original) Object.defineProperty(globalThis, 'Worker', original)
    else Reflect.deleteProperty(globalThis, 'Worker')
    t.mock.timers.reset()
  }
})

test('GL opening fallback preserves its reason until the next run boundary', async () => {
  const { BridgeFinish } = await import('../src/game/render/bridge-finish')
  const finish = new BridgeFinish()
  finish.beginOpening()
  finish.fallbackOpening()
  assert.equal(finish.advanceOpening('master', 400, 844, 1.25, null, 1, true), null)
  assert.match(finish.receipt().reason, /timed out.*Canvas/)
  // Starting a later attempt removes the run-local fallback; no output is
  // attached in this fixture, so admission now reports that independently.
  finish.endOpening(); finish.beginOpening()
  assert.equal(finish.advanceOpening('master', 400, 844, 1.25, null, 2, true), null)
  assert.match(finish.receipt().reason, /output unavailable/)
  finish.dispose()
})
