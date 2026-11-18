/** STICKMAN RISING — tests/clouds.test.ts
 * The cumulus bank's parameter law (world/clouds.ts).
 * ----------------------------------------------------------------------------
 * The bank replaced three soft sheets' worth of haze with ONE silhouette, and
 * the whole reason it is allowed to exist is that it is conditional: on a clear
 * night it is not there at all. These tests pin that down — presence, the ramp
 * from the threshold, billow count, tear, lift — and the DOM guard that keeps
 * the headless gate from touching a canvas.
 * ==========================================================================*/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeProfile } from '../src/game/world/profile'
import { bankParams, buildCloudBank } from '../src/game/world/clouds'

const withClouds = (coverage: number, texture = 0.5, altitude = 1) => {
  const p = makeProfile(4242)
  p.clouds.coverage = coverage
  p.clouds.texture = texture
  p.clouds.altitude = altitude
  return p
}

test('clouds: a clear night has no bank at all', () => {
  for (const cov of [0, 0.1, 0.25, 0.4]) {
    const b = bankParams(withClouds(cov))
    assert.equal(b.present, false, `coverage ${cov} should be clear`)
    assert.equal(b.opacity, 0, `coverage ${cov} still has opacity ${b.opacity}`)
  }
})

test('clouds: opacity ramps from the 0.4 threshold and is capped', () => {
  let prev = 0
  for (const cov of [0.45, 0.55, 0.7, 0.85, 0.95, 1]) {
    const b = bankParams(withClouds(cov))
    assert.equal(b.present, true)
    assert.ok(b.opacity > 0, `coverage ${cov} is present but transparent`)
    assert.ok(b.opacity <= 0.85, `coverage ${cov} exceeded the 0.85 cap`)
    assert.ok(b.opacity >= prev, `opacity went down from ${prev} at ${cov}`)
    prev = b.opacity
  }
  // Never the only thing holding the sky up: even overcast stops short of 1.
  assert.ok(bankParams(withClouds(1)).opacity < 1)
})

test('clouds: billows grow with coverage and stay inside a sane budget', () => {
  const lo = bankParams(withClouds(0.42)).billows
  const hi = bankParams(withClouds(0.95)).billows
  assert.ok(hi > lo, 'a fuller sky must have a busier silhouette')
  assert.ok(lo >= 10 && hi <= 40, `billow budget ${lo}..${hi} out of range`)
})

test('clouds: texture is carried through, and altitude moves the band', () => {
  assert.equal(bankParams(withClouds(0.7, 0.1)).torn, 0.1)
  assert.equal(bankParams(withClouds(0.7, 0.9)).torn, 0.9)
  const low = bankParams(withClouds(0.7, 0.5, 0.55)).lift
  const high = bankParams(withClouds(0.7, 0.5, 1.35)).lift
  // Higher altitude means the band sits FURTHER UP, i.e. a smaller y.
  assert.ok(high < low, `altitude did not lift the band (${low} -> ${high})`)
  assert.ok(Math.abs(low) < 60 && Math.abs(high) < 60, 'lift is not a small offset')
})

test('clouds: out-of-range axes are clamped, never trusted', () => {
  const b = bankParams(withClouds(5, 9, 0))
  assert.equal(b.present, true)
  assert.ok(b.opacity <= 0.85 && b.opacity >= 0)
  assert.equal(b.torn, 1)
  assert.ok(Number.isFinite(b.lift))
})

test('clouds: the bake refuses to run without a document', () => {
  // The gate runs headless; this must return null rather than throw.
  assert.equal(buildCloudBank(withClouds(0.8)), null)
})
