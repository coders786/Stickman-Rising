/** THE COMBO DIRECTOR — the randomized empty-hand chain chooser.
 *
 * The authored chain graph says which moves MAY follow which; the director
 * decides which one actually fires. These tests pin the properties that
 * keep strings readable rather than random noise:
 *   · determinism per seed (a replay is reproducible),
 *   · every pick is a legal candidate,
 *   · the ground/air gate is respected,
 *   · anti-repeat (a move is never thrown a third time in a row),
 *   · variety (a long string visits the whole graph, not two branches),
 *   · combo heat escalates toward the closers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ComboDirector, type Requires } from '../src/game/combat/combo-director'

const POOL = ['l2', 'l3', 'l4', 'l5', 'h1', 'h2', 'sakugaBarrage', 'viperPalm', 'cyclone', 'ironRoot', 'launcher']
const ctx = { comboHits: 0, grounded: true }

test('same seed replays the same string', () => {
  const a = new ComboDirector(), b = new ComboDirector()
  a.reseed(12.5, 300); b.reseed(12.5, 300)
  const seqA: string[] = [], seqB: string[] = []
  for (let i = 0; i < 40; i++) {
    const id = a.pick(POOL, ctx)!
    a.record(id); seqA.push(id)
    const jd = b.pick(POOL, ctx)!
    b.record(jd); seqB.push(jd)
  }
  assert.deepEqual(seqA, seqB)
})

test('different seeds produce different strings', () => {
  const run = (seed: number) => {
    const d = new ComboDirector(); d.reseed(seed, seed * 7)
    const out: string[] = []
    for (let i = 0; i < 24; i++) { const id = d.pick(POOL, ctx)!; d.record(id); out.push(id) }
    return out.join(',')
  }
  assert.notEqual(run(1), run(2))
})

test('every pick comes from the offered candidate list', () => {
  const d = new ComboDirector(); d.reseed(3, 40)
  for (let i = 0; i < 300; i++) {
    const id = d.pick(POOL, ctx)!
    assert.ok(POOL.includes(id), `${id} not in pool`)
    d.record(id)
  }
})

test('ground/air gate is respected', () => {
  const requires = (id: string): Requires =>
    id === 'dive' || id === 'a2' ? 'air' : id === 'launcher' ? 'ground' : 'any'
  const pool = ['a2', 'dive', 'launcher', 'l2', 'h1']
  const air = new ComboDirector(), ground = new ComboDirector()
  air.reseed(9, 1); ground.reseed(9, 1)
  for (let i = 0; i < 200; i++) {
    const a = air.pick(pool, { comboHits: 0, grounded: false }, requires)!
    assert.notEqual(a, 'launcher', 'grounded-only move picked in the air')
    air.record(a)
    const g = ground.pick(pool, { comboHits: 0, grounded: true }, requires)!
    assert.ok(g !== 'dive' && g !== 'a2', 'air-only move picked on the ground')
    ground.record(g)
  }
  // nothing legal at all → null, never a fabricated id
  assert.equal(ground.pick(['dive'], { comboHits: 0, grounded: true }, requires), null)
})

test('anti-repeat: a move is never thrown three times in a row', () => {
  const d = new ComboDirector(); d.reseed(21, 90)
  const seq: string[] = []
  for (let i = 0; i < 400; i++) { const id = d.pick(POOL, ctx)!; d.record(id); seq.push(id) }
  for (let i = 2; i < seq.length; i++) {
    assert.ok(!(seq[i] === seq[i - 1] && seq[i] === seq[i - 2]), `triple ${seq[i]} at ${i}`)
  }
})

test('variety: a long string visits the whole graph', () => {
  const d = new ComboDirector(); d.reseed(5, 12)
  const seen = new Set<string>()
  for (let i = 0; i < 120; i++) { const id = d.pick(POOL, ctx)!; d.record(id); seen.add(id) }
  assert.equal(seen.size, POOL.length, `only visited ${[...seen].join(',')}`)
})

test('combo heat escalates toward the closers', () => {
  const finishers = new Set(['srOnslaught', 'srOmega', 'omegaPalm', 'sakugaWrath'])
  const pool = ['l2', 'l3', 'h1', 'omegaPalm', 'srOmega', 'sakugaWrath', 'srOnslaught']
  const rate = (hits: number) => {
    let n = 0
    for (let seed = 0; seed < 40; seed++) {
      const d = new ComboDirector(); d.reseed(seed + 1, seed * 13)
      for (let i = 0; i < 10; i++) {
        const id = d.pick(pool, { comboHits: hits, grounded: true })!
        d.record(id)
        if (finishers.has(id)) n++
      }
    }
    return n
  }
  assert.ok(rate(20) > rate(0), `heat did not escalate: ${rate(20)} vs ${rate(0)}`)
})

test('tempo stays inside the subtle 0.97–1.04 band', () => {
  const d = new ComboDirector()
  for (let i = 0; i < 500; i++) {
    const t = d.tempo()
    assert.ok(t >= 0.97 && t <= 1.04, `tempo ${t} out of band`)
  }
})
