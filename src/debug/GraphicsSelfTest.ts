import { graphicsTrace, traceStart, traceEnd } from './graphics-trace'
import { driverProbeSteps, type DriverResult } from './graphics-driver-probes'
import type { Game, GraphicsFrameSample } from '../game/game'

type TimingResult = { frames: number; fps: number; frameIntervalMs: Percentiles; cpuSubmitMs: Percentiles; budget16p6ms: boolean;
  fpsVisible: boolean; lastFpsInk: string | null; ultraLocked: boolean; minRequestedScale: number; minBackingScale: number;
  size: readonly [number, number]; paths: Record<string, number>; lastPresentation: GraphicsFrameSample['presentation'] }
type Percentiles = { p50: number; p95: number; p99: number }
export type VerifyGate = { name: string; target: string; actual: number | null; pass: boolean | null }
/** The performance-maximization acceptance targets, recorded live.
 * CPU gates are JS-wall-time honest; the GPU frame budget is reported as
 * frame intervals (software GL cannot stand in for hardware sign-off). */
export type GraphicsVerify = {
  engageMs: number | null
  retryMs: number | null
  sacrPackMs: Percentiles | null
  paintDrawMs: Percentiles | null
  heapMbPerMin: number | null
  longFrames: number
  gates: VerifyGate[]
}
export type GraphicsDiagnostics = {
  version: 'SACR 4.0'; status: 'driver tests' | 'engage to sample' | 'pass' | 'fail' | 'live Canvas fallback';
  driver?: DriverResult; timing?: TimingResult; verify?: GraphicsVerify
}

declare global { interface Window { __GRAPHICS_DIAGNOSTICS__?: GraphicsDiagnostics } }

const SAMPLES = 120
const round = (n: number) => Math.round(n * 1e4) / 1e4

const readHeapMb = (): number | null => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return memory ? memory.usedJSHeapSize / 1048576 : null
}

/** sr:<mark> User Timing marks are the boot contract's own telemetry; the
 * verify block reads them instead of re-instrumenting the page. */
const markDelta = (startNames: string[], endName: string): number | null => {
  const marks = performance.getEntriesByType('mark') as PerformanceMark[]
  let start: PerformanceMark | undefined
  for (const m of marks) if (startNames.includes(m.name)) start = m
  if (!start) return null
  const end = marks.find(m => m.name === endName && m.startTime >= start.startTime)
  return end ? round(end.startTime - start.startTime) : null
}

const tracePercentiles = (name: string): Percentiles | null => {
  const metrics = window.__SR_GRAPHICS_TRACE__?.snapshot().metrics ?? {}
  const m = metrics[name]
  return m ? { p50: round(m.p50Ms), p95: round(m.p95Ms), p99: round(m.p99Ms) } : null
}

function buildVerify(frameIntervalMs: Percentiles, gaps: number[], heapAtStart: number | null, heapStartedAt: number): GraphicsVerify {
  const engageMs = markDelta(['sr:engage'], 'sr:playing')
  const retryMs = markDelta(['sr:retry'], 'sr:playing')
  const sacrPackMs = tracePercentiles('sacr.packAndBin')
  const paintDrawMs = tracePercentiles('paint.drawTotal')
  const heapNow = readHeapMb()
  const minutes = (performance.now() - heapStartedAt) / 60000
  const heapMbPerMin = heapAtStart !== null && heapNow !== null && minutes > .2
    ? round(Math.max(0, heapNow - heapAtStart) / minutes) : null
  const longFrames = gaps.filter(g => g > 33.4).length
  const gates: VerifyGate[] = [
    { name: 'ENGAGE → playing', target: '≤ 400 ms', actual: engageMs, pass: engageMs === null ? null : engageMs <= 400 },
    { name: 'RETRY → playing', target: '≤ 150 ms', actual: retryMs, pass: retryMs === null ? null : retryMs <= 150 },
    { name: 'SACR pack+bin p95', target: '≤ 1.2 ms', actual: sacrPackMs?.p95 ?? null, pass: sacrPackMs ? sacrPackMs.p95 <= 1.2 : null },
    { name: 'frame interval p99', target: '≤ 16.6 ms', actual: frameIntervalMs.p99, pass: frameIntervalMs.p99 <= 16.6 },
    { name: 'stalls > 33.4 ms in window', target: '0', actual: longFrames, pass: longFrames === 0 },
    { name: 'heap growth MB/min', target: '< 0.2', actual: heapMbPerMin, pass: heapMbPerMin === null ? null : heapMbPerMin < .2 },
  ]
  return { engageMs, retryMs, sacrPackMs, paintDrawMs, heapMbPerMin, longFrames, gates }
}

const percentiles = (values: number[]): Percentiles => {
  const sorted = values.slice().sort((a, b) => a - b)
  const pick = (p: number) => round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0)
  return { p50: pick(.5), p95: pick(.95), p99: pick(.99) }
}

export function startGraphicsSelfTest(game: Game, update: (value: GraphicsDiagnostics) => void): () => void {
  let driver: DriverResult | undefined
  let timing: TimingResult | undefined
  let verify: GraphicsVerify | undefined
  let stopped = false
  const publish = (status: GraphicsDiagnostics['status']) => {
    if (stopped) return
    const report: GraphicsDiagnostics = { version: 'SACR 4.0', status, driver, timing, verify }
    window.__GRAPHICS_DIAGNOSTICS__ = report; update(report)
  }
  publish('driver tests')
  // Keep slow diagnostic links/readbacks off the UI thread when a worker
  // supports WebGL2. Fallback slices work between rAFs and pauses at opening;
  // an individual link/readback can still block without worker support.
  let request = 0
  let worker: Worker | undefined
  let workerTimeout: ReturnType<typeof setTimeout> | undefined
  let steps: Generator<void, DriverResult> | undefined
  let started = false
  const finish = (result: DriverResult) => {
    if (stopped) return
    driver = result
    graphicsTrace?.event('verify-driver-end', driver.ok ? 'pass' : 'fail')
    console.table(driver.probes)
    if (driver.errors.length) console.warn('SACR driver validation:', driver.errors)
    publish('engage to sample')
  }
  const advance = () => {
    if (stopped || !steps) return
    if (game.phase === 'preparing' || document.hidden) { request = requestAnimationFrame(advance); return }
    if (!started) { started = true; graphicsTrace?.event('verify-driver-start', 'main-thread-sliced') }
    const stepStart = traceStart()
    const next = steps.next()
    traceEnd('verify.driverProbeStep', stepStart)
    if (!next.done) { request = requestAnimationFrame(advance); return }
    finish(next.value)
  }
  const startFallback = () => {
    if (stopped || steps) return
    if (workerTimeout !== undefined) clearTimeout(workerTimeout)
    workerTimeout = undefined
    worker?.terminate(); worker = undefined
    graphicsTrace?.event('verify-worker-fallback')
    steps = driverProbeSteps()
    request = requestAnimationFrame(advance)
  }
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      worker = new Worker(new URL('./graphics-probe.worker.ts', import.meta.url), { type: 'module', name: 'graphics-probe' })
      graphicsTrace?.event('verify-driver-start', 'worker')
      const activeWorker = worker
      workerTimeout = setTimeout(() => {
        if (worker !== activeWorker || stopped) return
        worker?.terminate(); worker = undefined; workerTimeout = undefined
        finish({ ok: false, renderer: '', formats: {}, linked: [], offsets: {}, mips: [], probes: [],
          errors: ['Diagnostic worker timed out; no driver result'] })
      }, 30_000)
      activeWorker.onmessage = (event: MessageEvent<DriverResult | null>) => {
        if (worker !== activeWorker || stopped) return
        if (workerTimeout !== undefined) clearTimeout(workerTimeout)
        workerTimeout = undefined
        worker?.terminate(); worker = undefined
        if (event.data) finish(event.data)
        else startFallback()
      }
      activeWorker.onerror = event => { event.preventDefault(); if (worker === activeWorker) startFallback() }
    } catch { startFallback() }
  } else startFallback()
  const samples: GraphicsFrameSample[] = []
  const heapAtStart = readHeapMb()
  const heapStartedAt = performance.now()
  const reset = () => { if (!timing) samples.length = 0 }
  document.addEventListener('visibilitychange', reset)
  const off = game.on(e => { if (e.type === 'phase' && e.phase !== 'playing') reset() })
  const cancel = game.observeGraphicsFrames(s => {
    if (!driver || timing || stopped) return
    samples.push(s)
    if (samples.length !== SAMPLES) return
    const last = samples.at(-1)!
    const gaps = samples.slice(1).map((f, i) => f.now - samples[i].now)
    const paths: Record<string, number> = {}
    for (const f of samples) paths[f.presentation.path] = (paths[f.presentation.path] ?? 0) + 1
    const frameIntervalMs = percentiles(gaps)
    timing = { frames: samples.length, fps: round((samples.length - 1) * 1000 / Math.max(.001, last.now - samples[0].now)),
      frameIntervalMs, budget16p6ms: frameIntervalMs.p99 <= 16.6, cpuSubmitMs: percentiles(samples.map(f => f.submitMs)),
      fpsVisible: samples.every(f => f.config.showFPS && /^\d+ FPS$/.test(f.fpsInk ?? '')),
      lastFpsInk: last.fpsInk,
      ultraLocked: samples.every(f => f.config.preset === 'ULTRA' && !f.config.adaptiveEnabled && f.config.renderScale >= 1.25),
      minRequestedScale: Math.min(...samples.map(f => f.config.renderScale)), minBackingScale: Math.min(...samples.map(f => f.presentation.backingScale)),
      size: last.size, paths, lastPresentation: last.presentation }
    verify = buildVerify(frameIntervalMs, gaps, heapAtStart, heapStartedAt)
    cancel()
    console.table([{ frames: timing.frames, fps: timing.fps, p50Ms: timing.frameIntervalMs.p50, p95Ms: timing.frameIntervalMs.p95,
      lock: timing.ultraLocked, fpsInk: timing.fpsVisible, ...paths }])
    if (verify) console.table(verify.gates.map(g => ({ gate: g.name, target: g.target, actual: g.actual, pass: g.pass })))
    publish(!driver.ok || !timing.fpsVisible || !timing.ultraLocked ? 'fail' : paths['mobile-canvas'] ? 'live Canvas fallback' : 'pass')
  })
  return () => {
    stopped = true
    cancelAnimationFrame(request); if (workerTimeout !== undefined) clearTimeout(workerTimeout)
    worker?.terminate(); steps?.return(undefined as unknown as DriverResult); cancel(); off()
    document.removeEventListener('visibilitychange', reset)
    delete window.__GRAPHICS_DIAGNOSTICS__
  }
}
