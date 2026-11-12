/** Trace blade tip vs the action's OWN animT, to see whether the hit window
 * lines up with the forward sweep in the real player (ronin clips have a
 * slow-map, so raw clip time != animT). */
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
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  const d = ATTACKS[id]
  p.startAttack(d, w)
  const dur = d.clip.dur
  const rows: string[] = []
  for (let f = 0; f < 400 && p.state === 'attack'; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    const t = p.action?.animT ?? 0
    const inW = t >= d.hit.start && t <= d.hit.end
    rows.push(`${t.toFixed(3)}:${p.blade.tx.toFixed(0)}${inW ? '*' : ''}`)
  }
  console.log(id, `window ${d.hit.start}-${d.hit.end}`, '\n  ', rows.join(' '))
}
