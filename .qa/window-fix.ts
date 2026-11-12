/** For each suspect strike: does it actually connect against a body at the
 *  standoff BEFORE and AFTER the suggested window? A peak-reach measurement
 *  is a hypothesis; a live connection is the proof. */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
import type { WorldRef } from '../src/game/core/types'
const noop = () => {}

function attempt(id: string, gap: number, override?: { start: number; end: number }) {
  const input = new Input(), p = new Player() as any, fx = new FX()
  const enemies: Enemy[] = []
  const w = {
    time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: never) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
    enemyStrikePlayer: () => 'miss',
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = false
  const e = new Enemy('grunt', 400 + gap, 1)
  e.spawning = false; e.state = 'chase'; e.face = -1; e.hp = 999999; e.id = 1
  enemies.push(e)
  const base = unarmedAttack((ATTACKS as any)[id]) as any
  const def = override ? { ...base, hit: { ...base.hit, ...override } } : base
  p.startAttack(def, w)
  const hp0 = e.hp
  for (let f = 0; f < 160; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); e.update(1 / 60, w); input.endFrame(1 / 60)
    if (p.state !== 'attack') break
  }
  return e.hp < hp0
}

/** peak-reach beat measured on the def's own limb (see .qa/peak-window.ts) */
const SUSPECTS: [string, number, number, number][] = [
  // id, peakT, currentStart, currentEnd
  ['l1', 0.174, 0.10, 0.15],
  ['a3', 0.215, 0.35, 0.46],
  ['sakugaDragon', 0.939, 0.34, 0.65],
  ['sakugaScorpion', 0.672, 0.71, 0.87],
  ['viperPalm', 0.400, 0.24, 0.36],
  ['ironRoot', 0.480, 0.28, 0.41],
  ['omegaPalm', 0.735, 0.49, 0.69],
  ['srOnslaught', 0.520, 0.74, 0.92],
  ['srOmega', 1.000, 0.45, 1.00],
]

console.log('strike          peakT   gap  now   fixed')
for (const [id, peakT, s, en] of SUSPECTS) {
  const dur = ((unarmedAttack((ATTACKS as any)[id]) as any).clip.dur as number)
  const fixed = { start: Math.max(0, peakT - 0.02), end: Math.min(dur * 0.92, peakT + 0.08) }
  const row: string[] = []
  for (const gap of [34, 48]) {
    const now = attempt(id, gap)
    const nw = attempt(id, gap, fixed)
    row.push(`g${gap} ${now ? 'HIT' : 'miss'}  ${nw ? 'HIT' : 'miss'}`)
  }
  console.log(id.padEnd(15), peakT.toFixed(2), ' ', row.join('   '),
    `  window ${s}-${en} -> ${fixed.start.toFixed(2)}-${fixed.end.toFixed(2)}`)
}
