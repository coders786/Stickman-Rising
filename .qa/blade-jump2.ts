/** For the worst cleavers: per-tick tip position through the hit window,
 * flagging the ticks where the pose JUMPS (stepped clock). */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'

for (const id of ['stepKick', 'cyclone', 'axeKick', 'srVortex']) {
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  const e = new Enemy('grunt', 470, 1); e.spawning = false; e.state = 'stand'; e.face = -1; e.hp = 99999
  enemies.push(e)
  p.startAttack(ATTACKS[id], w)
  const h = ATTACKS[id].hit, trace: string[] = []
  for (let f = 0; f < 240 && p.state === 'attack'; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    const t = p.action?.animT ?? 0
    if (t >= h.start - 0.02 && t <= h.end + 0.02) {
      const b = p.blade
      trace.push(`t=${t.toFixed(3)} tip=(${b.tx.toFixed(0)},${b.ty.toFixed(0)}) base=(${b.bx.toFixed(0)},${b.by.toFixed(0)}) px=${p.x.toFixed(0)}`)
    }
  }
  console.log(`\n${id}  window ${h.start}..${h.end}`)
  trace.forEach((s) => console.log('  ' + s))
}
