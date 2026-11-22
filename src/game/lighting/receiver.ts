import { newReceiverLight, sampleLocalLight, type LocalLightPacket, type ReceiverLight } from '../../graphics/sacr/SACRLocalLight'
import type { FixtureLobes } from '../../graphics/bridge/LightVectorGrid'
import type { ShadowActor } from '../render/shadows'

export const RECEIVER = { torso: 0, head: 1, armL: 2, armR: 3, legL: 4, legR: 5 } as const
export type ReceiverPart = typeof RECEIVER[keyof typeof RECEIVER]
export type PartLight = ReceiverLight & { fixtures: FixtureLobes }
export const newFixtureLobes = (): FixtureLobes => [newReceiverLight(), newReceiverLight()]
export type ReceiverRig = readonly PartLight[]
export const newReceiverRig = (): ReceiverRig => Array.from({ length: 6 }, () => ({ ...newReceiverLight(), fixtures: newFixtureLobes() }))
interface PosedLightPacket extends LocalLightPacket {
  receiveFixtures(x: number, y: number, depth: number, out: FixtureLobes): void
}

/** Six depth-aware material taps on a moving enemy. The playable silhouette
 * is ink; its pose participates in transport, not in surface lighting. */
export function sampleReceiverRig(frame: PosedLightPacket, a: ShadowActor, out: ReceiverRig): void {
  const g = a.geom, sx = a.face * a.scale
  type Joint = { x: number; y: number; z?: number }
  const sample = (part: ReceiverPart, p: Joint, q = p, t = .5) => {
    const x = (p.x + (q.x - p.x) * t) * sx, y = (p.y + (q.y - p.y) * t) * a.scale
    const z = ((p.z ?? 0) * (1 - t) + (q.z ?? 0) * t) * a.scale
    const wx = a.x + x, wy = a.hipY + y, at = out[part]
    sampleLocalLight(frame, wx, wy, -z, at)
    frame.receiveFixtures(wx, wy, -z, at.fixtures)
  }
  sample(RECEIVER.torso, g.hip, g.chest, .66); sample(RECEIVER.head, g.headC)
  sample(RECEIVER.armL, g.elbL, g.handL, .37); sample(RECEIVER.armR, g.elbR, g.handR, .37)
  sample(RECEIVER.legL, g.kneeL, g.ankleL, .22); sample(RECEIVER.legR, g.kneeR, g.ankleR, .22)
}

/** Bounded hemispherical normal response across an existing 2D path. Diffuse
 * and grazing sheen share the incident spectrum. No emissive outline, scene
 * pixels, or geometry generation. On the unlit side only a weak return lands. */
export function localLightBrush(ctx: CanvasRenderingContext2D, at: ReceiverLight | undefined,
  face: number, x: number, y: number, rx: number, ry: number, reflectance: number, rotation = 0, gloss = 9): CanvasGradient | undefined {
  if (!at || at.strength < .007) return
  let dx = at.dx * face, dy = at.dy
  const front = -at.dz, plane = Math.hypot(dx, dy)
  if (rotation) {
    const c = Math.cos(rotation), s = Math.sin(rotation), lx = dx * c + dy * s
    dy = dy * c - dx * s; dx = lx
  }
  const ux = plane > .008 ? dx / plane : 1, uy = plane > .008 ? dy / plane : 0
  const span = Math.max(1, Math.hypot(rx * ux, ry * uy)), peak = Math.max(.001, at.r, at.g, at.b)
  const ch = (v: number) => Math.round(244 * (v / peak) ** .45)
  const color = `${ch(at.r)},${ch(at.g)},${ch(at.b)}`
  const gain = Math.min(1.12, Math.sqrt(peak)) * reflectance
  const brush = ctx.createLinearGradient(x - ux * span, y - uy * span, x + ux * span, y + uy * span)
  for (const u of [-1, -.65, 0, .65, 1]) {
    const nz = Math.sqrt(Math.max(0, 1 - u * u)), lit = u * plane + nz * front
    const spec = Math.max(0, (lit + nz) / Math.max(1, Math.hypot(plane, front + 1))) ** gloss
    brush.addColorStop((u + 1) * .5, `rgba(${color},${gain * (.04 + .84 * Math.max(0, lit) + .12 * spec)})`)
  }
  return brush
}

export function lightPath(ctx: CanvasRenderingContext2D, at: PartLight | undefined, face: number,
  x: number, y: number, rx: number, ry: number, gain: number, stroke = false, rotation = 0): void {
  if (!at) return
  const mode = ctx.globalCompositeOperation
  const paint = (sample: ReceiverLight) => {
    const brush = localLightBrush(ctx, sample, face, x, y, rx, ry, gain, rotation)
    if (!brush) return
    ctx.globalCompositeOperation = 'lighter'
    if (stroke) { const prev = ctx.strokeStyle; ctx.strokeStyle = brush; ctx.stroke(); ctx.strokeStyle = prev }
    else { const prev = ctx.fillStyle; ctx.fillStyle = brush; ctx.fill(); ctx.fillStyle = prev }
  }
  paint(at.fixtures[0]); paint(at.fixtures[1]); paint(at)
  ctx.globalCompositeOperation = mode
}
