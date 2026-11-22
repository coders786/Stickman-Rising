// A loading watchdog is not a frame budget. A supported renderer can take
// time to link/upload, but a hitch in the last few *complete* frames must
// restart the handoff. This is a startup hitch ceiling, not an FPS target.
export const OPENING_MAX_GAP_MS = 100
const PACED_INTERVALS = 2

export class OpeningPace {
  private lastSubmit: number | undefined
  private intervals = 0

  reset(): void { this.lastSubmit = undefined; this.intervals = 0 }

  submitted(at: number): void {
    const gap = at - (this.lastSubmit ?? -Infinity)
    this.intervals = gap > 0 && gap <= OPENING_MAX_GAP_MS ? this.intervals + 1 : 0
    this.lastSubmit = at
  }

  ready(at: number): boolean {
    if (this.lastSubmit === undefined) return false
    const gap = at - this.lastSubmit
    if (gap > OPENING_MAX_GAP_MS || gap < 0) this.reset()
    // Give the compositor a foreground paint opportunity after the last
    // world + HUD submit. In particular, reduced motion has no CSS delay.
    return gap > 0 && this.intervals >= PACED_INTERVALS
  }
}
