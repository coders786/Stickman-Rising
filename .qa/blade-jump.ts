/** How far does the blade travel between the frames the hit test sees?
 * A jump larger than the thinnest body sphere means tunneling is possible. */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'

for (const id of ['l1', 'cyclone', 'stepKick', 'srVortex', 'axeKick']) {
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  for (let i = 0; i < 3; i++) {
    const e = new Enemy('grunt', 400 + 34 + i * 26, 1)
    e.spawning = false; e.state = 'chase'; e.face = -1; e.hp = 99999; enemies.push(e)
  }
  const samples: any[] = []
  const orig = p.updateBladeWorld.bind(p)
  p.updateBladeWorld = function () {
    orig()
    if (this.action && this.swordDrawn) samples.push({ t: this.action.animT, ...this.blade })
  }
  p.startAttack(ATTACKS[id], w)
  for (let f = 0; f < 240 && p.state === 'attack'; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
  }
  const h = ATTACKS[id].hit
  const win = samples.filter((s) => s.t >= h.start - 0.02 && s.t <= h.end + 0.02)
  let maxJump = 0, total = 0
  for (let i = 1; i < win.length; i++) {
    const d = Math.hypot(win[i].tx - win[i - 1].tx, win[i].ty - win[i - 1].ty)
    maxJump = Math.max(maxJump, d); total += d
  }
  const uniqueFrames = new Set(win.map((s) => s.t.toFixed(4))).size
  console.log(id.padEnd(10), `window ${win.length} ticks, ${uniqueFrames} distinct poses,`,
    `max jump ${maxJump.toFixed(0)}px, path ${total.toFixed(0)}px`)
}
