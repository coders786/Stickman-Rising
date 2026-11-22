import { emission, POINT } from './emitters'
/** RibbonGI: two receiving planes in (world X, height, depth). The emitter is
 * a rectangular area light in the back lane, furniture is a silhouette in the
 * utility lane, and actors occupy the combat lane. Units are world pixels. */
import {
  falloff,
  liveGain,
  LIGHT_TINT,
  type PointLight,
} from '../world/lightfield'
import type { RoofProp } from '../world/roofprops'

const EMITTER_Z = -80,
  OCCLUDER_Z = -18
export const DECK_W = 96,
  DECK_H = 24
export interface Blocker {
  left: number
  right: number
  height: number
}
export function blockersFor(props: readonly RoofProp[]): Blocker[] {
  // A cable or an antenna is not a solid rectangle. Only opaque housings block light.
  return props
    .filter((p) => p.kind === 'barrier' || p.kind === 'cabinet')
    .map((p) => ({
      left: p.x - p.w / 2,
      right: p.x + p.w / 2,
      height: p.h - p.y,
    }))
    .sort((a, b) => a.left - b.left)
}
const sourceRadius = (l: PointLight) =>
  l.shape && l.shape.type !== 'rect' ? l.shape.sourceRadius : 5
export const halfAperture = (l: PointLight) =>
  l.shape?.type === 'rect' ? l.shape.width / 2 : sourceRadius(l)

/** Compile overlapping, ground-supported rectangles into a disjoint skyline.
 * This makes the projected blocker areas additive, even for overlapping props. */
function skyline(blocks: readonly Blocker[]): Blocker[] {
  const edges = [...new Set(blocks.flatMap((b) => [b.left, b.right]))].sort(
    (a, b) => a - b,
  )
  const result: Blocker[] = []
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1],
      right = edges[i]
    let height = 0
    for (const b of blocks)
      if (b.left < right && b.right > left) height = Math.max(height, b.height)
    if (height > 0) result.push({ left, right, height })
  }
  return result
}
export const halfHeight = (l: PointLight) =>
  l.shape?.type === 'rect' ? l.shape.height / 2 : sourceRadius(l)

/** Project the whole rectangular aperture onto the utility lane. The visible
 * fraction is one minus its intersection area with the compiled skyline. */
function visibility(
  l: PointLight,
  blocks: readonly Blocker[],
  x: number,
  h: number,
  z: number,
): number {
  if (l.kind === 'city' || !blocks.length || z <= OCCLUDER_Z) return 1
  const t = (z - OCCLUDER_Z) / (z - EMITTER_Z),
    cy = h + (-l.y - h) * t
  const cx = x + (l.x - x) * t,
    hw = halfAperture(l) * t,
    hh = halfHeight(l) * t
  const left = cx - hw,
    right = cx + hw,
    bottom = Math.max(0, cy - hh),
    top = cy + hh
  let covered = 0
  for (const b of blocks) {
    if (b.left >= right) break
    if (b.right <= left || bottom >= b.height) continue
    covered +=
      (Math.min(right, b.right) - Math.max(left, b.left)) *
      Math.max(0, Math.min(top, b.height) - bottom)
  }
  return Math.max(0, 1 - covered / (4 * hw * hh))
}

export function transfer(
  l: PointLight,
  blocks: readonly Blocker[],
  x: number,
  h: number,
  z: number,
): number {
  const d = Math.hypot(x - l.x, (h + l.y) * 0.54, (z - EMITTER_Z) * 0.6)
  return (
    falloff(d, l.radius) *
    emission(l.shape ?? POINT, x - l.x, -h - l.y, z - EMITTER_Z) *
    visibility(l, blocks, x, h, z)
  )
}

export interface SurfaceLight {
  local?: import('./receiver').ReceiverRig
  volume?: boolean
  r: number
  g: number
  b: number // linear incident energy, including first diffuse return
  dx: number
  dy: number
  keyX: number
  keyGain: number
  lunar?: number // explicitly supplied on the live Bridge; finite art keeps its authored rim
}
export interface Probe extends SurfaceLight {
  best: PointLight | null
  bestW: number
  dir: number
  warm: number
  cool: number
  neon: number
  city: number
  caster: PointLight | null
  castW: number
}
export function newProbe(): Probe {
  return {
    r: 0,
    g: 0,
    b: 0,
    dx: 0,
    dy: 0,
    keyX: 1,
    keyGain: 1,
    best: null,
    bestW: 0,
    dir: 1,
    warm: 0,
    cool: 0,
    neon: 0,
    city: 0,
    caster: null,
    castW: 0,
  }
}

/** A finite-support island instead of a world-sized 3D texture. Direct transfer
 * is stored at (x,height). First-bounce ground irradiance needs only one row:
 * height falloff is applied on lookup. Gains/flicker are NEVER baked. */
export class Ribbon {
  readonly cols: number
  readonly rows: number
  readonly left: number
  readonly top: number
  readonly direct: Uint8Array
  readonly returnRow: Uint8Array
  readonly xScale: number
  readonly hScale: number
  gain = 0
  constructor(
    readonly lamp: PointLight,
    readonly blocks: readonly Blocker[],
    spacing: number,
  ) {
    this.left = lamp.x - lamp.radius
    this.top = Math.max(1, -lamp.y + lamp.radius / 0.54)
    this.cols = 1 + Math.ceil((2 * lamp.radius) / spacing)
    this.rows = 1 + Math.ceil(this.top / (2 * spacing))
    this.xScale = (this.cols - 1) / (2 * lamp.radius)
    this.hScale = (this.rows - 1) / this.top
    this.direct = new Uint8Array(this.cols * this.rows)
    this.returnRow = new Uint8Array(this.cols)
    for (let row = 0; row < this.rows; row++)
      for (let col = 0; col < this.cols; col++) {
        const x = this.left + col / this.xScale,
          h = row / this.hScale
        this.direct[row * this.cols + col] = Math.round(
          255 * transfer(lamp, blocks, x, h, 0),
        )
      }
    // Three ground patches contribute diffuse return, including into a direct
    // shadow. Pull from the already traced ground row, not three new ray casts.
    const spread = Math.max(1, Math.round(38 * this.xScale))
    for (let i = 0; i < this.cols; i++)
      this.returnRow[i] = Math.round(
        (2 * this.direct[i] +
          this.direct[Math.max(0, i - spread)] +
          this.direct[Math.min(this.cols - 1, i + spread)]) /
          4,
      )
  }

  /** Bake floor irradiance and a rough specular lobe into ONE atlas strip. Depth
   * is foreshortened on display, not in the visibility test. */
  bakeDeck(pixels: Uint8ClampedArray, offset: number, wetness?: (x:number,v:number)=>number, reflective = true): void {
    const l = this.lamp,
      rgb = LIGHT_TINT[l.kind]
    for (let j = 0; j < DECK_H; j++)
      for (let i = 0; i < DECK_W; i++) {
        const u = (i + 0.5) / DECK_W,
          v = (j + 0.5) / DECK_H
        const x = this.left + u * 2 * l.radius,
          z = (v - .5) * 160,
          h = Math.abs(l.y)
        const dx = l.x - x,
          dz = EMITTER_Z - z,
          dist = Math.hypot(dx, h, dz) || 1
        // The platform takes a broader diffuse key, never a specular copy.
        let response = ((reflective ? .22 : .30) * h) / dist
        if (reflective) {
          // n dot normalize(L+V) for the planar wet surface and a fixed oblique eye.
          const ny = h / dist + 0.42, nz = dz / dist + 0.91
          const wet = wetness?.(x, v) ?? .65
          const gloss = (ny / (Math.hypot(dx / dist, ny, nz) || 1)) ** (12 + 42 * wet)
          response += (.15 + .86 * wet) * gloss
          // Broken vertical image in pooled water. World-locked micro-ripple.
          response += (l.kind === 'city' ? 0 : 1) * wet * (.45 + .55 * Math.sin(j * 2.7 + Math.sin(x * .051) * 1.7) ** 2) *
            Math.exp(-((dx / (9 + 24 * (1 - wet) + v * 33)) ** 2)) * .85
        }
        const energy = transfer(l, this.blocks, x, 0, z) * response * (1 - v * v)
        // Receiver cannot light a neighboring material. Reach zero at the
        // first/last texel so upsampling doesn't leave a bright curb cutoff.
        const t = Math.min(1, j / 3, (DECK_H - 1 - j) / 3)
        const edge = t * t * (3 - 2 * t)
        const k = offset + 4 * (j * DECK_W + i)
        pixels[k] = rgb[0]
        pixels[k + 1] = rgb[1]
        pixels[k + 2] = rgb[2]
        pixels[k + 3] = Math.round(255 * energy * edge)
      }
  }
}

export class RibbonField {
  readonly ribbons: Ribbon[]
  private clock = NaN
  constructor(
    lights: readonly PointLight[],
    blocks: readonly Blocker[],
    spacing = 10,
  ) {
    const sorted = skyline(blocks)
    this.ribbons = lights.map(
      (l) =>
        new Ribbon(
          l,
          sorted.filter(
            (b) => b.right >= l.x - l.radius && b.left <= l.x + l.radius,
          ),
          spacing,
        ),
    )
    this.tick(0)
  }
  tick(t: number): void {
    if (t === this.clock) return
    this.clock = t
    for (const r of this.ribbons) r.gain = liveGain(r.lamp, t)
  }
  sample(x: number, y: number, out: Probe): Probe {
    out.r =
      out.g =
      out.b =
      out.dx =
      out.dy =
      out.bestW =
      out.castW =
      out.warm =
      out.cool =
      out.neon =
      out.city =
        0
    out.best = out.caster = null
    out.dir = 1
    const h = Math.max(0, -y),
      bounce = 0.17 / (1 + h / 60) ** 2
    let runnerUp = 0
    for (const r of this.ribbons) {
      const l = r.lamp,
        u = (x - r.left) * r.xScale,
        v = h * r.hScale
      if (u < 0 || u >= r.cols - 1 || v >= r.rows - 1) continue
      const i = Math.floor(u),
        j = Math.floor(v),
        a = u - i,
        b = v - j,
        k = j * r.cols + i,
        d = r.direct
      const lo = d[k] + a * (d[k + 1] - d[k]),
        hi = d[k + r.cols] + a * (d[k + r.cols + 1] - d[k + r.cols])
      const w = ((lo + b * (hi - lo)) * r.gain) / 255
      const indirect =
        ((r.returnRow[i] + a * (r.returnRow[i + 1] - r.returnRow[i])) *
          r.gain *
          bounce) /
        255
      const rgb = LIGHT_TINT[l.kind],
        e = (w + indirect) / 255
      out.r += rgb[0] * e
      out.g += rgb[1] * e
      out.b += rgb[2] * e
      if (l.kind === 'bulb') out.warm += w
      else out[l.kind] += w
      const dx = l.x - x,
        dy = l.y - y,
        norm = w / Math.sqrt(dx * dx + dy * dy + 6400)
      out.dx += dx * norm
      out.dy += dy * norm + indirect
      if (w > out.bestW) {
        out.bestW = w
        out.best = l
        out.dir = x >= l.x ? 1 : -1
      }
      if (l.kind !== 'city' && y > l.y) {
        const cast = w * Math.min(1, (y - l.y) / 30)
        if (cast > out.castW) {
          runnerUp = out.castW
          out.castW = cast
          out.caster = l
        } else runnerUp = Math.max(runnerUp, cast)
      }
    }
    // Fade the practical's steering weight at a handoff. The one cast can
    // return through its key direction instead of jumping between lamps.
    out.castW = Math.max(0, out.castW - runnerUp)
    return out
  }
}
