/** "connect more strikes" -- how DEEP does a string actually get?
 *
 * `combo-live.ts` counts total connections in 6 seconds, which mixes the
 * question "does the string chain" with "does the player keep re-throwing".
 * This measures the other thing: starting from a real standoff, if the
 * player throws a string and every strike is only thrown when the previous
 * one has recovered, how many strikes into the string actually CONNECT
 * before one whiffs? That is what a player feels as "the combo dropping".
 */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
import type { WorldRef } from '../src/game/core/types'

const noop = () => {}
const STRINGS: Record<string, string[]> = {
  'light l1-l5': ['l1', 'l2', 'l3', 'l4', 'l5'],
  'light jabs': ['l1', 'l2', 'l1', 'l2'],
  'heavy h2-h1-h3': ['h2', 'h1', 'h3'],
  'mixed': ['l1', 'l2', 'h1', 'h3', 'l5'],
}

function runString(ids: string[], hold: boolean) {
  const input = new Input(), p = new Player(), fx = new FX()
  const enemies: Enemy[] = []
  const w = {
    time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop },
    hitEnemy: (id: number, _b: unknown, atk: never) =>
      resolveEnemyHit(enemies.find((x) => x.id === id)!, atk, p.face, p.x),
    enemyStrikePlayer: () => 'miss',
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = false
  const e = new Enemy('grunt', 434, 1) // the 34px standoff
  e.spawning = false; e.state = hold ? 'idle' : 'chase'; e.face = -1; e.hp = 999999
  enemies.push(e)
  let i = 0, deepest = 0, streak = 0
  let lastHp = e.hp
  for (let f = 0; f < 60 * 8 && i < ids.length; f++) {
    if (p.state !== 'attack') {
      p.startAttack(unarmedAttack((ATTACKS as unknown as Record<string, never>)[ids[i]]), w)
      i++
    }
    w.time += 1 / 60; p.update(1 / 60, w); e.update(1 / 60, w); input.endFrame(1 / 60)
    if (e.hp < lastHp) { streak++; lastHp = e.hp; deepest = Math.max(deepest, streak) }
    else if (p.state === 'attack' && (p as unknown as { action?: { animT: number } }).action?.animT
      && (p as unknown as { action: { animT: number } }).action.animT > 0.3) streak = 0
  }
  return { thrown: i, deepest }
}

console.log('string            target   thrown  deepest-streak')
for (const [name, ids] of Object.entries(STRINGS)) {
  for (const hold of [true, false]) {
    const r = runString(ids, hold)
    console.log(name.padEnd(17), (hold ? 'pinned' : 'chasing').padEnd(8),
      String(r.thrown).padStart(6), String(r.deepest).padStart(14))
  }
}
