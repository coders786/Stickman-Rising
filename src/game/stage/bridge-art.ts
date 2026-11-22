import { DISTRICT_ACCENT, DISTRICT_PANEL, districtSocket } from './bridge-sockets'
import { CARGO_DECK, CATWALK_DECK, deckTopPath } from './bridge-deck-face'
import { bridgeHash, deckShear, PUDDLE_PITCH } from './bridge-material'
import { ROAD, ROAD_PLATE_TOP } from './road-section'
import { BRIDGE_PUDDLE_RUNS } from './bridge-puddle-runs'
import type { RouteChunk } from './route'

import { box, edge, face, paintFastener, ramp, slab, type ArtPen } from './bridge-paint'
import { bridgeShop } from './bridge-shop-layout'
import { paintShopFront } from './bridge-shop-art'
import { paintLaneDashes, paintWearingCourse } from './bridge-wearing-course'

export { box, edge, face, ramp, slab, type ArtPen } from './bridge-paint'

/** A first Canvas frame only walks 234 compact rectangles, not the entire
 * 213k-texel procedural mask. Live seed changes its origin, not its shape. */
export function puddlePath(g: ArtPen, left: number, right: number, offset = 0): void {
  const run = BRIDGE_PUDDLE_RUNS
  g.beginPath()
  for (let tile = Math.floor((left + offset) / PUDDLE_PITCH) * PUDDLE_PITCH - offset; tile < right; tile += PUDDLE_PITCH) {
    for (let i = 0; i < run.length; i += 4) {
      const a = Math.max(left, tile + run[i]), b = Math.min(right, tile + run[i] + run[i + 2])
      if (b > a) g.rect(a, run[i + 1], b - a, run[i + 3])
    }
  }
}

/** Baked oblique section: far utility walk, tarred wearing course, near
 * drainage channel, two girder faces. Sheared seams vanish toward the rail.
 * Everything is authored in world coords, so chunk edges line up under roll. */
export function paintBridgeDeck(g: ArtPen, l: number, r: number, chunk?: RouteChunk): void {
  const width = r - l
  const base = ramp(g, 0, ROAD.rear, 0, ROAD.front, '#202731', '#2e363c', '#1e272e')
  slab(g, base, l, ROAD_PLATE_TOP, width, ROAD.soffit - ROAD_PLATE_TOP)
  paintWearingCourse(g, l, r, !!chunk)
  slab(g, ramp(g, 0, -77, 0, -51, '#111418', '#35383b', '#1a1e23'), l, -77, width, 26)
  slab(g, '#8486854e', l, -66, width, 1.1)
  slab(g, '#9bb6b67b', l, -57, width, 1.15)
  slab(g, '#627b814a', l, -61, width, 1)
  slab(g, '#081219d4', l, -54, width, 5)
  slab(g, '#121c2385', l, 44, width, 7)
  slab(g, '#83919153', l, 49, width, 1.1)
  slab(g, '#9c9e966d', l, ROAD.front, width, 1.6)
  slab(g, ramp(g, 0, 53, 0, ROAD.soffit, '#4e5353', '#3a3d3e', '#202528', '#111619'), l, 53, width, ROAD.soffit - 53)
  slab(g, '#172024', l, 60, width, 5)
  slab(g, '#a2aba969', l, 65, width, 1.15)
  slab(g, chunk ? DISTRICT_ACCENT[chunk.visualBand] + '50' : '#8acdd050', l, 61, width, .85)
  slab(g, '#282d30', l, 76, width, 5)
  slab(g, '#080f16', l, 81, width, 3)

  const wear = 56, first = Math.floor(l / wear) - 1, last = Math.ceil(r / wear) + 1
  for (let i = first; i <= last; i++) {
    const wx = i * wear
    if (i % 3 === 0) {
      const far = wx + deckShear(ROAD.rear), near = wx + deckShear(ROAD.front)
      const expansion = i % 9 === 0, v = bridgeHash(i, 72)
      edge(g, expansion ? '#101719ab' : '#20242558', expansion ? 2 : 1.15, far, ROAD.rear,
        wx + 1.5 * v, -6, near, ROAD.front)
      edge(g, '#938f7753', .7, far + 1.8, ROAD.rear + .45, near + 1.9, ROAD.front - .5)
      slab(g, '#12191e', wx - 27, 59, 5, 21)
      slab(g, '#8c938b63', wx - 26, 67, 1.15, 10)
      slab(g, i % 2 === 0 ? '#a6986cba' : '#a1aea98c', wx - 3, 71, 16, 1.8)
      if (chunk) {
        paintFastener(g, wx - 20, 68.5, 2.25, v)
        paintFastener(g, wx - 20, 76, 2.1, v * .84)
      }
    }
    if (i % 2 === 1) {
      // Recessed drain covers: metal frame, dark vents, wiped outer lip.
      const x = wx - 21
      face(g, '#1a2224', x - 1, 38.3, x + 26.5, 38.3, x + 22.4, 46.6, x - 4.8, 46.6)
      face(g, '#090e10', x, 39, x + 25.7, 39, x + 22, 46, x - 4, 46)
      edge(g, '#afb2a075', .79, x + .6, 38.3, x + 26, 38.3)
      for (let j = 0; j < 6; j++) edge(g, '#79817b88', 1.05, x + 2 + j * 4, 39.9, x - 1 + j * 4, 45)
    }
  }
  paintLaneDashes(g, l, r, !!chunk)

  // Finite art still has its own stylized wet finish; on the route the
  // water mask is material data, never a stamped oval in the source plate.
  if (!chunk) {
    g.save(); puddlePath(g, l, r); g.clip()
    for (let y = ROAD.rear; y < ROAD.front; y += 3) slab(g, `rgba(67,72,76,${.16 + .04 * Math.cos(y * .52)})`, l, y, width, 2.5)
    g.restore()
  }

  // Far rail receives visible light on its upper face. The foreground rail is
  // the girder cap, not a high occluder painted in front of the player.
  slab(g, '#111f29', l, -91, width, 5)
  slab(g, '#647079', l, -91, width, 1.35)
  slab(g, '#363a3b', l, -75, width, 2)
  for (let i = first; i < last; i++) {
    const x = i * wear
    box(g, x, -91, 3.7, 20, '#343c3e', '#7b8787', '#191f22', 3.8, -2.2)
    if (i % 2 === 0) {
      slab(g, '#1f2525bc', x - 4.1, -75.5, 13.4, 2)
      slab(g, '#b2a176b9', x - 1.2, -77, 6, 2.1)
      if (chunk) paintFastener(g, x + 2.4, -71.8, 1.36, bridgeHash(i, 17, 826))
    }
  }
}

export function paintBridgeCatwalk(g: ArtPen, chunk: RouteChunk): void {
  const p = chunk.platform
  if (!p) return
  const l = p.left - chunk.left, r = p.right - chunk.left, w = r - l, y = p.y
  const cat = chunk.role === 'catwalk'
  if (cat) {
    for (const x of [l + 22, r - 30]) {
      box(g, x, y - 53, 12, -52 - y + 53, '#282b2d', '#5d6266', '#11161a', 7, -4)
      slab(g, '#74797878', x + 1, y - 43, 1.3, -58 - y + 43)
      box(g, x - 7, -59, 26, 6, '#303c43', '#718084', '#162329', 6, -3)
    }
    const back = l + 22
    edge(g, '#4c626a', 2.4, back, y - 43, r + 15, y - 43)
    edge(g, '#7b887d', .9, back, y - 43.8, r + 15, y - 43.8)
    for (let x = back; x < r + 17; x += 38) edge(g, '#46585b', 2.8, x, y - 43, x, y - 14)
    const { thickness, returnX, returnY } = CATWALK_DECK
    box(g, l, y, w, thickness, ramp(g, 0, y, 0, y + thickness, '#34383b', '#11151b', '#292e32'), '#444c53', '#20242a', returnX, returnY)
    for (let x = l; x < r - 14; x += 27) {
      face(g, '#07151c', x + 1, y + 4, Math.min(r - 2, x + 24), y + 4, x + 11, y + 16)
      edge(g, '#83918b78', .85, x + 1.5, y + 3.6, Math.min(r - 2, x + 24), y + 3.6)
      paintFastener(g, x + 4.9, y + 18.8, 1.82, bridgeHash(Math.floor(x), chunk.seed, 471))
    }
    g.save(); g.beginPath(); deckTopPath(g, { left: l, right: r, y }, CATWALK_DECK); g.fillStyle = '#3b4145'; g.fill(); g.clip()
    for (let x = l - 26; x < r + 32; x += 7) edge(g, '#141f26', 1.7, x, y, x + 23, y - 14)
    for (let dy = -12; dy < 0; dy += 3) edge(g, '#a1b4b667', .7, l, y + dy, r + 24, y + dy)
    g.restore()
    slab(g, '#6f767b', l, y, w, 1.15)
    // Recessed inspection strip grazes the bottom 14u, not the full span.
    slab(g, '#777b75', l + 18, y + thickness - 2, w - 36, 1.2)
    slab(g, '#111419', l + 10, y + thickness + .15, w - 21, 2.45)
    slab(g, '#d7c084', l + 8, y + 2, 31, 1.3); slab(g, '#d7c084', r - 40, y + 2, 31, 1.3)
  } else {
    box(g, l, y, w, -51 - y, ramp(g, 0, y, 0, -51, '#47575d', '#293a44', '#1c2732'), '#657a7d', '#23303a', CARGO_DECK.returnX, CARGO_DECK.returnY)
    for (let x = l + 9; x < r - 42; x += 13) {
      face(g, '#1a2633', x, y + 5, x + 5, y + 7, x + 5, -58, x, -55)
      slab(g, '#81949983', x + 5, y + 7, 1, -65 - y)
    }
    box(g, r - 50, y + 5, 42, -62 - y, '#1e3039', '#4c6769', '#16232f', 3, -2)
    slab(g, '#a49d78', r - 38, y + 10, 1.3, -66 - y)
    slab(g, '#a49d78', r - 22, y + 10, 1.3, -66 - y)
    slab(g, '#adc0bc', l + 1, y + .3, w - 1, 1.3)
  }
  g.textAlign = 'right'; g.font = 'bold 9px monospace'; g.fillStyle = '#a9b2ac'
  g.fillText(cat ? 'SKYWALK / PEDESTRIANS' : 'METRO ACCESS / KEEP CLEAR', r - (cat ? 13 : 54), y + (cat ? 15 : 21))
}

export function paintBridgeDistrict(g: ArtPen, chunk: RouteChunk, detail = true): void {
  if (chunk.shelter) return
  const biome = chunk.visualBand, panel = DISTRICT_PANEL[biome], accent = DISTRICT_ACCENT[biome]
  const x = districtSocket(chunk) - chunk.left
  const l = x + panel.left, r = x + panel.right, w = r - l, top = panel.top, bottom = panel.bottom
  const roof = biome === 1 ? '#727c75' : '#738b8c', rib = biome === 1 ? '#b3a68a66' : '#a6b2a269'
  const casing = biome === 1 ? '#4e4e4b' : '#4e6164'
  box(g, l, top, w, bottom - top, ramp(g, 0, top, 0, bottom, casing, '#293743', '#1b2933'), roof, '#253741', panel.returnX, panel.returnY)
  if (detail) {
    for (let px = l + 11, i = 0; px < r - 6; px += 19, i++) {
      const dx = panel.returnX, dy = panel.returnY, tarnish = bridgeHash(i, chunk.seed, 73)
      edge(g, '#303c415f', .94, px, top - .25, px + dx - .6, top + dy + .3)
      edge(g, rib, .62, px + 1.3, top - .35, px + dx + .9, top + dy + .6)
      slab(g, '#1829305c', px + .8, top + 1, .8 + 1.4 * tarnish, 2 + tarnish * 5)
      if (i % 2 === 0) paintFastener(g, px + 1.8, top - 1.7, 1.4, tarnish)
    }
    edge(g, '#80959764', .86, r + 6, top - 2, r + 6, bottom - 4)
    edge(g, '#131e25a1', 1.7, r + 8, top - 3, r + 8, bottom - 4)
  }
  g.save(); g.translate(x, 0); paintShopFront(g, bridgeShop(chunk)!, detail); g.restore()
  const fascia = top + 28
  box(g, l - 6, fascia, w + 6, 9, '#354957', '#708884', '#25323e', 13, -6)
  slab(g, accent + 'ae', l + 10, fascia + 8.8, w - 20, 1.3)
  slab(g, '#101c28', l + 9, top + 5, w - 17, 19)
  slab(g, '#7790866b', l + 10, top + 5, w - 19, 1)
  if (detail) for (const px of [l + 12, r - 14]) {
    slab(g, '#94a59883', px, top + 8, 1.45, 1.45)
    slab(g, '#43545a', px, top + 20, 1.4, 1.4)
  }
  g.fillStyle = accent; g.textAlign = 'center'; g.font = 'bold 13px sans-serif'
  g.fillText(panel.sign, (l + r) * .5, top + 18.5)
  if (biome === 2 && detail) {
    const a = r - 100
    box(g, a, top - 21, 90, 20, '#32494b', '#789287', '#293b44', 12, -7)
    for (let j = 0; j < 5; j++) {
      const xx = a + 9 + j * 18, h = 8 + bridgeHash(j, chunk.seed) * 16, yy = top - 22 - h
      edge(g, '#526b59', 1.25, xx - 1.5, top - 22, xx + .5, yy + 2)
      for (let k = 0; k < 3; k++) {
        g.fillStyle = k === 1 ? '#557b67' : '#3d6457'; g.beginPath()
        g.ellipse(xx + (k - 1) * 3.4, yy + 4 + (k % 2 ? 0 : 4.2), 4.3, h * .37, (k - 1) * .38, 0, Math.PI * 2); g.fill()
      }
      slab(g, '#65877a', xx - 5.8, top - 23, 11.6, 3.4)
    }
    slab(g, '#91b4987d', a + 4, top - 20, 78, 1.5)
  }
}

/** Relief and rivets for the running-shelter kit. Geometry lies within the
 * eave window; decorative returns never extend the safe or dry region. */
export function paintBridgeRecess(g: ArtPen, w: number, roof: number, rear: number, service: boolean): void {
  const y = roof + 57, h = rear - y - 22
  box(g, 27, y, w - 63, h, ramp(g, 0, y, 0, y + h, '#151b22', service ? '#4c493e' : '#324a53', '#1b252b'), '#827c65', '#1b2930', 12, -7)
  if (service) for (let dy = y + 7; dy < y + h - 5; dy += 5) {
    slab(g, '#171a20a8', 32, dy, w - 73, 1.5)
    slab(g, '#b7a48a5c', 32, dy + 1.6, w - 73, 1)
  }
  else for (let x = 40; x < w - 45; x += (w - 65) / 5) {
    slab(g, '#0f222bcc', x - 3, y + 3, 4.4, h - 4)
    face(g, '#9ec0c12a', x + 7, y + 6, x + 17, y + 6, x + 34, y + h - 3, x + 24, y + h - 3)
  }
  for (const x of [10, w - 27]) {
    box(g, x, roof + 7, 14, rear - roof - 9, ramp(g, x, 0, x + 14, 0, '#5e6c6e', '#283942'), '#91a2a2', '#17252d', 8, -5)
    for (let yy = roof + 18; yy < rear; yy += 27) slab(g, '#b4b4a2', x + 3, yy, 2.3, 2.3)
  }
  face(g, '#151b277d', 12, roof + 10, w - 9, roof + 10, w - 23, roof + 46, 19, roof + 46)
  slab(g, '#a1b3aa6a', 11, roof + 15, w - 25, 1)
  // Depth cue along the eave, retaining the original readable fascia.
  face(g, '#0e1b2599', 2, roof + 3, 23, roof + 14, w - 10, roof + 14, w - 1, roof + 3)
  const steer = g.createLinearGradient(0, rear - 15, 0, rear)
  steer.addColorStop(0, '#141c2600'); steer.addColorStop(1, '#0b151cc7')
  slab(g, steer, 0, rear - 15, w, 15)
}
