import type { Platform, RouteChunk } from './route'

/** Painted extrusion, not new collision geometry. The walking lane projects
 * just inside the leading edge of the return. The v4 support word still
 * carries the near edge's Z offset from the actor lane (optical metres). */
export const CATWALK_DECK = { y: -142, thickness: 23, returnX: 23, returnY: -14, near: .49 } as const
export const CARGO_DECK = { y: -96, bottom: -51, returnX: 21, returnY: -12, near: .29 } as const
export const TOP_LANE = .22
export const deckFace = (c: Pick<RouteChunk, 'role'>) => c.role === 'catwalk' ? CATWALK_DECK : CARGO_DECK
export type DeckFace = ReturnType<typeof deckFace>

export function deckTopPath(g: Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo' | 'closePath'>,
  p: Platform, face: DeckFace, guard = 0): void {
  const { left: l, right: r, y } = p, { returnX: x, returnY: dy } = face
  g.moveTo(l - guard, y); g.lineTo(l + x - guard, y + dy)
  g.lineTo(r + x + guard, y + dy); g.lineTo(r + guard, y); g.closePath()
}

/** World-elevation pixel → optical depth relative to the lane. Null means
 * fascia, side return, or air. Mirrors the shader's half-open top test. */
export function deckTopDepth(x: number, y: number, p: Platform, face: DeckFace): number | null {
  const v = (y - p.y) / face.returnY
  return v >= 0 && v <= 1 && x >= p.left + v * face.returnX && x < p.right + v * face.returnX
    ? (v / TOP_LANE - 1) * face.near : null
}
