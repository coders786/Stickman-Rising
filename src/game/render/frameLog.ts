/** STICKMAN RISING — src/game/render/frameLog.ts
 * THE FRAME LOG: percentiles, not averages.
 * ----------------------------------------------------------------------------
 * "It runs at 60 fps" is the least useful sentence in game performance, because
 * a run of 55 fps with 200 ms hitches has the same average as a smooth 55 and
 * feels completely different. What a player feels is the WORST frame in a
 * window, so this log keeps a ring of recent frame times and reports p50/p95/p99
 * and the long-frame count.
 *
 * Design constraints:
 *  · allocation-free sampling (a Float32Array ring, no per-frame objects);
 *  · one snapshot object per *read*, not per frame;
 *  · it must survive a backgrounded tab: `markGap()` lets the caller record a
 *    visibility gap that is excluded from the percentiles, because tucking the
 *    app into another tab produces a 30 s "frame" that would poison p99.
 * ==========================================================================*/

export interface FrameSnapshot {
  samples: number
  p50: number
  p95: number
  p99: number
  max: number
  /** Frames over `longMs`, as a count and as a fraction of the window. */
  long: number
  longFraction: number
  /** Visible intervals over 250 ms within the sampled window. */
  visibleStalls: number
  /** Explicitly observed gaps, e.g. tab switches. */
  gaps: number
}

export class FrameLog {
  private readonly ring: Float32Array
  private head = 0
  private size = 0
  /** Threshold for the long-frame counter, independent of visibility. */
  readonly longMs: number
  gaps = 0
  total = 0

  constructor(capacity = 600, longMs = 33.4) {
    this.ring = new Float32Array(Math.max(16, capacity))
    this.longMs = longMs
  }

  /** Record a foreground rAF interval, including long visible stalls. The
   * caller excludes intervals crossing known visibility boundaries. */
  sample(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return
    this.ring[this.head] = dt
    this.head = (this.head + 1) % this.ring.length
    if (this.size < this.ring.length) this.size++
    this.total++
  }

  /** Explicit gap (visibilitychange, resize storm, debugger pause). */
  markGap(): void { this.gaps++ }

  reset(): void { this.head = 0; this.size = 0; this.total = 0; this.gaps = 0 }

  private percentile(sorted: number[], q: number): number {
    if (sorted.length === 0) return 0
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
    return sorted[i]
  }

  snapshot(): FrameSnapshot {
    const a: number[] = new Array(this.size)
    for (let i = 0; i < this.size; i++) a[i] = this.ring[i]
    a.sort((x, y) => x - y)
    let long = 0, visibleStalls = 0
    for (const dt of a) {
      if (dt > this.longMs) long++
      if (dt > 250) visibleStalls++
    }
    return {
      samples: a.length,
      p50: this.percentile(a, 0.5),
      p95: this.percentile(a, 0.95),
      p99: this.percentile(a, 0.99),
      max: a.length ? a[a.length - 1] : 0,
      long,
      longFraction: a.length ? long / a.length : 0,
      visibleStalls,
      gaps: this.gaps,
    }
  }

  /** One line for the console/bench. Never called per frame. */
  report(): string {
    const s = this.snapshot()
    const f = (v: number): string => v.toFixed(1)
    return `frames ${s.samples} · p50 ${f(s.p50)}ms · p95 ${f(s.p95)}ms · p99 ${f(s.p99)}ms · max ${f(s.max)}ms · long ${s.long} (${(s.longFraction * 100).toFixed(1)}%) · stalls >250ms ${s.visibleStalls} · gaps ${s.gaps}`
  }
}
