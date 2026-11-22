import { rayVisible, type Blocker } from '../bridge/NoirGeometry'

export const SACR_LIGHT_KIND = { point: 0, spot: 1, area: 2, impulse: 3, beam: 4 } as const
// Relative to SACR_ACTOR_Z, in world px. The radiating surface is just in
// front of the combat plane; projected limbs and the road have real depth.
export const COMBAT_SOURCE_Z = -22
export const FACADE_RECEIVER_Z = 64

export interface LocalLightPacket {
  readonly cam: { x: number }
  readonly source: Float32Array // camera-relative XY, radius, type
  readonly shape: Float32Array // end XY, radius of bright core, aperture
  readonly energy: Float32Array // linear RGB, gain
  readonly blockers: readonly Blocker[]
  readonly count: number
}
export interface ReceiverLight {
  r: number; g: number; b: number
  dx: number; dy: number; dz: number // unit incident vector, world y down, z into the set
  strength: number
  strike: number; strikeX: number; strikeY: number
}
export const newReceiverLight = (): ReceiverLight => ({ r: 0, g: 0, b: 0, dx: 0, dy: 0, dz: -1, strength: 0, strike: 0, strikeX: 0, strikeY: 0 })
const sat = (x: number) => Math.min(1, Math.max(0, x))
export const localFalloff = (distance2: number, radius: number) => {
  const u = distance2 / (radius * radius), edge = Math.max(0, 1 - u)
  return edge * edge / (1 + 8 * u)
}

/** Finite support with the same closest-point falloff and blocker mask used
 * by the GLSL evaluator. A luminous line is a continuous receiver source,
 * not an invisible point at its hilt or its first bolt vertex. */
export function sampleLocalLight(f: LocalLightPacket, x: number, y: number, depth: number, out: ReceiverLight, only = -1): ReceiverLight {
  const { source: a, energy: b, shape: s } = f, localX = x - f.cam.x, dz = COMBAT_SOURCE_Z - depth
  out.r = out.g = out.b = out.dx = out.dy = out.strike = out.strikeX = out.strikeY = out.strength = 0; out.dz = -1
  for (let i = only < 0 ? 0 : only, end = only < 0 ? f.count : Math.min(f.count, only + 1); i < end; i++) {
    const k = i * 4, kind = a[k + 3], radius = a[k + 2], ax = a[k], ay = a[k + 1]
    if (kind === SACR_LIGHT_KIND.spot || kind === SACR_LIGHT_KIND.area) continue // baked radiance
    let sx = ax, sy = ay
    if (kind === SACR_LIGHT_KIND.impulse) {
      const vx = s[k] - ax, vy = s[k + 1] - ay
      const t = sat(((localX - ax) * vx + (y - ay) * vy) / Math.max(.001, vx * vx + vy * vy))
      sx += vx * t; sy += vy * t
    }
    const dx = sx - localX, dy = sy - y, d2 = dx * dx + dy * dy + dz * dz
    let v = localFalloff(d2, radius)
    if (v < .001) continue
    if (kind === SACR_LIGHT_KIND.beam) {
      if (y < ay) continue
      const vx = s[k] - ax + .00001, vy = s[k + 1] - ay + .00001
      const qx = localX - ax + .00001, qy = y - ay + .00001
      const cone = (vx * qx + vy * qy) / (Math.hypot(vx, vy) * Math.hypot(qx, qy))
      const t = sat((cone - (1 - s[k + 3] * .58)) / Math.max(.0001, s[k + 3] * .44))
      v *= t * t * (3 - 2 * t) * (.90 + .10 * Math.cos((localX - ax) * .05 + (y - ay) * .021))
    }
    if (v < .001 || !rayVisible(x, y, sx + f.cam.x, sy, f.blockers)) continue
    const w = v * b[k + 3] * (kind === SACR_LIGHT_KIND.impulse ? .68 : .48), peak = w * Math.max(b[k], b[k + 1], b[k + 2])
    out.r += b[k] * w; out.g += b[k + 1] * w; out.b += b[k + 2] * w
    if (peak > out.strength) {
      const inv = 1 / Math.max(1, Math.sqrt(d2))
      out.strength = peak
      out.dx = dx * inv; out.dy = dy * inv; out.dz = dz * inv
    }
    if (kind === SACR_LIGHT_KIND.impulse && peak > out.strike) {
      out.strike = peak; out.strikeX = dx; out.strikeY = dy
    }
  }
  return out
}

/** Mirrors the support above; imported beside the incumbent section ray
 * mask, without changing the v4 uniform layout or the reflection union. */
export const SACR_LOCAL_GEOMETRY = `
vec2 sectionEmitter(vec2 p, vec4 a, vec4 s) {
  if(a.w!=${SACR_LIGHT_KIND.impulse}.)return a.xy;
  vec2 d=s.xy-a.xy;
  return a.xy+d*clamp(dot(p-a.xy,d)/max(.001,dot(d,d)),0.,1.);
}
float sectionFalloff(vec3 d,float r){
  float u=dot(d,d)/(r*r), f=max(0.,1.-u);
  return f*f/(1.+8.*u);
}
vec3 lightVector(vec2 delta,float depth){return vec3(delta,${COMBAT_SOURCE_Z}. - depth);}
`
