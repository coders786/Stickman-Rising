/** F05 — wind displacement continuity under varying strength.
 *  The closed form D(t) = 0.85·s·F(t) is exact only while s is constant.
 *  storm.wind varies continuously (0.38 + 0.12·sin(t·0.7)), so multiplying
 *  the antiderivative by the current strength introduced jumps of
 *  0.85·Δs·F(t) (F(t) grows ~t) and broke dD/dt = vx (the derivative-
 *  identity witness: reported vx 0.53 vs displacement finite difference
 *  1.10 at t=10). ZenNight.update now integrates piecewise-constant
 *  strength segments and carries the offset continuously. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { windAt } from '../src/game/render/bhst'
import { ZenNightBackground } from '../src/game/world/zen-night'
import type { StormEngine } from '../src/game/world/storm'

function controlledStorm(wind: { s: number }): StormEngine {
  // minimal storm stand-in: ZenNight.update only reads .wind (and the
  // constructor calls setRainScale). Draw paths are never exercised here.
  return {
    get wind() { return wind.s },
    setRainScale() {},
    intensity: 0,
    boltActive: false,
    azimuthValue: 0,
  } as unknown as StormEngine
}

function internal(zen: ZenNightBackground) {
  return zen as unknown as {
    windIntegralX: number
    update(dt: number): void
    t: number
  }
}

test('constant strength: piecewise integration equals the closed form exactly', () => {
  const wind = { s: 1 }
  const zen = new ZenNightBackground(controlledStorm(wind))
  const z = internal(zen)
  for (let i = 0; i < 100; i++) z.update(0.01) // t → 1.0
  const t = z.t
  const closed = windAt(t, 1)[2] // unit primitive (0.85 carrier included) × s=1
  assert.ok(Math.abs(z.windIntegralX - closed) < 1e-6,
    `piecewise must telescope to windAt(t,s) (got ${z.windIntegralX}, want ${closed})`)
})

test('strength change never teleports the accumulated displacement', () => {
  const wind = { s: 1 }
  const zen = new ZenNightBackground(controlledStorm(wind))
  const z = internal(zen)
  // wind up to t = 5 where F(t) ≈ 4.5 — an old m(t)·F(t) recomputation
  // would jump by 0.85·Δs·|F| ≈ 1.9 when strength halves.
  for (let i = 0; i < 500; i++) z.update(0.01)
  const before = z.windIntegralX
  wind.s = 0.5
  z.update(0.01)
  const step = Math.abs(z.windIntegralX - before)
  // proper increment ≈ 0.85·s_prev·vx·dt ≈ 0.01 — tiny; a jump ≈ 1.9
  assert.ok(step < 0.1, `strength change must stay continuous (jump was ${step.toFixed(3)})`)
  // and keeps integrating under the new strength without discontinuity
  const before2 = z.windIntegralX
  for (let i = 0; i < 10; i++) z.update(0.01)
  const step2 = Math.abs(z.windIntegralX - before2)
  assert.ok(step2 < 0.2, `later motion stays bounded (moved ${step2.toFixed(3)})`)
})

test('finite-difference displacement tracks the reported velocity at constant strength', () => {
  const wind = { s: 1 }
  const zen = new ZenNightBackground(controlledStorm(wind))
  const z = internal(zen)
  for (let i = 0; i < 300; i++) z.update(0.01)
  const d0 = z.windIntegralX
  const t0 = z.t
  z.update(0.01)
  const fd = (z.windIntegralX - d0) / (z.t - t0)
  const vx = windAt(z.t, 1)[0] // unit-strength velocity at s=1
  assert.ok(Math.abs(fd - vx) < 0.05,
    `dD/dt must equal the reported velocity (fd=${fd.toFixed(3)}, vx=${vx.toFixed(3)})`)
})
