/** STICKMAN RISING — smooth combat camera: tracking, look-ahead, zoom, trauma shake. */

import { clamp, damp, smoothstep } from './utils'

export interface BgCamView {
  x: number
  y: number
  zoom: number
}

export const PLAY_ZOOM = 1.04
export const LOGICAL_HEIGHT = 540
export const travelRoadCentre = (w: number, h: number) => w < h ? -85 : -112

export class Camera {
  x = 1300
  y = -150
  zoom = 1
  /** final render offsets (shake) */
  offX = 0
  offY = 0
  rot = 0

  private tx = 1300
  private ty = -150
  private tzoom = 1
  private baseZoom = 1
  private zoomBoost = 0
  private trauma = 0
  private shakeTime = 0
  private p1 = Math.random() * 100
  private p2 = Math.random() * 100
  private arenaMin = 0
  private arenaMax = 2600
  private viewW = 1280
  private viewH = 720
  private shakeScale = 1
  private travelFraming = false
  private breath = 0
  private idle = false

  setTravelFraming(on: boolean): void { this.travelFraming = on }
  private get viewportZoom(): number { return this.travelFraming ? this.viewH / LOGICAL_HEIGHT : 1 }

  setArena(minX: number, maxX: number): void {
    this.arenaMin = minX
    this.arenaMax = maxX
  }

  setViewport(w: number, h: number): void {
    this.viewW = w
    const oldScale = this.viewportZoom
    this.viewH = h
    this.zoom *= this.viewportZoom / oldScale
  }

  setShakeEnabled(on: boolean, intensity = 1): void {
    this.shakeScale = on ? intensity : 0
  }

  /** The road is the stable reference, not the last airborne target. Use the
   * same composition at entry and during play (including wave intermissions).
   * Short viewports need less headroom; wide viewports must not move the road. */
  private get roadCentreY(): number {
    if (this.travelFraming) return travelRoadCentre(this.viewW, this.viewH)
    return -clamp(this.viewH * .215, 52, 158) / PLAY_ZOOM
  }

  focus(x: number, y: number, vx: number, vy: number, gateX?: number): void {
    this.idle = Math.abs(vx) + Math.abs(vy) < 8 && y >= -1
    if (this.travelFraming) {
      // Follow the rendered root only when it exits this screen-space box.
      // No facing, strike velocity or enemy count can move the target. Keep
      // the new anchor on stopping/reversing; there is no catch-up pan.
      const box = Math.min(86, this.viewW * .115 / this.viewportZoom)
      // Portrait checkpoint approach looks down the road at the gantry,
      // using only its world address. Opening the gate doesn't change it.
      const d = gateX === undefined || this.viewW >= this.viewH ? Infinity : x - gateX
      const lead = 72 * smoothstep((d + 530) / 178) * smoothstep((26 - d) / 154)
      this.tx = clamp(this.tx, x + lead - box, x + lead + box)
    } else this.tx = x + vx * .13
    // Leave ordinary footwork in a dead zone. Follow higher jumps gradually,
    // without a timer that can suddenly rebase the horizon mid-fight.
    const altitude = Math.max(0, -y - clamp(vy * .04, -20, 20) - 55)
    this.ty = this.roadCentreY - altitude * .8
  }

  startOnRoad(x: number): void {
    this.baseZoom = this.travelFraming ? 1 : PLAY_ZOOM
    this.tzoom = this.zoom = this.baseZoom * this.viewportZoom
    this.zoomBoost = this.trauma = this.rot = this.offX = this.offY = this.breath = 0
    this.idle = false
    this.snapTo(this.travelFraming ? Math.max(x, this.arenaMin + this.viewW / (2 * this.zoom) - 60) : x, this.roadCentreY)
  }

  setZoom(z: number): void {
    this.baseZoom = this.travelFraming && z === PLAY_ZOOM ? 1 : z
  }

  /** Brief extra zoom-in kick (finishers). */
  zoomPulse(amount: number): void {
    this.zoomBoost = Math.max(this.zoomBoost, amount)
  }

  addTrauma(t: number): void {
    this.trauma = clamp(this.trauma + t, 0, 1)
  }

  snapTo(x: number, y: number): void {
    this.x = this.tx = x
    this.y = this.ty = y
  }

  update(dt: number): void {
    // clamp target inside arena so we never show void beyond the roof
    // A cinematic's magnification can change, but not the bridge's X anchor.
    const halfW = this.viewW / (2 * (this.travelFraming ? this.viewportZoom : this.zoom))
    const halfH = this.viewH / (2 * this.zoom)
    const cx = clamp(this.tx, this.arenaMin + halfW - 60, this.arenaMax - halfW + 60)
    const cy = clamp(this.ty, this.travelFraming ? -380 : Math.min(this.roadCentreY, -420 + halfH * 0.4), -40)
    this.x = this.travelFraming ? cx : damp(this.x, cx, 6.5, dt)
    this.y = damp(this.y, cy, 5, dt)

    this.zoomBoost = damp(this.zoomBoost, 0, 4, dt)
    this.tzoom = this.viewportZoom * this.baseZoom * (1 + this.zoomBoost)
    this.zoom = damp(this.zoom, this.tzoom, 3.2, dt)

    this.trauma = Math.max(0, this.trauma - dt * 1.7)
    this.shakeTime += dt
    const sh = this.trauma * this.trauma * this.shakeScale
    const t = this.shakeTime
    this.offX = (Math.sin(t * 39.3 + this.p1) * 0.6 + Math.sin(t * 61.7 + this.p2) * 0.4) * 30 * sh
    this.offY = (Math.cos(t * 44.9 + this.p1 * 2) * 0.65 + Math.sin(t * 33.1 + this.p2) * 0.35) * 22 * sh
    this.rot = Math.sin(t * 27.7 + this.p1) * 0.013 * sh
    if (this.travelFraming) {
      this.breath = damp(this.breath, this.idle ? .72 : 0, 4, dt)
      this.offY += Math.sin(t * 1.45) * this.breath * this.shakeScale
      this.offX = this.rot = 0 // preserve the bridge's horizontal datum on impact
    }
  }

  /** Presentation safety net after follow/trauma. Fit the solved hero
   * vertically when a high leap or cinematic zoom would cross the HUD or
   * crop the body. Do not recenter X or change the ground/pose. */
  fitTravelBody(top: number, bottom: number, headroom: number, footroom: number): void {
    if (!this.travelFraming || !Number.isFinite(top + bottom) || bottom <= top) return
    const h = this.viewH
    const a = clamp(headroom, 16, h * .38), b = clamp(footroom, 20, h * .32)
    this.zoom = Math.min(this.zoom, (h - a - b) / (bottom - top))
    const lo = bottom - (h * .5 - b) / this.zoom
    const hi = top + (h * .5 - a) / this.zoom
    this.y = clamp(this.y + this.offY, lo, Math.max(lo, hi)) - this.offY
  }

  view(): BgCamView {
    return { x: this.x, y: this.y, zoom: this.zoom }
  }
}
