import type { BakeWindow } from '../bridge/BridgeBakeProtocol'
import { catwalkSlab } from '../bridge/EnvBasis'
import { SHELTER_KIT } from '../../game/stage/run-layout'
import type { BridgeRoute } from '../../game/stage/route'
import { deckFace } from '../../game/stage/bridge-deck-face'
import { bridgeSole, type ShadowActor } from '../../game/render/shadows'
import { BridgeStratum } from './BridgeStratum'
import { SACR_ACTOR_Z, SACR_CURB_Z, SACR_NEAR_Z, sacrCoordinates, worldToSACRX } from './SACRMath'
import { packArcPrim, packCapsulePrim, packFootAO, packOpaqueBar, SACRColumnBinner, SACR_FEET, SACR_PRIMITIVES, SACR_PRIORITY, SACR_PX_PER_METER, SACR_SOLID_ID,
  SACRUniformBuffer, SACR_MASTER_K, SACR_MOBILE_K, type SACRBinItem, type SACRMaxK, type SACRPriority } from './SACRPacker'

type Joint = { x: number; y: number; z?: number }
const M = SACR_PX_PER_METER
const DARK_FIGHTER = 0x2c3f50, DARK_CLOTH = 0x26333d

/** Owns the one GPU packet reused through the entire continuous run. Only
 * the presentation layer uses metres; sim poses, supports and distance are
 * deliberately unchanged. */
export class BridgeSACRFrame {
  readonly packet = new SACRUniformBuffer()
  readonly stratum = new BridgeStratum()
  private readonly bins = new SACRColumnBinner()
  private readonly items = Array.from({ length: SACR_PRIMITIVES }, (_, index): SACRBinItem =>
    ({ index, minX: 0, maxX: 0, zObj: 0, priority: SACR_PRIORITY.enemy, distance: 0 }))
  private leftPx = 0
  private centerPx = 0
  camWorldX = 0
  pOffsetMeters = 0
  viewWidthMeters = 1
  maxK: SACRMaxK = SACR_MASTER_K
  primitives = 0
  feet = 0
  arcs = 0
  emissives = 0
  scarves = 0
  undersides = 0
  supports = 0
  casters = 0
  elevatedCasters = 0

  begin(left: number, right: number, center: number, maxK: SACRMaxK, route: BridgeRoute, stream?: BakeWindow | null): void {
    const c = sacrCoordinates(left, right, center)
    this.maxK = maxK; this.leftPx = left; this.centerPx = center
    this.camWorldX = c.camWorldX; this.pOffsetMeters = c.pOffsetMeters; this.viewWidthMeters = c.viewWidthMeters
    this.primitives = this.feet = this.arcs = this.emissives = this.scarves = this.undersides = this.supports = this.casters = this.elevatedCasters = 0
    this.packet.clearFrame()
    if (stream !== undefined) this.stratum.accept(stream, this.packet)
    else this.stratum.update(route, left, right, this.packet)
  }

  private item(lo: number, hi: number, z: number, priority: SACRPriority, distance: number): number {
    if (this.primitives >= SACR_PRIMITIVES || hi < -1.2 || lo > this.viewWidthMeters + 1.2 || !Number.isFinite(lo + hi + z)) return -1
    const index = this.primitives++, p = this.items[index]
    p.minX = lo; p.maxX = hi; p.zObj = z; p.priority = priority; p.distance = distance; p.caster = p.representative = false
    return index
  }

  capsule(ax: number, ay: number, bx: number, by: number, a: number, b: number, z: number,
    tint: number, energy: number, charID: number, priority: SACRPriority, distance: number, representative = false, casts = true): boolean {
    const x = worldToSACRX(ax, this.leftPx), tx = worldToSACRX(bx, this.leftPx)
    const ra = Math.max(.02, a / M), rb = Math.max(.02, b / M)
    const reach = Math.max(ra, rb)
    const slot = this.item(Math.min(x, tx) - reach, Math.max(x, tx) + reach, z, priority, distance)
    if (slot < 0) return false
    packCapsulePrim(this.packet, slot, x, -ay / M, tx, -by / M, ra, z, rb, tint >> 16 & 255, tint >> 8 & 255, tint & 255, energy, charID)
    this.items[slot].caster = casts && energy <= 0 && charID < SACR_SOLID_ID
    this.items[slot].representative = representative
    if (energy > 0) this.emissives++
    return true
  }

  impulse(ax: number, ay: number, bx: number, by: number, width: number, tint: number, e: number, arc?: { radius: number; angle: number; sweep: number }): void {
    // Order by horizontal range so a nearer beam wins within its priority.
    const distance = Math.abs((ax + bx) * .5 - this.centerPx)
    if (arc) {
      const x = worldToSACRX(ax, this.leftPx), r = arc.radius / M, w = Math.max(.01, width / M)
      const slot = this.item(x - r - w, x + r + w, SACR_ACTOR_Z, SACR_PRIORITY.emissive, distance)
      if (slot < 0) return
      packArcPrim(this.packet, slot, x, -ay / M, Math.cos(arc.angle), -Math.sin(arc.angle), r, SACR_ACTOR_Z,
        w, arc.sweep * .5, tint >> 16 & 255, tint >> 8 & 255, tint & 255, e)
      this.arcs++; this.emissives++
    } else {
      this.capsule(ax, ay, bx, by, width, width, SACR_ACTOR_Z, tint, e, 0, SACR_PRIORITY.emissive, distance)
    }
  }

  /** Real route spans, not dark puddle decals. Guarantee an admitted slab
   * in its bins even when a fighter fills K with same-ID limb capsules. */
  architecture(route: BridgeRoute, left: number, right: number): void {
    const bar = (l: number, r: number, y: number, thickness: number, depth: number, tint: number) => {
      // The packed near bound sorts before all bodies, even when the actual
      // ray intersection is deeper. This only reserves one slot per span.
      const a = worldToSACRX(l, this.leftPx), b = worldToSACRX(r, this.leftPx), near = SACR_NEAR_Z + .13
      const slot = this.item(a - .12, b + .12, near, SACR_PRIORITY.architecture, Math.abs((l + r) * .5 - this.centerPx))
      if (slot < 0) return
      packOpaqueBar(this.packet, slot, a, b, -y / M, thickness / (2 * M), near, depth, tint)
      this.undersides++
    }
    for (const c of route.between(left - 80, right + 80)) {
      const p = catwalkSlab(c)
      if (c.platform && this.supports < 8) {
        const { left: a, right: b, y } = c.platform, k = SACRUniformBuffer.OFF_SUPPORTS + 4 * this.supports++
        const v = this.packet.f32
        v[k] = worldToSACRX(a, this.leftPx); v[k+1] = worldToSACRX(b, this.leftPx); v[k+2] = -y / M; v[k+3] = deckFace(c).near
      }
      if (p) bar(p.left, p.right, (p.top + p.bottom) * .5, p.bottom - p.top, 7.2, 0x344655)
      const s = c.shelter
      if (s) bar(s.left, s.right, SHELTER_KIT[s.kind].eaveY - 5, 12, 7.56, s.kind === 'service' ? 0x514035 : 0x384958)
    }
  }

  actor(actor: ShadowActor, charID: number, priority: SACRPriority, tint = DARK_FIGHTER, scarf?: readonly Joint[]): void {
    if (charID < 0 || charID >= SACR_SOLID_ID) return
    this.casters++
    this.elevatedCasters += +((actor.floorY ?? 0) < -2)
    const { x, hipY, face, scale: s, geom: g } = actor, distance = Math.abs(x - this.centerPx)
    const wx = (p: Joint) => x + p.x * face * s, wy = (p: Joint) => hipY + p.y * s
    const depth = (v: number) => Math.max(SACR_NEAR_Z + .16, Math.min(SACR_CURB_Z - .15, SACR_ACTOR_Z - v * s / M * .46))
    const limb = (a: Joint, b: Joint, r0: number, r1: number, color = tint, representative = false, casts = true) =>
      this.capsule(wx(a), wy(a), wx(b), wy(b), r0 * s, r1 * s, depth(((a.z ?? 0) + (b.z ?? 0)) * .5), color, 0,
        charID, casts ? priority : SACR_PRIORITY.enemy, distance, representative, casts)

    // Connected, stable topology. Do not switch a disconnected shin into
    // the bin every time the stance changes which foot is lower.
    if (this.maxK === SACR_MOBILE_K) {
      limb(g.hip, g.headC, 7.2, 7.3, tint, true)
      limb(g.hip, g.toeL, 5.2, 2.6)
      limb(g.hip, g.toeR, 5.2, 2.6)
    } else {
      limb(g.hip, g.chest, 7.2, 7.1, tint, true)
      limb(g.chest, g.headC, 5.8, 7.4)
      limb(g.hip, g.kneeL, 5.0, 4.1)
      limb(g.hip, g.kneeR, 5.0, 4.1)
      limb(g.kneeL, g.toeL, 4.1, 2.6)
      limb(g.kneeR, g.toeR, 4.1, 2.6)
    }
    if (scarf && scarf.length >= 2) {
      // Cloth can use spare wet-return slots after live emission. It
      // never displaces a load-bearing limb in the direct-shadow bins.
      const first = scarf[0], last = scarf[this.maxK === SACR_MASTER_K ? scarf.length - 1 : 1]
      const mid = this.maxK === SACR_MASTER_K && scarf.length > 2 ? scarf[2] : { x: (first.x + last.x) * .5, y: (first.y + last.y) * .5 }
      if (limb(first, mid, 1.65, 1.36, DARK_CLOTH, false, false)) this.scarves++
      if (limb(mid, last, 1.36, 1.02, DARK_CLOTH, false, false)) this.scarves++
    } else if (this.maxK === SACR_MASTER_K) limb(g.chest, g.handR, 3.5, 2.6)
    // Feet leave widening, fading contact as they lift. Raised supports
    // have their own receiver and must never leak sole AO down to road.
    const floor = actor.floorY ?? 0, elevated = floor < -2
    if (actor.y < floor - 81) return
    const l = bridgeSole(actor, g.ankleL, g.toeL), r = bridgeSole(actor, g.ankleR, g.toeR)
    const foot = (a: Joint, b: Joint, sole: typeof l) => {
      if (this.feet >= SACR_FEET || sole.lift > 84) return
      const x = worldToSACRX(sole.x, this.leftPx)
      if (x < -.6 || x > this.viewWidthMeters + .6) return
      const radius = Math.min(1.20, sole.radius / M), lift = sole.lift / M
      const poseZ = (depth(((a.z ?? 0) + (b.z ?? 0)) * .5) - SACR_ACTOR_Z) * (elevated ? .29 : 1)
      // Negative lift tags a raised contact. Keep road AO out of the deck
      // and vice versa without growing the std140 packet.
      packFootAO(this.packet, this.feet++, x, SACR_ACTOR_Z + poseZ, radius, elevated ? -1 - lift : lift)
    }
    if (l.lift <= r.lift) { foot(g.ankleL, g.toeL, l); foot(g.ankleR, g.toeR, r) }
    else { foot(g.ankleR, g.toeR, r); foot(g.ankleL, g.toeL, l) }
  }

  seal(): void {
    this.bins.write(this.packet, this.items, this.viewWidthMeters, this.maxK, this.primitives)
    this.bins.write(this.packet, this.items, this.viewWidthMeters, this.maxK, this.primitives, true)
  }

  receipt() {
    return { version: '4.0', shadowK: this.maxK === SACR_MASTER_K ? 2 : 1, casters: this.casters, elevatedCasters: this.elevatedCasters, primitives: this.primitives, feet: this.feet, arcs: this.arcs, emissives: this.emissives,
      scarves: this.scarves, undersides: this.undersides, maxK: this.maxK, atlasVersion: this.stratum.version, portals: this.stratum.portals,
      camWorldX: this.camWorldX, atlasOriginX: this.stratum.originX, viewWidthMeters: this.viewWidthMeters }
  }
}
