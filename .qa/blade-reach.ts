/** How far does the blade actually STICK OUT from the body at strike time?
 * A blade whose tip reach is under ~60px cannot pass a second body. */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'

export function reach(id: string) {
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
  const h = ATTACKS[id].hit
  let tip = 0, base = 0, len = 0, maxTipX = -1e9, minTipX = 1e9
  for (let f = 0; f < 240 && p.state === 'attack'; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    const t = p.action?.animT ?? 0
    if (t >= h.start && t <= h.end) {
      tip = Math.max(tip, p.blade.tx - p.x)
      base = Math.max(base, p.blade.bx - p.x)
      len = Math.max(len, Math.hypot(p.blade.tx - p.blade.bx, p.blade.ty - p.blade.by))
      maxTipX = Math.max(maxTipX, p.blade.tx); minTipX = Math.min(minTipX, p.blade.tx)
    }
  }
  return { tip, base, len, sweep: maxTipX - minTipX }
}

if (process.argv[1]?.includes('blade-reach')) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ATTACKS)
  console.log('attack       tipReach  baseReach  bladeLen  tipSweep')
  for (const id of ids) {
    try {
      const r = reach(id)
      const bad = r.tip < 70 ? '  <- blade barely clears the body' : ''
      console.log(id.padEnd(12), String(r.tip.toFixed(0)).padStart(8), String(r.base.toFixed(0)).padStart(10),
        String(r.len.toFixed(0)).padStart(9), String(r.sweep.toFixed(0)).padStart(9), bad)
    } catch (err: any) { console.log(id.padEnd(12), 'threw:', err.message) }
  }
}
