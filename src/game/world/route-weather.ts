import { SACR_ACTOR_Z, worldToSACRX } from '../../graphics/sacr/SACRMath'
import { clamp01, smoothstep } from '../core/utils'
import { BridgeRoute, bridgeBiomeMix } from '../stage/route'
import { BRIDGE_CLIMATE, SHELTER_KIT } from '../stage/run-layout'
import { ROAD } from '../stage/road-section'
import { drainageOffset, puddleMask } from '../stage/bridge-material'
import { ENV_TICK, EnvironmentFront, environmentRandom, wrap } from './fronts'
import { routeWind } from '../stage/bridge-sockets'
import type { ViewBounds, WeatherWork } from './exposed-weather'
import type { Tier } from '../render/graphics'

import { bridgePrecipitation, bridgeRetention, bridgeVentX, BRIDGE_VENT_BUDGET, BRIDGE_VENT_Y, MOBILE_RAIN_LIMIT, RAIN_CELL as CELL, RAIN_HEIGHT as HEIGHT, RAIN_PLANES as planes } from '../stage/bridge-weather-data'

export const FAR_RAIN_PARALLAX = planes[0].parallax
export const MID_RAIN_PARALLAX = planes[1].parallax
export const NEAR_RAIN_PARALLAX = planes[2].parallax
export const MAX_ROUTE_RAIN = MOBILE_RAIN_LIMIT // Maximum in the CPU painter; the GPU reports its own instance count.
export const MAX_FOOT_SPLASH = 128
const MAX_LIVE_MARKS = 12
const MARK_STRIDE = 5
const RUNOFF_LIMIT = 4
const FILL = 1 - .5 ** (ENV_TICK / 1.4), DRIP = 1 - .5 ** (ENV_TICK / 7.5)
const slots: Record<Tier, readonly number[]> = { low: [7, 4, 3], medium: [9, 6, 4], high: [11, 8, 6], ultra: [14, 10, 8] }

export class RouteWeather {
  readonly clock: EnvironmentFront
  readonly work: WeatherWork & { runoff: number } = { openClips: 0, streaks: 0, splashes: 0, wetMarks: 0, runoff: 0 }
  private reservoir: number
  private travel = 0
  private previousTravel = 0
  rainTime = 0
  private readonly footMarks = new Float64Array(MAX_FOOT_SPLASH * MARK_STRIDE)
  wake = 0
  private readonly phase: number
  private footCursor = 0
  private footCount = 0

  constructor(private readonly route: BridgeRoute) {
    this.phase = drainageOffset(route.seed)
    this.clock = new EnvironmentFront(route.seed, BRIDGE_CLIMATE)
    this.reservoir = this.clock.sample.rain ** 2
  }

  advance(ticks: number, alpha: number): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError('Environment needs nonnegative integer play ticks')
    for (let i = 0; i < ticks; i++) {
      this.clock.advance(1)
      const rain = this.clock.sample.rain, captured = rain * rain
      this.reservoir += (captured - this.reservoir) * (captured > this.reservoir ? FILL : DRIP)
      // Integrate speed, don't multiply the whole elapsed time by today's
      // velocity. A transition won't teleport every long-lived raindrop.
      this.previousTravel = this.travel
      this.travel += ENV_TICK * (.73 + .58 * rain)
    }
    this.clock.interpolate(alpha)
    this.rainTime = this.previousTravel + (this.travel - this.previousTravel) * clamp01(alpha)
  }

  get runoff(): number { return this.reservoir }
  get wind(): number { return this.clock.sample.windX + this.wake * .32 }
  gustAt(x: number, quiet = false): number { return quiet ? 0 : routeWind(x, this.clock.time, this.wind) }

  private cover(x: number): number {
    const s = this.route.shelterAt(x, 22)
    return s ? smoothstep((Math.min(x - s.left, s.right - x) + 22) / 44) : 0
  }
  // A shift in architecture is also a shift in weather, not a reseed.
  rainAt(x: number): number {
    const m = bridgeBiomeMix(x, this.route.seed)
    return bridgePrecipitation(this.clock.sample.rain, m)
  }
  flash(): number {
    const t = this.clock.time, slot = Math.floor(t / 8.8)
    const phase = t - slot * 8.8 - .8 - environmentRandom(this.route.seed, 0x4a9c2133, slot) * 6.3
    if (phase < 0 || phase >= .29) return 0
    return smoothstep((this.clock.sample.rain - .51) * 3.3) * (1 - phase / .29) ** 2 * smoothstep(phase / .035)
  }
  keyWeightAt(x: number): number { return .44 + .56 * this.clock.sample.key * (1 - .81 * this.cover(x)) }
  rainAudioAt(x: number): number { return this.rainAt(x) * (1 - .73 * this.cover(x)) }
  wetnessAt(x: number): number { return this.route.shelterAt(x) ? 0 : bridgeRetention(this.clock.sample.wet, bridgeBiomeMix(x, this.route.seed)) }

  /** Wet marks are real heel/landing events, not a particle per animation
   * frame. Fixed-size ring, no gameplay RNG or dynamic allocation. */
  footfall(x: number, y: number, strength: number, vx: number, landing = false): boolean {
    if (Math.abs(y - ROAD.lane) > 2 || this.wetnessAt(x) < .17 || puddleMask(x + this.phase, ROAD.lane) < .15) return false
    const i = this.footCursor * MARK_STRIDE
    this.footMarks[i] = x; this.footMarks[i + 1] = this.clock.time
    this.footMarks[i + 2] = clamp01(strength); this.footMarks[i + 3] = vx < 0 ? -1 : 1; this.footMarks[i + 4] = +landing
    this.footCursor = (this.footCursor + 1) % MAX_FOOT_SPLASH
    this.footCount = Math.min(MAX_FOOT_SPLASH, this.footCount + 1)
    return true
  }

  /** Master normal perturbation for confirmed wet landings. Same bounded
   * pool as the sprite/Canvas splashes; running heel strikes remain small. */
  bridgeLandings(out: Float32Array, left: number, right: number): number {
    let count = 0
    for (let i = 0; i < this.footCount && count < out.length / 4; i++) {
      const k = ((this.footCursor + MAX_FOOT_SPLASH - 1 - i) % MAX_FOOT_SPLASH) * MARK_STRIDE
      const x = this.footMarks[k], age = this.clock.time - this.footMarks[k + 1]
      if (!this.footMarks[k + 4] || age < 0 || age > .36 || x < left - 50 || x > right + 50) continue
      const j = count++ * 4
      out[j] = worldToSACRX(x, left); out[j + 1] = SACR_ACTOR_Z
      out[j + 2] = age; out[j + 3] = this.footMarks[k + 2]
    }
    return count
  }

  /** Half-open eaves shared with cover collision; one world-space clip for
   * every depth including under camera roll. */
  clip(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, bottom: number): number {
    let cursor = left, clips = 0
    ctx.beginPath()
    for (const { shelter } of this.route.between(left, right)) {
      if (!shelter || shelter.right <= cursor || shelter.left >= right) continue
      if (shelter.left > cursor) { ctx.rect(cursor, top, shelter.left - cursor, bottom - top); clips++ }
      cursor = Math.min(right, shelter.right)
    }
    if (right > cursor) { ctx.rect(cursor, top, right - cursor, bottom - top); clips++ }
    ctx.clip()
    return clips
  }

  private layer(ctx: CanvasRenderingContext2D, view: ViewBounds, cameraX: number, tier: Tier, depth: number, t: number, rain: number, quiet: boolean): void {
    const s = planes[depth], offset = (1 - s.parallax) * cameraX
    const squall = smoothstep((rain - .29) / .63)
    const count = quiet ? 6 : slots[tier][depth], core = quiet ? count : Math.ceil(count * .53)
    const cap = depth === 2 ? MOBILE_RAIN_LIMIT : depth === 1 ? 60 : 40
    const first = Math.floor((view.left - offset - 220) / CELL), last = Math.ceil((view.right - offset + 220) / CELL)
    ctx.strokeStyle = s.paint; ctx.lineWidth = s.width
    const alpha = ctx.globalAlpha
    const batch = (lo: number, hi: number, gain: number) => {
      if (gain < .005 || hi <= lo) return
      ctx.beginPath(); ctx.globalAlpha = alpha * rain * s.gain * gain
      for (let cell = first; cell <= last && this.work.streaks < cap; cell++) {
        for (let j = lo; j < hi && this.work.streaks < cap; j++) {
          const n = cell * 24 + j, a = environmentRandom(this.route.seed, s.salt, n), b = environmentRandom(this.route.seed, 0x50133d29, n)
          const source = offset + (cell + b) * CELL
          const wind = (quiet ? this.clock.sample.windX * .73 : routeWind(source, t, this.wind)) * (.39 + .18 * squall)
          const fall = wrap(a * HEIGHT + (quiet ? 0 : this.rainTime) * (s.base + b * s.speed), HEIGHT)
          const y = s.floor - HEIGHT + fall, x = source + (fall - HEIGHT * .5) * wind
          // Shrink into both ends of the wrap, so no long streak jumps from
          // the floor back into a tall composition.
          const life = smoothstep(fall / 18) * smoothstep((HEIGHT - fall) / 10)
          const len = life * s.length * (.78 + b * .74) * (.60 + .74 * squall)
          if (len < .5 || y < view.top || y - len > view.bottom || x < view.left - 18 || x > view.right + 18 || this.route.shelterAt(x)) continue
          ctx.moveTo(x, y); ctx.lineTo(x - len * wind, y - len)
          this.work.streaks++
        }
      }
      ctx.stroke()
    }
    batch(0, core, 1); batch(core, count, squall)
    ctx.globalAlpha = alpha
  }

  private splashes(ctx: CanvasRenderingContext2D, view: ViewBounds, time: number, rain: number): void {
    if (view.bottom <= ROAD.rear) return
    ctx.save(); ctx.beginPath(); ctx.globalAlpha *= Math.max(.10, rain * .74)
    const ring = (x: number, y: number, phase: number) => {
      if (this.work.splashes >= 12 || phase > .25 || x < view.left || x > view.right || this.route.shelterAt(x, 1)) return
      const r = 1.7 + phase * 16
      ctx.moveTo(x + r, y); ctx.ellipse(x, y, r, r * .28, 0, 0, Math.PI * 2)
      this.work.splashes++
    }
    const pitch = 89
    for (let i = Math.floor(view.left / pitch); rain >= .025 && i * pitch < view.right && this.work.splashes < 9; i++) {
      const x = i * pitch + pitch * environmentRandom(this.route.seed, 0x51bace29, i * 3)
      const y = ROAD.rear + 5 + 93 * environmentRandom(this.route.seed, 0x51bace29, i * 3 + 1)
      const phase = wrap(time + environmentRandom(this.route.seed, 0x51bace29, i * 3 + 2), 1.26)
      if (phase <= .25 && puddleMask(x + this.phase, y) > .27) ring(x, y, phase)
    }
    if (rain >= .025) for (const { platform } of this.route.between(view.left - 12, view.right + 12)) {
      if (platform) ring(platform.right - 29, platform.y - 6, wrap(time + platform.left * .033, 1.13))
    }
    ctx.lineWidth = .87; ctx.strokeStyle = '#c2e1ef'; ctx.stroke(); ctx.restore()
    if (!this.footCount) return
    ctx.save(); ctx.strokeStyle = '#bfe5f6'; ctx.lineWidth = 1.02
    for (let i = 0; i < this.footCount; i++) {
      const k = i * MARK_STRIDE, x = this.footMarks[k], u = (time - this.footMarks[k + 1]) / .27, h = this.footMarks[k + 2], dir = this.footMarks[k + 3]
      if (this.work.wetMarks >= MAX_LIVE_MARKS || u < 0 || u >= 1 || x < view.left - 40 || x > view.right + 40 || h < .01) continue
      ctx.globalAlpha = .55 * (1 - u) * Math.max(rain, .28)
      ctx.beginPath(); ctx.ellipse(x, ROAD.lane + 1, 3 + 14 * u * h, 1 + 3 * u * h, 0, 0, Math.PI * 2)
      const dy = (1 - (2 * u - 1) ** 2) * (4 + h * 13)
      for (let j = 0; j < 4; j++) {
        const px = x - dir * u * (6 + j * 5), py = -dy * (1 - j * .17)
        ctx.moveTo(px, py); ctx.lineTo(px - dir * (2 + u * 2), py - 1.6)
      }
      ctx.stroke(); this.work.wetMarks++
    }
    ctx.restore()
  }

  private eaveRunoff(ctx: CanvasRenderingContext2D, view: ViewBounds, t: number): void {
    const amount = smoothstep((this.reservoir - .018) / .54)
    if (amount <= .002) return
    ctx.save(); ctx.strokeStyle = '#aac2cf'; ctx.lineWidth = 1.1
    ctx.globalAlpha *= .39 * amount
    ctx.beginPath()
    for (const { shelter: s } of this.route.between(view.left - 18, view.right + 18)) {
      if (!s) continue
      const top = SHELTER_KIT[s.kind].eaveY + 4, bottom = ROAD.rear + 2
      for (const side of [-1, 1]) {
        const x = (side < 0 ? s.left : s.right) + side * 6
        if (this.work.runoff >= RUNOFF_LIMIT || x < view.left - 8 || x > view.right + 8 || bottom < view.top) continue
        const phase = wrap(t / .86 + environmentRandom(this.route.seed, 0x23c42e1b, s.id * 2 + +(side > 0)), 1)
        const u = Math.min(1, phase / .82), end = top + (bottom - top) * u * u
        const lean = Math.max(0, side * this.gustAt(x)) * 9
        if (phase <= .82) {
          ctx.moveTo(x + side * u * lean, end)
          ctx.lineTo(x + side * Math.max(0, u - .12) * lean, Math.max(top, end - (6 + 12 * amount) * u))
        } else if (this.work.splashes < 12) {
          const r = 1.8 + (phase - .82) * 39
          ctx.moveTo(x + side * (lean + 3) + r, bottom + 4)
          ctx.ellipse(x + side * (lean + 3), bottom + 4, r, r * .33, 0, 0, Math.PI * 2)
          this.work.splashes++
        }
        this.work.runoff++
      }
    }
    ctx.stroke(); ctx.restore()
  }

  private vents(ctx: CanvasRenderingContext2D, view: ViewBounds): void {
    if (view.top >= BRIDGE_VENT_Y || view.bottom < BRIDGE_VENT_Y - 75) return
    ctx.save(); this.clip(ctx, view.left, view.right, Math.max(-HEIGHT, view.top), Math.min(view.bottom, ROAD.front))
    const t = this.clock.time
    let seen = 0
    for (const c of this.route.between(view.left - 50, view.right + 50)) {
      const x = bridgeVentX(c)
      if (x === null || x < view.left - 50 || x > view.right + 50) continue
      if (seen++ >= BRIDGE_VENT_BUDGET) break
      const wind = this.gustAt(x)
      ctx.fillStyle = c.visualBand === 2 ? '#a6bbc4' : '#c4b8a4'
      for (let j = 0; j < 5; j++) {
        const u = environmentRandom(c.seed, 0x335a41df, j), f = wrap(t * (.87 + u * .54) + u * 9, 1)
        ctx.globalAlpha = .16 * Math.sin(Math.PI * f)
        const px = x + (u - .5) * f * 15 + f * f * (5 + wind * 33), y = BRIDGE_VENT_Y - f * (29 + u * 46)
        ctx.beginPath(); ctx.ellipse(px, y, 1.5 + f * 2.3, 1 + f * 1.4, 0, 0, 2 * Math.PI); ctx.fill()
      }
    }
    ctx.restore()
  }

  draw(ctx: CanvasRenderingContext2D, view: ViewBounds, cameraX: number, tier: Tier, near: boolean, quiet: boolean, master = false): void {
    const { work } = this
    if (!near) work.openClips = work.streaks = work.splashes = work.wetMarks = work.runoff = 0
    const rain = this.rainAt(cameraX)
    if (near && (master || quiet)) return
    if (near) this.vents(ctx, view)
    if (near && rain < .025) return
    const time = quiet ? 0 : this.clock.time
    const top = Math.max(-HEIGHT, view.top - 24), bottom = Math.min(view.bottom, ROAD.front)
    if (top >= bottom || (rain < .025 && (quiet || (!this.footCount && this.reservoir <= .018)))) return
    ctx.save()
    const clips = this.clip(ctx, view.left, view.right, top, bottom)
    if (!near) work.openClips = clips
    if (clips) {
      if (!master && rain >= .025) {
        this.layer(ctx, view, cameraX, tier, near ? 2 : 0, time, rain, quiet)
        if (!near && !quiet) this.layer(ctx, view, cameraX, tier, 1, time, rain, false)
      }
      if (!near && !quiet) {
        // The instanced Master rain replaces the Canvas streaks only; the
        // splash rings, runoff and wet foot marks stay authored Canvas —
        // the road's uLandings ripple the surface beneath them.
        this.splashes(ctx, view, time, rain)
        this.eaveRunoff(ctx, view, time)
      }
    }
    ctx.restore()
  }
}
