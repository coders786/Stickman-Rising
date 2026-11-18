/** STICKMAN RISING — tests/rigging.test.ts
 * The rooftop rigging (world/rigging.ts) and the shared wind (world/wind.ts).
 * ----------------------------------------------------------------------------
 * These are the properties that would silently rot:
 *  · the tier budgets are monotonic — a better tier never has less;
 *  · the anchor layout is deterministic per seed, and a different seed moves it;
 *  · every cable keeps BOTH ends on its anchors while it is blown about (this is
 *    the backward inextensibility pass — see 22 §"errors", it was a real bug);
 *  · a windy profile bows the cable further than a becalmed one, because
 *    `clouds.speed` is supposed to be felt in the cables as well as the sky.
 * Nothing here needs a DOM: build, update, inspect.
 * ==========================================================================*/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeProfile } from '../src/game/world/profile'
import { Rigging, buildMasts, buildSpecs, riggingFor } from '../src/game/world/rigging'
import { Wind } from '../src/game/world/wind'
import type { Quality } from '../src/game/world/background'

const TIERS: Quality[] = ['low', 'medium', 'high', 'ultra']

test('rigging: tier budgets never go backwards', () => {
  let prev = { cables: 0, flagsPerCable: 0 }
  for (const t of TIERS) {
    const b = riggingFor(t)
    assert.ok(b.cables >= prev.cables, `${t}: cable count regressed`)
    assert.ok(b.flagsPerCable >= prev.flagsPerCable, `${t}: pennant count regressed`)
    // Every tier keeps a cable: a low-end device loses drawing, never the rig.
    assert.ok(b.cables >= 1, `${t}: no cable at all`)
    prev = b
  }
  assert.ok(riggingFor('ultra').cables > riggingFor('low').cables)
})

test('rigging: the anchor layout is deterministic per seed and moves between seeds', () => {
  const a = buildSpecs(makeProfile(0xabc123), riggingFor('ultra'))
  const b = buildSpecs(makeProfile(0xabc123), riggingFor('ultra'))
  const c = buildSpecs(makeProfile(0xabc124), riggingFor('ultra'))
  assert.deepEqual(a, b, 'same seed must produce the same rigging')
  assert.notDeepEqual(a, c, 'a different seed must produce different rigging')
  // Spans are horizontal and plausible: A is left of B on every cable.
  for (const s of a) {
    assert.ok(s.bx > s.ax, 'a cable must run left to right')
    assert.ok(s.sag >= 20 && s.sag <= 90, `sag ${s.sag} out of authored range`)
  }
})

test('rigging: every cable end has a post, and no post is off the deck', () => {
  for (const tier of TIERS) {
    const prof = makeProfile(5150)
    const specs = buildSpecs(prof, riggingFor(tier))
    const masts = buildMasts(specs)
    // One post per distinct anchor x — no duplicates, no missing ends.
    const xs = new Set<number>()
    for (const s of specs) {
      xs.add(Math.round(s.ax))
      xs.add(Math.round(s.bx))
    }
    assert.equal(masts.length, xs.size, `${tier}: ${masts.length} posts for ${xs.size} anchors`)
    for (const s of specs) {
      for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]] as const) {
        const m = masts.find((m) => m.x === Math.round(x))
        assert.ok(m, `anchor ${x.toFixed(0)} has no post`)
        assert.ok(m.top <= y, `post at ${m.x} stops below its cable (${m.top} > ${y})`)
      }
      // ...and both ends stand on the arena floor (−150..2750).
      assert.ok(s.ax > -150 && s.bx < 2750, `cable ${s.ax}..${s.bx} runs off the roof`)
    }
  }
})

test('rigging: stats match the loadout, and points stay small', () => {
  for (const t of TIERS) {
    const r = new Rigging(makeProfile(424242), t)
    const s = r.stats()
    const b = riggingFor(t)
    assert.equal(s.cables, b.cables)
    assert.ok(s.flags <= b.cables * b.flagsPerCable)
    // 3 cables × 19 points + 12 pennants × 5 = 117 points, the whole budget.
    assert.ok(s.points < 200, `rigging costs ${s.points} points`)
  }
})

test('rigging: both ends stay pinned while the cable is blown', () => {
  const prof = makeProfile(9911)
  const r = new Rigging(prof, 'ultra')
  // Reach past the private fields deliberately: the assertion is about the
  // observable geometry, and there is no public endpoint accessor.
  const cables = (r as unknown as { cables: { p: Float32Array; rootX: number; rootY: number; tailX: number; tailY: number }[] }).cables
  for (let i = 0; i < 180; i++) r.update(1 / 60)
  for (const c of cables) {
    const rootX = c.p[0]
    const rootY = c.p[1]
    const tailX = c.p[c.p.length - 2]
    const tailY = c.p[c.p.length - 1]
    assert.ok(Math.hypot(rootX - c.rootX, rootY - c.rootY) < 0.75, 'root drifted off its anchor')
    assert.ok(Math.hypot(tailX - c.tailX, tailY - c.tailY) < 0.75, 'tail drifted off its anchor')
  }
})

test('rigging: update is finite under a stalled frame and rate-independent in shape', () => {
  const prof = makeProfile(777)
  const slow = new Rigging(prof, 'high')
  const fast = new Rigging(prof, 'high')
  // The same wall-clock time, split 10× versus 60×. SpringChain's fixed
  // sub-step means the two must agree closely, not exactly (the gust field is
  // integrated per call).
  for (let i = 0; i < 10; i++) slow.update(0.1)
  for (let i = 0; i < 60; i++) fast.update(1 / 60)
  const read = (r: Rigging): number => (r as unknown as { cables: { p: Float32Array }[] }).cables[0].p[7]
  const a = read(slow)
  const b = read(fast)
  assert.ok(Number.isFinite(a) && Number.isFinite(b))
  assert.ok(Math.abs(a - b) < 40, `midpoint differed by ${(a - b).toFixed(1)}px between 10 Hz and 60 Hz`)
})

test('wind: direction follows clouds.speed, and a calm run is calm', () => {
  const calm = makeProfile(2001)
  calm.clouds.speed = 0.62
  const windy = makeProfile(2001)
  windy.clouds.speed = 1.58
  const wc = new Wind(calm)
  const ww = new Wind(windy)
  assert.ok(Math.abs(wc.base) < Math.abs(ww.base) + 1e-6)
  assert.ok(wc.driftScale < ww.driftScale, 'drift scale must grow with wind')
  // Cheap scalar sanity over a second of simulated time.
  for (let i = 0; i < 60; i++) {
    wc.update(1 / 60)
    ww.update(1 / 60)
  }
  for (const v of [wc.base, wc.accel, wc.airspeed, wc.driftScale, ww.accel, ww.driftScale]) {
    assert.ok(Number.isFinite(v), 'wind produced a non-finite value')
  }
  assert.ok(Math.abs(ww.accel) > Math.abs(wc.accel), 'the windy run must push harder')
})

test('wind: cables bow further on a windy run than on a calm one', () => {
  const calm = makeProfile(31337)
  calm.clouds.speed = 0.6
  const windy = makeProfile(31337)
  windy.clouds.speed = 1.7
  const rc = new Rigging(calm, 'high')
  const rw = new Rigging(windy, 'high')
  const cableX = (r: Rigging): number => (r as unknown as { cables: { p: Float32Array }[] }).cables[0].p[8]
  const base = cableX(new Rigging(calm, 'high'))
  for (let i = 0; i < 240; i++) {
    rc.update(1 / 60)
    rw.update(1 / 60)
  }
  // Wind is lateral acceleration. Test lateral motion, not vertical collapse.
  assert.ok(Math.abs(cableX(rw) - base) > Math.abs(cableX(rc) - base), 'wind did not reach the cable')
})

// Endpoints alone missed the falling interior and the long diagonal back to the mast.
test('every settled cable segment stays overhead, including after a tier change', () => {
  for (const seed of [9911, 0xa17e, 777]) {
    const r = new Rigging(makeProfile(seed),'low')
    for(const tier of ['low','medium','high','ultra'] as const){
      r.setTier(tier)
      for(let i=0;i<260;i++){
        r.update(i%31===0 ? .14 : 1/60)
        for(const c of (r as unknown as {cables:{p:Float32Array}[]}).cables){
          for(let j=1;j<c.p.length;j+=2) assert.ok(c.p[j]<-180,'wire entered the combat lane')
        }
      }
    }
  }
})
