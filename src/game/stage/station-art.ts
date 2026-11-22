import { materialRamp, paintPlaneTone, type DeckFinish, type MaterialFace, type PlaneTone } from './baked-finish'
import { ROAD } from './road-section'

/** Dry station study. These painters only populate the existing band/span
 * targets. The arena camera, contact line, fixture mounts and draw order are
 * the same as the viaduct's. */
export const STATION_VOID = '#18252e'
const TRUSS: MaterialFace = { light: '#52666a', body: '#293a42', shade: '#16242c', falloff: .23 }
const STONE: MaterialFace = { light: '#536668', body: '#3b5054', shade: '#23343b', falloff: .68 }

type Band = 'deep' | 'far' | 'mid' | 'near'

function archOpening(g: CanvasRenderingContext2D, a: number, b: number, bottom: number, spring: number, head: number): void {
  g.moveTo(a, bottom)
  g.lineTo(a, spring)
  g.bezierCurveTo(a, head, b, head, b, spring)
  g.lineTo(b, bottom)
  g.closePath()
}

/** Punch the open bays out of the mass, not tinted boxes on top of it. */
function arches(g: CanvasRenderingContext2D, w: number, bottom: number, bays: number, head: number, spring: number, pier: number): void {
  const step = w / bays
  g.beginPath()
  g.rect(0, 0, w, bottom)
  for (let x = 0; x < w; x += step) archOpening(g, x + pier, x + step - pier, bottom, spring, head)
  g.fill('evenodd')
}

export function paintStationBand(g: CanvasRenderingContext2D, w: number, h: number, band: Band, tone: PlaneTone): void {
  if (band === 'deep') {
    const wall = g.createLinearGradient(0, 0, 0, h)
    wall.addColorStop(0, STATION_VOID)
    wall.addColorStop(.38, '#243640')
    wall.addColorStop(1, '#3a4c51')
    g.fillStyle = wall
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#31434a'
    for (let y = 104; y < h; y += 40) g.fillRect(0, y, w, 2)
  } else if (band === 'far') {
    // Through the structural bays: low-contrast service portals and glass.
    g.fillStyle = '#3f5459'
    for (let x = 32; x < w; x += w / 8) g.fillRect(x, h - 281, 174, 116)
    g.fillStyle = '#23363f'
    for (let x = 36; x < w; x += w / 8) g.fillRect(x, h - 276, 166, 106)
    g.fillStyle = '#637674'
    for (let x = 55; x < w; x += w / 8) g.fillRect(x, h - 264, 60, 3)
    g.fillStyle = '#997751'
    g.fillRect(w * .21, h - 281, 22, 5)
    g.fillRect(w * .71, h - 281, 22, 5)
  } else if (band === 'mid') {
    g.fillStyle = materialRamp(g, 0, 123, 0, h, STONE)
    arches(g, w, h - 28, 4, 169, 311, 24)
    // Quiet, dark base behind the upper bodies; the contrast is in the arch
    // openings, not a bright horizontal line through the fighters.
    g.fillStyle = materialRamp(g, 0, h - 119, 0, h, { light: '#43575a', body: '#304549', shade: '#24363d', falloff: .55 })
    g.fillRect(0, h - 119, w, 119)
    g.fillStyle = '#26393e'
    g.fillRect(0, h - 119, w, 2)
    for (let x = 26; x < w; x += w / 16) g.fillRect(x, h - 115, 1, 74)
  } else {
    // One definite silhouette in front of the soft, smaller structures.
    g.fillStyle = materialRamp(g, 0, 0, 0, h, TRUSS)
    arches(g, w, h - 5, 4, 106, 236, 19)
    // A reveal is the stone between two nested apertures. Feather into the
    // pier so the highlight reads as thickness, not an outlined arch.
    const reveal = g.createLinearGradient(0, 116, 0, 274)
    reveal.addColorStop(0, 'rgba(124,151,153,.37)')
    reveal.addColorStop(.47, 'rgba(124,151,153,.19)')
    reveal.addColorStop(1, 'rgba(124,151,153,0)')
    g.fillStyle = reveal
    g.beginPath()
    const step = w / 4
    for (let x = 0; x < w; x += step) {
      archOpening(g, x + 12, x + step - 12, h - 5, 236, 98)
      archOpening(g, x + 19, x + step - 19, h - 5, 236, 106)
    }
    g.fill('evenodd')
    g.fillStyle = '#202e36'
    for (let x = 0; x < w; x += w / 4) g.fillRect(x + 9, 236, 10, h - 242)
    g.fillStyle = '#657477'
    for (let x = 0; x < w; x += w / 4) g.fillRect(x + 7, 237, 2, h - 243)
    g.fillStyle = '#1b2a30'
    for (let x = 0; x < w; x += w / 4) g.fillRect(x + 3, h - 15, 23, 10)
    g.fillStyle = '#344950'
    g.fillRect(0, 80, w, 11)
    g.fillStyle = '#596965'
    g.fillRect(0, 81, w, 2)
    // Glazed tiles on the service enclosure, not an illuminated billboard.
    g.textAlign = 'center'
    g.font = 'bold 16px monospace'
    for (let x = 0, n = 1; x < w; x += w / 4, n++) {
      g.fillStyle = '#1e3136'; g.fillRect(x + 31, 207, 34, 26)
      g.fillStyle = '#90a6a5'; g.fillText(`0${n}`, x + 48, 226)
    }
  }
  paintPlaneTone(g, w, h, tone)
}

/** Below the platform. Tile pitches divide the section's repeat interval. */
export function paintStationRecess(g: CanvasRenderingContext2D, w: number, h: number, tone: PlaneTone): void {
  g.fillStyle = '#15232b'
  g.fillRect(0, 0, w, h)
  // Alternating pier faces behind the rail, not a gloss or another parallax
  // tile. Widths and row pitches divide the repeat; only the top has AO.
  for (let x = 0; x < w; x += 256) {
    const pier = g.createLinearGradient(x, 0, x + 256, 0)
    pier.addColorStop(0, '#18272f')
    pier.addColorStop(.13, '#28383e')
    pier.addColorStop(.34, '#1e2f36')
    pier.addColorStop(.92, '#14212a')
    pier.addColorStop(1, '#18272f')
    g.fillStyle = pier
    g.fillRect(x, 0, 256, h)
  }
  g.fillStyle = '#101d25'
  for (let y = 0; y < h; y += 24) g.fillRect(0, y, w, 2)
  g.fillStyle = 'rgba(111,143,148,.11)'
  for (let y = 2; y < h; y += 24) g.fillRect(0, y, w, 1.5)
  paintPlaneTone(g, w, h, tone)
  // The track wall starts as a muted slate edge and falls into shadow.
  // This short vertical transition must not enter the repeating rows.
  const contact = g.createLinearGradient(0, 0, 0, 128)
  contact.addColorStop(0, 'rgba(57,76,83,.69)')
  contact.addColorStop(.26, 'rgba(19,32,41,.48)')
  contact.addColorStop(1, 'rgba(19,32,41,0)')
  g.fillStyle = contact
  g.fillRect(0, 0, w, 128)
}

export function paintPlatform(g: CanvasRenderingContext2D, w: number, finish: Extract<DeckFinish, { surface: 'dry-platform' }>): void {
  const { rear, front, sidewalk, soffit } = ROAD
  g.fillStyle = materialRamp(g, 0, sidewalk - 9, 0, rear, finish.masonry)
  g.fillRect(0, sidewalk - 9, w, rear - sidewalk + 9)
  g.fillStyle = '#273238'
  g.fillRect(0, rear - 4, w, 4)
  g.fillStyle = materialRamp(g, 0, rear, 0, front, finish.tile)
  g.fillRect(0, rear, w, front - rear)
  // Broad stone slabs. Sparse seams and wear, no pinpoints or mirror.
  const bands = [rear, -21, 15, front]
  for (let i = 0; i < bands.length - 1; i++) {
    const y = bands[i], height = bands[i + 1] - y
    g.fillStyle = 'rgba(14,26,29,.35)'
    g.fillRect(0, y, w, 1.5)
    for (let x = i * 34; x < w; x += 102) g.fillRect(x, y, 1.5, height)
    g.fillStyle = 'rgba(194,202,177,.10)'
    for (let x = i * 34 + 2; x < w; x += 102) g.fillRect(x, y + 1.5, 33, height - 3)
  }
  g.fillStyle = '#766c50'
  g.fillRect(0, front - 14, w, 10)
  g.fillStyle = '#a18f65'
  for (let x = 2; x < w; x += 9) g.fillRect(x, front - 11, 3, 2)
  g.fillStyle = materialRamp(g, 0, front, 0, front + 7, finish.metal)
  g.fillRect(0, front, w, 7)
  g.fillStyle = materialRamp(g, 0, front + 7, 0, soffit, finish.masonry)
  g.fillRect(0, front + 7, w, soffit - front - 7)
  g.fillStyle = '#1d2a2e'
  for (let x = 18; x < w; x += 204) g.fillRect(x, front + 7, 2, soffit - front - 7)
  g.fillRect(0, soffit - 3, w, 3)
}
