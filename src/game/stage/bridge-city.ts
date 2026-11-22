import { skyHash as hash } from '../../graphics/bridge/SkyBasis'
import { BRIDGE_TOWERS, CITY_CARD_H, type CityUse, type Tower } from '../../graphics/bridge/CityGeometry'
import { edge, face, ramp, slab, type ArtPen } from './bridge-art'
import { ROAD } from './road-section'
import { sectionY, type SectionCamera } from './bridge-depth'

export { CITY_CARD_W, CITY_CARD_H } from '../../graphics/bridge/CityGeometry'
const skin: Record<CityUse, readonly [string, string, string, string]> = {
  office: ['#445e70', '#192c40', '#212d3b', '#7896a7'],
  residence: ['#566164', '#2a333d', '#272c35', '#818b80'],
  hotel: ['#4d566c', '#252b40', '#222739', '#a08391'],
  civic: ['#5a6e74', '#273943', '#242e3a', '#7e9997'],
  terrace: ['#49665e', '#23373d', '#222e34', '#81a18e'],
  loft: ['#645459', '#3a303b', '#2a2733', '#927d72'],
}
const signage: Record<CityUse, string> = { office: 'A T R I A', residence: 'THE ROW', hotel: 'ORBIT HOTEL', civic: 'CITY LIBRARY', terrace: 'SKY GARDEN', loft: 'STUDIOS' }
const windowTint = ['#dec18f', '#9bc4c8', '#cbe3ce', '#c9a0ad', '#e1d6b4']

/** Floor cells are baked into the albedo and emission mask together. */
export function cityGlazing(s: Tower) {
  const faceW = s.w - s.ledge, dx = s.use === 'office' || s.use === 'civic' ? 5.8 : s.use === 'residence' ? 8.6 : 7.6
  const dy = s.use === 'residence' ? 11 : s.use === 'hotel' ? 8 : s.use === 'loft' ? 12 : 9
  return { x: s.x + 3.2, y: s.top + 14, dx, dy, cols: Math.max(1, Math.floor((faceW - 5) / dx)), width: dx - (s.use === 'office' ? 1.05 : 2.4), height: dy - (s.use === 'civic' ? 2 : 4.2) }
}

function occupiedRoom(id: number, floor: number, use: CityUse, v: number): boolean {
  return v > (use === 'residence' ? .61 : .67) || floor % 8 === id % 8 && v > .29
}

/** An occasional light in an unoccupied mid-city room, not a layer that
 * pulses whole blocks. Addresses are from the same window module as the bake. */
export const CITY_ACTIVITY_ROOMS = BRIDGE_TOWERS[1].flatMap(s => {
  if (s.id % 3 !== 1 && !s.landmark) return []
  const room = cityGlazing(s)
  for (let j = 3 + s.id % 3; j < 10; j++) {
    const y = room.y + j * room.dy
    if (y + room.height >= CITY_CARD_H[1] - 16) break
    if (occupiedRoom(s.id, j, s.use, hash(s.id, j, 549))) continue
    return [{ id: s.id, x: room.x, y, w: room.width, h: room.height }]
  }
  return []
})

/** A few illuminated elevator cabs behind the centre of real glass
 * shafts. Fixed aperture addresses are also used by the baked albedo. */
export const CITY_LIFTS = BRIDGE_TOWERS[1].flatMap(s => {
  const faceW = s.w - s.ledge
  if (faceW < 34 || s.h < 100 || (s.use !== 'office' && !s.landmark)) return []
  return [{ id: s.id, x: s.x + faceW * .54, y: s.top + 15, w: Math.min(9.2, faceW * .23), bottom: CITY_CARD_H[1] - 17 }]
})
const lifts = new Map(CITY_LIFTS.map(lift => [lift.id, lift]))

/** Same clipped façade silhouette in both passes. The mask records lit
 * glass and wayfinding emitters, not an inferred threshold on the albedo. */
export function paintCityCard(g: ArtPen, depth: 0 | 1, details = true, emission = false): void {
  const height = CITY_CARD_H[depth], dark = '#000000'
  for (const s of BRIDGE_TOWERS[depth]) {
    const { x, w, top: y, ledge: d, id, crown: high, inset, use } = s, width = w - d
    const [sky, main, side, rim] = skin[use], lean = s.landmark && id % 2 ? width * .18 : 0
    const start = x + inset, end = x + width - d * .26
    face(g, emission ? dark : side, x + width, y, x + w, y + d * .49, x + w, height, x + width, height)
    face(g, emission ? dark : main, start, y + 1, start + lean, high, end, high + lean * .38, end + d * .44, y + 2)
    face(g, emission ? dark : rim, start + lean, high, start + lean + d * .35, high - 2, end + d * .30, high + lean * .38 - 2, end, high + lean * .38)
    if (s.mast) {
      edge(g, emission ? dark : rim, .88, end - 2, high + lean * .38 + 2, end - 2, high + lean * .38 - 9)
      if (!emission) slab(g, '#b66e6b', end - 2.8, high + lean * .38 - 9, 1.6, 1.2)
    }
    slab(g, emission ? dark : ramp(g, 0, y, 0, height, sky, main, '#151f2c'), x, y, width, height - y)
    face(g, emission ? dark : rim, x, y, x + d * .81, y - d * .50, x + w - d * .31, y - d * .50, x + width, y)
    if (!details) continue
    slab(g, emission ? dark : '#1824339c', x, y + 1.1, width, 2.2)
    if (use === 'office' || s.landmark) {
      for (let j = start + 3.5; j < end - 1; j += 4.8) {
        if (!emission) edge(g, '#a1c5cc67', .65, j + lean * .8, high + 4, j, y - 2)
        if (hash(id, j | 0, 182) > .57) slab(g, emission ? '#a3a3a3' : '#a7ced1', j, high + 9, 1.35, Math.max(2, y - high - 14))
      }
    }
    if (!emission && use === 'office') {
      // Offset curtain wall and another tall glass face on the landmark.
      face(g, '#7e9da84b', x + width * .54, y + 2, x + width * .92, y + 3, x + width * .72, height - 14, x + width * .58, height - 14)
      edge(g, '#8ab6b189', .76, x + width * .81, y + 3, x + width * .62, height - 14)
    }
    if (use === 'hotel' && s.landmark) {
      for (const f of [.19, .72]) {
        const y1 = y + f * s.h
        slab(g, emission ? '#777777' : '#bc93a1a3', x + 1, y1, width - 1, 1.55)
        if (!emission) slab(g, '#a7a1ab66', x + width, y1 + d * .32, d, 1)
      }
    }
    if (use === 'terrace' || use === 'residence') {
      for (const k of [0, .40]) {
        const ty = y + k * s.h, p = x + width * (.08 + k), l = Math.min(width * .5, x + width - p)
        slab(g, emission ? dark : '#557366', p, ty - .7, l, 1.9)
        for (let j = 2; j < l - 1; j += 4.6) {
          const lift = 2.2 + 3.8 * hash(id, j | 0, 145 + (k * 10 | 0))
          if (!emission) {
            g.fillStyle = j % 3 > 1 ? '#4b725e' : '#3e594f'; g.beginPath(); g.ellipse(p + j, ty - lift * .42, 1.95, lift * .6, 0, 0, Math.PI * 2); g.fill()
          }
        }
      }
    }
    const room = cityGlazing(s)
    const lobby = 13 + +(use === 'civic' || use === 'hotel') * 10
    for (let row = room.y, j = 0; row + room.height < height - lobby; row += room.dy, j++) {
      for (let k = 0; k < room.cols; k++) {
        const col = room.x + k * room.dx, v = hash(id, j, 549 + 113 * k), tint = windowTint[(id + j + k * 3) % windowTint.length]
        const occupied = occupiedRoom(id, j, use, v)
        if (emission) {
          if (occupied) slab(g, '#b9b9b9', col, row, room.width, room.height)
        } else {
          slab(g, occupied ? tint + (v > .83 ? 'c8' : '89') : '#102130a4', col, row, room.width, room.height)
          if (occupied) {
            // A blind and one interrupted silhouette give glazing interior depth.
            slab(g, '#2b3c426d', col, row + 2, room.width, .6)
            if (v > .86) slab(g, '#3035418c', col + room.width * .56, row + room.height * .49, .9, room.height * .49)
          }
        }
      }
      if (!emission) {
        if (use === 'residence' || use === 'terrace') slab(g, '#9ba89e71', x + 1, row + room.height + 1.1, width - 1, .9)
        else slab(g, '#13203290', x, row + room.height + 1.7, width, .8)
      }
    }
    if (!emission && (use === 'hotel' || use === 'civic')) for (let u = x + 1; u < x + width; u += room.dx * 2) {
      slab(g, rim, u, y + 8, .75, height - y - 9)
    }
    const lift = depth ? lifts.get(id) : undefined
    if (lift) {
      const { x, y, w, bottom } = lift, h = bottom - y
      slab(g, emission ? dark : '#101e2b', x - 1.4, y - 1.4, w + 2.8, h + 2.8)
      if (!emission) {
        slab(g, ramp(g, x, 0, x + w, 0, '#182d3b', '#314b57', '#152632'), x, y, w, h)
        slab(g, '#719da16c', x + .7, y, .75, h)
        slab(g, '#78939770', x + w - 1.2, y, .7, h)
        for (let row = y + 7; row < bottom - 1; row += room.dy * 1.5) slab(g, '#577c828a', x + 1.5, row, w - 3, .66)
      }
    }
    if (depth && width > 26 && (s.landmark || use === 'civic' || use === 'hotel')) {
      const bandY = y + (s.landmark ? 6 : 8)
      if (!emission) slab(g, '#1d2b3e', x + 1, bandY - 5.2, width - 2, 7.3)
      g.textAlign = 'center'; g.font = `bold ${width > 40 ? 5.9 : 4.5}px sans-serif`; g.fillStyle = emission ? '#d3d3d3' : rim
      g.fillText(signage[use], x + width * .5, bandY, width - 4)
    }
    if (!emission) slab(g, '#283948', x, height - lobby, width, lobby)
    for (let j = x + 3; j + 4 < x + width; j += 7) {
      slab(g, emission ? '#7a7a7a' : '#86aba684', j, height - lobby + 4, 5.1, lobby - 7)
    }
  }
}

export const STREET_CARD_W = 960, STREET_CARD_H = 192
export const STREET_SILL = 94, STREET_FRONT = 148, STREET_SCALE = .82
export const STREET_REAR_Y = ROAD.soffit + 16
export const STREET_TOP_Y = STREET_REAR_Y - STREET_SILL * STREET_SCALE
export const STREET_FRONT_Y = STREET_TOP_Y + STREET_FRONT * STREET_SCALE
export function streetProject(cam: Pick<SectionCamera, 'y' | 'zoom'>, h: number) {
  return { scale: cam.zoom * STREET_SCALE, top: sectionY(cam, h, STREET_TOP_Y),
    rear: sectionY(cam, h, STREET_REAR_Y), front: sectionY(cam, h, STREET_FRONT_Y) }
}

/** Empty maintenance court under the viaduct. No dynamic vehicles, tail
 * lights or separate moving background layer. All lighting is on the card. */
export function paintStreetCard(g: ArtPen) {
  const w = STREET_CARD_W
  slab(g, ramp(g, 0, 0, 0, 95, '#27404f00', '#27384725', '#17232c'), 0, 0, w, 95)
  // Low annexes with glazed service rooms, vents and pilasters.
  for (let i = 0; i < 8; i++) {
    const x = i * 120 + 7, width = 81 + Math.floor(hash(i, 7, 22) * 24), y = 19 + Math.floor(hash(i, 9, 27) * 22)
    face(g, '#4d606a', x, y + 6, x + 14, y, x + width + 5, y, x + width - 7, y + 6)
    slab(g, ramp(g, 0, y, 0, 94, '#394b55', '#283641', '#202d36'), x, y + 6, width, 88 - y)
    slab(g, '#131c25', x + 4, y + 14, width - 8, 4)
    const glass = ramp(g, 0, 56, 0, 88, '#52717b', '#334c56', '#253540')
    slab(g, '#141f29', x + 8, 53, width - 16, 39)
    for (let k = x + 10; k + 13 <= x + width - 10; k += 17) {
      slab(g, glass, k, 55, 13, 34)
      face(g, '#a9bfc13f', k + 2, 55, k + 5, 55, k + 12, 73, k + 12, 83)
      slab(g, '#9cb4aa7b', k, 61, 13, 1)
      slab(g, '#0e1f29', k, 74, 13, .9)
    }
    slab(g, '#6c838669', x + 8, 91, width - 16, 1)
    slab(g, '#141f29', x, y + 4, 4, 90 - y)
  }
  slab(g, '#182630', 0, 94, w, STREET_CARD_H - 94)
  slab(g, ramp(g, 0, 96, 0, 152, '#42545a', '#31404a', '#202d36'), 0, 95, w, 55)
  slab(g, '#7b948989', 0, 95, w, 2)
  slab(g, '#0d2027', 0, 103, w, 2)
  slab(g, '#40545e', 0, 147, w, 2)
  slab(g, ramp(g, 0, 150, 0, STREET_CARD_H, '#151f28', '#0d171e'), 0, 150, w, STREET_CARD_H - 150)
  for (let x = 0; x < w; x += 64) {
    edge(g, '#171f29', .85, x + 17, 105, x + 1, 148)
    edge(g, '#6f878849', .55, x + 18, 106, x + 2, 147)
  }
  for (const x of [98, 338, 578, 818]) {
    const lit = g.createRadialGradient(x, 114, 0, x, 114, 37)
    lit.addColorStop(0, '#c6aa7552'); lit.addColorStop(.45, '#bca87625'); lit.addColorStop(1, '#9b8b5a00')
    slab(g, lit, x - 37, 105, 74, 39)
    slab(g, '#172730', x - 23, 141, 42, 3)
    for (let j = 0; j < 9; j++) slab(g, '#536365a1', x - 22 + j * 4.5, 142, 2, 1)
    // Little stair opening rather than a line of cars.
    face(g, '#c4ac7762', x + 54, 124, x + 58, 124, x + 52, 144, x + 48, 144)
    face(g, '#c4ac7762', x + 63, 124, x + 67, 124, x + 61, 144, x + 57, 144)
  }
  for (let x = 7; x < w - 20; x += 80) {
    slab(g, '#293c46', x, 158, 20, 16)
    slab(g, '#4a5f648f', x + 1, 158, 18, 1)
    for (let j = x + 3; j < x + 18; j += 3) slab(g, '#0d1c23', j, 162, 1, 9)
  }
}

export const PIER_L = -96, PIER_R = 124, PIER_TOP = ROAD.soffit - 7, PIER_BOTTOM = Math.ceil(STREET_FRONT_Y + 8)
/** Local bearing, conduits and fixed maintenance light. All grade/bolts are
 * reusable for every support; the chunk owns only its X address. */
export function paintUndersidePier(g: ArtPen): void {
  const y = STREET_FRONT_Y
  face(g, '#34424b', -91, 76, 109, 76, 79, 113, 4, 113)
  face(g, '#21303a', -83, 83, 100, 83, 72, 108, 12, 108)
  edge(g, '#a2aa9e70', 1.2, -81, 83, 12, 108)
  face(g, ramp(g, 5, 0, 99, 0, '#44545d', '#35444c', '#26343e'), 5, 88, 99, 88, 78, y - 2, 12, y - 2)
  face(g, '#17222c', 99, 88, 119, 80, 98, y - 7, 78, y - 2)
  slab(g, '#0f1922', -1, 80, 103, 12)
  slab(g, '#627378a0', -1, 85, 101, 1.2)
  face(g, '#50605f', -12, y, 11, y - 8, 95, y - 8, 109, y)
  slab(g, '#253640', -12, y, 121, 7)
  slab(g, '#94a09171', -9, y, 115, .95)
  edge(g, '#101d24', 3.4, 9, 90, 28, 109, 31, y - 8)
  edge(g, '#7e92946e', .8, 10, 89, 29, 109, 32, y - 8)
  slab(g, '#282b2b', 39, 102, 31, 7)
  slab(g, '#d4a771', 42, 107, 25, 1.6)
  slab(g, ramp(g, 0, 108, 0, 126, '#d0a77438', '#a28b5d00'), 39, 109, 30, 16)
  for (const x of [13, 79]) slab(g, '#82908a88', x, 92, 2.2, 2.2)
}
