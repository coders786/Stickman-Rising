/** STICKMAN RISING — src/game/render/ledger.ts
 * THE CANVAS LEDGER: every offscreen surface has an owner, a cost and a way out.
 * ----------------------------------------------------------------------------
 * The audit that produced docs/master/12 found 37 live canvases and 30.3 MB
 * resident, none of them tracked. A 2048×1024 backing represents 8 MiB of RGBA
 * pixels, even if nobody samples it. Actual browser and GPU memory can differ.
 * Two rules follow:
 *
 *  1. ONE PLACE CREATES OFFSCREEN SURFACES. Call sites ask the ledger; the
 *     ledger decides whether that is a fresh allocation, a reuse, or an
 *     eviction. `scripts/lint-boundaries.mjs` fails the build if game code
 *     calls `document.createElement('canvas')` outside this file and the
 *     environment baker.
 *
 *  2. RELEASE MEANS ZERO, NOT DROP. Setting `width = height = 0` frees the
 *     backing store immediately on every engine that matters; keeping the
 *     element around costs nothing and avoids a DOM churn spike. This is the
 *     documented Safari/Chrome idiom (see 12 §4).
 *
 * The ledger is deliberately DOM-free at its core: the surface factory is
 * injectable, so the unit tests run in Node with a stub and assert the same
 * eviction/reuse behaviour the browser gets.
 * ==========================================================================*/

export interface Surface {
  width: number
  height: number
  getContext(type: '2d'): CanvasRenderingContext2D | null
}

export interface LedgerCaps {
  /** Soft caps for required surfaces; pinned entries are not evictable.
   *  Inspect the overage instead of treating estimates as a GPU limit. */
  maxSurfaces: number
  /** Page-rounded RGBA estimate, not browser/GPU memory. */
  maxBytes: number
  /** Surfaces at or below this size are not worth LRU bookkeeping. */
  minTrackedBytes: number
}

export const DEFAULT_CAPS: LedgerCaps = { maxSurfaces: 48, maxBytes: 48 * 1024 * 1024, minTrackedBytes: 0 }

interface Entry {
  key: string
  surface: Surface
  w: number
  h: number
  bytes: number
  /** Monotonic tick of last access — the LRU order. */
  last: number
  /** Diagnostics only. */
  tag: string
  /** A pinned surface is COUNTERPARTY TO THE CAPS: it is accounted in bytes but
   *  never chosen as an LRU victim. Bakes held for the lifetime of a run (city
   *  tiles, sprite atlases, HUD plates) are pinned because evicting one does not
   *  free memory a frame later — it blanks a plate the renderer still blits. See
   *  the eviction note in `enforce`. */
  pinned: boolean
}

/** 4 bytes per pixel; the alpha channel is real and is allocated whether the
 *  painter uses it. Rounding up to 4 KiB keeps small surfaces from pretending
 *  to be free (GPU allocations are page-granular in practice). */
export function bytesFor(w: number, h: number): number {
  const raw = Math.max(1, Math.floor(w)) * Math.max(1, Math.floor(h)) * 4
  return Math.ceil(raw / 4096) * 4096
}

export class CanvasLedger {
  private readonly caps: LedgerCaps
  private readonly factory: (w: number, h: number) => Surface
  private readonly map = new Map<string, Entry>()
  private tick = 0
  /** Counters are cumulative so a frame log can diff them without allocating. */
  acquired = 0
  reused = 0
  evicted = 0
  /** Live backing estimate; keep the old field name for bench/debug callers. */
  createdBytes = 0
  peakBytes = 0
  resized = 0
  released = 0
  optionalDeclined = 0

  constructor(factory?: (w: number, h: number) => Surface, caps: Partial<LedgerCaps> = {}) {
    this.caps = { ...DEFAULT_CAPS, ...caps }
    this.factory = factory ?? ((w, h) => {
      if (typeof document === 'undefined') throw new Error('CanvasLedger needs a factory outside the browser')
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return c as unknown as Surface
    })
  }

  /** Ask for a surface. An exact (key,w,h) match is reused; a match with a
   *  different size is reallocated in place (canvas resize clears it, which is
   *  what a caller wants anyway); otherwise a new one is created and the LRU
   *  entry is released if a cap is about to be crossed. */
  acquire(key: string, w: number, h: number, tag = '', pin = false, streaming = false): Surface {
    const wi = Math.max(1, Math.floor(w))
    const hi = Math.max(1, Math.floor(h))
    this.tick++
    const hit = this.map.get(key)
    if (hit) {
      if (hit.w !== wi || hit.h !== hi || hit.surface.width !== wi || hit.surface.height !== hi) {
        const bytes = bytesFor(wi, hi)
        const delta = bytes - hit.bytes
        if (delta > 0) this.enforce(delta, 0, hit)
        // Shrink the longer side first when the other grows. Width and height
        // assignments allocate independently on some Canvas implementations.
        if (hi < hit.surface.height) hit.surface.height = hi
        if (wi !== hit.surface.width) hit.surface.width = wi
        if (hi !== hit.surface.height) hit.surface.height = hi
        hit.w = wi
        hit.h = hi
        hit.bytes = bytes
        this.createdBytes += delta
        this.peakBytes = Math.max(this.peakBytes, this.createdBytes)
        this.resized++
      }
      hit.last = this.tick
      hit.tag = tag || hit.tag
      if (pin) hit.pinned = true
      this.reused++
      return hit.surface
    }
    const bytes = bytesFor(wi, hi)
    this.enforce(bytes, 1)
    const surface = streaming && typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(wi, hi) as unknown as Surface : this.factory(wi, hi)
    this.map.set(key, { key, surface, w: wi, h: hi, bytes, last: this.tick, tag, pinned: pin })
    this.createdBytes += bytes
    this.peakBytes = Math.max(this.peakBytes, this.createdBytes)
    this.acquired++
    return surface
  }

  /** Optional retained art can reuse or shrink a claim, or decline growth.
   * A declined claim changes neither its old backing nor other owners. The
   * caller must have a fallback; required paints should use acquire(). */
  tryAcquire(key: string, w: number, h: number, tag = '', streaming = false): Surface | null {
    const old = this.map.get(key)
    const delta = bytesFor(w, h) - (old?.bytes ?? 0)
    if (delta > 0 && (this.createdBytes + delta > this.caps.maxBytes ||
                      this.map.size + (old ? 0 : 1) > this.caps.maxSurfaces)) {
      this.optionalDeclined++
      return null
    }
    return this.acquire(key, w, h, tag, true, streaming)
  }

  /** Get without creating. Used by draw paths that must never allocate. */
  peek(key: string, w: number, h: number): Surface | null {
    const e = this.map.get(key)
    if (!e || e.w !== Math.floor(w) || e.h !== Math.floor(h)) return null
    e.last = ++this.tick
    return e.surface
  }

  has(key: string): boolean { return this.map.has(key) }

  /** Drop one surface NOW. Release = zero the backing store. */
  release(key: string): boolean {
    const e = this.map.get(key)
    if (!e) return false
    this.createdBytes -= e.bytes
    e.surface.width = 0
    e.surface.height = 0
    this.map.delete(key)
    this.released++
    return true
  }

  /** Evict everything whose key starts with `prefix`. Used when a run reseeds
   *  and every baked plate for the old seed becomes garbage at once. */
  releasePrefix(prefix: string): number {
    let n = 0
    for (const key of Array.from(this.map.keys())) {
      if (key.startsWith(prefix)) { this.release(key); n++ }
    }
    return n
  }

  releaseAll(): void {
    for (const key of Array.from(this.map.keys())) this.release(key)
  }

  /** Snapshot on demand; no inventory walk during a normal frame. */
  stats() {
    let pinnedBytes = 0
    for (const e of this.map.values()) if (e.pinned) pinnedBytes += e.bytes
    return {
      surfaces: this.map.size, bytes: this.createdBytes, createdBytes: this.createdBytes,
      pinnedBytes, evictableBytes: this.createdBytes - pinnedBytes, peakBytes: this.peakBytes,
      resized: this.resized, released: this.released, optionalDeclined: this.optionalDeclined,
      overBytes: Math.max(0, this.createdBytes - this.caps.maxBytes),
      overSurfaces: Math.max(0, this.map.size - this.caps.maxSurfaces),
      evicted: this.evicted, reused: this.reused, acquired: this.acquired,
    }
  }

  /** Ordered by last use, most recent first — the debug overlay's table. */
  list(): ReadonlyArray<{ key: string; w: number; h: number; bytes: number; tag: string; pinned: boolean }> {
    const out = Array.from(this.map.values())
      .sort((a, b) => b.last - a.last)
      .map((e) => ({ key: e.key, w: e.w, h: e.h, bytes: e.bytes, tag: e.tag, pinned: e.pinned }))
    return out
  }

  /** Evict LRU scratch for a new or growing claim. The resized entry keeps its
   * identity and cannot be its own victim; required pinned overflow is counted
   * in stats rather than evicting a surface that the renderer still holds. */
  private enforce(incomingBytes: number, incomingCount: number, keep?: Entry): void {
    while (this.map.size + incomingCount > this.caps.maxSurfaces ||
           this.createdBytes + incomingBytes > this.caps.maxBytes) {
      let victim: Entry | null = null
      for (const e of this.map.values()) {
        if (e === keep || e.pinned || e.bytes < this.caps.minTrackedBytes) continue
        if (!victim || e.last < victim.last) victim = e
      }
      if (!victim) break
      this.release(victim.key)
      this.evicted++
    }
  }
}

/** IS THIS SURFACE STILL DRAWABLE?
 *
 *  A canvas OBJECT outlives its backing store. `release()` zeroes width/height to
 *  hand the memory back, and `drawImage` on a 0×0 source throws
 *  `InvalidStateError` — an exception that bubbles out of the render loop and
 *  stops the game, not a glitch the player can play through.
 *
 *  So every blit of a cached plate checks this first. It costs two property
 *  reads, and it turns "one bad eviction kills the frame" into "one plate is
 *  skipped for a frame". Belt AND braces on purpose: the entries that must never
 *  be evicted are pinned (see Entry.pinned), and anything that slips through is
 *  caught here. */
export function hasPixels<T extends { width: number; height: number }>(c: T | null | undefined): c is T {
  return !!c && c.width > 0 && c.height > 0
}

/** Process-wide ledger for the game. Tests construct their own. */
export const gameLedger = new CanvasLedger()

/** A component's stable slots. Distinct instances may share the process
 * ledger without sharing ownership; replacing one must not zero the other's
 * live canvas. Use a generation for art that gets replaced as one group. */
export class SurfaceScope {
  private static nextId = 0
  readonly prefix: string

  constructor(label: string, private readonly ledger = gameLedger) {
    this.prefix = `${label}:${++SurfaceScope.nextId}:`
  }

  acquire(slot: string, w: number, h: number, tag: string): HTMLCanvasElement {
    return this.ledger.acquire(this.prefix + slot, w, h, tag, true) as HTMLCanvasElement
  }

  /** Streamed art uses a real OffscreenCanvas where supported. HTML canvas
   * fallback shares the same slot keys and release/accounting law. */
  streamed(slot: string, w: number, h: number, tag: string): OffscreenCanvas | HTMLCanvasElement | null {
    return this.ledger.tryAcquire(this.prefix + slot, w, h, tag, true) as unknown as OffscreenCanvas | HTMLCanvasElement | null
  }

  tryAcquire(slot: string, w: number, h: number, tag: string): HTMLCanvasElement | null {
    return this.ledger.tryAcquire(this.prefix + slot, w, h, tag) as HTMLCanvasElement | null
  }

  release(slot: string): void {
    this.ledger.release(this.prefix + slot)
  }

  releaseAll(): void {
    this.ledger.releasePrefix(this.prefix)
  }

  generation(label: string): SurfaceGen {
    return new SurfaceGen(`${this.prefix}${label}:`, this.ledger)
  }
}

/** A GENERATION of pinned surfaces under one key prefix.
 *
 *  Bakes come in generations: every city tile is rebuilt when the run reseeds,
 *  every sprite when the palette changes. Without a generation the ledger would
 *  either accumulate the old surfaces (a leak per run) or evict a live one (a
 *  blank plate). `begin()` releases the whole previous generation at once, and
 *  the counter makes each surface's key unique inside the new one — so a bake
 *  can keep saying `next(w, h)` without inventing names, and the accounting
 *  stays exact.
 *
 *  No canvas is created here: this is a ledger client like any other. */
export class SurfaceGen {
  private n = 0
  constructor(readonly prefix: string, private readonly ledger: CanvasLedger = gameLedger) {}

  /** Drop the previous generation and start counting from zero again. */
  begin(): void {
    this.ledger.releasePrefix(this.prefix)
    this.n = 0
  }

  /** The next pinned surface of this generation. */
  next(w: number, h: number, tag = ''): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
    const key = `${this.prefix}${this.n++}`
    const c = this.ledger.acquire(key, w, h, tag || this.prefix, true) as unknown as HTMLCanvasElement
    const g = c.getContext('2d')
    if (!g) throw new Error('2D canvas context unavailable')
    return { c, g }
  }

  get count(): number {
    return this.n
  }
}
