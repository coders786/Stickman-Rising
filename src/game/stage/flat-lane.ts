import { ROAD } from './road-section'

/** Permanent fight plane of the bridge. The run composer only dresses it;
 * covered receivers cannot move the camera limits, floor or spawns. */
export const FLAT_LANE = Object.freeze({
  id: 'slasher-flat-v1',
  left: -60,
  right: 2560,
  entryX: 1300,
  waveLeft: 40,
  waveRight: 2500,
  floorY: ROAD.lane,
  artLeft: -150,
  artRight: 2750,
  artOverhang: 1024,
} as const)

export type FlatLane = typeof FLAT_LANE
