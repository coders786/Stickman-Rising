/** Interpose on the blade update to see the segments the hit test ACTUALLY
 * receives, and whether stale prevBlade is producing a bad swept quad. */
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
  audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
  hitEnemy: (eid: number, _b: unknown, atk: any) => {
    const e = enemies.find((x) => x.id === eid)!
    console.log(`  CONTACT e${enemies.indexOf(e)} t=${p.action?.animT?.toFixed(3)}`)
    return resolveEnemyHit(e, atk, p.face, p.x)
  },
} as unknown as WorldRef
p.reset(400); p.swordDrawn = true
for (let i = 0; i < 5; i++) {
  const e = new Enemy('grunt', 400 + p.face * (34 + i * 26), 1)
  e.spawning = false; e.state = 'chase'; e.face = -p.face; e.hp = 99999
  enemies.push(e)
}
// record every blade segment handed to the hit test
const segs: any[] = []
const orig = p.updateBladeWorld.bind(p)
p.updateBladeWorld = function () {
  orig()
  if (this.action) segs.push({ t: this.action.animT, hasPrev: this.hasPrevBlade,
    prev: { ...this.prevBlade }, cur: { ...this.blade } })
}
p.startAttack(ATTACKS[id], w)
for (let f = 0; f < 240 && p.state === 'attack'; f++) {
  w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
  for (const e of enemies) { try { e.update(1 / 60, w) } catch {} }
}
const h = ATTACKS[id].hit
console.log(`\n${id}: ${segs.filter(s => s.t >= h.start && s.t <= h.end).length} in-window frames`)
let out = 0
for (const s of segs) {
  if (s.t < h.start || s.t > h.end) continue
  const move = Math.hypot(s.cur.bx - s.prev.bx, s.cur.ty - s.prev.ty)
  console.log(`t=${s.t.toFixed(3)} hasPrev=${s.hasPrev} moved=${move.toFixed(1)}px cur=(${s.cur.bx.toFixed(0)},${s.cur.by.toFixed(0)})->(${s.cur.tx.toFixed(0)},${s.cur.ty.toFixed(0)})`)
  if (++out > 12) break
}
