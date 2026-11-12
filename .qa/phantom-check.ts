/** Is a body ever cut while the blade is visibly somewhere else?
 *
 * The swept-edge model credits a hit if the blade passed through the body at
 * ANY point in the swing, so a slow window can credit a body the blade left
 * a while ago. Measure, at the exact frame each body is first damaged, the
 * distance from that body to the LIVE blade segment. A big number means the
 * player sees a green flash with no sword near it -- a phantom hit.
 */
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { segHitsCircle } from '../src/game/core/utils'
import type { WorldRef } from '../src/game/core/types'

/** Same spheres the hit test uses. */
const BODY_SPHERES = [{ oy: 14, r: 15 }, { oy: 48, r: 21 }, { oy: 78, r: 17 }]

/** perpendicular distance from a point to the blade segment */
function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1
  const L2 = dx * dx + dy * dy
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2)) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

let worst = 0, worstId = '', samples: number[] = []
for (const id of Object.keys(ATTACKS)) {
  if (id === 'h3') continue
  const input = new Input(), p = new Player() as any, fx = new FX(), noop = () => {}
  const enemies: Enemy[] = []
  const w = { time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop }, addHitstop: noop,
    hitEnemy: (eid: number, _b: unknown, atk: any) =>
      resolveEnemyHit(enemies.find((x) => x.id === eid)!, atk, p.face, p.x),
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = true
  for (let e = 0; e < 5; e++) {
    const en = new Enemy('grunt', 400 + e * 26, 1)
    en.spawning = false; en.hp = 99999; en.id = e + 1
    enemies.push(en)
  }
  const d = ATTACKS[id]
  // A deliberate AOE shockwave is SUPPOSED to hit bodies far from the blade;
  // measuring those as phantom blade hits would be measuring the wrong thing.
  const hasAoe = !!(d.hit as { aoe?: number }).aoe
  p.startAttack(d, w)
  const seen = new Set<number>()
  const seenAt = new Map<number, { x: number; y: number; bx: number; by: number; tx: number; ty: number; t: number }>()
  for (let f = 0; f < 200 && p.state === 'attack'; f++) {
    for (const en of enemies) en.x = 400 + (en.id - 1) * 26
    // snapshot BEFORE the tick: the aoe pass fires inside update(), so a body
    // it hits is far from where the blade was at this instant
    const preBlade = { bx: p.blade.bx, by: p.blade.by, tx: p.blade.tx, ty: p.blade.ty }
    // an unarmed attack thrown with the blade drawn shows a FIST, not the
    // sword -- the player follows the limb, so measure against whichever of
    // the two is closer to the body
    const preLimb = p.limbSeg?.active
      ? { bx: p.limbSeg.bx, by: p.limbSeg.by, tx: p.limbSeg.tx, ty: p.limbSeg.ty }
      : null
    const preX = enemies.map((en) => en.x)
    w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
    for (const en of enemies) {
      if (seen.has(en.id)) continue
      if (en.hp < 99999) {
        seen.add(en.id)
        // Penetration depth: how far INSIDE the nearest body sphere the live
        // blade reaches at the moment of the hit. Measuring to the torso
        // centre alone is unfair -- a katana passing through the legs is a
        // real contact (that is where powerPunch legitimately lands), so this
        // reports the best-covered sphere instead.
        let dd = Infinity
        for (const sp of BODY_SPHERES) {
          const cyy = en.y - sp.oy * en.scale
          let best = distToSeg(preX[en.id - 1], cyy, preBlade.bx, preBlade.by, preBlade.tx, preBlade.ty)
          if (preLimb) best = Math.min(best, distToSeg(preX[en.id - 1], cyy, preLimb.bx, preLimb.by, preLimb.tx, preLimb.ty))
          dd = Math.min(dd, best - sp.r * en.scale)
        }
        if (!hasAoe) samples.push(dd)
        if (!hasAoe && dd > worst) { worst = dd; worstId = `${id}/E${en.id}` }
      }
    }
    if (seen.size === 5) break
  }
}
samples.sort((a, b) => a - b)
const pct = (q: number) => samples[Math.floor(samples.length * q)].toFixed(0)
console.log('blade-credited hits sampled (AOE shockwaves excluded):', samples.length)
console.log('how far the LIVE blade PENETRATES the nearest body sphere at the hit frame:')
console.log('  median', pct(0.5), 'px   90th', pct(0.9), 'px   99th', pct(0.99), 'px   worst', worst.toFixed(0), 'px  (' + worstId + ')')
console.log('  (negative = blade inside the body; anything near 0 or below is a real contact)')
