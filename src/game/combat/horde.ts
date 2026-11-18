/** STICKMAN RISING — src/game/combat/horde.ts
 * HORDE BOOK-KEEPING: LOD ticks and a spatial grid.
 * ----------------------------------------------------------------------------
 * A horde is not expensive because one enemy is expensive. It is expensive
 * because the cost is LINEAR in a number the player never looks at directly:
 * the eighty things on screen are fine, the hundred and sixty off screen are
 * burning the same budget for nobody.
 *
 * THE AI LOD RULE. Every enemy within `NEAR_PX` of the player ticks at the full
 * simulation rate, always — those are the ones the player can be hit by, and a
 * frame-rate trick must never change a hit. Everything beyond `NEAR_PX` ticks
 * one frame in `FAR_DIVISOR`, with `dt × FAR_DIVISOR`, so a distant enemy's
 * average speed, attack cadence and timers are IDENTICAL over time; only the
 * granularity changes. That is the property that makes this safe: it is a
 * resampling, not a rule change.
 *
 * DETERMINISM. The plan is a pure function of (positions, player x, tick), and
 * `tick` increments once per fixed step — never per rendered frame. Two runs of
 * the same seed therefore schedule the same enemies on the same steps, so a
 * replay is still a replay.
 *
 * THE GRID. Radius queries (the ultimate's area sweep, execute-target search)
 * used to walk the whole array. A uniform hash over 1-D positions — this game is
 * 1-D in x with a small y band — answers them in O(cell + candidates) instead of
 * O(n). It is rebuilt per step (clear + insert, no allocation after warm-up).
 * ==========================================================================*/

/** Half-width of the full-rate band, px. The viewport is ~1400 px wide at zoom
 *  1, so 900 keeps everything the player can see at full rate. */
export const NEAR_PX = 900
/** Far enemies tick once every this many steps. 3 ≈ −66 % of their CPU. */
export const FAR_DIVISOR = 3

export interface HordeBody {
  x: number
  y: number
  dead: boolean
}

export interface TickPlan {
  /** Indexes that tick this step, with the dt multiplier to use. */
  near: number[]
  far: number[]
  /** How many full-rate updates this plan SAVED this step (the receipt). */
  saved: number
}

/** Plan one step. Allocation-free after warm-up: the caller owns the two arrays. */
export function planTicks(
  bodies: readonly HordeBody[],
  playerX: number,
  tick: number,
  near: TickPlan = { near: [], far: [], saved: 0 },
): TickPlan {
  near.near.length = 0
  near.far.length = 0
  near.saved = 0
  const farStep = tick % FAR_DIVISOR === 0
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]
    if (b.dead) continue
    if (Math.abs(b.x - playerX) <= NEAR_PX) {
      near.near.push(i)
    } else if (farStep) {
      clientFar(near, i)
    } else {
      // skipped entirely this step — that IS the saving
      near.saved++
    }
  }
  return near
}

function clientFar(p: TickPlan, i: number): void {
  p.far.push(i)
  p.saved += 1 - 1 / FAR_DIVISOR
}

/** Uniform 1-D grid over x. `cell` ≈ the query radius keeps the bucket count
 *  small and the scans short. */
export class HordeGrid {
  private readonly cell: number
  /** buckets hold flattened (index, x) PAIRS — the x is kept so a query can
   *  filter to the exact radius instead of returning whole cells. */
  private readonly buckets = new Map<number, number[]>()
  /** Reused arrays so a query does not allocate. */
  private readonly touch: number[] = []

  constructor(cell = 220) {
    this.cell = Math.max(32, cell)
  }

  clear(): void {
    for (const key of this.touch) {
      const b = this.buckets.get(key)
      if (b) b.length = 0
    }
    this.touch.length = 0
  }

  insert(index: number, x: number): void {
    const key = Math.floor(x / this.cell)
    let b = this.buckets.get(key)
    if (!b) {
      b = []
      this.buckets.set(key, b)
    }
    if (b.length === 0) this.touch.push(key)
    b.push(index, x)
  }

  /** Indexes within `radius` of `x`. Writes into `out` (cleared first). */
  query(x: number, radius: number, out: number[]): number[] {
    out.length = 0
    const r = Math.max(0, radius)
    const lo = Math.floor((x - r) / this.cell)
    const hi = Math.floor((x + r) / this.cell)
    for (let k = lo; k <= hi; k++) {
      const b = this.buckets.get(k)
      if (!b) continue
      for (let i = 0; i < b.length; i += 2) {
        if (Math.abs(b[i + 1] - x) <= r) out.push(b[i])
      }
    }
    return out
  }

  /** For the tests / debug: how many buckets are live. */
  size(): number {
    return this.touch.length
  }
}
