import { cityPhase, BRIDGE_TOWERS, CITY_CARD_H, CITY_CARD_W } from '../../graphics/bridge/CityGeometry'
import {
  GLASS_CITY_BOTTOM, GLASS_CITY_TOP, GLASS_ENV_BOTTOM, GLASS_ENV_H, GLASS_ENV_TOP, GLASS_ENV_W, GLASS_FAR_Z,
  GLASS_PLATE, GLASS_PROFILES, GLASS_RADIANCE_RANGE, GLASS_TILE_H, GLASS_TILE_W, SHOP_FRONT_LIMIT,
  canvasGlassLoss, glassEnvironmentRow, glassEyeDistance, glassIncidence, glassLayer, glassLens, glassSlab,
} from '../../graphics/bridge/ShopGlassOptics'
import { CITY_PERIOD } from '../../graphics/bridge/SkyBasis'
import { chunkLightData, type Blocker, type LightPoint } from '../../graphics/bridge/NoirGeometry'
import { SACR_ACTOR_Z, SACR_CURB_Z } from '../../graphics/sacr/SACRMath'
import { clamp } from '../core/utils'
import type { Player } from '../entities/player'
import { CATWALK_DECK, CARGO_DECK } from '../stage/bridge-deck-face'
import { bridgeShop, type ShopFront, type ShopRect } from '../stage/bridge-shop-layout'
import { DECK_WIRE, fillLampSocket, flickerGain, lampHealth } from '../stage/bridge-sockets'
import { bridgePlate } from '../stage/bridge-webp'
import type { BridgeRoute, RouteChunk } from '../stage/route'
import type { BridgeFrame } from './bridge-frame'
import { SurfaceScope } from './ledger'
import { shadowOutline } from './shadows'

const CITY_WIDTH = CITY_PERIOD * 1.42
const GLASS_TAPS = 5, OPENING_CACHE = 9, SOLID_LIMIT = 6, LENS_LIMIT = 6, PAD = 2
const hit = (a: ShopRect, b: ShopRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
const sat = (x: number) => clamp(x, 0, 1)
const centreX = (p: ShopRect) => (p.left + p.right) * .5
const centreY = (p: ShopRect) => (p.top + p.bottom) * .5
const boundsAt = (x: number, y: number, r: number): ShopRect => ({ left:x - r, top:y - r, right:x + r, bottom:y + r })
const rect = (p: Path2D, a: ShopRect) => p.rect(a.left, a.top, a.right - a.left, a.bottom - a.top)
const fill = (g: CanvasRenderingContext2D, a: ShopRect) => g.fillRect(a.left, a.top, a.right - a.left, a.bottom - a.top)
const channel = (v: number, linear: boolean) => Math.round(255 * sat(linear ? v / GLASS_RADIANCE_RANGE : v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055))
const pigment = (r: number, g: number, b: number, linear: boolean, a = 1) => `rgba(${channel(r, linear)},${channel(g, linear)},${channel(b, linear)},${a})`
type RectPath = ShopRect & { path: Path2D }

/** Only near-side ink actually drawn in the albedo plate can mask the
 * reflection. Subtract it from the aperture, not from the whole actor layer. */
function frontInk(c: RouteChunk, frame: ShopRect): readonly Path2D[] {
  const cuts: Path2D[] = []
  const cut = (x: number, y: number, w: number, h: number, dx = 0, dy = 0) => {
    if (!hit(frame, { left:x, top:y + dy, right:x + w + dx, bottom:y + h })) return
    const p = new Path2D()
    p.rect(frame.left - 1, frame.top - 1, frame.right - frame.left + 2, frame.bottom - frame.top + 2)
    p.moveTo(x, y); p.lineTo(x + dx, y + dy); p.lineTo(x + w + dx, y + dy)
    p.lineTo(x + w + dx, y + h + dy); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.closePath()
    cuts.push(p)
  }
  const p = c.platform
  if (p) {
    const { left:l, right:r, y } = p
    if (c.role === 'catwalk') {
      cut(l, y, r - l, CATWALK_DECK.thickness + 2.7, CATWALK_DECK.returnX, CATWALK_DECK.returnY)
      for (const x of [l + 22, r - 30]) cut(x, y - 53, 12, -52 - y + 53, 7, -4)
      cut(l + 21, y - 44.3, r + 17 - l - 21, 2.6)
      for (let x = l + 22; x < r + 17; x += 38) cut(x - 1.5, y - 43, 3, 30)
    } else cut(l, y, r - l, CARGO_DECK.bottom - y, CARGO_DECK.returnX, CARGO_DECK.returnY)
  }
  const pole = (x: number, off: number) => {
    if (off < 0) cut(x - 1, DECK_WIRE.y - 13, 7, -219 - (DECK_WIRE.y - 13), 4, -3)
    cut(x - 1, -223, 7, 166, 4, -3); cut(x + off - 16, -229, 35, 10, 7, -5)
  }
  pole(c.lamp, -15)
  const paired = fillLampSocket(c)
  if (paired !== null) pole(paired, 15)
  return cuts
}

type Opening = {
  panes: readonly RectPath[]; cuts: readonly Path2D[]; aperture: Path2D; front: ShopFront; area: ShopRect;
  tile: ShopRect; lampSeed?: number; solids: readonly Blocker[]; sources: readonly LightPoint[]
}
const faceDepth = (b: Blocker) => b.depth?.[1] ?? (b.kind === 'roof' || b.kind === 'lintel' ? 5.76 : b.kind === 'lamp' ? 5.44 : SACR_CURB_Z)
type Projection = NonNullable<ReturnType<typeof glassLayer>>
type ReturnObject = { z: number } & (
  { kind: 'solid'; bounds: ShopRect; color: string } |
  { kind: 'lens'; x: number; y: number; size: number; peak: number; lens: LightPoint } |
  { kind: 'hero'; x: number; y: number; scale: number; actor: Player }
)

/** The local glass field represents what the pane actually sees from the
 * opposite side: a distant city, nearby opaque steel and finite practicals,
 * with the live hero at deck depth. No samples of the frame being drawn. */
export class BridgeShopGlass {
  private readonly scope = new SurfaceScope('shop-glass')
  private readonly openings = new Map<RouteChunk, Opening>()
  private route: BridgeRoute | null = null
  private readonly visible: Opening[] = []
  private readonly reflected: ReturnObject[] = []
  private fronts = 0
  private panes = 0
  private baked = 0
  private readonly skyMix = new Float32Array(GLASS_TAPS)
  private readonly bounds = new Float32Array(SHOP_FRONT_LIMIT * 4)
  private readonly distance = new Float32Array(SHOP_FRONT_LIMIT)
  private solids = 0
  private sources = 0
  private actors = 0
  private shadeTaps = 0
  private shaded = 0
  private penumbra = 0
  private energy = 0
  private fieldBytes = 0

  reset(): void {
    this.fronts = this.panes = this.baked = this.solids = this.sources = this.actors = this.shadeTaps = this.shaded = this.penumbra = this.energy = this.fieldBytes = 0
    this.visible.length = this.reflected.length = 0
  }

  retire(): void { this.reset(); this.scope.releaseAll(); this.openings.clear(); this.route = null }

  private opening(c: RouteChunk, front: ShopFront): Opening {
    const old = this.openings.get(c)
    if (old) return old
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
    const aperture = new Path2D()
    const panes = front.panes.map(p => {
      const l = p.left + front.x, r = p.right + front.x
      left = Math.min(left, l); right = Math.max(right, r); top = Math.min(top, p.top); bottom = Math.max(bottom, p.bottom)
      const pane = { left:l, right:r, top:p.top, bottom:p.bottom }, path = new Path2D()
      rect(aperture, pane); rect(path, pane)
      return { ...pane, path }
    })
    const area = { left, right, top, bottom }, cuts = frontInk(c, area)
    const tile = { left:left - PAD, right:right + PAD, top:top - PAD, bottom:bottom + PAD }
    const optics = chunkLightData(c)
    const solids = optics.blockers.filter(s => s.top < -105 && s.kind !== 'jamb' && s.kind !== 'bench')
    const deck = (s: Blocker) => +(s.kind === 'catwalk' || s.kind === 'cargo')
    // Admit relevant projected geometry before applying the cap. Off-pane
    // poles and lintels must not crowd out the wider raised deck return.
    solids.sort((a,b) => deck(b) - deck(a) || faceDepth(b) - faceDepth(a))
    const sources = optics.points.filter(p => p.kind === 'spot' || p.kind === 'bulb').slice(0, LENS_LIMIT)
    const result = { panes, cuts, aperture, front, area, tile, solids, sources, lampSeed: lampHealth(c) < .95 ? c.seed : undefined }
    if (this.openings.size >= OPENING_CACHE) this.openings.delete(this.openings.keys().next().value!)
    this.openings.set(c, result)
    return result
  }

  private lightAt(f: BridgeFrame, o: Opening, foreground: Projection): number {
    const a = o.area, h = a.top + (a.bottom - a.top) * .34
    const sy = (h - foreground.y) / foreground.scale
    for (let i = 0; i < GLASS_TAPS; i++) {
      const sx = (a.left + i * (a.right - a.left) / (GLASS_TAPS - 1) - foreground.x) / foreground.scale
      const v = f.sample(sx, sy), moon = v.moon * f.atmo.key[0]
      const flash = (.22 + .78 * v.flash) * f.atmo.lightning(f.screenX(sx, sy))
      if (f.probeWindow) {
        this.shadeTaps++
        this.shaded += +(v.sky < .71 || v.moon < .60)
        this.penumbra += +(v.moon > .01 && v.moon < .99)
      }
      // Worker visibility and weather change incoming radiance, not R or T.
      this.skyMix[i] = sat(.24 * v.sky + .70 * moon + flash * 1.10)
      this.energy += this.skyMix[i]
    }
    return sy
  }

  private drawEnvironment(g: CanvasRenderingContext2D, f: BridgeFrame, o: Opening,
    atlas: HTMLImageElement | null, linear: boolean): void {
    const { area, tile, front } = o, p = glassLayer(front.z, f.cam, GLASS_FAR_Z)!
    const w = CITY_WIDTH * p.scale, phase = cityPhase(0, f.seed ^ 0x51c4a9, 1) * w
    const start = Math.floor((tile.left - p.x + phase) / w) * w + p.x - phase
    g.fillStyle = pigment(.012, .019, .028, linear); fill(g, tile)
    if (!atlas) {
      // Complete, correctly projected bank on the very first frame, even if
      // the request is still open (or denied). Never mirror the front scene.
      const y = p.y + GLASS_CITY_TOP * p.scale, h = (GLASS_CITY_BOTTOM - GLASS_CITY_TOP) * p.scale
      const light = this.skyMix[2], horizon = p.y + p.scale * -94
      const sky = g.createLinearGradient(0, horizon - 130, 0, horizon + 90)
      sky.addColorStop(0, pigment(.013, .024, .038, linear))
      sky.addColorStop(.60, pigment(.043 + light * .17, .076 + light * .24, .115 + light * .32, linear))
      sky.addColorStop(1, pigment(.009, .015, .023, linear))
      g.fillStyle = sky; fill(g, tile)
      const sx = w / CITY_CARD_W, sy = h / CITY_CARD_H[1]
      g.fillStyle = pigment(.016, .027, .040, linear)
      for (let x = start; x < tile.right; x += w) for (const s of BRIDGE_TOWERS[1]) {
        const l = x + s.x * sx, t = y + s.top * sy, width = s.w * sx
        if (l >= tile.right || l + width <= tile.left) continue
        g.fillRect(l, t, width, y + h - t)
      }
      return
    }
    const profile = front.roughness === GLASS_PROFILES[0] ? 0 : 1
    const y = p.y + GLASS_ENV_TOP * p.scale, h = (GLASS_ENV_BOTTOM - GLASS_ENV_TOP) * p.scale
    const stripe = (open: boolean) => {
      const row = glassEnvironmentRow(profile, open, linear)
      for (let x = start; x < tile.right; x += w) g.drawImage(atlas, 0, row, GLASS_ENV_W, GLASS_ENV_H, x, y, w, h)
    }
    stripe(false)
    for (const [j, pane] of o.panes.entries()) {
      const u = sat((centreX(pane) - area.left) / (area.right - area.left)) * (GLASS_TAPS - 1)
      const i = Math.min(GLASS_TAPS - 2, Math.floor(u)), light = this.skyMix[i] + (this.skyMix[i + 1] - this.skyMix[i]) * (u - i)
      if (light < .002) continue
      // Clip between mullions, not on the glass edge a second time.
      g.save(); g.beginPath(); g.rect(pane.left - .33, tile.top, pane.right - pane.left + .66, tile.bottom - tile.top); g.clip()
      g.globalAlpha = light; stripe(true); g.restore()
    }
    this.baked += o.panes.length
  }

  private drawObjects(g: CanvasRenderingContext2D, f: BridgeFrame, o: Opening, linear: boolean, shadowY: number, hero?: Player): void {
    const objects = this.reflected, a = o.area, { front } = o, eye = f.cam
    objects.length = 0
    for (const b of o.solids) {
      const z = faceDepth(b), p = glassLayer(front.z, eye, z)
      if (!p) continue
      const bounds = { left:p.x + b.left * p.scale, right:p.x + b.right * p.scale, top:p.y + b.top * p.scale, bottom:p.y + b.bottom * p.scale }
      if (!hit(a, bounds)) continue
      const x = clamp((centreX(a) - p.x) / p.scale, b.left, b.right)
      const v = f.sample(x, clamp(shadowY, b.top, b.bottom)), base = .010 + .035 * v.sky * (.30 + .70 * v.moon * f.atmo.key[0])
      objects.push({ kind:'solid', z, bounds, color:pigment(base + .14 * sat(v.r), base + .005 + .14 * sat(v.g), base + .014 + .14 * sat(v.b), linear) })
      if (objects.length >= SOLID_LIMIT) break
    }
    for (const lens of o.sources) {
      const z = lens.z ?? SACR_CURB_Z, p = glassLayer(front.z, eye, z)
      if (!p) continue
      const x = p.x + lens.x * p.scale, y = p.y + lens.y * p.scale
      const { radius, peak } = glassLens(front.z, z, front.roughness, lens.physicalRadius), size = radius * p.scale
      if (lens.strength > 0 && hit(a, boundsAt(x, y, size))) objects.push({ kind:'lens', z, x, y, size, peak, lens })
    }
    if (hero && hero.state !== 'dead') {
      const z = SACR_ACTOR_Z, p = glassLayer(front.z, eye, z)!
      const x = p.x + hero.x * p.scale, y = p.y + hero.hipY * p.scale, scale = hero.scale * p.scale
      if (hit(a, boundsAt(x, y, 105 * scale))) objects.push({ kind:'hero', z, x, y, scale, actor:hero })
    }
    // In the mirror camera, larger physical Z is nearer (below pane Z).
    // Solid reflectors replace background radiance; they are not extra layers
    // of tint on the transmitted room. A lens on their face is a later draw.
    objects.sort((a,b) => a.z - b.z)
    for (const obj of objects) switch (obj.kind) {
      case 'solid':
        g.fillStyle = obj.color; fill(g, obj.bounds); this.solids++; break
      case 'lens': {
        const { x, y, size, peak, lens } = obj
        const [r, cg, b] = lens.rgb, n = Math.max(.1, r, cg, b)
        // Only a finite emitter returns a highlight. A worn pole uses the
        // same seeded gain as the nearby lens drawn by RouteArt.drawMotion.
        const powered = lens.kind === 'spot' && o.lampSeed !== undefined && !f.quiet ? flickerGain(o.lampSeed, f.weatherTime) ** 2 : 1
        const power = Math.min(GLASS_RADIANCE_RANGE, .84 * lens.strength * powered) * peak
        const ink = `rgb(${channel(r * power / n, linear)},${channel(cg * power / n, linear)},${channel(b * power / n, linear)})`
        const alpha = g.globalAlpha
        // Layered discs approximate the finite lens falloff without creating a
        // gradient during each reflected-glass draw. Opacities are incremental
        // source-over layers sampled from the former radial profile.
        g.fillStyle = ink
        g.globalAlpha = alpha * .042; g.beginPath(); g.arc(x, y, size * .98, 0, Math.PI * 2); g.fill()
        g.globalAlpha = alpha * .174; g.beginPath(); g.arc(x, y, size * .90, 0, Math.PI * 2); g.fill()
        g.globalAlpha = alpha * .394; g.beginPath(); g.arc(x, y, size * .75, 0, Math.PI * 2); g.fill()
        g.globalAlpha = alpha * .517; g.beginPath(); g.arc(x, y, size * .60, 0, Math.PI * 2); g.fill()
        g.globalAlpha = alpha * .802; g.beginPath(); g.arc(x, y, size * .45, 0, Math.PI * 2); g.fill()
        g.globalAlpha = alpha * .326; g.beginPath(); g.arc(x, y, size * .30, 0, Math.PI * 2); g.fill()
        g.globalAlpha = alpha * .516; g.beginPath(); g.arc(x, y, size * .15, 0, Math.PI * 2); g.fill()
        g.globalAlpha = alpha; this.sources++; break
      }
      case 'hero': {
        const { actor, scale, x, y } = obj
        g.save(); g.translate(x, y); g.scale(scale * actor.face, scale)
        if (actor.swordDrawn) {
          const { grip, tip } = actor.geom
          g.strokeStyle = pigment(.18, .26, .33, linear); g.lineWidth = 1.2; g.lineCap = 'round'; g.beginPath()
          g.moveTo(grip.x, grip.y); g.lineTo(tip.x, tip.y); g.stroke()
        }
        g.fillStyle = '#000'; g.fill(shadowOutline(actor.geom, true, undefined, true)); g.restore()
        this.actors++; break
      }
    }
  }

  private tile(g: CanvasRenderingContext2D, f: BridgeFrame, o: Opening, row: number,
    atlas: HTMLImageElement | null, linear: boolean, hero?: Player): void {
    const { tile, front } = o
    const sx = GLASS_TILE_W / (tile.right - tile.left), sy = GLASS_TILE_H / (tile.bottom - tile.top)
    g.setTransform(sx, 0, 0, sy, -tile.left * sx, row * GLASS_TILE_H - tile.top * sy)
    g.save()
    try {
      g.clip(o.aperture)
      for (const cut of o.cuts) g.clip(cut, 'evenodd')
      const sy = this.lightAt(f, o, glassLayer(front.z, f.cam, SACR_CURB_Z)!)
      this.drawEnvironment(g, f, o, atlas, linear)
      this.drawObjects(g, f, o, linear, sy, hero)
    } finally { g.restore() }
  }

  private canvasGlass(g: CanvasRenderingContext2D, scratch: HTMLCanvasElement, o: Opening, f: BridgeFrame): void {
    const { tile, front } = o, distance = glassEyeDistance(front.z), alpha = g.globalAlpha
    g.save()
    try {
      for (const cut of o.cuts) g.clip(cut, 'evenodd')
      for (const pane of o.panes) {
        if (!hit(f.view, pane)) continue
        const [r,t] = glassSlab(glassIncidence(distance, centreX(pane) - f.cam.x, centreY(pane) - f.cam.y))
        g.save(); g.clip(pane.path)
        g.fillStyle = '#000'; g.globalAlpha = alpha * canvasGlassLoss(r,t); fill(g, pane)
        g.globalAlpha = alpha * r
        g.drawImage(scratch, tile.left, tile.top, tile.right - tile.left, tile.bottom - tile.top)
        g.restore()
      }
    } finally { g.restore() }
  }

  draw(g: CanvasRenderingContext2D, f: BridgeFrame, route: BridgeRoute, gpu = false, hero?: Player): void {
    f.glass = null
    if (this.route !== route) { this.retire(); this.route = route }
    else this.reset()
    for (const c of route.between(f.view.left, f.view.right)) {
      const front = bridgeShop(c)
      if (!front) continue
      const { frame:b, x } = front
      if (x + b.right <= f.view.left || x + b.left >= f.view.right || b.bottom <= f.view.top || b.top >= f.view.bottom) continue
      const o = this.opening(c, front)
      if (hit(f.view, o.area)) this.visible.push(o)
    }
    if (this.visible.length > SHOP_FRONT_LIMIT) this.visible.sort((a,b) => Math.abs(a.front.x - f.cam.x) - Math.abs(b.front.x - f.cam.x))
    const count = Math.min(this.visible.length, SHOP_FRONT_LIMIT)
    if (!count) return
    const c = this.scope.tryAcquire('return', GLASS_TILE_W, GLASS_TILE_H * (gpu ? count : 1), 'shop-radiance')
    const field = c?.getContext('2d')
    if (!field || field.isContextLost?.() || !c) return
    const atlas = bridgePlate(GLASS_PLATE)
    for (let i = 0; i < count; i++) {
      const o = this.visible[i], off = i * 4, tile = o.tile
      this.fronts++; this.panes += o.panes.length
      field.resetTransform()
      field.clearRect(0, gpu ? i * GLASS_TILE_H : 0, GLASS_TILE_W, GLASS_TILE_H)
      this.tile(field, f, o, gpu ? i : 0, atlas, gpu, hero)
      if (gpu) {
        this.bounds[off] = tile.left - f.cam.x; this.bounds[off + 1] = tile.top
        this.bounds[off + 2] = tile.right - f.cam.x; this.bounds[off + 3] = tile.bottom
        this.distance[i] = glassEyeDistance(o.front.z)
      } else this.canvasGlass(g, c, o, f)
    }
    this.fieldBytes = c.width * c.height * 4
    if (gpu) f.glass = { canvas:c, count, bounds:this.bounds, distance:this.distance }
  }

  receipt() { return { fronts:this.fronts, panes:this.panes, baked:this.baked, solids:this.solids, sources:this.sources, actors:this.actors,
    shadeTaps:this.shadeTaps, shaded:this.shaded, penumbra:this.penumbra, energy:this.energy, fieldBytes:this.fieldBytes } }
}
