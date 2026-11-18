/** THE LEDGER AND THE LADDER — the two pure controllers from M1.
 *
 * Both are tested without a browser: the ledger takes an injectable surface
 * factory and the ladder takes frame durations. That is the whole point of
 * keeping them DOM-free — the cheapest place to prove an eviction policy is a
 * unit test, not a phone.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CanvasLedger, bytesFor, DEFAULT_CAPS } from '../src/game/render/ledger'
import { QualityLadder } from '../src/game/render/quality'
import { FrameLog } from '../src/game/render/frameLog'

function stubFactory() {
  const created: Array<{ w: number; h: number; zeroed: boolean }> = []
  const factory = (w: number, h: number) => {
    const rec = { w, h, zeroed: false }
    created.push(rec)
    const surface = {
      get width() { return rec.w },
      set width(v: number) { rec.w = v; if (v === 0) rec.zeroed = true },
      get height() { return rec.h },
      set height(v: number) { rec.h = v; if (v === 0) rec.zeroed = true },
      getContext: () => null,
    }
    return surface as unknown as import('../src/game/render/ledger').Surface
  }
  return { factory, created }
}

test('an exact key+size request is reused, not reallocated', () => {
  const { factory, created } = stubFactory()
  const l = new CanvasLedger(factory)
  const a = l.acquire('sky', 512, 512)
  const b = l.acquire('sky', 512, 512)
  assert.equal(a, b, 'same surface')
  assert.equal(created.length, 1, 'one allocation')
  assert.equal(l.reused, 1)
})

test('a size change reallocates in place and updates the byte count', () => {
  const { factory } = stubFactory()
  const l = new CanvasLedger(factory)
  l.acquire('moon', 256, 256)
  const before = l.stats().bytes
  l.acquire('moon', 512, 512)
  const after = l.stats().bytes
  assert.equal(l.stats().surfaces, 1, 'still one surface')
  assert.ok(after > before, `bytes grew (${before} -> ${after})`)
  assert.equal(after, bytesFor(512, 512))
})

test('release zeroes the backing store — it does not merely drop the key', () => {
  const { factory, created } = stubFactory()
  const l = new CanvasLedger(factory)
  l.acquire('plate', 1024, 1024)
  assert.equal(l.release('plate'), true)
  assert.equal(created[0].zeroed, true, 'width/height were set to 0')
  assert.equal(l.stats().surfaces, 0)
  assert.equal(l.release('plate'), false, 'double release is a no-op')
})

test('the surface cap evicts least-recently-used, never the just-touched', () => {
  const { factory } = stubFactory()
  const l = new CanvasLedger(factory, { maxSurfaces: 3, maxBytes: 1 << 30 })
  l.acquire('a', 64, 64)
  l.acquire('b', 64, 64)
  l.acquire('c', 64, 64)
  l.peek('a', 64, 64)         // a is now newest
  l.acquire('d', 64, 64)      // must evict b
  assert.equal(l.has('a'), true)
  assert.equal(l.has('b'), false, 'b was least recently used')
  assert.equal(l.has('c'), true)
  assert.equal(l.has('d'), true)
  assert.equal(l.evicted, 1)
})

test('the byte cap is enforced too, so one huge plate cannot eat the budget', () => {
  const { factory } = stubFactory()
  const l = new CanvasLedger(factory, { maxSurfaces: 99, maxBytes: 4 * 1024 * 1024 })
  l.acquire('small1', 256, 256)
  l.acquire('small2', 256, 256)
  l.acquire('big', 2048, 1024)   // 8 MB
  const st = l.stats()
  assert.equal(l.has('big'), true, 'the newest claim survives')
  assert.ok(l.evicted >= 2, `evicted ${l.evicted}`)
  // A single claim bigger than the cap is honoured (documented in ledger.ts):
  // the alternative is a missing plate. Everything else must be gone.
  assert.equal(st.surfaces, 1)
  assert.equal(st.bytes, bytesFor(2048, 1024))
})

test('releasePrefix clears a whole run at once (reseed)', () => {
  const { factory } = stubFactory()
  const l = new CanvasLedger(factory)
  l.acquire('run1:moon', 128, 128)
  l.acquire('run1:stars', 128, 128)
  l.acquire('global:vignette', 128, 128)
  assert.equal(l.releasePrefix('run1:'), 2)
  assert.equal(l.has('global:vignette'), true)
})

test('bytesFor rounds up to a page and never returns 0', () => {
  assert.ok(bytesFor(1, 1) >= 4096)
  assert.ok(bytesFor(0, 0) > 0)
  assert.equal(bytesFor(1024, 1024), 4 * 1024 * 1024)
})

test('defaults are the documented ones', () => {
  assert.equal(DEFAULT_CAPS.maxSurfaces, 48)
  assert.equal(DEFAULT_CAPS.maxBytes, 48 * 1024 * 1024)
})

/* ------------------------------ the ladder ------------------------------ */

function simulate(l: QualityLadder, ms: number, seconds: number): string[] {
  const steps: string[] = []
  const dt = 1 / 60
  const frames = Math.round(seconds * 60)
  for (let i = 0; i < frames; i++) {
    const s = l.frame(ms, dt)
    if (s) steps.push(s)
  }
  return steps
}

test('a sustained slow window sheds exactly one tier', () => {
  const l = new QualityLadder('high')
  const steps = simulate(l, 40, 4.2)
  assert.deepEqual(steps, ['medium'], `shed ${JSON.stringify(steps)}`)
  assert.equal(l.current, 'medium')
})

test('one slow frame is not a device: no shed on a single 40 ms hit', () => {
  const l = new QualityLadder('high')
  let out: string | null = null
  for (let i = 0; i < 240; i++) {
    const ms = i === 120 ? 40 : 8
    const s = l.frame(ms, 1 / 60)
    if (s) out = s
  }
  assert.equal(out, null, 'never shed for a single long frame')
  assert.equal(l.current, 'high')
})

test('it cannot oscillate: a raise needs a 12 s dwell after a shed', () => {
  const l = new QualityLadder('high')
  simulate(l, 40, 4.2)              // shed to medium
  assert.equal(l.current, 'medium')
  const early = simulate(l, 6, 10)// fast again, but inside the dwell
  assert.deepEqual(early, [], 'raised inside the dwell window')
  const late = simulate(l, 6, 10)   // now past 12 s
  assert.deepEqual(late, ['high'], 'raised once the dwell expired')
})

test('never sheds below the floor, never raises above the ceiling', () => {
  const l = new QualityLadder('medium')
  simulate(l, 90, 60)
  assert.equal(l.current, 'low', 'shed to the floor and stopped')
  const up = simulate(l, 5, 60)
  assert.deepEqual(up, ['medium'], `raised once to the ceiling: ${JSON.stringify(up)}`)
  assert.equal(l.current, 'medium')
  assert.equal(l.ceilingTier, 'medium')
})

test('changing the ceiling snaps the tier immediately', () => {
  const l = new QualityLadder('high')
  simulate(l, 40, 4.2)
  assert.equal(l.current, 'medium')
  l.setCeiling('ultra')
  assert.equal(l.ceilingTier, 'ultra')
  assert.equal(l.current, 'medium', 'a ceiling change does not guess forward')
  l.setCeiling('low')
  assert.equal(l.current, 'low')
})

test('garbage samples cannot drive it', () => {
  const l = new QualityLadder('high')
  for (let i = 0; i < 600; i++) {
    l.frame(Number.NaN, 1 / 60)
    l.frame(-5, 1 / 60)
    l.frame(0, 1 / 60)
  }
  assert.equal(l.current, 'high')
})

test('a tab-restore spike is clamped, not treated as a 2 s frame', () => {
  const l = new QualityLadder('high')
  const steps = simulate(l, 2000, 4.2)
  // Clamped to 100 ms, which is still over the shed threshold: one shed, then
  // it must stop rather than stepping again on the same stale window.
  assert.equal(steps.length, 1, `steps ${JSON.stringify(steps)}`)
})

test('the ladder reads back as one line', () => {
  const l = new QualityLadder('high')
  simulate(l, 40, 4.2)
  assert.match(l.toString(), /ladder medium \(ceil high\)/)
})

/* ------------------------------ the frame log ---------------------------- */

test('frame log reports percentiles, not an average', () => {
  const f = new FrameLog(120)
  for (let i = 0; i < 110; i++) f.sample(8)
  for (let i = 0; i < 10; i++) f.sample(50)
  const s = f.snapshot()
  assert.equal(s.samples, 120)
  assert.ok(s.p50 < 10, `p50 ${s.p50}`)
  assert.ok(s.p95 > 40, `p95 ${s.p95} — the average would have hidden these`)
  assert.equal(s.long, 10)
  assert.ok(s.longFraction > 0.07)
})

test('frame log excludes context switches from the percentile window', () => {
  const f = new FrameLog(60)
  for (let i = 0; i < 60; i++) f.sample(9)
  f.sample(30_000)
  const s = f.snapshot()
  assert.equal(s.gaps, 1)
  assert.equal(s.samples, 60)
  assert.ok(s.p99 < 12, 'the 30 s gap did not poison p99')
})

test('frame log is bounded (no unbounded buffer)', () => {
  const f = new FrameLog(64)
  for (let i = 0; i < 10_000; i++) f.sample(8 + (i % 3))
  assert.equal(f.snapshot().samples, 64)
})
