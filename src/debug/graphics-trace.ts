/** Opt-in, local-only performance trace. Unlike verifyGraphics this does not
 * compile diagnostic shaders or read pixels. Times measure JS wall time,
 * not GPU execution. Bounded storage keeps a long run from growing forever. */
export type TraceEvent = { at: number; name: string; detail?: string }
export type TraceMetric = { count: number; totalMs: number; maxMs: number; samples: number[] }
export class GraphicsTrace {
  readonly events: TraceEvent[] = []
  readonly metrics: Record<string, TraceMetric> = Object.create(null)
  private readonly states: Record<string, string> = Object.create(null)
  constructor(private readonly clock: () => number = () => performance.now()) {}
  event(name: string, detail?: string): void {
    if (this.events.length === 1024) this.events.shift()
    this.events.push({ at: this.clock(), name, ...(detail === undefined ? {} : { detail }) })
  }
  state(name: string, detail: string): void {
    if (this.states[name] === detail) return
    this.states[name] = detail
    this.event(name, detail)
  }
  duration(name: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return
    const m = this.metrics[name] ??= { count: 0, totalMs: 0, maxMs: 0, samples: [] }
    m.count++; m.totalMs += ms; m.maxMs = Math.max(m.maxMs, ms)
    // Keep the most recent 1,000 measurements. Count/total/max span the trace.
    if (m.samples.length === 1000) m.samples.shift()
    m.samples.push(ms)
  }
  snapshot() {
    const metrics: Record<string, { count: number; meanMs: number; maxMs: number; recentSamples: number; p50Ms: number; p95Ms: number; p99Ms: number }> = {}
    for (const [name, m] of Object.entries(this.metrics)) {
      const sorted = m.samples.slice().sort((a, b) => a - b)
      const p = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0
      metrics[name] = { count: m.count, meanMs: m.totalMs / m.count, maxMs: m.maxMs,
        recentSamples: sorted.length, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99) }
    }
    return { timeOrigin: performance.timeOrigin, events: this.events.slice(), metrics,
      note: 'JS wall/submit timings only; not GPU execution. Percentiles use the most recent 1000 samples.' }
  }
}

declare global { interface Window { __SR_GRAPHICS_TRACE__?: GraphicsTrace } }

/** Evaluate once on client module load. Also works alongside verifyGraphics,
 * but the diagnostic driver's work must then be considered a confounder. */
export const graphicsTrace: GraphicsTrace | null = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('traceGraphics') === '1'
  ? (window.__SR_GRAPHICS_TRACE__ = new GraphicsTrace()) : null

export function traceStart(): number { return graphicsTrace ? performance.now() : 0 }
export function traceEnd(name: string, start: number): void {
  if (graphicsTrace) graphicsTrace.duration(name, performance.now() - start)
}
