/** STICKMAN RISING — src/game/render/ledger.ts
 * THE CANVAS LEDGER: every offscreen surface has an owner, a cost and a way out.
 * ----------------------------------------------------------------------------
 * The audit that produced docs/master/12 found 37 live canvases and 30.3 MB
 * resident, none of them tracked. Canvas memory is not garbage that a browser
 * magically reclaims *during* a match: a 2048×1024 backing store is 8 MB of GPU
 * memory whether or not you still use it, and mobile Safari will happily kill a
 * tab for holding it. Two rules follow:
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
  /** Hard cap on live surfaces. Exceeding it evicts LRU rather than throwing:
   *  a dropped frame from a missing plate is worse than a re-bake. */
  maxSurfaces: number
  /** Hard cap on estimated bytes. Same policy. */
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
  createdBytes = 0

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
  acquire(key: string, w: number, h: number, tag = '', pin = false): Surface {
    const wi = Math.max(1, Math.floor(w))
    const hi = Math.max(1, Math.floor(h))
    this.tick++
    const hit = this.map.get(key)
    if (hit) {
      if (hit.w !== wi || hit.h !== hi) {
        this.createdBytes -= hit.bytes
        hit.surface.width = wi
        hit.surface.height = hi
        hit.w = wi
        hit.h = hi
        hit.bytes = bytesFor(wi, hi)
        this.createdBytes += hit.bytes
      }
      hit.last = this.tick
      hit.tag = tag || hit.tag
      if (pin) hit.pinned = true
      this.reused++
      return hit.surface
    }
    const bytes = bytesFor(wi, hi)
    this.enforce(wi * hi * 4, 1)
    const surface = this.factory(wi, hi)
    this.map.set(key, { key, surface, w: wi, h: hi, bytes, last: this.tick, tag, pinned: pin })
    this.createdBytes += bytes
    this.acquired++
    return surface
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

  /** World-tick advance so a per-frame caller can mark liveness. */
  stats(): { surfaces: number; bytes: number; createdBytes: number; evicted: number; reused: number; acquired: number } {
    let bytes = 0
    for (const e of this.map.values()) bytes += e.bytes
    return { surfaces: this.map.size, bytes, createdBytes: this.createdBytes, evicted: this.evicted, reused: this.reused, acquired: this.acquired }
  }

  /** Ordered by last use, most recent first — the debug overlay's table. */
  list(): ReadonlyArray<{ key: string; w: number; h: number; bytes: number; tag: string }> {
    const out = Array.from(this.map.values())
      .sort((a, b) => b.last - a.last)
      .map((e) => ({ key: e.key, w: e.w, h: e.h, bytes: e.bytes, tag: e.tag }))
    return out
  }

  /** Ensure adding `incomingBytes` / `incomingCount` cannot cross a cap.
   *  Evicts least-recently-used first.
   *
   *  One documented exception: a single claim LARGER than `maxBytes` is
   *  honoured after every other surface has been evicted. Refusing it would
   *  mean "this plate cannot exist", and a caller with no plate draws nothing —
   *  a missing moon is a worse outcome than a temporarily over-budget ledger.
   *  The bench reports the overshoot so the cap can be raised deliberately. */
  private enforce(incomingBytes: number, incomingCount: number): void {
    const overCount = () => this.map.size + incomingCount > this.caps.maxSurfaces
    const overBytes = () => {
      let b = incomingBytes
      for (const e of this.map.values()) b += e.bytes
      return b > this.caps.maxBytes
    }
    while (this.map.size > 0 && (overCount() || overBytes())) {
      let victim: Entry | null = null
      for (const e of this.map.values()) {
        if (e.pinned) continue // see Entry.pinned
        if (e.bytes < this.caps.minTrackedBytes) continue
        if (!victim || e.last < victim.last) victim = e
      }
      if (!victim) break
      this.release(victim.key)
      this.evicted++
    }
  }
}

/** Process-wide ledger for the game. Tests construct their own. */
export const gameLedger = new CanvasLedger()

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
