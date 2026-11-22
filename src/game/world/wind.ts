/** STICKMAN RISING — src/game/world/wind.ts
 * ONE WIND, THREE CONSUMERS.
 * ----------------------------------------------------------------------------
 * Cloud drift, cable bow and pennant flutter all have to agree, or the rooftop
 * looks like three unrelated effects. They cannot agree by each reading
 * `profile.clouds.speed` and inventing their own curve: two sines with different
 * phases look like two winds. So the profile's speed axis is turned into a
 * single time-varying field here, and everything downstream samples it.
 *
 * The model is deliberately trivial — it is weather, not fluid dynamics:
 *
 *   speed(t) = base × (0.55 + 1.4·|gust₁(t)|) + base × 0.8·gust₂(t)
 *
 * with two incommensurate gusts (AperiodicLife, golden-ratio family) so the wind
 * never repeats inside a session. `base` is signed: a negative base is a
 * left-blowing wind, and the pennants and cables follow it, which is exactly the
 * kind of low-cost variety a per-run identity is supposed to buy.
 *
 * Units: px/s² of lateral acceleration for the chains, and a 0..1 "airspeed"
 * for anything that only wants a dial (mist opacity, rain slant, grain drift).
 * ==========================================================================*/

import type { EnvironmentProfile } from './profile'
import { AperiodicLife } from '../anim/natural'

export class Wind {
  readonly profile: EnvironmentProfile
  private life: AperiodicLife
  private t = 0
  /** Signed base acceleration, px/s². */
  readonly base: number
  private _accel = 0
  private _airspeed = 0
  /** Weather-front multiplier on the whole field (world/weather.ts). 1 = the
   *  run's own wind; a squall leans on it, a haze stills it. It scales the
   *  ACCELERATION, not `base`, so the sign of a left-blowing night survives. */
  private gust = 1
  private external: number | null = null

  constructor(profile: EnvironmentProfile) {
    this.profile = profile
    // clouds.speed ∈ [0.6, 1.7]; 1.05 is the still point of the authored range.
    // The sign comes from the seed so a run can blow the other way.
    const dir = (profile.seed & 1) === 0 ? 1 : -1
    this.base = dir * (profile.clouds.speed - 1.05) * 90
    this.life = new AperiodicLife(profile.seed ^ 0x77d0)
    this.update(0)
  }

  update(dt: number): void {
    if (dt > 0) this.t += dt
    if (this.external !== null) {
      this._accel = this.external * 150
      this._airspeed = Math.min(1, Math.abs(this._accel) / 70)
      return
    }
    const g1 = this.life.at(this.t, 0.16) - 0.5
    const g2 = this.life.at(this.t * 1.7 + 3.1, 0.23) - 0.5
    this._accel = (this.base * (0.55 + 1.4 * Math.abs(g1)) + this.base * g2 * 0.8) * this.gust
    // 0..1 dial: |base| runs to ~58 px/s² at the extremes of the axis.
    const mag = Math.abs(this._accel)
    this._airspeed = Math.max(0, Math.min(1, mag / 70))
  }

  /** Weather-front gust multiplier (0.4 becalmed … 2 hostile). Recomputes the
   *  field from the current phase so a change is felt on the very next step. */
  setGust(mul: number): void {
    const g = Number.isFinite(mul) ? Math.max(0.35, Math.min(2.2, mul)) : 1
    if (g === this.gust) return
    this.gust = g
    this.update(0)
  }

  /** A compiled scene may supply the same signed wind used by rain and sky. */
  setExternal(wind: number): void {
    this.external = Math.max(-1, Math.min(1, wind))
    this.update(0)
  }

  get gustMul(): number { return this.gust }

  /** Lateral acceleration for a spring chain (px/s²). */
  get accel(): number { return this._accel }

  /** 0..1 magnitude dial for non-physical consumers. */
  get airspeed(): number { return this._airspeed }

  /** Deck-speed multiplier for the cloud sheets: a still night drifts slowly. */
  get driftScale(): number { return 0.55 + 0.9 * this._airspeed }
}
