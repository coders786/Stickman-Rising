import { paintNoirShelter } from './noir-shelter'
import { newProbe, RibbonField } from '../lighting/ribbons'
import { DRY_PLATFORM } from '../world/art-grade'
import { environmentRandom } from '../world/fronts'
import { LIGHT_TINT } from '../world/lightfield'
import { bakePractical, materialRamp, type PracticalOptics, type PracticalStamp } from './baked-finish'
import { ROAD } from './road-section'
import { SHELTER_FLOOD, SHELTER_KIT, shelterLight, type ShelterKind } from './run-layout'
import { paintPlatform } from './station-art'

type Factory = (w: number, h: number) => { c: HTMLCanvasElement; g: CanvasRenderingContext2D }
export type ShelterStamp = Pick<PracticalStamp, 'sprite' | 'y'>
export const SHELTER_DECK_TOP = ROAD.sidewalk - 9

const OPTICS: PracticalOptics = {
  spreadX: 55, spreadY: 40, glassX: 29, glassY: 12, core: .83, skirt: .33,
  beam: { length: 154, mouth: 13, end: 56, aim: SHELTER_FLOOD.aimX, gain: .34 },
}

function face(g: CanvasRenderingContext2D, fill: string | CanvasGradient, ...xy: number[]) {
  g.fillStyle = fill
  g.beginPath(); g.moveTo(xy[0], xy[1])
  for (let i = 2; i < xy.length; i += 2) g.lineTo(xy[i], xy[i + 1])
  g.closePath(); g.fill()
}

/** Bake a small rear shoulder, roof, practical and matte insert into one
 * stamp per kit. The bridge has the same front rail/underside across both
 * wet and dry paving. At play the seam is just the authored world x. */
export function bakeRunShelter(kind: ShelterKind, make: Factory, scratch: Factory, oblique = false): ShelterStamp {
  const { width: w, ridgeY, eaveY } = SHELTER_KIT[kind]
  const tall = kind === 'concourse', top = ridgeY - 12, e = eaveY - top, rear = ROAD.rear - top
  const { c, g } = make(w, ROAD.front - top)
  if (oblique) { paintNoirShelter(g, kind, top); return { sprite: c, y: top } }
  // A recess set behind the fighter. The service bay has cloth; the transit
  // roof has darker glazed panels and uprights. No new collision surface.
  const wall = materialRamp(g, 0, e + 8, 0, rear,
    { light: '#1c2a31', body: '#344047', shade: '#242e31', falloff: .58 })
  g.fillStyle = wall; g.fillRect(4, e + 4, w - 8, rear - e - 4)
  const panelY = e + 58
  const bays = tall ? 4 : 3, pitch = (w - 30) / bays
  for (let i = 0; i < bays; i++) {
    const a = 14 + i * pitch, b = pitch - 8
    const panelH = rear - panelY - 25
    g.fillStyle = '#1e282d'; g.fillRect(a, panelY, b, panelH)
    g.fillStyle = materialRamp(g, a, panelY, a, panelY + panelH - 1,
      { light: tall ? '#3b4f56' : '#3d494c', body: '#303e44', shade: '#283439', falloff: .43 })
    g.fillRect(a + 2, panelY + 3, b - 4, panelH - 5)
    g.fillStyle = 'rgba(135,163,169,.28)'; g.fillRect(a + 1, panelY + 2, b - 2, 1.2)
    g.fillStyle = 'rgba(164,189,191,.09)'
    if (tall) {
      face(g, 'rgba(153,184,202,.08)', a + b * .18, panelY + 4, a + b * .53, panelY + 4,
        a + b * .77, panelY + panelH - 4, a + b * .49, panelY + panelH - 4)
      g.fillStyle = '#263238'; g.fillRect(a + b * .59, panelY + 4, 2, panelH - 6)
    } else for (let y = panelY + 12; y < panelY + panelH; y += 7) g.fillRect(a + 3, y, b - 6, 1)
  }
  g.fillStyle = '#273036'; g.fillRect(0, rear - 22, w, 22)
  g.fillStyle = 'rgba(170,184,180,.19)'; g.fillRect(2, rear - 22, w - 4, 1)
  g.fillStyle = '#303d43'; g.fillRect(6, e + 25, w - 12, 4)
  g.fillStyle = 'rgba(164,184,184,.17)'; g.fillRect(6, e + 25, w - 12, 1)
  for (const x of [3, w - 14]) {
    g.fillStyle = materialRamp(g, x, 0, x + 10, 0, { light: '#26363c', body: '#45565a', shade: '#202c31', falloff: .7 })
    g.fillRect(x, e - 1, 11, rear - e)
    g.fillStyle = '#3e4b4e'; g.fillRect(x - 1, rear - 13, 14, 13)
    g.fillStyle = '#7e8780'; g.fillRect(x - 1, rear - 13, 14, 1)
  }
  // Dark zinc/blue canvas with a folded lip. Open sky on either side reads
  // as the same district, not a separate backdrop or loading boundary.
  const rl = tall ? 34 : 23, rr = w - (tall ? 38 : 29)
  face(g, materialRamp(g, 0, 9, 0, e, { light: tall ? '#68828b' : '#717c71', body: tall ? '#3c535e' : '#474f43',
    shade: tall ? '#263841' : '#323a31', falloff: .50 }),
    rl, 10, rr, 10, w, e - 5, w, e + 1, 0, e + 1, 0, e - 6)
  const folds = tall ? 7 : 11
  for (let i = 0; i < folds; i++) {
    const a = rl + (rr - rl) * i / folds, b = rl + (rr - rl) * (i + 1) / folds
    const d = i * w / folds, f = (i + 1) * w / folds
    face(g, i % 2 ? 'rgba(125,162,170,.16)' : 'rgba(5,24,30,.16)', a, 13, b, 13, f, e - 8, d, e - 8)
    face(g, 'rgba(173,199,201,.31)', a + .5, 15, a + 1.7, 15, d + 2, e - 10, d + .7, e - 10)
    for (let j = 0; j < 24; j++) {
      const t = environmentRandom(42, 0x481f12d4 + i, j), u = environmentRandom(42, 0x0eca6967 + i, j)
      const l = a + (d - a) * t, r = b + (f - b) * t
      g.fillStyle = j % 3 ? 'rgba(7,26,34,.17)' : 'rgba(151,184,184,.13)'
      g.fillRect(l + 6 + u * (r - l - 13), 15 + t * (e - 25), 2 + j % 5, 1)
    }
  }
  g.fillStyle = '#23343d'; g.fillRect(rl - 1, 8, rr - rl + 2, 5)
  g.fillStyle = '#7d9295'; g.fillRect(rl, 10, rr - rl, 1)
  g.fillStyle = '#202d35'; g.fillRect(0, e - 7, w, 18)
  g.fillStyle = '#8b9da0'; g.fillRect(0, e - 7, w, 1.25)
  g.fillStyle = '#3c4d50'; g.fillRect(2, e + 6, w - 4, 2)
  const boardW = tall ? 172 : 126, bx = (w - boardW) * .5, by = e - (tall ? 58 : 42)
  g.fillStyle = '#27363d'; g.fillRect(bx - 2, by - 2, boardW + 4, tall ? 32 : 25)
  g.fillStyle = tall ? '#3e514f' : '#58503b'; g.fillRect(bx + 1, by + 1, boardW - 2, tall ? 26 : 19)
  g.fillStyle = '#84918a'; g.fillRect(bx + 2, by + 2, boardW - 4, 1)
  g.fillStyle = '#d7caab'; g.font = `bold ${tall ? 14 : 11}px monospace`
  g.textAlign = 'center'; g.fillText(tall ? 'METRO LINK' : 'SERVICE BAY', w * .5, by + (tall ? 19 : 14))


  // Use the actual Station material, but stop it at the shared front edge.
  // Its opaque matte slab replaces the underlying wet receiver, not another
  // glow on top of it. It can never reflect an actor or take on rain.
  g.save(); g.translate(0, -top)
  g.beginPath(); g.rect(0, SHELTER_DECK_TOP, w, ROAD.front - SHELTER_DECK_TOP); g.clip()
  paintPlatform(g, w, DRY_PLATFORM)
  const source = shelterLight(kind, 0)
  const light = new RibbonField([source], []), probe = newProbe()
  const pool = g.createLinearGradient(0, 0, w, 0)
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, amount = light.sample(w * t, ROAD.lane, probe).warm
    const opacity = Math.min(.26, amount * .42) * Math.min(1, i / 2, (14 - i) / 2)
    pool.addColorStop(t, `rgba(240,176,114,${opacity})`)
  }
  g.fillStyle = pool; g.fillRect(0, ROAD.rear, w, ROAD.front - ROAD.rear)
  for (const x of [4, w - 8]) {
    g.fillStyle = '#29393f'; g.fillRect(x, ROAD.rear, 4, ROAD.front - ROAD.rear)
    for (let y = ROAD.rear + 2; y < ROAD.front; y += 6) {
      g.fillStyle = '#111d24'; g.fillRect(x + .7, y, 2.6, 2.2)
    }
  }
  g.restore()

  const h = scratch(47, 29)
  h.g.fillStyle = '#36484c'; h.g.fillRect(21, 0, 5, 15)
  face(h.g, '#17242a', 1, 13, 46, 13, 40, 23, 7, 23)
  h.g.fillStyle = '#627072'; h.g.fillRect(2, 13, 43, 1.4)
  h.g.fillStyle = '#edc894'; h.g.fillRect(8, 21, 31, 4)
  h.g.fillStyle = '#fff1cf'; h.g.fillRect(12, 23, 23, 2)
  const y = source.y + ROAD.fixtureOffset
  const lamp = bakePractical(scratch, { sprite: h.c, x: source.x - 23, y: y - 23 },
    source.x, y, LIGHT_TINT.bulb.join(','), OPTICS)
  g.save(); g.beginPath(); g.rect(0, e + 10, w, rear - e - 10); g.clip()
  g.drawImage(lamp.sprite, lamp.x, lamp.y - top)
  g.restore()
  return { sprite: c, y: top }
}
