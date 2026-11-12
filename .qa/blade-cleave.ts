(globalThis as any).__dbg = process.argv.includes('--dbg')
/** Does one sword swing CUT THROUGH a pack, or stop at the first body?
 *
 * Builds a real Player + real WorldRef (same shape tests/dash-combat uses),
 * places N grunts in a row at chest reach, fires a real sword attack and
 * steps the player. Reports how many bodies the swing damaged. A "stuck"
 * blade damages 1 of N.
 */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import type { WorldRef } from '../src/game/core/types'

export function cleave(attackId: string, count = 5, spacing = 26, gap = 34, dt = 1 / 60) {
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
  // WITH THE BLADE DRAWN, EVERY attack resolves through the SWORD segment:
  // player.ts:2251 does `if(!this.swordDrawn) def=unarmedAttack(def)`, so a
  // kick thrown while holding the blade plays the KICK CLIP but swings the
  // BLADE. That is precisely the reported case ("when I have blade"), so
  // that is the state under test. (Sheathed, the same clip uses the fist,
  // whose 55px reach cannot touch a second body by anatomy.)
  p.swordDrawn = true
  for (let i = 0; i < count; i++) {
    const e = new Enemy('grunt', 400 + p.face * (gap + i * spacing), 1)
    e.spawning = false; e.state = 'chase'; e.face = (p.face > 0 ? -1 : 1) as 1 | -1
    e.hp = 99999
    enemies.push(e)
  }
  const before = enemies.map((e) => e.hp)
  p.startAttack(ATTACKS[attackId], w)
  let frames = 0
  while (p.state === 'attack' && frames++ < 240 * (1 / 60) / dt) {
    w.time += dt; p.update(dt, w); input.endFrame(dt)
    // HOLD the pack still: an enemy that walks during the swing changes
    // the test. This harness measures the BLADE, not enemy AI.
    for (const e of enemies) { e.x = 400 + p.face * (gap + enemies.indexOf(e) * spacing) }
  }
  const dmg = enemies.map((e, i) => Math.round(before[i] - e.hp))
  return { dmg, cut: dmg.filter((d) => d > 0).length, n: count, frames }
}

if (process.argv[1]?.includes('blade-cleave')) {
  const ids = process.argv[2] ? [process.argv[2]] : Object.keys(ATTACKS)
  console.log('attack        cut   dmg per body')
  for (const id of ids) {
    try {
      const r = cleave(id)
      const flag = r.cut >= 3 ? '' : r.cut === 0 ? '  <- NOTHING' : '  <- STUCK on first body'
      console.log(id.padEnd(13), `${r.cut}/${r.n}`.padStart(5), ' ', r.dmg.join(' '), flag)
    } catch (e: any) { console.log(id.padEnd(13), 'threw:', e.message) }
  }
}
