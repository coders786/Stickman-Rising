/** P1D — the from-scratch 1D particle system.
 *  Axiom: one dynamic scalar per particle (phase φ); everything else is a
 *  pure function of (seed, φ, clocks). These tests pin the laws that make
 *  it cheap: zero integration, exact split-invariance, hard pool caps,
 *  single membership, and the global OFF/LOW/FULL toggle. */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  PARTICLE_LEVELS,
  getParticleLevel,
  setParticleLevel,
  cycleParticleLevel,
  particlesDraw,
  Field1D,
  Burst1D,
  assertBurstLaw,
} from '../src/game/fx/particles1d'

beforeEach(() => setParticleLevel(2))

test('toggle levels: labels, clamp, cycle order FULL→LOW→OFF→FULL', () => {
  assert.deepEqual([...PARTICLE_LEVELS], ['OFF', 'LOW', 'FULL'])
  setParticleLevel(2)
  assert.equal(getParticleLevel(), 2)
  assert.equal(cycleParticleLevel(), 1, 'FULL → LOW')
  assert.equal(cycleParticleLevel(), 0, 'LOW → OFF')
  assert.equal(cycleParticleLevel(), 2, 'OFF → FULL')
  // runtime clamp — bypass the 0|1|2 literal type the way a buggy caller would
  const setRaw = setParticleLevel as unknown as (l: number) => void
  setRaw(-5)
  assert.equal(getParticleLevel(), 0, 'clamped low')
  setRaw(99)
  assert.equal(getParticleLevel(), 2, 'clamped high')
})

test('particlesDraw gates detail classes by level', () => {
  setParticleLevel(2)
  assert.ok(particlesDraw(1) && particlesDraw(2))
  setParticleLevel(1)
  assert.ok(particlesDraw(1), 'core detail survives LOW')
  assert.ok(!particlesDraw(2), 'dense detail drops at LOW')
  setParticleLevel(0)
  assert.ok(!particlesDraw(1) && !particlesDraw(2), 'OFF drops everything')
})

test('Field1D: deterministic seeds, immutable channels, density × level counting', () => {
  const f = new Field1D({ count: 100, seed: 42 })
  const g = new Field1D({ count: 100, seed: 42 })
  const h = new Field1D({ count: 100, seed: 43 })
  assert.deepEqual([...f.a], [...g.a], 'same seed ⇒ same layout')
  assert.notDeepEqual([...f.a], [...h.a], 'different seed ⇒ different layout')
  assert.equal(f.n, 100)
  assert.equal(f.activeCount(2), 100, 'FULL draws everything')
  assert.equal(f.activeCount(1), 45, 'LOW draws 45%')
  assert.equal(f.activeCount(0), 0, 'OFF draws nothing')
  assert.equal(f.activeCount(), 100, 'default level arg = current global level')
  f.density = 0.5
  assert.equal(f.activeCount(2), 50, 'quality density scales the count')
  // zero integration: seeds never mutate after construction
  const snapshot = [...f.a]
  for (let i = 0; i < 1000; i++) f.activeCount(2)
  assert.deepEqual([...f.a], snapshot, 'counting must never touch the seed arrays')
})

test('Burst1D: hard cap is the memory bound (reject at exhaustion)', () => {
  const b = new Burst1D(8)
  assertBurstLaw(b)
  for (let i = 0; i < 8; i++) {
    assert.ok(b.emit(i * 0.1, 1, i, 0), `slot ${i} must be available`)
    assertBurstLaw(b, `after emit ${i}`)
  }
  assert.equal(b.live, 8)
  assert.ok(!b.emit(1, 1, 0, 0), 'cap reached — emit fails instead of allocating')
  assert.equal(b.rejects, 1, 'rejected emit is counted')
  assert.equal(b.live, 8, 'reject does not corrupt live count')
  assertBurstLaw(b)
})

test('Burst1D: sweep retires by phase and the pool reclaims (single membership)', () => {
  const b = new Burst1D(4)
  const t0 = 10
  for (let i = 0; i < 4; i++) assert.ok(b.emit(t0, 1, i, 2))
  assert.equal(b.live, 4)
  // phase is a pure function of (t − t0)/life — exact at any split
  assert.equal(b.phase(0, t0 + 0.5), 0.5)
  b.sweep(t0 + 0.5)
  assert.equal(b.live, 4, 'half-life slots are still live')
  assert.equal(b.retires, 0)
  b.sweep(t0 + 1)
  assert.equal(b.live, 0, 'all slots retired')
  assert.equal(b.freeSlots, 4, 'freelist fully reclaimed')
  assertBurstLaw(b)
  assert.ok(b.retires >= 4, 'retires counted monotonically')
  // reacquire: the SAME memory, no growth
  assert.ok(b.emit(t0 + 2, 1, 9, 9), 'reacquired from the freelist')
  assertBurstLaw(b)
  assert.equal(b.live, 1)
})

test('Burst1D: double-start of a live slot is a no-op (law cannot drift)', () => {
  const b = new Burst1D(2)
  const i = b.acquire()
  assert.ok(i >= 0)
  b.start(i, 0, 1, 0, 0, 0, 0)
  assert.equal(b.live, 1)
  b.start(i, 0.5, 1, 0, 0, 0, 0) // would double-count without the guard
  assert.equal(b.live, 1, 'liveCount unchanged')
  assertBurstLaw(b)
})

test('Burst1D: clear() resets to full capacity', () => {
  const b = new Burst1D(6)
  for (let i = 0; i < 6; i++) b.emit(0, 1, 0, 0)
  assert.ok(!b.emit(0, 1, 0, 0))
  b.clear()
  assert.equal(b.live, 0)
  assert.equal(b.freeSlots, 6)
  assertBurstLaw(b)
  for (let i = 0; i < 6; i++) assert.ok(b.emit(1, 1, 0, 0))
  assertBurstLaw(b)
})
