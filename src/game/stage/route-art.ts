import { drainageOffset } from './bridge-material'
import { bridgeCanvasRoadAbsorption } from './bridge-road-water'
import { chunkPlateTop, paintChunk, PLATE_BOTTOM, PLATE_GUARD, visiblePlateIndices } from './bridge-plate-paint'
import { BridgeStreaming, PLATE_SLOTS } from '../../graphics/bridge/BridgeStreaming'
import { box, paintBridgeDeck, puddlePath, ramp } from './bridge-art'
import { ENV_TOP, ENV_W, lightRow, skyExposed } from '../../graphics/bridge/EnvBasis'
import { chunkLightData, strongestPractical, type LightPoint } from '../../graphics/bridge/NoirGeometry'
import type { BridgeAtmosphere } from '../../graphics/bridge/BridgeAtmosphere'
import { BridgeCanvasSky } from './bridge-sky-canvas'
import { paintStreetCard, paintUndersidePier, PIER_L, PIER_R, PIER_TOP, PIER_BOTTOM, streetProject,
  STREET_CARD_H, STREET_CARD_W, STREET_REAR_Y, STREET_SCALE, STREET_TOP_Y } from './bridge-city'
import { applySectionView, type SectionCamera } from './bridge-depth'
import { bridgePlate } from './bridge-webp'
import { BridgeRail } from './bridge-rail'
import { DECK_WIRE, flickerGain, lampHealth, routeWind } from './bridge-sockets'
import { damp, smoothstep } from '../core/utils'
import { newProbe } from '../lighting/ribbons'
import { SurfaceScope, hasPixels } from '../render/ledger'
import { finishPaint } from '../render/paint-slices'
import { ROAD } from './road-section'
import { BridgeRoute, type RouteChunk, type RouteShelter } from './route'
import { SHELTER_KIT } from './run-layout'
import { bakeRunShelter, type ShelterStamp } from './run-shelter-art'
import { worldBounds, type ViewBounds } from '../world/exposed-weather'
import type { Gate } from '../world/encounters'
import type { ServiceTerminal } from '../world/service'

export const ROUTE_CACHE_SIZE = PLATE_SLOTS
export { paintTransitSign, WET_SIGN_COLOR } from './bridge-plate-paint'
export const REFLECTION_ALPHA = .24
export const REFLECTION_DEPTH = 65
export type ShelterPaint = 'all' | 'structure' | 'foreground'
type Store = OffscreenCanvas | HTMLCanvasElement
function solid(g: CanvasRenderingContext2D, fill: string | CanvasGradient, x: number, y: number, w: number, h: number): void {
  g.fillStyle = fill; g.fillRect(x, y, w, h)
}
function line(g: CanvasRenderingContext2D, color: string, width: number, x: number, y: number, tx: number, ty: number): void {
  g.strokeStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(x,y); g.lineTo(tx,ty); g.stroke()
}


/** Three OffscreenCanvas slots for near-world stamps. A fourth visible
 * chunk (e.g. a 32:9 window) paints directly, never evicts a visible slot. */
export class RouteScenery {
  private readonly scope = new SurfaceScope('route')
  private readonly scratch = this.scope.generation('scratch')
  private cityUnderlay: HTMLCanvasElement | null = null
  private readonly streetView = { left: 0, right: 0, top: 0, bottom: 0 }
  private kit: Partial<Record<RouteShelter['kind'], ShelterStamp>> = {}
  private readonly cache = new Map<number, { surface: Store; dimmed: boolean; dirty: boolean }>()
  private readonly watchedCards = new WeakSet<Store>()
  private readonly visible: number[] = []
  private platePixels = 0
  private readonly sky = new BridgeCanvasSky(this.scope)
  private readonly rail = new BridgeRail(this.scope)
  private probe = newProbe()
  private cutaway = 0
  private cutawayId = 0
  private bakes = 0
  private evicted = 0
  readonly stream: BridgeStreaming
  constructor(public route: BridgeRoute) { this.stream = new BridgeStreaming(route.seed) }

  reset(route: BridgeRoute): void {
    if (this.route !== route) { this.releaseCache(); this.stream.reset(route.seed) }
    this.route = route; this.cutawayId = this.cutaway = 0
  }

  private releaseCache(): void {
    for (const index of this.cache.keys()) this.scope.release(`chunk-${index}`)
    this.cache.clear()
  }
  dispose(): void { this.stream.dispose(); this.releaseCache(); this.scope.releaseAll(); this.kit = {}; this.cityUnderlay = null }
  stats() {
    return { indices: [...new Set([...this.cache.keys(), ...this.stream.indices()])].sort((a, b) => a - b), bakes: this.bakes + this.stream.bakes, evicted: this.evicted + this.stream.evicted,
      platePixels: this.platePixels, offscreen: [...this.cache.values()].every(e => typeof OffscreenCanvas !== 'undefined' && e.surface instanceof OffscreenCanvas), worker: this.stream.receipt(), rail: this.railStats() }
  }

  private shelterKit(shelter: RouteShelter | null): ShelterStamp | undefined {
    if (!shelter) return
    const kind = shelter.kind, old = this.kit[kind]
    if (old && hasPixels(old.sprite)) return old
    try {
      return this.kit[kind] = bakeRunShelter(kind, (w, h) => {
        const c = this.scope.acquire(`shelter-${kind}`, w, h, 'route-shelter-kit')
        return { c, g: c.getContext('2d')! }
      }, (w, h) => this.scratch.next(w, h, 'route-work'), true)
    } finally { this.scratch.begin() }
  }

  private get(chunk: RouteChunk, dimmed: boolean): Store | null {
    const old = this.cache.get(chunk.index), slot = `chunk-${chunk.index}`
    if (old && hasPixels(old.surface) && !old.dirty && old.dimmed === dimmed && !old.surface.getContext('2d')?.isContextLost?.()) return old.surface
    const top = chunkPlateTop(chunk), height = PLATE_BOTTOM - top
    // The ledger may reuse the identical-size card; clear all of its ink.
    this.cache.delete(chunk.index)
    try {
      const surface = this.scope.streamed(slot, chunk.right - chunk.left, height, 'route-chunk')
      if (!surface) return null
      const g = surface.getContext('2d')
      if (!g || g.isContextLost?.()) { this.scope.release(slot); return null }
      g.setTransform(1, 0, 0, 1, 0, -top)
      g.clearRect(0, top, surface.width, height)
      paintChunk(g, chunk, this.shelterKit(chunk.shelter))
      if (dimmed) {
        // Approximate indirect light on the provisional plate once, without
        // re-filtering a large world blit on every Canvas frame.
        g.globalCompositeOperation = 'source-atop'
        g.fillStyle = '#00000040'; g.fillRect(0, top, surface.width, height)
        g.globalCompositeOperation = 'source-over'
      }
      if (g.isContextLost?.()) { this.scope.release(slot); return null }
      // A restored context has transparent pixels even if its dimensions
      // didn't change. Invalidate this exact owner, not the current seed's.
      if (!this.watchedCards.has(surface)) {
        this.watchedCards.add(surface)
        const index = chunk.index
        surface.addEventListener?.('contextrestored', () => {
          const entry = this.cache.get(index)
          if (entry?.surface === surface) entry.dirty = true
        })
      }
      this.cache.set(chunk.index, { surface, dimmed, dirty: false }); this.bakes++
      return surface
    } catch (error) {
      this.scope.release(slot)
      this.cache.delete(chunk.index)
      // A denied backing can still be painted straight into the world pass.
      if (error instanceof RangeError || error instanceof DOMException) return null
      throw error
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: ViewBounds, x: number, lit = false, requestLit = lit, schedule = true): void {
    finishPaint(this.drawSteps(ctx, view, x, lit, requestLit, schedule))
  }

  *drawSteps(ctx: CanvasRenderingContext2D, view: ViewBounds, x: number, lit: boolean, requestLit: boolean,
    schedule: boolean, cold = false): Generator<void> {
    const visible = visiblePlateIndices(this.route, view, this.visible)
    const centre = this.route.at(x).index
    if (schedule) this.stream.planPlates(centre, visible, requestLit, true)
    // In Canvas, mixing a lit card with an albedo card makes the shared
    // road look cut in half. Swap visible lighting together; if the view
    // is wider than the three slots, use one consistent provisional grade.
    const usePlates = !lit || visible.every(i => this.stream.plate(i, true))
    for (const index of this.cache.keys()) if (!this.stream.keepsPlate(index) || (usePlates && this.stream.plate(index, lit))) {
      this.scope.release(`chunk-${index}`); this.cache.delete(index); this.evicted++
    }
    this.platePixels = 0
    this.drawDeckSupports(ctx, view)
    if (cold) yield
    // Keep the authored pre-route deck. These are not pixels from chunk 0
    // and do not share its lamp/receiver field.
    if (view.left < 0 && view.bottom > -94 && view.top < PLATE_BOTTOM) {
      const l = view.left - 8
      ctx.save(); ctx.beginPath(); ctx.rect(l, ENV_TOP, -l, PLATE_BOTTOM - ENV_TOP); ctx.clip()
      paintBridgeDeck(ctx, l, 0); ctx.restore()
      if (cold) yield
    }
    for (const index of visible) {
      const c = this.route.chunk(index), top = chunkPlateTop(c)
      const plate = usePlates ? this.stream.plate(index, lit) : null
      const source = plate ?? (this.stream.keepsPlate(index) ? this.get(c, lit) : null)
      if (source && source.width > 0 && source.height > 0) {
        // Integer crop in source texels; retain the original world landing
        // and a filtering guard outside the rotated view's enclosing box.
        const left = Math.max(0, Math.floor(view.left - c.left) - PLATE_GUARD)
        const right = Math.min(source.width, Math.ceil(view.right - c.left) + PLATE_GUARD)
        const bottom = Math.min(source.height, Math.ceil(view.bottom - top) + PLATE_GUARD)
        const y = Math.max(0, Math.floor(view.top - top) - PLATE_GUARD)
        if (right > left && bottom > y) {
          this.platePixels += (right - left) * (bottom - y)
          ctx.drawImage(source, left, y, right - left, bottom - y, c.left + left, top + y, right - left, bottom - y)
        }
      } else {
        ctx.save(); ctx.translate(c.left, 0); ctx.beginPath(); ctx.rect(0, top, c.right - c.left, PLATE_BOTTOM - top); ctx.clip()
        if (lit) ctx.filter = 'brightness(0.75)'
        paintChunk(ctx, c, this.shelterKit(c.shelter)); ctx.restore()
      }
      if (cold) yield
    }
  }

  private drawDeckSupports(ctx: CanvasRenderingContext2D, view: ViewBounds): void {
    if (view.bottom <= PIER_TOP || view.top > PIER_BOTTOM) return
    const pier = bridgePlate('deck-pier')
    for (const c of this.route.between(view.left - PIER_R, view.right - PIER_L)) {
      const x = c.left + 134 + c.seed % 95
      if (x + PIER_R < view.left || x + PIER_L > view.right) continue
      if (pier) ctx.drawImage(pier, x + PIER_L, PIER_TOP)
      else { ctx.save(); ctx.translate(x, 0); paintUndersidePier(ctx); ctx.restore() }
    }
  }

  drawBelowCity(ctx: CanvasRenderingContext2D, w: number, h: number, cam: SectionCamera): number {
    const { rear } = streetProject(cam, h)
    const view = worldBounds(this.streetView, w, h, cam)
    if (view.bottom <= STREET_TOP_Y) return rear
    let art: CanvasImageSource | null = bridgePlate('metro-street')
    if (art && this.cityUnderlay) {
      this.scope.release('under-city'); this.cityUnderlay = null
    } else if (!art) {
      if (!hasPixels(this.cityUnderlay)) {
        const c = this.cityUnderlay = this.scope.tryAcquire('under-city', STREET_CARD_W, STREET_CARD_H, 'route-under-city')
        const g = c?.getContext('2d')
        if (g) paintStreetCard(g)
      }
      art = this.cityUnderlay
    }
    const width = STREET_CARD_W * STREET_SCALE, height = STREET_CARD_H * STREET_SCALE
    const seed = (this.route.seed % 211) * STREET_SCALE
    const first = Math.floor((view.left + seed) / width) * width - seed
    ctx.save(); applySectionView(ctx, cam, w, h)
    const bottom = STREET_TOP_Y + height
    if (bottom < view.bottom) solid(ctx, '#0d171e', view.left - 1, bottom - 1, view.right - view.left + 2, view.bottom - bottom + 3)
    // No per-frame vehicles or secondary projection. One blit per visible
    // court includes the glazing, drains, paving and fixed light pools.
    for (let x = first; x < view.right; x += width) {
      if (art) ctx.drawImage(art, x, STREET_TOP_Y, width, height)
      else { ctx.save(); ctx.translate(x, STREET_TOP_Y); ctx.scale(STREET_SCALE, STREET_SCALE); paintStreetCard(ctx); ctx.restore() }
    }
    ctx.restore()
    return rear
  }

  /** Socket-to-socket feeder. Extends outside the visible chunk range so no
   * endpoint floats at a streaming edge. Reduced Motion freezes only sag. */
  drawCables(ctx: CanvasRenderingContext2D, view: ViewBounds, time: number, wind: number, quiet: boolean): void {
    const start = Math.max(0, this.route.at(view.left).index - 1)
    ctx.strokeStyle = '#384b57'; ctx.lineWidth = 1.35
    ctx.beginPath()
    for (let i = start; ; i++) {
      const x = this.route.chunk(i).lamp + DECK_WIRE.x
      if (x > view.right + 16) break
      const tx = this.route.chunk(i + 1).lamp + DECK_WIRE.x
      if (tx < view.left - 16) continue
      const span = tx - x, mid = x + span * .5
      const gust = quiet ? 0 : routeWind(mid, time, wind) * 5
      ctx.moveTo(x, DECK_WIRE.y)
      ctx.quadraticCurveTo(mid, DECK_WIRE.y + span * .039 + gust, tx, DECK_WIRE.y)
    }
    ctx.stroke()
  }

  updateCutaway(x: number, y: number, dt: number): void {
    const s = this.route.shelterAt(x, 14)
    const id = s && y > -255 ? s.id : 0
    if (id && this.cutawayId !== id) { this.cutawayId = id; this.cutaway = 0 }
    this.cutaway = damp(this.cutaway, id ? 1 : 0, 10, dt)
  }

  drawExterior(ctx: CanvasRenderingContext2D, view: ViewBounds, service?: ServiceTerminal, paint: ShelterPaint = 'all'): void {
    for (const { shelter: s } of this.route.between(view.left, view.right)) {
      if (!s || s.right < view.left || s.left > view.right) continue
      const warm = s.kind === 'service', alpha = 1 - .85 * (s.id === this.cutawayId ? this.cutaway : 0)
      ctx.save(); ctx.globalAlpha *= alpha
      const ridge = warm ? -220 : -248
      // The opaque roof and jamb are already in the albedo card. Only the
      // near posts may overlap actors; no rectangular colored window wash.
      if (paint !== 'structure') for (const x of [s.left + 5, s.right - 19]) {
        box(ctx, x, ridge + 10, 9, 43 - ridge - 10, '#232526', '#3a3c3b', '#111417', 5, -3)
        solid(ctx, warm ? '#84745c82' : '#6867627f', x + 1, ridge + 12, 1, 27 - ridge)
      }
      ctx.restore()
      if (warm && service) {
        const ready = !service.isUsed(s.id)
        solid(ctx, ready ? '#efd29c' : '#657769', s.terminal - 11, -101, 24, 2.4)
      }
    }
  }

  /** Point probes share geometry and spectra with the section bake. */
  lightAt(x: number, y: number, out = this.probe) {
    let point: LightPoint | undefined, gain = 0
    for (const c of this.route.between(x - 340, x + 340)) {
      const p = strongestPractical(x, y, chunkLightData(c))
      if (p.gain > gain) { point = p.point; gain = p.gain }
    }
    out.best = out.caster = null
    out.bestW = out.castW = out.dx = out.dy = out.dir = out.r = out.g = out.b = out.warm = out.cool = out.city = out.neon = 0
    if (point) {
      const dx = point.x - x, dy = point.y - y, len = Math.max(1, Math.hypot(dx, dy)), g = Math.min(1.1, gain) * .61
      out.dx = dx / len; out.dy = dy / len; out.dir = Math.sign(dx)
      out.castW = Math.min(.96, gain * .61)
      out.r = point.rgb[0] * g; out.g = point.rgb[1] * g; out.b = point.rgb[2] * g
      out.warm = point.rgb[0] > point.rgb[2] ? g : 0; out.cool = out.warm ? 0 : g
      // 'caster' needs addresses only. Reuse the existing record shape so the
      // finite test arena's Probe consumers can keep their incumbent API.
      out.caster = { id: 'Bridge fixture', kind: 'bulb', x: point.x, y: point.y,
        radius: point.reach, gain: point.strength, flicker: 0, flickerHz: 0, phase: 0 }
    }
    return out
  }

  drawStormEdges(ctx: CanvasRenderingContext2D, view: ViewBounds, cam: { x: number; y: number; zoom: number; rot?: number }, w: number, a: BridgeAtmosphere): void {
    if (a.key[1] < .024) return
    for (const c of this.route.between(view.left, view.right)) {
      const mark = (left: number, right: number, top: number) => {
        const x = (left + right) / 2, roll = cam.rot ?? 0
        const u = .5 + ((x - cam.x) * Math.cos(roll) - (top - cam.y) * Math.sin(roll)) * cam.zoom / w
        const k = a.lightning(u) * (() => {
          const w = this.stream.window, u = w ? (x - w.origin) / w.width : -1
          return w && u >= 0 && u < 1 ? skyExposed(w.shadow[(lightRow(top - 2, false) * ENV_W + Math.floor(u * ENV_W)) * 4 + 1] / 255) : 0
        })()
        if (k > .008) solid(ctx, `rgba(198,209,220,${k * .50})`, left, top, right - left, 1.8)
      }
      if (c.shelter) mark(c.shelter.left + 27, c.shelter.right - 29, SHELTER_KIT[c.shelter.kind].ridgeY)
      if (c.platform) mark(c.platform.left, c.platform.right, c.platform.y)
      const lamp = chunkLightData(c).points[0]
      mark(lamp.x - 11, lamp.x + 16, -229)
    }
  }

  /** Called inside the real dry-eave clip. The plate is dry at rest; the
   * same seed-addressed basin path absorbs extra diffuse and clips shine. */
  drawRoadWater(ctx: CanvasRenderingContext2D, view: ViewBounds, wet: number, time: number, shimmer: boolean): void {
    const loss = bridgeCanvasRoadAbsorption(wet), { left, right } = view
    solid(ctx, `rgba(0,0,0,${loss.film})`, left - 2, ROAD.rear, right - left + 4, ROAD.front - ROAD.rear)
    if (loss.pool < .002 && !shimmer) return
    ctx.save(); puddlePath(ctx, left - 20, right + 20, drainageOffset(this.route.seed))
    if (loss.pool >= .002) { ctx.fillStyle = `rgba(0,0,0,${loss.pool})`; ctx.fill() }
    if (!shimmer) { ctx.restore(); return }
    ctx.clip()
    for (const c of this.route.between(left - 95, right + 95)) {
      const lens = chunkLightData(c).points[0], x = lens.x
      if (x < left - 95 || x > right + 95 || this.route.shelterAt(x)) continue
      const hue = lens.kelvin >= 4000 ? '158,172,180' : '213,165,103', gain = wet * .23 * Math.min(1, lens.strength * .38)
      if (gain < .003) continue
      const sh = ctx.createLinearGradient(0, -38, 0, 49)
      sh.addColorStop(0, `rgba(${hue},0)`); sh.addColorStop(.31, `rgba(${hue},${gain})`); sh.addColorStop(1, `rgba(${hue},${gain * .37})`)
      ctx.fillStyle = sh
      for (let i = 0; i < 19; i++) {
        const y = -42 + i * 4.7, width = 4 + i * .9 + i % 3 * 4, offset = Math.sin(x * .032 + i * 1.7 + time * 2.4) * (3 + .32 * i)
        solid(ctx, sh, x + y * -.38 + offset - width, y, width * 2, .85 + i % 4 * .33)
      }
    }
    ctx.restore()
  }

  drawTitle(g: CanvasRenderingContext2D, w: number, h: number, a: BridgeAtmosphere): void {
    finishPaint(this.drawTitleSteps(g, w, h, a))
  }

  *drawTitleSteps(g: CanvasRenderingContext2D, w: number, h: number, a: BridgeAtmosphere, cold = false): Generator<void> {
    if (cold) {
      yield* this.sky.drawSteps(g, a, w, h, true)
      yield* this.sky.citySteps(g, a, w, h, true)
      yield* this.sky.mistSteps(g, a, w, true)
    } else { this.sky.draw(g, a, w, h); this.sky.city(g, a, w, h); this.sky.mist(g, a, w) }
    const fade = g.createLinearGradient(0, h * .44, 0, h * .92)
    fade.addColorStop(0, '#080c1300'); fade.addColorStop(.49, '#0b1018a6'); fade.addColorStop(1, '#080c13')
    solid(g, fade, 0, h * .44, w, h * .56)
  }

  drawBackdrop(g: CanvasRenderingContext2D, w: number, h: number, cam: SectionCamera, a: BridgeAtmosphere, quiet: boolean, sparse: boolean) {
    finishPaint(this.drawBackdropSteps(g, w, h, cam, a, quiet, sparse))
  }

  *drawBackdropSteps(g: CanvasRenderingContext2D, w: number, h: number, cam: SectionCamera, a: BridgeAtmosphere,
    quiet: boolean, sparse: boolean, cold = false): Generator<void> {
    if (!sparse) {
      if (cold) { yield* this.sky.drawSteps(g, a, w, h, true); yield* this.sky.citySteps(g, a, w, h, true) }
      else { this.sky.draw(g, a, w, h); this.sky.city(g, a, w, h) }
    }
    this.sky.life(g, a, w, h, quiet)
    if (!sparse) {
      if (cold) yield* this.sky.mistSteps(g, a, w, true)
      else this.sky.mist(g, a, w)
    }
    if (cold) yield
    this.drawBelowCity(g, w, h, cam)
    if (cold) yield
    this.rail.paint(g, w, h, cam, STREET_REAR_Y, a.time, quiet, a.seed, a.detailed, a.wind)
  }

  railWake(t: number, x: number): number { return this.rail.wake(this.route.seed, t, x) }
  railStats() { return this.rail.last }

  drawMotion(ctx: CanvasRenderingContext2D, view: ViewBounds, time: number, quiet: boolean): void {
    if (quiet) return
    for (const c of this.route.between(view.left - 55, view.right + 55)) {
      if (lampHealth(c) >= .95) continue
      for (const p of chunkLightData(c).points) {
        if (p.kind !== 'spot' || p.x + 12 < view.left || p.x - 12 > view.right) continue
        const light = flickerGain(c.seed, time)
        solid(ctx, `rgba(185,208,199,${light * light * (lampHealth(c) < .2 ? .23 : .56)})`, p.x - 7, p.y - 3, 13, 1.8)
      }
    }
  }

}

export function paintGate(ctx: CanvasRenderingContext2D, gate: Gate, left: number, right: number, t: number): void {
  const { x, state, index } = gate
  if (x < left - 64 || x > right + 64) return
  const locked = state === 'locked', color = locked ? '#ff947b' : state === 'open' ? '#8bd7b4' : '#c4ad83'
  // Lit gantry and recessed barrier. Rectangular catch on the floor stays
  // the authored gate x; this framing never owns collision.
  box(ctx, x - 48, -312, 96, 43, ramp(ctx, 0, -312, 0, -269, '#414d57', '#17232c'), '#536a71', '#222737')
  solid(ctx, '#121c25', x - 43, -307, 86, 33)
  solid(ctx, '#71999388', x - 43, -307, 86, 1.3)
  box(ctx, x - 16, -267, 32, 311, ramp(ctx, x - 16, 0, x + 16, 0, '#435860', '#253540', '#121f2b'), '#96aba8', '#172b35')
  solid(ctx, '#101c22', x - 5, -261, 10, 304)
  solid(ctx, '#758e92', x - 5, -260, 1.2, 300)
  solid(ctx, color, x + 5, -263, 2, 260)
  for (let y = -241; y < 37; y += 37) solid(ctx, '#62868f', x - 13, y, 2, 3)
  ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color
  ctx.fillText(`GATE ${String(index + 1).padStart(2, '0')}`, x, -291)
  ctx.font = '8px monospace'; ctx.fillText(locked ? 'LOCKED' : state === 'open' ? 'OPEN' : 'CHECKPOINT', x, -280)
  if (locked) {
    const pulse = .62 + .1 * Math.sin(t * 6)
    const curtain = ctx.createLinearGradient(x - 35, 0, x + 35, 0)
    curtain.addColorStop(0, '#ff705400'); curtain.addColorStop(.5, `rgba(215,101,71,${pulse * .24})`); curtain.addColorStop(1, '#ff705400')
    ctx.fillStyle = curtain; ctx.fillRect(x - 35, -256, 70, 293)
    for (let y = -255; y < 40; y += 11) solid(ctx, '#e5b59c55', x - 22, y, 44, 1)
  } else solid(ctx, color, x - 2, -266, 4, 16)
  box(ctx, x - 22, 43, 48, 8, '#293944', '#728986', '#162631', 11, -6)
}
