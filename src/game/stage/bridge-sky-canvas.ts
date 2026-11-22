import { BridgeAtmosphere } from '../../graphics/bridge/BridgeAtmosphere'
import { CITY_MASK_H, CITY_MASK_W, sat, smoothRange, unit } from '../../graphics/bridge/SkyBasis'
import { AIR_FLASH, CanvasSkyOptics, CITY_DISTANCE, MIST_HEIGHT, MOON_DETAIL_FULL_R2, MOON_DETAIL_R2, cityAirFill, cityHazeDepth, opticalTransmission } from '../../graphics/bridge/SkyOptics'
import { hasPixels, type SurfaceScope } from '../render/ledger'
import { finishPaint } from '../render/paint-slices'
import { bridgePlate } from './bridge-webp'
import { BRIDGE_TOWERS } from '../../graphics/bridge/CityGeometry'
import { CITY_ACTIVITY_ROOMS, CITY_CARD_H, CITY_CARD_W, CITY_LIFTS, paintCityCard } from './bridge-city'
import { cityLiftPosition, cityRoomLight } from '../../graphics/bridge/CityActivity'

const ROW_BATCH = 8
const PATCH = 72, PATCH_R = Math.sqrt(MOON_DETAIL_R2), MIST_ROWS = 31, SKY_SLICES = 4
const SKY_COMPONENTS = ['moon', 'air', 'lunarTurn', 'lunarShift', 'hazeColor', 'sun', 'key', 'stars', 'highDeck', 'stormDeck', 'cloudPhase'] as const

function captureSky(to: BridgeAtmosphere, from: BridgeAtmosphere): void {
  // Copy only the optical pose, not a route, world clock or raster. Across
  // slices all rows and the detail patch see exactly this same atmosphere.
  for (const k of SKY_COMPONENTS) to[k].set(from[k])
  to.basis = from.basis; to.look = from.look; to.phaseEnergy = from.phaseEnergy; to.skyHeight = from.skyHeight
  to.moonX = from.moonX; to.moonY = from.moonY; to.radius = from.radius
  to.epicenter = from.epicenter; to.stormFalloff = from.stormFalloff
}

const CITY_W = 768, CITY_H = 156, CITY_STOPS = 6, FOG_STEPS = 1024
const grade = Uint8Array.from({ length: 4096 }, (_, i) => {
  const v = i * 1.06 / 2048, c = Math.min(1, v * (2.51 * v + .03) / (v * (2.43 * v + .59) + .14))
  return Math.round(255 * (c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055))
})
const output = (v: number) => grade[Math.min(4095, Math.max(0, Math.round(v * 2048)))]
const storePixel = (p: Uint8ClampedArray, i: number, rgb: Float32Array, a = 255) => {
  p[i] = output(rgb[0]); p[i+1] = output(rgb[1]); p[i+2] = output(rgb[2]); p[i+3] = a
}
const cityElevation = (a: BridgeAtmosphere, y: number) => (1 - y / a.skyHeight) * a.air[0] - a.air[3]
const transmissionAt = (a: BridgeAtmosphere, idx: 0 | 1, y: number) => opticalTransmission(cityHazeDepth(a.air[1], CITY_DISTANCE[idx], cityElevation(a, y)))
const CITY_BEACONS = BRIDGE_TOWERS.map(band => band.filter(t => t.mast).map(t => ({
  x: t.x + t.w - t.ledge * 1.26 - 2,
  y: t.crown + (t.landmark && t.id % 2 ? (t.w - t.ledge) * .18 * .38 : 0) - 9,
  offset: t.id * .17, period: 3.1 + t.id % 3 * .6,
})))
type Surface = OffscreenCanvas | HTMLCanvasElement
type CityCardCache = { surface: HTMLCanvasElement; image: HTMLImageElement | null; grade: Uint32Array; valid: boolean }

/** Bounded optical rasters (two cloud decks, lunar relief, and a thin volume
 * behind the rail). None is a copy of the frame or an overlay on the actors. */
export class BridgeCanvasSky {
  private readonly optics = new CanvasSkyOptics()
  private readonly bankOptics = new CanvasSkyOptics()
  private skyPose = new BridgeAtmosphere()
  private skyDraft = new BridgeAtmosphere()
  private skyGuard = ''
  private draftKey = ''
  private draftY = 0
  private readonly color = new Float32Array(3)
  private bankImage: ImageData | null = null
  private moonImage: ImageData | null = null
  private mistImage: ImageData | null = null
  private lastBank: Surface | null = null
  private lastMoon: Surface | null = null
  private lastMist: Surface | null = null
  private skyHash = ''
  private moonHash = ''
  private mistHash = ''
  private mistWidth = 0
  private readonly mistColors = new Uint8Array(192 * 3)
  private readonly cityCards: [CityCardCache?, CityCardCache?] = []
  private readonly cityGrade = new Uint32Array(CITY_STOPS * 2) // RGB24 and opacity per stop
  private readonly watched = new WeakSet<Surface>()
  constructor(private readonly scope: SurfaceScope) {}

  private watchRaster(surface: Surface): void {
    if (this.watched.has(surface)) return
    this.watched.add(surface)
    surface.addEventListener?.('contextrestored', () => {
      if (surface === this.lastBank) this.skyHash = ''
      if (surface === this.lastMoon) this.moonHash = ''
      if (surface === this.lastMist) this.mistHash = ''
      for (const card of this.cityCards) if (card?.surface === surface) card.valid = false
    })
  }

  draw(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number, h: number): void {
    finishPaint(this.drawSteps(ctx, a, w, h))
  }

  *drawSteps(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number, h: number, cold = false): Generator<void> {
    const [nx, ny] = w >= h ? [192, 80] : [104, 128]
    this.mistWidth = nx
    const bank = this.scope.tryAcquire('noir-sky', nx, ny, 'bridge-cloud-radiance')
    if (!hasPixels(bank)) { this.emergency(ctx, a, w); return }
    const g = bank.getContext('2d', { willReadFrequently: true })
    if (!g || g.isContextLost?.()) { this.skyHash = ''; this.emergency(ctx, a, w); return }
    this.watchRaster(bank)
    // Quantize at approximately raster-texel precision, not weather events.
    // Storm amplitude, viewport and basis arrival still invalidate at once.
    const q = (n: number, scale: number) => Math.round(n * scale)
    const common = `${a.seed}/${+!!a.basis}/${nx}/${ny}/${q(a.look,96)}/${q(a.highDeck[0],460)}/${q(a.stormDeck[0],620)}/${q(a.air[0],ny * 2)}/${q(a.air[1],128)}/${q(a.air[2],128)}/${q(a.epicenter,280)}/${q(a.key[1],255)}`
    const p = a.cloudPhase
    const key = `${common}/${q(p[0],180)},${q(p[1],180)},${q(p[2],180)},${q(p[3],180)}/${q(a.moonY,1)}/${q(a.radius,2)}/${w}/${h}`
    const guard = `${a.seed}/${w}/${h}`
    // First paint, asset arrival, resize, restored backing and lightning
    // are not amortized. Slow advection fits in four stripes. Old complete
    // pixels remain valid until the new bank AND lunar pose can publish.
    const immediate = !this.skyHash || bank !== this.lastBank || guard !== this.skyGuard ||
      a.basis !== this.skyPose.basis || a.key[1] > 0 || this.skyPose.key[1] > 0 ||
      Math.abs(a.look - this.skyPose.look) > .13 || Math.abs(a.air[1] - this.skyPose.air[1]) > .07
    if (key !== this.skyHash || bank !== this.lastBank || a.basis !== this.skyPose.basis || this.draftKey) {
      const old = this.bankImage
      const im = old?.width === nx && old.height === ny ? old : (this.bankImage = g.createImageData(nx, ny))
      const optics = this.bankOptics, pose = this.skyDraft, c = this.color
      if (immediate || !this.draftKey) {
        this.draftKey = key; this.draftY = 0
        captureSky(pose, a)
        optics.project(pose, nx, x => (x + .5) / nx)
      }
      const aa = Math.min(.24, .48 / Math.min(nx * pose.moon[2], ny * pose.moon[3]))
      const end = immediate ? ny : Math.min(ny, this.draftY + Math.ceil(ny / SKY_SLICES))
      for (let y = this.draftY, i = y * nx * 4; y < end; y++) {
        const row = optics.skyRow(pose, 1 - (y + .5) / ny, true)
        for (let x = 0; x < nx; x++, i += 4) {
          optics.skyColumn(pose, x, row, c, aa); storePixel(im.data, i, c)
        }
        if (cold && (y + 1) % ROW_BATCH === 0) yield
      }
      this.draftY = end
      if (end === ny) {
        // Don't claim a new version if an upload throws or loses its backing.
        this.skyHash = ''
        g.putImageData(im, 0, 0)
        if (g.isContextLost?.()) { this.emergency(ctx, a, w); return }
        this.skyHash = this.draftKey; this.skyGuard = guard; this.lastBank = bank
        this.draftKey = ''
        this.skyDraft = this.skyPose; this.skyPose = pose
      }
    }
    ctx.drawImage(bank, 0, 0, w, a.skyHeight)
    if (cold) yield
    yield* this.detail(ctx, this.skyPose, w, this.skyHash, cold)
  }

  private *detail(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number, key: string, cold: boolean): Generator<void> {
    const r = a.radius * PATCH_R
    if (a.moonX + r < 0 || a.moonX - r > w || a.moonY + r < 0 || a.moonY - r >= a.skyHeight) return
    const patch = this.scope.tryAcquire('noir-moon', PATCH, PATCH, 'bridge-lunar-optics')
    if (!hasPixels(patch)) return
    const g = patch.getContext('2d', { willReadFrequently: true })
    if (!g || g.isContextLost?.()) { this.moonHash = ''; return }
    this.watchRaster(patch)
    if (key !== this.moonHash || patch !== this.lastMoon) {
      this.moonHash = ''; this.lastMoon = patch
      const im = this.moonImage ??= g.createImageData(PATCH, PATCH), p = im.data, c = this.color
      const aa = Math.max(.022, .68 * (2 * PATCH_R / PATCH))
      this.optics.project(a, PATCH, x => sat(a.moon[0] + ((x + .5) * 2 / PATCH - 1) * PATCH_R * a.moon[2]))
      for (let y = 0, i = 0; y < PATCH; y++) {
        const my = ((y + .5) * 2 / PATCH - 1) * PATCH_R, v = sat(a.moon[1] - my * a.moon[3])
        const row = this.optics.skyRow(a, v, true)
        for (let x = 0; x < PATCH; x++, i += 4) {
          const mx = ((x + .5) * 2 / PATCH - 1) * PATCH_R, d = mx*mx + my*my
          if (d >= MOON_DETAIL_R2) { p[i+3] = 0; continue }
          // Replace a circular patch of the *composite*, not a painted moon
          // atop the bank. Both the dark limb and the cloud edge are local.
          this.optics.skyColumn(a, x, row, c, aa)
          storePixel(p, i, c, 255 * (1 - smoothRange(MOON_DETAIL_FULL_R2, MOON_DETAIL_R2, d)))
        }
        if (cold && (y + 1) % ROW_BATCH === 0) yield
      }
      g.putImageData(im, 0, 0)
      if (g.isContextLost?.()) return
      this.moonHash = key
    }
    ctx.drawImage(patch, a.moonX - r, a.moonY - r, r * 2, r * 2)
  }

  /** Only reached when the managed low-resolution store is unavailable. */
  private emergency(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number): void {
    const p = ctx.createLinearGradient(0, 0, 0, a.skyHeight)
    p.addColorStop(0, '#101725'); p.addColorStop(.55, '#242d3a'); p.addColorStop(1, '#3e4750')
    ctx.fillStyle = p; ctx.fillRect(0, 0, w, a.skyHeight)
    ctx.save(); ctx.translate(a.moonX, a.moonY); ctx.rotate(Math.atan2(-a.sun[1], a.sun[0]))
    const r = a.radius
    ctx.globalAlpha *= a.moonTransmission
    ctx.fillStyle = `rgb(${output(.54 + a.lunarShift[0])},${output(.56 + a.lunarShift[1])},${output(.60 + a.lunarShift[2])})`
    ctx.beginPath()
    ctx.ellipse(0, 0, r, r, 0, -Math.PI / 2, Math.PI / 2)
    ctx.ellipse(0, 0, Math.max(.001, r * Math.abs(a.sun[2])), r, 0, Math.PI / 2, -Math.PI / 2, a.sun[2] < 0)
    ctx.fill(); ctx.restore()
  }

  mist(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number): void {
    finishPaint(this.mistSteps(ctx, a, w))
  }

  *mistSteps(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number, cold = false): Generator<void> {
    if (!this.mistWidth) return
    const nx = this.mistWidth, ny = MIST_ROWS, store = this.scope.tryAcquire('noir-mist', nx, ny, 'bridge-mist-transmittance')
    if (!hasPixels(store)) return
    const g = store.getContext('2d', { willReadFrequently: true })
    if (!g || g.isContextLost?.()) { this.mistHash = ''; return }
    this.watchRaster(store)
    const q = (n: number, scale: number) => Math.round(n * scale)
    const key = `${a.seed}/${+!!a.basis}/${nx}/${q(a.mistDeck[0],540)}/${q(a.mistDeck[1],nx*2)}/${q(a.mistDeck[3],ny*2)}/${q(a.stormFalloff,120)}/${q(a.air[1],112)}/${q(a.look,64)}/${q(a.key[1],255)}/${q(a.epicenter,160)}`
    if (key !== this.mistHash || store !== this.lastMist) {
      this.mistHash = ''; this.lastMist = store
      const im = this.mistImage?.width === nx ? this.mistImage : (this.mistImage = g.createImageData(nx, ny)), p = im.data
      const colors = this.mistColors
      this.optics.project(a, nx, x => (x + .5) / nx, true)
      for (let x = 0, i = 0; x < nx; x++, i += 3) {
        const shot = .43 * a.lightning((x + .5) / nx)
        for (let k = 0; k < 3; k++) colors[i + k] = output(Math.fround(a.hazeColor[k] * 1.12 + AIR_FLASH[k] * shot))
      }
      for (let y = 0, i = 0; y < ny; y++) {
        const v = (a.air[3] + (1 - (y + .5) / ny) * MIST_HEIGHT) / a.air[0]
        const profile = this.optics.projectedMistRow(a, v)
        for (let x = 0, j = 0; x < nx; x++, i += 4, j += 3) {
          p[i] = colors[j]; p[i + 1] = colors[j + 1]; p[i + 2] = colors[j + 2]
          // Same lifted display opacity as the scalar Canvas path.
          p[i + 3] = 255 * this.optics.mistColumn(a, x, v, profile) ** .89
        }
        if (cold && (y + 1) % ROW_BATCH === 0) yield
      }
      g.putImageData(im, 0, 0)
      if (g.isContextLost?.()) return
      this.mistHash = key
    }
    const focal = a.skyHeight / a.air[0], height = focal * MIST_HEIGHT
    ctx.drawImage(store, 0, a.skyHeight - a.air[3] * focal - height, w, height)
  }

  private cityCard(a: BridgeAtmosphere, idx: 0 | 1, y: number, height: number, image: HTMLImageElement | null): HTMLCanvasElement | null {
    const store = this.scope.tryAcquire(`noir-city-air-${idx}`, CITY_W, CITY_H, 'bridge-city-aerial-perspective')
    if (!hasPixels(store)) return null
    this.watchRaster(store)
    let cache = this.cityCards[idx]
    if (cache?.surface !== store) cache = this.cityCards[idx] = { surface: store, image, grade: new Uint32Array(CITY_STOPS * 2), valid: false }
    const g = store.getContext('2d', { willReadFrequently: true })
    if (!g || g.isContextLost?.()) { cache.valid = false; return null }
    const next = this.cityGrade, c = a.hazeColor
    let changed = !cache.valid || cache.image !== image
    for (let i = 0; i < CITY_STOPS; i++) {
      const row = y + i / (CITY_STOPS - 1) * height, light = cityAirFill(cityElevation(a, row))
      const t = transmissionAt(a, idx, row), at = i * 2
      // Half an opacity bin changes a channel by at most 0.125 of an
      // 8-bit code value. Placement and the optical frame don't use bins.
      next[at] = output(c[0] * light) << 16 | output(c[1] * light) << 8 | output(c[2] * light)
      next[at+1] = Math.round((1 - t ** 1.12) * FOG_STEPS)
      changed ||= next[at] !== cache.grade[at] || next[at+1] !== cache.grade[at+1]
    }
    if (!changed) return store
    // Two stable sources, rather than repainting a shared backing twice
    // while its first image may still be queued for composition.
    cache.valid = false
    g.clearRect(0, 0, CITY_W, CITY_H)
    if (image) g.drawImage(image, 0, 0, CITY_W, CITY_H)
    else {
      g.save()
      try { g.scale(CITY_W / CITY_CARD_W, CITY_H / CITY_CARD_H[idx]); paintCityCard(g, idx) }
      finally { g.restore() }
    }
    const air = g.createLinearGradient(0, 0, 0, CITY_H)
    for (let i = 0; i < CITY_STOPS; i++) {
      const rgb = next[i * 2], opacity = next[i * 2 + 1] / FOG_STEPS
      air.addColorStop(i / (CITY_STOPS - 1), `rgba(${rgb >>> 16},${(rgb >>> 8) & 255},${rgb & 255},${opacity})`)
    }
    // Fog changes the radiance of the solid towers, not their coverage.
    g.globalCompositeOperation = 'source-atop'
    try { g.fillStyle = air; g.fillRect(0, 0, CITY_W, CITY_H) }
    finally { g.globalCompositeOperation = 'source-over' }
    if (g.isContextLost?.()) return null
    cache.grade.set(next); cache.image = image; cache.valid = true
    return store
  }

  city(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number, h: number): void {
    finishPaint(this.citySteps(ctx, a, w, h))
  }

  *citySteps(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number, h: number, cold = false): Generator<void> {
    for (const idx of [0, 1] as const) {
      const band = idx ? a.cityMid : a.cityFar, y = h * (1 - band[2] - band[3]), height = h * band[3]
      const span = w / band[1], start = -span * band[0]
      const img = bridgePlate(idx ? 'l2' : 'l1'), card = this.cityCard(a, idx, y, height, img), source = card ?? img
      ctx.save()
      // If the card surface was denied, blend toward the sky behind it
      // with the same depth order instead of drawing full-contrast glazing.
      if (!card) ctx.globalAlpha *= transmissionAt(a, idx, y + height * .65)
      for (let x = start; x < w; x += span) if (source) ctx.drawImage(source, x, y, span, height)
      else {
        ctx.save(); ctx.translate(x, y); ctx.scale(span / CITY_CARD_W, height / CITY_CARD_H[idx])
        paintCityCard(ctx, idx); ctx.restore()
      }
      if (a.key[1] > .025) {
        const ratio = span / CITY_CARD_W, scale = height / CITY_CARD_H[idx]
        for (let from = start; from < w; from += span) for (const tower of BRIDGE_TOWERS[idx]) {
          const x = from + tower.x * ratio, top = y + (tower.top - tower.ledge * .46) * scale
          if (x < -25 || x > w) continue
          const sx = Math.floor((tower.x + tower.w * .5) / CITY_CARD_W * CITY_MASK_W)
          const sy = Math.max(0, Math.min(CITY_MASK_H[idx] - 1, Math.floor((1 - tower.top / CITY_CARD_H[idx]) * CITY_MASK_H[idx])))
          const visible = (a.basis?.city[idx][(sy * CITY_MASK_W + sx) * 4 + 1] ?? 0) / 255
          const hit = a.lightning((x + tower.w * ratio * .5) / w) * visible * transmissionAt(a, idx, top)
          if (hit < .015) continue
          ctx.fillStyle = `rgba(179,193,204,${hit * (idx ? .31 : .20)})`
          ctx.fillRect(x + tower.ledge * ratio, top, (tower.w - tower.ledge * 1.5) * ratio, Math.max(.6, scale))
        }
      }
      ctx.restore()
      if (cold) yield
    }
  }
  /** Animate only bounded apertures, not the skyline. Both backings use
   * these same card coordinates over the fogged building plate. */
  life(ctx: CanvasRenderingContext2D, a: BridgeAtmosphere, w: number, h: number, quiet: boolean): void {
    const band = a.cityMid, y = h * (1 - band[2] - band[3]), span = w / band[1]
    const sx = span / CITY_CARD_W, sy = h * band[3] / CITY_CARD_H[1]
    for (let l = -band[0] * span; l < w; l += span) for (const shaft of CITY_LIFTS) {
      const x = l + (shaft.x + 1.6) * sx, width = (shaft.w - 3.2) * sx
      if (x + width < 0 || x > w || y + shaft.y * sy > h || y + shaft.bottom * sy < 0) continue
      const u = cityLiftPosition(shaft.id, a.seed, a.time, quiet)
      const top = y + (shaft.y + 1.1 + u * (shaft.bottom - shaft.y - 8.3)) * sy
      const air = transmissionAt(a, 1, top)
      ctx.globalAlpha = .43 * air
      ctx.fillStyle = '#737d74'; ctx.fillRect(x, top, width, 5.6 * sy)
      ctx.globalAlpha = .49 * air
      ctx.fillStyle = '#bdae8f'; ctx.fillRect(x + .4 * sx, top + .8 * sy, width - .8 * sx, .86 * sy)
    }
    if (!quiet) for (let l = -band[0] * span; l < w; l += span) for (const room of CITY_ACTIVITY_ROOMS) {
      const x = l + room.x * sx, top = y + room.y * sy
      if (x + room.w * sx < 0 || x > w || top < -7 || top > h) continue
      const level = cityRoomLight(room.id, a.seed, a.time)
      if (level <= .015) continue
      ctx.globalAlpha = .55 * level * transmissionAt(a, 1, top)
      ctx.fillStyle = '#b9a47e'; ctx.fillRect(x, top, room.w * sx, room.h * sy)
      ctx.fillStyle = '#656453'; ctx.fillRect(x + room.w * .71 * sx, top, room.w * .29 * sx, room.h * sy)
    }
    if (!quiet) for (const depth of [0, 1] as const) {
      const band = depth ? a.cityMid : a.cityFar, span = w / band[1]
      const y = h * (1 - band[2] - band[3]), sy = h * band[3] / CITY_CARD_H[depth]
      ctx.fillStyle = '#e6a18e'
      for (let l = -band[0] * span; l < w; l += span) for (const m of CITY_BEACONS[depth]) {
        const x = l + m.x * span / CITY_CARD_W, top = y + m.y * sy
        if (x < -2 || x > w + 2 || top < -2 || top > h) continue
        const k = 1 - smoothRange(.033, .17, unit(a.time / m.period + m.offset))
        if (k <= .01) continue
        ctx.globalAlpha = k * transmissionAt(a, depth, top) * (depth ? .40 : .26)
        ctx.fillRect(x - .85, top, 1.7, 1.5)
      }
    }
    ctx.globalAlpha = 1
  }
}
