/** Does a hand-to-hand COMBO actually connect, strike after strike?
 *
 * Fires a sequence of unarmed attacks back-to-back on a single grunt standing
 * at natural engagement distance, and reports per-strike: did it damage,
 * how far the fist/foot got versus the body's near edge, and how far the
 * knockback pushed the body away from the NEXT strike's reach.
 *
 *   npx tsx .qa/chain-connect.ts l1 l2 l3 l4 l5
 */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
import type { WorldRef } from '../src/game/core/types'

export function chain(ids: string[], gap = 34, dt = 1 / 60) {
  const input = new Input(), p = new Player(), fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = {
    time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop },
    hitEnemy: (id: number, _b: unknown, atk: Parameters<typeof resolveEnemyHit>[1]) => {
      const e = enemies.find((x) => x.id === id)!
      return resolveEnemyHit(e, atk, p.face, p.x)
    },
  } as unknown as WorldRef
  p.reset(400)
  p.swordDrawn = false                    // EMPTY HANDS: the stance under test
  const e = new Enemy('grunt', 400 + p.face * gap, 1)
  e.spawning = false; e.state = 'chase'; e.face = (p.face > 0 ? -1 : 1) as 1 | -1
  e.hp = 99999
  enemies.push(e)
  const out: Array<{ id: string; hit: number; gap: number; reach: number }> = []
  for (const id of ids) {
    const base = ATTACKS[id]
    if (!base) { out.push({ id, hit: -1, gap: 0, reach: 0 }); continue }
    const def = unarmedAttack(base)
    const hp0 = e.hp
    const g0 = (e.x - p.x) * p.face
    // let the previous attack finish + recover so each strike starts clean
    let guard = 0
    while (p.state === 'attack' && guard++ < 600) { w.time += dt; p.update(dt, w); input.endFrame(dt) }
    p.startAttack(def, w)
    let frames = 0
    let bestReach = 0
    while (p.state === 'attack' && frames++ < 240 * (1 / 60) / dt) {
      w.time += dt; p.update(dt, w); input.endFrame(dt)
      const g = (Math.abs(e.x - p.x))
      bestReach = Math.max(bestReach, g)
    }
    out.push({ id, hit: Math.round(hp0 - e.hp), gap: Math.round(g0), reach: Math.round(bestReach) })
  }
  return { out, endGap: Math.round((e.x - p.x) * p.face) }
}

if (process.argv[1]?.includes('chain-connect')) {
  const ids = process.argv.slice(2)
  const seq = ids.length ? ids : ['l1', 'l2', 'l3', 'l4', 'l5']
  const r = chain(seq)
  console.log('strike        dmg   gap@start  closest-approach')
  for (const s of r.out) {
    const flag = s.hit > 0 ? '' : '   <- MISS'
    console.log(s.id.padEnd(13), String(s.hit).padStart(4), String(s.gap).padStart(9), String(s.reach).padStart(16), flag)
  }
}
