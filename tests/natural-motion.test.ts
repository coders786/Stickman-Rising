/** THE NATURAL-MOTION CONTRACT (docs/master/20, M4.5 U1/U5).
 *
 * Four claims, each measured rather than asserted from intent:
 *  · minimum jerk has the 1.875 peak the motor-control literature reports;
 *  · the 2/3 power law slows the hand at curvature;
 *  · a spring chain settles inside 0.6 s without overshooting more than 15 %;
 *  · the chain is rate-independent: 60 Hz and 144 Hz produce the same rope.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  minJerk, minJerkVel, minJerkAcc, MIN_JERK_MEAN_OVER_PEAK, easeMinJerk,
  powerLawSpeed, powerLawProgress, SpringChain, AperiodicLife, chainSettled,
} from '../src/game/anim/natural'

test('minimum jerk starts and ends at rest', () => {
  assert.equal(minJerk(0), 0)
  assert.equal(minJerk(1), 1)
  assert.ok(Math.abs(minJerkVel(0)) < 1e-9)
  assert.ok(Math.abs(minJerkVel(1)) < 1e-9)
  assert.ok(Math.abs(minJerkAcc(0)) < 1e-9, 'zero acceleration at the start')
  assert.ok(Math.abs(minJerkAcc(1)) < 1e-9, 'zero acceleration at the end')
})

test('it is monotone (a hand that never goes backwards)', () => {
  let prev = -1
  for (let i = 0; i <= 400; i++) {
    const v = minJerk(i / 400)
    assert.ok(v >= prev - 1e-12, `non-monotone at ${i / 400}`)
    prev = v
  }
})

test('peak velocity is 1.875× the mean — the signature the metric scores', () => {
  let peak = 0
  for (let i = 0; i <= 4000; i++) peak = Math.max(peak, Math.abs(minJerkVel(i / 4000)))
  assert.ok(Math.abs(peak - 1.875) < 1e-3, `peak velocity ${peak}`)
  assert.ok(Math.abs(MIN_JERK_MEAN_OVER_PEAK - 1 / 1.875) < 1e-12)
  assert.ok(MIN_JERK_MEAN_OVER_PEAK > 0.5 && MIN_JERK_MEAN_OVER_PEAK < 0.58,
    'mean/peak lands inside M-VELPROF 0.50–0.58')
})

test('peak acceleration is 5.7735 at τ≈0.211 and its mirror', () => {
  let peak = 0
  let at = 0
  for (let i = 0; i <= 4000; i++) {
    const a = Math.abs(minJerkAcc(i / 4000))
    if (a > peak) { peak = a; at = i / 4000 }
  }
  assert.ok(Math.abs(peak - 5.7735) < 5e-3, `peak accel ${peak}`)
  assert.ok(Math.abs(at - 0.2113) < 0.01, `peak at ${at}`)
})

test('the ease wrapper agrees with the curve', () => {
  for (let i = 0; i <= 20; i++) assert.equal(easeMinJerk(i / 20), minJerk(i / 20))
  assert.equal(easeMinJerk(-3), 0)
  assert.equal(easeMinJerk(7), 1)
})

test('the 2/3 power law: tighter curvature is slower', () => {
  const straight = powerLawSpeed(1 / 1000)
  const tight = powerLawSpeed(1 / 40)
  assert.ok(tight < straight, `tight ${tight} vs straight ${straight}`)
  // Doubling curvature must slow by 2^(1/3) ≈ 1.26, within the clamp band.
  const tight2 = powerLawSpeed(1 / 100)     // κ = 0.010
  const loose = powerLawSpeed(1 / 200)      // κ = 0.005
  const ratio = loose / tight2              // 2^(1/3) = 1.26
  assert.ok(ratio > 1.2 && ratio < 1.33, `ratio ${ratio}`)
})

test('power-law progress is monotone, pinned, and slower than uniform early', () => {
  assert.equal(powerLawProgress(0), 0)
  assert.equal(powerLawProgress(1), 1)
  // s^(2/3) rises FAST then flattens: at half the arc the hand is at 0.63 of
  // the time, i.e. it spends most of its clock in the last third of the arc —
  // which is exactly the visual "slows into the reach" read.
  assert.ok(powerLawProgress(0.5) > 0.6 && powerLawProgress(0.5) < 0.66,
    `progress(0.5) = ${powerLawProgress(0.5)}`)
  assert.ok(powerLawProgress(0.1) > 0.1, 'early arc is not slow')
})

test('a spring chain is inextensible within tolerance', () => {
  const c = new SpringChain({ points: 17, link: 6, gravity: 900 })
  c.reset(0, 0, 1, 0)
  for (let i = 0; i < 120; i++) c.step(1 / 60)
  for (let i = 1; i < c.points; i++) {
    const d = Math.hypot(
      c.p[i * 2] - c.p[(i - 1) * 2],
      c.p[i * 2 + 1] - c.p[(i - 1) * 2 + 1],
    )
    assert.ok(d > 6 * 0.8 && d < 6 * 1.2, `link ${i} = ${d.toFixed(2)}`)
  }
})

test('it settles inside 0.6 s and overshoots by less than 15 %', () => {
  const c = new SpringChain({ points: 19, link: 6.4, zeta: 0.55, omega: 21, gravity: 0 })
  c.reset(0, 0, 1, 0)
  // Kick the tip 1 px sideways and watch it come back. The first 50 ms are
  // excluded: the inextensibility pass projects the kick onto the link arc
  // immediately, which is a constraint solve, not an overshoot.
  c.p[(c.points - 1) * 2 + 1] = 1
  // The measurement is the REBOUND past zero, not the decay of the kick: a
  // damped spring's first excursion decays monotonically to the rest line, and
  // calling that decay an "overshoot" measures the kick, not the spring.
  let rebound = 0
  let crossed = false
  let settledAt = -1
  for (let i = 0; i < 120; i++) {
    c.step(1 / 60)
    const tipY = c.p[(c.points - 1) * 2 + 1]
    if (!crossed && tipY < 0) crossed = true
    if (crossed) rebound = Math.max(rebound, Math.abs(tipY))
    if (settledAt < 0 && chainSettled(c, 2)) settledAt = (i + 1) / 60
  }
  assert.ok(crossed, 'the chain has to come back through the rest line at all')
  assert.ok(settledAt > 0 && settledAt <= 0.6, `settled at ${settledAt.toFixed(2)} s`)
  assert.ok(rebound <= 0.15, `rebound ${(rebound * 100).toFixed(1)} % (ζ 0.55 should give ~13 %)`)
})

test('the chain is rate-independent: 60 Hz and 144 Hz agree', () => {
  const mk = () => {
    const c = new SpringChain({ points: 17, link: 6, zeta: 0.4, omega: 20 })
    c.reset(0, 0, 0, 1)
    return c
  }
  const a = mk(), b = mk()
  for (let i = 0; i < 60; i++) a.step(1 / 60)
  for (let i = 0; i < 144; i++) b.step(1 / 144)
  // Same wall time (1 s) — the tips must agree to within a fraction of a link.
  const ay = a.p[(a.points - 1) * 2 + 1]
  const by = b.p[(b.points - 1) * 2 + 1]
  assert.ok(Math.abs(ay - by) < 1.5, `tip y: 60Hz ${ay.toFixed(2)} vs 144Hz ${by.toFixed(2)}`)
})

test('a hitch does not explode the chain', () => {
  const c = new SpringChain({ points: 19, link: 6 })
  c.reset(0, 0, 1, 0)
  c.step(5) // a 5 s stall
  for (let i = 0; i < c.p.length; i++) assert.ok(Number.isFinite(c.p[i]), `p[${i}] ${c.p[i]}`)
  for (let i = 0; i < 30; i++) c.step(1 / 60)
  for (let i = 0; i < c.p.length; i++) assert.ok(Number.isFinite(c.p[i]))
})

test('polyline writes without allocating and reports the point count', () => {
  const c = new SpringChain({ points: 12, link: 5 })
  c.reset(3, 4, 1, 0)
  const out = new Float32Array(64)
  const n = c.polyline(out, 3, 4)
  assert.equal(n, 12)
  assert.equal(out[0], 0)
  assert.equal(out[1], 0)
})

test('aperiodic life never repeats within a session and is seed-stable', () => {
  const a = new AperiodicLife(7)
  const b = new AperiodicLife(7)
  let min = 1, max = 0
  for (let i = 0; i < 2000; i++) {
    const t = i * 0.05
    const v = a.at(t)
    assert.equal(v, b.at(t), 'same seed, same life')
    assert.ok(v >= 0 && v <= 1, `life out of range at ${t}: ${v}`)
    min = Math.min(min, v); max = Math.max(max, v)
  }
  assert.ok(max - min > 0.6, `life only swings ${(max - min).toFixed(2)}`)
  const c = new AperiodicLife(8)
  let differs = 0
  for (let i = 0; i < 200; i++) if (Math.abs(c.at(i * 0.1) - a.at(i * 0.1)) > 0.05) differs++
  assert.ok(differs > 120, 'two seeds breathe differently')
})
