/** A guarded strike is a DEFLECTION. It must never print a damage readout —
 *  a cyan "0" over a barrier is a scoreboard glitch, not feedback — and it must
 *  read as the barrier it hit: a faceted hex ripple at the blade contact, from a
 *  pool that never grows during a fight. */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { BRIDGE_GUARD_RIPPLE_LIMIT, FX } from '../src/game/fx/fx'
import { setParticleLevel } from '../src/game/fx/particles1d'

beforeEach(() => setParticleLevel(2))

const texts = (fx: FX) => (fx as unknown as { texts: { str: string; size: number; life: number }[] }).texts
const ripples = (fx: FX) => (fx as unknown as { guardRipples: { active: boolean; age: number; life: number }[] }).guardRipples

test('zero-damage readouts are never emitted', () => {
  const fx = new FX()
  for (const zero of ['0', '00', '+0', '-0', ' 0 ', '']) fx.text(100, 100, zero, '#00e5ff')
  assert.equal(texts(fx).length, 0, 'a strike that dealt nothing must not print a number')
  fx.text(100, 100, '12', '#fff')
  assert.equal(texts(fx).length, 1)
  fx.text(100, 100, '+40 HP', '#5cffb4')
  assert.equal(texts(fx).length, 2)
  // Micro-tags are short ink, not a floating scoreboard.
  fx.tag(100, 80, '[GUARD]', '#8ff0c6')
  assert.equal(texts(fx)[2].life, .2)
  assert.equal(texts(fx)[2].size, 10)
})

test('guard ripples come from a fixed pool and expire', () => {
  const fx = new FX()
  assert.equal(ripples(fx).length, BRIDGE_GUARD_RIPPLE_LIMIT)
  for (let i = 0; i < BRIDGE_GUARD_RIPPLE_LIMIT * 3; i++) fx.guardRipple(100 + i, 100, 0, '#46ffb4')
  assert.equal(ripples(fx).length, BRIDGE_GUARD_RIPPLE_LIMIT, 'the pool is pre-allocated, not grown')
  assert.equal(ripples(fx).filter(r => r.active).length, BRIDGE_GUARD_RIPPLE_LIMIT)
  fx.update(.2)
  assert.equal(ripples(fx).filter(r => r.active).length, 0, 'a ripple is a 180 ms event')
})

test('the ripple paints ink where the barrier was struck', () => {
  const fx = new FX()
  const canvas = createCanvas(240, 240)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  fx.guardRipple(120, 120, 0, '#46ffb4', 30, .18)
  fx.update(.05)
  fx.drawAdditive(ctx, 0)
  const data = ctx.getImageData(0, 0, 240, 240).data
  let lit = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++
  assert.ok(lit > 40, `expected a visible deflection ripple, got ${lit} lit pixels`)

  // Clearing the world clears the effect with it.
  fx.clear()
  assert.equal(ripples(fx).filter(r => r.active).length, 0)
})
