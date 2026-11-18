/** STICKMAN RISING — tests/ledger-gen.test.ts
 * The ledger's two new guarantees (render/ledger.ts), added with T1.6.
 * ----------------------------------------------------------------------------
 * T1.6 moved every canvas in the game onto the ledger. That only works if two
 * things are true, and neither was true before:
 *
 *   1. **A pinned surface is never evicted.** Evicting a live bake does not free
 *      memory a frame later — it blanks a plate the renderer still blits, which
 *      is exactly the kind of bug that looks like "the graphics broke".
 *   2. **A generation releases its whole previous set at once.** Bakes come in
 *      generations (a reseed rebuilds every tile), and without this the ledger
 *      accumulates one city per run.
 *
 * DOM-free: the ledger takes its factory as a parameter, so a stub surface with a
 * numeric width/height is enough to exercise every path.
 * ==========================================================================*/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CanvasLedger, SurfaceGen, bytesFor, hasPixels, type Surface } from '../src/game/render/ledger'

interface Stub extends Surface {
  /** Set when the store is released, so a test can prove the bytes were freed. */
  freed?: boolean
}

function stubFactory(): (w: number, h: number) => Surface {
  return (w: number, h: number): Surface => {
    // `SurfaceGen.next` throws when there is no 2D context (that IS the
    // production behaviour), so the stub hands back a bare object.
    const s: Stub = {
      width: w,
      height: h,
      getContext: () => ({}) as CanvasRenderingContext2D,
    }
    return s
  }
}

test('ledger: pins survive a sweep that is over both caps', () => {
  const l = new CanvasLedger(stubFactory(), { maxSurfaces: 2, maxBytes: 64 * 1024, minTrackedBytes: 0 })
  const pinned = l.acquire('keep', 64, 64, 'bake', true)
  for (let i = 0; i < 12; i++) l.acquire(`temp:${i}`, 128, 128, 'temp')
  // The pinned surface is still THE surface, with its size intact.
  assert.equal(pinned.width, 64)
  assert.equal(pinned.height, 64)
  const keys = l.list().map((e) => e.key)
  assert.ok(keys.includes('keep'), 'the pinned bake was evicted')
  // ...and the sweep still did its job on everything else.
  assert.ok(l.stats().evicted > 0, 'nothing was evicted, so the caps were not exercised')
})

test('ledger: a pin is honoured when the surface is re-acquired', () => {
  const l = new CanvasLedger(stubFactory(), { maxSurfaces: 1, maxBytes: 4096, minTrackedBytes: 0 })
  l.acquire('x', 32, 32).width // unpinned first
  const pinned = l.acquire('x', 32, 32, 'x', true)
  for (let i = 0; i < 6; i++) l.acquire(`t:${i}`, 32, 32)
  assert.ok(l.list().some((e) => e.key === 'x'), 'a later pin did not protect the surface')
  assert.equal(pinned.width, 32)
})

test('ledger: a generation releases its previous set and reuses the keys', () => {
  const l = new CanvasLedger(stubFactory())
  const gen = new SurfaceGen('tile:', l)
  const first = gen.next(100, 100)
  const second = gen.next(100, 100)
  assert.notEqual(first.c, second.c, 'two surfaces in one generation must be distinct')
  assert.equal(gen.count, 2)
  const bytesAfterFirst = l.stats().bytes
  assert.equal(bytesAfterFirst, bytesFor(100, 100) * 2)

  gen.begin()
  assert.equal(gen.count, 0)
  assert.equal(l.stats().surfaces, 0, 'the generation was not released')
  assert.equal(l.stats().bytes, 0, 'the bytes were not freed')
  assert.equal((first.c as Stub).width, 0, 'the released surface was not zeroed')

  // The new generation starts its keys from zero again, and gets FRESH stores:
  // the old canvases must not be handed back after being zeroed.
  const again = gen.next(100, 100)
  assert.notEqual(again.c, first.c, 'a released canvas was reused without a reallocation')
  assert.equal(again.c.width, 100)
})

test('ledger: a size change on one key reallocates in place, without a new entry', () => {
  const l = new CanvasLedger(stubFactory())
  const a = l.acquire('plate', 100, 50, 'hud', true)
  const before = l.stats()
  const b = l.acquire('plate', 200, 80, 'hud', true)
  assert.equal(a, b, 'the same key must return the same surface')
  assert.equal(b.width, 200)
  assert.equal(b.height, 80)
  const after = l.stats()
  assert.equal(after.surfaces, before.surfaces, 'a resize created a second entry')
  assert.equal(after.bytes, bytesFor(200, 80), 'the byte estimate was not updated')
  assert.equal(after.createdBytes, bytesFor(200, 80))
})

test('ledger: generations and stable keys cannot collide', () => {
  const l = new CanvasLedger(stubFactory())
  const gen = new SurfaceGen('bake:', l)
  const stable = l.acquire('poll:plate', 64, 8, 'poll', true)
  gen.next(64, 8)
  gen.begin()
  // Releasing the generation must not touch a stable key that merely looks
  // similar — the prefix is the contract.
  assert.ok(l.list().some((e) => e.key === 'poll:plate'), 'the generation released a foreign key')
  assert.equal(stable.width, 64)
})

test('ledger: the crash that started this — an unpinned live plate is zeroed', () => {
  // Reproduces the InvalidStateError from the console: a 2048×210 cloud bank
  // acquired WITHOUT a pin, then a bake storm (a run's city plates) that crosses
  // the byte cap. The sweep picks the only unpinned entry and zeroes its store.
  const l = new CanvasLedger(stubFactory(), { maxSurfaces: 8, maxBytes: 3 * 1024 * 1024, minTrackedBytes: 0 })
  const bank = l.acquire('cloudbank:123', 2048, 210) as Stub
  assert.equal(bank.width, 2048)
  for (let i = 0; i < 12; i++) l.acquire(`bake:${i}`, 1024, 700, 'bake', true)
  assert.equal(bank.width, 0, 'the hazard did not reproduce — the test is no longer testing anything')
  // Which is exactly why `hasPixels()` exists: the draw path must be able to ask.
  assert.equal(hasPixels(bank), false)
})

test('ledger: pinned, the same bank survives the same storm', () => {
  const l = new CanvasLedger(stubFactory(), { maxSurfaces: 8, maxBytes: 3 * 1024 * 1024, minTrackedBytes: 0 })
  const bank = l.acquire('cloudbank:123', 2048, 210, 'sky', true) as Stub
  for (let i = 0; i < 12; i++) l.acquire(`bake:${i}`, 1024, 700, 'bake', true)
  assert.equal(bank.width, 2048, 'a pinned plate was zeroed by the sweep')
  assert.ok(hasPixels(bank))
  assert.ok(l.stats().surfaces > 8, 'the cap was silently violated instead of evicting (expected: nothing evictable)')
})

test('ledger: hasPixels is a type guard, not a truthiness check', () => {
  assert.equal(hasPixels(null), false)
  assert.equal(hasPixels(undefined), false)
  assert.equal(hasPixels({ width: 0, height: 10 }), false)
  assert.equal(hasPixels({ width: 10, height: 0 }), false)
  assert.equal(hasPixels({ width: 10, height: 10 }), true)
})

test('ledger: bytes are page-rounded, so small plates cannot pretend to be free', () => {
  assert.equal(bytesFor(1, 1), 4096)
  assert.equal(bytesFor(32, 32), 4096)
  assert.equal(bytesFor(64, 64), 16384)
  assert.equal(bytesFor(2048, 210), Math.ceil((2048 * 210 * 4) / 4096) * 4096)
})
