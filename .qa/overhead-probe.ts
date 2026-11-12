/** Did the blade pass OVER the first body (a legitimate reason to miss it)?
 *
 * h1 and srOnslaught are overhead cuts: their edge travels at y -127..-155
 * while an enemy's tallest body sphere only reaches y -99, so the sword clears
 * the head entirely. That is choreography, not a dropped hit -- but it must be
 * proven with geometry rather than waived by name.
 */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'

/** tallest body sphere: oy 78, r 17 (see BODY_SPHERES in player.ts) */
const HEAD_TOP = 78 + 17

export function overshootOverFirstBody(attackId: string, spacing = 26, gap = 34): boolean {
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  for (let e = 0; e < 5; e++) {
    const en = new Enemy('grunt', 400 + p.face * (gap + e * spacing), 1)
    en.spawning = false; en.hp = 99999; en.id = e + 1
    enemies.push(en)
  }
  const d = ATTACKS[attackId]
  const e1 = enemies[0]
  const headTopY = e1.y - HEAD_TOP * e1.scale // highest (most negative) sphere top
  p.startAttack(d, w)
  let swept = false
  for (let f = 0; f < 200 && p.state === 'attack'; f++) {
    for (const en of enemies) en.x = 400 + p.face * (gap + (en.id - 1) * spacing)
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    if (p.action?.animT < d.hit.start || p.action?.animT > d.hit.end) continue
    // did any part of the edge come down to head height while over body 1?
    const loX = Math.min(p.blade.bx, p.blade.tx), hiX = Math.max(p.blade.bx, p.blade.tx)
    if (e1.x < loX - 4 || e1.x > hiX + 4) continue
    const loY = Math.min(p.blade.by, p.blade.ty)
    if (loY > headTopY) swept = true // the edge dipped into the body's height band
  }
  return !swept
}
