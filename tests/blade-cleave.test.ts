/** REGRESSION: a drawn blade must cut through a pack.
 *
 * The reported bug was "when I have blade I should cut through enemies and not
 * stucked". There is no body collision in this engine, so nothing was blocking
 * the player -- the CUT was failing to register past the first body. Three
 * separate faults caused that, and each of these cases pins one:
 *
 *  · BLADE PITCH. rig3d derives the sword's world angle from the channel SUM
 *    (`bladeAngle = PI/2 - (shR+elR+wrR)`). Unarmed-authored clips sum to ~0
 *    at the contact beat, aiming the edge straight up, so tip.x can never
 *    exceed grip.x however far the arm reaches (cyclone, ultPalm, ironRoot).
 *  · ARM REACH. An empty-hand clip only poses the limb that strikes; thrown
 *    with the blade drawn it still swings the sword, so the sword arm is left
 *    folded in guard (cyclone measured a reach of -4.9 -- pointing backward).
 *  · LUNGE OVERRUN. moveX sets a velocity, so the body travels over the row
 *    during the swing and the nearest enemy ends up behind the blade.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleave } from '../.qa/blade-cleave'
import { ATTACKS } from '../src/game/combat/attacks'

/** The pack a single swing must get through. 5 bodies at the engine's own
 * spacing (26px) is the tight formation; 40px is loose enough that reach --
 * not the hit test -- is the only thing that could fail. */
function expectCleave(id: string, min: number, spacing = 26): void {
  const r = cleave(id, 5, spacing, 0)
  assert.ok(
    r.cut >= min,
    `${id} at ${spacing}px only cut ${r.cut}/5 (${r.dmg.join(' ')}); ` +
    `expected at least ${min}. A drawn blade must not stop on the first body.`,
  )
  // No attack may silently do nothing to the FIRST body while hitting the
  // rest -- that was the lunge-overrun signature (damage 0 26 26 26 26).
  if (r.cut > 0) {
    assert.ok(
      r.dmg[0] > 0,
      `${id} hit bodies 2-5 but not body 1 (${r.dmg.join(' ')}). ` +
      'A lunge must cut the body it starts on.',
    )
  }
}

test('the blade cleaves a tight pack (26px), every sword strike', () => {
  // The measured floor across the whole kit. Every attack that is a real
  // swing has to reach most of a tight row; anything less means the pose,
  // not the hit test, is failing again.
  // ultPalm is the one documented exception: a five-contact PALM BARRAGE
  // whose blade oscillates forward and back through the window, so the two
  // far bodies are reached on the forward phases only. Everything else must
  // get through at least four of five.
  const FLOOR: Record<string, number> = { ultPalm: 3 }
  for (const id of Object.keys(ATTACKS)) {
    if (id === 'h3') continue // throws w.addHitstop in a bare harness
    expectCleave(id, FLOOR[id] ?? 4)
  }
})

test('the cleave does not depend on how tightly the pack is packed', () => {
  // Depth of the cut must not collapse when the bodies are further apart --
  // that would mean the swing only ever reached one body's radius.
  for (const id of ['l1', 'l5', 'h1', 'srOnslaught', 'cyclone', 'axeKick']) {
    expectCleave(id, 4, 40)
  }
})

test('a swung sword reaches several bodies at once, not just one', () => {
  const r = cleave('l1', 5, 26, 0)
  assert.equal(r.dmg.filter((d) => d > 0).length, 5,
    `a basic sword light must damage the whole row, got ${r.dmg.join(' ')}`)
})

test('how deep the blade cuts does not depend on the frame rate', () => {
  // Depth must be a property of the swing, not of how often the engine ticks.
  // The farthest body sits exactly at the edge of reach, so whether it is
  // caught can differ by one at the extremes; everything the player is
  // actually aiming at must be stable.
  const HZ = [30, 60, 120, 240]
  for (const id of Object.keys(ATTACKS)) {
    if (id === 'h3') continue // throws w.addHitstop in a bare harness
    const near = HZ.map((hz) => {
      const r = cleave(id, 5, 26, 0, 1 / hz)
      return [0, 1, 2, 3].filter((i) => r.dmg[i] > 0).length
    })
    assert.equal(new Set(near).size, 1,
      `${id} cut a different number of the first four bodies at different ` +
      `frame rates (${HZ.map((hz, i) => hz + 'hz=' + near[i]).join(' ')}); ` +
      'the cut must not depend on tick rate.')
  }
})
