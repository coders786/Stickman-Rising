/** Does each strike CLOSE the distance, the way the reference sheets do?
 * Reference rows advance ~5px/frame while the combo runs. Ours gets pushed
 * back by knockback, so every strike after the first opens outside reach.
 * This measures net body-to-body travel per strike.
 */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
import type { WorldRef } from '../src/game/core/types'
export function run(ids: string[], gap0 = 34, dt = 1 / 60, hold = false) {
  const input = new Input(), p = new Player(), fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop },
    hitEnemy: (id: number, _b: unknown, atk: any) => resolveEnemyHit(enemies.find((x) => x.id === id)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = false
  const e = new Enemy('grunt', 400 + gap0, 1)
  e.spawning = false; e.state = 'idle'; e.face = -1; e.hp = 999999
  enemies.push(e)
  const rows: any[] = []
  for (const id of ids) {
    const def = unarmedAttack((ATTACKS as any)[id])
    let g = 0; while (p.state === 'attack' && g++ < 900) { w.time += dt; p.update(dt, w); e.update(dt, w); input.endFrame(dt) }
    const hp0 = e.hp, g0 = Math.round((e.x - p.x) * p.face), px0 = p.x
    p.startAttack(def, w)
    // `p.action` is nulled the moment the attack ends, so the window-open gap
    // must be latched from the attack's own clock (which starts at 0), not
    // inferred later.
    let gapOpen = -1, tAct = 0, frames = 0
    while (p.state === 'attack' && frames++ < 400) {
      if (gapOpen < 0 && tAct >= def.hit.start) gapOpen = Math.round((e.x - p.x) * p.face)
      tAct += dt
      w.time += dt; if (!hold) e.update(dt, w); p.update(dt, w); input.endFrame(dt)
    }
    rows.push({ id, dmg: Math.round(hp0 - e.hp), g0, gapOpen, g1: Math.round((e.x - p.x) * p.face), adv: Math.round((e.x - p.x) * p.face) - g0 })
  }
  return rows
}
if (process.argv[1]?.includes('combo-travel')) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['l1', 'l2', 'l3', 'l4', 'l5']
  const rows = run(ids)
  console.log('id    dmg   gap0  gap@open  gap@end   net   (ref: ~-5/frame = CLOSING)')
  for (const r of rows) console.log(r.id.padEnd(6), String(r.dmg).padStart(4), String(r.g0).padStart(6), String(r.gapOpen).padStart(9), String(r.g1).padStart(9), String(r.adv).padStart(6), r.dmg > 0 ? '' : '  <- MISS')
}
