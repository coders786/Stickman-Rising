/** Geometry is independent of colour: a spot can be warm and a panel can be blue.
 * Local lights live in (right, down, towards camera) coordinates. A directional
 * light has no position or radius and is evaluated separately from the ribbons. */
export type EmitterShape =
  | { type: 'directional' }
  | { type: 'point'; sourceRadius: number }
  | {
      type: 'spot'
      sourceRadius: number
      aimX: number
      aimZ: number
      innerCos: number
      outerCos: number
    }
  | { type: 'rect'; width: number; height: number }
export type LocalShape = Exclude<EmitterShape, { type: 'directional' }>
export const POINT: LocalShape = { type: 'point', sourceRadius: 5 }
export const SIGN_FACE = { type: 'rect', width: 112, height: 28 } as const
export const FLOOD = {
  type: 'spot',
  sourceRadius: 8,
  aimX: 0.26,
  aimZ: 0.32,
  innerCos: Math.cos(0.23),
  outerCos: Math.cos(0.53),
} as const

/** Angular emission, evaluated during the bake, never in the per-fighter loop. */
export function emission(
  shape: LocalShape,
  dx: number,
  dy: number,
  dz: number,
): number {
  if (shape.type === 'point') return 1
  if (shape.type === 'rect') {
    if (dz <= 0) return 0 // the room does not emit through its back wall
    // Extended sources retain a broad near-field footprint.
    const ex = Math.max(0, Math.abs(dx) - shape.width / 2),
      ey = Math.max(0, Math.abs(dy) - shape.height / 2)
    return Math.sqrt(dz / Math.hypot(dz, ex, ey))
  }
  const cos =
    (dx * shape.aimX + dy + dz * shape.aimZ) /
    (Math.hypot(dx, dy, dz) * Math.hypot(shape.aimX, 1, shape.aimZ) || 1)
  const t = Math.max(
    0,
    Math.min(1, (cos - shape.outerCos) / (shape.innerCos - shape.outerCos)),
  )
  return t * t * (3 - 2 * t)
}
