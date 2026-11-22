import { ROAD, ROAD_PLATE_TOP } from './road-section'
import { RAIL_MODEL_SCALE, RAIL_Y } from '../../graphics/bridge/RailSchedule'

export type SectionCamera = { x: number; y: number; zoom: number; rot?: number }

/** Only geometry has a scale. Every structure uses the deck's affine view;
 * a fixed bolt moves by −deltaX × zoom, even on a jump or a zoom change. */
export const sectionY = (cam: Pick<SectionCamera, 'y' | 'zoom'>, h: number, y: number) => h * .5 + (y - cam.y) * cam.zoom

export function railProject(cam: Pick<SectionCamera, 'y' | 'zoom'>, h: number) {
  return { scale: cam.zoom * RAIL_MODEL_SCALE, rail: sectionY(cam, h, RAIL_Y) }
}

export function sectionSpan(cam: SectionCamera, w: number, h: number) {
  const rot = cam.rot ?? 0
  return (w * Math.abs(Math.cos(rot)) + h * Math.abs(Math.sin(rot))) / cam.zoom
}

export function applySectionView(g: CanvasRenderingContext2D, cam: SectionCamera, w: number, h: number): void {
  g.translate(w * .5, h * .5)
  if (cam.rot) g.rotate(cam.rot)
  g.scale(cam.zoom, cam.zoom)
  g.translate(-cam.x, -cam.y)
}

/** Guaranteed opaque intersection of the tilted deck at both viewport
 * edges. Do not clip to the outline: leave an AA/resampling guard, and use
 * a simple horizontal scissor so backends can actually skip covered tiles. */
export function opaqueRoadBand(cam: SectionCamera, w: number, h: number): readonly [number, number] | null {
  const roll = cam.rot ?? 0, co = Math.cos(roll)
  if (co < .5) return null
  const span = Math.abs(Math.tan(roll)) * w * .5 + 4
  const proj = (y: number) => h * .5 + (y - cam.y) * cam.zoom / co
  const lo = Math.max(0, Math.ceil(proj(ROAD_PLATE_TOP) + span))
  const hi = Math.min(h, Math.floor(proj(ROAD.soffit) - span))
  return hi - lo >= 12 ? [lo, hi] : null
}
