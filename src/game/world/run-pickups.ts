import type { BridgeRoute } from '../stage/route'

export type PickupKind = 'repair' | 'cell'

/** A sparse socket layer. A pickup is only consumed by physical contact, and
 * its marker does not share the appearance of breakable roadside furniture. */
export class RunPickups {
  private readonly taken = new Set<number>()
  constructor(private readonly route: BridgeRoute) {}

  private kind(seed: number): PickupKind { return seed & 1 ? 'repair' : 'cell' }

  take(x: number, y: number, couldUse: (kind: PickupKind) => boolean): PickupKind | null {
    const c = this.route.at(x), kind = this.kind(c.seed)
    if (c.shelter || this.taken.has(c.index) || Math.abs(x - c.propSockets[1]) > 26 || y < -46 || !couldUse(kind)) return null
    this.taken.add(c.index)
    return kind
  }

  draw(g: CanvasRenderingContext2D, left: number, right: number, time: number): void {
    for (const c of this.route.between(left - 40, right + 40)) {
      if (c.shelter || this.taken.has(c.index)) continue
      const x = c.propSockets[1]
      if (x < left - 36 || x > right + 36) continue
      const kind = this.kind(c.seed), hue = kind === 'repair' ? '129,241,189' : '127,207,250'
      const y = -36 + Math.sin(time * 3.4 + c.index) * 4
      g.save(); g.translate(x, 0)
      const shadowAlpha = g.globalAlpha
      g.save(); g.scale(1, .26); g.fillStyle = '#070b12'
      g.globalAlpha = shadowAlpha * .16; g.beginPath(); g.ellipse(0, 0, 24, 24, 0, 0, Math.PI * 2); g.fill()
      g.globalAlpha = shadowAlpha * .10; g.beginPath(); g.ellipse(0, 0, 17, 17, 0, 0, Math.PI * 2); g.fill()
      g.globalAlpha = shadowAlpha * .06; g.beginPath(); g.ellipse(0, 0, 10, 10, 0, 0, Math.PI * 2); g.fill()
      g.restore()
      const shaft = g.createLinearGradient(0, -102, 0, 0)
      shaft.addColorStop(0, `rgba(${hue},0)`); shaft.addColorStop(.62, `rgba(${hue},.19)`); shaft.addColorStop(1, `rgba(${hue},.30)`)
      g.fillStyle = shaft
      g.beginPath(); g.moveTo(-5, -104); g.lineTo(5, -104); g.lineTo(24, 0); g.lineTo(-24, 0); g.closePath(); g.fill()
      g.strokeStyle = `rgba(${hue},.64)`; g.lineWidth = 1.3
      g.beginPath(); g.ellipse(0, 0, 19, 5, 0, 0, Math.PI * 2); g.stroke()
      g.translate(0, y); g.rotate(Math.PI / 4)
      g.fillStyle = '#111b25'; g.strokeStyle = `rgb(${hue})`; g.lineWidth = 1.8
      g.fillRect(-11, -11, 22, 22); g.strokeRect(-11, -11, 22, 22)
      g.rotate(-Math.PI / 4); g.fillStyle = `rgb(${hue})`
      if (kind === 'repair') { g.fillRect(-7, -2, 14, 4); g.fillRect(-2, -7, 4, 14) }
      else { g.beginPath(); g.moveTo(1, -8); g.lineTo(-6, 1); g.lineTo(0, 1); g.lineTo(-1, 8); g.lineTo(7, -2); g.lineTo(1, -2); g.fill() }
      g.restore()
    }
  }
}
