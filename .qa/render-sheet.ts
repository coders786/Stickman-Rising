/** Render a clip the way the uploaded reference sheets are laid out: one row
 * of numbered silhouettes on a flat ground line, evenly spaced. The point is
 * to compare OUR choreography against the reference sheets frame-for-frame
 * instead of only checking channel numbers.
 *
 *   npx tsx .qa/render-sheet.ts out.png <clipId> [frames] [cols]
 */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync } from 'node:fs'
import { ATTACKS } from '../src/game/combat/attacks'
import { MOVES } from '../src/game/combat/moveset'
import { unarmedAttack } from '../src/game/combat/unarmed'
import { sampleClip } from '../src/game/anim/animator'
import { drawFighter3D, makeFighterGeom, solveFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
import { CH } from '../src/game/anim/pose'
import { makePose } from '../src/game/anim/pose'

const out = process.argv[2]
const ids = process.argv.slice(3)
const N = Number(process.env.FRAMES ?? 10)
const CW = 210, CHh = 300, GROUND = 250, SC = 1.9
const cv = createCanvas(CW * N, CHh * ids.length + 8)
const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
ctx.fillStyle = '#e9eef2'; ctx.fillRect(0, 0, cv.width, cv.height)

ids.forEach((id, row) => {
  // WHICH CLIP DOES THE GAME ACTUALLY PLAY? With the blade sheathed every
  // attack is swapped through unarmedAttack() (player.ts: `if(!swordDrawn)
  // def=unarmedAttack(def)`), so the render must do the same or it shows the
  // ARMED clip while claiming to show the unarmed one.
  const base = (ATTACKS as Record<string, any>)[id] ?? (MOVES as Record<string, any>)[id]
  if (!base) { console.log('missing', id); return }
  const def = process.env.ARMED ? base : unarmedAttack(base)
  const clip = def.clip ?? def
  const dur = clip.dur ?? 1
  const top = row * CHh + 6
  // the row baseline
  ctx.strokeStyle = '#c9d2da'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, top + GROUND); ctx.lineTo(CW * N, top + GROUND); ctx.stroke()
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * dur
    const p = makePose(); sampleClip(clip, t, p)
    const g = makeFighterGeom()
    solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade * 1.06, 1)
    const X = i * CW
    ctx.save()
    ctx.translate(X + CW / 2, top + GROUND)
    ctx.scale(SC, SC)
    drawFighter3D(ctx, g, PLAYER_STYLE, {})
    // THE BLADE IS ONLY IN THE HAND WHEN IT IS DRAWN. With the sword sheathed
    // (every unarmed clip) the katana rides in the SAYA at the hip, exactly
    // as the reference sheets draw it: near-horizontal, edge-down, unmoving.
    const sheath = process.env.DRAWN ? false : true
    if (sheath) {
      const pelvisPitch = p[CH.rootRot] + p[CH.spine] * 0.35
      const ang = 0.24 + pelvisPitch * 0.6
      const tl = PLAYER_SPEC.blade * 0.28 * 2.4
      const mx = g.hip.x + 3, my = g.hip.y + 1
      ctx.strokeStyle = '#1d2735'; ctx.lineWidth = 5.2; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - Math.cos(ang) * tl, my + Math.sin(ang) * tl); ctx.stroke()
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.3
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - Math.cos(ang) * tl, my + Math.sin(ang) * tl); ctx.stroke()
      ctx.fillStyle = '#cbd5e1'
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, 7); ctx.fill()
    } else {
      ctx.strokeStyle = '#2a6fb5'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(g.grip.x, g.grip.y); ctx.lineTo(g.tip.x, g.tip.y); ctx.stroke()
    }
    ctx.restore()
    // frame index + whether this frame is inside the hit window
    const inWin = def.hit && t >= def.hit.start && t <= def.hit.end
    ctx.fillStyle = inWin ? '#c0392b' : '#8b98a4'
    ctx.font = (inWin ? 'bold ' : '') + '11px monospace'
    ctx.fillText(String(i + 1), X + 5, top + 14)
    if (i === 0) { ctx.fillStyle = '#2f3b46'; ctx.font = 'bold 12px monospace'; ctx.fillText(id, X + 5, top + 30) }
  }
})
mkdirSync('research', { recursive: true })
writeFileSync(out, cv.toBuffer('image/png'))
console.log('wrote', out, ids.length + ' clips x ' + N + ' frames')
