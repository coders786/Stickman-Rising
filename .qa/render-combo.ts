/** Render the re-composed hand-to-hand set as a contact sheet.
 *
 * One row per move, one figure per authored beat, so the full-body
 * choreography can be READ rather than inferred from channel numbers.
 *
 * Run: npx tsx .qa/render-combo.ts [out.png] [ids...]
 */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { MOVES } from '../src/game/combat/moveset'
import { sampleClip } from '../src/game/anim/animator'
import { solveFighter3D, makeFighterGeom, drawFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
import { handGestures } from '../src/game/anim/hand-gestures'

const out = process.argv[2] ?? 'research/full-body-combo.png'
const ids = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['l1', 'l2', 'l3', 'l4', 'l5', 'h1', 'h2', 'h3']

const BEATS = Number(process.env.BEATS ?? 8)
const SCALE = Number(process.env.RSCALE ?? 1.5)
const CW = Math.round(100*SCALE), CH = Math.round(140*SCALE)
/** Ballistic arc for a move that launches the body (player GRAVITY 2050).
 * The clip alone never leaves the floor — the launch is an engine impulse —
 * so a hop rendered from the clip is a crouch-and-stand. */
function liftAt(since: number, v0: number): number {
  if (since <= 0) return 0
  const G = 2050
  const tPeak = -v0 / G
  if (since >= tPeak * 2) return 0
  return -(v0 * since + 0.5 * G * since * since) * 1.32
}
const PAD = 26

const canvas = createCanvas(ids.length ? BEATS * CW + PAD * 2 : 100, ids.length * CH + PAD * 2)
const g = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
g.fillStyle = '#e9eef2'
g.fillRect(0, 0, canvas.width, canvas.height)

const geom = makeFighterGeom()

ids.forEach((id, row) => {
  const def = MOVES[id]
  if (!def?.clip) return
  const clip = def.clip
  for (let i = 0; i < BEATS; i++) {
    const t = (i / (BEATS - 1)) * clip.dur
    const pose = sampleClip(clip, t, new Float32Array(28))
    solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade * 1.06, 1)
    const cx = PAD + i * CW + CW / 2
    const cy = PAD + row * CH + CH * 0.58
    // A beat is the contact beat if the authored hit window COVERS its time.
    // Rounding the window midpoint to the nearest beat mislabels short
    // windows: h3's 0.19-0.33 centred on 0.26 lit beat 0.17, two beats
    // before the fists actually land.
    const isContact = t >= def.hit.start - 1e-6 && t <= def.hit.end + 1e-6
    // strike frame gets a highlight bar
    if (isContact) {
      g.fillStyle = 'rgba(40,120,200,0.13)'
      g.fillRect(PAD + i * CW, PAD + row * CH, CW, CH)
      g.fillStyle = '#2a6fb0'
      g.fillRect(PAD + i * CW, PAD + row * CH, CW, 3)
    }
    // GROUND LINE. Without it a hop is unreadable: the figure is drawn
    // relative to its own hip, so a body that leaves the floor looks
    // identical to one that never moved. The line is drawn at the world
    // floor projected through the same transform.
    g.save()
    g.strokeStyle = 'rgba(40,120,200,0.45)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(PAD + i * CW + 6, cy + 66 * SCALE)
    g.lineTo(PAD + i * CW + CW - 6, cy + 66 * SCALE)
    g.stroke()
    g.restore()
    // the engine's launch arc, if this move has one: without it a hop reads
    // as a crouch-and-stand, because the clip alone never leaves the floor
    const lift = (def.moveY !== undefined && t >= (def.moveYAt ?? 0))
      ? liftAt(t - (def.moveYAt ?? 0), def.moveY)
      : 0
    g.save()
    g.translate(cx, cy + lift)
    g.scale(SCALE, SCALE)
    drawFighter3D(
      g as unknown as CanvasRenderingContext2D,
      geom, PLAYER_STYLE,
      { hands: handGestures('unarmed', t / clip.dur, false) },
    )
    g.restore()
    g.fillStyle = isContact ? '#12456f' : '#889'
    g.font = '10px monospace'
    g.fillText(`${i === 0 ? id : ''}`, PAD + i * CW + 4, PAD + row * CH + 13)
    g.fillText(t.toFixed(2), PAD + i * CW + 4, PAD + row * CH + CH - 5)
  }
  g.fillStyle = '#334'
  g.font = '11px monospace'
  g.fillText(`${id} ${def.label}`, PAD + 2, PAD + row * CH + CH - 16)
})

writeFileSync(out, canvas.toBuffer('image/png'))
console.log(`wrote ${out} (${ids.length} moves x ${BEATS} beats)`)
