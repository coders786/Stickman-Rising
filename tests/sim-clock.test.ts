/** M03 — fixed-step simulation clock: only exact 1/60 steps run, backlog
 *  above the bound is dropped EXPLICITLY (counted), and no variable-size
 *  "catch-up tick" is ever produced. Old source had no scheduler — the
 *  frame loop stepped Math.min(acc, 0.05) directly. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceSimClock, DEFAULT_SIM_CLOCK } from '../src/game/core/sim-clock'

test('a steady 60 Hz frame runs exactly one fixed step and carries no debt', () => {
  const a = advanceSimClock(0, 1 / 60)
  assert.equal(a.steps, 1)
  assert.equal(a.dropped, 0)
  assert.ok(a.acc < 1e-9)
  assert.equal(a.stepDt, 1 / 60)
})

test('a no-step frame runs zero steps and keeps the requested time as debt', () => {
  const a = advanceSimClock(0, 0.008)
  assert.equal(a.steps, 0)
  assert.equal(a.dropped, 0)
  assert.ok(Math.abs(a.acc - 0.008) < 1e-12)
  // the debt is preserved across renders until a step is legal
  const b = advanceSimClock(a.acc, 0.008)
  assert.equal(b.steps, 0)
  assert.ok(Math.abs(b.acc - 0.016) < 1e-12)
})

test('every produced step is the same fixed size — never a variable tick', () => {
  // a 250 ms hitch (the mixed-step witness frame)
  const a = advanceSimClock(0, 0.25)
  assert.ok(a.steps > 0)
  assert.equal(a.stepDt, 1 / 60)
  // total simulated time is steps × stepDt exactly (no 50 ms catch-up tick)
  assert.ok(a.steps * a.stepDt <= DEFAULT_SIM_CLOCK.maxBacklog + 1e-12)
  // excess is explicitly dropped, not silently simulated or silently lost
  assert.ok(a.dropped > 0)
  assert.ok(Math.abs(a.dropped + a.steps * a.stepDt + a.acc - 0.25) < 1e-9,
    'requested = simulated + dropped + carried debt')
})

test('backlog is bounded and per-render work is capped (death-spiral guard)', () => {
  let acc = 0
  for (let i = 0; i < 100; i++) {
    const a = advanceSimClock(acc, 0.25)
    acc = a.acc
    assert.ok(a.steps <= DEFAULT_SIM_CLOCK.maxSteps)
    assert.ok(acc <= DEFAULT_SIM_CLOCK.maxBacklog + 1e-12)
    assert.ok(a.dropped >= 0)
  }
})

test('float dust cannot strand a step (0.1666… × 3 accumulates exactly)', () => {
  let acc = 0
  for (let i = 0; i < 3; i++) acc = advanceSimClock(acc, 1 / 60).acc
  // after three exact thirds, a fourth frame must not be blocked by epsilon
  const a = advanceSimClock(acc, 1 / 60)
  assert.ok(a.steps >= 1, 'epsilon residue must not suppress a legal step')
})

test('non-finite or negative dt is ignored rather than poisoning the clock', () => {
  const a = advanceSimClock(0.01, Number.NaN)
  assert.equal(a.steps, 0)
  assert.ok(Math.abs(a.acc - 0.01) < 1e-12)
  const b = advanceSimClock(0.01, -5)
  assert.equal(b.steps, 0)
  assert.equal(b.dropped, 0)
})
