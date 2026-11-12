/** STICKMAN RISING — the animation layer stack.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────
 * The pose used to be produced by ~15 writers mutating one shared
 * Float32Array in place, spread across a 369-line `Player.update()`. The
 * correctness of the result depended on those writers happening to run in
 * the right order, and that order existed ONLY as prose comments
 * ("...positioned deliberately AFTER every authored/procedural writer and
 * the grip IK but BEFORE the anatomical gate + FK solve"). Nothing enforced
 * it. Two consequences, both observed:
 *
 *   1. A layer reading a channel another layer had already written would
 *      silently produce a different pose depending on which ran first.
 *   2. Adding a writer anywhere meant re-deriving the whole ordering
 *      argument from the comments. Most of the 4 362-line player.ts was
 *      this.
 *
 * This module replaces the convention with a mechanism. Every contributor
 * declares WHEN it runs (an explicit stage), and the stack runs them in
 * stage order. The order is data, not documentation.
 *
 * ── ORDERING MODEL ─────────────────────────────────────────────────────
 * Stages run in ascending `order`. Within a stage, layers run in
 * registration order, which makes within-stage dependencies explicit and
 * local. The stage names below are the only place the ordering argument
 * needs to be understood; the layers themselves are order-agnostic.
 *
 * ── THE ONE INVARIANT ──────────────────────────────────────────────────
 * A layer is a pure, bounded, frame-local transform of the pose it is
 * handed. It never accumulates across frames and never writes outside its
 * declared channels. This is what makes the stack safe to reorder and what
 * prevented the "spine spin + root sink" bug class, where a writer that
 * integrated deltas without an absolute base ran away over time.
 */

import type { Pose } from './pose'

/** Named stages, in execution order.
 *
 * - `base`       the authored clip writes the pose absolutely (never adds).
 * - `procedural` hand-authored additive motion (dash body language, tremor).
 * - `context`    speed/threat/health-reactive secondary motion.
 * - `smoothing`  damped pose tracking (crossfades, spring settle).
 * - `secondary`  cloth, hair, scarf, and other follow-through.
 * - `variation`  seeded organic noise (PAVE) — bounded and gated.
 * - `constraint` anatomical ROM gate. MUST be the last pose writer before
 *                the solve, so no layer can produce an impossible joint.
 * - `solve`      FK/IK projection into world geometry. Reads the pose and
 *                writes `FighterGeom`; never writes the pose back.
 *
 * Higher stages are later. `constraint` before `solve` is load-bearing.
 */
export const STAGE = {
  base: 0,
  procedural: 1,
  context: 2,
  smoothing: 3,
  secondary: 4,
  variation: 5,
  constraint: 6,
  solve: 7,
} as const

export type Stage = keyof typeof STAGE

/** Read-only frame state handed to every layer. Entities extend this with
 * whatever else their layers legitimately need (the world, their input
 * snapshot), so a layer never reaches back into the entity for state that
 * should have been passed in. */
export interface FrameContext {
  /** Simulation step in seconds. May be 0 (e.g. before the first update). */
  readonly dt: number
  /** Monotonic seconds since the run started. Used for noise/tremor phase. */
  readonly time: number
}

/** A single pose contributor. */
export interface Layer<C extends FrameContext = FrameContext> {
  /** Stable name, used in diagnostics and the `poseOrder()` report. */
  readonly name: string
  readonly stage: Stage
  /** Transform `pose` in place. Must be bounded and frame-local. */
  apply(pose: Pose, ctx: C): void
}

interface Entry<C extends FrameContext> {
  layer: Layer<C>
  /** Registration sequence, to preserve order within a stage. */
  seq: number
}

/**
 * An ordered, introspectable set of animation layers.
 *
 * Ordering is resolved once per frame from the registered layers, so a
 * layer added at any point in the frame is picked up immediately.
 *
 * ```ts
 * stack.add({ name: 'dash-body', stage: 'procedural', apply: (p, c) => {...} })
 * stack.run(pose, { dt, time })
 * ```
 */
export class LayerStack<C extends FrameContext = FrameContext> {
  private readonly entries: Entry<C>[] = []
  private seq = 0
  /** Cached sorted order; invalidated on add/remove. */
  private ordered: Layer<C>[] | null = null

  /** Register a layer. Re-adding a name replaces the previous definition,
   * which keeps hot-reload and test overrides predictable. */
  add(layer: Layer<C>): this {
    const existing = this.entries.findIndex((e) => e.layer.name === layer.name)
    if (existing >= 0) this.entries.splice(existing, 1)
    this.entries.push({ layer, seq: this.seq++ })
    this.ordered = null
    return this
  }

  /** Remove a layer by name. Returns whether anything was removed. */
  remove(name: string): boolean {
    const i = this.entries.findIndex((e) => e.layer.name === name)
    if (i < 0) return false
    this.entries.splice(i, 1)
    this.ordered = null
    return true
  }

  has(name: string): boolean {
    return this.entries.some((e) => e.layer.name === name)
  }

  clear(): void {
    this.entries.length = 0
    this.ordered = null
  }

  /** The resolved execution order. Stable sort within a stage keeps
   * registration order, so within-stage dependencies stay explicit. */
  poseOrder(): readonly Layer<C>[] {
    if (!this.ordered) {
      this.ordered = [...this.entries]
        .sort((a, b) => STAGE[a.layer.stage] - STAGE[b.layer.stage] || a.seq - b.seq)
        .map((e) => e.layer)
    }
    return this.ordered
  }

  /** Run every layer in resolved stage order. */
  run(pose: Pose, ctx: C): void {
    for (const layer of this.poseOrder()) layer.apply(pose, ctx)
  }

  /** Run only the layers in one stage — useful for a layer that must
   * re-run after an out-of-band pose edit (e.g. re-applying the ROM gate
   * after IK nudged a joint). */
  runStage(stage: Stage, pose: Pose, ctx: C): void {
    for (const layer of this.poseOrder()) {
      if (layer.stage === stage) layer.apply(pose, ctx)
    }
  }

  /** Human-readable order, for the `poseOrder` diagnostics command and for
   * asserting the intended pipeline in tests. */
  describe(): string[] {
    return this.poseOrder().map((l) => `${STAGE[l.stage]}:${l.stage}:${l.name}`)
  }
}

/** Assert the constraint gate really is the last pose writer before the
 * solve. Called once at construction; a violation is a programming error,
 * not a runtime condition, so it throws. */
export function assertPipelineSane<C extends FrameContext>(stack: LayerStack<C>): void {
  const order = stack.poseOrder()
  const constraintAt = order.findIndex((l) => l.stage === 'constraint')
  if (constraintAt < 0) return // no gate registered (enemy rigs may omit it)
  const after = order.slice(constraintAt + 1).filter((l) => l.stage !== 'solve')
  if (after.length) {
    throw new Error(
      `pose pipeline: ${after.map((l) => l.name).join(', ')} run after the ` +
      `anatomical gate — a joint written past the ROM gate can be impossible`,
    )
  }
}
