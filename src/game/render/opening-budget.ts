/** When does a run preparation stop being "slow" and start being wedged?
 *
 *  The old rule was a single 25 s budget, so a preparation that stopped making
 *  progress at 85 % held the player on the loader for the whole budget and then
 *  failed — which is exactly the "hangs, then throws a banner" report. A slow
 *  driver that keeps advancing stages is fine; a boot that advances NOTHING is
 *  dead. Two clocks, therefore:
 *
 *   · STALL  — no observable step forward (stage change, first submit, settled
 *              frame) for OPENING_STALL_MS. This is the hang detector.
 *   · BUDGET — total visible preparation time. This is the backstop.
 *
 *  Hidden time is excluded by the caller (Game.prepareRunFrame republishes
 *  progress while the tab is hidden), so a backgrounded tab is never "stalled".
 */
export const OPENING_TOTAL_BUDGET_MS = 25_000
export const OPENING_STALL_MS = 8_000

export type OpeningExpiry = 'stall' | 'budget' | null

export function openingExpiry(activeMs: number, stalledMs: number): OpeningExpiry {
  if (stalledMs >= OPENING_STALL_MS) return 'stall'
  if (activeMs >= OPENING_TOTAL_BUDGET_MS) return 'budget'
  return null
}
