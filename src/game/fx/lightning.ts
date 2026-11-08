/** STICKMAN RISING — THE RAY-TRACED LIGHTNING ENGINE.
 *
 * A bolt is a RAY traced through the gameplay plane with real reflection
 * laws — not a painted polyline:
 *
 *   · ENEMIES are cylindrical reflectors: the channel mirrors about the
 *     hit-point normal (r' = d − 2(d·n)n), then jitters ±~26°. Three
 *     reflection candidates are ray-traced one bounce ahead and the one
 *     passing closest to ANOTHER live reflector wins — chains read as
 *     intent, not luck (the "target attraction" of great chain-lightning
 *     VFX: Infamous, Warcraft III Medivh).
 *   · THE GROUND (y = 0) is a plane mirror: vy flips, energy survives
 *     better than on flesh (conductor) — bolts skate off the wet floor.
 *   · ENERGY decays per bounce (×0.6 flesh, ×0.8 ground); core width,
 *     damage and node glow all scale with the remaining energy. The ray
 *     dies below 0.16 or at its bounce budget; the final leg fades out
 *     instead of stopping dead (leaders lose coherence, they don't hit
 *     walls).
 *   · Every bounce stamps a NODE: a white-core radial flash + spark burst
 *     at the contact — the electric "touch" point the eye tracks.
 *
 * RENDER MODEL (VLM-verified against arc-photography references):
 *   · 3-pass channel: halo (6.5× core width, α≈.15) → color mid (2.6×,
 *     α≈.5) → blue-white core (1.6px, α≈.95) — additive.
 *   · Midpoint-displacement jag, depth 4, offset ≈9% of leg length,
 *     halving per level; bounce legs are STRAIGHTER (±55% jitter —
 *     reflected channels re-form tighter, per the reference rules).
 *   · RESTRIKE: the whole channel re-rolls its jag every ~55–85ms while
 *     alive (30% skeleton reuse read), with per-frame flicker ±15%.
 *   · BRANCHES fork off the primary leg only (≤3, 20–50° off, ×0.5
 *     width/α) — the plasma tree that sells "electricity" vs "laser".
 */

import { clamp, rand, rgba, TAU } from '../core/utils'

/** light up a struck reflector (structural: Enemy implements
 *  lightningLit — bodies glow where the channel touched them) */
export function markLit(e: object, color: string, t: number): void {
  const fn = (e as { lightningLit?: (c: string, t: number) => void }).lightningLit
  if (fn) fn.call(e, color, t)
}

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

/** a reflector the ray can bounce off */
export interface RayReflector {
  x: number
  /** feet position (world y ≈ 0) — the torso circle derives from it */
  y: number
  scale: number
  dead: boolean
  spawning: boolean
  id?: number
}

/** damage callback: (reflector, scaled damage, remaining energy, hit point) */
export type RayHitFn = (e: RayReflector, dmg: number, energy: number, hx: number, hy: number) => void

export interface RayWorld {
  enemies: readonly RayReflector[]
  minX: number
  maxX: number
}

export interface RayOpts {
  color: string
  /** core stroke width at energy 1 (px) */
  width?: number
  /** starting energy 0..1 */
  energy?: number
  /** max reflections off reflectors (ground bounces don't count) */
  bounces?: number
  /** per-hit base damage (scaled by energy at impact) */
  dmg?: number
  /** total path length budget (world units) */
  maxLen?: number
  hit?: RayHitFn
}

/* the torso reflector circle: center 48·scale above the feet, r 22·scale
 * (mirror of the armarc BODY band table) */
const BAND_OY = 48
const BAND_R = 22

/* ------------------------------------------------------------------ */
/* bolt pool                                                           */
/* ------------------------------------------------------------------ */

interface Bolt {
  active: boolean
  /** per-leg straight skeletons: [x0,y0,x1,y1, x0,y0,x1,y1, ...] */
  base: number[]
  /** per-leg jitted polylines (rebuilt on restrike) */
  legs: number[][]
  /** bounce nodes: [x,y,energy, x,y,energy, ...] */
  nodes: number[]
  /** fork polylines */
  branches: number[][]
  /** per-leg entry energies (width scaling) */
  energies: number[]
  /** index of the terminal (free-flight) leg — it fades out instead of
   *  stopping dead (a dying leader loses coherence) */
  tailIdx: number
  age: number
  life: number
  width: number
  color: string
  seed: number
  restrikeAt: number
}

const MAX_BOLTS = 24

export class LightningSystem {
  private bolts: Bolt[] = []
  private live = 0

  constructor() {
    for (let i = 0; i < MAX_BOLTS; i++) {
      this.bolts.push({
        active: false, base: [], legs: [], nodes: [], branches: [], energies: [],
        tailIdx: -1, age: 0, life: 0.3, width: 2.4, color: '#41f6ff', seed: 0, restrikeAt: 0,
      })
    }
  }

  /* ---------------------------------------------------------------- */
  /* the ray trace                                                     */
  /* ---------------------------------------------------------------- */

  /** Cast a lightning ray into the world. The ray reflects off enemies
   *  (cylindrical mirrors, damage on contact) and the ground (plane
   *  mirror), losing energy per bounce until it dies. */
  cast(w: RayWorld, x: number, y: number, dirX: number, dirY: number, opts: RayOpts): void {
    const b = this.next()
    if (!b) return
    b.active = true
    b.age = 0
    b.life = 0.26 + (opts.energy ?? 1) * 0.1
    b.width = opts.width ?? 2.4
    b.color = opts.color
    b.seed = rand(0, 1000)
    b.restrikeAt = 0.055
    b.base.length = 0
    b.nodes.length = 0
    b.branches.length = 0
    b.energies.length = 0
    b.tailIdx = -1
    // origin node: the channel's emergence point glows too (sky bolts
    // read WHERE they enter; blade discharges read WHERE they leave)
    b.nodes.push(x, y, (opts.energy ?? 1) * 0.7)

    // normalize direction
    const dl = Math.hypot(dirX, dirY) || 1
    let dx = dirX / dl
    let dy = dirY / dl
    let energy = opts.energy ?? 1
    const bounceBudget = opts.bounces ?? 3
    let dmg = opts.dmg ?? 0
    const maxLen = opts.maxLen ?? 460
    let travelled = 0
    let bounces = 0
    const hitIds = new Set<number>()
    let cx = x
    let cy = y
    let firstLeg = true

    while (travelled < maxLen && energy > 0.16 && bounces <= bounceBudget) {
      // ---- find the nearest reflector intersection along the ray ----
      let tBest = Infinity
      let hitE: RayReflector | null = null
      for (const e of w.enemies) {
        if (e.dead || e.spawning) continue
        if (e.id !== undefined && hitIds.has(e.id)) continue
        const ccx = e.x
        const ccy = e.y - BAND_OY * e.scale
        const r = BAND_R * e.scale + 2
        const ox = cx - ccx
        const oy = cy - ccy
        const bq = ox * dx + oy * dy
        const cq = ox * ox + oy * oy - r * r
        const disc = bq * bq - cq
        if (disc <= 0) continue
        const t = -bq - Math.sqrt(disc)
        if (t > 2 && t < tBest) {
          tBest = t
          hitE = e
        }
      }
      // ground plane y = 0 (only when heading down)
      let tGround = Infinity
      if (dy > 1e-4) tGround = (0 - cy) / dy
      // arena bounds
      let tBound = Infinity
      if (dx > 1e-4) tBound = (w.maxX - cx) / dx
      else if (dx < -1e-4) tBound = (w.minX - cx) / dx
      const lenBudget = maxLen - travelled

      if (hitE && tBest <= tGround && tBest <= tBound && tBest < lenBudget) {
        // ---- ENEMY REFLECTION: mirror about the hit-point normal ----
        const hx = cx + dx * tBest
        const hy = cy + dy * tBest
        b.base.push(cx, cy, hx, hy)
        b.energies.push(energy)
        b.nodes.push(hx, hy, energy)
        if (hitE.id !== undefined) hitIds.add(hitE.id)
        if (dmg > 0 && opts.hit) opts.hit(hitE, dmg * energy, energy, hx, hy)
        // RAY-TRACED ILLUMINATION: the struck body glows in the channel's
        // color — light ON geometry, not just through it (fresh hits burn
        // hard, ~0.5s afterglow tail)
        markLit(hitE, opts.color, 0.55 + energy * 0.35)
        // normal at hit
        const ccx = hitE.x
        const ccy = hitE.y - BAND_OY * hitE.scale
        let nx = (hx - ccx) / (BAND_R * hitE.scale)
        let ny = (hy - ccy) / (BAND_R * hitE.scale)
        const nl = Math.hypot(nx, ny) || 1
        nx /= nl
        ny /= nl
        const dot = dx * nx + dy * ny
        const rx = dx - 2 * dot * nx
        const ry = dy - 2 * dot * ny
        // jitter with INTENT: 3 candidate reflections, ray-trace one step
        // ahead, prefer the one passing closest to another live enemy
        const picked = this.pickReflection(w, hitIds, hx, hy, rx, ry)
        dx = picked.dx
        dy = picked.dy
        travelled += tBest
        energy *= 0.6
        bounces++
        dmg *= 0.75
        cx = hx + dx * 4
        cy = hy + dy * 4
        firstLeg = false
      } else if (tGround <= tBound && tGround < lenBudget && tGround < Infinity && cy < -6) {
        // ---- GROUND REFLECTION: plane mirror, conductor-skate ----
        const gx = cx + dx * tGround
        const gy = 0
        b.base.push(cx, cy, gx, gy)
        b.energies.push(energy)
        b.nodes.push(gx, gy, energy * 0.8)
        travelled += tGround
        dy = -Math.abs(dy)
        // jitter ±~11°
        const ja = rand(-0.2, 0.2)
        const cj = Math.cos(ja)
        const sj = Math.sin(ja)
        const ndx = dx * cj - dy * sj
        const ndy = dx * sj + dy * cj
        dx = ndx
        dy = ndy
        energy *= 0.8
        cx = gx + dx * 3
        cy = gy + dy * 3
        firstLeg = false
      } else {
        // ---- free flight: run out the remaining budget and fade ----
        const t = Math.min(lenBudget, Math.min(tBound, 600))
        b.base.push(cx, cy, cx + dx * t, cy + dy * t)
        b.energies.push(energy)
        b.tailIdx = b.base.length / 4 - 1
        travelled += t
        cx += dx * t
        cy += dy * t
        break
      }
    }
    // degenerate: zero-length bolt (fired inside a reflector) — kill it
    if (b.base.length < 4) {
      b.active = false
      return
    }
    this.buildGeometry(b, firstLeg)
  }

  /** pick the reflection that ray-traces toward another live reflector:
   *  sample the mirror direction ±25–50°, score each candidate by its
   *  closest approach to any not-yet-hit enemy, take the winner — then
   *  AIM-ASSIST: if the winner grazes a target (perp < 90), bend the
   *  direction toward it. Chains CONNECT visibly while staying physical
   *  (grazing reflections in real optics bend toward the nearer path —
   *  this is that correction, exaggerated for readability). */
  private pickReflection(
    w: RayWorld, hitIds: Set<number>,
    hx: number, hy: number,
    mx: number, my: number,
  ): { dx: number; dy: number } {
    let bestScore = -Infinity
    let bx = mx
    let by = my
    for (let s = -1; s <= 1; s++) {
      const a = s * rand(0.28, 0.5)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const cdx = mx * ca - my * sa
      const cdy = mx * sa + my * ca
      // score: closest approach of the candidate ray to other enemies
      let score = s === 0 ? 0.15 : 0 // slight bias to the pure mirror
      for (const e of w.enemies) {
        if (e.dead || e.spawning) continue
        if (e.id !== undefined && hitIds.has(e.id)) continue
        const ex = e.x - hx
        const ey = (e.y - BAND_OY * e.scale) - hy
        const proj = ex * cdx + ey * cdy
        if (proj <= 8) continue
        const perp = Math.abs(ex * cdy - ey * cdx)
        score += Math.max(0, 260 - perp) / 260
      }
      if (score > bestScore) {
        bestScore = score
        bx = cdx
        by = cdy
      }
    }
    // ---- AIM ASSIST: find the reflector the chosen ray grazes, and bend
    // toward it — the chain lands ON bodies instead of shaving past them
    let tEx = 0
    let tEy = 0
    let bestPerp = 95
    let found = false
    for (const e of w.enemies) {
      if (e.dead || e.spawning) continue
      if (e.id !== undefined && hitIds.has(e.id)) continue
      const ex = e.x - hx
      const ey = (e.y - BAND_OY * e.scale) - hy
      const proj = ex * bx + ey * by
      if (proj < 24 || proj > 460) continue
      const perp = Math.abs(ex * by - ey * bx)
      if (perp < bestPerp) {
        bestPerp = perp
        tEx = ex
        tEy = ey
        found = true
      }
    }
    if (found) {
      const tl = Math.hypot(tEx, tEy) || 1
      const blend = 0.72 * (1 - bestPerp / 95)
      const nx = bx * (1 - blend) + (tEx / tl) * blend
      const ny = by * (1 - blend) + (tEy / tl) * blend
      const nl = Math.hypot(nx, ny) || 1
      bx = nx / nl
      by = ny / nl
    }
    return { dx: bx, dy: by }
  }

  /* ---------------------------------------------------------------- */
  /* geometry                                                          */
  /* ---------------------------------------------------------------- */

  /** build the jagged polylines + branches from the straight skeleton */
  private buildGeometry(b: Bolt, branchy: boolean): void {
    b.legs.length = 0
    for (let i = 0; i < b.base.length; i += 4) {
      const straight = i > 0 // bounce legs re-form tighter (VLM rule)
      b.legs.push(this.jag(b.base[i], b.base[i + 1], b.base[i + 2], b.base[i + 3], straight, b.seed + i))
    }
    if (branchy) this.buildBranches(b)
  }

  /** midpoint-displacement channel: 16 micro-segments with a sine
   *  envelope (full jitter mid-channel, pinning to zero at both ends) */
  private jag(x0: number, y0: number, x1: number, y1: number, straight: boolean, seed: number): number[] {
    const len = Math.hypot(x1 - x0, y1 - y0)
    const amp = len * (straight ? 0.05 : 0.09)
    const N = 16
    const pts: number[] = [x0, y0]
    let s = seed
    const nextRand = () => {
      s = (s * 9301 + 49297) % 233280
      return s / 233280 - 0.5
    }
    for (let i = 1; i <= N; i++) {
      const t = i / N
      let nx = x0 + (x1 - x0) * t
      let ny = y0 + (y1 - y0) * t
      if (i < N) {
        const env = Math.sin(t * Math.PI)
        nx += nextRand() * 2 * amp * env
        ny += nextRand() * 2 * amp * env
      }
      pts.push(nx, ny)
    }
    return pts
  }

  /** forks off the PRIMARY leg: ≤3 branches, 20–50° off the local
   *  direction, ~30% of the leg length, thinner + dimmer */
  private buildBranches(b: Bolt): void {
    if (b.legs.length === 0) return
    const leg = b.legs[0]
    const n = 2 + ((b.seed | 0) % 2)
    for (let k = 0; k < n; k++) {
      // branch origin in the upper/mid 60% of the primary channel
      const idx = 2 + 2 * (2 + ((Math.floor(rand(0, 6)) + k * 3) % 7))
      if (idx + 3 >= leg.length) continue
      const ox = leg[idx]
      const oy = leg[idx + 1]
      const ang = Math.atan2(leg[idx + 3] - oy, leg[idx + 2] - ox)
        + (k % 2 === 0 ? 1 : -1) * rand(0.35, 0.85)
      const blen = rand(26, 64)
      const pts: number[] = [ox, oy]
      let px = ox
      let py = oy
      for (let s = 1; s <= 3; s++) {
        const t = s / 3
        px = ox + Math.cos(ang) * blen * t + rand(-6, 6) * t
        py = oy + Math.sin(ang) * blen * t + rand(-6, 6) * t
        pts.push(px, py)
      }
      b.branches.push(pts)
    }
  }

  /* ---------------------------------------------------------------- */
  /* compat: the old two-point arc (background / ult flourish calls)   */
  /* ---------------------------------------------------------------- */

  /** simple decorative bolt between two points — no reflection, but the
   *  same renderer + restrike life (replaces the old particle 'arc') */
  arc(x0: number, y0: number, x1: number, y1: number, color: string, width = 2.2): void {
    const b = this.next()
    if (!b) return
    b.active = true
    b.age = 0
    b.life = 0.22
    b.width = width
    b.color = color
    b.seed = rand(0, 1000)
    b.restrikeAt = 0.06
    b.base.length = 0
    b.nodes.length = 0
    b.energies.length = 0
    b.base.push(x0, y0, x1, y1)
    b.energies.push(0.85)
    b.branches.length = 0
    this.buildGeometry(b, Math.hypot(x1 - x0, y1 - y0) > 120)
    b.nodes.push(x0, y0, 0.5, x1, y1, 0.85)
  }

  /** TESLA CRAWL along the blade: 2 short arcs snapping between random
   *  points on the steel — the charging-sword read (grip → monouchi) */
  crawl(bx: number, by: number, tx: number, ty: number, color: string): void {
    const len = Math.hypot(tx - bx, ty - by)
    if (len < 30) return
    const n = 2
    for (let i = 0; i < n; i++) {
      const t0 = rand(0.02, 0.42)
      const t1 = clamp(t0 + rand(0.4, 0.72), 0, 0.99)
      this.arc(
        bx + (tx - bx) * t0, by + (ty - by) * t0,
        bx + (tx - bx) * t1, by + (ty - by) * t1,
        color, 3.2,
      )
    }
  }

  /* ---------------------------------------------------------------- */
  /* sim + render                                                      */
  /* ---------------------------------------------------------------- */

  private next(): Bolt | null {
    for (const b of this.bolts) {
      if (!b.active) {
        this.live = Math.min(MAX_BOLTS, this.live + 1)
        return b
      }
    }
    return null
  }

  /** kill every live bolt (world clear/reset) */
  clear(): void {
    for (const b of this.bolts) b.active = false
    this.live = 0
  }

  update(dt: number): void {
    for (const b of this.bolts) {
      if (!b.active) continue
      b.age += dt
      if (b.age >= b.life) {
        b.active = false
        this.live = Math.max(0, this.live - 1)
        continue
      }
      // RESTRIKE: re-roll the channel jag while the bolt is young enough
      if (b.age > b.restrikeAt && b.age < b.life * 0.72) {
        b.restrikeAt = b.age + rand(0.055, 0.09)
        const branchy = b.branches.length > 0
        b.branches.length = 0
        this.buildGeometry(b, branchy)
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const b of this.bolts) {
      if (!b.active) continue
      const t = b.age / b.life
      // bright leading edge (first 25%), then decay; afterglow tail
      const fade = t < 0.25 ? 1 : Math.pow(1 - (t - 0.25) / 0.75, 1.6)
      const flick = 0.85 + 0.15 * Math.sin(time * 47 + b.seed)
      const k = fade * flick

      // ---- 3-pass channel per leg (the TERMINAL leg fades out over its
      // last ~30% — a dying leader loses coherence instead of stopping
      // dead at the view edge) ----
      for (let li = 0; li < b.legs.length; li++) {
        const leg = b.legs[li]
        if (leg.length < 4) continue
        const e = b.energies[li] ?? 1
        const w = b.width * (0.45 + e * 0.75)
        const isTail = li === b.tailIdx && leg.length >= 12
        // first ~70% at full strength, final ~30% stepped down to a dim
        // leader-fade (range bounds in VALUES — 2 per point)
        const cut = isTail ? Math.max(8, Math.floor(leg.length * 0.7)) : leg.length
        for (let r = 0; r < (isTail ? 2 : 1); r++) {
          const end = r === 0 ? cut : leg.length
          const fk = r === 0 ? 1 : 0.34
          const start = r === 0 ? 0 : Math.max(0, cut - 4)
          // halo
          ctx.strokeStyle = rgba(b.color, 0.15 * k * fk)
          ctx.lineWidth = w * 6.5
          this.strokePolyRange(ctx, leg, start, end)
          // mid
          ctx.strokeStyle = rgba(b.color, 0.5 * k * fk)
          ctx.lineWidth = w * 2.6
          this.strokePolyRange(ctx, leg, start, end)
          // core
          ctx.strokeStyle = rgba('#eef6ff', 0.95 * k * fk)
          ctx.lineWidth = Math.max(1.1, w * 0.8)
          this.strokePolyRange(ctx, leg, start, end)
        }
      }

      // ---- branches: one mid + thin core pass ----
      if (b.branches.length) {
        for (const br of b.branches) {
          ctx.strokeStyle = rgba(b.color, 0.3 * k)
          ctx.lineWidth = Math.max(0.9, b.width * 0.9)
          this.strokePolyRange(ctx, br, 0, br.length)
          ctx.strokeStyle = rgba('#eef6ff', 0.5 * k)
          ctx.lineWidth = 0.8
          this.strokePolyRange(ctx, br, 0, br.length)
        }
      }

      // ---- bounce nodes: white-core radial contact flashes ----
      for (let i = 0; i < b.nodes.length; i += 3) {
        const nx = b.nodes[i]
        const ny = b.nodes[i + 1]
        const ne = b.nodes[i + 2]
        const r = (5 + 13 * ne) * (0.7 + 0.3 * k)
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r)
        g.addColorStop(0, rgba('#ffffff', 0.9 * k))
        g.addColorStop(0.35, rgba(b.color, 0.55 * k))
        g.addColorStop(1, rgba(b.color, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(nx, ny, r, 0, TAU)
        ctx.fill()
        // hot core dot
        ctx.fillStyle = rgba('#ffffff', 0.95 * k)
        ctx.beginPath()
        ctx.arc(nx, ny, 1.6 + 1.4 * ne, 0, TAU)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private strokePolyRange(ctx: CanvasRenderingContext2D, pts: number[], start: number, end: number): void {
    ctx.beginPath()
    ctx.moveTo(pts[start], pts[start + 1])
    for (let i = start + 2; i < end; i += 2) ctx.lineTo(pts[i], pts[i + 1])
    ctx.stroke()
  }

  /** live bolt count (diagnostics) */
  get count(): number {
    let n = 0
    for (const b of this.bolts) if (b.active) n++
    return n
  }
}

/** util: reflection helpers shared with call sites that want to mirror a
 *  direction off a segment (e.g. parry reflection off the blade line) */
export function reflectOffSegment(
  dx: number, dy: number,
  ax: number, ay: number, bx: number, by: number,
): { dx: number; dy: number } {
  // segment normal (perpendicular)
  const ex = bx - ax
  const ey = by - ay
  const el = Math.hypot(ex, ey) || 1
  let nx = -ey / el
  let ny = ex / el
  const dot = dx * nx + dy * ny
  if (dot > 0) { nx = -nx; ny = -ny } // face the incoming ray
  return { dx: dx - 2 * dot * nx, dy: dy - 2 * dot * ny }
}

export const LIGHTNING_ENERGY_MIN = 0.16
