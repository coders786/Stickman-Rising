/** STICKMAN RISING — src/game/world/weather.ts
 * THE WEATHER FRONT: the run changes its mind while you are fighting in it.
 * ----------------------------------------------------------------------------
 * `world/storm.ts` has always been able to rain. What no version of this game
 * has had is a *front* — the sky deciding, mid-run, to stop raining, to haze
 * over, to close in. That is the difference between a weather effect and
 * weather, and it is the last big piece of "the stage is alive" in docs/master
 * §T5.1.
 *
 * THREE LAWS (each one is a test in tests/weather.test.ts):
 *
 *  1. **A change is an event, not a switch.** Every transition is a cross-fade
 *     over FADE seconds, eased with the minimum-jerk curve (18 §3: the ease the
 *     eye reads as a *reach* rather than a slide). Under that, a one-frame
 *     weather change is a bug the player will describe as "glitchy" without
 *     being able to say why.
 *
 *  2. **Slow, then slower.** No two changes start less than DWELL seconds
 *     apart. Weather that changes every 5 s is a lava lamp; weather that changes
 *     once or twice in a run is a place with a climate.
 *
 *  3. **Never during a flash.** If lightning is inside its afterglow, the front
 *     holds. The frame is already strobing; a grade shift under it is invisible,
 *     which means the single change we are allowed this minute would be spent on
 *     nothing.
 *
 * WHAT IT DOES NOT DO: it does not own the weather — the profile does. The
 * front only moves *within* the run's identity: a run with `stormBias 0.35`
 * stays a settled night that occasionally hazes over; a `1.35` run is a place
 * where squalls arrive. Rarity is the run's; the timing is the front's.
 *
 * COST: one object, three scalars of interpolation per frame, zero allocation
 * after construction (the sample is mutated in place, not rebuilt).
 * ==========================================================================*/

export type WeatherKind = 'clear' | 'haze' | 'drizzle' | 'rain' | 'squall'

/** The kinds in "how wet" order. Index distance is the front's inertia: a jump
 *  of two bands is possible but four times less likely than a neighbouring one
 *  (weather has momentum — you do not go from clear to squall in one step). */
export const WEATHER_ORDER: readonly WeatherKind[] = ['clear', 'haze', 'drizzle', 'rain', 'squall']

export interface WeatherBand {
  /** Multiplier on the run's own rain. 0 = no drops at all. */
  rain: number
  /** Multiplier on the fog plane's alpha and on the horizon mist. */
  fog: number
  /** Multiplier on the shared wind (cloud drift + rigging + pennants). */
  gust: number
  /** Grade offset, −1 cold/wet … +1 warm/sodium. Feeds the sky tint fill. */
  tint: number
  /** Multiplier on the wet-deck glitter gain (the reflection's response). */
  wet: number
}

/** Authored bands. Judgement, not measurement: the numbers were picked so that
 *  `rain` and `wet` move together (wet deck follows rain), `fog` and `gust`
 *  oppose (still air hazes, moving air clears), and the tints split warm-haze
 *  from cold-rain. `clear` is NOT zero fog — a night is never optically empty. */
export const WEATHER_BANDS: Record<WeatherKind, WeatherBand> = {
  clear:   { rain: 0.06, fog: 0.82, gust: 0.92, tint: -0.10, wet: 0.40 },
  haze:    { rain: 0.00, fog: 1.40, gust: 0.58, tint: 0.42, wet: 0.18 },
  drizzle: { rain: 0.46, fog: 1.14, gust: 1.12, tint: -0.12, wet: 1.00 },
  rain:    { rain: 0.82, fog: 1.26, gust: 1.38, tint: -0.30, wet: 1.55 },
  squall:  { rain: 1.00, fog: 1.48, gust: 1.90, tint: -0.46, wet: 2.10 },
}

/** Seconds a cross-fade takes. Inside the 8–13 s band from the plan; fixed
 *  rather than jittered because a fade duration is not something a player can
 *  perceive as variety, and a constant is one less thing to reason about. */
export const FADE = 9
/** Minimum seconds between the STARTS of two changes. */
export const DWELL = 20
/** Lightning intensity above which the front refuses to move. */
export const FLASH_HOLD = 0.02

export interface WeatherSample {
  /** The band the front is heading to (what the sky is becoming). */
  kind: WeatherKind
  /** The band it is leaving (equal to `kind` when settled). */
  from: WeatherKind
  /** 0 settled … 1 fully in the new band. */
  s: number
  rain: number
  fog: number
  gust: number
  tint: number
  wet: number
}

/** Minimum-jerk (quintic) ease. 0→1 with zero velocity and zero acceleration at
 *  both ends, which is the curve 18 §3 selects for anything the eye should read
 *  as a deliberate reach rather than a slide. */
export function minJerk(s: number): number {
  const x = s < 0 ? 0 : s > 1 ? 1 : s
  return x * x * x * (10 - 15 * x + 6 * x * x)
}

/** Weight of each band for a given run. Pure and testable: bias is the run's
 *  `weather.stormBias` (0.35 settled … 1.35 stormy), wet is its `weather.rain`. */
export function bandWeights(bias: number, wet: number): Record<WeatherKind, number> {
  const b = clamp(bias, 0.35, 1.35)
  const wetness = clamp(wet, 0.7, 1.35)
  // p = 0 on the calmest run, 1 on the stormiest. Linear in the axis so the
  // player's model ("this night is a stormy one") matches the numbers.
  const p = (b - 0.35) / 1.0
  return {
    clear: 2.0 * (1 - p) + 0.25,
    // Haze is the calm run's event: still, warm, sodium-lit air. It stays
    // available on stormy runs but is a quarter as likely there.
    haze: (1.15 * (1 - p) + 0.30) * (1.25 - (wetness - 0.7) * 0.6),
    drizzle: 0.75,
    rain: (0.45 + 1.15 * p) * wetness,
    squall: (0.15 + 1.70 * p) * wetness * wetness,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo
}

export class WeatherFront {
  readonly seed: number
  /** Dwell timer: seconds until a change is *allowed* (not until it happens). */
  private dwell = 0
  /** Fade progress in seconds; >= FADE means settled. */
  private fade = FADE
  private state: WeatherSample
  private weights: Record<WeatherKind, number>
  private rngState: number
  /** Diagnostics for the debug overlay and the bench. */
  changes = 0
  heldForFlash = 0

  constructor(seed: number, bias: number, wet: number, start?: WeatherKind) {
    this.seed = seed >>> 0
    this.weights = bandWeights(bias, wet)
    this.rngState = (this.seed ^ 0x9e3779b9) >>> 0 || 1
    // Open on the band the profile favours: a stormy run starts in `rain`, a
    // settled one in `clear`. Deriving it from the weights (not a coin flip)
    // keeps the first frame consistent with the run identity.
    const first = start ?? this.pick(null)
    this.state = { kind: first, from: first, s: 1, ...WEATHER_BANDS[first] }
    this.dwell = DWELL * 0.55
  }

  private rnd(): number {
    // xorshift32 — same generator as the storm engine, same reason: a weather
    // sequence must be reproducible from the seed for a bug report to mean
    // anything.
    let x = this.rngState
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rngState = x >>> 0
    return this.rngState / 4294967296
  }

  /** Weighted pick with inertia: a band two steps away from the current one is
   *  four times less likely than the sum of its neighbours. */
  private pick(from: WeatherKind | null): WeatherKind {
    const fromIdx = from ? WEATHER_ORDER.indexOf(from) : -1
    let total = 0
    const w: number[] = []
    for (let i = 0; i < WEATHER_ORDER.length; i++) {
      const k = WEATHER_ORDER[i]
      let v = this.weights[k]
      if (i === fromIdx) v = 0 // a change must change something
      else if (fromIdx >= 0) {
        const d = Math.abs(i - fromIdx)
        if (d >= 2) v *= 0.25 * d
      }
      w.push(v)
      total += v
    }
    if (total <= 0) return from ?? 'clear'
    let r = this.rnd() * total
    for (let i = 0; i < w.length; i++) {
      r -= w[i]
      if (r <= 0) return WEATHER_ORDER[i]
    }
    return WEATHER_ORDER[WEATHER_ORDER.length - 1]
  }

  /** Advance. `dt` seconds, `lightning` 0..1 from StormEngine.intensity. */
  update(dt: number, lightning: number): void {
    if (!(dt > 0)) return
    const d = dt > 0.25 ? 0.25 : dt // a tab-switch resume must not skip a fade
    if (this.fade < FADE) {
      this.fade = Math.min(FADE, this.fade + d)
      const t = minJerk(this.fade / FADE)
      const a = WEATHER_BANDS[this.state.from]
      const b = WEATHER_BANDS[this.state.kind]
      this.state.s = t
      this.state.rain = a.rain + (b.rain - a.rain) * t
      this.state.fog = a.fog + (b.fog - a.fog) * t
      this.state.gust = a.gust + (b.gust - a.gust) * t
      this.state.tint = a.tint + (b.tint - a.tint) * t
      this.state.wet = a.wet + (b.wet - a.wet) * t
      if (this.fade >= FADE) {
        this.state.from = this.state.kind
        this.state.s = 1
      }
      return
    }
    if (this.dwell > 0) {
      this.dwell -= d
      if (this.dwell > 0) return
    }
    // Due. The only reason to wait is a flash: the sky is already strobing.
    if (lightning > FLASH_HOLD) {
      this.heldForFlash += d
      this.dwell = 0
      return
    }
    const next = this.pick(this.state.kind)
    this.state.from = this.state.kind
    this.state.kind = next
    this.state.s = 0
    this.fade = 0
    this.dwell = DWELL
    this.changes++
  }

  /** The live sample. NEVER written to by callers; read the fields. */
  get sample(): WeatherSample {
    return this.state
  }

  get fading(): boolean {
    return this.fade < FADE
  }

  /** Seconds until the next change may start (negative = overdue but held). */
  get nextChangeIn(): number {
    return this.fade < FADE ? FADE - this.fade : this.dwell
  }

  /** Restart in place for a new run WITHOUT allocating a new front (the game
   *  object lives for the whole session). Same object, new identity. */
  reset(seed: number, bias: number, wet: number): void {
    const next = new WeatherFront(seed, bias, wet)
    this.rngState = next.rngState
    this.weights = next.weights
    this.state.kind = next.state.kind
    this.state.from = next.state.kind
    this.state.s = 1
    const b = WEATHER_BANDS[next.state.kind]
    this.state.rain = b.rain
    this.state.fog = b.fog
    this.state.gust = b.gust
    this.state.tint = b.tint
    this.state.wet = b.wet
    this.fade = FADE
    this.dwell = next.dwell
    this.changes = 0
    this.heldForFlash = 0
  }
}

/** Which way the tint leans, as a fill colour for the sky pass. Warm sodium
 *  against cold rain — the two halves of a city night's colour temperature. */
export function tintColour(tint: number): string {
  return tint >= 0 ? '255,150,74' : '74,140,255'
}

/** Alpha of that fill, from the tint's magnitude. Capped low (a grade is a
 *  whisper; anything over ~0.12 reads as a coloured gel over the lens) and
 *  quantised to 32 levels so `rgbaConst` can cache the string (render/color.ts)
 *  — the draw path must not format colours per frame. */
export function tintAlpha(tint: number): number {
  const a = Math.min(0.12, Math.abs(tint) * 0.26)
  // FLOOR, not round: rounding 0.12 up to 4/32 would break the cap that makes
  // this a grade instead of a coloured gel.
  return Math.floor(a * 32) / 32
}
