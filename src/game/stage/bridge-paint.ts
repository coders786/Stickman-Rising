import { RETURN_X, RETURN_Y } from './bridge-material'

export type ArtPen = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export function slab(g: ArtPen, fill: string | CanvasGradient, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return
  g.fillStyle = fill; g.fillRect(x, y, w, h)
}
export function face(g: ArtPen, fill: string | CanvasGradient, ...xy: number[]): void {
  g.fillStyle = fill; g.beginPath(); g.moveTo(xy[0], xy[1])
  for (let i = 2; i < xy.length; i += 2) g.lineTo(xy[i], xy[i + 1])
  g.closePath(); g.fill()
}
export function ramp(g: ArtPen, x: number, y: number, x1: number, y1: number, ...colors: string[]): CanvasGradient {
  const p = g.createLinearGradient(x, y, x1, y1)
  colors.forEach((c, i) => p.addColorStop(i / (colors.length - 1), c))
  return p
}
export function edge(g: ArtPen, rgb: string | CanvasGradient, width: number, x: number, y: number, tx: number, ty: number, ...joints: number[]): void {
  g.strokeStyle = rgb; g.lineWidth = width; g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); for (let i = 0; i < joints.length; i += 2) g.lineTo(joints[i], joints[i + 1]); g.stroke()
}
export function box(g: ArtPen, x: number, y: number, w: number, h: number, front: string | CanvasGradient, top: string, side: string,
  dx = RETURN_X, dy = RETURN_Y): void {
  face(g, side, x + w, y, x + w + dx, y + dy, x + w + dx, y + h + dy, x + w, y + h)
  face(g, top, x, y, x + dx, y + dy, x + w + dx, y + dy, x + w, y)
  slab(g, front, x, y, w, h)
}

/** Subtle galvanized bolts and rust traps under the seam. These are art on
 * already-solid surfaces, not extra casters, reflectors or collision. */
export function paintFastener(g: ArtPen, x: number, y: number, size: number, wear = 0): void {
  if (wear > .21) {
    const oxide = ramp(g, x, y, x, y + size * (1.8 + wear), '#835f4291', '#523b2d61', '#523b2d00')
    slab(g, oxide, x - size * .45, y + size * .13, size * .9, size * (1.55 + wear))
  }
  g.beginPath(); g.ellipse(x, y + .15, size * .64, size * .55, 0, 0, Math.PI * 2); g.fillStyle = '#1a2226'; g.fill()
  face(g, '#5d6664', x - size * .45, y - .18 * size, x - size * .14, y - .42 * size,
    x + size * .34, y - .29 * size, x + size * .45, y + .12 * size, x + size * .13, y + .36 * size, x - size * .3, y + .24 * size)
  slab(g, '#bcbdb068', x - .28 * size, y - .30 * size, size * .52, .36 * size)
}
