/** Render the WHOLE swing as a filmstrip, with the blade drawn at each tick
 * and every enemy tinted the moment it takes damage. This is the check that
 * the cut looks like a cut rather than a single lucky frame.
 */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync } from 'node:fs'
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { drawFighter3D, makeFighterGeom, solveFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
import type { WorldRef } from '../src/game/core/types'

const BODY_SPHERES = [{ oy: 14, r: 15 }, { oy: 48, r: 21 }, { oy: 78, r: 17 }]
const out = process.argv[2]
const ids = process.argv.slice(3)
const SCALE = 1.32, HIP = 210
const CELL = 150, ROW = 260, N = 10
const cv = createCanvas(CELL * N, ROW * ids.length + 10)
const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D

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
    en.spawning = false; en.state = 'chase'; en.hp = 99999
    en.face = (p.face > 0 ? -1 : 1) as 1 | -1
    en.id = e + 1
    enemies.push(en)
  }
  const d = ATTACKS[id]
  p.startAttack(d, w)
  const cx = (wx: number, ox: number, i: number) => (wx - ox) + CELL / 2 + i * CELL
  const frames: { g: any; ox: number; animT: number; hp: number[] }[] = []
  let prevHp = enemies.map((e) => e.hp)
  for (let f = 0; f < 60; f++) {
    for (const en of enemies) en.x = 400 + p.face * ((en.id - 1) * 26)
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    if (p.state !== 'attack') break
    const g = makeFighterGeom()
    solveFighter3D(p.pose, PLAYER_SPEC, g, PLAYER_SPEC.blade * 1.06, p.swingScale ?? 1)
    frames.push({ g, ox: p.x, animT: p.action?.animT ?? 0, hp: enemies.map((e) => e.hp) })
    prevHp = enemies.map((e) => e.hp)
  }
  // pick N evenly across the hit window
  const inWin = frames.filter((fr) => fr.animT >= d.hit.start && fr.animT <= d.hit.end)
  const pick = inWin.length ? inWin.filter((_, i) => i % Math.max(1, Math.floor(inWin.length / N)) === 0).slice(0, N) : frames.slice(0, N)
  const top = row * ROW + 10
  ctx.save(); ctx.translate(0, top)
  pick.forEach((fr, i) => {
    const X = i * CELL
    ctx.save(); ctx.beginPath(); ctx.rect(X, 0, CELL, ROW); ctx.clip()
    ctx.strokeStyle = '#e6eaee'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(X, HIP + 2); ctx.lineTo(X + CELL, HIP + 2); ctx.stroke()
    enemies.forEach((en) => {
      const hurt = fr.hp[en.id - 1] < 99999
      const ex = (en.x - fr.ox) + CELL / 2 + X
      ctx.globalAlpha = hurt ? 0.75 : 0.4
      for (const sp of BODY_SPHERES) {
        ctx.fillStyle = hurt ? '#6fc47e' : '#f0b4b4'
        ctx.beginPath(); ctx.arc(ex, HIP - sp.oy * en.scale, sp.r * en.scale, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
    })
    ctx.save(); ctx.translate((fr.ox - fr.ox) + CELL / 2 + X, HIP); ctx.scale(SCALE, SCALE)
    drawFighter3D(ctx, fr.g, PLAYER_STYLE, {})
    ctx.strokeStyle = '#1b6fd0'; ctx.lineWidth = 4; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(fr.g.grip.x, fr.g.grip.y); ctx.lineTo(fr.g.tip.x, fr.g.tip.y); ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#445'; ctx.font = '9px monospace'
    ctx.fillText(`t=${fr.animT.toFixed(2)}`, X + 4, 12)
    if (i === 0) { ctx.fillStyle = '#223'; ctx.font = 'bold 11px monospace'; ctx.fillText(id, X + 4, 26) }
    ctx.restore()
  })
  ctx.restore()
})
mkdirSync('research', { recursive: true })
writeFileSync(out, cv.toBuffer('image/png'))
console.log('wrote', out)
