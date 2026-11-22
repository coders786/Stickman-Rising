import { skyHash as hash } from './SkyBasis'

// Fixed geometry scale against the walkable deck. Not a camera multiplier.
export const RAIL_MODEL_SCALE = .74
export const RAIL_ARCHETYPES = ['Airport express', 'Parcel freight', 'Night service', 'Metro local'] as const
export const RAIL_EVENT_COUNT = 48
export const RAIL_CAR_PITCH = 157
export const RAIL_SUPPORT_PITCH = 426
export const RAIL_LANES = [0, -30] as const // true wheel/rail-head datums
export const RAIL_WHEEL_BOTTOM = 51
export const RAIL_Y = -252
export const RAIL_SUPPORT = { left: 14, right: 27, top: -118, base: 5, arm: 81, wire: -70 } as const
export interface RailEvent { at: number; speed: number; kind: 0 | 1 | 2 | 3; cars: number; dir: 1 | -1; skin: number }

export function makeRailSchedule(seed: number) {
  const events: RailEvent[] = []
  // One possible double in a block of 12 arrivals, separated from the
  // next double by ordinary gaps. Expresses and locals dominate; freight
  // and maintenance stock remain a less frequent read.
  let at = 0, nextIsDouble = false
  // A line speed per direction keeps consecutive trains from overtaking
  // on a single track, even far beyond the departure datum.
  const speeds = [1130 + 240 * hash(seed, 0, 32), 1050 + 280 * hash(seed, 1, 32)]
  const phase = Math.floor(hash(seed, 1, 924) * 4)
  for (let i = 0; i < RAIL_EVENT_COUNT; i++) {
    const s = hash(i, 8, seed ^ 339)
    const kind = (i < 4 ? (i + phase) & 3 : s < .39 ? 0 : s < .53 ? 1 : s < .62 ? 2 : 3) as RailEvent['kind']
    const block = Math.floor(i / 12), slot = 4 + Math.floor(hash(seed, block, 781) * 4)
    const startsDouble = i % 12 === slot && hash(seed, block, 657) < .82
    // The two trains approach one another on the playable (positive X)
    // side of the datum. Reversing this order sends them apart instead.
    const dir = nextIsDouble ? -1 : startsDouble ? 1 : hash(i, seed, 479) < .45 ? -1 : 1
    events.push({ at, kind, speed: speeds[+(dir < 0)], dir,
      cars: (kind === 1 ? 5 : kind === 2 ? 3 : 4) + Math.floor(hash(seed, i, 73) * (kind === 1 ? 5 : 3)),
      skin: Math.floor(hash(seed, i, 395) * 7) })
    nextIsDouble = startsDouble
    const gap = hash(seed, i, 128)
    at += nextIsDouble ? .34 + .38 * gap : 6.9 + 21 * gap ** 1.4 + 7 * hash(seed, i, 272)
  }
  return { events, period: at, offset: 2.2 + 6.6 * hash(seed, 0, 541) }
}

export class RailSchedule {
  readonly events: readonly RailEvent[]
  readonly period: number
  readonly offset: number
  // Given the minimum ordinary gap, a view can meet at most a pair. Keep
  // one extra slot so the look-back/next-window queries are seam safe.
  readonly time = new Float64Array(3)
  readonly indices = new Int32Array(3)
  count = 0
  private readonly tracks: [number[], number[]] = [[], []]
  constructor(seed: number) {
    const s = makeRailSchedule(seed); this.events = s.events; this.period = s.period; this.offset = s.offset
    for (let i = 0; i < s.events.length; i++) this.tracks[+(s.events[i].dir < 0)].push(i)
  }

  crossingTime(e: RailEvent, cameraX: number): number {
    return this.offset + e.at + e.dir * railLocalOffset(cameraX) / e.speed
  }

  /** Collect only trains whose body could intersect the requested extent.
   * sideSpan is half a viewport in the rail plane, including headlamps. */
  sample(time: number, cameraX: number, sideSpan: number): void {
    this.count = 0
    for (const track of this.tracks) {
      if (!track.length) continue
      const line = this.events[track[0]], n = track.length
      const age = time - this.offset - line.dir * railLocalOffset(cameraX) / line.speed
      const t = age - Math.floor(age / this.period) * this.period
      let lo = 0, hi = n
      while (lo < hi) {
        const m = (lo + hi) >>> 1
        if (this.events[track[m]].at <= t) lo = m + 1
        else hi = m
      }
      // Check a head just ahead of the view, or its still-crossing tail.
      for (let i = lo - 1; i <= lo; i++) {
        const index = track[(i + n) % n], e = this.events[index]
        const dt = t - e.at - (i >= n ? this.period : i < 0 ? -this.period : 0)
        if (dt * e.speed < -sideSpan || dt * e.speed > sideSpan + e.cars * RAIL_CAR_PITCH + 10) continue
        const k = this.count++
        this.indices[k] = index; this.time[k] = dt
        if (this.count === this.indices.length) return
      }
    }
  }

  /** Local wake reaches the bridge about 0.4s after the head passes a point.
   * The bipolar cross-track wake is deterministic under replay/backtracking. */
  wake(time: number, cameraX: number): number {
    this.sample(time, cameraX, 2768)
    let w = 0
    for (let i = 0; i < this.count; i++) {
      const event = this.events[this.indices[i]], dt = this.time[i] - .40
      if (dt < 0 || dt > 1.33) continue
      const k = Math.sin(Math.PI * Math.min(1, dt / .34)) * .42 + Math.max(0, 1 - dt / 1.33) * .63 * Math.min(1, dt * 8)
      w += event.dir * k * (event.kind === 1 ? .91 : .60)
    }
    return w
  }
}

// Both rolling stock and track furniture use this world coordinate. No
// periodic camera warp: relative velocity is zero when moving with a train.
export const railLocalOffset = (worldX: number) => worldX / RAIL_MODEL_SCALE
