import { minJerk } from './weather'

export type MaterialId = 'wet-asphalt' | 'dry-platform' | 'matte-paving'
export interface Access {
  readonly exteriorLight: number
  readonly precipitation: number
  readonly wind: number
  readonly outsideAudio: number
}

export interface ReceiverZone {
  readonly id: string
  readonly left: number
  readonly right: number
  readonly material: MaterialId
  readonly access: Access
  readonly splashes: boolean
}

export const OPEN_AIR: Access = Object.freeze({ exteriorLight: 1, precipitation: 1, wind: 1, outsideAudio: 1 })

export interface RunoffEdge {
  readonly x: number
  /** Only the open receiver can carry these marks. */
  readonly side: -1 | 1
  readonly span: number
}

type SoftChannel = Exclude<keyof Access, 'precipitation'>

/** Validated ordered strips in world space. The exact same seam is used by
 * roof/road art, hard weather clips, and softly handed-off light and audio.
 * These strips never enter the world's collision or spawn code. */
export class ExposureMap {
  readonly exposed: readonly ReceiverZone[]
  readonly runoff: readonly RunoffEdge[]
  readonly left: number
  readonly right: number

  constructor(readonly zones: readonly ReceiverZone[], readonly feather: number) {
    if (!zones.length || zones.length > 8 || !Number.isFinite(feather) || feather < 0 || feather > 32) throw new Error('Bad exposure map')
    const ids = new Set<string>()
    let previous = zones[0].left
    for (const z of zones) {
      if (!z.id || ids.has(z.id) || !Number.isFinite(z.left) || !Number.isFinite(z.right) || z.left !== previous ||
          z.right <= z.left || z.right - z.left < 2 * feather ||
          !(['exteriorLight', 'precipitation', 'wind', 'outsideAudio'] as const).every(channel => {
            const v = z.access[channel]
            return Number.isFinite(v) && v >= 0 && v <= 1
          }) || (z.splashes && (!z.access.precipitation || z.material === 'dry-platform' || z.material === 'matte-paving'))) {
        throw new Error(`Bad receiver zone: ${z.id}`)
      }
      ids.add(z.id)
      previous = z.right
    }
    this.left = zones[0].left
    this.right = previous
    this.exposed = zones.filter(z => z.access.precipitation > 0)
    const edges: RunoffEdge[] = []
    for (let i = 1; i < zones.length; i++) {
      const a = zones[i - 1], b = zones[i]
      if (a.splashes && b.access.precipitation === 0) edges.push({ x: b.left, side: -1, span: a.right - a.left })
      else if (b.splashes && a.access.precipitation === 0) edges.push({ x: b.left, side: 1, span: b.right - b.left })
    }
    this.runoff = edges
  }

  at(x: number): ReceiverZone {
    for (const zone of this.zones) if (x < zone.right) return zone
    return this.zones[this.zones.length - 1]
  }

  /** Weather itself is hard clipped. Only the perceptual channels feather. */
  soft(x: number, channel: SoftChannel): number {
    const { zones, feather } = this
    if (feather > 0) {
      for (let i = 1; i < zones.length; i++) {
        const next = zones[i]
        if (x < next.left - feather) break
        if (x <= next.left + feather) {
          const a = zones[i - 1].access[channel], b = next.access[channel]
          return a + (b - a) * minJerk((x - next.left + feather) / (2 * feather))
        }
      }
    }
    return this.at(x).access[channel]
  }
}
