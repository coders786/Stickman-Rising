/** THE ULTRA STACK, ON THE RECORD.
 *
 *  Round 5's claim is that ultra is a DIFFERENT PICTURE, not a higher set of
 *  dials, and that the extra picture costs a known, bounded number of blits.
 *  Both halves of that claim are only worth the paper they are printed on if a
 *  test fails when someone quietly turns them into a lie, so:
 *
 *    · every post flag is off below ultra and on at ultra (a tier sneaking a
 *      full-frame pass in would fail here),
 *    · the ray pass can never exceed its budget, whatever the light count,
 *    · the horde scheduler saves real work without changing anyone's average
 *      behaviour, and the grid agrees with brute force.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOOM_BLITS, RAY_BLITS, rayPlan } from '../src/game/render/post'
import { featuresFor, GRAPHICS } from '../src/game/render/graphics'
import { FAR_DIVISOR, NEAR_PX, HordeGrid, planTicks } from '../src/game/combat/horde'

test('the capture post stack is ultra-only', () => {
  for (const tier of Object.keys(GRAPHICS) as Array<keyof typeof GRAPHICS>) {
    const f = featuresFor(tier)
    const on = f.bloom || f.godRays
    assert.equal(on, tier === 'ultra', `${tier} must not run the post stack`)
  }
})

test('ultra is strictly richer than high — extra PASSES, not just bigger numbers', () => {
  const ultra = featuresFor('ultra')
  const high = featuresFor('high')
  // the passes high does not have at all
  assert.equal(ultra.bloom, true)
  assert.equal(ultra.godRays, true)
  assert.equal(high.bloom, false)
  assert.equal(high.godRays, false)
  // and the shared flags stay monotonic
  assert.equal(ultra.actorMirror, high.actorMirror)
  assert.equal(high.shadows, 'cast')
  assert.equal(ultra.shadows, 'cast+props')
  assert.ok(ultra.reflection < high.reflection)
  assert.equal(ultra.keyTop, true)
})

test('the ray budget is a hard ceiling, not an estimate', () => {
  const many: Array<[number, number, number]> = []
  for (let i = 0; i < 12; i++) many.push([100 + i * 90, 200, 0.9])
  const taps = rayPlan(many, 1, 1280, 720)
  assert.ok(taps.length <= RAY_BLITS, `expected ≤ ${RAY_BLITS} taps, got ${taps.length}`)
  assert.ok(taps.length > 0)
  assert.equal(BLOOM_BLITS, 6, 'capture + copy + square + downsample + two additive scales')
})

test('rays march outward from the centre, and dim with each tap', () => {
  // a source to the RIGHT of centre must push its taps to the right
  const taps = rayPlan([[1200, 360, 1]], 1, 1280, 720)
  assert.ok(taps.length >= 4)
  for (let i = 1; i < taps.length; i++) {
    assert.ok(taps[i].dx > taps[i - 1].dx, 'each tap pushes further out')
    assert.ok(taps[i].alpha <= taps[i - 1].alpha, 'each tap is fainter')
  }
  // and no tap may exceed the exposure clamp — a bright ray through a lit
  // doorway is exactly how a post pass turns a scene white
  for (const t of taps) assert.ok(t.alpha <= 0.01)
})

test('the whole stack adds a bounded amount of light — a glow, not a wash', () => {
  // Additive passes SUM. The first version of post.ts added 8 × 0.22 and lifted a
  // real stage frame from 33.8 to 92 mean luminance: the picture was simply gone.
  // These ceilings are the measured-safe total energy, not a style choice.
  const taps = rayPlan([[1200, 300, 1]], 1, 1280, 720)
  const rayEnergy = taps.reduce((a, t) => a + t.alpha, 0)
  assert.ok(rayEnergy <= 0.045, `rays add ${rayEnergy.toFixed(3)} of the frame`)
  // Greedy up to 12 full-strength sources still may not exceed 8 taps' worth.
  const many = rayPlan(Array.from({ length: 12 }, (_, i) => [80 * i, 200, 1] as const), 1, 1280, 720)
  assert.ok(many.reduce((a, t) => a + t.alpha, 0) <= 0.075, 'source count must not buy energy')
})

test('a dim or off-screen source contributes no rays', () => {
  assert.equal(rayPlan([[640, 360, 0.01]], 1, 1280, 720).length, 0)
  assert.equal(rayPlan([[640, 360, 1]], 0, 1280, 720).length, 0)
  assert.equal(rayPlan([[640, 360, 1]], 1, 8, 8).length, 0)
})

test('the horde scheduler updates everyone near the player, every step', () => {
  const bodies = [
    { x: 0, y: 0, dead: false },
    { x: NEAR_PX - 5, y: 0, dead: false },
    { x: NEAR_PX + 200, y: 0, dead: false },
    { x: 9000, y: 0, dead: true },
  ]
  const plan = planTicks(bodies, 0, 1) // step 1: far enemies are NOT due
  assert.deepEqual(plan.near, [0, 1])
  assert.deepEqual(plan.far, [])
  assert.ok(plan.saved > 0, 'skipping a far body must be counted as a saving')
})

test('every far enemy ticks exactly once per FAR_DIVISOR steps', () => {
  const bodies = [{ x: 5000, y: 0, dead: false }]
  let seen = 0
  for (let tick = 1; tick <= FAR_DIVISOR * 4; tick++) {
    const plan = planTicks(bodies, 0, tick)
    if (plan.far.length) {
      seen++
      assert.equal(plan.far[0], 0)
    }
  }
  assert.equal(seen, 4, 'one tick per divisor, no drift')
})

test('the scheduler is a pure function of (bodies, playerX, tick)', () => {
  const bodies = [
    { x: 100, y: 0, dead: false },
    { x: 2400, y: 0, dead: false },
    { x: -1200, y: 0, dead: false },
  ]
  const a = planTicks(bodies, 0, 6)
  const b = planTicks(bodies, 0, 6)
  assert.deepEqual([...a.near], [...b.near])
  assert.deepEqual([...a.far], [...b.far])
  // …and a different step changes the schedule, or the LOD would be pointless
  const c = planTicks(bodies, 0, 7)
  assert.notDeepEqual([...a.far], [...c.far])
})

test('the grid answers a radius query exactly like brute force', () => {
  const xs = [0, 120, 260, 500, 505, 1400, 1401, 2200, 2500]
  const grid = new HordeGrid(220)
  grid.clear()
  xs.forEach((x, i) => grid.insert(i, x))
  for (const radius of [0, 60, 200, 400, 900]) {
    for (const q of [-300, 0, 500, 1401, 2400]) {
      const got = grid.query(q, radius, []).sort((a, b) => a - b)
      const want = xs
        .map((x, i) => (Math.abs(x - q) <= Math.max(0, radius) ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)
      assert.deepEqual(got, want, `radius ${radius} at ${q}`)
    }
  }
})

test('the grid does not leak between frames', () => {
  const grid = new HordeGrid(100)
  grid.clear()
  grid.insert(0, 10)
  assert.equal(grid.query(10, 50, []).length, 1)
  grid.clear()
  assert.equal(grid.query(10, 50, []).length, 0, 'a cleared grid must forget last frame')
  assert.equal(grid.size(), 0)
})
