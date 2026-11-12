/** What segment does each strike type actually hand the hit test? */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'
for (const id of ['l1', 'cyclone', 'viperPalm', 'axeKick']) {
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  p.startAttack(ATTACKS[id], w)
  const h = ATTACKS[id].hit
  let maxTx = -1e9, maxBx = -1e9, n = 0
  for (let f = 0; f < 240 && p.state === 'attack'; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    const t = p.action?.animT ?? 0
    if (t >= h.start && t <= h.end) { n++; maxTx = Math.max(maxTx, p.blade.tx); maxBx = Math.max(maxBx, p.blade.bx) }
  }
  const d = ATTACKS[id] as any
  console.log(id.padEnd(11), 'strikeHand', String(d.strikeHand).padEnd(6),
    'joint', String(d.strikeJoint ?? 'hand').padEnd(6),
    '| blade tip maxX', maxTx.toFixed(0), 'base maxX', maxBx.toFixed(0), '|', n, 'ticks')
}
