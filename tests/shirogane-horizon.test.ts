/** Shirogane horizon — PRE-GENERATED and BOUNDED.
 *  The whole point of the port: the horizon is planned by pure code
 *  (planHorizon) with hard caps, and every bake happens in ensure() /
 *  resize() — never during play, never inside update(). Streaming new
 *  content mid-frame is structurally impossible: the plan is enumerable
 *  before a single pixel exists. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planHorizon,
  ridgeHeight,
  MAX_HORIZON_CHUNKS,
  MAX_HORIZON_PROPS,
  ShiroganeHorizonBackground,
} from '../src/game/world/shirogane'
import type { StormEngine } from '../src/game/world/storm'

function quietStorm(): StormEngine {
  return {
    wind: 0.38,
    setRainScale() {},
    intensity: 0,
    boltActive: false,
    azimuthValue: 0,
  } as unknown as StormEngine
}

test('planHorizon: complete, bounded, unique ids, inside the arena', () => {
  const plan = planHorizon()
  assert.equal(plan.chunks, MAX_HORIZON_CHUNKS, 'chunk count is the declared cap')
  assert.ok(plan.props.length > 0, 'the horizon has props')
  assert.ok(plan.props.length <= MAX_HORIZON_PROPS,
    `props ${plan.props.length} must not exceed MAX_HORIZON_PROPS ${MAX_HORIZON_PROPS}`)
  const ids = new Set<string>()
  for (const p of plan.props) {
    assert.ok(!ids.has(p.id), `duplicate prop id ${p.id}`)
    ids.add(p.id)
    assert.ok(p.x >= -190 && p.x <= 2790, `prop ${p.id} at ${p.x} outside arena slack`)
    assert.ok(p.lane >= 0 && p.lane <= 4, `prop ${p.id} lane ${p.lane} out of range`)
    assert.ok(p.scale > 0 && p.scale < 4, `prop ${p.id} scale ${p.scale} implausible`)
  }
  // deterministic: same plan on every call (no hidden RNG state)
  const again = planHorizon()
  assert.deepEqual(again.props, plan.props, 'planning is pure and reproducible')
})

test('ridgeHeight: finite, plausible relief for every range over the domain', () => {
  // strips sample u across the full camera parallax domain (normalized to
  // viewport widths) — cover it with slack in both directions
  for (let k = 0; k < 4; k++) {
    for (let x = -0.8; x <= 4.0; x += 0.02) {
      const y = ridgeHeight(x, k, 1)
      assert.ok(Number.isFinite(y), `k=${k} x=${x.toFixed(2)} not finite`)
      assert.ok(y > 0.2 && y < 1.2, `k=${k} x=${x.toFixed(2)} height ${y} outside relief band`)
    }
  }
})

test('update never bakes; bakes only move via ensure/resize (draw-owned)', () => {
  const bg = new ShiroganeHorizonBackground(quietStorm())
  const z = bg as unknown as { stats: { bakes: number }; update(dt: number): void }
  assert.equal(z.stats.bakes, 0, 'constructor must not bake (headless-safe)')
  for (let i = 0; i < 300; i++) z.update(1 / 60)
  assert.equal(z.stats.bakes, 0, '5 simulated seconds bake nothing')
})

test('the declared caps match the fixed world span', () => {
  // ARENA_W = 3000, CHUNK_W = 560 → ceil(3000/560)+1 = 7 chunks
  assert.equal(MAX_HORIZON_CHUNKS, 7)
  assert.equal(MAX_HORIZON_PROPS, 7 * 8 + 12)
})
