import { insideBlocker } from '../../graphics/bridge/NoirGeometry'
import type { BridgeFrame } from './bridge-frame'
import { SurfaceScope, hasPixels } from './ledger'

const CELL = 64, TAIL_H = 24
const SILVER = 0, AMBER = 1, ICE = 2, RED = 3, VIOLET = 4, JADE = 5
const PALETTE = ['215,229,237', '255,183,104', '140,203,242', '250,124,120', '192,159,232', '115,223,181'] as const
const ATLAS_W = (PALETTE.length + 1) * CELL, ATLAS_H = CELL + TAIL_H
const SHADE_X = PALETTE.length * CELL
export const BRIDGE_LENS_LIMIT = 5

/** Quantize only the soft photographic skirt, not the sword or its light
 * record. Stable palette cells keep the whole cache in one tiny surface. */
export function bridgeTrailTint(color: string): number {
  if (color.length !== 7 || color[0] !== '#') return SILVER
  const n = Number.parseInt(color.slice(1), 16)
  if (!Number.isFinite(n)) return SILVER
  const r = n >> 16, g = n >> 8 & 255, b = n & 255
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24) return SILVER
  if (r >= g && r >= b) return g > b + 19 && g > r * .55 ? AMBER : RED
  if (b >= g) return r > g + 9 ? VIOLET : ICE
  return JADE
}

/** Small prefiltered shapes. Canvas smoothing supplies the final bilinear
 * step. No captured scene, filter strings, per-frame gradients or readback. */
export function bakeBridgeLensAtlas(g: CanvasRenderingContext2D): void {
  for (let i = 0; i < PALETTE.length; i++) {
    const x = i * CELL, rgb = PALETTE[i], tint = (alpha: number) => `rgba(${rgb},${alpha})`
    const lens = g.createRadialGradient(x + 32, 32, 0, x + 32, 32, 30)
    lens.addColorStop(0, tint(1)); lens.addColorStop(.18, tint(.67)); lens.addColorStop(.46, tint(.23))
    lens.addColorStop(.74, tint(.048)); lens.addColorStop(1, tint(0))
    g.fillStyle = lens; g.fillRect(x, 0, CELL, CELL)

    // A single tapered exposure with a sharp head inside the feather.
    // Clip the alpha mask to this cell so other colors remain untouched.
    const axial = g.createLinearGradient(x, 0, x + CELL, 0)
    axial.addColorStop(0, tint(0)); axial.addColorStop(.30, tint(.15)); axial.addColorStop(.68, tint(.42))
    axial.addColorStop(.89, tint(.94)); axial.addColorStop(1, tint(0))
    g.fillStyle = axial; g.fillRect(x, CELL, CELL, TAIL_H)
    const height = g.createLinearGradient(0, CELL, 0, ATLAS_H)
    height.addColorStop(0, 'transparent'); height.addColorStop(.20, '#fff2'); height.addColorStop(.44, '#fffd')
    height.addColorStop(.56, '#fffd'); height.addColorStop(.80, '#fff2'); height.addColorStop(1, 'transparent')
    g.save(); g.beginPath(); g.rect(x, CELL, CELL, TAIL_H); g.clip()
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = height; g.fillRect(x, CELL, CELL, TAIL_H)
    g.restore()
    const core = g.createLinearGradient(x, 0, x + CELL, 0)
    core.addColorStop(.42, '#f4f7f600'); core.addColorStop(.88, '#f4f7f6bd'); core.addColorStop(.96, '#f4f7f600')
    g.fillStyle = core; g.fillRect(x, CELL + 11, CELL, 2)
  }
  // Black-blue toe, with the widest clear area over the combat lane.
  const gloom = g.createRadialGradient(SHADE_X + 32, 29, 11, SHADE_X + 32, 29, 45)
  gloom.addColorStop(0, '#04091200'); gloom.addColorStop(.39, '#04091202')
  gloom.addColorStop(.70, '#04081017'); gloom.addColorStop(1, '#02040737')
  g.fillStyle = gloom; g.fillRect(SHADE_X, 0, CELL, CELL)
}

export class BridgePost {
  private readonly scope = new SurfaceScope('bridge-post')
  private atlas: HTMLCanvasElement | null = null
  private tried = false
  private lensBlits = 0
  private trailBlits = 0
  private shadeBlits = 0

  begin(): void { this.lensBlits = this.trailBlits = this.shadeBlits = 0 }

  warm(): void {
    if (hasPixels(this.atlas) || this.tried) return
    this.tried = true
    if (typeof document === 'undefined') return
    const atlas = this.scope.tryAcquire('lens', ATLAS_W, ATLAS_H, 'bridge-lens-atlas')
    const g = atlas?.getContext('2d')
    if (!atlas || !g) { this.scope.release('lens'); return }
    bakeBridgeLensAtlas(g)
    this.atlas = atlas
  }

  retire(): void {
    // The immutable (seed-free) atlas is reused on Retry. Nothing in it is
    // drawn from an earlier frame, actor or optical window.
    this.begin()
    if (!hasPixels(this.atlas)) this.tried = false
  }

  dispose(): void { this.scope.releaseAll(); this.atlas = null; this.tried = false; this.begin() }

  gloom(g: CanvasRenderingContext2D, w: number, h: number, field: BridgeFrame): void {
    const atlas = this.atlas
    if (!hasPixels(atlas)) return
    g.save()
    g.setTransform(g.canvas.width / w, 0, 0, g.canvas.height / h, 0, 0)
    g.globalAlpha = (.88 + .12 * field.fog) * (1 - .38 * field.exposure)
    g.globalCompositeOperation = 'source-over'
    g.drawImage(atlas, SHADE_X, 0, CELL, CELL, 0, 0, w, h)
    g.restore(); this.shadeBlits++
  }

  /** Finish real lenses behind the actors. Do not promote an ambient city
   * sample, a UI pixel, or an emitter hidden inside a local section solid. */
  lenses(g: CanvasRenderingContext2D, f: BridgeFrame, limit: number): void {
    const atlas = this.atlas
    if (!hasPixels(atlas) || this.lensBlits >= limit) return
    const { left, right, top, bottom } = f.view
    g.save(); g.globalCompositeOperation = 'lighter'
    for (const p of f.lensSources) {
      if ((p.kind !== 'spot' && p.kind !== 'bulb') || p.strength < 1.1) continue
      const radius = Math.min(66, 17 + p.physicalRadius * 2.7 + f.fog * 13)
      const ry = radius * (p.kind === 'spot' ? .65 : .79)
      if (p.x + radius <= left || p.x - radius >= right || p.y + ry <= top || p.y - ry >= bottom) continue
      if (f.blockers.some(b => insideBlocker(p.x, p.y, b))) continue
      g.globalAlpha = Math.min(.28, .078 + p.strength * .048 + f.fog * .025)
      g.drawImage(atlas, bridgeTrailTint(p.color) * CELL, 0, CELL, CELL, p.x - radius, p.y - ry, 2 * radius, 2 * ry)
      if (++this.lensBlits >= Math.min(BRIDGE_LENS_LIMIT, limit)) break
    }
    g.restore()
  }

  streak(g: CanvasRenderingContext2D, tint: number, x: number, y: number, dx: number, dy: number,
    length: number, strength: number): boolean {
    const atlas = this.atlas
    if (!hasPixels(atlas) || length < 2) return false
    const height = Math.min(12, 4.8 + length * .042)
    g.save()
    // Motion records already hold a unit direction. No atan/sin/cos in the draw loop.
    g.transform(dx, dy, -dy, dx, x, y)
    g.globalAlpha = .90 * strength * strength * (3 - 2 * strength)
    g.drawImage(atlas, tint * CELL, CELL, CELL, TAIL_H, -length, -height * .5, length * 1.13, height)
    g.restore(); this.trailBlits++
    return true
  }

  receipt() { return { atlasBytes: hasPixels(this.atlas) ? ATLAS_W * ATLAS_H * 4 : 0, lensBlits: this.lensBlits,
    trailBlits: this.trailBlits, shadeBlits: this.shadeBlits } }
}
