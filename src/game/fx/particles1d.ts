/* ==========================================================================
 * P1D — a one-dimensional particle system, built from scratch.
 * --------------------------------------------------------------------------
 * The design axiom: every particle owns exactly ONE dynamic scalar — its
 * phase φ ∈ (-inf, +inf) normalized to a unit life where applicable. All
 * other attributes (position, size, alpha, hue bucket, rotation) are PURE
 * FUNCTIONS of (immutable seed, φ, global clocks):
 *
 *   φᵢ(t)  = seedPhaseᵢ + t · rateᵢ                 (field particles)
 *   φⱼ(t)  = (t - tStartⱼ) / lifeⱼ                  (burst slots)
 *   posᵢ   = F(seedᵢ, φᵢ, windIntegral(t), cam)
 *
 * Why "1D" matters:
 *   · NO integration loop — there are no vx/vy arrays to Euler-advance, so
 *     the update cost of N particles is O(1) (clocks only) and drift is
 *     impossible (positions at t are exact, split-invariant: 2×dt/2 ≡ dt).
 *   · ZERO allocation after construction — seeds live in typed arrays built
 *     once; bursts acquire slots from a freelist; nothing is ever pushed,
 *     spliced, or string-built per particle. The GC never sees this system.
 *   · Single-membership pool law for burst slots: slot ∈ live XOR ∈ free,
 *     checked by assertPoolLaw() in tests (same law as the FX pools).
 *   · Deterministic: same seeds + same clock ⇒ same frame (replay-safe and
 *     testable headless).
 *   · One global quality level gates every consumer (combat FX fields and
 *     ambient scene fields alike): FULL → LOW → OFF. The level is a single
 *     integer read at draw time — flipping it mid-frame is safe.
 *
 * Field vs burst:
 *   Field1D  — ambient envelopes (snow, petals, bokeh, star twinkle,
 *              meteors). Position is closed-form from absolute time; the
 *              emitter never runs because nothing is ever born or dies.
 *   Burst1D  — bounded event slots (chimney puffs, ripple rings, sparks).
 *              emit() pops the freelist (returns false when exhausted —
 *              the hard cap IS the memory bound), sweep() retires slots
 *              whose phase passed 1 back to the freelist.
 * ========================================================================== */

/** Global particle quality level: 0 OFF · 1 LOW · 2 FULL. */
export const PARTICLE_LEVELS = ['OFF', 'LOW', 'FULL'] as const
export type ParticleLevel = 0 | 1 | 2

// Start clean during the Ultra art review; B can restore the live effects.
let particleLevel: ParticleLevel = 0

export function getParticleLevel(): ParticleLevel {
  return particleLevel
}
export function setParticleLevel(l: ParticleLevel): void {
  particleLevel = l < 0 ? 0 : l > 2 ? 2 : (l as ParticleLevel)
}
/** Cycle FULL → LOW → OFF → FULL; returns the new level. */
export function cycleParticleLevel(): ParticleLevel {
  setParticleLevel(((particleLevel + 2) % 3) as ParticleLevel)
  return particleLevel
}
/** True when the given detail class should draw right now.
 *  detail 2 = full-detail (ambient fields, dense particles)
 *  detail 1 = core (impacts, gameplay-readable sparks) */
export function particlesDraw(detail: 1 | 2): boolean {
  return particleLevel >= detail
}

/* ------------------------------ Field1D --------------------------------- */

export interface FieldOpts {
  /** particle count (hard capacity; typed arrays sized once) */
  count: number
  /** seed the RNG stream for reproducible layouts */
  seed: number
  /** density scaling for quality tiers: how many particles are drawn */
  density?: number
}

/** Deterministic 32-bit PRNG (mulberry32) — seeds are data, not state. */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Ambient analytic field. All seed arrays are immutable after construction.
 * Consumers own the SEED-TO-VISUAL mapping (position formula lives with the
 * scene that knows its geometry); Field1D owns storage, counting and RNG.
 */
export class Field1D {
  readonly n: number
  readonly a: Float32Array // seed channel 0
  readonly b: Float32Array // seed channel 1
  readonly c: Float32Array // seed channel 2
  readonly d: Float32Array // seed channel 3 (rate / phase / size …)
  readonly e: Float32Array // seed channel 4
  density: number
  /** draw iterations (tests assert it never runs in update) */
  drawCalls = 0

  constructor(opts: FieldOpts) {
    const n = Math.max(1, opts.count | 0)
    this.n = n
    this.a = new Float32Array(n)
    this.b = new Float32Array(n)
    this.c = new Float32Array(n)
    this.d = new Float32Array(n)
    this.e = new Float32Array(n)
    this.density = opts.density ?? 1
    const r = mulberry32(opts.seed >>> 0)
    for (let i = 0; i < n; i++) {
      this.a[i] = r()
      this.b[i] = r()
      this.c[i] = r()
      this.d[i] = r()
      this.e[i] = r()
    }
  }

  /** how many particles the current quality/density admits */
  activeCount(level = particleLevel): number {
    if (level <= 0) return 0
    const scale = level === 1 ? 0.45 : 1
    return Math.min(this.n, Math.max(0, Math.round(this.n * this.density * scale)))
  }
}

/* ------------------------------ Burst1D --------------------------------- */

/** Maximum simultaneously live burst slots per system (hard memory cap). */
export class Burst1D {
  readonly cap: number
  /** phase of each slot: < 0 = free (inactive) */
  private readonly ph: Float32Array
  private readonly t0: Float32Array // start time
  private readonly life: Float32Array
  private readonly ox: Float32Array // origin
  private readonly oy: Float32Array
  private readonly s0: Float32Array // per-slot seed / kind data
  private readonly s1: Float32Array
  private readonly free: Int32Array
  private freeTop: number
  private liveCount = 0
  /** monotone stats — emit attempts vs successes (tests + telemetry) */
  emits = 0
  rejects = 0
  retires = 0

  constructor(cap: number) {
    this.cap = Math.max(1, cap | 0)
    this.ph = new Float32Array(this.cap)
    this.t0 = new Float32Array(this.cap)
    this.life = new Float32Array(this.cap)
    this.ox = new Float32Array(this.cap)
    this.oy = new Float32Array(this.cap)
    this.s0 = new Float32Array(this.cap)
    this.s1 = new Float32Array(this.cap)
    this.free = new Int32Array(this.cap)
    for (let i = 0; i < this.cap; i++) {
      this.ph[i] = -1
      this.free[i] = this.cap - 1 - i
    }
    this.freeTop = this.cap
  }

  get live(): number {
    return this.liveCount
  }
  get freeSlots(): number {
    return this.freeTop
  }

  /** Acquire a slot from the freelist. Returns -1 when the cap is hit —
   *  callers drop the event instead of allocating (the cap is the law). */
  acquire(): number {
    this.emits++
    if (this.freeTop <= 0) {
      this.rejects++
      return -1
    }
    return this.free[--this.freeTop]
  }

  /** Mark a freshly acquired slot live with its clocks set. Re-starting a
   *  live slot is a no-op (double-counting liveCount would break the law). */
  start(i: number, t: number, life: number, x: number, y: number, s0: number, s1: number): void {
    if (i < 0 || i >= this.cap || this.ph[i] >= 0) return
    this.ph[i] = 0
    this.t0[i] = t
    this.life[i] = life > 1e-6 ? life : 1e-6
    this.ox[i] = x
    this.oy[i] = y
    this.s0[i] = s0
    this.s1[i] = s1
    this.liveCount++
  }

  /** Convenience: acquire + start in one call. false = cap reached. */
  emit(t: number, life: number, x: number, y: number, s0 = 0, s1 = 0): boolean {
    const i = this.acquire()
    if (i < 0) return false
    this.start(i, t, life, x, y, s0, s1)
    return true
  }

  /** Phase of slot i at time t, or -1 if free. */
  phase(i: number, t: number): number {
    const p = this.ph[i]
    if (p < 0) return -1
    return (t - this.t0[i]) / this.life[i]
  }

  originX(i: number): number {
    return this.ox[i]
  }
  originY(i: number): number {
    return this.oy[i]
  }
  seed0(i: number): number {
    return this.s0[i]
  }
  seed1(i: number): number {
    return this.s1[i]
  }

  /** Retire finished slots back to the freelist (single membership). */
  sweep(t: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.ph[i] < 0) continue
      if ((t - this.t0[i]) / this.life[i] >= 1) {
        this.ph[i] = -1
        this.free[this.freeTop++] = i
        this.liveCount--
        this.retires++
      }
    }
  }

  /** Full reset (scene teardown / test isolation). */
  clear(): void {
    for (let i = 0; i < this.cap; i++) this.ph[i] = -1
    for (let i = 0; i < this.cap; i++) this.free[i] = this.cap - 1 - i
    this.freeTop = this.cap
    this.liveCount = 0
  }
}

/** Pool-law assertion helper (tests + debug builds). */
export function assertBurstLaw(b: Burst1D, label = 'burst'): void {
  if (b.live + b.freeSlots !== b.cap) {
    throw new Error(`${label}: pool law broken — live ${b.live} + free ${b.freeSlots} != cap ${b.cap}`)
  }
}
