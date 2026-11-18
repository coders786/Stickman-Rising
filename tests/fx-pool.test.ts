/** M02 — FX pool law: acquire re-registers recycled objects in the LIVE
 *  set exactly once. Old nextParticle/nextRing/startTrail popped the free
 *  list and set active=true WITHOUT pushing back into the live array —
 *  the object ended up in neither list (the acquire/expire/reacquire probe
 *  witness: live 0 / free 0 / object active). */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { FX } from '../src/game/fx/fx'
import { setParticleLevel } from '../src/game/fx/particles1d'

beforeEach(() => setParticleLevel(2))

type PoolView<T> = { live: T[]; free: T[]; active: boolean; age: number; life: number }

function view(fx: FX, name: 'particles' | 'rings' | 'trails'): PoolView<{ active: boolean; age: number; life: number }>[] {
  const any = fx as unknown as Record<string, unknown[]>
  const live = any[name] as { active: boolean; age: number; life: number }[]
  const freeKey = { particles: 'pFree', rings: 'rFree', trails: 'tFree' }[name]
  const free = any[freeKey] as { active: boolean; age: number; life: number }[]
  return live.map((o) => ({ live, free, active: o.active, age: o.age, life: o.life })) as never
}

function lists(fx: FX, name: 'particles' | 'rings' | 'trails') {
  const any = fx as unknown as Record<string, unknown[]>
  const freeKey = { particles: 'pFree', rings: 'rFree', trails: 'tFree' }[name]
  return {
    live: any[name] as { active: boolean; age: number; life: number }[],
    free: any[freeKey] as { active: boolean; age: number; life: number }[],
  }
}

function assertPoolLaw(fx: FX, name: 'particles' | 'rings' | 'trails', label: string) {
  const { live, free } = lists(fx, name)
  const liveSet = new Set(live)
  for (const o of free) {
    assert.ok(!liveSet.has(o), `${label}: an object must never be in live AND free (${label})`)
  }
  for (const o of live) {
    assert.equal(o.active, true, `${label}: live members must be active`)
  }
  for (const o of free) {
    assert.equal(o.active, false, `${label}: free members must be inactive`)
  }
}

test('a recycled particle re-enters the live set and expires normally', () => {
  const fx = new FX()
  fx.sparks(0, 0, 0, 1, 3, '#fff', 100, 0.05)
  const { live, free } = lists(fx, 'particles')
  assert.equal(live.length, 3)
  assert.equal(free.length, 0)

  // expire them all
  fx.update(1)
  assert.equal(live.length, 0, 'expired particles are spliced out of live')
  assert.equal(free.length, 3, 'expired particles return to free exactly once')
  assertPoolLaw(fx, 'particles', 'after expiry')

  // reacquire — THE witness: old code left live 0 / free 0 / object active
  fx.sparks(0, 0, 0, 1, 3, '#fff', 100, 0.05)
  assert.equal(live.length, 3, 'recycled particles must be registered live again')
  assert.equal(free.length, 0, 'recycled particles leave the free list')
  assertPoolLaw(fx, 'particles', 'after reacquire')

  // and they age out again — no orphan is stranded
  fx.update(1)
  assert.equal(live.length, 0)
  assert.equal(free.length, 3)
  assertPoolLaw(fx, 'particles', 'second expiry')
})

test('multiple expire/reacquire cycles keep live∩free empty and counts stable', () => {
  const fx = new FX()
  for (let cycle = 0; cycle < 12; cycle++) {
    fx.sparks(0, 0, 0, Math.PI, 4, '#fff', 120, 0.02)
    fx.burst(10, 10, 4, '#fff', 120, 0.02)
    const { live, free } = lists(fx, 'particles')
    assert.equal(live.length, 8, `cycle ${cycle}: spawned particles are live`)
    assert.equal(free.length, 0, `cycle ${cycle}: free list drained`)
    assertPoolLaw(fx, 'particles', `cycle ${cycle} spawn`)
    fx.update(1) // expire everything
    assert.equal(live.length, 0, `cycle ${cycle}: live emptied`)
    assert.equal(free.length, 8, `cycle ${cycle}: all eight freed once`)
    assertPoolLaw(fx, 'particles', `cycle ${cycle} expiry`)
  }
})

test('recycled rings rejoin the live set (dissolve/shockwave path)', () => {
  const fx = new FX()
  fx.shockwave(0, 0, 100, '#fff', 0.01, 4)
  const r0 = lists(fx, 'rings')
  assert.equal(r0.live.length, 1)
  fx.update(1)
  assert.equal(r0.live.length, 0)
  assert.equal(r0.free.length, 1)
  fx.shockwave(0, 0, 100, '#fff', 0.01, 4)
  assert.equal(r0.live.length, 1, 'recycled ring must be live again')
  assert.equal(r0.free.length, 0)
  assertPoolLaw(fx, 'rings', 'ring reacquire')
  fx.update(1)
  assert.equal(r0.live.length, 0)
  assert.equal(r0.free.length, 1)
})

test('recycled slash trails rejoin the live set (startTrail path)', () => {
  const fx = new FX()
  const t1 = fx.startTrail('#fff', '#eee', 2)
  const tr = lists(fx, 'trails')
  assert.ok(tr.live.includes(t1 as never), 'fresh trail is live')
  fx.endTrail(t1, 0.01)
  fx.update(1)
  assert.ok(!tr.live.includes(t1 as never), 'expired trail leaves live')
  assert.ok(tr.free.includes(t1 as never), 'expired trail enters free')
  const t2 = fx.startTrail('#0f0', '#eee', 3)
  assert.equal(t2, t1, 'the pool recycles the same object')
  assert.ok(tr.live.includes(t2 as never), 'recycled trail must be re-registered live')
  assert.ok(!tr.free.includes(t2 as never), 'recycled trail leaves free')
  assertPoolLaw(fx, 'trails', 'trail reacquire')
})

test('clear() then respawn keeps the pool law across a new run', () => {
  const fx = new FX()
  fx.sparks(0, 0, 0, 1, 5, '#fff', 100, 0.5)
  fx.shockwave(0, 0, 80, '#fff', 0.5, 3) // also seeds sparks + dust internally
  fx.clear()
  const p = lists(fx, 'particles')
  const r = lists(fx, 'rings')
  assert.equal(p.live.length, 0, 'clear empties live')
  assert.equal(r.live.length, 0, 'clear empties rings')
  assert.ok(p.free.length > 0, 'cleared particles sit in free')
  fx.sparks(0, 0, 0, 1, 5, '#fff', 100, 0.5)
  fx.shockwave(0, 0, 80, '#fff', 0.5, 3)
  assert.ok(p.live.length >= 5, 'respawned particles are live again')
  assert.equal(p.free.length, 0, 'free list fully drained by respawn')
  assert.equal(r.live.length, 1, 'respawned ring is live')
  assert.equal(r.free.length, 0)
  assertPoolLaw(fx, 'particles', 'post-clear particles')
  assertPoolLaw(fx, 'rings', 'post-clear rings')
})
