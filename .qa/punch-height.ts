/** WHERE does the strike land vertically?
 * The reference sheets throw every punch at CHIN level: the fist arrives
 * within a few px of the shoulder line. A fist that lands at hip height is
 * a body shot the animation never asked for. Reports strike-point height
 * relative to the shoulder, in world px, at peak reach inside the window.
 */
import { ATTACKS } from '../src/game/combat/attacks'
import { MOVES } from '../src/game/combat/moveset'
import { unarmedAttack } from '../src/game/combat/unarmed'
import { sampleClip } from '../src/game/anim/animator'
import { makeFighterGeom, solveFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'
import { makePose } from '../src/game/anim/pose'
const SCALE = 1.32
export function h(id: string) {
  const base = (ATTACKS as any)[id] ?? (MOVES as any)[id]
  const def = unarmedAttack(base)
  const clip = def.clip
  const L = (def.strikeHand ?? 'right') === 'left'
  const joint = def.strikeJoint ?? 'hand'
  let best = -1e9, at = 0
  for (let i = 0; i <= 300; i++) {
    const t = (i / 300) * clip.dur
    if (t < def.hit.start || t > def.hit.end) continue
    const p = makePose(); sampleClip(clip, t, p)
    const g = makeFighterGeom(); solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade, 1)
    const j = joint === 'elbow' ? (L ? g.elbL : g.elbR)
      : joint === 'foot' ? (L ? g.ankleL : g.ankleR)
      : joint === 'knee' ? (L ? g.kneeL : g.kneeR)
      : (L ? g.handL : g.handR)
    const sh = L ? g.shoulderL : g.shoulderR
    const fwd = j.x - g.hip.x
    if (fwd > best) { best = fwd; at = t }
  }
  // re-sample at the peak instant
  const p = makePose(); sampleClip(clip, at, p)
  const g = makeFighterGeom(); solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade, 1)
  const j = joint === 'elbow' ? (L ? g.elbL : g.elbR)
    : joint === 'foot' ? (L ? g.ankleL : g.ankleR)
    : joint === 'knee' ? (L ? g.kneeL : g.kneeR)
    : (L ? g.handL : g.handR)
  const sh = L ? g.shoulderL : g.shoulderR
  return { id, joint, fwdPx: (j.x - g.hip.x) * SCALE, dyPx: (j.y - sh.y) * SCALE, at }
}
if (process.argv[1]?.includes('punch-height')) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2)
    : ['l1','l2','l3','l4','l5','h1','h3','viperPalm','ironRoot','omegaPalm','cyclone','avalancheElbow']
  console.log('id               joint   reach(px)  fist-below-shoulder(px)  at')
  for (const id of ids) {
    try { const r = h(id)
      const flag = r.joint === 'hand' && Math.abs(r.dyPx) > 18 ? '  <- NOT chin level' : ''
      console.log(r.id.padEnd(16), r.joint.padEnd(7), r.fwdPx.toFixed(1).padStart(9), r.dyPx.toFixed(1).padStart(23), ('  ' + r.at.toFixed(3)), flag)
    } catch (e: any) { console.log(id.padEnd(16), 'ERR', e.message) }
  }
}
