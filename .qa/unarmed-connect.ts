/** Does the FIST actually reach the body when an empty-hand hit lands?
 *
 * `phantom-check.ts` asks this of the blade. The unarmed kit needs its own
 * answer, because it is a *different* credit path: `strikeHand` moves the
 * hit test onto the visible limb (`limbSeg`), not the sword. A combo that
 * reports "14 hits" is worthless if the fist is 40px short of the body at
 * each one -- that is the "I hit nothing but the grunt flinches" read.
 *
 * THE RIG'S REACH IS THE CONSTRAINT (research/SPRITE-SHEETS.md):
 *   forward reach = sin(shR)*22 + sin(shR+elR)*20, max 42 local = 55px.
 * So a 34px standoff should leave the fist INSIDE the torso sphere every
 * time. The number to watch is `slack` = distance from the fist segment to
 * the nearest body sphere at the first-damage frame, minus the radius
 * (negative = the fist is inside the body).
 */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
import type { WorldRef } from '../src/game/core/types'

const BODY_SPHERES = [{ oy: 14, r: 15 }, { oy: 48, r: 21 }, { oy: 78, r: 17 }]

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1
  const L2 = dx * dx + dy * dy
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2)) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

const GAP = Number(process.env.GAP ?? 34)
const rows: { id: string; joint: string; slack: number; fistX: number; bodyX: number; pad: number }[] = []
const skipped: string[] = []

for (const id of ['l1', 'l2', 'l3', 'l4', 'l5', 'h1', 'h2', 'h3', 'cyclone', 'powerPunch']) {
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = {
    time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
    enemyStrikePlayer: () => 'miss',
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = false
  const en = new Enemy('grunt', 400 + GAP, 1)
  en.spawning = false; en.hp = 99999; en.id = 1
  enemies.push(en)
  const def = unarmedAttack((ATTACKS as any)[id]) as any
  // A dash-corridor attack (powerPunch/powerKick) is SUPPOSED to hit bodies
  // it dashes past -- measuring those against the live fist is measuring the
  // wrong thing, and it is already the documented worst case in
  // research/CLEAVE.md ("authored dash corridor"). Same exclusion the blade
  // probe makes for AOE.
  if (def.kind === 'dash' || (def.hit as any)?.aoe) { skipped.push(id + ' (' + def.kind + ')'); continue }
  p.startAttack(def, w)
  let recorded = false
  for (let f = 0; f < 120 && p.state === 'attack'; f++) {
    // With the blade SHEATHED the hit segment is written into `this.blade`
    // (updateBladeWorld's `if(!swordDrawn&&strike)` branch reuses those
    // fields for the fist/foot/knee/elbow). `limbSeg` is only populated on
    // the drawn-blade-but-punching path, so reading it here yields nothing.
    const preLimb = { bx: p.blade.bx, by: p.blade.by, tx: p.blade.tx, ty: p.blade.ty }
    const preBodyX = en.x
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    if (!recorded && en.hp < 99999 && preLimb) {
      recorded = true
      let best = Infinity
      for (const sp of BODY_SPHERES) {
        const cy = en.y - sp.oy * en.scale
        best = Math.min(best, distToSeg(preBodyX, cy, preLimb.bx, preLimb.by, preLimb.tx, preLimb.ty) - sp.r * en.scale)
      }
      rows.push({ id, joint: (p.action?.def as any)?.strikeJoint ?? 'hand', slack: best, fistX: preLimb.tx, bodyX: preBodyX, pad: (def.hit as any)?.pad ?? 0 })
    }
  }
}

rows.sort((a, b) => b.slack - a.slack)
console.log(`fist-to-body gap at the first-damage frame (standoff ${GAP}px)`)
console.log('strike        joint    slack   pad   tipX  bodyX   (negative = striking joint INSIDE the body)')
for (const r of rows) console.log(r.id.padEnd(12), r.joint.padEnd(9), r.slack.toFixed(1).padStart(6), String(r.pad).padStart(4), r.fistX.toFixed(0).padStart(7), r.bodyX.toFixed(0).padStart(6))
if (skipped.length) console.log('excluded (dash corridor / AOE, hits by design):', skipped.join(', '))
const n = rows.length
// "Contact" = the striking joint is inside the body, or within the attack's
// own authored `pad` tolerance. A hit that relies on more than its pad is a
// hit the player cannot see connect.
const inside = rows.filter((r) => r.slack <= r.pad).length
console.log(`\n${inside}/${n} strikes land within their own contact tolerance`)
if (n) console.log('worst slack', rows[0].slack.toFixed(1), 'px  (' + rows[0].id + ')')
