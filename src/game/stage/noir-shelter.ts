import { box, edge, face, paintFastener, ramp, slab, type ArtPen } from './bridge-paint'
import { concourseShop } from './bridge-shop-layout'
import { paintShopFront } from './bridge-shop-art'
import { bridgeHash, deckShear } from './bridge-material'
import { ROAD } from './road-section'
import { SHELTER_KIT, type ShelterKind } from './run-layout'

/** Albedo and transmitted interior. The pane radiance is composed separately. */
export function paintNoirShelter(g: ArtPen, kind: ShelterKind, top: number): void {
  const kit = SHELTER_KIT[kind], w = kit.width, e = kit.eaveY, r = kit.ridgeY, service = kind === 'service'
  g.save(); g.translate(0, -top)
  slab(g, ramp(g, 0, e, 0, ROAD.rear, '#22292d', '#3c4140', '#272d2e'), 7, e, w - 14, ROAD.rear - e)
  const panelY = e + 53, panelH = ROAD.rear - 18 - panelY
  if (service) {
    box(g, 29, panelY, w - 66, panelH, '#302f2c', '#5a554b', '#181b1d', 7, -6)
    for (let y = panelY + 4; y < ROAD.rear - 20; y += 5.9) {
      slab(g, '#1c1e21', 30, y, w - 68, 2.1)
      slab(g, '#81745c36', 32, y + 2.4, w - 74, .9)
    }
    slab(g, '#544c42', 38, panelY + 16, 11, 26)
    slab(g, '#9e8160', 40, panelY + 21, 7, 2)
    slab(g, '#141619', w - 48, panelY + 8, 14, panelH - 7)
  } else paintShopFront(g, concourseShop)
  // Bench corner and joint hardware. Seam dirt belongs beneath the frame.
  slab(g, '#0e1215', 11, ROAD.rear - 16, w - 23, 15)
  if (!service) {
    box(g, 40, -100, 58, 10, '#313232', '#565047', '#202122', 7, -4)
    for (const x of [45, 88]) slab(g, '#191b1c', x, -90, 5, 22)
  }
  for (const x of [5, w - 19]) {
    box(g, x, e + 8, 13, 43 - e - 8, '#252728', '#575851', '#101315', 5, -3)
    slab(g, '#65646281', x + 1.2, e + 10, 1.1, 37 - e)
    for (let i = 0, y = e + 26; y < 43; i++, y += 42) paintFastener(g, x + 6, y, 1.85, bridgeHash(x, i, 987))
  }
  // Ribbed zinc on the inclined roof. Rain tracks run downhill from bolts.
  const a = service ? 23 : 34, b = w - (service ? 29 : 38)
  face(g, ramp(g, 0, r, 0, e, '#484a49', '#343739', '#25282a'), a, r, b, r, w, e, 0, e)
  const folds = service ? 11 : 13
  for (let i = 0; i < folds; i++) {
    const x = a + (b - a) * i / folds, end = w * i / folds
    edge(g, '#10121588', 2.8, x + .8, r + 1, end + 1.2, e - 4)
    edge(g, '#99998c49', .8, x + 2, r + 1, end + 2.9, e - 4)
    for (let j = 0; j < 23; j++) {
      const ry = bridgeHash(i, j, 96), rx = bridgeHash(i, j, 102), p = x + ry * (end - x)
      slab(g, j % 6 ? '#10121534' : '#a6987b2b', p + 5 + rx * 8, r + 2 + (e - r - 10) * ry, .6 + rx * 2, 1 + rx * 4)
    }
  }
  face(g, '#565754', 0, e - 5, w, e - 5, w, e + 3, 0, e + 3)
  slab(g, '#171a1d', 0, e + 3, w, 13)
  slab(g, '#a299877f', 0, e - 5, w, 1.1)
  for (let i = 0, x = 14; x < w - 10; i++, x += 35) paintFastener(g, x, e - 1.8, 1.55, bridgeHash(i, w, 77))
  const label = service ? 'SERVICE BAY' : 'METRO LINK'
  g.textAlign = 'center'; g.font = `600 ${service ? 13 : 16}px monospace`; g.fillStyle = '#b4aa94'
  g.fillText(label, w * .51, e - (service ? 22 : 32))
  g.font = '8px monospace'; g.fillStyle = '#a8a29585'
  g.fillText(service ? 'MAINTENANCE • AUTHORIZED ACCESS' : 'NORTH LOOP / PLATFORM 02', w * .51, e - (service ? 12 : 20))
  const lx = kit.lampX, ly = kit.lampY
  box(g, lx - 21, ly - 10, 42, 9, '#242524', '#656451', '#151616', 5, -2)
  slab(g, service ? '#cda474' : '#beb09c', lx - 18, ly - 2, 35, 2.2)
  slab(g, service ? '#edcfa8' : '#dbd3c2', lx - 14, ly, 27, 1.1)
  // Matte paving, not a rectangular tint over road. Rear tread splits at joints.
  slab(g, ramp(g, 0, ROAD.rear, 0, ROAD.front, '#31312e', '#454541', '#2c3435'), 0, ROAD.rear, w, ROAD.front - ROAD.rear)
  const rows = [ROAD.rear, -36, -13, 14, 41, ROAD.front]
  g.save(); g.beginPath(); g.rect(0, ROAD.rear, w, ROAD.front - ROAD.rear); g.clip()
  for (let j = 0; j < rows.length - 1; j++) {
    const y = rows[j], next = rows[j + 1], skew = deckShear(y), nextSkew = deckShear(next)
    for (let i = 0, x = -58 + j % 2 * 26; x < w + 22; i++, x += 53) {
      const a = x + skew, b = x + nextSkew, tone = bridgeHash(i, j, w)
      face(g, tone < .40 ? '#24282932' : tone < .72 ? '#9d927725' : '#6a746d2d',
        a + 1, y, a + 52, y, b + 52, next - 1, b + 1, next - 1)
      edge(g, '#171c1e9d', .88, a, y, b, next - 1)
      edge(g, '#a19a8041', .69, a + 1.3, y + 1, b + 1.3, next - 1)
    }
    if (j > 0) {
      slab(g, '#12161a82', 0, y - .8, w, 1.3)
      slab(g, '#a09a8652', 0, y + .57, w, .68)
    }
  }
  for (let i = 0; i < 310; i++) {
    const x = bridgeHash(i, 6, w) * w, y = ROAD.rear + bridgeHash(i, 8, w) * (ROAD.front - ROAD.rear)
    slab(g, i % 4 ? '#161b1b72' : '#aeaa9267', x, y, .6 + bridgeHash(i, 1) * 2.9, .8)
  }
  g.restore()
  for (const x of [5, w - 19]) {
    slab(g, '#101215', x - 2, 37, 21, 8)
    slab(g, '#393a36', x - 1, 37, 19, 1.1)
  }
  g.restore()
}
