/** Section atlas renderer. Three depths, two retained surfaces: the lower city
 * is attached to the parallax skyline; shoulder, asphalt and bridge fascia
 * share a world-space plate. Neither painting order nor coverage depends on LOD. */
import { mulberry32, smoothstep } from '../core/utils'
import { blitWorldFrustum, type ScreenBand } from '../render/bhst'
import { crossPhase, filmDepth, pooled, rutPhase, sampleWetFixture, waterFresnel, waterSlope, type WetFixture } from './sheet-water'
import type { GraphicsFeatures } from '../render/graphics'
import type { MoodPalette } from '../world/mood'
import type { ExposureMap } from '../world/exposure'
import { materialRamp, paintPlaneTone, type DeckFinish } from './baked-finish'
import { paintPlatform, paintStationRecess } from './station-art'
import { ROAD } from './road-section'

type Factory = (
  w: number,
  h: number,
) => { c: HTMLCanvasElement; g: CanvasRenderingContext2D }
const RAIL_TOP = ROAD.sidewalk - 19
const DISTRICT_W = 1024,
  DISTRICT_H = 320,
  OVERLAP = 42,
  REPEAT_H = 192,
  REPEAT_TOP = DISTRICT_H - REPEAT_H
const DEFAULT_ASPHALT = [.72, .89, 1] as const
const GUIDE_GLINT_PADDING = 72
const GUIDE_GLINT_INK = ['#76dbef', '#ffc184'] as const
const guideTint = (i: number): 0 | 1 => i % 3 === 1 ? 1 : 0
export class Viaduct {
  private readonly district: HTMLCanvasElement
  private readonly pierLight: HTMLCanvasElement | null
  private readonly span: HTMLCanvasElement
  private readonly water: HTMLCanvasElement | null
  private readonly patches: Float32Array
  private readonly guides: number[] = []
  private readonly guideWetness: Float32Array
  private readonly waterPhase: number

  static bakeDryRecess(make: Factory, tone: DeckFinish['district']): HTMLCanvasElement {
    const { c, g } = make(DISTRICT_W, DISTRICT_H)
    paintStationRecess(g, DISTRICT_W, DISTRICT_H, tone)
    return c
  }

  constructor(
    seed: number,
    private x0: number,
    width: number,
    pal: MoodPalette,
    make: Factory,
    private readonly asphalt: readonly [number, number, number] = DEFAULT_ASPHALT,
    private readonly finish?: DeckFinish,
    dryRecess?: HTMLCanvasElement,
    fixtures: readonly WetFixture[] = [],
    private readonly exposure?: ExposureMap,
  ) {
    const rng = mulberry32(seed ^ 0x41e57),
      n = Math.ceil(width / 96) + 2
    this.waterPhase = (seed % 8191) * .071
    this.patches = finish?.surface === 'dry-platform' ? new Float32Array(0) : Float32Array.from({ length: n }, () => rng())
    if (finish?.surface === 'dry-platform') {
      this.district = dryRecess ?? Viaduct.bakeDryRecess(make, finish.district)
      const span = make(width, ROAD.soffit - RAIL_TOP)
      this.span = span.c
      span.g.translate(0, -RAIL_TOP)
      paintPlatform(span.g, width, finish)
      this.pierLight = this.water = null
      this.guideWetness = new Float32Array(0)
      return
    }
    const district = make(DISTRICT_W, DISTRICT_H)
    this.district = district.c
    this.paintDistrict(district.g, pal, rng)
    const span = make(width, ROAD.soffit - RAIL_TOP + 20)
    this.span = span.c
    // One shared soffit worklight sprite. Its amber core catches the concrete
    // face, while the soft tail only scatters into the open pier bay.
    const light = make(112, 134),
      lg = light.g
    this.pierLight = light.c
    lg.save()
    lg.translate(50, 4)
    lg.scale(52, 125)
    const wash = lg.createRadialGradient(0, 0, 0, 0, 0, 1)
    wash.addColorStop(0, 'rgba(255,184,98,.61)')
    wash.addColorStop(0.21, 'rgba(230,124,54,.24)')
    wash.addColorStop(0.67, 'rgba(158,66,38,.07)')
    wash.addColorStop(1, 'rgba(158,66,38,0)')
    lg.fillStyle = wash
    lg.fillRect(-1, 0, 2, 1)
    lg.restore()
    lg.fillStyle = '#d29f69'
    lg.fillRect(42, 4, 16, 2)
    lg.fillStyle = '#44372d'
    lg.fillRect(40, 2, 20, 2)
    this.paintSpan(span.g, width, pal, rng, seed, fixtures)
    if (finish?.surface === 'wet-asphalt') {
      // The receiver is now the road's material bake. Only the legacy
      // capture path needs a projection mask or time-varying guide glints.
      this.guideWetness = new Float32Array(0)
      this.water = null
      return
    }
    this.guideWetness = Float32Array.from(this.guides, x => this.wetness(x + this.x0, .58))
    const mask = make(Math.ceil(width / 4), 26)
    this.water = mask.c
    const alpha = mask.g.createImageData(mask.c.width, mask.c.height)
    for (let y = 0; y < mask.c.height; y++) {
      const v = y / (mask.c.height - 1)
      const depth = Math.max(0, 2 * v - 1)
      // Soft toe and tail: no bright straight line along the contact rail.
      const envelope = Math.min(1, 9 * depth) * (1 - depth) ** 1.6
      for (let x = 0; x < mask.c.width; x++) {
        const worldX = x * width / mask.c.width + x0
        const wet = this.wetness(worldX, v)
        const i = (y * mask.c.width + x) * 4
        // A rough/dry patch can take some scattered light, but does not
        // carry a clear virtual image. Match the pools under the markings.
        alpha.data[i + 3] = Math.round(255 * envelope * (.33 + .67 * wet))
      }
    }
    mask.g.putImageData(alpha, 0, 0)
  }
  private patchPosition(x: number): number {
    return Math.max(0, Math.min(this.patches.length - 1.001, (x - this.x0) / 96))
  }

  private patchEnergy(u: number): number {
    const i = Math.floor(u), f = u - i
    const t = f * f * (3 - 2 * f)
    return (this.patches[i] + t * (this.patches[i + 1] - this.patches[i])) ** 2
  }

  private wetDepth(u: number, energy: number, v: number): number {
    return Math.max(0.06, Math.min(0.95, energy * (0.54 + 0.46 * Math.cos(v * 14 + u) ** 2) + 0.08))
  }

  /** Broad, coherent puddles. Use the same field for the road bake and live
   * specular light; baking can reuse the longitudinal sample for a column. */
  wetness = (x: number, v: number): number => {
    if (!this.patches.length || !this.acceptsWater(x)) return 0
    const u = this.patchPosition(x)
    const basin = this.patchEnergy(u)
    return this.finish?.surface === 'wet-asphalt'
      ? filmDepth(v, basin, crossPhase(x, this.waterPhase), rutPhase(x, this.waterPhase))
      : this.wetDepth(u, basin, v)
  }
  private acceptsWater(x: number): boolean {
    return !this.exposure || this.exposure.at(x).material === 'wet-asphalt'
  }

  private paintDistrict(
    g: CanvasRenderingContext2D,
    p: MoodPalette,
    r: () => number,
  ) {
    // A staggered upper contour OVERLAPS the last skyline row. Every column
    // becomes opaque before the old baseline; no camera-sized clearing band.
    for (let x = 0; x < DISTRICT_W; ) {
      const w = Math.ceil(48 + r() * 96),
        top = 6 + Math.floor(r() * 33),
        tone = Math.floor(19 + r() * 13)
      g.fillStyle = `rgb(${tone - 5},${tone + 4},${tone + 16})`
      g.fillRect(x, top, w, DISTRICT_H - top)
      g.fillStyle = 'rgba(8,16,25,.48)'
      g.fillRect(x + w * 0.69, top, w * 0.31, DISTRICT_H - top)
      g.fillStyle = 'rgba(149,184,205,.26)'
      g.fillRect(x, top, w, 1)
      const family = Math.floor(r() * 3)
      const pitch = [12, 16, 24][family]
      // Service crown, mullioned slab, and terraced mechanical level.
      g.fillStyle = `rgb(${tone},${tone + 8},${tone + 16})`
      if (family === 0) {
        g.fillRect(x + w * .18, top - 4, w * .51, 6)
        g.fillRect(x + w * .26, top - 6, 2, 6)
      } else if (family === 1) {
        for (let ix = x + 12; ix < x + w - 4; ix += 15) g.fillRect(ix, top, 1, DISTRICT_H - top)
      } else {
        g.fillRect(x + w * .36, top - 5, w * .32, 7)
        g.fillRect(x + w * .44, top - 8, w * .14, 4)
      }
      for (let y = top + 6; y < DISTRICT_H; y += pitch) {
        g.fillStyle = 'rgba(6,14,23,.35)'
        g.fillRect(x, y + 4, w, 2)
        for (let xx = x + 5; xx < x + w * 0.66 - 4; xx += 9) {
          const k = r()
          g.fillStyle =
            k > 0.84
              ? `rgba(${p.highlight},.46)`
              : k > 0.48
                ? `rgba(${p.pop2},.22)`
                : 'rgba(80,109,127,.25)'
          g.fillRect(xx, y, family === 2 ? 7 : 4, family === 1 ? 3 : 2)
        }
      }
      x += w
    }
    // Height-dependent in-scattering: A=1-exp(-optical depth). Restrict
    // fog to existing facade pixels so the ragged roofline stays transparent.
    g.globalCompositeOperation = 'source-atop'
    const fog = g.createLinearGradient(0, 0, 0, REPEAT_TOP)
    for (let i = 0; i <= 8; i++) {
      const t = i / 8
      fog.addColorStop(
        t,
        `rgba(55,76,99,${(1 - t) * (1 - Math.exp(-1.2 * Math.exp(-3 * t)))})`,
      )
    }
    g.fillStyle = fog
    g.fillRect(0, 0, DISTRICT_W, DISTRICT_H)
    if (this.finish) {
      paintPlaneTone(g, DISTRICT_W, DISTRICT_H, this.finish.district)
      // Receive warm city scatter at the crown, but let the lower repeated
      // floors and silhouette gaps keep their original opacity.
      const bounce = g.createLinearGradient(0, OVERLAP - 12, 0, REPEAT_TOP)
      bounce.addColorStop(0, 'rgba(214,149,109,.17)')
      bounce.addColorStop(.43, 'rgba(161,112,82,.078)')
      bounce.addColorStop(1, 'rgba(161,112,82,0)')
      g.fillStyle = bounce
      g.fillRect(0, 0, DISTRICT_W, REPEAT_TOP)
    }
    g.globalCompositeOperation = 'source-over'
  }
  drawDistrict(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    m: number,
    baseline: number,
  ) {
    const top = baseline - OVERLAP,
      offset = ((m % DISTRICT_W) + DISTRICT_W) % DISTRICT_W
    // Repeat only the un-fogged lower floors. Their pitches divide REPEAT_H;
    // no bright band or cut floor appears when a tall view exposes the join.
    for (let x = -offset; x < w; x += DISTRICT_W) {
      ctx.drawImage(this.district, x, top)
      for (let y = top + DISTRICT_H; y < h; y += REPEAT_H)
        ctx.drawImage(
          this.district,
          0,
          REPEAT_TOP,
          DISTRICT_W,
          REPEAT_H,
          x,
          y,
          DISTRICT_W,
          REPEAT_H,
        )
    }
  }
  private paintSpan(
    g: CanvasRenderingContext2D,
    w: number,
    p: MoodPalette,
    r: () => number,
    seed: number,
    fixtures: readonly WetFixture[],
  ) {
    const dh = ROAD.front - ROAD.rear,
      img = g.createImageData(w, dh)
    // Finite amber and cyan guide strips set into the curb. Bake their low-angle
    // indirect bounce and reflection at the same positions as the lenses.
    const guides = this.guides
    for (let x = 60; x < w; x += 205 + r() * 186) {
      const centre = this.x0 + Math.round(x)
      if (!this.exposure || this.exposure.exposed.some(zone => centre - 27 >= zone.left && centre + 27 < zone.right)) guides.push(Math.round(x))
    }
    // Pure depth terms are constant across a row. Keep the same per-pixel
    // grain sample order and numeric precision as the authored bake.
    const track = new Float64Array(dh), curb = new Float64Array(dh)
    for (let y = 0; y < dh; y++) {
      const v = y / dh
      track[y] = Math.exp(-((v - 0.31) ** 2) / 0.004) + Math.exp(-((v - 0.72) ** 2) / 0.006)
      curb[y] = Math.exp(-y / 4)
    }
    const film = this.finish?.surface === 'wet-asphalt'
    const fresnel = film ? Float64Array.from({ length: dh }, (_, y) => waterFresnel(y / dh)) : []
    const mirror = new Float64Array(4)
    let nearest = 0
    for (let x = 0; x < w; x++) {
      if (
        nearest + 1 < guides.length &&
        x > (guides[nearest] + guides[nearest + 1]) / 2
      )
        nearest++
      const ice = guideTint(nearest) === 0,
        halfLens = ice ? 22 : 13
      const d = Math.max(0, Math.abs(x - guides[nearest]) - halfLens)
      const worldX = x + this.x0
      // Covered columns are finished with their matte insert in the same
      // atlas. Don't even evaluate the water/fixture return under a roof.
      if (!this.acceptsWater(worldX)) continue
      const u = this.patchPosition(worldX), energy = this.patchEnergy(u)
      const cross = film ? crossPhase(worldX, this.waterPhase) : 0, rut = film ? rutPhase(worldX, this.waterPhase) : 0
      // The authored practicals do not overlap in reflection space.
      const fixture = film ? fixtures.find(f => worldX >= f.left - 8 && worldX <= f.left + f.image.width + 8) : undefined
      for (let y = 0; y < dh; y++) {
        const v = y / dh, worldY = y + ROAD.rear,
          wet = film ? filmDepth(v, energy, cross, rut) : this.wetDepth(u, energy, v),
          pool = film ? pooled(wet) : 0,
          k = (y * w + x) * 4
        // Cool diffuse skylight, occluded at the curb; oily tyre tracks and
        // aggregate grain use independent frequencies, never an animated filter.
        const value =
          43 +
          8 * v -
          11 * wet -
          6 * track[y] -
          13 * curb[y] +
          (r() - 0.5) * (9 - 5 * wet)
        // A streak inherits the colour and width of its lens. Break the
        // reflection into wavelets without resampling noise on moving frames.
        const slope = film ? waterSlope(worldX, worldY) : 0
        const ripple = film ? .5 + .5 * slope : .5 + .5 * Math.sin(y * 1.92 + 2 * Math.sin(x * .036 + y * .075))
        const breadth = 8 + (1 - wet) * 18 + v * 19,
          shine =
            // The diffuse pool still reaches dry asphalt; the sharp image
            // needs pooled water. Reuse the mask and ripple already sampled.
            (film ? .12 + 1.18 * pool : .24 + .8 * wet) *
            (0.16 + 1.25 * ripple ** 3) *
            Math.exp((-d * d) / (breadth * breadth) - y / 52)
        const bounce = 1 / (1 + (d / 36) ** 2 + (y / 14) ** 2)
        const e = 47 * bounce + 108 * shine
        let reflectedR = 115, reflectedG = 152, reflectedB = 179
        let sheen: number, rim = 0
        if (film) {
          sheen = (.022 + .68 * pool) * (.58 + .93 * fresnel[y]) * (.92 + .13 * ripple)
          // Angular sky return interrupted by two dark rails and their
          // posts. This is below paint, grates and grout, not a UI overlay.
          const railY = worldY + 1.9 * slope
          const rail = Math.max(0, 1 - Math.abs(railY + 31) / 2) + .65 * Math.max(0, 1 - Math.abs(railY + 23) / 1.4)
          const postX = (x + 61 + slope * 2.3) % 67
          const post = railY > -34 && railY < -20 ? Math.max(0, 1 - Math.abs(postX - 2) / 2.8) : 0
          const sparkle = .35 + .65 * Math.sin(worldX * .045 + worldY * .17) ** 2
          const sky = .90 + .15 * (1 - v) + .22 * sparkle * ripple ** 4 - .34 * rail - .40 * post
          reflectedR = 59 * sky
          reflectedG = 88 * sky
          reflectedB = 114 * sky
          if (fixture) {
            mirror.fill(0)
            sampleWetFixture(fixture, worldX, worldY, slope, mirror)
            // Lamp amber and the sign's broken, inverted glyphs are actual
            // radiance from the body art. The unlit poles darken the sky.
            reflectedR = reflectedR * (1 - mirror[3]) + mirror[0] * 1.05
            reflectedG = reflectedG * (1 - mirror[3]) + mirror[1] * .96
            reflectedB = reflectedB * (1 - mirror[3]) + mirror[2]
          }
          // A narrow meniscus, lit only on the crest, rather than a white
          // outline around the puddle. Sparse scratches remain matte.
          rim = 18 * smoothstep(1 - Math.abs(wet - .44) / .048) * ripple ** 4
        } else {
          sheen = wet > .32 ? .19 * (wet - .32) * Math.sin((x / 4 + 9 * v) * .34) ** 4 : 0
        }
        const base = 1 - sheen, scatter = film ? e * (1 - .34 * sheen) : e
        img.data[k] = (value * this.asphalt[0] + scatter * (ice ? .15 : 1)) * base + reflectedR * sheen + rim * .65
        img.data[k + 1] = (value * this.asphalt[1] + 2 + scatter * (ice ? .82 : .52)) * base + reflectedG * sheen + rim * .86
        img.data[k + 2] = (value * this.asphalt[2] + 11 + scatter * (ice ? 1 : .16)) * base + reflectedB * sheen + rim
        img.data[k + 3] = 255
      }
    }
    g.putImageData(img, 0, ROAD.rear - RAIL_TOP)
    g.translate(0, -RAIL_TOP)
    const rect = (
      x: number,
      y: number,
      ww: number,
      hh: number,
      color: string,
    ) => {
      g.fillStyle = color
      g.fillRect(x, y, ww, hh)
    }
    // Crash rail in elevation, with an open slot onto the district behind it.
    if (this.finish) this.paintTrim(g, w, this.finish)
    else {
      rect(0, RAIL_TOP, w, 2, this.asphalt === DEFAULT_ASPHALT ? '#687780' : '#515e68')
      rect(0, RAIL_TOP + 2, w, 3, '#28343e')
      rect(0, RAIL_TOP + 11, w, 3, '#34414b')
      for (let x = 7; x < w; x += 67) {
        rect(x, RAIL_TOP + 4, 3, 16, '#25313b')
        rect(x, RAIL_TOP + 4, 1, 16, '#596771')
        if (x % 3 === 1)
          rect(x + 1, RAIL_TOP + 1, 6, 2, `rgba(${p.highlight},.85)`)
      }
      rect(0, ROAD.sidewalk, w, 14, '#343e48')
      rect(0, ROAD.rear - 5, w, 5, '#171e27')
      rect(0, ROAD.rear - 5, w, 1, '#75818a')
      for (let x = 0; x < w; x += 51) {
        rect(x, ROAD.sidewalk, 1, 10, '#212c37')
      }
    }
    rect(0, -47, w, 1, 'rgba(211,186,129,.26)')
    for (let x = 14; x < w; x += 91) rect(x, 46, 64, 1.3, 'rgba(205,209,205,.30)')
    for (const [i, cx] of guides.entries()) {
      const ice = guideTint(i) === 0,
        half = ice ? 22 : 13,
        ink = ice ? '48,209,255' : '255,164,67'
      rect(cx - half - 3, -57, 2 * half + 6, 4, '#0d151e')
      g.save()
      g.shadowColor = `rgb(${ink})`
      g.shadowBlur = 8
      rect(cx - half, -55, half * 2, 1.8, ice ? '#9cf5ff' : '#ffce84')
      g.restore()
    }
    // Interrupted paint, not a continuous horizontal shelf under the soles.
    for (let x = 13; x < w; x += 119) {
      rect(x, -12, 54, 1.8, '#9d9576')
      for (let i = 0; i < 8; i++) rect(x + r() * 52, -12, r() * 2, 1, '#41454a')
    }
    for (let x = 38; x < w; x += 191 + r() * 120) {
      const y = ROAD.rear + 4
      rect(x, y, 20, 4, '#151d25')
      for (let i = 0; i < 6; i++) rect(x + i * 3.2, y, 1, 3, '#495563')
      for (let i = 0; i < 9; i++) {
        const px = x + r() * 70,
          py = -39 + r() * 75
        rect(
          px,
          py,
          2 + r() * 17,
          0.55,
          `rgba(163,192,207,${0.07 + 0.17 * this.wetness(px + this.x0, (py + 52) / 104)})`,
        )
      }
    }
    for (let x = 130; x < w; x += 375 + r() * 230) {
      const y = 13 + r() * 10
      g.fillStyle = '#161f28'
      g.beginPath()
      g.ellipse(x, y, 17, 4.6, 0, 0, 2 * Math.PI)
      g.fill()
      g.strokeStyle = '#59616a'
      g.lineWidth = 0.75
      g.stroke()
      for (let i = -2; i <= 2; i++) rect(x - 11, y + i, 21, 0.45, '#444f58')
    }
    // Perspective arrow transfers: foreshorten the arrowhead as well as the stem.
    for (let x = 300; x < w; x += 690) {
      g.fillStyle = 'rgba(211,212,193,.58)'
      g.beginPath()
      g.moveTo(x, 18)
      g.lineTo(x + 30, 18)
      g.lineTo(x + 26, 14)
      g.lineTo(x + 49, 20)
      g.lineTo(x + 26, 26)
      g.lineTo(x + 30, 22)
      g.lineTo(x, 22)
      g.closePath()
      g.fill()
    }
    g.save()
    g.transform(1, 0, -0.5, 0.52, 0, 0)
    g.font = 'bold 13px monospace'
    g.fillStyle = 'rgba(201,208,200,.50)'
    for (let x = 80; x < w; x += 520)
      g.fillText(`TRANSIT   //   ${String(((seed >>> 5) % 90) + 10)}`, x, 54)
    g.restore()
    // Front girder and tapered support piers. Open bays show the city below.
    const steel = g.createLinearGradient(0, 52, 0, 82)
    steel.addColorStop(0, '#45515a')
    steel.addColorStop(0.15, '#27313b')
    steel.addColorStop(0.88, '#151e28')
    steel.addColorStop(1, '#35424b')
    g.fillStyle = steel
    g.fillRect(0, 52, w, 30)
    if (this.finish) {
      g.fillStyle = materialRamp(g, 0, 52, 0, 61, this.finish.metal)
      g.fillRect(0, 52, w, 9)
      rect(0, 52, w, 1, 'rgba(190,205,208,.22)')
      rect(0, 60, w, 1, '#121a22')
      // Plate seams and a fastener pair read as construction, not a UI stripe.
      for (let x = 16; x < w; x += 184) {
        rect(x, 54, 1.4, 24, '#121921')
        rect(x + 1.4, 54, 1, 23, '#46545e')
        rect(x + 5, 63, 2, 2, '#677985')
        rect(x + 5, 71, 2, 2, '#495963')
      }
    } else rect(0, 53, w, 1, '#697480')
    rect(0, 76, w, 2, '#101923')
    for (let x = 0; !this.finish && x < w; x += 92) {
      rect(x, 57, 2, 17, '#141d25')
      rect(x + 2, 57, 1, 15, '#4d5960')
      rect(x + 7, 59, 2, 2, '#71828c')
    }
    for (let x = 46; x < w; x += 287) {
      rect(x, 63, 17, 2, `rgba(${p.highlight},.72)`)
      rect(x - 2, 65, 21, 2, '#161d24')
    }
    for (let x = 60; x < w; x += 380) {
      g.fillStyle = '#18232d'
      g.beginPath()
      g.moveTo(x - 30, 82)
      g.lineTo(x + 33, 82)
      g.lineTo(x + 15, 99)
      g.lineTo(x + 15, 136)
      g.lineTo(x - 11, 136)
      g.lineTo(x - 11, 99)
      g.fill()
      rect(x - 11, 99, 4, 37, '#33434f')
    }
  }
  /** Strips, occluded mounts and bevels on the existing span atlas. The gap
   * between the rails stays open; no silhouettes or receivers move. */
  private paintTrim(g: CanvasRenderingContext2D, w: number, paint: DeckFinish): void {
    const curb = ROAD.sidewalk
    g.fillStyle = materialRamp(g, 0, curb, 0, ROAD.rear, paint.masonry)
    g.fillRect(0, curb, w, ROAD.rear - curb)
    // Matte concrete has broad relief and sparse marks, not sparkly noise.
    g.fillStyle = 'rgba(11,19,25,.42)'
    for (let x = 0; x < w; x += 51) g.fillRect(x, curb, 1.25, 10)
    g.fillStyle = 'rgba(163,173,175,.15)'
    for (let x = 0; x < w; x += 51) g.fillRect(x + 1.25, curb + 2, 1, 7)
    g.fillStyle = '#171e27'
    g.fillRect(0, ROAD.rear - 5, w, 5)
    g.fillStyle = materialRamp(g, 0, ROAD.rear - 5, 0, ROAD.rear - 1, paint.metal)
    g.fillRect(0, ROAD.rear - 5, w, 4)

    g.fillStyle = '#293741'
    for (let x = 7; x < w; x += 67) g.fillRect(x - .5, RAIL_TOP + 3, 4.5, 17)
    g.fillStyle = 'rgba(7,12,17,.60)'
    for (let x = 7; x < w; x += 67) g.fillRect(x - 3, curb - 1, 11, 3)
    g.fillStyle = '#788790'
    for (let x = 7; x < w; x += 67) g.fillRect(x + 2.5, RAIL_TOP + 6, 1, 13)
    for (const y of [RAIL_TOP, RAIL_TOP + 11]) {
      g.fillStyle = materialRamp(g, 0, y, 0, y + 4, paint.metal)
      g.fillRect(0, y, w, y === RAIL_TOP ? 5 : 3)
    }
    g.fillStyle = 'rgba(16,25,32,.75)'
    for (let x = 24; x < w; x += 157) g.fillRect(x, RAIL_TOP, 1.4, 5)
  }

  get left(): number { return this.x0 }
  get right(): number { return this.x0 + this.span.width }

  /** Both authored spans are opaque from the sidewalk to the girder. Only
   * skip a full screen row if every point on it is inside that rectangle.
   * Leave a guard for resampling and the road's rolled antialiased edges. */
  opaqueRows(w: number, h: number, cam: { x: number; y: number; zoom: number; rot?: number }): ScreenBand | null {
    if (!this.finish || !(cam.zoom > 0)) return null
    const c = Math.cos(cam.rot ?? 0), s = Math.abs(Math.sin(cam.rot ?? 0))
    if (c < .5) return null
    const halfX = (w * c + h * s) / (2 * cam.zoom) + 2
    if (cam.x - halfX < this.left || cam.x + halfX > this.right) return null
    const top = Math.max(0, Math.ceil(h * .5 + ((ROAD.sidewalk - cam.y) * cam.zoom + s * w * .5) / c + 2))
    const bottom = Math.min(h, Math.floor(h * .5 + ((ROAD.soffit - cam.y) * cam.zoom - s * w * .5) / c - 2))
    return bottom - top >= 4 ? [top, bottom] : null
  }

  /** Add a few moving highlights to the existing curb-light reflections.
   * The lens positions, colours and puddles come from the same road bake.
   * Both optics routes get these; two fills at most, no capture or new plate. */
  drawWetGlints(
    ctx: CanvasRenderingContext2D,
    l: number,
    r: number,
    count: GraphicsFeatures['wetGlints'],
    wet: number,
    t: number,
  ): void {
    if (!this.guideWetness.length || !count || wet <= 0 || r < this.left || l > this.right) return
    const alpha = .29 * Math.sqrt(Math.min(1, wet))
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha *= alpha
    for (let tint = 0; tint < GUIDE_GLINT_INK.length; tint++) {
      ctx.beginPath()
      let any = false
      for (let i = 0; i < this.guides.length; i++) {
        const x = this.left + this.guides[i]
        if (x + GUIDE_GLINT_PADDING < l) continue
        if (x - GUIDE_GLINT_PADDING > r) break
        if (guideTint(i) !== tint) continue
        const puddle = this.guideWetness[i]
        const phase = t * 2.1 + x * .037
        for (let j = 0; j < count; j++) {
          // Nested samples: the first five (High) don't move when the finer
          // wavelets (Ultra) are admitted. Stay off the lane-paint stripes.
          const v = ((j * 7) % 13) / 13
          const y = v < .5 ? -44 + v * 52 : 5 + (v - .5) * 65
          const wave = Math.sin(phase + j * 2.4)
          const centre = x + wave * (4 + 24 * v)
          const reach = (14 + 24 * puddle) * (1 - .52 * v) * (.66 + .23 * wave)
          const a = Math.max(this.left, centre - reach)
          const b = Math.min(this.right, centre + reach)
          if (b <= a) continue
          // A taper reads as reflected light, not a second painted stripe.
          const h = (j < 5 ? 1.6 : .95) * (1 - v * .43)
          ctx.moveTo(a, y)
          ctx.lineTo(a + (b - a) * .32, y - h * .45)
          ctx.lineTo(b, y + h * .18)
          ctx.lineTo(b - (b - a) * .44, y + h)
          ctx.closePath()
          any = true
        }
      }
      if (any) {
        ctx.fillStyle = GUIDE_GLINT_INK[tint]
        ctx.fill()
      }
    }
    ctx.restore()
  }

  /** Permanent receiver light is part of the road bake, not a tier-dependent
   * overlay. The painter gets world coordinates and cannot light the girder. */
  bakeLighting(paint: (ctx: CanvasRenderingContext2D) => void): void {
    const g = this.span.getContext('2d')!
    g.save()
    g.setTransform(1, 0, 0, 1, -this.left, -RAIL_TOP)
    g.beginPath()
    if (this.exposure) {
      for (const zone of this.exposure.exposed) g.rect(zone.left, ROAD.rear, zone.right - zone.left, ROAD.front - ROAD.rear)
    } else g.rect(this.left, ROAD.rear, this.right - this.left, ROAD.front - ROAD.rear)
    g.clip()
    g.globalCompositeOperation = 'lighter'
    paint(g)
    g.restore()
  }

  /** Copy the dry material into the existing road atlas. The front fascia
   * and pier repeat do not stop when a roof ends. */
  bakeReceiver(left: number, right: number, top: number, sprite: HTMLCanvasElement, sourceY: number): void {
    const g = this.span.getContext('2d')!
    const w = right - left, h = ROAD.front - top
    g.save()
    g.setTransform(1, 0, 0, 1, -this.left, -RAIL_TOP)
    g.drawImage(sprite, 0, sourceY, w, h, left, top, w, h)
    g.restore()
  }

  /** Draw the mask upside down: captured pixels are flipped on presentation.
   * The mask destination uses the same horizontal projection as the capture. */
  maskReflection(ctx: CanvasRenderingContext2D, x: number, width: number, h: number): void {
    if (!this.water) return
    ctx.save()
    ctx.globalCompositeOperation = 'destination-in'
    ctx.translate(0, h)
    ctx.scale(1, -1)
    const half = this.water.height / 2
    ctx.drawImage(this.water, 0, half, this.water.width, half, x, 0, width, h)
    ctx.restore()
  }

  drawRoad(ctx: CanvasRenderingContext2D, l: number, r: number) {
    const light = this.pierLight
    if (!light) {
      blitWorldFrustum(ctx, this.span, this.x0, RAIL_TOP, l, r)
      return
    }
    // Extend pier shafts to the bottom of the view without a tall empty atlas.
    for (let i = Math.max(0, Math.floor((l - this.x0 - 75) / 380)); ; i++) {
      const x = this.x0 + 60 + 380 * i
      if (x - 30 > r || x >= this.x0 + this.span.width) break
      ctx.fillStyle = '#18232d'
      ctx.fillRect(x - 11, 100, 26, 4096)
      ctx.fillStyle = '#33434f'
      ctx.fillRect(x - 11, 100, 4, 4096)
    }
    blitWorldFrustum(ctx, this.span, this.x0, RAIL_TOP, l, r)
    for (
      let x =
        this.x0 + 60 + 380 * Math.max(0, Math.floor((l - this.x0 - 60) / 380));
      x <= r + 64 && x < this.x0 + this.span.width;
      x += 380
    ) {
      ctx.drawImage(light, x - 31, ROAD.soffit - 3)
    }
  }
}
