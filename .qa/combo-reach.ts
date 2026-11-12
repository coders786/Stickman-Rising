/** Does a chained string still CONNECT after the previous hit's knockback?
 *
 * The failure mode this measures: strike 1 lands and pushes the body back
 * 100+px; strike 2 opens its window when the body is already outside the
 * limb's reach, so the combo silently drops. Reports the gap at the instant
 * each hit window opens, versus the limb reach available in that window.
 */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
import type { WorldRef } from '../src/game/core/types'

const SCALE = 1.32
export function run(ids: string[], gap0 = 34, dt = 1 / 60) {
  const input = new Input(), p = new Player(), fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = {
    time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop },
    hitEnemy: (id: number, _b: unknown, atk: Parameters<typeof resolveEnemyHit>[1]) => {
      const e = enemies.find((x) => x.id === id)!
      return resolveEnemyHit(e, atk, p.face, p.x)
    },
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = false
  const e = new Enemy('grunt', 400 + gap0, 1)
  e.spawning = false; e.state = 'idle'; e.face = -1; e.hp = 999999
  enemies.push(e)
  const rows: any[] = []
  for (const id of ids) {
    const def = unarmedAttack((ATTACKS as any)[id])
    let g = 0; while (p.state === 'attack' && g++ < 900) { w.time += dt; p.update(dt, w); e.update(dt, w); input.endFrame(dt) }
    const hp0 = e.hp, gapAtStart = Math.round((e.x - p.x) * p.face)
    p.startAttack(def, w)
    let gapAtOpen = -1, frames = 0, minGap = 1e9
    while (p.state === 'attack' && frames++ < 400) {
      const before = Math.round((e.x - p.x) * p.face)
      if (gapAtOpen < 0 && p.action && p.action.animT >= def.hit.start) gapAtOpen = before
      w.time += dt; p.update(dt, w); e.update(dt, w); input.endFrame(dt)
      minGap = Math.min(minGap, Math.round((e.x - p.x) * p.face))
    }
    rows.push({ id, dmg: Math.round(hp0 - e.hp), gapAtStart, gapAtOpen, minGap })
  }
  return rows
}
if (process.argv[1]?.includes('combo-reach')) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['l1', 'l2', 'l3', 'l4', 'l5']
  const rows = run(ids)
  console.log('id    dmg  gap@start gap@window-open  closest')
  for (const r of rows) console.log(r.id.padEnd(6), String(r.dmg).padStart(4), String(r.gapAtStart).padStart(8), String(r.gapAtOpen).padStart(14), String(r.minGap).padStart(9), r.dmg > 0 ? '' : '  <- MISS')
}
