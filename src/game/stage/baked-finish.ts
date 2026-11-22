/** Shared bake-time art tools. Neither helper owns a canvas or runs in a
 * draw pass. A scene can change its palette without adding a live effect. */

export interface MaterialFace {
  readonly light: string
  readonly body: string
  readonly shade: string
  /** Distance over which the lit edge falls to the body colour (0–1). */
  readonly falloff: number
}

/** An edge on a smooth face is tight; a matte face rolls from light to dark
 * over a larger distance. The caller supplies the direction of the light. */
export function materialRamp(
  g: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  face: MaterialFace,
): CanvasGradient {
  const ramp = g.createLinearGradient(x0, y0, x1, y1)
  ramp.addColorStop(0, face.light)
  ramp.addColorStop(face.falloff, face.body)
  ramp.addColorStop(1, face.shade)
  return ramp
}

export interface PlaneTone {
  /** RGB triplet. Use a common air colour for distant planes. */
  readonly air: string
  readonly crown: number
  /** More compression at the foot of a facade keeps the play band quiet. */
  readonly base: number
  /** Begin the transition here, in normalized plate height. */
  readonly fadeFrom?: number
}

/** Source-atop respects the original silhouette, including gaps between
 * architecture. An authored tone replaces, rather than stacks on, the wash. */
export function paintPlaneTone(
  g: CanvasRenderingContext2D, width: number, height: number,
  tone: PlaneTone | string,
): void {
  g.save()
  g.globalCompositeOperation = 'source-atop'
  if (typeof tone === 'string') {
    g.fillStyle = tone
  } else {
    const ramp = g.createLinearGradient(0, 0, 0, height)
    const crown = `rgba(${tone.air},${tone.crown})`
    ramp.addColorStop(0, crown)
    ramp.addColorStop(tone.fadeFrom ?? .46, crown)
    ramp.addColorStop(1, `rgba(${tone.air},${tone.base})`)
    g.fillStyle = ramp
  }
  g.fillRect(0, 0, width, height)
  g.restore()
}

/** Authored scatter around a sharp emitter, in world pixels. The broad lobe
 * is deliberately soft; the compact lobe follows the shape of the glass. */
export interface PracticalOptics {
  readonly spreadX: number
  readonly spreadY: number
  readonly glassX: number
  readonly glassY: number
  readonly core: number
  readonly skirt: number
  readonly beam: Readonly<{ length: number; mouth: number; end: number; aim: number; gain: number }>
}

export interface PracticalStamp {
  readonly sprite: HTMLCanvasElement
  readonly x: number
  readonly y: number
}

/** Precompose the short cone, optical scatter and body over transparent
 * pixels. The glass/enamel is sharp (painted last), and the surrounding ink
 * fades to zero before the allocation edge. One ordinary world blit at play. */
export function bakePractical(
  make: (w: number, h: number) => { c: HTMLCanvasElement; g: CanvasRenderingContext2D },
  body: PracticalStamp, lx: number, ly: number, rgb: string, spec: PracticalOptics,
): PracticalStamp {
  const { beam } = spec
  const drift = beam.aim * beam.length
  const minX = Math.floor(Math.min(body.x, lx - spec.spreadX, lx - beam.mouth, lx + drift - beam.end)) - 1
  const maxX = Math.ceil(Math.max(body.x + body.sprite.width, lx + spec.spreadX, lx + beam.mouth, lx + drift + beam.end)) + 1
  const minY = Math.floor(Math.min(body.y, ly - spec.spreadY)) - 1
  const maxY = Math.ceil(Math.max(body.y + body.sprite.height, ly + spec.spreadY, ly + beam.length + 2)) + 1
  const { c, g } = make(maxX - minX, maxY - minY)
  const x = lx - minX, y = ly - minY
  const [r, gr, b] = rgb.split(',').map(Number)
  const cone = g.createImageData(c.width, beam.length)
  for (let j = 0; j < beam.length; j++) {
    const v = (j + .5) / beam.length
    const radius = beam.mouth + (beam.end - beam.mouth) * v
    const centre = x + drift * v
    const energy = 255 * beam.gain * Math.min(1, (j + .5) / 9) * (1 - v) ** 2.25
    for (let i = Math.max(0, Math.floor(centre - radius)); i < Math.min(c.width, Math.ceil(centre + radius)); i++) {
      const u = Math.min(1, Math.abs(i + .5 - centre) / radius)
      const k = (j * c.width + i) * 4
      cone.data[k] = r; cone.data[k + 1] = gr; cone.data[k + 2] = b
      cone.data[k + 3] = energy * (1 - u * u * (3 - 2 * u)) ** 1.55
    }
  }
  g.putImageData(cone, 0, y + 2)
  const lobe = (rx: number, ry: number, drop: number, ink: string, peak: number) => {
    g.save()
    g.translate(x, y + drop); g.scale(rx, ry)
    const falloff = g.createRadialGradient(0, 0, 0, 0, 0, 1)
    falloff.addColorStop(0, `rgba(${ink},${peak})`)
    falloff.addColorStop(.32, `rgba(${ink},${peak * .58})`)
    falloff.addColorStop(.67, `rgba(${ink},${peak * .13})`)
    falloff.addColorStop(1, `rgba(${ink},0)`)
    g.fillStyle = falloff; g.fillRect(-1, -1, 2, 2)
    g.restore()
  }
  lobe(spec.spreadX, spec.spreadY - 6, 6, rgb, spec.skirt)
  lobe(spec.glassX, spec.glassY, 2, '255,218,161', spec.core)
  g.drawImage(body.sprite, body.x - minX, body.y - minY)
  return { sprite: c, x: minX, y: minY }
}

type DeckTrim = {
  readonly metal: MaterialFace
  readonly masonry: MaterialFace
  readonly district: PlaneTone
}
export type DeckFinish = DeckTrim & (
  | { readonly surface: 'wet-asphalt' }
  | { readonly surface: 'dry-platform'; readonly tile: MaterialFace }
)
