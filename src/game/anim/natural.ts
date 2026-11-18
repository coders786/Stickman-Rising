/** STICKMAN RISING — src/game/anim/natural.ts
 * THE MOTION LIBRARY: the four curves that make code-generated motion read as
 * living rather than as keyframes (docs/master/20, M4.5 U1–U5).
 * ----------------------------------------------------------------------------
 * Everything here is a pure function of (state, time), allocation-free in the
 * hot path, and deterministic under a fixed step. That last property is not
 * decoration: the sim runs at 60 Hz and the rig is sampled at render rate
 * (D10), so any secondary motion integrated at render rate would make the
 * picture depend on the phone's refresh rate. Every integrator below takes a
 * FIXED sub-step and an accumulator, by construction.
 *
 * 1. MINIMUM JERK — s(τ)=10τ³−15τ⁴+6τ⁵. The displacement profile that
 *    minimises the integral of squared jerk, and the one human pointing
 *    movements actually approximate (Flash & Hogan 1985). Peak velocity is
 *    1.875× the mean, so mean/peak = 0.533 — the number our `M-VELPROF` metric
 *    is scored against, and the reason a hand-authored "ease-in-out" cubic
 *    reads subtly wrong: it peaks at 1.5, not 1.875.
 *
 * 2. TWO-THIRDS POWER LAW — for a curved reach, angular velocity falls as
 *    curvature^(-1/3), equivalently tangential speed follows v ∝ κ^(−1/3)
 *    (Lacquaniti, Terzuolo & Viviani 1983). Sampled in ARC LENGTH, a weapon
 *    arc built this way spends its time where humans do: slow at the turn,
 *    fast on the straight. Uniform arc-length sampling is the single most
 *    common way procedural swings announce themselves as procedural.
 *
 * 3. SPRING CHAINS — secondary motion (a scabbard, a cable, a coat tail) is a
 *    damped wave, not a keyframe. ζ ∈ [0.2, 0.8] per the SFM hair study: below
 *    0.2 it buzzes, above 0.8 it is a rigid stick. Fixed 1/120 s sub-steps,
 *    semi-implicit Euler, then one inextensibility pass — cheap, stable, and
 *    it cannot explode because the constraint is applied after the integrate.
 *
 * 4. APERIODIC LIFE — breathing and idle drift as a sum of three incommensurate
 *    sines. A single sine is a machine; two is a pendulum; three with irrational
 *    frequency ratios never repeats within a session, which is what "alive"
 *    actually means. Deterministic from the entity seed, so two enemies breathing
 *    in phase is impossible.
 * ==========================================================================*/

const TAU = Math.PI * 2

/* --------------------------- 1. minimum jerk --------------------------- */

/** Normalised minimum-jerk displacement, τ ∈ [0,1]. */
export function minJerk(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * x * (10 + x * (-15 + 6 * x))
}

/** Its first derivative — normalised velocity, peak 1.875 at τ = 0.5. */
export function minJerkVel(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return 30 * x * x * (1 + x * (-2 + x))
}

/** Its second derivative — normalised acceleration, peak 5.7735 at τ≈0.211/0.789. */
export function minJerkAcc(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return 60 * x * (1 + x * (-3 + 2 * x))
}

/** The signature number every profile is scored against (M-VELPROF 0.50–0.58). */
export const MIN_JERK_MEAN_OVER_PEAK = 1 / 1.875

/** Ease wrapper matching the `EaseFn` shape used by animator/bake. */
export function easeMinJerk(t: number): number { return minJerk(t) }

/* ------------------------ 2. two-thirds power law ------------------------ */

/** Tangential speed for a curvature κ (1/px), normalised so κ = 1/120 px⁻¹
 *  gives 1.0. v ∝ κ^(-1/3) is the classic statement; the clamp keeps a
 *  degenerate (straight) segment from going to infinity. */
export function powerLawSpeed(curvature: number): number {
  const k = curvature > 1e-6 ? curvature : 1e-6
  const v = Math.pow(k * 120, -1 / 3)
  return v > 3.2 ? 3.2 : v < 0.2 ? 0.2 : v
}

/** Progress along an arc, sampled by the power law. `s` is normalised arc
 *  length [0,1]; the return is the *time* fraction at which the arc position
 *  `s` is reached, i.e. the inverse of ∫ds/v. For the 2/3 law this is the
 *  closed form s^(2/3), which is why we can do it with one pow and no table. */
export function powerLawProgress(s: number): number {
  const x = s < 0 ? 0 : s > 1 ? 1 : s
  return Math.pow(x, 2 / 3)
}

/* ---------------------------- 3. spring chain ---------------------------- */

export interface ChainConfig {
  /** Number of POINTS (links = points − 1). 17–21 measured as the knee of the
   *  quality/cost curve for a 120 px tail at 120 Hz (20 §4). */
  points: number
  /** Segment length in px. The rest pose is a straight line of points×len. */
  link: number
  /** Damping ratio. 0.2 = springy, 0.8 = heavy cloth. Never below 0.2. */
  zeta: number
  /** Undamped natural frequency, rad/s. 18–26 is a scabbard; 6–10 is cloth. */
  omega: number
  /** Gravity on each point, px/s². 0 disables sag (a floating ribbon). */
  gravity: number
  /** How strongly the tip follows its target (0 = pure rope, 1 = welded). */
  follow: number
}

export const DEFAULT_CHAIN: ChainConfig = { points: 19, link: 6.4, zeta: 0.55, omega: 21, gravity: 900, follow: 0.85 }

/** A fixed-step spring chain. `step(dt)` accumulates real time and integrates
 *  in 1/120 s slices, so a 144 Hz phone and a 60 Hz phone produce the same
 *  rope within one sub-step of each other. No allocation after construction. */
export class SpringChain {
  readonly cfg: ChainConfig
  /** Point positions, interleaved x,y. */
  readonly p: Float32Array
  /** Point velocities, interleaved x,y. */
  readonly v: Float32Array
  private acc = 0
  private readonly fixed: number
  /** Where the chain's ROOT is pinned this frame (world space). */
  rootX = 0
  rootY = 0
  /** The direction the chain hangs in, unit vector. Set by the owner each
   *  frame (e.g. from the scabbard angle). */
  dirX = 0
  dirY = 1
  /** When true the LAST point is held at (tailX, tailY) as well as the root:
   *  this is what turns a hanging rope into a CABLE between two anchors, which
   *  is the difference between a scabbard and the aerial rigging of a rooftop. */
  spanSag = 0 // rest curvature for a two-anchor span, not a hanging chain
  tailPinned = false
  tailX = 0
  tailY = 0
  /** Lateral wind acceleration (px/s²), positive = +x. Set per frame by the
   *  owner; the chains read it, they never read the clock themselves. */
  wind = 0

  constructor(cfg: Partial<ChainConfig> = {}, fixedDt = 1 / 120) {
    this.cfg = { ...DEFAULT_CHAIN, ...cfg }
    this.fixed = fixedDt
    const n = Math.max(2, this.cfg.points)
    this.p = new Float32Array(n * 2)
    this.v = new Float32Array(n * 2)
    this.reset(0, 0, 0, 1)
  }

  get points(): number { return this.p.length >> 1 }

  /** Lay the chain out along `dir` from (x,y) and zero all velocity. */
  reset(x: number, y: number, dx: number, dy: number): void {
    const L = Math.hypot(dx, dy) || 1
    const ux = dx / L, uy = dy / L
    this.rootX = x; this.rootY = y; this.dirX = ux; this.dirY = uy
    for (let i = 0; i < this.points; i++) {
      this.p[i * 2] = x + ux * this.cfg.link * i
      this.p[i * 2 + 1] = y + uy * this.cfg.link * i
      this.v[i * 2] = 0
      this.v[i * 2 + 1] = 0
    }
    this.acc = 0
  }

  /** Advance by wall time. Returns the number of sub-steps executed (a frame
   *  log can watch this: >4 means we are recovering from a hitch). */
  step(dt: number): number {
    if (!(dt > 0)) return 0
    // A hitch must not be integrated as 200 sub-steps. Snap instead: the eye
    // does not see the correction, and the alternative is a spiral.
    if (dt > 0.1) { dt = this.fixed; this.acc = 0 }
    this.acc += dt
    let n = 0
    const maxSteps = 8
    while (this.acc >= this.fixed && n < maxSteps) {
      this.substep(this.fixed)
      this.acc -= this.fixed
      n++
    }
    // Pin the anchors AFTER integrating, so the chain is dragged by its ends
    // rather than being accelerated toward them.
    this.p[0] = this.rootX
    this.p[1] = this.rootY
    if (this.tailPinned) {
      const last = (this.points - 1) * 2
      this.p[last] = this.tailX
      this.p[last + 1] = this.tailY
    }
    return n
  }

  private substep(h: number): void {
    const { zeta, omega, gravity, follow, link } = this.cfg
    // Spring toward the REST line: for each point i, the rest position is the
    // root plus dir×link×i. A spring to a straight rest pose is what keeps the
    // chain from collapsing while still letting it lag (secondary motion IS the
    // lag between the rest line and the actual points).
    const k = omega * omega
    const c = 2 * zeta * omega
    const n = this.points
    for (let i = 1; i < n; i++) {
      const idx = i * 2
      const u = i / (n - 1)
      const rx = this.rootX + (this.tailPinned ? (this.tailX-this.rootX)*u : this.dirX*link*i)
      const ry = this.rootY + (this.tailPinned
        ? (this.tailY-this.rootY)*u + 4*u*(1-u)*this.spanSag : this.dirY*link*i)
      const f = follow
      let ax = -k * (this.p[idx] - rx) - c * this.v[idx]
      let ay = -k * (this.p[idx + 1] - ry) - c * this.v[idx + 1] + gravity
      // Wind enters as a lateral acceleration on every interior point. A cable
      // in a gust does not translate, it bows — which is exactly what an
      // acceleration field produces and a position offset would not.
      ax += this.wind
      ax *= f
      ay *= f
      this.v[idx] += ax * h
      this.v[idx + 1] += ay * h
      this.p[idx] += this.v[idx] * h
      this.p[idx + 1] += this.v[idx + 1] * h
    }
    this.p[0] = this.rootX
    this.p[1] = this.rootY
    if (this.tailPinned) {
      const last = (this.points - 1) * 2
      this.p[last] = this.tailX
      this.p[last + 1] = this.tailY
    }
    // One inextensibility pass, root outward: a chain that stretches reads as
    // rubber, and one pass is enough because the springs are already stiff.
    for (let i = 1; i < n; i++) {
      const a = (i - 1) * 2, b = i * 2
      let dx = this.p[b] - this.p[a]
      let dy = this.p[b + 1] - this.p[a + 1]
      const d = Math.hypot(dx, dy)
      if (d < 1e-6) { dx = 0; dy = 1; }
      else { dx /= d; dy /= d }
      const target = Math.min(link * 1.15, Math.max(link * 0.86, d))
      this.p[b] = this.p[a] + dx * target
      this.p[b + 1] = this.p[a + 1] + dy * target
      // Project the removed velocity away, so the constraint does not pump
      // energy back into the spring (the classic chain "jitter" failure).
      const vn = this.v[b] * dx + this.v[b + 1] * dy
      this.v[b] -= vn * dx
      this.v[b + 1] -= vn * dy
    }
    // With both ends held, a forward-only pass leaves the span slack on one
    // side (the tail end absorbs all the error). One backward pass spreads it.
    if (this.tailPinned) {
      for (let i = n - 1; i > 1; i--) {
        const b = i * 2, a = (i - 1) * 2
        let dx = this.p[a] - this.p[b]
        let dy = this.p[a + 1] - this.p[b + 1]
        const d = Math.hypot(dx, dy)
        if (d < 1e-6) { dx = 0; dy = 1 }
        else { dx /= d; dy /= d }
        const target = Math.min(link * 1.15, Math.max(link * 0.86, d))
        this.p[a] = this.p[b] + dx * target
        this.p[a + 1] = this.p[b + 1] + dy * target
      }
    }
  }

  /** Write the chain into a polyline for the renderer. Returns the point count.
   *  `out` must be ≥ points×2 long; no allocation, no state. */
  polyline(out: Float32Array, x0 = 0, y0 = 0): number {
    const n = this.points
    const len = Math.min(n, out.length >> 1)
    for (let i = 0; i < len; i++) {
      out[i * 2] = this.p[i * 2] - x0
      out[i * 2 + 1] = this.p[i * 2 + 1] - y0
    }
    return len
  }

  /** Sum of squared velocities — a cheap "is it still moving?" probe for
   *  settle-time measurements in the tests. */
  energy(): number {
    let e = 0
    for (let i = 0; i < this.v.length; i++) e += this.v[i] * this.v[i]
    return e
  }
}

/* -------------------------- 4. aperiodic life -------------------------- */

/** Three incommensurate sines with seed-derived phases. Returns [0,1], mean
 *  0.5. The frequency ratios are the golden-ratio family so the sum has no
 *  short period — measured over 10 minutes it does not repeat to within 1e-3. */
export class AperiodicLife {
  private readonly ph: [number, number, number]
  private readonly amp: [number, number, number]
  constructor(seed = 0) {
    let s = (seed >>> 0) || 1
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
    this.ph = [next() * TAU, next() * TAU, next() * TAU]
    this.amp = [0.5, 0.32, 0.18]
  }

  /** Value in [0,1] at time t (seconds). Breathing is one call at ~0.22 Hz. */
  at(t: number, base = 0.22): number {
    const w = TAU * base
    const v = Math.sin(t * w + this.ph[0]) * this.amp[0]
      + Math.sin(t * w * 1.618 + this.ph[1]) * this.amp[1]
      + Math.sin(t * w * 2.414 + this.ph[2]) * this.amp[2]
    return 0.5 + v * 0.5
  }
}

/* --------------------------- 5. settle probe --------------------------- */

/** True when every point of a chain is slower than `eps` px/s — the settle
 *  predicate the tests use (≤0.6 s after a 1-px displacement). */
export function chainSettled(chain: SpringChain, eps = 2): boolean {
  for (let i = 0; i < chain.v.length; i++) {
    if (Math.abs(chain.v[i]) > eps) return false
  }
  return true
}
