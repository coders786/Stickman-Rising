import type { Quality } from './background'
import type { ExposureMap } from './exposure'
import { ExposedWeather, type ViewBounds } from './exposed-weather'
import { EnvironmentFront, type FrontRecipe } from './fronts'

/** Binding shared by every open or covered strip of the run. Geometry owns clips;
 * the clock owns meaning; lighting and audio are readers, not schedulers. */
export class SceneFront {
  weather: ExposedWeather
  clock: EnvironmentFront

  constructor(readonly recipe: FrontRecipe, private exposure: ExposureMap, seed: number) {
    this.weather = new ExposedWeather(exposure)
    this.clock = new EnvironmentFront(seed, recipe)
    this.weather.seed(seed)
  }

  reset(seed: number, exposure = this.exposure): void {
    this.clock = new EnvironmentFront(seed, this.recipe)
    if (exposure !== this.exposure) {
      this.exposure = exposure
      this.weather = new ExposedWeather(exposure)
    }
    this.weather.seed(seed)
  }

  advance(ticks: number, alpha: number): void {
    this.clock.advance(ticks)
    this.clock.interpolate(alpha)
  }

  keyWeightAt(x: number): number {
    // An ambient readability floor is independent of exterior access. Shade
    // can soften local key rims and casts, never remove feet or cues.
    return .44 + .56 * this.clock.sample.key * this.exposure.soft(x, 'exteriorLight')
  }
  rainAudioAt(x: number): number {
    return this.clock.sample.rain * this.exposure.soft(x, 'outsideAudio')
  }
  wetnessAt(x: number): number {
    const zone = this.exposure.at(x)
    return zone.splashes ? this.clock.sample.wet * zone.access.precipitation : 0
  }
  draw(ctx: CanvasRenderingContext2D, view: ViewBounds, tier: Quality, quiet: boolean): void {
    this.weather.draw(ctx, this.clock, view, tier, quiet)
  }
}
