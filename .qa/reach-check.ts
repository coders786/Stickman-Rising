/** For the stuck cases: how far forward does the blade tip actually get,
 * versus where the bodies are? */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'
for (const id of ['axeKick', 'cyclone', 'ironRoot', 'srOnslaught', 'l1']) {
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  const xs: number[] = []
  for (let i = 0; i < 5; i++) {
    const e = new Enemy('grunt', 400 + 34 + i * 26, 1)
    e.spawning = false; e.state = 'stand'; e.face = -1; e.hp = 99999; enemies.push(e); xs.push(e.x)
  }
  p.startAttack(ATTACKS[id], w)
  const h = ATTACKS[id].hit
  let maxTip = -1e9, maxAny = -1e9
  for (let f = 0; f < 240 && p.state === 'attack'; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    const t = p.action?.animT ?? 0
    if (t >= h.start && t <= h.end) {
      maxTip = Math.max(maxTip, p.blade.tx)
      maxAny = Math.max(maxAny, Math.max(p.blade.tx, p.blade.bx))
    }
    for (const e of enemies) e.x = xs[enemies.indexOf(e)]
  }
  console.log(id.padEnd(12), 'bodies at', xs.join(','),
    '| blade maxX', maxAny.toFixed(0), '| reaches body', xs.filter((x) => x <= maxAny + 21).length, '/5')
}
