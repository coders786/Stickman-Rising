import { RailSchedule, RAIL_ARCHETYPES, railLocalOffset, RAIL_WHEEL_BOTTOM, RAIL_CAR_PITCH, RAIL_SUPPORT_PITCH, RAIL_MODEL_SCALE, RAIL_Y, RAIL_SUPPORT, RAIL_LANES, type RailEvent } from '../../graphics/bridge/RailSchedule'
import { BLOCKER_LIMIT, WORLD_BLOCKER_LIMIT, blockerHit, type Blocker } from '../../graphics/bridge/NoirGeometry'
import { skyHash } from '../../graphics/bridge/SkyBasis'
import { wrap } from '../world/fronts'
import { applySectionView, railProject, sectionSpan, sectionY, type SectionCamera } from './bridge-depth'
import { routeWind } from './bridge-sockets'
import { hasPixels, type SurfaceScope } from '../render/ledger'
import { edge, face, ramp, slab, type ArtPen } from './bridge-art'

const CAR_W = 151, CAR_H = 54, SEAM = RAIL_CAR_PITCH
const PITCH = RAIL_SUPPORT_PITCH
const MAX_RAIL_BLOCKERS = BLOCKER_LIMIT - WORLD_BLOCKER_LIMIT

function railCar(g: ArtPen, cab: boolean, kind: 0 | 3 = 0): void {
  const w = CAR_W - 4
  // Separate bogies, weathered roof louvers and a raked windscreen. The
  // window strip is behind the thickness of the pressure-hull frame.
  for (const x of [24, w - 24]) {
    slab(g, '#080a0d', x - 14, 41, 28, 8)
    g.fillStyle = '#090b0e'; g.beginPath(); g.arc(x - 7, 46, 5, 0, Math.PI * 2); g.arc(x + 7, 46, 5, 0, Math.PI * 2); g.fill()
    slab(g, '#414347', x - 13, 45, 26, 1.3)
  }
  face(g, '#101216', 3, 37, w - 1, 37, w - 6, 45, 8, 45)
  face(g, '#24292f', 3, 17, 13, 7, w - (cab ? 28 : 9), 7, w - 5, 16, w, 29, w - 2, 42, 4, 42)
  face(g, ramp(g, 0, 9, 0, 20, '#95abb3', '#506474', '#253841'), 3, 17, 13, 7, w - (cab ? 28 : 9), 7, w - 5, 16, w - 33, 20, 6, 20)
  slab(g, '#0d1114', 4, 22, w - (cab ? 23 : 6), 12)
  slab(g, '#393b3a', 4, 34, w - (cab ? 14 : 6), 1.5)
  for (let x = 8, i = 0; x < w - (cab ? 29 : 12); x += 19, i++) {
    const v = skyHash(i, +cab, 39)
    slab(g, '#080a0e', x, 21, 14, 12)
    slab(g, v < .23 ? '#424a52' : v < .56 ? '#bba27b' : '#ded1a6', x + 1.3, 22.4, 11.3, 7.7)
    slab(g, '#342e26', x + 5.6, 21.9, 1.35, 9.2)
    slab(g, '#aca08129', x + 1.7, 22.4, 10.1, 1.2)
    for (let n = 0; n < 2; n++) if (skyHash(i, n + 1, 41) > .44) {
      const d = x + 1.5 + n * 6.2
      g.beginPath(); g.ellipse(d + 2, 26.8, 1.2, 1.7, 0, 0, Math.PI * 2); g.fillStyle = '#372a1f'; g.fill()
      slab(g, '#43352a', d + .7, 28, 3, 2.15)
    }
    slab(g, '#76716a', x + 15, 38, 1.3, 2)
  }
  for (const x of [24, 114]) {
    slab(g, '#111416', x, 18.5, 1.3, 20)
    slab(g, '#0a0c10', x - 8, 6, 16, 2)
  }
  slab(g, kind === 3 ? '#8fa581' : '#c67f60', 4, 35, w - 8, 2.8)
  slab(g, '#aec4c491', 4, 37.5, w - 8, .9)
  if (kind === 3) {
    // Double-leaf doors and destination strip of the city stopping service.
    for (const x of [34, 100]) {
      slab(g, '#536873', x, 18, 17, 23); slab(g, '#a3b491', x, 37, 17, 1.7)
      slab(g, '#152934', x + 2, 20, 5.3, 9); slab(g, '#152934', x + 9.3, 20, 5.3, 9)
      slab(g, '#18242c', x + 8, 19, 1, 22)
    }
  } else if (cab) slab(g, '#b38b70', w - 44, 30, 12, .9)
  if (cab) {
    face(g, '#0a0d12', w - 30, 18, w - 14, 17, w - 8, 29, w - 27, 30)
    face(g, '#535c62', w - 26, 18.8, w - 15, 18, w - 12, 26.5, w - 25, 25.6)
    slab(g, '#dfd7be38', w - 11.5, 33, 9.5, 4.4)
    slab(g, '#d8e2da', w - 8, 34, 5.7, 2.4)
  } else slab(g, '#16191b', w - 2, 27, 10, 7)
  for (let i = 0; i < 41; i++) {
    const x = 6 + skyHash(i, 9, 42) * (w - 22), y = 9 + skyHash(i, 2, 84) * 32
    slab(g, i & 1 ? '#00000027' : '#ad9d8823', x, y, 1.4 + skyHash(i, 0, 64) * 7, .65)
  }
}

function freightCar(g: ArtPen, type: number): void {
  const c = type % 3
  slab(g, '#17191a', 4, 37, 145, 7)
  for (const x of [17, 122]) {
    slab(g, '#090a0c', x - 3, 41, 24, 7); slab(g, '#51524e', x, 44, 17, 1.1)
    g.fillStyle = '#101419'; g.beginPath()
    for (const u of [x + 1, x + 14]) { g.moveTo(u + 5, 46); g.arc(u, 46, 5, 0, 2 * Math.PI) }
    g.fill()
  }
  if (c === 1) {
    g.fillStyle = ramp(g, 0, 12, 0, 39, '#757572', '#414443', '#292c30')
    g.beginPath(); g.roundRect(8, 12, 135, 28, 12); g.fill()
    for (const x of [30, 115]) { slab(g, '#202323', x, 12, 4, 29); slab(g, '#a390673a', x + 1, 14, 1, 24) }
    slab(g, '#171a1b', 72, 9, 15, 4)
  } else {
    const fill = c ? '#4d493b' : '#514440'
    boxLike(g, 6, 10, 139, 29, fill)
    for (let x = 12; x < 141; x += 7) { slab(g, '#0b0f1471', x, 12, 2, 25); slab(g, '#aba08a47', x + 2, 12, 1, 22) }
    slab(g, '#c9ae815c', 12, 28, 24, 2); slab(g, '#9a6d4c91', 130, 23, 3, 9)
  }
  slab(g, '#4f4438', 143, 37, 17, 3)
}
function boxLike(g: ArtPen, x: number, y: number, w: number, h: number, fill: string) {
  slab(g, ramp(g, 0, y, 0, y + h, '#616261', fill, '#211f1e'), x, y, w, h)
  face(g, '#717067', x, y, x + 5, y - 4, x + w - 3, y - 4, x + w, y)
  slab(g, '#171817', x, y + h - 2, w, 2)
}
function securityCar(g: ArtPen, cab: boolean): void {
  railCar(g, cab)
  face(g, '#2e3234', 6, 17, 21, 11, 120, 11, 139, 20, 135, 39, 8, 39)
  slab(g, '#101518', 14, 22, 110, 7)
  for(let x = 17; x < 120; x += 18) { slab(g, '#64635a82', x, 24, 11, 2); slab(g, '#77716c58', x, 15, 1, 22) }
  slab(g, '#a28e6d60', 10, 35, 122, 1)
  slab(g, '#24262a', cab ? 112 : 64, 4, 22, 7)
  slab(g, '#562924', cab ? 123 : 73, 6, 5, 3)
}

function freightCab(g: ArtPen): void {
  freightCar(g, 1)
  // Short hood + high box cab, unlike the rounded passenger head.
  boxLike(g, 6, 14, 97, 28, '#4a544c')
  boxLike(g, 101, 8, 39, 34, '#646051')
  slab(g, '#191f20', 114, 12, 20, 11)
  slab(g, '#d6ba7b', 102, 30, 38, 3)
  slab(g, '#fff1bd', 138, 23, 6, 2.7)
  for (let x = 24; x < 91; x += 4) slab(g, '#232927', x, 18, 1, 19)
}

export class BridgeRail {
  readonly blockers: Blocker[] = Array.from({ length: MAX_RAIL_BLOCKERS }, () => ({ left: 0, right: 0, top: RAIL_SUPPORT.top, bottom: 14, kind: 'pier' }))
  private spanCard: HTMLCanvasElement | null = null
  private cars: HTMLCanvasElement | null = null
  private glass: HTMLCanvasElement | null = null
  private schedule = new RailSchedule(42)
  private seed = 42
  last = { leadX: 0, scale: 1, railY: 0, footingY: 0, bearings: 0, bodies: 0, trains: 0, blockers: 0, clipped: 0, kind: '', speed: 0, wake: 0, units: 'native px/s' }
  constructor(private readonly scope: SurfaceScope) {}

  wake(seed: number, t: number, x: number) {
    if (seed !== this.seed) { this.seed = seed; this.schedule = new RailSchedule(seed) }
    return this.schedule.wake(t, x)
  }

  paint(g: CanvasRenderingContext2D, w: number, h: number, cam: SectionCamera,
    streetY: number, time: number, quiet: boolean, seed: number, master: boolean, wind = 0) {
    const { scale: z, rail: y } = railProject(cam, h), span = sectionSpan(cam, w, h) / RAIL_MODEL_SCALE
    const offset = wrap(railLocalOffset(cam.x) - span * .5, PITCH)
    const first = -offset - PITCH, foot = (streetY - RAIL_Y) / RAIL_MODEL_SCALE
    const { left, right, top, base, arm, wire } = RAIL_SUPPORT
    const r = this.last
    r.bodies = r.trains = r.clipped = r.blockers = r.speed = r.leadX = r.bearings = 0
    r.kind = ''; r.scale = z; r.railY = y; r.footingY = sectionY(cam, h, streetY)
    r.wake = quiet ? 0 : this.wake(seed, time, cam.x)
    if (!cam.rot && (y + (top - 50) * z > h || r.footingY + 9 * z < 0)) return
    g.save(); applySectionView(g, cam, w, h)
    g.translate(cam.x - span * RAIL_MODEL_SCALE * .5, RAIL_Y); g.scale(RAIL_MODEL_SCALE, RAIL_MODEL_SCALE)
    // Structural datum is the sidewalk below, not the image crop. Each
    // column lands in a plinth at the edge of the service court.
    for (let x = first; x < span + PITCH; x += PITCH) {
      if (foot > 81 && x >= -110 && x <= span + 72 && y + 39*z < h) {
        const knee = Math.min(117, foot - 32)
        face(g, '#252e36', x - 93, 26, x + 77, 26, x + 44, knee - 14, x - 25, knee - 14)
        edge(g, '#5b656858', 1.4, x - 88, 32, x - 26, knee - 14)
        face(g, ramp(g, x - 28, 0, x + 52, 0, '#364452', '#293545', '#1b2735'),
          x - 28, 32, x + 51, 32, x + 34, foot - 11, x - 10, foot - 11)
        face(g, '#141f2e', x + 51, 32, x + 71, 23, x + 53, foot - 13, x + 34, foot - 11)
        edge(g, '#77888d5e', 1.35, x - 18, 76, x - 4, foot - 14)
        const seam = 88 + (foot - 99) * .36
        edge(g, '#111d28', 3.2, x - 19, seam, x + 40, seam)
        edge(g, '#8c9f9c44', 1, x - 19, seam + 2, x + 40, seam + 2)
        face(g, '#586366', x - 51, foot, x - 27, foot - 18, x + 53, foot - 18, x + 74, foot)
        slab(g, '#253740', x - 51, foot - 1, 125, 9)
        slab(g, '#8b918368', x - 48, foot - 1, 119, 1.3)
        r.bearings++
      }
      if (x + right >= -285 && x + left <= span + 285 && r.blockers < MAX_RAIL_BLOCKERS) {
        const b = this.blockers[r.blockers++]; b.left = x + left; b.right = x + right
      }
    }
    slab(g, '#25333f', -2, -41, span + 4, 80)
    const card = this.deckCard()
    for (let x = -offset; x < span; x += PITCH) {
      if (card) g.drawImage(card, x, -43)
      else { g.save(); g.translate(x, 0); this.span(g); g.restore() }
    }
    if (!quiet) this.schedule.sample(time, cam.x, span * .5 + 296)
    const stock = !quiet && this.schedule.count ? this.carSprites() : null
    // Far bed + head first; its rail cannot paint across the near carriage.
    for (const dir of [-1, 1]) {
      const lane = RAIL_LANES[+(dir < 0)]
      if (!quiet) for (let i = 0; i < this.schedule.count; i++) {
        const e = this.schedule.events[this.schedule.indices[i]], age = this.schedule.time[i]
        if (e.dir !== dir) continue
        this.train(g, stock, e, span * .5 + age * e.speed * e.dir, span, age, time, master, lane)
      }
      slab(g, '#293844', -2, lane, span + 4, 3.1)
      slab(g, '#9aa9a8a8', -2, lane, span + 4, 1.15)
    }
    // The acoustic screen transmits the rolling stock already behind it.
    // Its tint, seals and reflections are one small transparent stamp.
    const glass = this.glassCard()
    for (let x = -offset; x < span; x += PITCH) {
      if (glass) g.drawImage(glass, x, -28)
      else { g.save(); g.translate(x, -28); this.glassSpan(g); g.restore() }
    }
    for (let x = first; x < span + PITCH; x += PITCH) {
      if (x + arm < -8 || x + left > span + 8) continue
      slab(g, '#263646', x + left, top, right - left, base - top)
      slab(g, '#71858e69', x + left + 1, top, 1.7, base - top)
      face(g, '#30424e', x + left - 7, base, x + right + 8, base, x + right + 5, base + 7, x + left - 4, base + 7)
      slab(g, '#879d9a9c', x + left - 4, base, right - left + 8, 1.25)
      edge(g, '#354653', 2.4, x + right - 2, top + 13, x + arm, wire - 9, x + right - 2, wire + 21)
      for (let j = 0; j < 3; j++) slab(g, '#9aa99d', x + arm - 3, wire - 8 + 3 * j, 6, 1.2)
    }
    g.beginPath()
    for (let x = first + arm; x < span + 12; x += PITCH) {
      const tx = x + PITCH, wx = cam.x + (x + PITCH * .5 - span * .5) * RAIL_MODEL_SCALE
      const sag = 5.5 + r.wake * 2.8 + (quiet ? 0 : 2.7 * routeWind(wx, time, wind))
      g.moveTo(x, wire - 9); g.quadraticCurveTo(x + PITCH * .5, wire - 9 + sag, tx, wire - 9)
      g.moveTo(x, wire); g.quadraticCurveTo(x + PITCH * .5, wire + sag * .34, tx, wire)
      for (const t of [.25, .5, .75]) {
        const pull = 2 * t * (1 - t) * sag, j = x + t * PITCH
        g.moveTo(j, wire - 9 + pull); g.lineTo(j, wire + pull * .34)
      }
    }
    g.strokeStyle = '#546674'; g.lineWidth = .98; g.stroke()
    g.restore()
  }

  private glassCard() {
    if (hasPixels(this.glass)) return this.glass
    const c = this.scope.tryAcquire('rail-glass', PITCH, 35, 'bridge-rail-glass'), g = c?.getContext('2d')
    if (!c || !g) return null
    this.glassSpan(g)
    return this.glass = c
  }

  private glassSpan(g: ArtPen) {
    const pane = ramp(g, 0, 0, 0, 32, '#9fc5d235', '#42667529', '#314c6191')
    const pitch = PITCH / 6
    for (let j = 0; j < 6; j++) {
      const x = j * pitch
      slab(g, pane, x + 1, 1, pitch - 2, 29)
      face(g, '#c2d5d92a', x + 13, 2, x + 22, 2, x + 39, 29, x + 32, 29)
      edge(g, '#bdd8dc55', .8, x + 2, 3, x + pitch - 3, 3)
      slab(g, '#203542', x, 0, 2.2, 33)
      slab(g, '#a5bcc16b', x + .3, 0, .65, 31)
      slab(g, '#334b57', x + 1, 30, pitch - 1, 3)
    }
  }

  private deckCard() {
    if (hasPixels(this.spanCard)) return this.spanCard
    const c = this.scope.tryAcquire('rail-deck', PITCH, 84, 'bridge-rail-span'), g = c?.getContext('2d')
    if (!c || !g) return null
    g.translate(0, 43); this.span(g)
    return this.spanCard = c
  }

  private span(g: ArtPen) {
    slab(g, ramp(g, 0, -42, 0, 41, '#48555d', '#343f49', '#141d29'), 0, -42, PITCH, 83)
    for (const lane of RAIL_LANES) {
      slab(g, '#252e36', 0, lane - 13, PITCH, 16)
      // Give each sleeper a top face across the two rail heads. A repeated
      // vertical tick on an opaque band reads as a fence, not ballast.
      for (let x = 6; x + 8 < PITCH; x += 14.2) {
        face(g, '#596466', x, lane + 1.7, x + 4.3, lane + 1.7, x + 9, lane - 10.8, x + 4.7, lane - 10.8)
        edge(g, '#82918b82', .6, x + 1, lane - .9, x + 4.5, lane - 10.2)
      }
      slab(g, '#1b2731', 0, lane - 10, PITCH, 2.6)
      slab(g, '#9ba4a486', 0, lane - 10, PITCH, .86)
    }
    slab(g, '#667b86a3', 0, 10, PITCH, 1.7)
    slab(g, '#182531', 0, 26, PITCH, 4)
    slab(g, '#67727a75', 0, 36, PITCH, 1.6)
    slab(g, '#111920', 0, 39, PITCH, 2)
    for (let x = 4; x < PITCH; x += 31) slab(g, '#8c9b986e', x, 17, 1.8, 2.2)
    for (const x of [14, 51]) {
      slab(g, '#172531', x, 12, 3, 26)
      slab(g, '#71899264', x + 2, 13, 1, 20)
    }
    slab(g, '#ae976362', 18, 19, 27, 3)
  }

  private train(g: CanvasRenderingContext2D, stock: HTMLCanvasElement | null, e: RailEvent, head: number, span: number,
    age: number, time: number, master: boolean, trackY: number) {
    const { kind, cars, dir } = e
    const r = this.last, tail = head - dir * (cars * SEAM + 10)
    if (Math.max(head, tail) < -310 || Math.min(head, tail) > span + 310) return
    r.kind = RAIL_ARCHETYPES[kind]; r.speed = e.speed; r.leadX = head
    if (master && head >= -300 && head <= span + 300) {
      // Narrow anisotropic beam traces against piers at their rail addresses; integrate from the lens up to each first solid intersection.
      const source = trackY - 24, security = kind === 2
      const sweep = security ? .88 + .44 * Math.sin(age * 6.7) : .19
      for (let j = -6; j <= 6; j++) {
        const k = j / 6, dest = head + dir * (security ? 125 * sweep + j * 9 : 279 - 36 * k * k), y1 = source + (security ? 140 - k * 18 : 25 * k)
        let amount = 1
        for (let i = 0; i < r.blockers; i++) {
          const b = this.blockers[i]
          if (!blockerHit(head, source, dest, y1, b)) continue
          const near = (dir > 0 ? b.left : b.right) - head
          const u = near / (dest - head)
          if (u > 0) amount = Math.min(amount, u)
        }
        if (amount < 1) r.clipped++
        const gain = (1 - .82 * k * k) * (security ? .23 : .13)
        const beam = g.createLinearGradient(head, source, dest, y1)
        beam.addColorStop(0, `rgba(221,216,189,${gain})`); beam.addColorStop(1, 'rgba(181,192,202,0)')
        edge(g, beam, security ? 5 : 3, head, source, head + (dest - head) * amount, source + (y1 - source) * amount)
      }
    }
    const before = r.bodies
    for (let j = cars - 1; j >= 0; j--) {
      const x = head - dir * (j * SEAM + CAR_W - 5)
      if (Math.max(x, x + dir * CAR_W) < 0 || Math.min(x, x + dir * CAR_W) > span) continue
      const type = kind === 1 ? j === 0 ? 9 : 2 + (j + e.skin) % 3 : kind === 2 ? 5 + +(j === 0) : kind === 3 ? 7 + +(j === 0) : +(j === 0)
      g.save(); g.translate(x, trackY - RAIL_WHEEL_BOTTOM); g.scale(dir, 1)
      g.globalAlpha *= .86; slab(g, '#13141638', -26, 29, 84, 5); g.globalAlpha /= .86
      if (stock) g.drawImage(stock, 0, type * CAR_H, CAR_W + 10, CAR_H, 0, 0, CAR_W + 10, CAR_H)
      else this.carType(g, type)
      if (j === 0) {
        g.fillStyle = '#dacfaa'; g.font = 'bold 5px monospace'; g.textAlign = 'left'
        g.fillText(`${['X','F','S','M'][kind]}${e.skin + 1}`, 109, 37)
      }
      if (type === 0 && (j + e.skin) % 4 === 1) slab(g, '#0d0e11ae', 3, 21, 122, 11)
      if (j === cars - 1) slab(g, '#c26956', 3, 34, 4.3, 2.1)
      const pulse = time * 4.4 + j * .31, tick = Math.floor(pulse)
      if (master && kind === 2 && j === 0 && pulse - tick < .18) slab(g, '#d47c6c', 125, 6, 4, 1.9)
      if (master && kind === 0 && j === 1 && pulse - tick < .14 && skyHash(tick, e.skin, 419) > .54) {
        edge(g, '#9cb5c8', 1.0, 75, 7, 82, -.9, 85, -2.8, 96, -3.1)
        edge(g, '#dbcbb1', .6, 83, -2, 62, -1.4)
      }
      if (kind === 1 && pulse - tick < .12) edge(g, '#cf9a68', .9, 29, 47, 18, 50, 3, 50.8)
      g.restore(); r.bodies++
    }
    if (r.bodies > before) r.trains++
  }

  private carType(g: ArtPen, i: number) {
    if (i === 9) freightCab(g)
    else if (i >= 7) railCar(g, i === 8, 3)
    else if (i >= 5) securityCar(g, i === 6)
    else if (i >= 2) freightCar(g, i - 2)
    else railCar(g, i === 1)
  }

  private carSprites() {
    if (hasPixels(this.cars)) return this.cars
    const a = this.scope.tryAcquire('rail-stock', CAR_W + 10, CAR_H * 10, 'bridge-train-atlas')
    const g = hasPixels(a) ? a.getContext('2d') : null
    if (!g || !a) return null
    g.clearRect(0, 0, a.width, a.height)
    for (let i = 0; i < 10; i++) {
      g.save(); g.translate(0, i * CAR_H)
      this.carType(g, i)
      g.restore()
    }
    return this.cars = a
  }
}
