/** Compare OUR stance to the reference's. The reference silhouette is
 * head-to-heel ~140px tall with front-toe→rear-heel spanning the FULL width;
 * that is a diagonal lunge, not a boxer's narrow base. */
import { ATTACKS } from '../src/game/combat/attacks'
import { MOVES } from '../src/game/combat/moveset'
import { unarmedAttack } from '../src/game/combat/unarmed'
import { sampleClip } from '../src/game/anim/animator'
import { makeFighterGeom, solveFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'
import { makePose } from '../src/game/anim/pose'
const S = 1.32
export function ratio(id: string) {
  const def = unarmedAttack((ATTACKS as any)[id])
  const clip = def.clip
  let best = 0, at = 0
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * clip.dur
    const p = makePose(); sampleClip(clip, t, p)
    const g = makeFighterGeom(); solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade, 1)
    const front = Math.max(g.toeR.x, g.toeL.x), rear = Math.min(g.toeR.x, g.toeL.x)
    const headTop = g.headC.y - PLAYER_SPEC.headR
    const sole = Math.max(g.toeR.y, g.toeL.y)
    const height = (sole - headTop) * S
    const width = (front - rear) * S
    const r = width / height
    if (r > best) { best = r; at = t }
  }
  return { id, ratio: best, at }
}
if (process.argv[1]?.includes('stance-vs-ref')) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['l1', 'l2', 'l3', 'l5', 'h1', 'h2', 'h3', 'axeKick', 'stepKick']
  console.log('REFERENCE target: stance-width / body-height = 0.95 - 1.00 (diagonal lunge)\n')
  for (const id of ids) {
    const r = ratio(id)
    const verdict = r.ratio >= 0.8 ? 'ok' : r.ratio >= 0.55 ? 'NARROW' : 'TOO NARROW'
    console.log(r.id.padEnd(10), `width/height = ${r.ratio.toFixed(2)}`, ` at t=${r.at.toFixed(2)}`, ' ', verdict)
  }
}
