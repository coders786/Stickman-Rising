/** "connect more strikes" -- how DEEP does a string actually get?
 *
 * `combo-live.ts` counts total connections in 6 seconds, which mixes two
 * questions: "does the string chain" and "does the player keep re-throwing".
 * This measures the one a player feels: starting from a real standoff, throw
 * the string in order, and count the longest run of consecutive strikes that
 * CONNECT before one whiffs.
 *
 * A hit is attributed to the strike whose action produced it -- the action is
 * still live at the moment damage is dealt, so read its def id rather than
 * guessing from the throw counter.
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
  // h1 -> h2 -> h3 is the authored heavy chain; h2's own chain does NOT
  // include h1 (it goes to l5/launcher/sakugaScorpion/omegaPalm), so
  // "h2-h1-h3" was an illegal sequence and its failure meant nothing.
  'heavy h1-h2-h3': ['h1', 'h2', 'h3'],
  mixed: ['l1', 'l2', 'h1', 'h3', 'l5'],
}

export function runString(ids: string[], pinned: boolean) {
  const input = new Input(), p = new Player() as any, fx = new FX()
  const enemies: Enemy[] = []
  const w = {
    time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (id: number, _b: unknown, atk: never) =>
      resolveEnemyHit(enemies.find((x) => x.id === id)!, atk, p.face, p.x),
    enemyStrikePlayer: () => 'miss',
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = false
  const e = new Enemy('grunt', 434, 1)
  e.spawning = false; e.state = 'chase'; e.face = -1; e.hp = 999999; e.id = 1
  enemies.push(e)

  // Per-SLOT hit flags, not a set of ids: a string can repeat an id
  // (l1,l2,l1,l2) and a set cannot tell the two l1 hits apart, which made
  // this probe report a false "l5 whiffs" and a false depth of 2.
  const slotHit: boolean[] = []
  let slot = -1
  let i = 0, lastHp = e.hp
  // Run until every strike has been thrown AND the last one has had time to
  // play out. Guarding only on `i < ids.length` exits the moment the final
  // strike is STARTED, so the last strike of every string appeared to whiff
  // -- a pure harness off-by-one that looked exactly like a gameplay bug
  // (it reported L5!/L2!/H3! as the failing strike in all four strings).
  const HARD_STOP = 60 * 14
  for (let f = 0; f < HARD_STOP && (i < ids.length || p.state === 'attack'); f++) {
    if (p.state !== 'attack') {
      const id = ids[i]
      p.startAttack(unarmedAttack((ATTACKS as unknown as Record<string, never>)[id]), w)
      i++
      slot = i - 1
    }
    if (pinned) e.x = 400 + 34
    w.time += 1 / 60; p.update(1 / 60, w); e.update(1 / 60, w); input.endFrame(1 / 60)
    if (e.hp < lastHp) { if (slot >= 0) slotHit[slot] = true; lastHp = e.hp }
  }
  // the run of consecutive string slots that connected, in order
  let depth = 0
  while (depth < ids.length && slotHit[depth]) depth++
  const mark = ids.map((id, k) => (slotHit[k] ? id : id.toUpperCase() + '!')).join(',')
  return { thrown: i, depth, mark }
}

if (process.argv[1]?.includes('chain-depth')) console.log('string            target   thrown  depth  (a "!" marks the strike that whiffed)')
if (process.argv[1]?.includes('chain-depth')) for (const [name, ids] of Object.entries(STRINGS)) {
  for (const pinned of [true, false]) {
    const r = runString(ids, pinned)
    console.log(name.padEnd(17), (pinned ? 'pinned' : 'chasing').padEnd(8),
      String(r.thrown).padStart(6), String(r.depth).padStart(6), '  ' + r.mark)
  }
}
