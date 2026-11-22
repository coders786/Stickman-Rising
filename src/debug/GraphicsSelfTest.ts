import { graphicsTrace, traceStart, traceEnd } from './graphics-trace'
import { driverProbeSteps, type DriverResult } from './graphics-driver-probes'
import type { Game, GraphicsFrameSample } from '../game/game'

type TimingResult = { frames: number; fps: number; frameIntervalMs: Percentiles; cpuSubmitMs: Percentiles; budget16p6ms: boolean;
  fpsVisible: boolean; lastFpsInk: string | null; ultraLocked: boolean; minRequestedScale: number; minBackingScale: number;
  size: readonly [number, number]; paths: Record<string, number>; lastPresentation: GraphicsFrameSample['presentation'] }
type Percentiles = { p50: number; p95: number; p99: number }
export type GraphicsDiagnostics = {
  version: 'SACR 4.0'; status: 'driver tests' | 'engage to sample' | 'pass' | 'fail' | 'live Canvas fallback';
  driver?: DriverResult; timing?: TimingResult
}

declare global { interface Window { __GRAPHICS_DIAGNOSTICS__?: GraphicsDiagnostics } }

const SAMPLES = 120
const round = (n: number) => Math.round(n * 1e4) / 1e4

const percentiles = (values: number[]): Percentiles => {
  const sorted = values.slice().sort((a, b) => a - b)
  const pick = (p: number) => round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0)
  return { p50: pick(.5), p95: pick(.95), p99: pick(.99) }
}

export function startGraphicsSelfTest(game: Game, update: (value: GraphicsDiagnostics) => void): () => void {
  let driver: DriverResult | undefined
  let timing: TimingResult | undefined
  let stopped = false
  const publish = (status: GraphicsDiagnostics['status']) => {
    if (stopped) return
    const report: GraphicsDiagnostics = { version: 'SACR 4.0', status, driver, timing }
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
    cancel()
    console.table([{ frames: timing.frames, fps: timing.fps, p50Ms: timing.frameIntervalMs.p50, p95Ms: timing.frameIntervalMs.p95,
      lock: timing.ultraLocked, fpsInk: timing.fpsVisible, ...paths }])
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
