/** Shirogane visual clock — the frame laws that replaced the zen scene.
 *  (zen-visual-clock tested the removed ZenNight transports: the moonVis
 *  media filter and pond ripples. Shirogane's moon cover is ANALYTIC — a
 *  pure function of the visual clock — and petals land by fade instead of
 *  rippling, so the equivalent laws are: draw-free construction/update,
 *  split-invariance of the analytic cover, update-owned meteor events,
 *  and the bakes invariant.)
 *  F14: meteor spawning decides in update() with a dedicated RNG stream;
 *       draw never spawns. update(0) is a no-op everywhere. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ShiroganeHorizonBackground } from '../src/game/world/shirogane'
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

function internals(bg: ShiroganeHorizonBackground) {
  return bg as unknown as {
    moonCover: number
    meteor: { active: boolean; life: number; maxLife: number; alpha: number }
    eventRng: () => number
    update(dt: number): void
    t: number
    stats: { bakes: number }
  }
}

test('headless: construction + update never bake (bakes invariant)', () => {
  const bg = new ShiroganeHorizonBackground(quietStorm())
  const z = internals(bg)
  assert.equal(z.stats.bakes, 0, 'construction must not bake')
  for (let i = 0; i < 600; i++) z.update(1 / 60) // 10 s of visual time
  assert.equal(z.stats.bakes, 0,
    'update() must never bake — ensure() runs only from draw* paths (document is undefined here)')
  assert.ok(Number.isFinite(z.t) && z.t > 9.9, 'visual clock advanced')
})

test('moon cover is analytic: split-invariant and in range', () => {
  const a = new ShiroganeHorizonBackground(quietStorm())
  const b = new ShiroganeHorizonBackground(quietStorm())
  for (let i = 0; i < 10; i++) internals(a).update(0.01) // 10 small updates
  internals(b).update(0.1)                              // one big update
  const za = internals(a)
  const zb = internals(b)
  assert.ok(Math.abs(za.t - zb.t) < 1e-12, 'clocks agree')
  assert.ok(Math.abs(za.moonCover - zb.moonCover) < 1e-9,
    `10×0.01 must equal 1×0.1 (${za.moonCover} vs ${zb.moonCover})`)
  assert.ok(za.moonCover >= 0 && za.moonCover <= 1, 'cover stays in [0,1]')
  // pure function of state: a fresh instance on the same schedule matches
  const c = new ShiroganeHorizonBackground(quietStorm())
  for (let i = 0; i < 10; i++) internals(c).update(0.01)
  assert.equal(internals(c).moonCover, za.moonCover, 'deterministic: same schedule ⇒ same cover')
})

test('F14: meteor events generate from update() with the dedicated stream', () => {
  const bg = new ShiroganeHorizonBackground(quietStorm())
  const z = internals(bg)
  // deterministic event gate: the SPAWN itself is what this test proves
  // (update-owned, not draw-owned) — the probability law lives in the
  // dedicated stream, not re-rolled here.
  z.eventRng = () => 0
  z.update(0)
  assert.equal(z.meteor.active, false, 'update(0) never spawns (d=0 ⇒ gate 0 < 0 is false)')
  z.update(0.1)
  assert.equal(z.meteor.active, true, 'update() must spawn the meteor — draw never runs here')
  const life0 = z.meteor.life
  const alpha0 = z.meteor.alpha
  z.update(0)
  assert.equal(z.meteor.life, life0, 'update(0) does not age the meteor')
  assert.equal(z.meteor.alpha, alpha0, 'update(0) does not advance the envelope')
  for (let i = 0; i < 12 && z.meteor.active; i++) z.update(0.1)
  assert.equal(z.meteor.active, false, 'meteor retires after maxLife (pool-style lifecycle)')
})

test('long update sweeps stay finite (no NaN leaks into render state)', () => {
  const bg = new ShiroganeHorizonBackground(quietStorm())
  const z = internals(bg)
  for (let i = 0; i < 3600; i++) z.update(1 / 60) // 60 s
  assert.ok(Number.isFinite(z.moonCover), 'moonCover finite')
  assert.ok(z.moonCover >= 0 && z.moonCover <= 1, 'moonCover in range after a minute')
  assert.ok(Number.isFinite(z.t), 'clock finite')
})
