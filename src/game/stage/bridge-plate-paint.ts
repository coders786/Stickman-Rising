import { DECK_WIRE, DISTRICT_ACCENT, DISTRICT_PANEL, GUIDE_LENS_Y, deckGuideSocket, fillLampSocket, lampHealth } from './bridge-sockets'
import { box, paintBridgeCatwalk, paintBridgeDeck, paintBridgeDistrict, ramp } from './bridge-art'
import { chunkLightData } from '../../graphics/bridge/NoirGeometry'
import { ROAD } from './road-section'
import { sectorAt, type BridgeRoute, type RouteChunk, type RouteShelter } from './route'
import { SHELTER_KIT } from './run-layout'
import type { ViewBounds } from '../world/exposed-weather'

export const WET_SIGN_COLOR = '#514b3d'
export const PLATE_BOTTOM = ROAD.soffit + 2
const MAST_TOP = DECK_WIRE.y - 13 - 3
export const PLATE_GUARD = 2 // retain the reconstruction footprint at a rolled/fractional edge
/** World-aligned paint bounds, independent of the optical atlas's height.
 * Keep the empty rows above the roof/fixture out of every bitmap/readback. */
export function chunkPlateTop(c: RouteChunk): number {
  if (c.shelter) return Math.min(MAST_TOP, SHELTER_KIT[c.shelter.kind].ridgeY) - PLATE_GUARD
  const panel = DISTRICT_PANEL[c.visualBand]
  // Sky Garden's tallest roof plant includes the planter, 24px stems and leaves.
  return Math.min(MAST_TOP, panel.top + panel.returnY, c.visualBand === 2 ? panel.top - 56 : Infinity) - PLATE_GUARD
}

export function visiblePlateIndices(route: BridgeRoute, view: ViewBounds, out: number[]): number[] {
  out.length = 0
  if (view.top >= PLATE_BOTTOM + PLATE_GUARD) return out
  for (const c of route.between(view.left - PLATE_GUARD, view.right + PLATE_GUARD)) {
    if (view.bottom > chunkPlateTop(c) - PLATE_GUARD) out.push(c.index)
  }
  return out
}

type Painter = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function line(g: Painter, color: string, width: number, x: number, y: number, tx: number, ty: number): void {
  g.strokeStyle = color; g.lineWidth = width
  g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke()
}
function solid(g: Painter, fill: string | CanvasGradient, x: number, y: number, w: number, h: number): void {
  g.fillStyle = fill; g.fillRect(x, y, w, h)
}

function paintWetSign(g: Painter, x: number, sector: number): void {
  solid(g, '#262a2b', x - 41, -160, 6, 93)
  solid(g, '#676252', x - 41, -160, 1.2, 93)
  box(g, x - 60, -180, 121, 41, '#292d2b', '#7e7766', '#222528', 8, -4)
  solid(g, WET_SIGN_COLOR, x - 58, -177, 116, 36)
  solid(g, '#87826d69', x - 56, -176, 112, 1)
  solid(g, '#302c27', x + 48, -166, 8, 14)
  g.textAlign = 'left'; g.font = '600 14px monospace'; g.fillStyle = '#bdb49b'
  g.fillText('WET ROAD', x - 46, -158)
  g.font = '8px monospace'; g.fillStyle = '#a59a83'
  g.fillText(`CAUTION / ${String(sector + 1).padStart(2, '0')}`, x - 45, -147)
}

function drawTerminal(g: Painter, shelter: RouteShelter): void {
  if (shelter.kind !== 'service') return
  const x = shelter.terminal
  solid(g, '#302723', x - 13, -104, 27, 55)
  box(g, x - 18, -109, 38, 30, '#5d584b', '#9b9577', '#263137', 8, -5)
  solid(g, '#181b20', x - 15, -106, 32, 24)
  solid(g, '#d5b27e', x - 11, -102, 24, 2)
  solid(g, '#78654e', x - 11, -96, 15, 2)
  solid(g, '#8b7655', x - 11, -91, 20, 2)
  solid(g, '#998264', x - 19, -56, 41, 4)
}

/** One sequential milepost on every authored chunk; phase or biome never
 * resets the number and backtracking never consumes another sign. */
export function paintTransitSign(g: Painter, c: RouteChunk): void {
  g.textAlign = 'left'; g.font = 'bold 10px monospace'; g.fillStyle = '#828478ad'
  g.fillText(`CITY LINK / ${String(c.index + 1).padStart(3, '0')}`, 73, 33)
}

export function paintChunk(g: Painter, c: RouteChunk, stamp?: { sprite: CanvasImageSource; y: number }): void {
  const w = c.right - c.left, biome = c.visualBand, lamp = c.lamp - c.left
  g.save(); g.translate(-c.left, 0)
  paintBridgeDeck(g, c.left, c.right, c)
  g.restore()
  paintTransitSign(g, c)
  line(g, '#83969d33', 1.1, 63, 40, 225, 40)
  if (c.wetSign !== null) {
    const x = c.wetSign - c.left
    paintWetSign(g, x, sectorAt(c.wetSign))
  }
  paintBridgeDistrict(g, c)
  paintBridgeCatwalk(g, c)
  const pair = fillLampSocket(c), live = lampHealth(c) > .20
  const pole = (p: number, off: number) => {
    const mast = off < 0 ? DECK_WIRE.y - 13 : -223
    const cap = DISTRICT_ACCENT[biome]
    if (off < 0) {
      box(g, p - 1, mast, 7, -219 - mast, '#354c55', '#708b8f', '#20333e', 4, -3)
      box(g, p + DECK_WIRE.x - 4, DECK_WIRE.y - 4, 8, 8, '#a4b5ad', '#bcc8b2', '#5d746c', 2, -1)
      solid(g, '#3d565a', p + DECK_WIRE.x - 4, DECK_WIRE.y - 1, 8, 1.6)
    }
    box(g, p - 1, -223, 7, 166, ramp(g, p - 1, 0, p + 6, 0, '#57717d', '#233742'), '#799598', '#18242f', 4, -3)
    box(g, p + off - 16, -229, 35, 10, '#334a55', '#869997', '#273944', 7, -5)
    solid(g, !live ? '#5b5348' : cap, p + off - 11, -220, 23, 2.7)
    solid(g, !live ? '#75695c' : biome === 2 ? '#bfc8cb' : '#e1c3a0', p + off - 6, -220, 12, 1.5)
    box(g, p - 7, DECK_WIRE.foot - 5, 22, 7, '#2a3a43', '#718083', '#12252e', 6, -3)
  }
  pole(lamp, -15); if (pair !== null) pole(pair - c.left, 15)
  const way = deckGuideSocket(c) - c.left, ly = GUIDE_LENS_Y
  box(g, way - 12, ly - 7, 24, 19, '#253b48', '#637e88', '#162a36', 6, -3)
  solid(g, DISTRICT_ACCENT[biome], way - 9, ly - 1.4, 18, 2.8)
  solid(g, '#aec2bb6e', way - 9, ly + 3, 6, 1)
  line(g, DISTRICT_ACCENT[biome] + '80', 1, way - 29, -59, way + 29, -59)
  const b = chunkLightData(c).blockers.find(b => b.kind === 'parapet')
  if (b) {
    const l = b.left - c.left
    box(g, l, b.top, b.right - b.left, b.bottom - b.top, '#292a2c', '#626158', '#141719', 8, -6)
    solid(g, '#a2987e73', l + 2, b.top + 1.2, b.right - b.left - 4, 1.4)
  }
  if (c.shelter && stamp ) {
    const s = c.shelter
    g.drawImage(stamp.sprite, s.left - c.left, stamp.y)
    if (s.kind === 'service') {
      g.save(); g.translate(-c.left, 0); drawTerminal(g, s); g.restore()
    }
    g.textAlign = 'center'; g.font = 'bold 10px monospace'; g.fillStyle = '#988e79'
    g.fillText(`SHELTER ${String(s.id).padStart(2, '0')}`, s.terminal - c.left, s.kind === 'service' ? -119 : -57)
  }
}
