/** STICKMAN RISING — THE COMBO DIRECTOR (hand-to-hand randomization).
 *
 * The empty-hand chain graph (moveset.ts) declares WHICH moves may follow
 * which; this module decides WHICH ONE actually fires. A seeded weighted
 * random walk over the graph, with three humanizing laws:
 *
 *  1. ANTI-REPEAT — the move you just threw is down-weighted (×0.2), and a
 *     third identical throw in a row is nearly banned (×0.03). Strings
 *     never read as a loop.
 *  2. VARIETY MEMORY — every turn a move goes unseen, its weight grows
 *     (+8%/turn, capped ×1.8). Over a long string the whole graph gets
 *     visited instead of the same two branches.
 *  3. COMBO HEAT — as the live combo climbs, finisher-tier moves (the
 *     X-slash, OMEGA, WRATH, the OMEGA PALM) grow likelier and launchers
 *     gain weight: strings naturally escalate toward a closer instead of
 *     ending on a jab.
 *
 * Seeded per-combo (mulberry32, reseed on every attack start — the same
 * law as PAVE's per-combo uniqueness), so no two strings play identically
 * while remaining deterministic for a given seed. Pure and allocation-
 * free in the hot path: the caller passes the candidate list (usually
 * `def.chain`) and a `requires` resolver; the director returns one id
 * or null when nothing is legal right now.
 */

export type Requires = 'ground' | 'air' | 'any'

/** Base branch weights per move id — lights flow, heavies commit,
 * launchers are opportunities, finishers are closers. Unknown ids fall
 * back to DEFAULT_WEIGHT. */
const BRANCH_WEIGHTS: Record<string, number> = {
  /* ground lights — the flow */
  l2: 10, l3: 10, l4: 9, l5: 8,
  sakugaJabCross: 7, sakugaBarrage: 6, stabs: 6, retreat: 5,
  viperPalm: 8, ironRoot: 7, cyclone: 6,
  /* heavies — commitment */
  h1: 6, h2: 5, h3: 4, avalancheElbow: 5, axeKick: 4, spinHook: 4, stepKick: 4,
  /* launchers / sweeps — opportunity */
  launcher: 4, spin: 5, sakugaDragon: 3,
  /* finishers — closers (heat-boosted) */
  srOnslaught: 2, srOmega: 2, sakugaWrath: 2, sakugaScorpion: 2, sakugaHammer: 2,
  omegaPalm: 2,
  /* air family */
  a1: 8, a2: 8, a3: 7, dive: 4, slam: 4,
}
const DEFAULT_WEIGHT = 5

/** Ids that read as closers — boosted by combo heat. */
const FINISHER_IDS = new Set([
  'srOnslaught', 'srOmega', 'sakugaWrath', 'sakugaScorpion', 'sakugaHammer', 'omegaPalm',
])
const LAUNCHER_IDS = new Set(['launcher', 'sakugaDragon'])

export interface ComboPickContext {
  /** live combo hit count (heat) */
  comboHits: number
  /** true when the player is grounded right now */
  grounded: boolean
}

export class ComboDirector {
  private rngState = 0x9e3779b9
  /** last few thrown move ids (anti-repeat + variety memory) */
  private recent: string[] = []
  /** turns since each move was last thrown (variety memory) */
  private unseen = new Map<string, number>()

  constructor() {
    this.reseed(Math.random() * 1e6, Math.random() * 1000)
  }

  /** Per-combo seed — same law as PAVE: time + position. */
  reseed(time: number, x: number): void {
    this.rngState = (Math.imul((time * 1000) | 0, 2654435761) ^ ((x * 131) | 0)) >>> 0
    if (this.rngState === 0) this.rngState = 0x9e3779b9
    this.recent.length = 0
    this.unseen.clear()
  }

  /** mulberry32 — tiny, fast, good enough for branch selection. */
  private next(): number {
    let t = (this.rngState += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Playback tempo for the next unarmed swing: 0.97–1.04×. Subtle, but
   * across a string no two exchanges breathe identically. */
  tempo(): number {
    return 0.97 + this.next() * 0.07
  }

  /** Record a thrown move (call from startAttack). */
  record(id: string): void {
    this.recent.push(id)
    if (this.recent.length > 8) this.recent.shift()
    this.unseen.set(id, 0)
    for (const [k, v] of this.unseen) {
      if (k !== id) this.unseen.set(k, v + 1)
    }
  }

  /** Weighted pick over `candidates`, filtered by the `requires` resolver.
   * Returns null when no candidate is legal in the current context. */
  pick(
    candidates: readonly string[],
    ctx: ComboPickContext,
    requiresOf: (id: string) => Requires = () => 'any',
  ): string | null {
    // legal set: ground moves only while grounded, air moves only airborne
    let pool: string[] | null = null
    for (const id of candidates) {
      const r = requiresOf(id)
      if (r === 'ground' && !ctx.grounded) continue
      if (r === 'air' && ctx.grounded) continue
      if (!pool) pool = []
      pool.push(id)
    }
    if (!pool || pool.length === 0) return null
    if (pool.length === 1) return pool[0]

    const last = this.recent[this.recent.length - 1]
    const prev = this.recent[this.recent.length - 2]
    const heat = ctx.comboHits >= 16 ? 3 : ctx.comboHits >= 8 ? 2 : 1

    let total = 0
    const weights = new Array<number>(pool.length)
    for (let i = 0; i < pool.length; i++) {
      const id = pool[i]
      let w = BRANCH_WEIGHTS[id] ?? DEFAULT_WEIGHT
      // anti-repeat
      if (id === last) w *= prev === last ? 0.03 : 0.2
      // variety memory: unseen moves grow likelier
      const un = this.unseen.get(id) ?? 0
      if (un > 0) w *= 1 + Math.min(un, 10) * 0.08
      // combo heat: closers and launchers escalate
      if (heat > 1 && FINISHER_IDS.has(id)) w *= heat
      if (heat > 1 && LAUNCHER_IDS.has(id)) w *= 1.5
      weights[i] = w
      total += w
    }
    let roll = this.next() * total
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i]
      if (roll <= 0) return pool[i]
    }
    return pool[pool.length - 1]
  }
}
