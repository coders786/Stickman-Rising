/** STICKMAN RISING — fixed-step simulation clock policy (plan M03).
 *
 * The combat simulation advances ONLY in exact fixed-size steps. Render
 * frames feed an accumulator; this policy decides how many steps run and
 * what happens to backlog that exceeds the bound:
 *
 *   - `steps`   : always exactly `stepDt` each — never a variable-size
 *                 "catch-up tick" disguised as a step (a 50 ms tick is a
 *                 different simulation than 1/60, even if it keeps
 *                 roughly real-time).
 *   - `dropped` : backlog above `maxBacklog` is DROPPED EXPLICITLY and
 *                 counted. Dropping time under overload is a documented
 *                 degradation (bounded-debt policy), not a faster
 *                 equivalent simulation. The spiral of death is avoided by
 *                 capping both carried debt and per-render work.
 *   - `acc`     : residual debt after the steps, always < stepDt when
 *                 maxBacklog is an integer multiple of stepDt and no drop
 *                 clamped it — carried smoothly into the next render.
 *
 * Weather/visual systems keep their own wall/visual clock (documented
 * separately in Game.frame); this policy governs gameplay time only.
 */

export interface SimClockPolicy {
  /** fixed combat step, seconds (1/60 = the tuned configuration) */
  stepDt: number
  /** maximum fixed steps executed per render (bounded work) */
  maxSteps: number
  /** maximum carried backlog, seconds; excess is dropped and counted */
  maxBacklog: number
}

/** The render loop never feeds more than 50 ms to simulation or visuals;
 *  physics work is capped at two exact 1/60 steps per rendered frame. */
export const MAX_FRAME_DT = 0.05
export const DEFAULT_SIM_CLOCK: SimClockPolicy = {
  stepDt: 1 / 60,
  maxSteps: 2,
  maxBacklog: 2 / 60,
}

export interface SimClockAdvance {
  /** fixed steps to execute this render (0..maxSteps) */
  steps: number
  /** accumulator to store after the steps */
  acc: number
  /** seconds of requested gameplay time explicitly dropped (≥ 0) */
  dropped: number
  /** the fixed step size to execute */
  stepDt: number
}

/** Pure accumulator advance. `acc` is the carried backlog from the previous
 *  render; `dt` is the (already scaled by hitstop/slowmo) requested time. */
export function advanceSimClock(
  acc: number,
  dt: number,
  policy: SimClockPolicy = DEFAULT_SIM_CLOCK,
): SimClockAdvance {
  let a = acc + (Number.isFinite(dt) && dt > 0 ? dt : 0)
  let dropped = 0
  if (a > policy.maxBacklog) {
    dropped = a - policy.maxBacklog
    a = policy.maxBacklog
  }
  // +1e-9: floating dust (0.16666666666666666 × 3) must not strand a step.
  let steps = Math.floor(a / policy.stepDt + 1e-9)
  if (steps > policy.maxSteps) steps = policy.maxSteps
  a -= steps * policy.stepDt
  if (a < 1e-12) a = 0
  return { steps, acc: a, dropped, stepDt: policy.stepDt }
}
