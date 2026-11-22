import type { PropKind } from '../world/props'

const variants = 3
export const BRIDGE_PROP_KINDS = ['fuel', 'med', 'steam', 'shock', 'smoke', 'supply'] as const
export const PROP_CELL = { w: 76, h: 84, stride: 78 } as const
export const BRIDGE_PROP_W = PROP_CELL.stride * BRIDGE_PROP_KINDS.length * variants
export const BRIDGE_PROP_H = PROP_CELL.h
export const propVariant = (seed: number) => ((seed >>> 13) ^ (seed >>> 26)) % variants
export const propCellX = (kind: PropKind, variant: number) => 1 + PROP_CELL.stride * (BRIDGE_PROP_KINDS.indexOf(kind) * variants + variant)

type Point = readonly [x: number, y: number]
export interface RoutePropShape {
  readonly half: number
  readonly height: number
  readonly crown: number
  readonly bevel: number
  readonly canister: boolean
  readonly hull: readonly Point[]
}

function make(half: number, height: number, bevel: number, canister: boolean): RoutePropShape {
  const crown = canister ? bevel * .73 : bevel + 1
  return { half, height, crown, bevel, canister, hull: [
    [-half, -height + crown + 1], [-half + bevel, -height], [half - bevel, -height], [half, -height + crown + 1],
    [half, -bevel * .65], [half - bevel, 0], [-half + bevel, 0], [-half, -bevel * .65],
  ] }
}

const profiles: Record<PropKind, readonly RoutePropShape[]> = {
  med: [make(25, 49, 4, false), make(29, 42, 5, false), make(21, 57, 5, false)],
  supply: [make(23, 55, 5, false), make(30, 44, 4, false), make(20, 61, 5, false)],
  shock: [make(21, 57, 5, false), make(26, 48, 4, false), make(19, 69, 5, false)],
  fuel: [make(20, 64, 8, true), make(25, 53, 10, true), make(17, 72, 8, true)],
  steam: [make(17, 70, 8, true), make(23, 51, 10, true), make(19, 63, 9, true)],
  smoke: [make(18, 58, 8, true), make(21, 48, 10, true), make(15, 70, 8, true)],
}
export const routePropShape = (kind: PropKind, variant = 0) => profiles[kind][variant] ?? profiles[kind][0]

export function traceRouteProp(g: CanvasRenderingContext2D, shape: RoutePropShape): void {
  const hull = shape.hull
  g.beginPath(); g.moveTo(hull[0][0], hull[0][1])
  for (let j = 1; j < hull.length; j++) g.lineTo(hull[j][0], hull[j][1])
  g.closePath()
}

/** Continuous clip of the actual blade segment against the same convex
 * silhouette used by the sprite and the receiver. No sample gaps. */
export function hitsRouteProp(shape: RoutePropShape, x: number, blade: { bx: number; by: number; tx: number; ty: number }): boolean {
  const { hull } = shape
  let near = 0, far = 1
  for (let j = 0; j < hull.length; j++) {
    const [ax, ay] = hull[j], [bx, by] = hull[(j + 1) % hull.length]
    const dx = bx - ax, dy = by - ay
    const d0 = dx * (blade.by - ay) - dy * (blade.bx - x - ax)
    const d1 = dx * (blade.ty - ay) - dy * (blade.tx - x - ax)
    if (d0 < 0 && d1 < 0) return false
    if (d0 < 0) near = Math.max(near, d0 / (d0 - d1))
    if (d1 < 0) far = Math.min(far, d0 / (d0 - d1))
    if (near > far) return false
  }
  return true
}

/** An unlit pigment plate. Same painter offline and under asset denial.
 * The cap/return are geometry cues, not a copy of the live fixture field. */
export function paintRoutePropBody(g: CanvasRenderingContext2D, shape: RoutePropShape, kind: PropKind, body: string, signal: string): void {
  const { half: w, height: h, crown: c, canister } = shape
  g.save(); traceRouteProp(g, shape); g.clip()
  g.fillStyle = '#101922'; g.fillRect(-w, -h, 2 * w, h)
  g.fillStyle = body; g.fillRect(-w + 2, -h + c + 2, 2 * w - 4, h - c - 4)
  g.fillStyle = canister ? '#82939c55' : '#b5c1c077'; g.fillRect(-w, -h, 2 * w, c + 1)
  g.fillStyle = '#adbac33d'; g.fillRect(-w + 1.5, -h + c + 1, canister ? 4.4 : 2, h - c - 3)
  g.fillStyle = '#00081280'; g.fillRect(w - (canister ? 7 : 9), -h + c + 1, 9, h - c)
  g.fillStyle = '#9eaeb44c'; g.fillRect(-w + 2, -h + c, 2 * w - 4, 1)
  g.fillStyle = '#101920'; g.fillRect(-w, -6, 2 * w, 6)
  g.fillStyle = '#69778085'; g.fillRect(-w + 3, -5, 2 * w - 6, 1.2)
  if (canister) {
    for (const y of [-h + c + 5, -h * .46, -11]) {
      g.fillStyle = '#111c23'; g.fillRect(-w, y, 2 * w, 4)
      g.fillStyle = '#b6c1c251'; g.fillRect(-w, y, 2 * w, 1)
    }
    g.fillStyle = '#131f28'; g.fillRect(-6, -h, 12, 3)
    const y = -h * .66
    if (kind === 'fuel') {
      g.fillStyle = '#170d0a'; g.fillRect(-w + 3, y - 7, 2 * w - 6, 13)
      g.fillStyle = signal
      for (let x = -w + 5; x < w - 6; x += 7) {
        g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x + 4, y - 5); g.lineTo(x + 7, y - 5); g.lineTo(x + 3, y + 3); g.fill()
      }
    } else if (kind === 'steam') {
      g.strokeStyle = signal; g.lineWidth = 1.6
      g.beginPath(); g.arc(-1, y - 2, 6, 0, Math.PI * 2); g.moveTo(-8, y - 2); g.lineTo(6, y - 2); g.moveTo(-1, y - 9); g.lineTo(-1, y + 5); g.stroke()
    } else {
      g.fillStyle = signal; g.fillRect(-w + 4, y - 9, 2 * w - 8, 2)
      g.fillStyle = '#151523'
      for (let i = -2; i < 3; i++) g.fillRect(i * 5 - 1, y - 3, 3, 7)
    }
  } else {
    g.fillStyle = kind === 'med' ? '#b4c7bb' : '#968b6b'
    g.fillRect(-w + 6, -h + c + 7, 2 * w - 19, 1.6)
    g.fillStyle = '#0c141b'; g.fillRect(w - 13, -h + c + 4, 4, 7)
    g.fillStyle = signal
    const y = -h * .52
    if (kind === 'med') {
      g.fillRect(-6, y - 10, 5, 18); g.fillRect(-13, y - 4, 19, 5)
    } else if (kind === 'shock') {
      g.beginPath(); g.moveTo(0, y - 12); g.lineTo(-9, y + 1); g.lineTo(-2, y + 1); g.lineTo(-6, y + 11)
      g.lineTo(6, y - 3); g.lineTo(-1, y - 3); g.closePath(); g.fill()
    } else {
      g.fillRect(-w + 6, y - 2, 2 * w - 20, 3); g.fillRect(-w + 6, y + 5, 2 * w - 27, 2)
    }
  }
  g.restore()
}

export function paintRoutePropDamage(g: CanvasRenderingContext2D, shape: RoutePropShape): void {
  const h = shape.height, w = shape.half
  g.save(); traceRouteProp(g, shape); g.clip()
  g.lineCap = 'round'; g.lineJoin = 'round'
  g.beginPath(); g.moveTo(w + 2, -h * .69); g.lineTo(w * .26, -h * .53); g.lineTo(w * .46, -h * .40)
  g.lineTo(-w * .46, -h * .25); g.lineTo(-w * .29, -h * .06)
  g.strokeStyle = '#bcc3bf90'; g.lineWidth = 4.5; g.stroke()
  g.strokeStyle = '#080d13'; g.lineWidth = 2.7; g.stroke()
  g.restore()
}
