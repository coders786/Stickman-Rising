import { chunkLightData } from '../../graphics/bridge/NoirGeometry'
import { SACR_ACTOR_Z, SACR_CURB_Z, SACR_NEAR_Z } from '../../graphics/sacr/SACRMath'
import { SACR_PX_PER_METER } from '../../graphics/sacr/SACRPacker'
import { FACADE_RECEIVER_Z, newReceiverLight, SACR_LIGHT_KIND } from '../../graphics/sacr/SACRLocalLight'
import { deckFace, deckTopPath, TOP_LANE, type DeckFace } from '../stage/bridge-deck-face'
import { hasPixels, SurfaceScope } from './ledger'
import { puddlePath } from '../stage/bridge-art'
import { ROAD } from '../stage/road-section'
import type { BridgeRoute } from '../stage/route'
import type { BackgroundRenderer } from '../world/background'
import type { BridgeFrame } from './bridge-frame'

const FIELD_W = 96, FIELD_H = 42, STEP = 7, MAX_FACES = 24

/** Approximate the same finite, blocked light field in a tiny reusable
 * raster on existing planar faces. It is independent of display pixels,
 * so we never read the scene or tint the air between silhouettes. */
export class BridgeCanvasReceivers {
  private readonly scope = new SurfaceScope('bridge-local-light')
  private readonly tap = newReceiverLight()
  private image: ImageData | null = null
  private patches = 0

  private patch(ctx: CanvasRenderingContext2D, f: BridgeFrame, index: number,
    left: number, top: number, right: number, bottom: number, plane: 'road' | 'front' | 'up', gain: number, face?: DeckFace): void {
    if (this.patches >= MAX_FACES) return
    const k = index * 4, r = f.source[k + 2], ax = f.source[k] + f.cam.x, ay = f.source[k + 1]
    const x = Math.max(left, f.view.left, Math.floor((Math.min(ax, f.shape[k] + f.cam.x) - r) / STEP) * STEP)
    const tx = Math.min(right, f.view.right, Math.ceil((Math.max(ax, f.shape[k] + f.cam.x) + r) / STEP) * STEP)
    const y = Math.max(top, f.view.top, (Math.min(ay, f.shape[k + 1]) - r) / (plane === 'road' ? .56 : 1))
    const ty = Math.min(bottom, f.view.bottom, (Math.max(ay, f.shape[k + 1]) + r) / (plane === 'road' ? .56 : 1))
    if (tx <= x || ty <= y) return
    const c = this.scope.tryAcquire('field', FIELD_W, FIELD_H, 'bridge-local-receiver')
    const g = hasPixels(c) ? c.getContext('2d') : null
    if (!g || !c) return
    this.patches++
    const img = this.image ??= g.createImageData(FIELD_W, FIELD_H), d = img.data
    const nx = Math.min(FIELD_W, Math.ceil((tx - x) / STEP)), ny = Math.min(FIELD_H, Math.ceil((ty - y) / STEP))
    const dx = (tx - x) / nx, dy = (ty - y) / ny, road = plane === 'road'
    for (let j = 0; j < ny; j++) {
      const wy = y + (j + .5) * dy, h = road ? wy * .56 : face ? bottom : wy
      const depth = road ? (SACR_CURB_Z + (wy - ROAD.rear) / (ROAD.front - ROAD.rear) * (SACR_NEAR_Z - SACR_CURB_Z) - SACR_ACTOR_Z) * SACR_PX_PER_METER
        : face ? ((wy - bottom) / (face.returnY * TOP_LANE) - 1) * face.near * SACR_PX_PER_METER : FACADE_RECEIVER_Z
      for (let i = 0; i < nx; i++) {
        const p = (j * FIELD_W + i) * 4, a = f.receive(x + (i + .5) * dx, h, depth, this.tap, index)
        const scale = gain * (.14 + .86 * Math.max(0, plane === 'front' ? -a.dz : -a.dy))
        d[p] = Math.min(255, 198 * (a.r * scale) ** .50); d[p + 1] = Math.min(255, 198 * (a.g * scale) ** .50)
        d[p + 2] = Math.min(255, 198 * (a.b * scale) ** .50); d[p + 3] = a.strength > .001 ? 255 : 0
      }
    }
    g.putImageData(img, 0, 0, 0, 0, nx, ny)
    ctx.drawImage(c, 0, 0, nx, ny, x, y, tx - x, ty - y)
  }

  draw(ctx: CanvasRenderingContext2D, f: BridgeFrame, route: BridgeRoute): void {
    const id = f.mobileFlashIndices[0]
    if (id < 0) return
    const { left, right } = f.view
    this.patches = 0
    ctx.save(); ctx.globalCompositeOperation = 'lighter'
    this.patch(ctx, f, id, Math.max(0, left), ROAD.rear, right, ROAD.front, 'road', .079)
    this.patch(ctx, f, id, Math.max(0, left), ROAD.front, right, ROAD.soffit, 'front', .052)
    for (const c of route.between(left, right)) {
      const p = c.platform
      if (p) {
        const d = deckFace(c)
        this.patch(ctx, f, id, p.left, p.y, p.right, 'thickness' in d ? p.y + d.thickness : d.bottom, 'front', .092)
        ctx.save(); ctx.beginPath(); deckTopPath(ctx, p, d); ctx.clip()
        this.patch(ctx, f, id, p.left, p.y + d.returnY, p.right + d.returnX, p.y, 'up', .092, d)
        ctx.restore()
      }
      for (const s of chunkLightData(c).rearSurfaces) this.patch(ctx, f, id, s.left, s.top, s.right, s.bottom, 'front', .064)
    }
    ctx.restore()
  }

  dispose(): void { this.scope.releaseAll(); this.image = null }
}

/** Canvas wet return is separate from incident light. A dry eave has no
 * reflection, but its actual exposed faces still receive the same source. */
const reflectionTap = newReceiverLight()
export function drawMobileImpulseReflection(ctx: CanvasRenderingContext2D, f: BridgeFrame, bg: BackgroundRenderer): void {
  const i = f.mobileFlashIndices[0], k = i * 4
  if (i < 0 || f.source[k + 3] !== SACR_LIGHT_KIND.impulse) return
  const x = (f.source[k] + f.shape[k]) * .5 + f.cam.x, y = (f.source[k + 1] + f.shape[k + 1]) * .5
  const wet = bg.surfaceWetness?.(x) ?? 0
  if (wet < .02 || y < -270) return
  const radius = f.source[k + 2], rx = 46 + Math.min(88, radius * .38), yy = Math.min(29, Math.max(-17, -y * .17 - 11))
  ctx.save(); bg.clipWet?.(ctx, x - rx, x + rx, ROAD.rear, ROAD.front)
  puddlePath(ctx, x - rx, x + rx, f.drainage); ctx.clip()
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = f.cssColor[i]
  for (let j = 0; j < 5; j++) {
    const s = .22 + .10 * j, off = Math.sin(f.weatherTime * 4 + x * .035 + j * 2.7) * 5, row = yy - 5 + j * 4.4
    for (let l = x - rx * s + off; l < x + rx * s + off; l += 8) {
      const at = f.receive(l + 4, row * .56, 0, reflectionTap, i)
      if (at.strength < .014) continue
      ctx.globalAlpha = wet * Math.min(.19, at.strength * .11)
      ctx.fillRect(l, row, 8, 1.05 + j * .3)
    }
  }
  ctx.restore()
}

/** Half-resolution receiver-local flip. The caster strokes are issued into
 * this small transparent band, not flipped out of the active scene. One
 * wet clip and one puddle mask can be shared by the entire actor batch. */
export class BridgeWetStrip {
  private readonly scope = new SurfaceScope('bridge-wet-strip')

  draw(ctx: CanvasRenderingContext2D, frame: BridgeFrame, bg: BackgroundRenderer, cssW: number, paint: (g: CanvasRenderingContext2D) => void): boolean {
    const l = frame.view.left - 2, w = frame.view.right - l + 2, h = ROAD.front - ROAD.lane
    if (frame.view.bottom <= ROAD.lane || frame.view.top >= ROAD.front) { this.dispose(); return true }
    // Stable allocation during sway, rolled camera, and minor zoom changes.
    // Map subpixel world coordinates into it, never snap the reflected rig.
    const bw = Math.max(1, Math.min(1280, Math.ceil(cssW * .5) + 4)), bh = 40
    const c = this.scope.tryAcquire('surface', bw, bh, 'bridge-wet-strip')
    if (!hasPixels(c)) { this.dispose(); return false }
    const g = c.getContext('2d')
    if (!g || g.isContextLost?.()) { this.dispose(); return false }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh)
    g.setTransform(bw / w, 0, 0, bh / h, -l * bw / w, -ROAD.lane * bh / h)
    g.save()
    try {
      bg.clipWet?.(g, l, l + w, ROAD.lane, ROAD.front)
      puddlePath(g, l, l + w, frame.drainage); g.clip()
      paint(g)
    } finally { g.restore() }
    ctx.drawImage(c, l, ROAD.lane, w, h)
    return true
  }

  dispose(): void { this.scope.releaseAll() }
}
