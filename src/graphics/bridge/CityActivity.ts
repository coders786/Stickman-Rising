import { skyHash, smoothRange, unit } from './SkyBasis'

/** A landing-to-landing dispatch. Each shaft spends most of its time parked;
 * two neighbouring buildings don't start together or repeat the same sweep. */
export function cityLiftPosition(id: number, seed: number, time: number, quiet: boolean): number {
  const stop = (trip: number) => .13 + .72 * Math.floor(skyHash(id, trip, seed ^ 281) * 9) / 8
  if (quiet) return stop(0)
  const span = 61 + 47 * skyHash(id, seed, 719), clock = time + span * skyHash(seed, id, 187)
  const trip = Math.floor(clock / span), within = clock - trip * span
  const leave = 8 + 32 * skyHash(id, trip, seed ^ 444), from = stop(trip - 1), to = stop(trip)
  const duration = 2.6 + 5.3 * Math.abs(to - from)
  const easing = smoothRange(leave, leave + duration, within)
  return from + (to - from) * easing
}

/** At most one occupied room group per selected tower. Lights settle for
 * tens of seconds; an aperture is never animated by shifting its geometry. */
export function cityRoomLight(id: number, seed: number, time: number): number {
  const t = unit(time / (73 + id % 7 * 3) + skyHash(id, seed, 728))
  return smoothRange(.16, .178, t) * (1 - smoothRange(.61, .631, t))
}
