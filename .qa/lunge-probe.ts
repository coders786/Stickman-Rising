/** Where does the body actually END UP relative to the enemy row, and when
 * does each body get its first chance to be hit? */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'
for (const id of process.argv.slice(2)) {
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x: Enemy) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  const d = ATTACKS[id]
  p.startAttack(d, w)
  const xs: string[] = []
  for (let f = 0; f < 300 && p.state === 'attack'; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    const t = p.action?.animT ?? 0
    if (f % 4 === 0) xs.push(`${t.toFixed(2)}:${p.x.toFixed(0)}/${p.vx.toFixed(0)}`)
  }
  console.log(id.padEnd(15), 'window', d.hit.start, '-', d.hit.end, '| moveX', (d as any).moveX, '@', (d as any).moveXAt)
  console.log('   x/vx', xs.slice(0, 16).join(' '))
}
