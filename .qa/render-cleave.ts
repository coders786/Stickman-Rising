/** VISUAL PROOF of the cleave fix: draw the fighter WITH its blade and a row
 * of enemies, at the contact beat, so the cut can be read off the picture
 * instead of a table.
 *   npx tsx .qa/render-cleave.ts out.png id1 id2 ...
 * The pose is taken from the live Player (so every in-engine correction is
 * applied), then re-solved here so the blade geometry is available.
 */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync } from 'node:fs'
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { ATTACKS } from '../src/game/combat/attacks'
import { drawFighter3D, makeFighterGeom, solveFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'

/** The SAME body spheres the hit test uses, so what is drawn is what is hit. */
const BODY_SPHERES = [
  { oy: 14, r: 15 }, // legs / hip mass
  { oy: 48, r: 21 }, // torso
  { oy: 78, r: 17 }, // chest / head
]
import type { WorldRef } from '../src/game/core/types'

const out = process.argv[2]
const ids = process.argv.slice(3)
const SCALE = 1.32, HIP = 168
const CELL = 420, ROW = 300
const cv = createCanvas(CELL, ROW * ids.length + 20)
const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D

// canvas space: world x -> (x - vx) + CELL/2 ; world y -> HIP - y
type V = { x: number; y: number }
const sx = (wx: number, ox: number) => (wx - ox) + CELL / 2
const sy = (wy: number) => HIP - wy

ids.forEach((id, row) => {
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  for (let e = 0; e < 5; e++) {
    const en = new Enemy('grunt', 400 + p.face * (e * 26), 1)
    en.spawning = false; en.state = 'chase'; en.face = (p.face > 0 ? -1 : 1) as 1 | -1
    en.hp = 99999
    enemies.push(en)
  }
  const d = ATTACKS[id]
  p.startAttack(d, w)
  // step to the middle of the hit window (the contact beat)
  const target = (d.hit.start + d.hit.end) / 2
  for (let f = 0; f < 400 && p.state === 'attack'; f++) {
    if ((p.action?.animT ?? 0) >= target) break
    for (const en of enemies) en.x = 400 + p.face * ((en.id % 5) * 26) // pinned+deterministic
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
  }
  const g = makeFighterGeom()
  solveFighter3D(p.pose, PLAYER_SPEC, g, PLAYER_SPEC.blade * 1.06, p.swingScale ?? 1)
  const ox = p.x
  const top = row * ROW + 20
  ctx.save(); ctx.translate(0, top)
  // ground + enemies at the cleave spacing (26px), 5 of them from x=434
  ctx.strokeStyle = '#dfe4ea'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(0, HIP + 2); ctx.lineTo(CELL, HIP + 2); ctx.stroke()
  const pvx = p.x
  for (let e = 0; e < 5; e++) {
    const ex = 434 + e * 26
    const cx = sx(ex, ox) 
    if (cx < -20 || cx > CELL * 6) continue
    ctx.globalAlpha = 0.55
    ctx.fillStyle = '#f3b8b8'
    ctx.beginPath(); ctx.arc(cx, HIP - 26, 21, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#cc8888'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = '#a06060'; ctx.font = 'bold 11px monospace'
    ctx.fillText('E' + (e + 1), cx - 9, HIP - 22)
  }
  // the fighter
  ctx.save(); ctx.translate(sx(pvx, ox), HIP); ctx.scale(SCALE, SCALE)
  drawFighter3D(ctx, g, PLAYER_STYLE, {})
  // the blade: grip -> tip, in the same local space
  ctx.strokeStyle = '#1b6fd0'; ctx.lineWidth = 5; ctx.lineCap = 'round'
  // same local space drawFighter3D uses (do NOT re-negate y here)
  ctx.beginPath(); ctx.moveTo(g.grip.x, g.grip.y); ctx.lineTo(g.tip.x, g.tip.y); ctx.stroke()
  ctx.fillStyle = '#1b6fd0'
  ctx.beginPath(); ctx.arc(g.tip.x, g.tip.y, 3.5, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  // label + the measured world tip
  const worldTip = pvx + p.face * SCALE * g.tip.x
  ctx.fillStyle = '#334'; ctx.font = 'bold 12px monospace'
  ctx.fillText(`${id}  t=${(p.action?.animT ?? 0).toFixed(2)}  bladeTipX=${worldTip.toFixed(0)}`, 8, 16)
  ctx.restore()
})
mkdirSync('research', { recursive: true })
writeFileSync(out, cv.toBuffer('image/png'))
console.log('wrote', out)
