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
  // Mark which beat is the authored contact so the strike frame is visible.
  const contactBeat = Math.round((def.hit.start / clip.dur) * (BEATS - 1))
  for (let i = 0; i < BEATS; i++) {
    const t = (i / (BEATS - 1)) * clip.dur
    const pose = sampleClip(clip, t, new Float32Array(28))
    solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade * 1.06, 1)
    const cx = PAD + i * CW + CW / 2
    const cy = PAD + row * CH + CH * 0.58
    const isContact = i === contactBeat
    // strike frame gets a highlight bar
    if (isContact) {
      g.fillStyle = 'rgba(40,120,200,0.13)'
      g.fillRect(PAD + i * CW, PAD + row * CH, CW, CH)
      g.fillStyle = '#2a6fb0'
      g.fillRect(PAD + i * CW, PAD + row * CH, CW, 3)
    }
    g.save()
    g.translate(cx, cy)
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
