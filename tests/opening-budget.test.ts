/** The loader must never hold the player on a frozen bar. A preparation that
 *  stops advancing is failed in seconds; one that is merely slow keeps working. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OPENING_STALL_MS, OPENING_TOTAL_BUDGET_MS, openingExpiry } from '../src/game/render/opening-budget'

test('the stall ceiling is a fraction of the total budget', () => {
  assert.equal(OPENING_STALL_MS, 8_000)
  assert.equal(OPENING_TOTAL_BUDGET_MS, 25_000)
  assert.ok(OPENING_STALL_MS < OPENING_TOTAL_BUDGET_MS)
})

test('a slow boot that keeps advancing is not failed', () => {
  // 20 s of visible preparation, but progress 400 ms ago.
  assert.equal(openingExpiry(20_000, 400), null)
  assert.equal(openingExpiry(24_999, 7_999), null)
})

test('a wedged boot fails at the stall ceiling, not the full budget', () => {
  assert.equal(openingExpiry(0, OPENING_STALL_MS), 'stall')
  assert.equal(openingExpiry(1_200, 30_000), 'stall')
})

test('the total budget still bounds a preparation that trickles forever', () => {
  assert.equal(openingExpiry(OPENING_TOTAL_BUDGET_MS, 1_000), 'budget')
  // Stall wins when both are true: the player is told it stalled.
  assert.equal(openingExpiry(OPENING_TOTAL_BUDGET_MS, OPENING_STALL_MS), 'stall')
})
