/** THE REAL QUESTION for hand-to-hand: does the limb that is DRAWN striking
 * actually reach the body, at the moment the hit window is open?
 *
 * Reads the same resolved limb the engine hits with (strikeHand +
 * strikeJoint), converts to world px through the same SCALE/face/hipY
 * transform player.ts uses, and reports the maximum forward reach attained
 * inside each attack's hit window.
 */
import { ATTACKS } from '../src/game/combat/attacks'
import { MOVES } from '../src/game/combat/moveset'
import { unarmedAttack } from '../src/game/combat/unarmed'
import { sampleClip } from '../src/game/anim/animator'
import { makeFighterGeom, solveFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'
import { makePose } from '../src/game/anim/pose'

const SCALE = 1.32        // player.ts render scale
const BODY_HALF = 11      // grunt torso half-width
export function probe(id: string) {
  const base = (ATTACKS as any)[id] ?? (MOVES as any)[id]
  if (!base) return null
  const def = unarmedAttack(base)
  const clip = def.clip
  const hand = (def.strikeHand ?? 'right') as 'left' | 'right'
  const joint = (def.strikeJoint ?? 'hand') as string
  const L = hand === 'left'
  let best = -999, bestT = 0, reachAtWin = -999
  const N = 240
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * clip.dur
    const p = makePose(); sampleClip(clip, t, p)
    const g = makeFighterGeom(); solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade, 1)
    const j = joint === 'elbow' ? (L ? g.elbL : g.elbR)
      : joint === 'foot' ? (L ? g.ankleL : g.ankleR)
      : joint === 'knee' ? (L ? g.kneeL : g.kneeR)
      : joint === 'shoulder' ? (L ? g.shoulderL : g.shoulderR)
      : (L ? g.handL : g.handR)
    // world forward reach from the body CENTRE (world x), the same axis the
    // enemy distance is measured on
    const fwd = (g.hip.x + j.x) * SCALE
    const inWin = t >= def.hit.start && t <= def.hit.end
    if (inWin && fwd > reachAtWin) { reachAtWin = fwd; bestT = t }
    if (fwd > best) best = fwd
  }
  return { id, hand, joint, reach: reachAtWin, peak: best, t: bestT, window: `${def.hit.start}-${def.hit.end}` }
}

if (process.argv[1]?.includes('limb-probe')) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MOVES)
  console.log('id                limb   joint     reach@window  peak   window')
  for (const id of ids) {
    const r = probe(id)
    if (!r) { console.log(id.padEnd(17), 'MISSING'); continue }
    const ok = r.reach >= 34 + BODY_HALF ? 'ok' : r.reach >= 34 ? 'marginal' : 'SHORT'
    console.log(id.padEnd(17), r.hand.padEnd(6), r.joint.padEnd(9),
      r.reach.toFixed(1).padStart(11), r.peak.toFixed(1).padStart(7), '  ', r.window, ' ', ok)
  }
}
