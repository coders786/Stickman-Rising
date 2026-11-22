import { graphicsTrace } from '../../debug/graphics-trace'
// A pacing check is a quality signal, not permission to trap a slow device on
// the loading screen forever. Never reveal from a timer or an incomplete frame.
export const OPENING_MAX_GAP_MS = 100
export const OPENING_SLOW_GRACE_MS = 1200
const PACED_INTERVALS = 2
const SLOW_COMPLETE_FRAMES = 3

export class OpeningPace {
  private lastSubmit: number | undefined
  private intervals = 0
  private firstComplete: number | undefined
  private lastComplete: number | undefined
  private completeFrames = 0
  slowFallback = false

  /** Call on visibility, path, backing, or render failure: old frames cannot
   * qualify the new surface, even when a slow-device grace period expired. */
  reset(): void {
    this.lastSubmit = this.firstComplete = this.lastComplete = undefined
    this.intervals = this.completeFrames = 0
    this.slowFallback = false
  }

  /** at is the rAF timestamp; completedAt is measured after a full submit. */
  submitted(at: number, completedAt = at): void {
    const gap = at - (this.lastSubmit ?? -Infinity)
    if (this.lastSubmit !== undefined && (gap <= 0 || gap > OPENING_MAX_GAP_MS)) graphicsTrace?.event('pace-reset', `submit-gap=${gap.toFixed(1)}ms`)
    this.intervals = gap > 0 && gap <= OPENING_MAX_GAP_MS ? this.intervals + 1 : 0
    this.lastSubmit = at
    this.firstComplete ??= completedAt
    this.lastComplete = completedAt
    this.completeFrames++
  }

  ready(at: number, wall = at): boolean {
    if (this.lastSubmit === undefined || this.lastComplete === undefined || this.firstComplete === undefined) return false
    const gap = at - this.lastSubmit
    if (gap > OPENING_MAX_GAP_MS || gap < 0) {
      graphicsTrace?.event('pace-reset', `ready-gap=${gap.toFixed(1)}ms`)
      // Reset the fast pacing streak, not the count of verified complete
      // frames. A persistently slow renderer still deserves a usable handoff.
      this.lastSubmit = undefined
      this.intervals = 0
    }
    if (gap > 0 && gap <= OPENING_MAX_GAP_MS && this.intervals >= PACED_INTERVALS) return true
    const sinceComplete = wall - this.lastComplete
    if (this.completeFrames >= SLOW_COMPLETE_FRAMES && wall - this.firstComplete >= OPENING_SLOW_GRACE_MS &&
        sinceComplete > 0 && sinceComplete <= OPENING_MAX_GAP_MS) {
      this.slowFallback = true
      return true
    }
    return false
  }
}
