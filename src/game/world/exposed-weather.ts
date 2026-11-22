import { ROAD } from '../stage/road-section'
import type { BgCam, Quality } from './background'
import type { ExposureMap, ReceiverZone, RunoffEdge } from './exposure'
import { environmentRandom, wrap, type EnvironmentFront } from './fronts'

export interface ViewBounds { left: number; right: number; top: number; bottom: number }
export function worldBounds(out: ViewBounds, w: number, h: number, cam: BgCam): ViewBounds {
  const c = Math.abs(Math.cos(cam.rot ?? 0)), s = Math.abs(Math.sin(cam.rot ?? 0))
  const hw = (w * c + h * s) / (2 * cam.zoom), hh = (w * s + h * c) / (2 * cam.zoom)
  out.left = cam.x - hw; out.right = cam.x + hw
  out.top = cam.y - hh; out.bottom = cam.y + hh
  return out
}

const CELL = 240, SLOTS = 34, DROP_SPAN = 860, HEAD_END = ROAD.rear + 7
const WIDTH_GUARD = 240, MAX_SPLASHES = 14
const LIMIT: Readonly<Record<Quality, number>> = { low: 19, medium: 24, high: 29, ultra: SLOTS }
const MAX_STREAKS = 180

export interface WeatherWork {
  openClips: number
  streaks: number
  splashes: number
  wetMarks: number
}

/** A bounded, analytic rear rain field. No collision objects, resize reseed,
 * foreground pass or full-screen alpha surface. Each added slot is a stable
 * decoration; the lower tier remains a prefix of the SAME storm. */
export class ExposedWeather {
  private readonly cellCount: number
  private readonly slots: Float32Array
  private readonly splash = new Float32Array(MAX_SPLASHES * 3)
  private readonly work: WeatherWork = { openClips: 0, streaks: 0, splashes: 0, wetMarks: 0 }
  readonly stats: Readonly<WeatherWork> = this.work

  constructor(private readonly map: ExposureMap) {
    this.cellCount = Math.ceil((map.right - map.left) / CELL)
    this.slots = new Float32Array(this.cellCount * SLOTS * 4)
  }

  seed(seed: number): void {
    const a = this.slots
    for (let i = 0, k = 0; k < a.length; i++, k += 4) {
      a[k] = this.map.left + Math.floor(i / SLOTS) * CELL + environmentRandom(seed, 0x2ae7ce29, i) * CELL
      a[k + 1] = environmentRandom(seed, 0x55d85ae7, i) * DROP_SPAN
      a[k + 2] = 280 + environmentRandom(seed, 0x29a9447f, i) * 180
      a[k + 3] = 10 + environmentRandom(seed, 0x62831a93, i) * 13
    }
  }

  draw(ctx: CanvasRenderingContext2D, front: EnvironmentFront, view: ViewBounds, quality: Quality, quiet: boolean): void {
    const w = this.work
    w.openClips = w.streaks = w.splashes = w.wetMarks = 0
    if (view.top >= ROAD.front || view.bottom < HEAD_END - DROP_SPAN - 30) return
    if (front.sample.wet > .035 && view.top < ROAD.front && view.bottom > ROAD.rear) {
      for (const edge of this.map.runoff) this.drawWetEdge(ctx, edge, front.sample.wet, view)
    }
    if (front.sample.rain <= .002) return
    let visible = 0
    for (const zone of this.map.exposed) if (zone.left < view.right && zone.right > view.left) visible++
    if (!visible) return
    // Reserve work for every visible opening. An ultrawide west approach
    // cannot consume the whole storm and leave the east approach dry.
    const streaksPerClip = Math.floor(MAX_STREAKS / visible), splashesPerClip = Math.floor(MAX_SPLASHES / visible)
    for (const zone of this.map.exposed) {
      const left = Math.max(view.left, zone.left), right = Math.min(view.right, zone.right)
      if (right <= left) continue
      const cells = 1 + Math.ceil((right - left) / CELL)
      const slots = Math.min(quiet ? 10 : LIMIT[quality], Math.ceil(streaksPerClip / cells) + 5)
      this.drawClip(ctx, zone, front, left, right, view, slots, quiet, streaksPerClip, splashesPerClip)
    }
  }

  private drawWetEdge(ctx: CanvasRenderingContext2D, { x: seam, side, span }: RunoffEdge, wet: number, view: ViewBounds): void {
    if (span < 16 || (side < 0 ? seam <= view.left || seam - 60 >= view.right : seam >= view.right || seam + 60 <= view.left)) return
    ctx.save()
    ctx.globalAlpha *= wet * .32
    ctx.strokeStyle = '#a9c1cb'; ctx.lineWidth = 1.15; ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < 7; i++) {
      const d = 3 + (i * 19) % Math.min(42, span - 9), y = ROAD.rear + 9 + i * 13
      ctx.moveTo(seam + side * d, y)
      ctx.lineTo(seam + side * Math.min(span - 2, d + 6 + (i % 3) * 3), y + .4)
    }
    ctx.stroke()
    ctx.restore()
    this.work.wetMarks += 7
  }

  private drawClip(ctx: CanvasRenderingContext2D, zone: ReceiverZone, front: EnvironmentFront,
    left: number, right: number, view: ViewBounds, count: number, quiet: boolean, streakLimit: number, splashLimit: number): void {
    const clipTop = Math.max(view.top, HEAD_END - DROP_SPAN - 30)
    const clipBottom = Math.min(view.bottom, ROAD.front)
    if (clipTop >= clipBottom) return
    const mapX = this.map.left
    const first = Math.max(0, Math.floor((left - mapX - WIDTH_GUARD) / CELL))
    const end = Math.min(this.cellCount, 1 + Math.floor((right - mapX + WIDTH_GUARD) / CELL))
    const s = front.sample, wind = quiet ? Math.sign(s.windX) * .22 : s.windX
    const rain = s.rain * zone.access.precipitation
    const time = quiet ? 0 : front.time
    const splashBefore = this.work.splashes, rainBefore = this.work.streaks
    const maxRain = rainBefore + streakLimit, maxSplash = splashBefore + splashLimit
    const addSplashes = !quiet && zone.splashes && view.bottom > ROAD.rear && view.top < ROAD.front
    const a = this.slots, drops = this.splash
    ctx.save()
    ctx.beginPath(); ctx.rect(left, clipTop, right - left, clipBottom - clipTop); ctx.clip()
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let cell = first; cell < end && this.work.streaks < maxRain; cell++) {
      const row = cell * SLOTS * 4
      for (let i = 0; i < count && this.work.streaks < maxRain; i++) {
        const k = row + i * 4, speed = a[k + 2], length = a[k + 3]
        const fall = wrap(a[k + 1] + speed * time, DROP_SPAN)
        const x = a[k] + (fall - DROP_SPAN * .5) * wind
        const y = HEAD_END - DROP_SPAN + fall
        const tailX = x - wind * length
        if (y >= clipTop && y - length <= clipBottom && Math.max(x, tailX) >= left && Math.min(x, tailX) <= right) {
          ctx.moveTo(x, y); ctx.lineTo(tailX, y - length)
          this.work.streaks++
        }
        // Just after a fall wraps, its PREVIOUS landing can leave a tiny
        // ripple. Admit only if its landing and receiver really were exposed.
        const age = fall / speed
        if (!addSplashes || this.work.splashes >= maxSplash || i % 3 !== 0 || time < age || age > .25) continue
        const foot = a[k] + DROP_SPAN * .5 * wind
        if (foot < left + 4 || foot > right - 4) continue
        const n = this.work.splashes++ * 3
        drops[n] = foot; drops[n + 1] = ROAD.rear + 12 + ((i * 31 + cell * 19) % 74)
        drops[n + 2] = 1.6 + age * 7
      }
    }
    if (this.work.streaks !== rainBefore) {
      ctx.strokeStyle = '#9fc5df'
      ctx.lineWidth = .95
      ctx.globalAlpha = rain * (quiet ? .46 : .78)
      ctx.stroke()
    }
    if (this.work.splashes !== splashBefore) {
      ctx.strokeStyle = '#bdd7e6'; ctx.globalAlpha = rain * .48; ctx.lineWidth = .85
      ctx.beginPath()
      for (let j = splashBefore * 3; j < this.work.splashes * 3; j += 3) {
        const x = drops[j], y = drops[j + 1], r = drops[j + 2]
        ctx.moveTo(x + r, y); ctx.ellipse(x, y, r, r * .31, 0, 0, Math.PI * 2)
      }
      ctx.stroke()
    }
    this.work.openClips++
    ctx.restore()
  }
}
