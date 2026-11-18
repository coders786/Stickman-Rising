/** Section atlas renderer. Three depths, two retained surfaces: the lower city
 * is attached to the parallax skyline; shoulder, asphalt and bridge fascia
 * share a world-space plate. Neither painting order nor coverage depends on LOD. */
import { mulberry32 } from '../core/utils'
import { blitWorldFrustum } from '../render/bhst'
import type { MoodPalette } from '../world/mood'
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
export class Viaduct {
  private readonly district: HTMLCanvasElement
  private readonly pierLight: HTMLCanvasElement
  private readonly span: HTMLCanvasElement
  private readonly water: HTMLCanvasElement
  private readonly specular: HTMLCanvasElement
  private readonly patches: Float32Array
  constructor(
    seed: number,
    private x0: number,
    width: number,
    pal: MoodPalette,
    make: Factory,
    private readonly asphalt: readonly [number, number, number] = DEFAULT_ASPHALT,
  ) {
    const rng = mulberry32(seed ^ 0x41e57),
      n = Math.ceil(width / 96) + 2
    this.patches = Float32Array.from({ length: n }, () => rng())
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
    this.paintSpan(span.g, width, pal, rng, seed)
    const mask = make(Math.ceil(width / 4), 26)
    const spec = make(mask.c.width, mask.c.height)
    this.water = mask.c
    this.specular = spec.c
    const alpha = mask.g.createImageData(mask.c.width, mask.c.height)
    const gloss = spec.g.createImageData(mask.c.width, mask.c.height)
    for (let y = 0; y < mask.c.height; y++) {
      const v = y / (mask.c.height - 1)
      const depth = Math.max(0, 2 * v - 1)
      // Soft toe and tail: no bright straight line along the contact rail.
      const envelope = Math.min(1, 9 * depth) * (1 - depth) ** 1.6
      for (let x = 0; x < mask.c.width; x++) {
        const worldX = x * width / mask.c.width + x0
        const wet = this.wetness(worldX, v)
        const i = (y * mask.c.width + x) * 4
        alpha.data[i + 3] = Math.round(255 * envelope * (0.33 + 0.67 * wet))
        const glint = Math.max(0, wet - 0.32) * Math.sin((x + 0.36 * y) * 0.34) ** 4
        gloss.data.set([115, 152, 179, Math.round(66 * glint)], i)
      }
    }
    mask.g.putImageData(alpha, 0, 0)
    spec.g.putImageData(gloss, 0, 0)
  }
  /** Broad, coherent puddles. Same roughness for the asphalt bake and the
   * local-light specular bake, not independent noise crawling each frame. */
  wetness = (x: number, v: number): number => {
    const u = Math.max(
        0,
        Math.min(this.patches.length - 1.001, (x - this.x0) / 96),
      ),
      i = Math.floor(u),
      f = u - i,
      t = f * f * (3 - 2 * f)
    const patch = this.patches[i] + t * (this.patches[i + 1] - this.patches[i])
    return Math.max(
      0.06,
      Math.min(0.95, patch ** 2 * (0.54 + 0.46 * Math.cos(v * 14 + u) ** 2) + 0.08),
    )
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
    g.globalCompositeOperation = 'source-over'
  }
  drawDistrict(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    m: number,
    baseline: number,
  ) {
    const top = Math.floor(baseline) - OVERLAP,
      offset = ((Math.floor(m) % DISTRICT_W) + DISTRICT_W) % DISTRICT_W
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
  ) {
    const dh = ROAD.front - ROAD.rear,
      img = g.createImageData(w, dh)
    // Finite amber and cyan guide strips set into the curb. Bake their low-angle
    // indirect bounce and reflection at the same positions as the lenses.
    const guides: number[] = []
    for (let x = 60; x < w; x += 205 + r() * 186) guides.push(Math.round(x))
    let nearest = 0
    for (let x = 0; x < w; x++) {
      if (
        nearest + 1 < guides.length &&
        x > (guides[nearest] + guides[nearest + 1]) / 2
      )
        nearest++
      const ice = nearest % 3 !== 1,
        halfLens = ice ? 22 : 13
      const d = Math.max(0, Math.abs(x - guides[nearest]) - halfLens)
      for (let y = 0; y < dh; y++) {
        const v = y / dh,
          wet = this.wetness(x + this.x0, v),
          k = (y * w + x) * 4
        // Cool diffuse skylight, occluded at the curb; oily tyre tracks and
        // aggregate grain use independent frequencies, never an animated filter.
        const track =
          Math.exp(-((v - 0.31) ** 2) / 0.004) +
          Math.exp(-((v - 0.72) ** 2) / 0.006)
        const value =
          43 +
          8 * v -
          11 * wet -
          6 * track -
          13 * Math.exp(-y / 4) +
          (r() - 0.5) * (9 - 5 * wet)
        // A streak inherits the colour and width of its lens. Break the
        // reflection into wavelets without resampling noise on moving frames.
        const ripple =
          0.5 + 0.5 * Math.sin(y * 1.92 + 2 * Math.sin(x * 0.036 + y * 0.075))
        const breadth = 8 + (1 - wet) * 18 + v * 19,
          shine =
            (0.24 + 0.8 * wet) *
            (0.16 + 1.25 * ripple ** 3) *
            Math.exp((-d * d) / (breadth * breadth) - y / 52)
        const bounce = 1 / (1 + (d / 36) ** 2 + (y / 14) ** 2)
        const e = 47 * bounce + 108 * shine
        img.data[k] = value * this.asphalt[0] + e * (ice ? 0.15 : 1)
        img.data[k + 1] = value * this.asphalt[1] + 2 + e * (ice ? 0.82 : 0.52)
        img.data[k + 2] = value * this.asphalt[2] + 11 + e * (ice ? 1 : 0.16)
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
    rect(0, -47, w, 1, 'rgba(211,186,129,.26)')
    for (let x = 14; x < w; x += 91) rect(x, 46, 64, 1.3, 'rgba(205,209,205,.30)')
    for (const [i, cx] of guides.entries()) {
      const ice = i % 3 !== 1,
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
    rect(0, 53, w, 1, '#697480')
    rect(0, 76, w, 2, '#101923')
    for (let x = 0; x < w; x += 92) {
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
  get left(): number { return this.x0 }
  get right(): number { return this.x0 + this.span.width }

  drawWetSurface(ctx: CanvasRenderingContext2D, wet: number): void {
    ctx.save()
    ctx.globalAlpha = Math.min(1, wet * .75)
    ctx.drawImage(this.specular, this.left, ROAD.rear, this.right - this.left, ROAD.front - ROAD.rear)
    ctx.restore()
  }

  /** Draw the mask upside down: captured pixels are flipped on presentation.
   * The mask destination uses the same horizontal projection as the capture. */
  maskReflection(ctx: CanvasRenderingContext2D, x: number, width: number, h: number): void {
    ctx.save()
    ctx.globalCompositeOperation = 'destination-in'
    ctx.translate(0, h)
    ctx.scale(1, -1)
    const half = this.water.height / 2
    ctx.drawImage(this.water, 0, half, this.water.width, half, x, 0, width, h)
    ctx.restore()
  }

  drawRoad(ctx: CanvasRenderingContext2D, l: number, r: number) {
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
      ctx.drawImage(this.pierLight, x - 31, ROAD.soffit - 3)
    }
  }
}
