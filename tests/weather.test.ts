/** STICKMAN RISING — tests/weather.test.ts
 * The weather front's laws (world/weather.ts, docs/master §T5.1).
 * ----------------------------------------------------------------------------
 * These are the properties a player would report as bugs if they broke:
 *  · a change is a fade, never a cut;
 *  · changes are minutes apart, not seconds;
 *  · never during a flash;
 *  · the same seed always produces the same weather, so a bug is reproducible;
 *  · a stormy run is stormier than a settled one — over a long enough run.
 * All of it is pure: no canvas, no clock, no DOM.
 * ==========================================================================*/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DWELL, FADE, WeatherFront, WEATHER_BANDS, WEATHER_ORDER, bandWeights, minJerk, tintAlpha, tintColour,
} from '../src/game/world/weather'

/** Drive the front at 60 Hz for `seconds`, with a lightning signal callback. */
function run(front: WeatherFront, seconds: number, lightning: (t: number) => number = () => 0) {
  const dt = 1 / 60
  const steps = Math.round(seconds / dt)
  const log: { t: number; kind: string; fading: boolean }[] = []
  let last = front.sample.kind
  for (let i = 0; i < steps; i++) {
    const t = i * dt
    front.update(dt, lightning(t))
    if (front.sample.kind !== last) {
      log.push({ t, kind: front.sample.kind, fading: front.fading })
      last = front.sample.kind
    }
  }
  return log
}

test('weather: min-jerk is a proper ease with zero end velocities', () => {
  assert.equal(minJerk(0), 0)
  assert.equal(minJerk(1), 1)
  assert.ok(Math.abs(minJerk(0.5) - 0.5) < 1e-9, 'the midpoint must be the middle')
  // Monotonic, and flat at both ends (the whole point of the quintic).
  let prev = 0
  for (let i = 0; i <= 100; i++) {
    const v = minJerk(i / 100)
    assert.ok(v >= prev - 1e-12, 'the ease went backwards')
    prev = v
  }
  assert.ok(minJerk(0.02) < 0.002, 'the ease starts too fast to read as a reach')
  assert.ok(minJerk(0.98) > 0.998, 'the ease does not settle')
})

test('weather: a change is a 9-second fade, never a cut', () => {
  const f = new WeatherFront(12345, 0.6, 1.0, 'clear')
  // Step until the first change, and look at the frame it happens on.
  const dt = 1 / 60
  let guard = 0
  while (f.changes === 0 && guard++ < 60 * 90) f.update(dt, 0)
  assert.equal(f.changes, 1, 'the front never changed in 90 s')
  assert.ok(f.sample.s < 0.02, `a change started at s=${f.sample.s}`)
  assert.ok(f.fading, 'the front reported settled right after a change')
  // The new band is only reached after a fade's worth of time, not before.
  const half = Math.round((FADE * 0.5) / dt)
  for (let i = 0; i < half; i++) f.update(dt, 0)
  assert.ok(f.sample.s > 0.2 && f.sample.s < 0.8, `mid-fade s=${f.sample.s.toFixed(3)}`)
  assert.ok(f.fading, 'the fade finished in half its time')
})

test('weather: every fade finishes inside FADE seconds and lands exactly on the band', () => {
  const f = new WeatherFront(999, 1.2, 1.1, 'clear')
  run(f, DWELL + 1)
  const kind = f.sample.kind
  run(f, FADE + 0.5)
  // Past the fade, the sample IS the band (interpolation must land, not approach).
  assert.equal(f.sample.from, f.sample.kind, 'from/kind did not converge')
  assert.equal(f.sample.s, 1)
  for (const key of ['rain', 'fog', 'gust', 'tint', 'wet'] as const) {
    assert.ok(Math.abs(f.sample[key] - WEATHER_BANDS[kind][key]) < 1e-6, `${key} did not land on ${kind}`)
  }
})

test('weather: two changes never start closer than DWELL seconds', () => {
  const f = new WeatherFront(0xbeef, 1.35, 1.35)
  const log = run(f, 600)
  assert.ok(log.length >= 8, `only ${log.length} changes in 10 minutes — the front is asleep`)
  for (let i = 1; i < log.length; i++) {
    const gap = log[i].t - log[i - 1].t
    assert.ok(gap >= DWELL - 1e-6, `changes only ${gap.toFixed(2)} s apart at t=${log[i].t.toFixed(1)}`)
  }
})

test('weather: the front holds while lightning is strobing', () => {
  const f = new WeatherFront(4242, 1.3, 1.2)
  // Lightning is on from t=0, so the door never opens.
  const log = run(f, DWELL * 3, () => 1)
  assert.equal(log.length, 0, 'the weather changed under a flash')
  assert.ok(f.heldForFlash > DWELL, 'the hold was not recorded')
  // The moment it clears, the change happens (the hold is a delay, not a veto).
  const after = run(f, DWELL + FADE + 2, () => 0)
  assert.ok(after.length >= 1, 'the front never resumed after the flash')
})

test('weather: same seed, same weather (a bug report needs a repeatable sky)', () => {
  const a = new WeatherFront(0x51eed, 0.9, 1.0)
  const b = new WeatherFront(0x51eed, 0.9, 1.0)
  const la = run(a, 400).map((e) => e.kind)
  const lb = run(b, 400).map((e) => e.kind)
  assert.deepEqual(la, lb)
  // Different seeds must diverge, or the seed is decoration.
  const c = new WeatherFront(0x51eee, 0.9, 1.0)
  assert.notDeepEqual(run(c, 400).map((e) => e.kind), la)
})

test('weather: a stormy run is stormier than a settled one', () => {
  const count = (bias: number) => {
    const f = new WeatherFront(777, bias, 1.0)
    const log = run(f, 1800)
    return log.filter((e) => e.kind === 'rain' || e.kind === 'squall').length
  }
  const calm = count(0.35)
  const stormy = count(1.35)
  assert.ok(stormy > calm, `stormy run had ${stormy} wet bands, calm had ${calm}`)
})

test('weather: band weights are positive, finite, and move with the axes', () => {
  for (const bias of [0.35, 0.6, 1, 1.35]) {
    for (const wet of [0.7, 1, 1.35]) {
      const w = bandWeights(bias, wet)
      let total = 0
      for (const k of WEATHER_ORDER) {
        assert.ok(Number.isFinite(w[k]), `${k} weight is not finite`)
        assert.ok(w[k] >= 0, `${k} weight is negative`)
        total += w[k]
      }
      assert.ok(total > 0, 'no band is possible — the front would freeze')
    }
  }
  const calm = bandWeights(0.35, 1)
  const stormy = bandWeights(1.35, 1)
  assert.ok(stormy.squall > calm.squall * 3, 'storm bias barely moved the squall weight')
  assert.ok(calm.clear > stormy.clear, 'a calm run should be clearer than a stormy one')
  // Out-of-range input must be clamped, not propagated.
  const wild = bandWeights(-5, 99)
  for (const k of WEATHER_ORDER) assert.ok(Number.isFinite(wild[k]) && wild[k] >= 0)
})

test('weather: the sample is always sane, every frame, for a whole run', () => {
  const f = new WeatherFront(31337, 1.0, 1.0)
  const dt = 1 / 60
  for (let i = 0; i < 60 * 240; i++) {
    f.update(dt, i % 900 < 6 ? 1 : 0)
    const s = f.sample
    assert.ok(WEATHER_ORDER.includes(s.kind))
    assert.ok(s.s >= 0 && s.s <= 1, `s=${s.s}`)
    for (const key of ['rain', 'fog', 'gust', 'tint', 'wet'] as const) {
      assert.ok(Number.isFinite(s[key]), `${key} went non-finite at frame ${i}`)
    }
    // Nothing may exceed the widest authored band: interpolation stays inside.
    const maxRain = Math.max(...WEATHER_ORDER.map((k) => WEATHER_BANDS[k].rain))
    assert.ok(s.rain <= maxRain + 1e-9, 'rain exceeded every authored band')
  }
})

test('weather: a stalled frame cannot skip a fade', () => {
  const f = new WeatherFront(8080, 1.2, 1.2)
  const dt = 1 / 60
  let guard = 0
  while (f.changes === 0 && guard++ < 60 * 90) f.update(dt, 0)
  const s0 = f.sample.s
  assert.ok(s0 < 0.05, 'setup: the fade had already run')
  f.update(30, 0) // a tab-switch resume, 30 s late
  assert.ok(f.sample.s < 1, 'a 30 s stall teleported the weather')
  assert.ok(f.sample.s > s0, 'the stall did not advance the fade at all')
  // ...and the clamp is a quarter-second, so a stall advances ~1/36 of a fade.
  assert.ok(f.sample.s < 0.2, `one stalled frame advanced the fade to ${f.sample.s.toFixed(3)}`)
})

test('weather: reset re-identifies the front without allocating', () => {
  const f = new WeatherFront(1, 1, 1)
  run(f, 120)
  const before = f.changes
  f.reset(0xabc, 1.3, 1.3)
  assert.equal(f.changes, 0)
  assert.ok(before >= 0)
  assert.ok(f.sample.s === 1 && f.sample.kind === f.sample.from)
  // ...and the reset front behaves like a fresh one with that seed.
  const g = new WeatherFront(0xabc, 1.3, 1.3)
  assert.deepEqual(run(f, 200).map((e) => e.kind), run(g, 200).map((e) => e.kind))
})

test('weather: tint helper is quantised so the draw path can cache it', () => {
  assert.notEqual(tintColour(0.3), tintColour(-0.3))
  assert.equal(tintColour(0), '255,150,74')
  for (const t of [-1, -0.5, -0.01, 0, 0.01, 0.5, 1]) {
    const a = tintAlpha(t)
    assert.ok(a >= 0 && a <= 0.12, `alpha ${a} out of range`)
    assert.ok(Math.abs(a * 32 - Math.round(a * 32)) < 1e-9, 'alpha is not on the 1/32 grid')
  }
  assert.equal(tintAlpha(1), Math.floor(0.12 * 32) / 32)
  assert.equal(tintAlpha(0), 0)
})
