import { BRIDGE_CHUNK_PX } from '../../game/stage/route'
import { decodeWindow, type BakeReply, type BakeRequest, type BakeWindow } from './BridgeBakeProtocol'

type Plate = Extract<BakeReply, { type: 'plate' }>
const close = (p: Plate) => p.bitmap.close()
export const PLATE_SLOTS = 3
export const WINDOW_LEAD = BRIDGE_CHUNK_PX * 1.5

type Lane = { worker: Worker | null; pending: BakeRequest | null; failed: boolean }
const lane = (): Lane => ({ worker: null, pending: null, failed: false })

/** Backpressure is one job per lane. Transport can fetch the next windows
 * even when an OffscreenCanvas raster/driver is blocked. Camera movement
 * cannot enqueue an unbounded list of past chunks. Retry keeps the lanes,
 * when idle; unfinished obsolete jobs must not occupy an opening lane. */
export class BridgeStreaming {
  private readonly optics = lane()
  private readonly raster = lane()
  private id = 0
  private wantWindow = false
  private left = 0
  private right = 0
  private center = 0
  private dir = 1
  private readonly planned: number[] = []
  private readonly visible: number[] = []
  private planCenter = -1
  private planDir = 0
  private prefetch = false
  private lit = false
  private plateBytes = 0
  private readonly plates = new Map<number, Plate>()
  window: BakeWindow | null = null
  bakes = 0
  evicted = 0
  windows = 0
  stale = 0
  retiredJobs = 0
  workerMaxMs = 0
  plateMaxMs = 0
  decodeMaxMs = 0
  wireBytes = 0
  error: string | null = null
  plateError: string | null = null
  constructor(private seed: number) {}
  get running() { return !!this.optics.worker || !!this.raster.worker }
  indices() { return [...this.plates.keys()] }
  plate(index: number, lit: boolean) { const p = this.plates.get(index); return p?.lit === lit ? p.bitmap : null }

  private ensure(job: Lane): void {
    if (job.worker || job.failed || typeof Worker === 'undefined') return
    try {
      const worker = job.worker = job === this.optics
        ? new Worker(new URL('./bridge.worker.ts', import.meta.url), { type: 'module', name: 'bridge-bake' })
        : new Worker(new URL('./bridge-raster.worker.ts', import.meta.url), { type: 'module', name: 'bridge-art' })
      worker.onmessage = (e: MessageEvent<BakeReply>) => {
        if (worker === job.worker) this.receive(job, e.data)
        else { if (e.data.type === 'plate') close(e.data); this.stale++ }
      }
      worker.onerror = e => { if (worker === job.worker) this.deny(job, e.message || 'Bridge worker could not start') }
    } catch (err) { this.deny(job, String(err)) }
  }

  requestWindow(left: number, right: number, center: number): BakeWindow | null {
    if (Math.abs(center - this.center) > 1) this.dir = center < this.center ? -1 : 1
    this.center = center; this.left = left; this.right = right
    const w = this.window
    this.wantWindow = !w || left < w.origin + (this.dir < 0 ? WINDOW_LEAD : 80) || right > w.origin + w.width - (this.dir > 0 ? WINDOW_LEAD : 80)
    // Cap negative guard at the start of the level. Looking back at the
    // opening parapet does not create an endless stream of empty tiles.
    if (w && left > -1440 && w.origin < -1440 && right < w.origin + w.width - 80) this.wantWindow = false
    this.ensure(this.optics); this.pumpWindow()
    return this.window
  }

  planPlates(center: number, visible: readonly number[], lit: boolean, schedule = true, prefetch = true): void {
    let changed = center !== this.planCenter || lit !== this.lit || prefetch !== this.prefetch || this.dir !== this.planDir || visible.length !== this.visible.length
    for (let i = 0; !changed && i < visible.length; i++) changed = visible[i] !== this.visible[i]
    if (changed) {
      const pending = this.raster.pending
      if (!prefetch && pending?.type === 'plate' && pending.lit !== lit) {
        // Admission resolved to a different path. Don't wait on a draft
        // of the wrong lighting while the user is on the opening screen.
        this.retiredJobs++; this.stop(this.raster)
      }
      this.planCenter = center; this.lit = lit; this.prefetch = prefetch; this.planDir = this.dir
      this.visible.length = 0; this.planned.length = 0
      for (const i of visible) this.visible.push(i)
      // Rank only when the envelope crosses a section boundary or reverses.
      // Never allocate/sort a replacement plan on every quiet frame.
      const ordered = this.visible.slice().sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || this.dir * (b - a))
      if (prefetch && ordered.length) ordered.push(center + this.dir, center - this.dir)
      for (const i of ordered) {
        if (this.planned.length >= PLATE_SLOTS) break
        if (i >= 0 && !this.planned.includes(i)) this.planned.push(i)
      }
      for (const [i, p] of this.plates) if (!this.keepsPlate(i) || p.lit !== lit) {
        this.plateBytes -= p.bitmap.width * p.bitmap.height * 4
        close(p); this.plates.delete(i); this.evicted++
      }
    }
    if (schedule && this.planned.length) { this.ensure(this.raster); this.pumpPlates() }
  }

  keepsPlate(index: number) { return this.planned.includes(index) }

  /** Opening uploads cannot use a window that covered a pre-resize camera. */
  openingWindow(): BakeWindow | null {
    const w = this.window
    return w && w.seed === this.seed && this.left >= w.origin && this.right <= w.origin + w.width ? w : null
  }

  /** Only the camera envelope is required. Neighbour prefetch and any span
   * beyond the plate budget do not block; the latter is painted directly. */
  openingSettled(visible: readonly number[]): boolean {
    if (typeof Worker === 'undefined') return true
    const optics = this.optics.failed || !!this.openingWindow()
    const raster = this.raster.failed || visible.every(index => !this.keepsPlate(index) || this.plate(index, this.lit))
    return optics && raster
  }

  private send(job: Lane, request: BakeRequest) {
    if (!job.worker || job.pending) return
    job.pending = request
    try { job.worker.postMessage(request) } catch (err) { this.deny(job, String(err)) }
  }

  private pumpWindow(): void {
    if (!this.optics.worker || this.optics.pending || !this.wantWindow) return
    const shift = this.window ? this.dir * WINDOW_LEAD : 0
    this.send(this.optics, { type: 'window', seed: this.seed, id: ++this.id,
      left: this.left + Math.min(0, shift * 1.21), right: this.right + Math.max(0, shift * 1.21) })
  }

  private pumpPlates(): void {
    if (!this.raster.worker || this.raster.pending) return
    const index = this.planned.find(i => !this.plates.has(i))
    if (index !== undefined) this.send(this.raster, { type: 'plate', seed: this.seed, id: ++this.id, index, lit: this.lit })
  }

  private receive(job: Lane, r: BakeReply): void {
    if (r.id !== job.pending?.id || r.seed !== job.pending.seed) { if (r.type === 'plate') close(r); this.stale++; return }
    job.pending = null
    if (job === this.optics) this.workerMaxMs = Math.max(this.workerMaxMs, r.bakeMs)
    else this.plateMaxMs = Math.max(this.plateMaxMs, r.bakeMs)
    try {
      if (r.type === 'error') { this.deny(job, r.error); return }
      if (r.type === 'window') {
        if (this.left < r.origin || this.right > r.origin + r.width) { this.stale++; this.wantWindow = true }
        else {
          const t = performance.now()
          this.window = decodeWindow(r); this.windows++; this.wireBytes += r.blob.bytes.byteLength
          this.decodeMaxMs = Math.max(this.decodeMaxMs, performance.now() - t)
          this.wantWindow = false
        }
        this.pumpWindow()
      } else {
        if (this.planned.includes(r.index) && r.lit === this.lit) {
          this.plates.set(r.index, r); this.bakes++; this.plateBytes += r.bitmap.width * r.bitmap.height * 4
        }
        else { close(r); this.stale++ }
        this.pumpPlates()
      }
    } catch (err) { this.deny(job, String(err)) }
  }

  receipt() { return { worker: !!this.optics.worker, plateWorker: !!this.raster.worker, opticsPending: !!this.optics.pending, rasterPending: !!this.raster.pending, pending: this.optics.pending?.type ?? this.raster.pending?.type ?? null,
    plates: this.plates.size, plateBytes: this.plateBytes, lit: this.lit, windows: this.windows, stale: this.stale, retiredJobs: this.retiredJobs, workerMaxMs: this.workerMaxMs, plateMaxMs: this.plateMaxMs,
    decodeMaxMs: this.decodeMaxMs, wireBytes: this.wireBytes, error: this.error, plateError: this.plateError } }
  private stop(job: Lane) { job.worker?.terminate(); job.worker = null; job.pending = null }
  private deny(job: Lane, error: string) {
    if (job === this.optics) this.error = error
    else this.plateError = error
    job.failed = true; this.stop(job)
  }
  private clearSeed() {
    this.window = null; this.planCenter = -1; this.visible.length = this.planned.length = 0
    for (const p of this.plates.values()) close(p)
    this.plates.clear(); this.plateBytes = 0; this.wantWindow = false
  }
  dispose() {
    this.stop(this.optics); this.stop(this.raster); this.clearSeed()
  }
  reset(seed: number) {
    // Retry is a new owner even when it repeats the same seed. Terminate a
    // busy lane rather than waiting for an unneeded reply (or its timeout).
    if (this.optics.pending) { this.retiredJobs++; this.stop(this.optics) }
    if (this.raster.pending) { this.retiredJobs++; this.stop(this.raster) }
    this.clearSeed(); this.seed = seed; this.optics.failed = this.raster.failed = false; this.error = this.plateError = null; this.dir = 1; this.center = 0
  }
}
