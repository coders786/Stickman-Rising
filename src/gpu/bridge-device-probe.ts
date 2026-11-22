import type { BridgeDevice } from './bridge-device'

/** Driver discovery can be a blocking round trip, even just to reject a
 * software adapter. Probe once off-thread, never creating a title context.
 * An unavailable/blocked worker is not evidence that DOM WebGL is absent. */
export class BridgeDeviceProbe {
  private worker?: Worker
  private result?: BridgeDevice
  private timeout?: number

  poll(): BridgeDevice | undefined {
    if (this.worker || this.result) return this.result
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return this.result = 'unknown'
    try {
      const worker = this.worker = new Worker(new URL('./bridge-device.worker.ts', import.meta.url), { type: 'module', name: 'bridge-device' })
      worker.onmessage = ({ data }) => {
        if (this.worker === worker) this.finish(data === 'hardware' || data === 'software' ? data : 'unknown')
      }
      const denied = () => { if (this.worker === worker) this.finish('unknown') }
      worker.onerror = event => { event.preventDefault(); denied() }
      this.timeout = window.setTimeout(denied, 2000)
    } catch { this.finish('unknown') }
    return this.result
  }

  private finish(result: BridgeDevice): void {
    this.dispose()
    this.result = result
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = undefined
    if (this.timeout !== undefined) window.clearTimeout(this.timeout)
    this.timeout = undefined
  }
}
