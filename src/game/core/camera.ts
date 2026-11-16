/** STICKMAN RISING — smooth combat camera: tracking, look-ahead, zoom, trauma shake. */

import { clamp, damp } from './utils'

export interface BgCamView {
  x: number
  y: number
  zoom: number
}

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
  /** the camera height without the jump transient (see focus) */
  private yBase = Number.NaN
  /** the raw altitude target of the current frame (see focus) */
  private yTarget = Number.NaN
  /** seconds the altitude target has stayed away from the baseline */
  private yFarT = 0
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

  setArena(minX: number, maxX: number): void {
    this.arenaMin = minX
    this.arenaMax = maxX
  }

  setViewport(w: number, h: number): void {
    this.viewW = w
    this.viewH = h
  }

  setShakeEnabled(on: boolean, intensity = 1): void {
    this.shakeScale = on ? intensity : 0
  }

  /** Camera wants to focus this point (world coords) with look-ahead velocity. */
  focus(x: number, y: number, vx: number, vy: number): void {
    this.tx = x + vx * 0.13
    // The raw altitude target; update() folds it into the baseline below.
    this.yTarget = y + vy * 0.06 - 62
    if (!Number.isFinite(this.yBase)) {
      this.yBase = this.yTarget
      this.yFarT = 0
      this.ty = this.yBase
    }
  }

  setZoom(z: number): void {
    this.baseZoom = z
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
    this.yBase = this.yTarget = y
    this.yFarT = 0
  }

  update(dt: number): void {
    // Fold the raw altitude target into the slow BASELINE. A jump (or launch)
    // transient moves the target fast and far, then returns — the horizon
    // must not follow it: the mountains/sky are keyed to the horizon line, so
    // sliding it makes the far ridges float free of the scene (it reads as
    // space). The baseline only accepts a displacement that PERSISTS far
    // longer than any airborne round-trip (a real ground-level change).
    if (Number.isFinite(this.yTarget)) {
      if (!Number.isFinite(this.yBase)) {
        this.yBase = this.yTarget
        this.yFarT = 0
      } else if (Math.abs(this.yTarget - this.yBase) < 70) {
        this.yBase = this.yTarget
        this.yFarT = 0
      } else {
        this.yFarT += dt
        if (this.yFarT > 2.4) {
          this.yBase = this.yTarget
          this.yFarT = 0
        }
      }
      this.ty = this.yBase
    }
    // clamp target inside arena so we never show void beyond the roof
    const halfW = this.viewW / (2 * this.zoom)
    const halfH = this.viewH / (2 * this.zoom)
    const cx = clamp(this.tx, this.arenaMin + halfW - 60, this.arenaMax - halfW + 60)
    const cy = clamp(this.ty, -420 + halfH * 0.4, -40)
    this.x = damp(this.x, cx, 6.5, dt)
    this.y = damp(this.y, cy, 5, dt)

    this.zoomBoost = damp(this.zoomBoost, 0, 4, dt)
    this.tzoom = this.baseZoom * (1 + this.zoomBoost)
    this.zoom = damp(this.zoom, this.tzoom, 3.2, dt)

    this.trauma = Math.max(0, this.trauma - dt * 1.7)
    this.shakeTime += dt
    const sh = this.trauma * this.trauma * this.shakeScale
    const t = this.shakeTime
    this.offX = (Math.sin(t * 39.3 + this.p1) * 0.6 + Math.sin(t * 61.7 + this.p2) * 0.4) * 30 * sh
    this.offY = (Math.cos(t * 44.9 + this.p1 * 2) * 0.65 + Math.sin(t * 33.1 + this.p2) * 0.35) * 22 * sh
    this.rot = Math.sin(t * 27.7 + this.p1) * 0.013 * sh
  }

  view(): BgCamView {
    return { x: this.x, y: this.y, zoom: this.zoom }
  }
}
