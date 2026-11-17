/** THE RUN IDENTITY CONTRACT (docs/master/16 §2, docs/master/22).
 *
 * The complaint this file answers: "yo didn't made anything procedural". Four
 * palettes is a colour knob, not a procedural world. These tests pin the three
 * laws from world/profile.ts, and they are written as PROPERTIES over many
 * seeds rather than as one golden snapshot — a golden profile would pass while
 * every axis sat at 0.5.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeProfile, buildProfileUnsafe, profileDistance, AXES, hash32, labelFor, idFor,
} from '../src/game/world/profile'

const SEEDS = 2000

test('a seed always makes the same night (determinism)', () => {
  for (let i = 0; i < 300; i++) {
    const s = (i * 2654435761) >>> 0
    const a = makeProfile(s)
    const b = makeProfile(s)
    assert.equal(a.id, b.id)
    assert.equal(a.moon.phase, b.moon.phase)
    assert.equal(a.clouds.coverage, b.clouds.coverage)
    assert.equal(a.aurora.presence, b.aurora.presence)
    assert.equal(a.mood.name, b.mood.name)
    assert.equal(a.label, b.label)
  }
})

test('every axis actually moves across seeds (no dead dials)', () => {
  const seen: Record<string, number[]> = {}
  for (const ax of AXES) seen[`${ax.name}.${ax.field}`] = []
  for (let i = 0; i < SEEDS; i++) {
    const p = makeProfile(hash32(i * 7919 + 13))
    for (const ax of AXES) seen[`${ax.name}.${ax.field}`].push(ax.get(p))
  }
  for (const [key, vals] of Object.entries(seen)) {
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const span = hi - lo
    assert.ok(span > 0.0001, `${key} never changes across ${SEEDS} seeds (span ${span})`)
    // Each axis must use a real fraction of its authored range, or it is a
    // decoration in a config file. 25% is deliberately lenient: several axes
    // are triangular, not uniform.
    const ax = AXES.find((a) => `${a.name}.${a.field}` === key)!
    const authored = ax.hi - ax.lo
    assert.ok(span / authored > 0.25,
      `${key} only spans ${(span / authored * 100).toFixed(0)}% of its authored range (${lo.toFixed(2)}..${hi.toFixed(2)}, mean ${mean.toFixed(2)})`)
  }
})

test('values stay inside their authored ranges (no runaway axis)', () => {
  for (let i = 0; i < SEEDS; i++) {
    const p = makeProfile(hash32(i + 1))
    for (const ax of AXES) {
      const v = ax.get(p)
      assert.ok(v >= ax.lo - 1e-9 && v <= ax.hi + 1e-9,
        `${ax.name}.${ax.field} = ${v} escaped [${ax.lo}, ${ax.hi}] for seed ${p.id}`)
    }
    assert.ok(p.props.density >= 2 && p.props.density <= 5, 'prop density 2..5')
    assert.ok(p.moon.phase >= 0.58 && p.moon.phase <= 1, 'phase is gibbous-or-more')
    assert.ok(p.label.length > 0)
  }
})

test('a new run is never a near-copy of the previous one (novelty floor)', () => {
  // The failure this prevents: two runs in a row that differ only in the grade
  // curve. A player reads that as "the procedural generation is broken", even
  // though every number is technically different.
  let minPair = Infinity
  for (let i = 0; i < 400; i++) {
    const seed = hash32(90001 + i * 7717)
    const prev = hash32(90001 + (i - 1) * 7717)
    const p = makeProfile(seed, [prev])
    const d = profileDistance(p, makeProfile(prev))
    assert.ok(d >= 0.10, `seed ${p.id} landed ${d.toFixed(3)} from the previous run`)
    if (d < minPair) minPair = d
  }
  assert.ok(minPair > 0.09, `closest pair ${minPair.toFixed(3)}`)
})

test('distance is a metric: 0 for itself, symmetric, bounded', () => {
  for (let i = 0; i < 100; i++) {
    const a = makeProfile(hash32(i * 31 + 5))
    const b = makeProfile(hash32(i * 31 + 6))
    assert.equal(profileDistance(a, a), 0)
    const ab = profileDistance(a, b)
    const ba = profileDistance(b, a)
    assert.ok(Math.abs(ab - ba) < 1e-12, 'symmetric')
    assert.ok(ab >= 0 && ab <= 1, `bounded (${ab})`)
  }
})

test('the label says something a human can read', () => {
  const words = new Set<string>()
  for (let i = 0; i < 300; i++) {
    const p = makeProfile(hash32(i * 13 + 1))
    assert.ok(p.label.includes('·'), `label "${p.label}" has no separator`)
    for (const w of p.label.split('·').map((x) => x.trim())) words.add(w)
    assert.equal(labelFor(p), p.label, 'labelFor is a pure mirror')
  }
  // The vocabulary must actually vary, or the label is a constant with dots.
  assert.ok(words.size >= 6, `label vocabulary is ${words.size} words: ${[...words].join(' ')}`)
})

test('ids are distinct and stable', () => {
  const ids = new Set<string>()
  for (let i = 0; i < 500; i++) ids.add(idFor(hash32(i * 97 + 3)))
  assert.ok(ids.size > 490, `only ${ids.size} distinct ids in 500 seeds`)
  for (const id of ids) assert.equal(id.length, 8)
})

test('aurora is rare, and never half-present', () => {
  let on = 0
  for (let i = 0; i < SEEDS; i++) {
    const p = makeProfile(hash32(i * 17 + 29))
    if (p.aurora.presence > 0) {
      on++
      assert.ok(p.aurora.presence >= 0.45, `half-aurora ${p.aurora.presence}`)
    }
  }
  const rate = on / SEEDS
  assert.ok(rate > 0.2 && rate < 0.5, `aurora rate ${(rate * 100).toFixed(1)}% — expected roughly a third`)
})

test('buildProfileUnsafe builds the same profile makeProfile lands on for a fresh seed', () => {
  // makeProfile(seed, []) must not nudge: with no history there is nothing to
  // avoid, and a nudge here would make the seed shown in the URL a lie.
  for (let i = 0; i < 200; i++) {
    const s = hash32(i * 613 + 11)
    assert.equal(makeProfile(s).id, buildProfileUnsafe(s).id)
    assert.equal(makeProfile(s, []).moon.phase, buildProfileUnsafe(s).moon.phase)
  }
})
