import { bridgeHash, deckShear, deckY } from './bridge-material'
import { edge, face, slab, type ArtPen } from './bridge-paint'
import { ROAD } from './road-section'

const PATCH_PITCH = 264, GRAVEL_PITCH = 54, MARK_PITCH = 112
const PATCHES = ['#26272a62', '#625d4934', '#23282962', '#59625d42'] as const
const STONE = ['#9b8e7755', '#7f857760', '#10171a7a'] as const

/** Albedo only, in deck coordinates. The pavement under the chipped paint
 * is still the same receiver; wetness, roughness and shadows belong to the
 * existing optical passes. Hash by world station, never by camera or chunk. */
export function paintWearingCourse(g: ArtPen, left: number, right: number, detail: boolean): void {
  const { rear, front } = ROAD
  const top = g.createLinearGradient(0, rear, 0, front)
  top.addColorStop(0, '#24292b')
  top.addColorStop(.12, '#404444')
  top.addColorStop(.33, '#3b3f3e')
  top.addColorStop(.73, '#333839')
  top.addColorStop(.95, '#3a3d3b')
  top.addColorStop(1, '#282e2f')
  slab(g, top, left, rear, right - left, front - rear)
  g.save(); g.beginPath(); g.rect(left, rear, right - left, front - rear); g.clip()
  // Troweled asphalt repairs, some spanning a joint. Follow the same shear
  // as the paint stripes rather than a repeated grid in screen space.
  for (let i = Math.floor(left / PATCH_PITCH) - 1; i <= Math.floor(right / PATCH_PITCH) + 1; i++) {
    const roll = bridgeHash(i, 71, 132)
    if (roll < .20) continue
    const x = i * PATCH_PITCH + 58 * bridgeHash(i, 4), width = 43 + bridgeHash(i, 2, 65) * (roll > .65 ? 176 : 97)
    const y = deckY(.04 + .58 * bridgeHash(i, 91, 288)), y2 = Math.min(front - 3, y + 12 + 35 * bridgeHash(i, 5, 37))
    const a = x + deckShear(y), b = x + deckShear(y2), mid = .48 * y + .52 * y2
    face(g, PATCHES[Math.min(3, Math.floor(roll * 4))], a, y + 2.5, a + width * .54, y,
      a + width - 5, y + 1, b + width, mid, b + width - 9, y2 - 2, b + width * .33, y2, b - 4, y2 - 3)
    edge(g, '#252b2a69', .75, a + 1, y + 2.4, a + width * .54, y + .1, a + width - 5, y + 1.3)
    edge(g, '#938c7146', .68, b + width * .21, y2 - .8, b + width * .52, y2 - 1.1, b + width - 12, y2 - 2.4)
    if (detail && roll > .36) {
      const cx = a + width * .48, cy = y2 - 5
      edge(g, '#12171a85', 1.08, cx, cy, cx + 8, cy + 2.9, cx + 20, cy + 2.1, cx + 29, cy + 5.2, cx + 44, cy + 4.1)
      edge(g, '#a8a18d44', .73, cx + 8, cy + 3.5, cx + 20, cy + 2.8, cx + 29, cy + 6)
    }
  }
  // Coarse pockets and fine fractured stone. Three fills no matter how
  // many visible granules; the normal/lighting atlas is left alone.
  const first = Math.floor(left / GRAVEL_PITCH) - 1, end = Math.floor(right / GRAVEL_PITCH) + 1
  for (let tone = 0; tone < STONE.length; tone++) {
    g.beginPath()
    for (let i = first; i <= end; i++) {
      const density = detail ? 18 + Math.floor(bridgeHash(i, tone, 201) * 15) : 7
      for (let j = 0; j < density; j++) {
        const n = j + 51 * tone, z = bridgeHash(i, n, 387), grit = bridgeHash(i, n, 168)
        const y = deckY(z), x = (i + bridgeHash(i, n, 974)) * GRAVEL_PITCH + deckShear(y)
        const d = (.68 + .32 * z) * (.67 + grit ** 2 * (tone === 2 ? 2.3 : 1.31))
        g.moveTo(x, y); g.lineTo(x + d * .82, y - d * .22); g.lineTo(x + d, y + .29 * d)
        g.lineTo(x + d * .21, y + .53 * d); g.closePath()
      }
    }
    g.fillStyle = STONE[tone]; g.fill()
  }
  g.restore()
}

/** Thin paint slowly abrades to the bitumen. Same lane and anchors in the
 * rich plate and in recovery coverage, so the marks don't jump on handoff. */
export function paintLaneDashes(g: ArtPen, left: number, right: number, detail: boolean): void {
  const y = deckY(.27)
  for (let i = Math.floor(left / MARK_PITCH) - 1; i <= Math.floor(right / MARK_PITCH) + 1; i++) {
    const x = i * MARK_PITCH + deckShear(y), length = 26 + bridgeHash(i * 2, 2) * 16
    face(g, '#bfa979ba', x, y + .6, x + 3, y, x + length - 4, y + .26, x + length, y + .1,
      x + length - 1.6, y + 2.6, x + length * .55, y + 2.4, x + 2, y + 2.75, x - 1, y + 2)
    if (!detail) continue
    slab(g, '#f0d99966', x + 4, y + .42, length * .38, .76)
    for (let j = 0; j < 11; j++) {
      const u = bridgeHash(i, j, 93), v = bridgeHash(i, j, 258)
      slab(g, j % 3 ? '#484439ba' : '#312f2d86', x + 2 + u * (length - 5), y + .40 + v * 1.22,
        .5 + (1 - v) ** 3 * 3.3, .38 + .53 * v)
    }
  }
}
