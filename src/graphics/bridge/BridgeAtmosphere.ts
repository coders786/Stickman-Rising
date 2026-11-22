import { cityPhase, citySeedScale } from './CityGeometry'
import type { BridgeGLTier } from '../sacr/BridgeBacking'
import { MOON_KEY } from './NoirGeometry'
import { CITY_GLOW, CITY_PERIOD, FAR_CITY, MID_CITY, mix, sat, skyHash, unit, type SkyBasis } from './SkyBasis'
import { DECK_MIST, HIGH_CLOUD, LUNAR_TAPS, LUNAR_TINT, SKY_ELEVATION_UNIT, SKY_HORIZON_V, STORM_CLOUD, cloudTransmission,
  lunarPhaseEnergy, lunarWeight, opticalTransmission, skyHazeDepth, stormAt } from './SkyOptics'

type SkyCamera = { x: number; y: number; zoom: number }
export type SkyWeather = { time: number; drift: number; cover: number; haze: number; flash: number }

export const LUNAR_VARIANTS = [
  { name: 'Porcelain full', radius: .049, phase: .22, warmth: -.03 },
  { name: 'Copper half', radius: .043, phase: 1.48, warmth: .16 },
  { name: 'Silver gibbous', radius: .040, phase: .83, warmth: 0 },
  { name: 'Ash crescent', radius: .035, phase: 1.91, warmth: .04 },
] as const
export const lunarVariant = (seed: number) => LUNAR_VARIANTS[seed & 3]

/** Viewed at infinity, on the same (upper-left) side as the baked lunar
 * key. Translating along the route cannot orbit, resize or wrap the moon. */
export function lunarProjection(w: number, h: number, seed: number) {
  const skyHeight = Math.max(1, h)
  // The sky camera widens vertically on narrow displays. Use the same
  // optics unit for both axes so the narrow crop doesn't stretch a bank.
  const focal = Math.min(h, w * 1.84)
  const x = w * .5 + MOON_KEY[0] * Math.min(w * .305, focal * (.404 + .063 * skyHash(seed, 5, 8)))
  const y = skyHeight * (1 - SKY_HORIZON_V) - focal * (.558 + .043 * skyHash(seed, 2, 88))
  return { x, y, radius: focal * lunarVariant(seed).radius, skyHeight, focal }
}

/** Frame state only. Weather, advection and travel remain on the run clock. */
export class BridgeAtmosphere {
  readonly moon = new Float32Array(4) // sky UV centre, x/y radii (round in CSS pixels)
  readonly highDeck = new Float32Array(4) // u offset, u scale, v offset, v scale
  readonly stormDeck = new Float32Array(4)
  readonly cloudPhase = new Float32Array(4) // signed gains of the baked evolution modes
  readonly mistDeck = new Float32Array(4)
  readonly stars = new Float32Array(2) // azimuth offset and scale
  readonly air = new Float32Array(4) // elevation at sky v=1, aerosols, cover, mist floor elevation
  readonly hazeColor = new Float32Array(3)
  readonly sun = new Float32Array(3)
  readonly lunarShift = new Float32Array(3) // added to nominal linear silver
  readonly lunarTurn = new Float32Array(2) // cos(angle)-1, sin(angle)
  readonly key = new Float32Array(4) // phase × transmitted flux, sheet flash, sweep phase, fixture flicker
  readonly glow = new Float32Array(3)
  readonly cityFar = new Float32Array(4) // X phase, X tiles across screen, base V, height / screen
  readonly cityMid = new Float32Array(4)
  readonly stormDir = new Float32Array(3)
  private readonly opticsHigh = new Float32Array(4)
  private readonly evolution = new Float32Array(4)
  private readonly opticsLow = new Float32Array(4)
  time = 0
  drift = 0
  skyHeight = 1
  moonX = 0
  moonY = 0
  radius = 1
  epicenter = .5
  stormFalloff = 2.32
  moonTransmission = 1
  centerTransmission = 1
  phaseEnergy = 1
  look = 0
  detailed = false
  wind = 0
  wake = 0
  seed = 0
  basis: SkyBasis | null = null

  update(basis: SkyBasis | null, cam: SkyCamera, w: number, h: number, seed: number, look: number,
    weather: SkyWeather, tier?: BridgeGLTier, hold = false): void {
    const t = weather.time
    this.basis = basis; this.seed = seed; this.time = t; this.drift = weather.drift; this.detailed = tier === 'master'
    const vista = Math.max(1, Math.min(h, h * .5 - cam.y * cam.zoom))
    const city = (out: Float32Array, p: typeof FAR_CITY, band: 0 | 1) => {
      const zoom = Math.min(1.15, Math.max(.82, cam.zoom ** .27))
      out[1] = w / (CITY_PERIOD * zoom)
      out[0] = unit(cityPhase(cam.x, seed, band) - out[1] * .5)
      out[2] = .5 - (p.lift - cam.y * p.vf) * cam.zoom / h
      out[3] = Math.min(p.size, p.aperture * vista) * citySeedScale(seed, band) / h
    }
    city(this.cityFar, FAR_CITY, 0); city(this.cityMid, MID_CITY, 1)
    if (!hold) {
      this.look = Math.max(0, Math.min(2, look))
      const { x, y, radius, skyHeight, focal } = lunarProjection(w, h, seed)
      this.skyHeight = skyHeight
      this.moonX = x; this.moonY = y; this.radius = radius
      this.moon[0] = x / w; this.moon[1] = 1 - y / skyHeight; this.moon[2] = radius / w; this.moon[3] = radius / skyHeight
      const span = w * SKY_ELEVATION_UNIT / focal, elev = skyHeight / focal
      const deck = (out: Float32Array, d: typeof STORM_CLOUD, salt: number, parallax: number, datum: number) => {
        out[0] = unit((parallax - weather.drift * d.wind - span * .5) / d.period + skyHash(seed, salt, 720))
        out[1] = span / d.period; out[3] = elev * SKY_ELEVATION_UNIT / d.height
        out[2] = d.offset - datum * out[3]
      }
      deck(this.highDeck, HIGH_CLOUD, 90, 0, SKY_HORIZON_V)
      deck(this.stormDeck, STORM_CLOUD, 170, 0, SKY_HORIZON_V)
      // Only low mist is at finite depth. Its base follows the world skyline.
      deck(this.mistDeck, DECK_MIST, 44, cam.x * DECK_MIST.parallax, this.cityMid[2])
      const circulation = (period: number, salt: number) => 2 * Math.PI * unit(t / period + skyHash(seed, salt, 1789))
      const a = circulation(157, 19), b = circulation(109, 93)
      this.cloudPhase[0] = .14 * Math.cos(a); this.cloudPhase[1] = .14 * Math.sin(a)
      this.cloudPhase[2] = .17 * Math.cos(b); this.cloudPhase[3] = .17 * Math.sin(b)
      this.stars[1] = span / 2180; this.stars[0] = unit(skyHash(seed, 0, 116) - this.stars[1] * .5)
      this.air[0] = elev; this.air[1] = sat(weather.haze); this.air[2] = sat(weather.cover)
      this.air[3] = h * this.cityMid[2] / focal
      const lunar = lunarVariant(seed), v = seed & 3, salt = skyHash(seed, 0, 419) - .5
      const direction = v === 2 || skyHash(seed, 7, 419) > .47 ? -1 : 1
      const phase = direction * (lunar.phase + salt * (v === 2 ? .34 : .15))
      const lift = .18 + .18 * skyHash(seed, 24, 104), xz = Math.sqrt(1 - lift * lift)
      this.sun[0] = Math.sin(phase) * xz; this.sun[1] = lift; this.sun[2] = Math.cos(phase) * xz
      // Libration is a seeded orientation of the *terrain*, not of the
      // terminator or cloud field. No accelerated orbit during play.
      const angle = (skyHash(seed, 30, 104) - .5) * .44
      this.lunarTurn[0] = Math.cos(angle) - 1; this.lunarTurn[1] = Math.sin(angle)
      const tint = lunar.warmth
      this.lunarShift[0] = tint; this.lunarShift[1] = tint * .16; this.lunarShift[2] = -tint * 1.34
      this.phaseEnergy = lunarPhaseEnergy(this.sun[2])
      this.centerTransmission = this.transmission(x / w, this.moon[1])
      let total = 0, open = 0
      for (const [dx, dy] of LUNAR_TAPS) {
        const gain = lunarWeight(dx, dy, this.sun)
        total += gain; open += gain * this.transmission(this.moon[0] + dx * this.moon[2], this.moon[1] + dy * this.moon[3])
      }
      this.moonTransmission = open / Math.max(.001, total)
      this.key[0] = this.phaseEnergy * this.moonTransmission; this.key[1] = sat(weather.flash)
      const idx = Math.min(1, Math.floor(this.look)), blend = this.look - idx
      for (let i = 0; i < 3; i++) this.glow[i] = mix(CITY_GLOW[idx][i], CITY_GLOW[idx + 1][i], blend)
      this.hazeColor[0] = .038 + this.glow[0] * .29
      this.hazeColor[1] = .054 + this.glow[1] * .22
      this.hazeColor[2] = .079 + this.glow[2] * .16
      // The flash fits within a single RouteWeather slot. Give it optical
      // width in both orientations; a narrow crop isn't a vertical bolt.
      this.epicenter = .5 + (skyHash(Math.floor(t / 8.8), 3, seed) - .5) * Math.min(.76, .98 * focal / w)
      this.stormFalloff = w / (.65 * focal)
      const lx = (this.epicenter - .5) * w / focal, len = Math.hypot(lx, .39, .82)
      this.stormDir[0] = lx / len; this.stormDir[1] = -.39 / len; this.stormDir[2] = .82 / len
    }
    // Fixture modulation is independent of the cached sky refresh.
    this.key[2] = unit(weather.drift * .006 + cam.x * .0006)
    const flicker = Math.sin(t * 31 + (seed & 255) * .12) * Math.sin(t * 13.7)
    this.key[3] = .96 + .035 * flicker + .018 * Math.sin(t * 4.4)
  }

  transmission(u: number, v: number): number {
    return cloudTransmission(this, u, v, this.opticsHigh, this.opticsLow, this.evolution) * opticalTransmission(skyHazeDepth(this.air[1], (v - SKY_HORIZON_V) * this.air[0]))
  }

  lightning(u: number): number { return stormAt(u, this.epicenter, this.key[1], this.stormFalloff) }

  receipt() { return { moonVis: this.key[0], moonTransmission: this.moonTransmission, centerTransmission: this.centerTransmission,
    phaseEnergy: this.phaseEnergy, moonVariant: lunarVariant(this.seed).name, moonTint: LUNAR_TINT.map((v, i) => v + this.lunarShift[i]), moonCss: [this.moonX, this.moonY], flash: this.key[1], lightningEpicenter: this.epicenter,
    lightningFalloff: this.stormFalloff, skyHeight: this.skyHeight, moonDiameterCss: this.radius * 2, parallax: 0 } }
}

/** Counts actual render submits. Mobile never delays an onset, moving flash
 * or its tail; seed changes and target replacement also refresh. */
export class StratumAClock {
  frames = 0
  updates = 0
  private flash = -1
  private seed = -1
  private width = 0
  private height = 0
  private quiet = false
  constructor(readonly tier: BridgeGLTier) {}
  advance(flash: number, seed: number, width: number, height: number, quiet = false): boolean {
    const changed = this.flash !== flash || this.seed !== seed || this.width !== width || this.height !== height || this.quiet !== quiet
    const refresh = this.tier === 'master' || changed || this.frames % 2 === 0
    this.frames++
    if (refresh) { this.updates++; this.flash = flash; this.seed = seed; this.width = width; this.height = height; this.quiet = quiet }
    return refresh
  }
  invalidate(): void { this.width = 0; this.height = 0 }
}
