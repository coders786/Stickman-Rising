import type { BakeWindow } from '../bridge/BridgeBakeProtocol'
import { bridgeHash } from '../../game/stage/bridge-material'
import { districtSocket, fillLampSocket, lampHealth } from '../../game/stage/bridge-sockets'
import { sectorAt, SECTOR_LENGTH, type BridgeRoute, type RouteShelter } from '../../game/stage/route'
import { shelterPortal } from '../../game/stage/run-layout'
import { bakeStratumMips, STRATUM_CURB_HEIGHT, STRATUM_H, STRATUM_MAX_LOD, STRATUM_W, type StratumMip } from './SACRAtlas'
import { packArchProfile, SACR_ARCH_RECORDS, SACR_PX_PER_METER, type RGB, SACRUniformBuffer } from './SACRPacker'

const COLUMN_PX = 12
const GUARD_PX = 2 * SACR_PX_PER_METER
const EXTERIOR: readonly RGB[] = [[.027, .031, .036], [.032, .029, .026], [.028, .031, .032]]
const FIXTURES: readonly RGB[] = [[.74, .42, .19], [.70, .39, .18], [.43, .52, .60]]
const WARM_SOFFIT: RGB = [.22, .116, .046]
const COOL_SOFFIT: RGB = [.10, .096, .087]
const tent = (x: number) => Math.max(0, 1 - Math.abs(x))

/** A stable world-space window, shifted only on chunk boundaries. Baking
 * uses the same lamp/sign/catwalk/bay sockets as the visible route, not a
 * scene capture. Snap to the coarsest mip's texel grid to avoid swimming
 * when a neighbour takes over; guard enough columns for bent curb rays. */
export class BridgeStratum {
  private route: BridgeRoute | null = null
  private startPx = 0
  private stepPx = COLUMN_PX
  private readonly linear = new Float32Array(STRATUM_W * STRATUM_H * 3)
  mips: readonly StratumMip[] = []
  originX = 0
  widthMeters = 0
  version = 0
  portals = 0

  accept(stream: BakeWindow | null, buf: SACRUniformBuffer): void {
    if (!stream) { this.mips = []; this.version = this.portals = this.originX = this.widthMeters = 0; buf.clearArchitecture(); return }
    buf.u32.set(stream.architecture, SACRUniformBuffer.OFF_ARCHPROFILE)
    this.originX = stream.curbOrigin; this.widthMeters = stream.curbWidth
    this.mips = stream.curb; this.version = stream.id; this.portals = 0
    for (let i = 0; i < stream.architecture.length && stream.architecture[i + 1] > stream.architecture[i]; i += 4) this.portals++
  }

  update(route: BridgeRoute, left: number, right: number, buf: SACRUniformBuffer): void {
    const lo = left - GUARD_PX, hi = right + GUARD_PX
    // Choose a wider footprint only on unusually large/wide viewports.
    let step = COLUMN_PX
    while (step * STRATUM_W < hi - lo + 2200) step *= 2
    if (route === this.route && step === this.stepPx && lo >= this.startPx && hi <= this.startPx + step * STRATUM_W) return
    const grid = step * (1 << STRATUM_MAX_LOD)
    const chunk = route.at(lo - 240)
    const leftEdge = lo < 240 ? lo - 240 : chunk.left
    this.startPx = Math.floor(leftEdge / grid) * grid
    // Keep a wide view fully covered even if the selected chunk is long.
    if (hi > this.startPx + step * STRATUM_W) this.startPx = Math.floor(lo / grid) * grid
    this.originX = this.startPx / SACR_PX_PER_METER
    this.widthMeters = step * STRATUM_W / SACR_PX_PER_METER
    this.route = route; this.stepPx = step
    buf.clearArchitecture()
    this.portals = 0
    const endPx = this.startPx + step * STRATUM_W
    for (const { shelter } of route.between(this.startPx, endPx)) {
      if (!shelter || this.portals >= SACR_ARCH_RECORDS) continue
      const { left, right, lintel, depth } = shelterPortal(shelter)
      const a = Math.max(this.startPx, left), b = Math.min(endPx, right)
      if (b <= a) continue
      packArchProfile(buf, this.portals++, (a - this.startPx) / SACR_PX_PER_METER, (b - this.startPx) / SACR_PX_PER_METER,
        depth / SACR_PX_PER_METER, lintel / SACR_PX_PER_METER, shelter.kind === 'service' ? WARM_SOFFIT : COOL_SOFFIT)
    }
    const gates: number[] = []
    for (let n = Math.max(0, sectorAt(this.startPx - SECTOR_LENGTH) - 1); n <= sectorAt(endPx + 120); n++) {
      const x = route.gateX(n)
      if (x + 48 >= this.startPx && x - 48 < endPx) gates.push(x)
    }
    let c = route.at(this.startPx)
    for (let x = 0; x < STRATUM_W; x++) {
      const wx = this.startPx + (x + .5) * step
      if (wx >= c.right) c = route.at(wx)
      const inSpan = wx >= c.left
      const band = c.visualBand
      const base = EXTERIOR[band], sign = FIXTURES[band]
      const pair = fillLampSocket(c)
      const lamp = inSpan ? (tent((wx - c.lamp + 15) / 34) + (pair === null ? 0 : tent((wx - pair - 15) / 34))) * lampHealth(c) : 0
      const warning = inSpan && c.wetSign !== null ? tent((wx - c.wetSign) / 62) : 0
      const district = band > 0 && !c.shelter && inSpan ? tent((wx - districtSocket(c)) / (band === 1 ? 113 : 92)) : 0
      let gate = 0
      for (const x of gates) gate = Math.max(gate, tent((wx - x) / 48))
      const rail = 1 - tent((wx - (c.left + 10)) / 25) * .5
      const s = c.shelter, portal = s ? shelterPortal(s) : null
      const interior = s && portal && wx >= portal.left && wx < portal.right ? s : null
      // Band 0 row 0 is ground. Band 1 uses the same up direction; a
      // separately prefiltered warm backwall sits behind the portal.
      for (let row = 0; row < STRATUM_H / 2; row++) {
        const t = (row + .5) / (STRATUM_H / 2), h = t * STRATUM_CURB_HEIGHT
        const grain = bridgeHash(Math.floor(wx / 6), row >> 1, c.seed) * .40 + .84
        const steel = (.84 + .40 * t + .29 * tent((h - .6) / .21)) * rail * grain
        const light = lamp * (.04 * tent((h - 3.2) / 1.3) + .94 * tent((h - 4.62) / .17))
          + district * .13 * tent((h - (band === 1 ? 4.8 : 3.4)) / .24)
        const caution = warning * .055 * tent((h - 3.42) / .46)
        const red = gate * .18 * t
        const i = (row * STRATUM_W + x) * 3
        this.linear[i] = base[0] * steel + light * sign[0] + caution + red
        this.linear[i + 1] = base[1] * steel + light * sign[1] + .58 * caution + red * .12
        this.linear[i + 2] = base[2] * steel + light * sign[2] + .19 * caution + red * .18
        this.bakeBackwall(i + STRATUM_W * STRATUM_H * 3 / 2, t, grain, wx, interior)
      }
    }
    this.mips = bakeStratumMips(this.linear)
    this.version++
  }

  private bakeBackwall(i: number, t: number, grain: number, x: number, shelter: RouteShelter | null): void {
    const warm = shelter?.kind === 'service'
    const s = shelter ? .12 + .48 * tent((x - shelter.terminal) / ((shelter.right - shelter.left) * .56)) : .11
    const metal = grain * (.78 + .22 * Math.cos(32 * Math.PI * t))
    const lamp = (t > .78 && t < .85 ? .65 : .23) * s
    const h = lamp + (s * (.39 + .72 * t)) * metal
    this.linear[i] = h * (warm ? 1.00 : .66)
    this.linear[i + 1] = h * (warm ? .56 : .63)
    this.linear[i + 2] = h * (warm ? .26 : .57)
  }
}
