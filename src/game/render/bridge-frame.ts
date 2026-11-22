import { GPUActorBatch } from './gpu-actor-batch'
import { newReceiverLight, sampleLocalLight, SACR_LIGHT_KIND, type ReceiverLight } from '../../graphics/sacr/SACRLocalLight'
import { decodeRGB9E5 } from '../../graphics/sacr/SACRAtlas'
import { SACR_ACTOR_Z } from '../../graphics/sacr/SACRMath'
import { SACR_PX_PER_METER } from '../../graphics/sacr/SACRPacker'
import type { GlassField } from '../../graphics/bridge/ShopGlassOptics'
import { BridgeAtmosphere } from '../../graphics/bridge/BridgeAtmosphere'
import { BLOCKER_LIMIT, chunkLightData, rayVisible, staticFalloff, type Blocker, type LightPoint } from '../../graphics/bridge/NoirGeometry'
import { ENV_W, lightRow, skyExposed } from '../../graphics/bridge/EnvBasis'
import { lightDepth, lightLuminance, sampleCastDirections, sampleFixturePair, vectorRow, VECTOR_TOP, VECTOR_H, type CastSource, type FixtureLobes } from '../../graphics/bridge/LightVectorGrid'
import type { BakeWindow } from '../../graphics/bridge/BridgeBakeProtocol'
import type { BridgeStreaming } from '../../graphics/bridge/BridgeStreaming'
import { BridgeSACRFrame } from '../../graphics/sacr/BridgeSACRFrame'
import { ribbonFade, ribbonRow, type Trail } from '../fx/ribbon'
import { BRIDGE_VENT_BUDGET, BRIDGE_VENT_Y, bridgePrecipitation, bridgeVentX } from '../stage/bridge-weather-data'
import { clamp01, smoothstep } from '../core/utils'
import { ROAD } from '../stage/road-section'
import { MATERIAL_TILE, Material, PUDDLE_PITCH, drainageOffset, RETURN_X, RETURN_Y } from '../stage/bridge-material'
import { DISTRICT_PANEL, districtSocket, flickerGain } from '../stage/bridge-sockets'
import { deckFace } from '../stage/bridge-deck-face'
import { bridgeBiomeMix, type BridgeRoute } from '../stage/route'
import { SHELTER_KIT } from '../stage/run-layout'
import { worldBounds, type ViewBounds } from '../world/exposed-weather'
import type { Gate } from '../world/encounters'
import type { BgCam } from '../world/background'
import type { Probe } from '../lighting/ribbons'

export const BRIDGE_LIGHT_BUDGET = 16
const ACTOR_FIXTURE_LIMIT = 32
export const BRIDGE_COVER_BUDGET = 8
export const BRIDGE_FACE_BUDGET = 120
export const BRIDGE_FACE_STRIDE = 5
export const BRIDGE_TRAIL_STRIDE = 5
const TRAIL_SEGS = 120
export const BRIDGE_LANDINGS = 4
export const MOBILE_FLASH_LIMIT = 1
export const MASTER_FLASH_LIMIT = 4
const ARC_MIN = Math.PI / 12, ARC_MAX = 350 * Math.PI / 180
export const bridgeTint = (tint: string) => /^#[0-9A-Fa-f]{6}$/.test(tint) ? Number.parseInt(tint.slice(1), 16) : 0xc3edff
const linear = (v: number) => (v / 255) ** 2.2
export const BRIDGE_LIGHT = SACR_LIGHT_KIND
export type BridgeLightKind = typeof BRIDGE_LIGHT[keyof typeof BRIDGE_LIGHT]
const MAX_CORE = 3.6

function growLightBox(box: Float32Array, ax: number, ay: number, bx: number, by: number, pad: number) {
  // One extra world px makes the bounds conservative after float packing.
  pad++
  box[0] = Math.min(box[0], Math.min(ax, bx) - pad)
  box[1] = Math.min(box[1], Math.min(ay, by) - pad)
  box[2] = Math.max(box[2], Math.max(ax, bx) + pad)
  box[3] = Math.max(box[3], Math.max(ay, by) + pad)
}

/** Pure presentation packet, read by both forward paths. All X coordinates
 * delivered to GL are rebased on the camera, preserving precision far out.
 * Fixed-size arrays are reused; the shader never imports a game entity. */
export class BridgeFrame {
  readonly actorPrototype = new GPUActorBatch()
  readonly sacr = new BridgeSACRFrame()
  readonly atmo = new BridgeAtmosphere()
  streamWindow: BakeWindow | null = null
  probeWindow: BakeWindow | null = null
  stream: BridgeStreaming | undefined
  uploadQuiet = true
  canvasCasts = 0
  wake = 0
  drainage = 0
  private readonly local = newReceiverLight()
  private readonly receiver = { moon: 0, sky: .55, ao: 1, flash: 0, r: 0, g: 0, b: 0 }
  sample(x: number, y: number, ground = false) {
    const out = this.receiver, w = this.probeWindow
    const u = w ? (x - w.origin) / w.width : -1
    if (!w || u < 0 || u >= 1) {
      out.moon = out.flash = out.r = out.g = out.b = 0; out.sky = .63; out.ao = 1
      return out
    }
    const at = lightRow(y, ground) * ENV_W + Math.floor(u * ENV_W), k = at * 4, a = w.shadow
    const bits = w.light[0].data[at], scale = 2 ** ((bits >>> 27) - 24)
    out.moon = a[k] / 255; out.sky = a[k+1] / 255; out.ao = a[k+2] / 255; out.flash = skyExposed(out.sky) * (ground ? .44 : 1)
    out.r = (bits & 511) * scale; out.g = (bits >>> 9 & 511) * scale; out.b = (bits >>> 18 & 511) * scale
    return out
  }

  castSample(x: number, y: number, ground: boolean) {
    const e = this.sample(x, y, ground), w = this.probeWindow
    const u = w ? (x - w.origin) / w.width : -1
    const steady = lightLuminance(e.r, e.g, e.b) * e.ao
    const directions = w && u >= 0 && u < 1 && steady > .006 ? sampleCastDirections(w.vectors, u, y) : []
    const gate = Math.min(1, steady / Math.max(.001, directions.reduce((n, v) => n + v.energy, 0)))
    for (const d of directions) d.energy *= gate
    return { ...e, moon: e.moon * e.ao, directions }
  }
  /** The baked octahedral lanes carry energy/direction but not fixture IDs.
   * Resolve the winning direction back to its authored lens, so the cheap
   * Canvas lobe never inks an unrelated overlapping practical. */
  castFixture(x: number, y: number, direction: CastSource): LightPoint | undefined {
    let best: LightPoint | undefined, score = .948
    y = VECTOR_TOP * (1 - vectorRow(y) / (VECTOR_H - 1))
    for (const p of this.fixtures) {
      if (p.y >= y - 5 || p.kind === 'strip' || staticFalloff(p, x - p.x, y - p.y) < .002) continue
      const dx = p.x - x, dy = y - p.y, dz = (lightDepth(p) - SACR_ACTOR_Z) * SACR_PX_PER_METER
      const dot = (dx * direction.x + dy * direction.y + dz * direction.z) / Math.max(1, Math.hypot(dx, dy, dz))
      if (dot > score) { score = dot; best = p }
    }
    return best
  }

  liveSky = false
  glass: GlassField | null = null
  readonly blockerData = new Float32Array(BLOCKER_LIMIT * 4)
  readonly blockers: Blocker[] = []
  private readonly fixtures: LightPoint[] = []
  get lensSources(): readonly LightPoint[] { return this.fixtures }
  blockerCount = 0
  readonly landings = new Float32Array(BRIDGE_LANDINGS * 4)
  readonly trail = new Float32Array(TRAIL_SEGS * 6 * BRIDGE_TRAIL_STRIDE)
  private readonly reflections = new Float32Array(BRIDGE_LIGHT_BUDGET * 4) // emission, arc radius, angle, sweep
  readonly propBlockers: Blocker[] = []
  private readonly tints = new Uint32Array(BRIDGE_LIGHT_BUDGET)
  landingCount = 0
  trailVertices = 0
  dynamicLimit = MASTER_FLASH_LIMIT
  impulseLimit = BRIDGE_LIGHT_BUDGET
  readonly mobileFlashIndices = new Int32Array(2)
  readonly source = new Float32Array(BRIDGE_LIGHT_BUDGET * 4) // x,y,radius,type
  readonly energy = new Float32Array(BRIDGE_LIGHT_BUDGET * 4) // linear rgb,power
  readonly shape = new Float32Array(BRIDGE_LIGHT_BUDGET * 4) // end x,y,core/half-width, aperture (spot) or inside
  readonly vents = new Float32Array(BRIDGE_VENT_BUDGET * 3) // x, y, thermal class
  readonly cover = new Float32Array(BRIDGE_COVER_BUDGET * 4) // left, right, eave Y, service?
  readonly faces = new Float32Array(BRIDGE_FACE_BUDGET * 6 * BRIDGE_FACE_STRIDE)
  readonly view: ViewBounds = { left: 0, right: 0, top: 0, bottom: 0 }
  readonly cssColor: string[] = []
  readonly inkBox = new Float32Array(4) // rebased Ronin contour envelope, not a transport record
  // Conservative support outside the fixed v4 UBO. No changes to sample
  // count, shadow admission, or which primitive owns a receiver pixel.
  readonly directBounds = new Float32Array(4)
  readonly emissionBounds = new Float32Array(4)
  readonly weatherBounds = new Float32Array(4)
  private readonly lightBoxes = [this.directBounds, this.emissionBounds, this.weatherBounds]
  count = 0
  roofs = 0
  ventCount = 0
  rain = 0
  rainTime = 0
  wind = 0
  seed = 0
  quiet = false
  vertexCount = 0
  overflow = false
  impulseCount = 0
  impulseGain = 0
  wet = 0
  fog = 0
  key = 1
  keyX = 0
  thunder = 0
  weatherTime = 0
  cssW = 1
  fightTint = 0
  bossTint = 0
  look = 0
  texOrigin = 0
  puddleOrigin = 0
  exposure = 0
  cam: BgCam = { x: 0, y: 0, zoom: 1, rot: 0 }

  begin(cam: BgCam, w: number, h: number, weatherTime: number, wet: number, fog: number, key: number, keyX: number, thunder: number, boss: number, pulse: number): void {
    this.cam = cam; this.cssW = w; worldBounds(this.view, w, h, cam)
    this.canvasCasts = this.wake = 0; this.liveSky = false; this.glass = null
    this.count = this.ventCount = this.roofs = this.vertexCount = this.impulseCount = this.impulseGain = 0
    this.trailVertices = this.landingCount = this.blockerCount = 0
    this.blockers.length = this.propBlockers.length = 0
    this.impulseLimit = MASTER_FLASH_LIMIT
    this.mobileFlashIndices.fill(-1)
    for (const b of this.lightBoxes) {
      b[0] = b[1] = 1e20; b[2] = b[3] = -1e20
    }
    this.overflow = false
    this.rainTime = this.weatherTime = weatherTime; this.wet = wet; this.fog = fog; this.key = key; this.keyX = keyX; this.thunder = thunder
    this.look = bridgeBiomeMix(cam.x, this.seed); this.bossTint = boss; this.fightTint = pulse
    this.texOrigin = cam.x % MATERIAL_TILE; this.puddleOrigin = cam.x % PUDDLE_PITCH
    this.exposure = 0
  }

  screenX(x: number, y: number): number {
    const c = this.cam, r = c.rot ?? 0
    return .5 + ((x - c.x) * Math.cos(r) - (y - c.y) * Math.sin(r)) * c.zoom / this.cssW
  }

  light(kind: BridgeLightKind, x: number, y: number, radius: number, tint: string, power: number, width: number, tx = x, ty = y, aperture = 0, emission = 0): boolean {
    if (this.count >= this.dynamicLimit || (kind === BRIDGE_LIGHT.impulse && this.impulseCount >= this.impulseLimit) || power <= .003 || Math.max(x, tx) + radius < this.view.left ||
      Math.min(x, tx) - radius > this.view.right || Math.max(y, ty) + radius < this.view.top || Math.min(y, ty) - radius > this.view.bottom) return false
    const i = this.count++, k = i * 4
    const n = this.tints[i] = bridgeTint(tint)
    this.reflections.fill(0, k, k + 4)
    this.source[k] = x - this.cam.x; this.source[k + 1] = y; this.source[k + 2] = radius; this.source[k + 3] = kind
    this.energy[k] = linear((n >> 16) & 255); this.energy[k + 1] = linear((n >> 8) & 255); this.energy[k + 2] = linear(n & 255)
    this.energy[k + 3] = Math.min(MAX_CORE, power)
    this.shape[k] = tx - this.cam.x; this.shape[k + 1] = ty; this.shape[k + 2] = width; this.shape[k + 3] = aperture
    this.cssColor[i] = tint
    if (kind !== BRIDGE_LIGHT.spot && kind !== BRIDGE_LIGHT.area) growLightBox(this.directBounds, this.source[k], y, this.shape[k], ty, radius)
    if (kind !== BRIDGE_LIGHT.beam) growLightBox(this.emissionBounds, this.source[k], y, this.shape[k], ty, width + 10)
    if (kind !== BRIDGE_LIGHT.point && kind !== BRIDGE_LIGHT.area) growLightBox(this.weatherBounds, this.source[k], y, this.shape[k], ty, radius)
    if (kind === BRIDGE_LIGHT.impulse) {
      this.reflections[k] = Math.max(4, Math.min(25, emission || power * 6.7))
      if (this.impulseCount < MOBILE_FLASH_LIMIT) this.mobileFlashIndices[this.impulseCount] = i
      this.impulseCount++
      this.impulseGain = Math.max(this.impulseGain, clamp01(power / MAX_CORE))
    } else if (kind !== BRIDGE_LIGHT.spot && kind !== BRIDGE_LIGHT.area && this.impulseCount === 0) {
      const best = this.mobileFlashIndices[0]
      if (best < 0 || power > this.energy[best * 4 + 3]) this.mobileFlashIndices[0] = i
    }
    return true
  }

  /** One source drives the light field and the signed-radius reflection.
   * World shading uses the active crescent's mid-point. */
  strikeArc(x: number, y: number, radius: number, angle: number, sweep: number, tint: string, strength: number, width: number): void {
    const ax = x + Math.cos(angle) * radius, ay = y + Math.sin(angle) * radius
    if (!this.light(BRIDGE_LIGHT.impulse, ax, ay, radius + 142, tint, strength * .89, width, ax, ay, 0, strength * 7.4)) return
    const k = (this.count - 1) * 4
    this.reflections[k + 1] = radius; this.reflections[k + 2] = angle
    this.reflections[k + 3] = Math.max(ARC_MIN, Math.min(ARC_MAX, sweep))
  }

  packReflectedImpulses(): void {
    for (let j = 0; j < this.count; j++) {
      const k = j * 4, power = this.reflections[k]
      if (power <= 0) continue
      const r = this.reflections[k + 1], a = this.reflections[k + 2]
      const x = this.cam.x + this.source[k], y = this.source[k + 1], z = this.shape[k + 2]
      this.sacr.impulse(x - Math.cos(a) * r, y - Math.sin(a) * r, this.cam.x + this.shape[k], this.shape[k + 1],
        z, this.tints[j], power, r > 0 ? { radius: r, angle: a, sweep: this.reflections[k + 3] } : undefined)
    }
  }

  /** Native HDR core, built from the exact Catmull–Rom rows the Canvas
   * ribbon painter uses. Bounded mesh; no fullscreen per-sample loop. */
  ribbon(t: Trail, rows: number): void {
    const room = Math.floor((this.trail.length / BRIDGE_TRAIL_STRIDE - this.trailVertices) / 6)
    if (rows < 2 || room <= 0) return
    const color = bridgeTint(t.color)
    const r = .46 + .54 * linear(color >> 16 & 255), g = .46 + .54 * linear(color >> 8 & 255), b = .46 + .54 * linear(color & 255)
    const stride = Math.max(1, Math.ceil((rows - 1) / room)), fade = ribbonFade(t) * Math.min(1, t.width)
    const vertex = (row: number, outside: boolean) => {
      const j = this.trailVertices++ * BRIDGE_TRAIL_STRIDE, p = this.trail, w = ribbonRow(row, 4)
      const tx = ribbonRow(row, 2), ty = ribbonRow(row, 3), f = outside ? .14 * w : 0
      const gain = outside ? 0 : fade * (1.2 + 3.2 * w)
      p[j] = tx + (ribbonRow(row, 0) - tx) * f - this.cam.x; p[j + 1] = ty + (ribbonRow(row, 1) - ty) * f
      p[j + 2] = r * gain; p[j + 3] = g * gain; p[j + 4] = b * gain
    }
    for (let i = 0; i < rows - 1; i += stride) {
      const j = Math.min(rows - 1, i + stride)
      vertex(i, false); vertex(j, false); vertex(j, true)
      vertex(i, false); vertex(j, true); vertex(i, true)
    }
  }

  private vertex(x: number, y: number, material: number, plane: number, tilt: number): void {
    const i = this.vertexCount++ * BRIDGE_FACE_STRIDE, a = this.faces
    a[i] = x - this.cam.x; a[i + 1] = y; a[i + 2] = material; a[i + 3] = plane; a[i + 4] = tilt
  }

  private quad(material: number, plane: number, tilt: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
    if (this.vertexCount >= BRIDGE_FACE_BUDGET * 6) { this.overflow = true; return }
    this.vertex(ax, ay, material, plane, tilt); this.vertex(bx, by, material, plane, tilt); this.vertex(cx, cy, material, plane, tilt)
    this.vertex(ax, ay, material, plane, tilt); this.vertex(cx, cy, material, plane, tilt); this.vertex(dx, dy, material, plane, tilt)
  }

  private rect(material: number, plane: number, l: number, r: number, y: number, bottom: number): void {
    if (r <= this.view.left || l >= this.view.right || y >= this.view.bottom || bottom <= this.view.top || y >= bottom) return
    this.quad(material, plane, 0, l, y, r, y, r, bottom, l, bottom)
  }

  private extrusion(material: number, l: number, r: number, y: number, bottom: number, dx = RETURN_X, dy = RETURN_Y): void {
    this.rect(material, 1, l, r, y, bottom)
    this.quad(material, 2, .22, l, y, l + dx, y + dy, r + dx, y + dy, r, y)
    this.quad(material, 1, .66, r, y, r + dx, y + dy, r + dx, bottom + dy, r, bottom)
  }

  climate(rain: number, wind: number, rainTime = this.weatherTime): void {
    this.rain = bridgePrecipitation(rain, this.look)
    this.wind = wind; this.rainTime = rainTime
  }

  /** Only local section solids enter the live packet. Do not use the shelter
   * ID as a stand-in for transmission across a doorway or a deck. */
  gatherBlockers(route: BridgeRoute, gate?: Gate, previous?: Gate | null, props?: readonly Blocker[]): void {
    const { left, right, top, bottom } = this.view, reach = 432
    const add = (b: Blocker) => {
      if (this.blockerCount >= BLOCKER_LIMIT || b.right < left - reach || b.left > right + reach || b.bottom < top - reach || b.top > bottom + reach) return
      this.blockers.push(b)
      const k = this.blockerCount++ * 4
      this.blockerData[k] = b.left - this.cam.x; this.blockerData[k + 1] = b.top
      this.blockerData[k + 2] = b.right - this.cam.x; this.blockerData[k + 3] = b.bottom
    }
    // Always admit the relevant roofs and gate before optional moving props.
    for (const g of [gate, previous]) if (g) add({ left: g.x - 16, top: -265, right: g.x + 17, bottom: 43, kind: 'pier' })
    const chunks = [...route.between(left - reach, right + reach)]
    this.fixtures.length = 0
    for (const c of chunks) for (const p of chunkLightData(c).points) {
      if (this.fixtures.length < ACTOR_FIXTURE_LIMIT && p.kind !== 'strip' &&
        p.x + p.reach >= left && p.x - p.reach <= right && p.y + p.reach >= top && p.y - p.reach <= bottom) this.fixtures.push(p)
    }
    for (const c of chunks) for (const b of chunkLightData(c).blockers) if (b.kind === 'catwalk' || b.kind === 'cargo' || b.kind === 'roof' || b.kind === 'jamb') add(b)
    if (props) for (const b of props) add(b)
    for (const c of chunks) for (const b of chunkLightData(c).blockers) if (b.kind !== 'catwalk' && b.kind !== 'cargo' && b.kind !== 'roof' && b.kind !== 'jamb') add(b)
  }

  transmitted(x: number, y: number, lx: number, ly: number): boolean {
    return rayVisible(x, y, lx, ly, this.blockers)
  }

  gather(route: BridgeRoute, gate: Gate | undefined, previous: Gate | null | undefined, quiet: boolean, mesh: boolean): void {
    const { left, right } = this.view, t = quiet ? 0 : this.weatherTime
    this.seed = route.seed; this.quiet = quiet
    this.drainage = drainageOffset(route.seed); this.puddleOrigin = (this.cam.x + this.drainage) % PUDDLE_PITCH
    if (mesh) {
      this.rect(Material.steel, 2, left - 8, right + 8, ROAD.front, ROAD.front + 4)
      this.rect(Material.concrete, 1, left - 8, right + 8, ROAD.front + 4, ROAD.soffit)
    }
    for (const c of route.between(left - 300, right + 300)) {
      const { shelter: s, platform: p } = c
      if (s && s.right >= left - 110 && s.left <= right + 110) {
        if (this.roofs < BRIDGE_COVER_BUDGET) {
          const i = this.roofs++ * 4
          this.cover[i] = s.left - this.cam.x; this.cover[i + 1] = s.right - this.cam.x
          this.cover[i + 2] = SHELTER_KIT[s.kind].eaveY; this.cover[i + 3] = +(s.kind === 'service')
        } else this.overflow = true
        this.exposure = Math.max(this.exposure, smoothstep((Math.min(this.cam.x - s.left, s.right - this.cam.x) + 26) / 52))
        if (mesh) {
          const { eaveY, ridgeY } = SHELTER_KIT[s.kind]
          this.rect(s.kind === 'service' ? Material.shutter : Material.steel, 1, s.left + 27, s.right - 36, eaveY + 57, ROAD.rear - 22)
          this.extrusion(Material.steel, s.left + 9, s.left + 24, eaveY + 10, ROAD.rear, 8, -5)
          this.extrusion(Material.steel, s.right - 27, s.right - 13, eaveY + 10, ROAD.rear, 8, -5)
          this.quad(Material.steel, 2, .19, s.left, eaveY, s.left + 26, ridgeY, s.right - 29, ridgeY, s.right, eaveY)
        }
      }
      // Static points already land in RGB9_E5. Upload the lamp lens only
      // for bounded in-scatter; don't re-add its diffuse transport.
      if (mesh) for (const p of chunkLightData(c).points) if (p.kind === 'spot') {
        this.light(BRIDGE_LIGHT.spot, p.x, p.y, p.reach, p.color,
          1.66 * (quiet ? 1 : .93 + .07 * flickerGain(c.seed ^ 391, t)), p.physicalRadius, p.x + p.axisX * 130, p.y + p.axisY * 130, .26)
      }
      if (!mesh) continue
      const vent = !quiet && this.ventCount < BRIDGE_VENT_BUDGET ? bridgeVentX(c) : null
      if (vent !== null && vent >= left - 48 && vent <= right + 48) {
        const k = this.ventCount++ * 3
        this.vents.set([vent - this.cam.x, BRIDGE_VENT_Y, c.visualBand === 2 ? 2 : 1], k)
      }
      if (p && p.right + 23 >= left - 20 && p.left <= right + 20) {
        const d = deckFace(c)
        this.extrusion('thickness' in d ? Material.steel : Material.shutter, p.left, p.right, p.y,
          'thickness' in d ? p.y + d.thickness : d.bottom, d.returnX, d.returnY)
      }
      if (!s) {
        const x = districtSocket(c), d = DISTRICT_PANEL[c.visualBand]
        this.extrusion(Material.steel, x + d.left, x + d.right, d.top, d.bottom, d.returnX, d.returnY)
      }
    }
    for (const g of [gate, previous]) if (g && g.x + 64 > left && g.x - 64 < right) {
      this.light(BRIDGE_LIGHT.beam, g.x - 20, -264, 290, g.state === 'locked' ? '#d7735b' : '#c0aca0',
        g.state === 'locked' ? 1.75 : .48, 4.6, g.x - 89 + 22 * Math.sin(t * 2.1), -51, .29)
    }
  }

  receive(x: number, y: number, depth: number, out: ReceiverLight, only = -1): ReceiverLight {
    return sampleLocalLight(this, x, y, depth, out, only)
  }

  receiveFixtures(x: number, y: number, depth: number, out: FixtureLobes): void {
    sampleFixturePair(this.fixtures, this.blockers, x, y, depth, out)
  }

  /** Same admitted light as the surface brushes. Cast only from a strong
   * impulse; transients never dim another source's irradiance or reflection. */
  castFrom(out: Probe, tap: ReceiverLight): number | undefined {
    const w = Math.min(.94, tap.strike * .64)
    if (w <= .008 || w <= out.castW * .45) return
    out.castW = Math.max(out.castW, w); out.dir = tap.strikeX < 0 ? -1 : 1
    return -Math.max(-1.4, Math.min(1.4, tap.strikeX / Math.max(26, Math.abs(tap.strikeY))))
  }

  impulseAt(x: number, y: number, out: Probe, _route: BridgeRoute): number | undefined {
    const tap = this.receive(x, y, 0, this.local)
    out.r += tap.r; out.g += tap.g; out.b += tap.b
    if (tap.strength > .008) { out.dx = tap.dx; out.dy = tap.dy }
    return this.castFrom(out, tap)
  }

  retireRoute(): void {
    this.stream = undefined; this.streamWindow = this.probeWindow = null
    this.sacr.stratum.accept(null, this.sacr.packet)
    this.glass = null
    this.blockers.length = this.propBlockers.length = this.fixtures.length = 0
  }

  wetBounce(x: number, out: Probe): void {
    const s = this.sacr.stratum, level = s.mips[2]
    if (!level) return
    const u = Math.floor((x / SACR_PX_PER_METER - s.originX) / s.widthMeters * level.w)
    if (u < 0 || u >= level.w) return
    const c = decodeRGB9E5(level.data[u + level.w * 5])
    const k = this.wet * .29
    out.r += Math.min(.15, c[0] * k); out.g += Math.min(.13, c[1] * k); out.b += Math.min(.11, c[2] * k)
  }

  receipt() { return { emitters: this.count, impulses: this.impulseCount, cover: this.roofs, blockers: this.blockerCount, casts: this.canvasCasts || this.sacr.casters, deckCasts: this.sacr.elevatedCasters, roadFromDeck: this.sacr.elevatedCasters, stream: this.stream?.receipt(), quads: this.vertexCount / 6, overflow: this.overflow, trailTriangles: this.trailVertices / 3, landings: this.landingCount } }
}
