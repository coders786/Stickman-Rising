type BootStage = 'menu' | 'engine-request' | 'engine-module' | 'ready' | 'engine-failed'
  | 'run-initialized' | 'run-workers' | 'run-backdrop-ready' | 'run-renderer-ready' | 'run-settled' | 'run-cut' | 'title-submit' | 'engage' | 'retry' | 'run-submit' | 'playing' | 'first-step' | 'cancelled' | 'run-failed' | 'run-stalled'

/** Local browser measurements only. The head script can display these even
 * if an engine import fails; nothing is sent to the server. */
export function markBoot(stage: BootStage, startTime?: number): void {
  if (typeof window === 'undefined') return
  try {
    performance.mark(`sr:${stage}`, startTime === undefined ? undefined : { startTime })
    window.dispatchEvent(new Event('sr:boot'))
  } catch { /* Diagnostics may not block play on older browsers. */ }
}
