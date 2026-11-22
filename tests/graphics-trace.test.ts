import test from 'node:test'
import assert from 'node:assert/strict'
import { GraphicsTrace } from '../src/debug/graphics-trace'

test('trace deduplicates state changes and bounds events', () => {
  let now = 0
  const trace = new GraphicsTrace(() => ++now)
  trace.state('gate', 'waiting'); trace.state('gate', 'waiting'); trace.state('gate', 'ready')
  assert.deepEqual(trace.events.map(e => e.detail), ['waiting', 'ready'])
  for (let i = 0; i < 1100; i++) trace.event('frame', String(i))
  assert.equal(trace.events.length, 1024)
  assert.equal(trace.events.at(-1)?.detail, '1099')
})

test('trace summaries use bounded recent samples and retain all-time totals', () => {
  const trace = new GraphicsTrace()
  trace.duration('work', -1); trace.duration('work', Number.NaN)
  for (let i = 1; i <= 1001; i++) trace.duration('work', i)
  const m = trace.snapshot().metrics.work
  assert.equal(m.count, 1001)
  assert.equal(m.meanMs, 501)
  assert.equal(m.maxMs, 1001)
  assert.equal(m.recentSamples, 1000)
  assert.equal(m.p50Ms, 501)
  assert.equal(m.p95Ms, 951)
  assert.equal(m.p99Ms, 991)
})
