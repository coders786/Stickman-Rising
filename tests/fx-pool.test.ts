/** M02 — FX pool law: acquire re-registers recycled objects in the LIVE
 *  set exactly once. Old nextParticle/nextRing/startTrail popped the free
 *  list and set active=true WITHOUT pushing back into the live array —
 *  the object ended up in neither list (the acquire/expire/reacquire probe
 *  witness: live 0 / free 0 / object active). */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import type { FighterGeom } from '../src/game/anim/rig3d'
import { CH, makePose } from '../src/game/anim/pose'
import { BRIDGE_SHOCKWAVE_LIMIT, BRIDGE_SPARK_LIMIT, FX } from '../src/game/fx/fx'
import { setParticleLevel } from '../src/game/fx/particles1d'
import { gameLedger } from '../src/game/render/ledger'

beforeEach(() => setParticleLevel(2))

function lists(fx: FX, name: 'particles' | 'rings' | 'trails') {
  const any = fx as unknown as Record<string, unknown[]>
  const freeKey = { particles: 'pFree', rings: 'rFree', trails: 'tFree' }[name]
  const free = () => name === 'particles' ? [...any[freeKey], ...any.sparkFree] : any[freeKey]
  return {
    live: any[name] as { active: boolean; age: number; life: number }[],
    free: {
      get length() { return free().length },
      includes(value: unknown) { return free().includes(value) },
      *[Symbol.iterator]() { yield* free() as { active: boolean; age: number; life: number }[] },
    },
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
  assert.equal(free.length, BRIDGE_SPARK_LIMIT - 3)

  // expire them all
  fx.update(1)
  assert.equal(live.length, 0, 'expired particles are spliced out of live')
  assert.equal(free.length, BRIDGE_SPARK_LIMIT, 'expired particles return to free exactly once')
  assertPoolLaw(fx, 'particles', 'after expiry')

  // reacquire — THE witness: old code left live 0 / free 0 / object active
  fx.sparks(0, 0, 0, 1, 3, '#fff', 100, 0.05)
  assert.equal(live.length, 3, 'recycled particles must be registered live again')
  assert.equal(free.length, BRIDGE_SPARK_LIMIT - 3, 'recycled particles leave the free list')
  assertPoolLaw(fx, 'particles', 'after reacquire')

  // and they age out again — no orphan is stranded
  fx.update(1)
  assert.equal(live.length, 0)
  assert.equal(free.length, BRIDGE_SPARK_LIMIT)
  assertPoolLaw(fx, 'particles', 'second expiry')
})

test('multiple expire/reacquire cycles keep live∩free empty and counts stable', () => {
  const fx = new FX()
  for (let cycle = 0; cycle < 12; cycle++) {
    fx.sparks(0, 0, 0, Math.PI, 4, '#fff', 120, 0.02)
    fx.burst(10, 10, 4, '#fff', 120, 0.02)
    const { live, free } = lists(fx, 'particles')
    assert.equal(live.length, 8, `cycle ${cycle}: spawned particles are live`)
    assert.equal(free.length, BRIDGE_SPARK_LIMIT - 4, `cycle ${cycle}: free list drained`)
    assertPoolLaw(fx, 'particles', `cycle ${cycle} spawn`)
    fx.update(1) // expire everything
    assert.equal(live.length, 0, `cycle ${cycle}: live emptied`)
    assert.equal(free.length, BRIDGE_SPARK_LIMIT + 4, `cycle ${cycle}: all eight freed once`)
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
  assert.equal(r0.free.length, BRIDGE_SHOCKWAVE_LIMIT)
  fx.shockwave(0, 0, 100, '#fff', 0.01, 4)
  assert.equal(r0.live.length, 1, 'recycled ring must be live again')
  assert.equal(r0.free.length, BRIDGE_SHOCKWAVE_LIMIT - 1)
  assertPoolLaw(fx, 'rings', 'ring reacquire')
  fx.update(1)
  assert.equal(r0.live.length, 0)
  assert.equal(r0.free.length, BRIDGE_SHOCKWAVE_LIMIT)
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
  assert.equal(p.free.length, BRIDGE_SPARK_LIMIT - 15, 'both pools restored their pre-clear occupancy')
  assert.equal(r.live.length, 1, 'respawned ring is live')
  assert.equal(r.free.length, BRIDGE_SHOCKWAVE_LIMIT - 1)
  assertPoolLaw(fx, 'particles', 'post-clear particles')
  assertPoolLaw(fx, 'rings', 'post-clear rings')
})

test('dash and additive echoes solve their own saved pose once and re-solve recycled slots', () => {
  const fx = new FX()
  const { afterimages: live, aFree: free } = fx as unknown as {
    afterimages: { pose: Float32Array; needsSolve: boolean; geom: FighterGeom | null }[]
    aFree: { pose: Float32Array; needsSolve: boolean; geom: FighterGeom | null }[]
  }
  const pose = makePose()
  const g = createCanvas(320, 220).getContext('2d')
  const ctx = g as unknown as CanvasRenderingContext2D
  const paint = () => {
    g.clearRect(0, 0, 320, 220)
    fx.drawSilhouettes(ctx)
    fx.drawAdditive(ctx, 0)
    return Buffer.from(g.getImageData(0, 0, 320, 220).data)
  }
  const firstRoll = pose[CH.rootRot]
  fx.shadowGhost(pose, 100, 132, 1, 1, '#a5d2f2')
  pose[CH.rootRot] = 0.6
  fx.afterimage(pose, 180, 132, -1, '#a5d2f2')
  assert.equal(live[0].pose[CH.rootRot], firstRoll)
  assert.ok(live.every(ghost => ghost.needsSolve && !ghost.geom))
  const first = paint()
  assert.ok(first.some(v => v !== 0))
  const [dash, additive] = live, dashGeom = dash.geom, additiveGeom = additive.geom
  assert.ok(dashGeom && additiveGeom && dashGeom !== additiveGeom)
  assert.ok(live.every(ghost => !ghost.needsSolve))
  pose[CH.rootRot] = -0.42
  assert.deepEqual(paint(), first, 'live pose changed a captured ghost')
  fx.clear()
  assert.equal(live.length, 0)
  assert.equal(free.length, 2)
  const oldHead = additiveGeom.headC.x
  fx.shadowGhost(pose, 180, 132, -1, -1, '#a5d2f2')
  assert.equal(live[0], additive)
  assert.ok(live[0].needsSolve, 'reused slot was not invalidated')
  paint()
  assert.equal(live[0].geom, additiveGeom, 'recycle allocated a new rig')
  assert.notEqual(additiveGeom.headC.x, oldHead)
  assert.equal(dash.geom, dashGeom, 'one slot borrowed another slot’s geometry')
})


test('flash plates survive run resets and release only their FX owner', () => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement: () => createCanvas(1, 1) },
  })
  const a = new FX(), b = new FX()
  const ctx = createCanvas(100, 100).getContext('2d') as unknown as CanvasRenderingContext2D
  const entries = () => gameLedger.list().filter(e => e.tag === 'fx').map(e => e.key).sort()
  try {
    a.impact(50, 50, 0, false, '#ffffff', '#ffffff')
    a.drawAdditive(ctx, 0)
    const onlyA = entries()
    assert.equal(onlyA.length, 2)
    b.impact(50, 50, 0, false, '#ffffff', '#ffffff')
    b.drawAdditive(ctx, 0)
    assert.equal(entries().length, 4)
    a.clear()
    assert.equal(entries().length, 4, 'normal retry keeps the small reusable cache')
    a.dispose()
    assert.equal(entries().length, 2)
    assert.ok(entries().every(key => !onlyA.includes(key)))
    const before = gameLedger.stats().acquired
    b.drawAdditive(ctx, 0)
    assert.equal(gameLedger.stats().acquired, before, 'other owner can still blit the warm plates')
  } finally {
    a.dispose()
    b.dispose()
    if (prev) Object.defineProperty(globalThis, 'document', prev)
    else Reflect.deleteProperty(globalThis, 'document')
  }
  assert.equal(entries().length, 0)
})


test('typed spark and shockwave backing is bounded even under burst saturation', () => {
  const fx = new FX()
  fx.sparks(0, 0, 0, 1, 800, '#fff', 100, .14)
  for (let i = 0; i < 24; i++) fx.shockwave(0, 0, 30, '#fff', .12)
  const p = lists(fx, 'particles'), r = lists(fx, 'rings')
  assert.equal(r.live.length, BRIDGE_SHOCKWAVE_LIMIT)
  assert.equal(p.live.filter(p => 'type' in p && p.type === 'spark').length, BRIDGE_SPARK_LIMIT)
  const sparks = new Set(p.live.filter(p => 'type' in p && p.type === 'spark'))
  fx.update(1); assert.equal(p.live.length + r.live.length, 0)
  fx.sparks(0, 0, 0, 1, 800, '#fff', 100, .14)
  assert.ok(p.live.every(p => sparks.has(p)))
})
