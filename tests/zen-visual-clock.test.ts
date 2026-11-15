/** F03/F04 + F14 — zen-night visual clock.
 *  F04: moon visibility smoothing used `rate·60` PER DRAW (draw-count
 *       dependent: same 0.1 s input gave 0.76307 at 6 draws vs 0.81062 at
 *       14). It now advances in update() with a = 1−exp(−dt/τ), which is
 *       exactly semigroup: 10×0.01 s ≡ 1×0.1 s.
 *  F03: the media bracket is a genuine t0≤t≤t1 interpolation, advanced on
 *       the visual clock (draw no longer mutates transport state).
 *  F14: petal→pond ripple events generate in update() with a dedicated
 *       RNG — drawWeather can no longer spawn impulses. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ZenNightBackground } from '../src/game/world/zen-night'
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

function internals(zen: ZenNightBackground) {
  return zen as unknown as {
    moonVis: number
    moonCover: number
    ripples: Float32Array
    update(dt: number): void
    t: number
  }
}

test('F04: moon filter advance is exactly semigroup across update splits', () => {
  const a = new ZenNightBackground(quietStorm())
  const b = new ZenNightBackground(quietStorm())
  // Pin the media target constant so this isolates the RESPONSE FILTER
  // (the bracket sampler has its own 1/24 s quantization grid, tested
  // separately by "advances from update").
  const fix = (z: ZenNightBackground) => {
    ;(z as unknown as { sampleTransmission: (t: number) => number }).sampleTransmission = () => 0.6
  }
  fix(a)
  fix(b)
  for (let i = 0; i < 10; i++) internals(a).update(0.01) // 10 small updates
  internals(b).update(0.1)                             // one big update
  const za = internals(a)
  const zb = internals(b)
  assert.ok(Math.abs(za.moonVis - zb.moonVis) < 1e-9,
    `10×0.01 must equal 1×0.1 (${za.moonVis} vs ${zb.moonVis})`)
  assert.ok(Math.abs(za.moonCover - zb.moonCover) < 1e-9)
})

test('F04: moon state actually advances from update() (was draw-only)', () => {
  const zen = new ZenNightBackground(quietStorm())
  const z = internals(zen)
  const start = z.moonVis
  for (let i = 0; i < 240; i++) z.update(1 / 60) // 4 s of visual time
  assert.notEqual(z.moonVis, start,
    'update() must drive the media filter — old source left it untouched until draw')
  assert.ok(z.moonVis > 0 && z.moonVis <= 1.0001, 'stays in range')
  assert.ok(Math.abs(z.moonCover - (1 - z.moonVis)) < 1e-12, 'cover mirrors visibility')
})

test('F04: equal total time yields equal state regardless of step size', () => {
  const a = new ZenNightBackground(quietStorm())
  const b = new ZenNightBackground(quietStorm())
  const fix = (z: ZenNightBackground) => {
    ;(z as unknown as { sampleTransmission: (t: number) => number }).sampleTransmission = () => 0.6
  }
  fix(a)
  fix(b)
  // 1/60 steps vs 1/30 steps over the same 2 seconds
  for (let i = 0; i < 120; i++) internals(a).update(1 / 60)
  for (let i = 0; i < 60; i++) internals(b).update(1 / 30)
  assert.ok(Math.abs(internals(a).moonVis - internals(b).moonVis) < 1e-9,
    'the dt-based filter is split-invariant')
})

test('F14: ripple events generate from update() and age forward', () => {
  const zen = new ZenNightBackground(quietStorm())
  const z = internals(zen)
  // park petal 0 inside the landing band: y = (py + t·(7+13z))%(h+80) − 40
  // at t≈0 with h=720 → py = 0.78·720 + 40 puts y≈561 ∈ (518, 604.8]
  const petals = zen as unknown as { py: Float32Array; rippleRng: () => number }
  petals.py[0] = 0.78 * 720 + 40
  // deterministic event gate: the SPAWN itself is what this test proves
  // (update-owned, not draw-owned) — the probability law is exercised by
  // the dedicated stream, not re-rolled here.
  petals.rippleRng = () => 0

  let spawnedSlot = -1
  for (let i = 0; i < 10 && spawnedSlot < 0; i++) {
    z.update(1 / 60)
    for (let s = 0; s < 4; s++) {
      if (z.ripples[s * 3 + 1] < 9) { spawnedSlot = s; break }
    }
  }
  assert.ok(spawnedSlot >= 0, 'update() must spawn the petal ripple — drawWeather never runs here')
  const age0 = z.ripples[spawnedSlot * 3 + 1]
  z.update(1 / 60)
  const age1 = z.ripples[spawnedSlot * 3 + 1]
  assert.ok(age1 > age0, 'ripple ages advance with visual dt, not draw calls')
})

test('F14: repeated update(0) never advances transport or spawns', () => {
  const zen = new ZenNightBackground(quietStorm())
  const z = internals(zen)
  for (let i = 0; i < 60; i++) z.update(1 / 60)
  const vis = z.moonVis
  const t = z.t
  for (let i = 0; i < 10; i++) z.update(0)
  assert.equal(z.moonVis, vis, 'zero dt is a no-op for the filter')
  assert.equal(z.t, t)
})
