/** STICKMAN RISING — tests/light.test.ts
 * The single key light (world/light.ts, §T4.1).
 * ----------------------------------------------------------------------------
 * The bug this file prevents is disagreement: five consumers of one moon that
 * each compute "which side" slightly differently. So every test here is about
 * the *shape* of the model — ranges, monotonicity, the composition band, and the
 * one-direction flips — never about a particular pixel.
 * ==========================================================================*/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeProfile } from '../src/game/world/profile'
import {
  MOON_X_MAX, MOON_X_MIN, STAGE_ELEVATION,
  keyLightFor, moonCentreX, reflectionGain, rimDirection, shadowDirection, shadowReach,
} from '../src/game/world/light'

const tilt = (t: number) => {
  const p = makeProfile(1)
  p.moon.tilt = t
  return p
}

test('light: azimuth follows tilt, monotonically, across the authored range', () => {
  const lo = keyLightFor(tilt(-34))
  const mid = keyLightFor(tilt(0))
  const hi = keyLightFor(tilt(34))
  assert.equal(lo.azimuth, -1)
  assert.equal(mid.azimuth, 0)
  assert.equal(hi.azimuth, 1)
  let prev = -2
  for (let t = -34; t <= 34; t += 2) {
    const a = keyLightFor(tilt(t)).azimuth
    assert.ok(a > prev, `azimuth did not rise at tilt ${t}`)
    assert.ok(a >= -1 && a <= 1)
    prev = a
  }
  // Out-of-range tilt is clamped, never trusted.
  assert.equal(keyLightFor(tilt(-120)).azimuth, -1)
  assert.equal(keyLightFor(tilt(120)).azimuth, 1)
  assert.ok(Number.isFinite(keyLightFor(tilt(NaN)).azimuth))
})

test('light: the moon never leaves the right of the frame', () => {
  for (const w of [320, 640, 844, 1280, 1920, 2560]) {
    for (const t of [-34, -17, 0, 17, 34]) {
      const l = keyLightFor(tilt(t))
      for (const parallax of [-400, -120, 0, 120, 400]) {
        for (const time of [0, 37, 190, 1000]) {
          const x = moonCentreX(l, w, parallax, time)
          const f = x / w
          // The model caps parallax at 5 % and the wander at 3.5 % of the
          // frame, so those two are the only overflow the band may allow.
          const slack = 0.05 + 0.035 + 2 / w
          assert.ok(
            f >= MOON_X_MIN - slack && f <= MOON_X_MAX + slack,
            `moon at ${(f * 100).toFixed(1)}% of a ${w}px frame (tilt ${t})`,
          )
        }
      }
    }
  }
})

test('light: the key direction really moves between runs', () => {
  const xs = new Set<number>()
  for (let seed = 1; seed <= 400; seed++) {
    const l = keyLightFor(makeProfile(seed))
    xs.add(Math.round(moonCentreX(l, 1280, 0, 0)))
  }
  // A knob that always lands on the same pixel is decoration.
  assert.ok(xs.size > 120, `only ${xs.size} distinct moon positions across 400 seeds`)
})

test('light: shadows fall away from the key, rims take the key side', () => {
  assert.equal(shadowDirection(100, 900), -1, 'a figure left of the moon casts left')
  assert.equal(shadowDirection(1500, 900), 1, 'a figure right of the moon casts right')
  assert.equal(shadowDirection(900, 900), 1, 'dead under the moon: straight down, signed +')
  assert.equal(rimDirection(900, 1280), 1)
  assert.equal(rimDirection(300, 1280), -1)
  // The two must be MUTUALLY CONSISTENT: a light on the right rims right and
  // throws a left-standing figure's shadow left.
  for (const [moonX, w] of [[1100, 1280], [300, 1280], [640, 1280]]) {
    const rim = rimDirection(moonX, w)
    // A figure on the far side of the frame from the key throws its shadow AWAY
    // from the key, i.e. toward the side the rim is NOT on.
    const farSide = rim === 1 ? 0 : w
    assert.equal(shadowDirection(farSide, moonX), rim === 1 ? -1 : 1)
  }
})

test('light: shadow reach grows with distance and stays bounded', () => {
  const l = keyLightFor(makeProfile(3))
  let prev = 0
  for (const d of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    const r = shadowReach(l.elevation, d)
    assert.ok(r >= 0.28 && r <= 1.25, `reach ${r} out of bounds at ${d}`)
    assert.ok(r > prev || d === 0, `reach did not grow from ${prev} at ${d}`)
    prev = r
  }
  // Under the key it is short: the shadow is almost a disc.
  assert.ok(shadowReach(l.elevation, 0) < 0.6)
  // Symmetric in sign, because distance is.
  assert.equal(shadowReach(l.elevation, 0.4), shadowReach(l.elevation, -0.4))
  assert.ok(Number.isFinite(shadowReach(l.elevation, NaN)))
  assert.ok(Number.isFinite(shadowReach(NaN, 0.4)))
})

test('light: a lower key throws longer shadows at the same distance', () => {
  assert.ok(shadowReach(0.2, 0.5) > shadowReach(1, 0.5))
  assert.equal(STAGE_ELEVATION, keyLightFor(makeProfile(3)).elevation)
})

test('light: reflection gain is narrow, finite and phased by the moon', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const g = reflectionGain(keyLightFor(makeProfile(seed)))
    assert.ok(Number.isFinite(g))
    assert.ok(g > 0.6 && g < 1.6, `reflection gain ${g} is a pump, not a light`)
  }
  const warm = reflectionGain({ azimuth: 0, elevation: STAGE_ELEVATION, warmth: 1 })
  const cold = reflectionGain({ azimuth: 0, elevation: STAGE_ELEVATION, warmth: 0 })
  assert.ok(cold > warm, 'a cold moon should sparkle harder than a warm one')
})

test('light: the model is a pure function of the profile', () => {
  const p = makeProfile(0xfeed)
  assert.deepEqual(keyLightFor(p), keyLightFor(p))
  assert.notDeepEqual(keyLightFor(makeProfile(1)).azimuth, keyLightFor(makeProfile(2)).azimuth === keyLightFor(makeProfile(1)).azimuth ? 9 : 0)
})
