/** Trace one swing frame by frame: where does the blade segment sit, and
 * how far is each enemy body from it? Shows WHY a body is skipped. */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'

const id = process.argv[2] ?? 'cyclone'
const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
const enemies: Enemy[] = []
const w = {
  time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
  audio: { play: noop }, cam: { addTrauma: noop },
  addHitstop: noop,
  hitEnemy: (eid: number, _b: unknown, atk: any) => {
    const e = enemies.find((x) => x.id === eid)!
    const r = resolveEnemyHit(e, atk, p.face, p.x)
    console.log(`    >>> CONTACT e${enemies.indexOf(e)} at t=${p.action?.animT?.toFixed(3)} dmg=${r.actualDamage}`)
    return r
  },
} as unknown as WorldRef
p.reset(400); p.swordDrawn = true
for (let i = 0; i < 5; i++) {
  const e = new Enemy('grunt', 400 + p.face * (34 + i * 26), 1)
  e.spawning = false; e.state = 'chase'; e.face = -p.face; e.hp = 99999
  enemies.push(e)
}
p.startAttack(ATTACKS[id], w)
console.log('attack', id, 'dur', p.action?.def.clip.dur, 'hit', JSON.stringify(p.action?.def.hit))
for (let f = 0; f < 240 && p.state === 'attack'; f++) {
  w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
  const t = p.action?.animT ?? 0
  const b = p.blade
  if (f % 4 === 0 || (b.tx !== b.bx))
    console.log(`f${String(f).padStart(3)} t=${t.toFixed(3)} px=${p.x.toFixed(0)} blade (${b.bx.toFixed(0)},${b.by.toFixed(0)})->(${b.tx.toFixed(0)},${b.ty.toFixed(0)})`)
  for (const e of enemies) { try { e.update(1 / 60, w) } catch {} }
}
console.log('enemy xs:', enemies.map((e) => e.x.toFixed(0)).join(' '))
console.log('enemy hp:', enemies.map((e) => (99999 - e.hp).toFixed(0)).join(' '))
