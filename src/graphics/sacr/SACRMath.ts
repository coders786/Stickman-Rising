import { stratumV, STRATUM_CURB_HEIGHT } from './SACRAtlas'
import { readColumnSlot, SACR_BAR_DEPTH_MULTIPLIER, SACR_SOLID_ID, SACR_ARCH_RECORDS, SACR_COLUMNS, SACR_DILATION, SACR_FEET, SACR_PX_PER_METER,
  SACRUniformBuffer, unpackArcMeta, unpackCapsuleMeta, unpackHalf2x16,
  unpackUnorm4x8_ES30, type RGB, type SACRMaxK, type Vec3 } from './SACRPacker'

export const SACR_NEAR_Z = 1.45
export const SACR_CURB_Z = 5.35
export const SACR_ACTOR_Z = (SACR_NEAR_Z + SACR_CURB_Z) * .5
const TAU = Math.PI * 2
const sat = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => { const t = sat(x); return t * t * (3 - 2 * t) }

/** `left`/`right` are the unprojected horizontal envelope, including roll.
 * camWorldX is the left origin, never the camera's gameplay tracking centre. */
export function sacrCoordinates(left: number, right: number, cameraCenter: number) {
  return { camWorldX: left / SACR_PX_PER_METER, viewWidthMeters: (right - left) / SACR_PX_PER_METER,
    pOffsetMeters: (cameraCenter - left) / SACR_PX_PER_METER }
}
export const worldToSACRX = (worldPx: number, leftPx: number) => (worldPx - leftPx) / SACR_PX_PER_METER

export interface SACRPortal {
  kind: 'exterior' | 'interior' | 'soffit'
  u: number
  v: number
  xWorld: number
  rgba?: readonly [number, number, number, number]
}
export interface SACRTrace {
  buf: SACRUniformBuffer
  p: Vec3
  ray: Vec3
  camWorldX: number
  stratumOriginX: number
  stratumWidthMeters: number
  viewWidthMeters: number
  maxK: SACRMaxK
  roughness: number
  wetness: number
  curbZ?: number
  lod?: number
  sky?: RGB
  sampleStratum?: (u: number, v: number, lod: number) => RGB
}
export function traceSACRPortal({ buf, p, ray, camWorldX, stratumOriginX, stratumWidthMeters,
  curbZ = SACR_CURB_Z, lod = 0 }: SACRTrace): SACRPortal {
  const t = Math.max(0, curbZ - p[2]) / Math.max(.001, ray[2])
  const x = p[0] + ray[0] * t + camWorldX, y = p[1] + ray[1] * t
  const local = x - stratumOriginX
  for (let n = 0; n < SACR_ARCH_RECORDS; n++) {
    const k = SACRUniformBuffer.OFF_ARCHPROFILE + n * 4, a = buf.u32
    const l = a[k] * .001, r = a[k + 1] * .001
    if (r <= l) break
    if (local < l || local >= r) continue
    const [depth, lintel] = unpackHalf2x16(a[k + 2])
    if (depth <= 0 || y < 0 || y >= lintel) break
    const backT = depth / Math.max(.001, ray[2]), back = local + ray[0] * backT, backY = y + ray[1] * backT
    if (backY >= lintel || back < l || back >= r) {
      return { kind: 'soffit', u: 0, v: -1, xWorld: x, rgba: unpackUnorm4x8_ES30(a[k + 3]) }
    }
    return { kind: 'interior', u: back / stratumWidthMeters, v: stratumV(backY / lintel, true, lod), xWorld: back + stratumOriginX }
  }
  return { kind: 'exterior', u: local / stratumWidthMeters, v: stratumV(y / STRATUM_CURB_HEIGHT, false, lod), xWorld: x }
}

export function sacrFootAO(buf: SACRUniformBuffer, x: number, z: number, height = 0): number {
  let ao = 1
  const a = buf.f32
  for (let i = 0; i < SACR_FEET; i++) {
    const k = SACRUniformBuffer.OFF_FOOTAO + i * 4, radius = a[k + 2]
    if (radius <= 0) break
    if ((a[k + 3] < 0) !== (height > .5)) continue
    const lift = Math.max(0, a[k + 3] < 0 ? -1 - a[k + 3] : a[k + 3]), spread = 1 + Math.min(.82, lift * .46)
    const d = Math.hypot(x - a[k], (z - a[k + 1]) * 2.25) / (radius * spread)
    const inner = .71 * (1 - smooth((lift - .055) / .415)) * (1 - smooth((d - .52) / .69))
    const outer = .32 * Math.exp(-lift * 1.85 - d * d * .695) * (1 - smooth((d - 1.81) / .63))
    ao = Math.min(ao, 1 - Math.max(inner, outer))
  }
  return ao
}

/** Distance to the centreline, not to a disk sector. At the centre there is
 * no direction to normalize, and the entire circle is radius units away. */
export function arcCenterlineDistance(x: number, y: number, radius: number, mx: number, my: number, thetaHalf: number): number {
  const l = Math.hypot(x, y)
  if (l < 1e-5) return radius - l
  const angle = Math.atan2(y, x) - Math.atan2(my, mx)
  const wrapped = angle - TAU * Math.floor((angle + Math.PI) / TAU)
  const use = Math.max(-thetaHalf, Math.min(thetaHalf, wrapped)), phi = Math.atan2(my, mx) + use
  return Math.hypot(x - radius * Math.cos(phi), y - radius * Math.sin(phi))
}

export function capsuleDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number, r0: number, r1: number): number {
  const x = bx - ax, y = by - ay
  const t = sat(((px - ax) * x + (py - ay) * y) / Math.max(1e-8, x * x + y * y))
  return Math.hypot(px - ax - x * t, py - ay - y * t) - (r0 * (1 - t) + r1 * t)
}

/** Finite emitter integrated over the capsule's cross-section. Both edges
 * matter: a filament can never black out a broad emitter. */
export function shadowCapsuleCoverage(distance: number, radius: number, spread: number): number {
  const w = 2 * Math.max(.0001, spread)
  return smooth(.5 + (radius - distance) / w) - smooth(.5 + (-radius - distance) / w)
}

/** Ray/underside overlap clipped in height and depth; X still uses the
 * column-binner's bounded horizontal bend. Returns edge distance for AA. */
export function undersideRayHit(p: Vec3, ray: Vec3, left: number, right: number, height: number,
  half: number, near: number, reach: number): { distance: number; z: number } | null {
  const rz = Math.max(.001, ray[2]), ry = Math.max(.001, ray[1])
  const a = Math.max(0, (near - p[2]) / rz, (height - half - p[1]) / ry)
  const b = Math.min((near + reach - p[2]) / rz, (height + half - p[1]) / ry)
  if (a > b) return null
  const x0 = p[0] + Math.max(-SACR_DILATION, Math.min(SACR_DILATION, ray[0] * a))
  const x1 = p[0] + Math.max(-SACR_DILATION, Math.min(SACR_DILATION, ray[0] * b))
  const distance = Math.max(left - Math.max(x0, x1), Math.min(x0, x1) - right)
  const crossing = x0 < left && ray[0] > 0 ? (left - p[0]) / ray[0] : x0 > right && ray[0] < 0 ? (right - p[0]) / ray[0] : a
  return { distance, z: p[2] + Math.max(a, Math.min(b, crossing)) * rz }
}

export interface SACRSample {
  outContactAO: number
  outReflRadiance: RGB
  stratumC: RGB
  emissiveRadiance: RGB
  opaqueAlpha: number
  portal: SACRPortal | null // dry receivers never trace or sample the atlas
  background: RGB
  undersideAlpha: number
  skyTransmission: number
}
/** Pure reference for the production GLSL evaluator. An emissive primitive
 * never enters the opaque union. One same-ID union precedes Z compositing. */
export function evaluateSACR_Ref(s: SACRTrace): SACRSample {
  const { p, ray, buf, roughness, wetness } = s
  const black: RGB = [0, 0, 0], ao = sacrFootAO(buf, p[0], p[2], p[1])
  if (wetness < .04) return { outContactAO: ao, outReflRadiance: black, stratumC: black,
    emissiveRadiance: black, opaqueAlpha: 0, portal: null, background: black, undersideAlpha: 0, skyTransmission: 0 }
  const portal = traceSACRPortal(s)
  const background: RGB = portal.rgba ? [portal.rgba[0], portal.rgba[1], portal.rgba[2]] : s.sampleStratum?.(portal.u, portal.v, s.lod ?? 0) ?? black
  const sky = portal.kind === 'exterior' ? s.sky ?? black : black
  const c: [number, number, number] = [0, 0, 0], e: [number, number, number] = [0, 0, 0]
  let undersideAlpha = 0, underside: RGB = black, stopZ = Infinity
  const edge = .026 + roughness * roughness * .18
  const groups = new Map<number, { rgb: RGB; alpha: number }>()
  const col = Math.floor(p[0] * SACR_COLUMNS / s.viewWidthMeters)
  if (col >= 0 && col < SACR_COLUMNS) for (let j = 0; j < s.maxK; j++) {
    const id = readColumnSlot(buf, col, j)
    if (!id || id > 64) break
    const q = SACRUniformBuffer.OFF_PRIMPOOL + (id - 1) * 4, a = buf.u32
    const [r0, z] = unpackHalf2x16(a[q + 2])
    const dz = z - p[2]
    const [ax, ay] = unpackHalf2x16(a[q]), [bx, by] = unpackHalf2x16(a[q + 1])
    const capsule = r0 >= 0 ? unpackCapsuleMeta(a[q + 3]) : null
    if (capsule?.charID === SACR_SOLID_ID && capsule.emis === 0) {
      const hit = undersideRayHit(p, ray, ax, bx, ay, r0, z, capsule.r1 * SACR_BAR_DEPTH_MULTIPLIER)
      const alpha = hit ? 1 - smooth(hit.distance / edge) : 0
      if (hit && (alpha > undersideAlpha || alpha > 0 && alpha === undersideAlpha && hit.z < stopZ)) {
        undersideAlpha = alpha; stopZ = hit.z; underside = capsule.rgb.map(x => x ** 2.2) as unknown as RGB
      }
      continue
    }
    // Architectural records are admitted first and have a smaller packed
    // near Z than any character. The actual hit can be behind a fighter.
    if (dz < -.001 || undersideAlpha === 1 && z > stopZ) continue
    const dt = Math.max(0, dz) / Math.max(.001, ray[2])
    const x = p[0] + Math.max(-SACR_DILATION, Math.min(SACR_DILATION, ray[0] * dt)), y = p[1] + ray[1] * dt
    let distance: number, charID = 0, tint: RGB, emis: number
    if (r0 < 0) {
      const m = unpackArcMeta(a[q + 3]); tint = m.rgb; emis = m.emis
      distance = arcCenterlineDistance(x - ax, y - ay, -r0, bx, by, m.thetaHalf) - m.halfThickness
    } else {
      const m = capsule!; tint = m.rgb; emis = m.emis; charID = m.charID
      distance = capsuleDistance(x, y, ax, ay, bx, by, r0, m.r1)
    }
    const alpha = (1 - smooth(distance / edge)) * (z > stopZ ? 1 - undersideAlpha : 1)
    if (alpha <= 0) continue
    const rgb = tint.map(q => q ** 2.2) as unknown as RGB
    if (emis > 0) {
      for (let k = 0; k < 3; k++) e[k] += rgb[k] * alpha * emis
    } else if (!groups.has(charID) || groups.get(charID)!.alpha < alpha) {
      groups.set(charID, { rgb, alpha })
    }
  }
  let trans = 1
  for (const { rgb, alpha } of groups.values()) {
    for (let k = 0; k < 3; k++) c[k] += rgb[k] * alpha * trans
    trans *= 1 - alpha
  }
  const normalLook = sat(ray[1] / Math.max(.001, Math.hypot(...ray)))
  const gain = sat(wetness) * (.18 + .64 * (1 - normalLook) ** 3) * (1 - .38 * roughness)
  const stratumC = c.map((x, i) => x + e[i]) as unknown as RGB
  return { outContactAO: ao, outReflRadiance: stratumC.map((x, i) => gain * (x + ((background[i] + sky[i]) * (1 - undersideAlpha) + underside[i] * undersideAlpha) * trans)) as unknown as RGB,
    stratumC, emissiveRadiance: e, opaqueAlpha: 1 - trans * (1 - undersideAlpha), portal, background, undersideAlpha, skyTransmission: (portal.kind === 'exterior' ? trans * (1 - undersideAlpha) : 0) }
}
