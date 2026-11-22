import { featuresFor, type Tier } from './graphics'

const SAMPLE_WINDOW = 30
export const DROP_FRAMES = 28
export const RECOVERY_FRAMES = 270
export const MIN_RENDER_SCALE = .75

/** One governor, one dial. Presets always control detail; Auto can only
 * resize the scene backing after sustained foreground play samples. */
export class RenderScaleControl {
  private cap: number
  private automatic: boolean
  private scale: number
  private readonly samples = new Float64Array(SAMPLE_WINDOW)
  private cursor = 0
  private count = 0
  private total = 0
  private slow = 0
  private fast = 0

  constructor(preset: Tier, adaptive: boolean) {
    this.scale = this.cap = featuresFor(preset).dprCap
    this.automatic = adaptive
  }

  get value(): number { return this.scale }

  configure(preset: Tier, adaptive: boolean): void {
    this.scale = this.cap = featuresFor(preset).dprCap
    this.automatic = adaptive
    this.interrupt()
  }

  interrupt(): void {
    this.cursor = this.count = this.total = this.slow = this.fast = 0
  }

  /** The moving mean must spend 28 consecutive frames above 20ms to shed.
   * Cap isolated outliers before averaging. Recovery at <12ms is slower. */
  frame(ms: number): boolean {
    if (!this.automatic || !Number.isFinite(ms) || ms <= 0) return false
    const sample = Math.min(ms, 50)
    this.total += sample - (this.count === SAMPLE_WINDOW ? this.samples[this.cursor] : 0)
    this.samples[this.cursor] = sample
    this.cursor = (this.cursor + 1) % SAMPLE_WINDOW
    this.count = Math.min(SAMPLE_WINDOW, this.count + 1)
    const avg = this.total / this.count
    this.slow = avg > 20 + 1e-8 ? this.slow + 1 : 0
    this.fast = avg < 12 - 1e-8 ? this.fast + 1 : 0
    let next = this.scale
    if (this.slow >= DROP_FRAMES) next = Math.max(MIN_RENDER_SCALE, Math.round((next - .10) * 100) / 100)
    if (this.fast >= RECOVERY_FRAMES) next = Math.min(this.cap, Math.round((next + .10) * 100) / 100)
    if (next === this.scale) return false
    this.scale = next
    this.interrupt()
    return true
  }
}
