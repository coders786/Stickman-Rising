/** STICKMAN RISING — src/game/render/quality.ts
 * THE QUALITY LADDER: a pure state machine, so it can be proven instead of felt.
 * ----------------------------------------------------------------------------
 * Every "adaptive quality" implementation I have read fails in one of two ways:
 * it reacts to a single slow frame (and then oscillates), or it lowers quality
 * and never comes back (and the phone that hiccupped once during a GC runs the
 * rest of the match ugly). Both are avoidable with a state machine that has
 * three explicit guards:
 *
 *  · WINDOW — decisions are made on a p95 over a 4 s window, never on one
 *    frame. A 40 ms frame is noise; 40 ms at p95 for four seconds is a device.
 *  · DWELL — one step per window, and a raise may not happen within 12 s of a
 *    shed. Oscillation needs an escape faster than the guard, and there isn't
 *    one.
 *  · FLOOR — never shed below `low`, and never raise above the *ceiling the
 *    user chose*. A player who picks "high" on a flagship may still shed to
 *    medium in a heat wave; a player who picks "low" is never raised into a
 *    stutter they didn't ask for.
 *
 * The tier order is the existing one (ultra > high > medium > low) because
 * `background.ts` and `fx.ts` already read it; this module does not introduce a
 * second vocabulary.
 * ==========================================================================*/

export type Tier = 'ultra' | 'high' | 'medium' | 'low'
export const TIERS: readonly Tier[] = ['ultra', 'high', 'medium', 'low']

export interface LadderConfig {
  /** p95 frame budget that triggers a shed, in ms. 1000/60 * 1.35 ≈ 22.5. */
  shedMs: number
  /** p95 frame budget below which a raise may be considered, in ms. */
  raiseMs: number
  /** Length of the measurement window, seconds. */
  windowSec: number
  /** Minimum time after a shed before a raise is allowed, seconds. */
  dwellSec: number
  /** Absolute floor — shed stops here. `low` is the last tier. */
  floor: Tier
}

export const DEFAULT_LADDER: LadderConfig = {
  // 22.5 ms at p95 is ~44 fps sustained: below the interactive floor the docs
  // treat as playable, and above the 30 fps cliff where input latency starts
  // to be felt as mush. Both numbers are provisional (labelled as targets in
  // 12 §7) and are re-measured on device.
  shedMs: 22.5,
  raiseMs: 15.5,
  windowSec: 4,
  dwellSec: 12,
  floor: 'low',
}

export interface LadderEvent {
  from: Tier
  to: Tier
  at: number
  reason: 'shed' | 'raise' | 'floor' | 'ceiling'
  p95: number
}

export class QualityLadder {
  private readonly cfg: LadderConfig
  private ceiling: Tier
  private tier: Tier
  /** Frame times for the current window, in ms. Fixed-capacity ring: the hot
   *  path must not allocate, and 4 s at 240 fps is 960 slots. */
  private readonly ring: Float32Array
  private head = 0
  private count = 0
  private windowT = 0
  private sinceChange = 1e9
  private lastEvent: LadderEvent | null = null
  /** Counters a frame log can read without allocating. */
  sheds = 0
  raises = 0

  constructor(ceiling: Tier = 'high', cfg: Partial<LadderConfig> = {}) {
    this.cfg = { ...DEFAULT_LADDER, ...cfg }
    this.ceiling = ceiling
    this.tier = ceiling
    this.ring = new Float32Array(1024)
  }

  get current(): Tier { return this.tier }
  get ceilingTier(): Tier { return this.ceiling }
  get lastChange(): LadderEvent | null { return this.lastEvent }
  get tierIndex(): number { return TIERS.indexOf(this.tier) }

  /** The user picked a tier: that is the new ceiling, and the ladder snaps to
   *  it immediately (a settings change should be visible in the same second). */
  setCeiling(t: Tier): void {
    this.ceiling = t
    // A LOWERED ceiling clamps the tier immediately (the player asked for a
    // cheaper picture). A RAISED ceiling does not guess forward: the ladder
    // earns that step back with a measured window, not with permission.
    if (TIERS.indexOf(this.tier) < TIERS.indexOf(t)) this.tier = t
    this.windowT = 0
    this.count = 0
    this.head = 0
  }

  /** Feed one frame's duration. Returns the NEW tier if a step happened this
   *  call, else null. Allocation-free (the event object is only built on a
   *  transition, which is at most once per window). */
  frame(ms: number, dt: number): Tier | null {
    if (!(ms > 0) || !(dt > 0)) return null
    // Ignore tab-restore spikes: a 2 s gap is not a frame, it is the OS.
    const sample = Math.min(ms, 100)
    this.ring[this.head] = sample
    this.head = (this.head + 1) % this.ring.length
    if (this.count < this.ring.length) this.count++
    this.windowT += dt
    this.sinceChange += dt
    if (this.windowT < this.cfg.windowSec) return null
    this.windowT = 0
    const p95 = this.percentile(0.95)
    // The window is CONSUMED by the decision. Re-using the same samples for
    // the next decision is how a ladder double-sheds from one bad second.
    this.head = 0
    this.count = 0
    const idx = this.tierIndex
    if (p95 > this.cfg.shedMs && idx < TIERS.length - 1) {
      const floorIdx = TIERS.indexOf(this.cfg.floor)
      if (idx + 1 <= floorIdx) {
        this.tier = TIERS[idx + 1]
        this.sheds++
        this.sinceChange = 0
        this.record('shed', p95, 'shed')
        return this.tier
      }
      this.record('shed', p95, 'floor')
      return null
    }
    if (p95 < this.cfg.raiseMs && idx > 0 && this.sinceChange >= this.cfg.dwellSec) {
      const ceilIdx = TIERS.indexOf(this.ceiling)
      if (idx - 1 >= ceilIdx) {
        this.tier = TIERS[idx - 1]
        this.raises++
        this.sinceChange = 0
        this.record('raise', p95, 'raise')
        return this.tier
      }
      this.record('raise', p95, 'ceiling')
    }
    return null
  }

  /** p95 of the current window. Sorted copy allocates, but this runs once per
   *  4 s, not per frame — the ring itself stays allocation-free. */
  private percentile(q: number): number {
    if (this.count === 0) return 0
    const a = Array.prototype.slice.call(this.ring, 0, this.count) as number[]
    a.sort((x, y) => x - y)
    const i = Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))
    return a[i]
  }

  private record(reason: LadderEvent['reason'], p95: number, kind?: string): void {
    const e: LadderEvent = { from: this.tier, to: this.tier, at: this.sinceChange, reason, p95 }
    if (kind === 'ceiling' || kind === 'floor') e.reason = kind as LadderEvent['reason']
    this.lastEvent = e
  }

  /** Debug line — one allocation, only when the overlay is visible. */
  toString(): string {
    return `ladder ${this.tier} (ceil ${this.ceiling}) shed ${this.sheds} raise ${this.raises}`
  }
}
