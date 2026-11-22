import { DEFAULT_SIM_CLOCK } from '../core/sim-clock'
import { minJerk, WEATHER_ORDER, type WeatherKind } from './weather'

export const ENV_TICK = DEFAULT_SIM_CLOCK.stepDt
export const unit = (x: number) => Math.max(0, Math.min(1, x))
export const wrap = (x: number, size: number) => ((x % size) + size) % size

/** Indexed substreams. Adding sky variations or camera-dependent draw work
 * cannot move the next front or consume a draw from the combat RNG. */
export function environmentRandom(seed: number, salt: number, index = 0): number {
  let h = (seed ^ salt ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
  return ((h ^ (h >>> 15)) >>> 0) / 0x100000000
}

export interface FrontRecipe {
  readonly version: number
  /** Separate salt per climate, not per preset or viewport. */
  readonly salt: number
  readonly openings: readonly WeatherKind[]
  readonly openingHold: readonly [number, number] // seconds before lead-in begins
  readonly dwell: readonly [number, number]       // seconds between transition starts
  readonly duration: number                     // total seconds, including lead-in
  readonly windDirection?: -1 | 1
}

const bands = {
  // Cloud cover and extinction describe DISTANCE. They never tint the HUD.
  clear:   { cloud: .17, fog: .12, key: .94, rain: 0,   wind: .15, wet: .04 },
  haze:    { cloud: .29, fog: .46, key: .83, rain: 0,   wind: .11, wet: .08 },
  drizzle: { cloud: .56, fog: .42, key: .69, rain: .34, wind: .23, wet: .47 },
  rain:    { cloud: .83, fog: .65, key: .51, rain: .72, wind: .36, wet: .82 },
  squall:  { cloud: .99, fog: .80, key: .39, rain: .98, wind: .48, wet: 1 },
} satisfies Record<WeatherKind, Record<string, number>>

export function validateFront(recipe: FrontRecipe): void {
  const range = ([a, b]: readonly [number, number], min: number, max: number) =>
    Number.isFinite(a) && Number.isFinite(b) && a >= min && b >= a && b <= max
  if (!Number.isSafeInteger(recipe.version) || recipe.version < 1 || !Number.isSafeInteger(recipe.salt) ||
      !recipe.openings.length || !recipe.openings.every(b => WEATHER_ORDER.includes(b)) ||
      !range(recipe.openingHold, 8, 45) || !range(recipe.dwell, 20, 80) ||
      !Number.isFinite(recipe.duration) || recipe.duration < 8 || recipe.duration > 13 ||
      (recipe.windDirection !== undefined && recipe.windDirection !== -1 && recipe.windDirection !== 1)) {
    throw new Error('Invalid temperate front recipe: check opening, bounded durations, salt and version')
  }
}

export interface FrontSample {
  readonly seed: number
  readonly version: number
  tick: number
  /** Changes count canonical onsets, even if only distant art is visible. */
  changes: number
  from: WeatherKind
  kind: WeatherKind
  startTick: number
  s: number
  rain: number
  fog: number
  cloud: number
  key: number
  gust: number
  windX: number
  wet: number
}

const mix = (a: number, b: number, s: number) => a + (b - a) * s
const wetRise = 1 - .5 ** (ENV_TICK / 5)
const wetDry = 1 - .5 ** (ENV_TICK / 18)
const toTicks = (sec: number) => Math.round(sec / ENV_TICK)

/** Compact rolling tape. One active entry and the next scheduled tick; no
 * history buffer grows with the run. Continuous response is stepped only by
 * accepted fixed play ticks. `interpolate` changes presentation, never events. */
export class EnvironmentFront {
  private readonly stream: number
  private readonly duration: number
  private readonly direction: number
  private nextTick: number
  private drift = 0
  private previousDrift = 0
  private readonly state: FrontSample
  readonly sample: Readonly<FrontSample>
  time = 0
  driftX = 0

  constructor(seed: number, private readonly recipe: FrontRecipe) {
    validateFront(recipe)
    seed >>>= 0
    this.stream = seed ^ recipe.salt ^ Math.imul(recipe.version, 0x62a9d9ed)
    this.direction = recipe.windDirection ?? (environmentRandom(this.stream, 0x1853a2f3) < .5 ? -1 : 1)
    const opening = recipe.openings[Math.floor(environmentRandom(this.stream, 0x539bb0d7) * recipe.openings.length)]
    const b = bands[opening]
    this.duration = toTicks(recipe.duration)
    this.nextTick = this.delay(recipe.openingHold, 0)
    this.sample = this.state = { seed, version: recipe.version, tick: 0, changes: 0,
      startTick: 0, from: opening, kind: opening, s: 1, rain: b.rain, fog: b.fog,
      cloud: b.cloud, key: b.key, gust: b.wind, windX: this.direction * b.wind, wet: b.wet }
  }

  private delay(range: readonly [number, number], index: number): number {
    return toTicks(mix(range[0], range[1], environmentRandom(this.stream, 0x03ee8429, index)))
  }

  /** Live callers pass 0–4 steps; longer batches are useful for offline seek. */
  advance(ticks: number): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError('Environment needs nonnegative integer play ticks')
    const s = this.state
    for (let i = 0; i < ticks; i++) {
      s.tick++
      if (s.tick === this.nextTick) {
        const n = WEATHER_ORDER.indexOf(s.kind)
        // Local edges only. Squalls exit to rain; calm cannot jump to a squall.
        const wetter = n === 0 || (n < WEATHER_ORDER.length - 1 && environmentRandom(this.stream, 0x1580f2a3, s.changes) < (n < 3 ? .65 : .31))
        s.from = s.kind
        s.kind = WEATHER_ORDER[n + (wetter ? 1 : -1)]
        s.startTick = s.tick
        s.changes++
        this.nextTick += this.delay(this.recipe.dwell, s.changes)
      }
      let wetTarget = bands[s.kind].wet
      if (s.from !== s.kind) {
        const t = unit((s.tick - s.startTick) / this.duration)
        const a = bands[s.from], b = bands[s.kind]
        s.s = minJerk(t)
        s.cloud = mix(a.cloud, b.cloud, minJerk(t / .78)) // bank arrives/leaves first
        s.key = mix(a.key, b.key, minJerk((t - .08) / .81))
        s.fog = mix(a.fog, b.fog, minJerk((t - .12) / .8))
        s.gust = mix(a.wind, b.wind, minJerk((t - .10) / .82))
        const water = minJerk((t - .23) / .77)
        s.rain = mix(a.rain, b.rain, water)
        wetTarget = mix(a.wet, b.wet, water)
        s.windX = this.direction * s.gust
        if (t === 1) s.from = s.kind
      }
      s.wet = mix(s.wet, wetTarget, wetTarget > s.wet ? wetRise : wetDry)
      this.previousDrift = this.drift
      this.drift += s.windX * ENV_TICK
    }
  }

  interpolate(alpha: number): void {
    const weight = Number.isFinite(alpha) ? unit(alpha) : 1
    this.time = Math.max(0, this.state.tick - 1 + weight) * ENV_TICK
    this.driftX = mix(this.previousDrift, this.drift, weight)
  }
}
