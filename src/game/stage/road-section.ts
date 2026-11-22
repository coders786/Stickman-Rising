/** Side-on viaduct cross section, in world pixels. Screen-depth landmarks are
 * NOT heights. The fight rail is the centre of the asphalt, never the curb. */
export const ROAD = {
  rear: -52,
  lane: 0,
  front: 52,
  sidewalk: -66,
  fixtureOffset: -61,
  soffit: 82,
} as const

/** The dry plate's always-opaque base begins behind the asphalt. */
export const ROAD_PLATE_TOP = ROAD.sidewalk - 10

/** Continuous point/plane test for the sole. Infinity = no contact this step.
 * A body already touching the plane may leave it upwards without magnetism. */
export function floorTOI(from: number, to: number, floor: number = ROAD.lane): number {
  if (to < floor || to < from) return Infinity
  if (from >= floor) return 0
  return (floor - from) / (to - from)
}

/** Sweep against a standing opponent's side, testing vertical overlap AT impact.
 * Ground furniture on the rear sidewalk is deliberately not a lane collider. */
export function bodySide(
  fromX: number,
  toX: number,
  fromY: number,
  toY: number,
  otherX: number,
  otherY: number,
  half: number,
  height: number,
): number | null {
  const side = fromX < otherX ? -1 : 1,
    boundary = otherX + side * half
  if ((fromX - boundary) * side < 0 || (toX - boundary) * side >= 0) return null
  const t = (boundary - fromX) / (toX - fromX),
    y = fromY + (toY - fromY) * t
  return Math.min(y, otherY) - Math.max(y - height, otherY - 92) > 22
    ? boundary
    : null
}
