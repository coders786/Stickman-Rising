import { DISTRICT_PANEL, districtSocket } from './bridge-sockets'
import { ROAD } from './road-section'
import type { RouteChunk } from './route'
import { SHELTER_KIT } from './run-layout'

export type ShopKind = 'metro' | 'concourse' | 'market' | 'garden'
export type ShopRect = Readonly<{ left: number; top: number; right: number; bottom: number }>
export type ShopPane = ShopRect & { use: 'counter' | 'shelves' | 'seating' | 'door' }
export type ShopFront = Readonly<{
  kind: ShopKind; x: number; frame: ShopRect; panes: readonly ShopPane[];
  /** World depth in optical metres; the shop is behind the rear curb. */
  z: number; roughness: number
}>

const metro: ShopFront = {
  kind: 'concourse', x: 0, z: 6.58, roughness: .24,
  frame: { left: 23, right: 322, top: SHELTER_KIT.concourse.eaveY + 42, bottom: ROAD.rear - 14 },
  panes: [
    // The order hatch ends above the bench. The transom and tiled riser are
    // opaque; neither the menu letters nor the sill receive reflection.
    { left: 31, top: -184, right: 94, bottom: -112, use: 'counter' },
    { left: 104, top: -190, right: 174, bottom: -85, use: 'shelves' },
    { left: 184, top: -190, right: 254, bottom: -85, use: 'seating' },
    { left: 265, top: -190, right: 314, bottom: -81, use: 'door' },
  ],
}
export const concourseShop = metro

const kinds = ['metro', 'market', 'garden'] as const
const profiles = [
  [.27, .24, .29, .20],
  [.25, .26, .30, .19],
  [.29, .24, .26, .21],
] as const
const uses: ShopPane['use'][] = ['counter', 'shelves', 'seating', 'door']
const cache = new WeakMap<RouteChunk, ShopFront | null>()

/** One aperture layout for the art worker, lean coverage and both render
 * backings. `panes` and `frame` are local to the section's world X origin. */
export function bridgeShop(c: RouteChunk): ShopFront | null {
  const old = cache.get(c)
  if (old !== undefined) return old
  let result: ShopFront | null
  if (c.shelter) result = c.shelter.kind === 'concourse' ? { ...metro, x: c.shelter.left } : null
  else {
    const band = c.visualBand, d = DISTRICT_PANEL[band]
    const frame = { left: d.left + 6, right: d.right - 6, top: d.top + 37, bottom: d.bottom - 7 }
    const width = frame.right - frame.left - 10, top = frame.top + 6
    let x = frame.left + 5
    const panes = profiles[band].map((part, i): ShopPane => {
      const run = width * part, bottom = frame.bottom - (i === 0 ? 20 : i === 3 ? 4 : 13)
      const pane = { left: x + 1.1, top, right: x + run - 3.6, bottom, use: uses[i] }
      x += run
      return pane
    })
    result = { kind: kinds[band], x: districtSocket(c), frame, panes, z: 6.24, roughness: band === 1 ? .17 : .24 }
  }
  cache.set(c, result)
  return result
}

export function shopWindowRect(front: ShopFront, pane: ShopRect): ShopRect {
  return { left: front.x + pane.left, right: front.x + pane.right, top: pane.top, bottom: pane.bottom }
}
