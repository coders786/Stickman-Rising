import { MOON_CAST_ENERGY, type CastSource } from '../../graphics/bridge/LightVectorGrid'
import { MOON_KEY } from '../../graphics/bridge/NoirGeometry'
import { sat, smoothRange } from '../../graphics/bridge/SkyBasis'
import { SACR_CURB_Z, SACR_NEAR_Z } from '../../graphics/sacr/SACRMath'
import { SACR_PX_PER_METER } from '../../graphics/sacr/SACRPacker'
import { ROAD } from '../stage/road-section'
import { deckTopPath, TOP_LANE, type DeckFace } from '../stage/bridge-deck-face'
import type { BridgeRoute, Platform } from '../stage/route'
import { FIGURE_H, shadowOutline, type ShadowActor } from './shadows'

type Source = 'moon' | 'practical' | 'combat'
export type CastKey = { slope: number; gain: number; zSlope?: number; source?: Source; practical?: CastSource }
export type CastReceiver = { support: Platform; face: DeckFace } | null

/** Canvas has one static projection per receiver. Give it to a real
 * source; fade through a rank tie, never interpolate an invented lamp. */
export function castKey(moonSlope: number, moonVis: number, access: number, practicals: readonly CastSource[],
  impulseSlope?: number, impulseGain = 0): CastKey {
  let slope = moonSlope, zSlope = MOON_KEY[2] / -MOON_KEY[1], first = access * moonVis * MOON_CAST_ENERGY, second = 0
  let source: Source = 'moon', practical: CastSource | undefined
  const admit = (direction: number, depth: number, energy: number, kind: Source, p?: CastSource) => {
    if (energy > first) { slope = direction; zSlope = depth; second = first; first = energy; source = kind; practical = p }
    else second = Math.max(second, energy)
  }
  for (const p of practicals) {
    if (p.y <= .03 || Math.abs(p.z) < .004) continue
    const up = Math.max(.22, p.y)
    admit(-p.x / up, p.z / up, p.energy, 'practical', p)
  }
  if (impulseSlope !== undefined) admit(impulseSlope, -.82, impulseGain, 'combat')
  const handoff = smoothRange(0, .12, (first - second) / Math.max(.004, first))
  return { slope, zSlope, source, practical, gain: sat(first * 1.48) * handoff }
}

export const ROAD_CAST_Y_PER_METRE = (ROAD.front - ROAD.rear) / (SACR_CURB_Z - SACR_NEAR_Z)
export function castProjection(actor: ShadowActor, cast: CastKey, receiver: CastReceiver) {
  const floor = receiver?.support.y ?? ROAD.lane, face = receiver?.face
  const { x, hipY, scale } = actor, lift = Math.max(0, (actor.floorY ?? ROAD.lane) - actor.y)
  const near = face ? -face.returnY * TOP_LANE / face.near : ROAD_CAST_Y_PER_METRE
  const v = Math.max(-1.9, Math.min(1.9, cast.zSlope ?? .28)) * near / SACR_PX_PER_METER
  const slope = Math.max(-2.2, Math.min(2.2, cast.slope)), planeY = floor + (face ? face.returnY * TOP_LANE : 0)
  const extent = FIGURE_H * scale + Math.max(0, floor - actor.y)
  return { x: x + (floor - hipY) * slope, y: planeY + (floor - hipY) * v,
    a: actor.face * scale, c: -slope * scale, d: -v * scale, planeY, floor, extent,
    opacity: cast.gain * Math.exp(-lift / 96) }
}

type RGB = readonly [number, number, number]
const CAST_FALLOFF = [[0, .92], [.32, .93], [.69, .69], [1, .34]] as const

/** Clip to the actual receiver. The ink is a per-channel estimate of the
 * selected lobe's share of the baked diffuse, not black over emissive or
 * wet returns. A few taps along the cast bound it to baked access/eaves. */
export function drawBridgeCast(ctx: CanvasRenderingContext2D, actor: ShadowActor, cast: CastKey, receiver: CastReceiver,
  tint: (x: number, y: number) => RGB, route: BridgeRoute, lensY?: number): boolean {
  if (cast.gain < .010) return false
  const a = castProjection(actor, cast, receiver)
  if (Math.abs(a.d) < .001) return false
  // Keep all gradient taps on the receiver. An off-deck highlight must
  // not nominate a lobe, or stretch ink across a dark part of the road.
  const perHeight = -a.d / actor.scale
  const low = ((receiver ? a.floor + receiver.face.returnY : ROAD.rear) - a.planeY) / perHeight
  const high = ((receiver ? a.floor : ROAD.front) - a.planeY) / perHeight
  const height = Math.max(0, a.floor - actor.y - 3, Math.min(low, high))
  const end = Math.min(a.extent, Math.max(low, high), lensY === undefined ? Infinity : a.floor - lensY)
  const span = end - height
  if (span < .5) return false
  const base = (a.planeY - a.y) / a.d
  const colors: [number, string][] = []
  let visible = false
  for (const [t, w] of CAST_FALLOFF) {
    const at = base - (height + span * t) / actor.scale
    const rgb = tint(a.x + at * a.c, a.y + at * a.d)
    const opacity = a.opacity * w
    const rr = Math.round(255 * rgb[0] * opacity), gg = Math.round(255 * rgb[1] * opacity), bb = Math.round(255 * rgb[2] * opacity)
    visible ||= rr + gg + bb > 0
    colors.push([t, `rgb(${255 - rr},${255 - gg},${255 - bb})`])
  }
  if (!visible) return false
  ctx.save(); ctx.beginPath()
  if (receiver) deckTopPath(ctx, receiver.support, receiver.face)
  else {
    const l = Math.max(0, actor.x - 710), r = actor.x + 710, h = ROAD.front - ROAD.rear
    ctx.rect(l, ROAD.rear, r - l, h)
    if (cast.source === 'moon') for (const { shelter: s } of route.between(l, r)) {
      if (s && s.right > l && s.left < r) ctx.rect(Math.max(l, s.left), ROAD.rear, Math.min(r, s.right) - Math.max(l, s.left), h)
    }
  }
  ctx.clip('evenodd')
  ctx.transform(a.a, 0, a.c, a.d, a.x, a.y)
  // A joint below this receiver can't block a light incident from above.
  const cut = lensY === undefined ? -512 : (lensY - actor.hipY) / actor.scale
  ctx.beginPath(); ctx.rect(-256, cut, 512, Math.max(0, base + 3 / actor.scale - cut)); ctx.clip()
  const ink = ctx.createLinearGradient(0, base - height / actor.scale, 0, base - end / actor.scale)
  for (const [at, color] of colors) ink.addColorStop(at, color)
  const path = shadowOutline(actor.geom, true, undefined, true)
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = ink; ctx.fill(path)
  ctx.globalAlpha *= .24; ctx.lineWidth = receiver ? 3.2 : 5.4; ctx.lineJoin = 'round'; ctx.strokeStyle = ink; ctx.stroke(path)
  ctx.restore()
  return true
}
