import { CLOUD_H, CLOUD_PHASE_H, CLOUD_PHASE_ROW, CLOUD_PHASE_W, CLOUD_W, HORIZON_H, HORIZON_W, MOON_EDGE, MOON_UV_SCALE, mix, sat, smoothRange, unit } from './SkyBasis'
import type { BridgeAtmosphere } from './BridgeAtmosphere'

/** Optical units shared by both axes, independent of viewport orientation. */
export const SKY_ELEVATION_UNIT = 430
// Fixed optical horizon at 72% of the viewport height. The backdrop
// fills the viewport even if a jump lowers the world horizon below it.
export const SKY_HORIZON_V = .28
export const SKY_CACHE_CEILING = 1.39
export const HIGH_CLOUD = { period: 2020, height: 495, wind: 6.4, offset: .12 }
export const STORM_CLOUD = { period: 1720, height: 537, wind: 14.8, offset: .072 }
export const DECK_MIST = { period: 1216, height: 386, parallax: .46, wind: 22.6, offset: .34 }
export const MIST_HEIGHT = .52
export const CITY_DISTANCE = [1.62, .82] as const
/** City-only extinction. Even a clear night has an urban aerosol floor;
 * the street and sky keep their independent optical models. */
export const CITY_AIR = { clear: .165, haze: 1.16, high: .34, decay: 2.7, fill: .57, baseGlow: .19 } as const
export const MOON_DETAIL_R2 = 2.72
export const MOON_DETAIL_FULL_R2 = 1.58
export const LUNAR_TINT = [.94, .971, 1] as const
export const CIRRUS_TINT = [.78, .90, 1] as const
export const BANK_TINT = [.69, .83, 1] as const
export const FLASH_TINT = [.77, .87, 1] as const
export const AIR_FLASH = [.054, .079, .108] as const
export const LUNAR_TAPS = [[0, 0], [.64, 0], [-.64, 0], [0, .64], [0, -.64], [.44, .44], [-.44, .44], [.44, -.44], [-.44, -.44]] as const

/** Bilinear, repeat-X / clamp-in-slab-Y, byte-linear. No interpolation
 * across decks, look strips or the atlas boundary. Scratch is caller owned. */
export function sampleSkyPlane(tex: Uint8Array, w: number, h: number, layer: number, u: number, v: number, out: Float32Array, stride = w, offset = layer * h * w): void {
  const x = unit(u) * w - .5, y = sat(v) * (h - 1), ix = Math.floor(x), iy = Math.floor(y)
  // Repeated U was already wrapped to one tile. Only the outer half texel
  // can cross either edge, so the hot sampler needs no integer remainder.
  const fx = x - ix, fy = y - iy, sx = (ix < 0 ? w - 1 : ix) * 4, tx = (ix === w - 1 ? 0 : ix + 1) * 4
  const bottom = (offset + iy * stride) * 4, top = iy === h - 1 ? bottom : bottom + stride * 4
  for (let i = 0; i < 4; i++) out[i] = mix(mix(tex[bottom + sx + i], tex[bottom + tx + i], fx), mix(tex[top + sx + i], tex[top + tx + i], fx), fy) / 255
}

/** Separable address table for a rectangular raster. The same bilinear
 * footprint and Float32 channel results as sampleSkyPlane, but wrap,
 * floor and clamp are paid per column/row, not per texel per plane. */
class PlaneSpan {
  private cols = new Float64Array(0)
  private bottom = 0
  private top = 0
  private fy = 0
  constructor(private readonly w: number, private readonly h: number, private readonly stride = w, private readonly offset = 0) {}

  project(u: Float64Array, width: number, origin: number, scale: number): void {
    if (this.cols.length < width * 3) this.cols = new Float64Array(width * 3)
    const w = this.w, cols = this.cols
    for (let j = 0, i = 0; j < width; j++, i += 3) {
      const x = unit(origin + u[j] * scale) * w - .5, ix = Math.floor(x)
      cols[i] = (ix < 0 ? w - 1 : ix) * 4
      cols[i + 1] = (ix === w - 1 ? 0 : ix + 1) * 4
      cols[i + 2] = x - ix
    }
  }

  row(v: number): void {
    const y = sat(v) * (this.h - 1), iy = Math.floor(y)
    this.bottom = (this.offset + iy * this.stride) * 4
    this.top = iy === this.h - 1 ? this.bottom : this.bottom + this.stride * 4
    this.fy = y - iy
  }

  sample(tex: Uint8Array, i: number, out: Float32Array, offset = 0): void {
    const p = this.cols, sx = p[i], tx = p[i + 1], fx = p[i + 2], fy = this.fy
    const a = this.bottom + sx + offset, b = this.bottom + tx + offset, c = this.top + sx + offset, d = this.top + tx + offset
    for (let k = 0; k < 4; k++) out[k] = mix(mix(tex[a + k], tex[b + k], fx), mix(tex[c + k], tex[d + k], fx), fy) / 255
  }

  red(tex: Uint8Array, i: number): number {
    const p = this.cols, sx = p[i], tx = p[i + 1], fx = p[i + 2]
    return Math.fround(mix(mix(tex[this.bottom + sx], tex[this.bottom + tx], fx), mix(tex[this.top + sx], tex[this.top + tx], fx), this.fy) / 255)
  }
}

const phaseSpan = () => new PlaneSpan(CLOUD_PHASE_W, CLOUD_PHASE_H, CLOUD_W, CLOUD_PHASE_ROW * CLOUD_W + 1)
function evolve(out: Float32Array, evolution: Float32Array, f: Float32Array, i: number): void {
  const gain = 1 + (evolution[i] * 2 - 1) * f[i] + (evolution[i + 1] * 2 - 1) * f[i + 1]
  for (let k = 0; k < 4; k++) out[k] = sat(out[k] * gain)
}

function deckSample(a: BridgeAtmosphere, layer: 0 | 1, map: Float32Array, u: number, v: number, out: Float32Array, evolution?: Float32Array): void {
  const tx = map[0] + u * map[1], ty = map[2] + v * map[3]
  if (a.basis) {
    const data = a.basis.cloud
    sampleSkyPlane(data, CLOUD_W, CLOUD_H, layer, tx, ty, out)
    if (evolution) {
      sampleSkyPlane(data, CLOUD_PHASE_W, CLOUD_PHASE_H, 0, tx, ty, evolution, CLOUD_W, CLOUD_PHASE_ROW * CLOUD_W + 1)
      evolve(out, evolution, a.cloudPhase, layer * 2)
    }
  } else {
    // The startup/asset-denied scene still has a moon, cloud fronts and haze.
    const t = tx * 2 * Math.PI, curl = Math.sin(t * 3 + ty * 7) * .16
    const profile = layer ? smoothRange(.02, .32, ty) * (1 - smoothRange(.68, .91, ty)) : smoothRange(.32, .68, ty)
    const d = (.50 + .31 * Math.sin(t * 8 + curl + ty * 5) + .19 * Math.sin(t * 13 - ty * 2)) * profile
    const phase = evolution ? a.cloudPhase[layer * 2] : 0
    out[0] = d * (layer ? 1 : .30) * (1 + phase * Math.cos(t * 4 + ty * 3)); out[1] = (.49 - .29 * d) * profile; out[2] = d * .40; out[3] = d * .70
  }
}

const cirrusDepth = (mass: number, cover: number) => mass * (.48 + 1.10 * cover)
function stormDepth(mass: number, cover: number): number {
  const threshold = .57 - .35 * cover
  return (.49 + 6.5 * cover * cover) * smoothRange(threshold - .18, threshold + .30, mass)
}

export const opticalTransmission = (tau: number) => Math.exp(-Math.max(0, tau))
export const skyHazeDepth = (haze: number, z: number) => (.034 + .66 * haze) * Math.exp(-3.9 * Math.max(0, z))
export const cityHazeDepth = (haze: number, distance: number, z: number) =>
  (CITY_AIR.clear + CITY_AIR.haze * haze) * distance * (CITY_AIR.high + (1 - CITY_AIR.high) * Math.exp(-CITY_AIR.decay * Math.max(0, z)))
export const cityAirFill = (z: number) => CITY_AIR.fill + CITY_AIR.baseGlow * Math.exp(-5 * Math.max(0, z))
function mistProfile(haze: number, z: number): number {
  const profile = smoothRange(0, .055, z) * Math.exp(-5.9 * Math.max(0, z)) * (1 - smoothRange(.24, MIST_HEIGHT, z))
  return (.065 + haze * 1.58) * profile
}
const mistMass = (mass: number) => .24 + .93 * smoothRange(.16, .70, mass)
export function mistDepth(haze: number, z: number, mass: number): number {
  return mistProfile(haze, z) * mistMass(mass)
}

export function stormAt(u: number, epicenter: number, flash: number, falloff: number): number {
  const x = Math.max(0, 1 - Math.abs(u - epicenter) * falloff)
  return flash * x * x
}

export function cloudTransmission(a: BridgeAtmosphere, u: number, v: number, high: Float32Array, low: Float32Array, evolution: Float32Array): number {
  deckSample(a, 0, a.highDeck, u, v, high, evolution); deckSample(a, 1, a.stormDeck, u, v, low, evolution)
  return opticalTransmission(cirrusDepth(high[0], a.air[2]) + stormDepth(low[0], a.air[2]))
}

/** Diffuse moon phase integral. The visible fraction and radiance of a
 * lit sphere are not the same, especially at a crescent. */
export function lunarPhaseEnergy(cosPhase: number): number {
  const p = Math.max(-1, Math.min(1, cosPhase)), angle = Math.acos(p)
  return (Math.sin(angle) + (Math.PI - angle) * p) / Math.PI
}
export function lunarWeight(x: number, y: number, sun: ArrayLike<number>): number {
  return Math.max(0, x * sun[0] + y * sun[1] + Math.sqrt(Math.max(0, 1 - x * x - y * y)) * sun[2])
}

export function lunarRadiance(x: number, y: number, sun: ArrayLike<number>, reliefX: number, reliefY: number, albedo: number, ejecta: number): number {
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
  const gx = x + reliefX * .36 * z, gy = y + reliefY * .36 * z
  const len = Math.sqrt(gx * gx + gy * gy + z * z)
  const face = x * sun[0] + y * sun[1] + z * sun[2]
  const light = Math.max(0, (gx * sun[0] + gy * sun[1] + z * sun[2]) / Math.max(.01, len))
  // Geometric terminator + Lommel–Seeliger regolith. No artificial lit rim
  // or light bleeding through the sphere; only a weak Earthshine return.
  return albedo * (.0021 + smoothRange(-.026, .064, face) * (.59 * light + .78 * light / Math.max(.24, z + light))) + ejecta * light * .044
}

type SkyRow = { v: number; bandV: number; airT: number; ground: number; fallback: number; flash: number; moonY: number }

/** CPU counterpart to the low-resolution GLSL sky. Geometry, extinction
 * and in-scatter are applied back-to-front, not as screen overlays. */
export class CanvasSkyOptics {
  private readonly upper = new Float32Array(4)
  private readonly lower = new Float32Array(4)
  private readonly strip = new Float32Array(4)
  private readonly next = new Float32Array(4)
  private readonly lunar = new Float32Array(4)
  private readonly row: SkyRow = { v: 0, bandV: 0, airT: 1, ground: 0, fallback: 0, flash: 0, moonY: 0 }

  private readonly upperSpan = new PlaneSpan(CLOUD_W, CLOUD_H)
  private readonly lowerSpan = new PlaneSpan(CLOUD_W, CLOUD_H, CLOUD_W, CLOUD_H * CLOUD_W)
  private readonly upperPhase = phaseSpan()
  private readonly lowerPhase = phaseSpan()
  private readonly horizonSpan = new PlaneSpan(HORIZON_W, HORIZON_H)
  private readonly mistSpan = new PlaneSpan(CLOUD_W, CLOUD_H, CLOUD_W, CLOUD_H * CLOUD_W)
  private u = new Float64Array(0)
  private shots = new Float64Array(0)

  /** One projection per optical raster, not per animation frame. U and
   * lightning are also invariant down each column. No stale-frame reuse. */
  project(a: BridgeAtmosphere, width: number, coordinate: (x: number) => number, mist = false): void {
    if (this.u.length < width) { this.u = new Float64Array(width); this.shots = new Float64Array(width) }
    for (let x = 0; x < width; x++) { const u = this.u[x] = coordinate(x); this.shots[x] = a.lightning(u) }
    if (!a.basis) return
    const p = (span: PlaneSpan, map: Float32Array) => span.project(this.u, width, map[0], map[1])
    if (mist) { p(this.mistSpan, a.mistDeck); return }
    p(this.upperSpan, a.highDeck); p(this.upperPhase, a.highDeck)
    p(this.lowerSpan, a.stormDeck); p(this.lowerPhase, a.stormDeck)
    p(this.horizonSpan, a.stars)
  }

  skyColumn(a: BridgeAtmosphere, x: number, row: Readonly<SkyRow>, out: Float32Array, aa: number): void {
    this.skyOnRow(a, this.u[x], row, out, aa, x)
  }

  /** Scratch valid until the next row. Factor the exact elevation-only
   * terms once instead of re-evaluating exponentials for every column. */
  skyRow(a: BridgeAtmosphere, v: number, projected = false): Readonly<SkyRow> {
    const row = this.row, z = (v - SKY_HORIZON_V) * a.air[0]
    row.v = v; row.bandV = sat(z / .86)
    row.airT = opticalTransmission(skyHazeDepth(a.air[1], z))
    row.ground = .07 + .31 * (1 - sat(z))
    row.fallback = a.basis ? 0 : (1 - row.bandV) ** 1.72
    row.flash = a.key[1] > 0 ? .040 + .35 * Math.exp(-((z - .51) ** 2) * 10.8) : 0
    row.moonY = (v - a.moon[1]) / a.moon[3]
    if (projected && a.basis) {
      const hi = a.highDeck[2] + v * a.highDeck[3], low = a.stormDeck[2] + v * a.stormDeck[3]
      this.upperSpan.row(hi); this.upperPhase.row(hi)
      this.lowerSpan.row(low); this.lowerPhase.row(low)
      this.horizonSpan.row(row.bandV)
    }
    return row
  }

  sky(a: BridgeAtmosphere, u: number, v: number, out: Float32Array, aa: number): void {
    this.skyOnRow(a, u, this.skyRow(a, v), out, aa)
  }

  skyOnRow(a: BridgeAtmosphere, u: number, row: Readonly<SkyRow>, out: Float32Array, aa: number, column = -1): void {
    const d = a.basis, high = this.upper, low = this.lower, air = this.strip, more = this.next, lunar = this.lunar
    const { bandV, v, airT } = row, aerosol = a.air[1], cover = a.air[2]
    if (d) {
      const sector = Math.floor(a.look), blend = a.look - sector, stride = HORIZON_W * HORIZON_H * 4
      if (column >= 0) {
        const c = column * 3
        this.horizonSpan.sample(d.horizon, c, air, sector * stride)
        if (blend > 0) this.horizonSpan.sample(d.horizon, c, more, (sector + 1) * stride)
        this.upperSpan.sample(d.cloud, c, high); this.upperPhase.sample(d.cloud, c, this.lunar)
        evolve(high, this.lunar, a.cloudPhase, 0)
        this.lowerSpan.sample(d.cloud, c, low); this.lowerPhase.sample(d.cloud, c, this.lunar)
        evolve(low, this.lunar, a.cloudPhase, 2)
      } else {
        const starU = a.stars[0] + u * a.stars[1]
        sampleSkyPlane(d.horizon, HORIZON_W, HORIZON_H, sector, starU, bandV, air)
        if (blend > 0) sampleSkyPlane(d.horizon, HORIZON_W, HORIZON_H, sector + 1, starU, bandV, more)
        deckSample(a, 0, a.highDeck, u, v, high, this.lunar); deckSample(a, 1, a.stormDeck, u, v, low, this.lunar)
      }
      if (blend > 0) for (let i = 0; i < 4; i++) air[i] = mix(air[i], more[i], blend)
    } else {
      const h = row.fallback
      air[0] = .007 + .038 * h; air[1] = .011 + .047 * h; air[2] = .019 + .056 * h; air[3] = 0
      deckSample(a, 0, a.highDeck, u, v, high, more); deckSample(a, 1, a.stormDeck, u, v, low, more)
    }
    const t0 = opticalTransmission(cirrusDepth(high[0], cover)), t1 = opticalTransmission(stormDepth(low[0], cover))
    const x = (u - a.moon[0]) / a.moon[2], y = row.moonY, r2 = x*x + y*y
    let rim = 0, body = 0
    if (r2 < (1 + aa) ** 2) {
      rim = 1 - smoothRange(1 - aa, 1 + aa, Math.sqrt(r2))
      const c = 1 + a.lunarTurn[0], s = a.lunarTurn[1], tx = c*x + s*y, ty = -s*x + c*y
      if (d) {
        sampleSkyPlane(d.lunar, MOON_EDGE, MOON_EDGE, 0, sat(.5 + tx * MOON_UV_SCALE),
          sat(((.5 + ty * MOON_UV_SCALE) * MOON_EDGE - .5) / (MOON_EDGE - 1)), lunar)
      } else {
        lunar[0] = lunar[1] = .5; lunar[2] = .62 - .22 * Math.exp(-((x + .31) ** 2 + (y - .23) ** 2) * 5.8); lunar[3] = 0
      }
      const rx = lunar[0] * 2 - 1, ry = lunar[1] * 2 - 1
      body = lunarRadiance(x, y, a.sun, c*rx - s*ry, s*rx + c*ry, lunar[2], lunar[3])
    }
    const forward = a.phaseEnergy / (1 + r2 * .37) ** 2
    const lunarSpill = forward * (.020 + .098 * aerosol)
    const shot = column >= 0 ? this.shots[column] : a.lightning(u)
    const scatterHigh = (.023 + high[1] * .068 + high[2] * .021) * (1 + forward * .47)
    const scatterLow = .008 + low[1] * .113 + low[2] * .029 + forward * low[1] * .24
    const internal = shot * low[3] * row.flash * (.75 + low[1] * .67)
    const stars = air[3] * .040 * (1 - cover * .95)
    for (let i = 0; i < 3; i++) {
      const haze = a.hazeColor[i], tint = LUNAR_TINT[i], moon = tint + a.lunarShift[i]
      // Most of the night-sky glow is air in front of the dark limb.
      // The surface blocks the stars, not that foreground airglow.
      const source = mix(air[i] + stars * tint, body * moon + air[i] * .91, rim)
      let c = mix(scatterHigh * CIRRUS_TINT[i], source, t0) + shot * high[3] * .074 * tint
      c = mix(scatterLow * BANK_TINT[i] + haze * row.ground, c, t1) + internal * FLASH_TINT[i]
      out[i] = mix(haze, c, airT) + lunarSpill * moon * (t0*t1*.58 + (1 - t0*t1)*.15)
    }
  }

  mistRow(a: BridgeAtmosphere, v: number): number { return mistProfile(a.air[1], v * a.air[0] - a.air[3]) }

  projectedMistRow(a: BridgeAtmosphere, v: number): number {
    if (a.basis) this.mistSpan.row(a.mistDeck[2] + v * a.mistDeck[3])
    return this.mistRow(a, v)
  }

  mistColumn(a: BridgeAtmosphere, x: number, v: number, profile: number): number {
    if (profile <= 0) return 0
    if (!a.basis) return this.mist(a, this.u[x], v, profile)
    return 1 - opticalTransmission(profile * mistMass(this.mistSpan.red(a.basis.cloud, x * 3)))
  }

  mist(a: BridgeAtmosphere, u: number, v: number, profile = this.mistRow(a, v)): number {
    if (profile <= 0) return 0
    deckSample(a, 1, a.mistDeck, u, v, this.lower)
    return 1 - opticalTransmission(profile * mistMass(this.lower[0]))
  }
}
