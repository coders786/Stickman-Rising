/** STICKMAN RISING — src/game/world/rigging.ts
 * THE ROOFTOP RIGGING: cables, pennants and the wind that moves them.
 * ----------------------------------------------------------------------------
 * This is where docs/master/20 (natural motion) stops being a library and
 * becomes part of the picture. Three things matter here and nothing else does:
 *
 *  1. **Secondary motion is the cheapest life in the frame.** A rooftop with two
 *     cables in a gust reads as *outdoors* — altitude, weather, air — for two
 *     strokes and ~80 simulated points. No sprite, no asset, no texture. Every
 *     run gets a different span, sag and pennant count from the profile, so the
 *     rigging is part of the run identity rather than set dressing that repeats.
 *
 *  2. **The wind is a profile axis, not a constant.** `clouds.speed` already
 *     drives the cloud decks; the same number drives the cables, so a becalmed
 *     night has still cables and a windy one has them bowing. That coherence is
 *     what makes a sky feel like one place instead of five effects.
 *
 *  3. **Batching.** All cables are ONE path and ONE stroke; all pennants are one
 *     path and one fill. 21 §3 measured that consolidating paths into a single
 *     stroke can halve the draw cost, and this is the place in this renderer
 *     where that is literally true.
 *
 * Physics runs on the FIXED step (SpringChain integrates in 1/120 s slices), so
 * a 144 Hz phone and a 60 Hz phone see the same rigging. Drawing is interpolation
 * free: the chains are the authoritative state.
 * ==========================================================================*/

import type { Quality } from './background'
import type { EnvironmentProfile } from './profile'
import { Wind } from './wind'
import { SpringChain } from '../anim/natural'
import { rgbaConst } from '../render/color'

export interface CableSpec {
  /** Anchor A (world). */
  ax: number
  ay: number
  /** Anchor B (world). */
  bx: number
  by: number
  /** Rest sag hint (px) — used only to lay the chain out on the first frame. */
  sag: number
  /** Pennants hanging from this cable (0 = bare). */
  flags: number
}

export interface RiggingLoadout {
  cables: number
  flagsPerCable: number
  /** Second, brighter rim stroke. */
  rim: boolean
}

/** Per-tier budgets. These are DRAW budgets, never physics existence: a low-tier
 *  device still has wind and still has a cable, it just has fewer of them. */
export function riggingFor(tier: Quality): RiggingLoadout {
  switch (tier) {
    case 'low': return { cables: 1, flagsPerCable: 0, rim: false }
    case 'medium': return { cables: 2, flagsPerCable: 1, rim: false }
    case 'high': return { cables: 2, flagsPerCable: 3, rim: true }
    default: return { cables: 3, flagsPerCable: 4, rim: true }
  }
}

const POLE_TOP = -352
const SEGMENTS = 19
const FLAG_POINTS = 5

export class Rigging {
  readonly profile: EnvironmentProfile
  private loadout: RiggingLoadout
  private specs: CableSpec[] = []
  private cables: SpringChain[] = []
  private flags: SpringChain[] = []
  private wind: Wind
  private t = 0
  private stroke: Float32Array
  private litStroke: Float32Array
  /* Style strings are built ONCE, from the palette, in the constructor. A draw
   * path that formats `rgba()` per frame allocates per frame (19 §6). */
  /** One mast per anchor x: a cable that ends in mid-air reads as a bug, and the
   *  cheapest fix is the post it should have been tied to all along. */
  private masts: { x: number; top: number }[] = []
  private readonly cableInk: string
  private readonly rimInk: string
  /** Which way the moon is: +1 = screen right, -1 = left. The rim is drawn on
   *  the side the light comes from, so a run whose moon sits left must rim left
   *  — otherwise every cable is lit from the wrong edge all night. */
  private rimSide = 1
  private readonly flagInk: string

  constructor(profile: EnvironmentProfile, tier: Quality = 'high') {
    this.profile = profile
    this.loadout = riggingFor(tier)
    // The wind is SHARED with the cloud decks (world/wind.ts): the cables and
    // the drifting sheets must be the same weather, not two sines that happen
    // to be nearby.
    this.wind = new Wind(profile)
    this.specs = buildSpecs(profile, this.loadout)
    this.cables = this.specs.map((s) => this.makeCable(s))
    this.flags = []
    for (let i = 0; i < this.specs.length; i++) {
      const n = Math.min(this.loadout.flagsPerCable, this.specs[i].flags)
      for (let f = 0; f < n; f++) this.flags.push(this.makeFlag())
    }
    this.masts = buildMasts(this.specs)
    this.stroke = new Float32Array(SEGMENTS * 2)
    this.litStroke = new Float32Array(SEGMENTS * 2)
    this.cableInk = rgbaConst('4,8,12', 0.72)
    this.rimInk = rgbaConst('150,180,200', 0.22)
    this.flagInk = rgbaConst(profile.mood.shadow, 0.55)
    this.layOut()
  }

  private makeCable(s: CableSpec): SpringChain {
    const span = Math.hypot(s.bx - s.ax, s.by - s.ay)
    const c = new SpringChain({
      points: SEGMENTS,
      link: span / (SEGMENTS - 1),
      zeta: 0.22,        // a cable rings; cloth does not (ζ low on purpose)
      omega: 7.5,        // heavy, slow, nothing like the 21 rad/s of a scabbard
      gravity: 520,
      follow: 0.9,
    })
    c.spanSag = s.sag
    c.tailPinned = true
    c.rootX = s.ax; c.rootY = s.ay
    c.tailX = s.bx; c.tailY = s.by
    return c
  }

  private makeFlag(): SpringChain {
    const c = new SpringChain({ points: FLAG_POINTS, link: 5.2, zeta: 0.3, omega: 9, gravity: 700, follow: 0.95 })
    return c
  }

  /** Place every chain on its rest shape. Called once and on tier change. */
  private layOut(): void {
    this.specs.forEach((s, i) => {
      const c = this.cables[i]
      if (!c) return
      const n = c.points
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1)
        c.p[k * 2] = s.ax + (s.bx - s.ax) * u
        // a parabola is the static shape of a hanging cable; starting from it
        // means the first frame is already plausible instead of dropping in
        c.p[k * 2 + 1] = s.ay + (s.by - s.ay) * u + s.sag * 4 * u * (1 - u)
        c.v[k * 2] = 0
        c.v[k * 2 + 1] = 0
      }
      c.rootX = s.ax; c.rootY = s.ay; c.tailX = s.bx; c.tailY = s.by
    })
    // flags hang from the midpoint of their cable
    let f = 0
    this.specs.forEach((s, i) => {
      const n = Math.min(this.loadout.flagsPerCable, s.flags)
      for (let k = 0; k < n && f < this.flags.length; k++, f++) {
        const u = (k + 1) / (n + 1)
        const x = s.ax + (s.bx - s.ax) * u
        const y = s.ay + (s.by - s.ay) * u + s.sag * 4 * u * (1 - u)
        this.flags[f].reset(x, y, 0, 1)
        void i
      }
    })
  }

  /** +1 when the moon is right of the frame centre, −1 when it is left. */
  setRimSide(side: number): void {
    this.rimSide = side < 0 ? -1 : 1
  }

  setTier(tier: Quality): void {
    const next = riggingFor(tier)
    if (next.cables === this.loadout.cables && next.flagsPerCable === this.loadout.flagsPerCable) {
      this.loadout = next
      return
    }
    this.loadout = next
    this.specs = buildSpecs(this.profile, next)
    this.masts = buildMasts(this.specs)
    this.cables = this.specs.map((s) => this.makeCable(s))
    this.flags = []
    for (let i = 0; i < this.specs.length; i++) {
      const n = Math.min(next.flagsPerCable, this.specs[i].flags)
      for (let f = 0; f < n; f++) this.flags.push(this.makeFlag())
    }
    this.layOut()
  }

  /** Advance. `dt` is real frame time; the chains integrate on their own fixed
   *  sub-step, so this is rate-independent by construction. */
  update(dt: number): void {
    if (!(dt > 0)) return
    this.t += dt
    this.wind.update(dt)
    const wind = this.wind.accel
    for (const c of this.cables) {
      c.wind = wind
      c.step(dt)
    }
    // flags follow their cable's midpoint; they get the wind plus a flutter
    const flutter = Math.sin(this.t * 5.3) * Math.abs(wind) * 0.5
    let f = 0
    this.specs.forEach((s, i) => {
      const c = this.cables[i]
      const n = Math.min(this.loadout.flagsPerCable, s.flags)
      if (!c) return
      for (let k = 0; k < n && f < this.flags.length; k++, f++) {
        const idx = Math.round((c.points - 1) * ((k + 1) / (n + 1)))
        const fl = this.flags[f]
        fl.rootX = c.p[idx * 2]
        fl.rootY = c.p[idx * 2 + 1]
        fl.wind = wind * 0.6 + flutter
        fl.step(dt)
      }
    })
  }

  /** Draw in WORLD space (the caller has already applied the camera). All
   *  cables are one path and one stroke; all pennants one path and one fill. */
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.cables.length === 0) return
    ctx.save()
    ctx.lineCap = 'round'
    /* THE POSTS. Drawn as filled tapered quads (a stroke would read as a wire):
     * a lattice mast is two legs, so each post is one quad per leg plus the
     * cross-arm that the pennants hang from. All of them are ONE fill. */
    if (this.masts.length) {
      const LEAN = 0.012 // px of lean per px of height: a roof mast is never plumb
      ctx.beginPath()
      for (const m of this.masts) {
        const h = -m.top
        if (h < 40) continue
        const lean = h * LEAN * ((m.x % 2 === 0) ? 1 : -1)
        const topX = m.x + lean
        const bw = 5.2, tw = 1.5
        // left leg
        ctx.moveTo(m.x - bw, 0)
        ctx.lineTo(topX - tw, m.top)
        ctx.lineTo(topX + tw, m.top)
        ctx.lineTo(m.x + bw, 0)
        ctx.closePath()
        // cross-arm at 76 % height, 18 px wide: the cable's tie-off
        const ay = m.top + h * 0.24
        ctx.moveTo(topX - 9, ay)
        ctx.lineTo(topX + 9, ay)
        ctx.lineTo(topX + 9, ay + 1.6)
        ctx.lineTo(topX - 9, ay + 1.6)
        ctx.closePath()
      }
      ctx.fillStyle = this.cableInk
      ctx.fill()
    }
    ctx.beginPath()
    for (const c of this.cables) {
      const n = c.polyline(this.stroke)
      ctx.moveTo(this.stroke[0], this.stroke[1])
      for (let i = 1; i < n; i++) ctx.lineTo(this.stroke[i * 2], this.stroke[i * 2 + 1])
    }
    ctx.strokeStyle = this.cableInk
    ctx.lineWidth = 1.6
    ctx.stroke()
    if (this.loadout.rim) {
      // The moon-side rim: the same geometry, offset one pixel toward whichever
      // side of the frame the moon is on, at a fraction of the weight. It is the
      // difference between "a line" and "a cable catching the moon".
      const rs = this.rimSide
      ctx.beginPath()
      for (const c of this.cables) {
        const n = c.polyline(this.litStroke)
        ctx.moveTo(this.litStroke[0] + rs, this.litStroke[1] - 1)
        for (let i = 1; i < n; i++) ctx.lineTo(this.litStroke[i * 2] + rs, this.litStroke[i * 2 + 1] - 1)
      }
      ctx.strokeStyle = this.rimInk
      ctx.lineWidth = 0.8
      ctx.stroke()
    }
    if (this.flags.length) {
      ctx.beginPath()
      for (const f of this.flags) {
        const n = f.polyline(this.stroke)
        // a pennant is a triangle: root, then the last two points fanned
        const x0 = this.stroke[0], y0 = this.stroke[1]
        const x1 = this.stroke[(n - 1) * 2], y1 = this.stroke[(n - 1) * 2 + 1]
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.lineTo(x1 + 6, y1 - 3)
        ctx.lineTo(x0 + 2, y0 + 1)
        ctx.closePath()
      }
      ctx.fillStyle = this.flagInk
      ctx.fill()
    }
    ctx.restore()
  }

  /** For the debug overlay / bench: how much this layer costs in simulated
   *  points, which is the honest proxy for its CPU. */
  /** The wind field, so the caller can drive the cloud drift and the mist with
   *  the same number the cables feel. */
  get windState(): Wind { return this.wind }

  stats(): { cables: number; flags: number; points: number } {
    let points = 0
    for (const c of this.cables) points += c.points
    for (const f of this.flags) points += f.points
    return { cables: this.cables.length, flags: this.flags.length, points }
  }
}

/** One post per distinct anchor x, tall enough to meet the highest cable that
 *  ties off there. Deterministic: it is derived from the specs, nothing else. */
export function buildMasts(specs: readonly CableSpec[]): { x: number; top: number }[] {
  const byX = new Map<number, number>()
  for (const s of specs) {
    const ax = Math.round(s.ax)
    const bx = Math.round(s.bx)
    byX.set(ax, Math.min(byX.get(ax) ?? s.ay, s.ay))
    byX.set(bx, Math.min(byX.get(bx) ?? s.by, s.by))
  }
  return [...byX.entries()].map(([x, top]) => ({ x, top: top - 4 }))
}

/** The anchor layout. Deterministic from the run seed, but the SPAN comes from
 *  the arena geometry so the cables always attach to something the player can
 *  see: a mast behind the stairwell and a pylon on the far side. */
export function buildSpecs(profile: EnvironmentProfile, loadout: RiggingLoadout): CableSpec[] {
  let s = profile.seed >>> 0
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  const jitter = (): number => (rnd() - 0.5) * 44
  const all: CableSpec[] = [
    { ax: 1010 + jitter(), ay: POLE_TOP + jitter() * 0.3, bx: 2140 + jitter(), by: POLE_TOP - 24, sag: 54 + rnd() * 30, flags: 4 },
    // The far post must stand ON the deck (arena spans x −150..2750): a mast at
    // x 2790 would be bolted to thin air past the roof edge.
    { ax: 2140 + jitter(), ay: POLE_TOP - 50, bx: 2726 + jitter() * 0.4, by: POLE_TOP + 6, sag: 34 + rnd() * 22, flags: 3 },
    { ax: 520 + jitter(), ay: POLE_TOP + 40, bx: 1010 + jitter(), by: POLE_TOP + 18, sag: 40 + rnd() * 26, flags: 2 },
  ]
  return all.slice(0, Math.max(1, loadout.cables))
}
