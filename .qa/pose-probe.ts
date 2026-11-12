/** Print the real world-space joints of one clip at one instant, so a pose
 * can be compared to a reference sheet numerically instead of by eye. */
import { ATTACKS } from '../src/game/combat/attacks'
import { MOVES } from '../src/game/combat/moveset'
import { sampleClip } from '../src/game/anim/animator'
import { makeFighterGeom, solveFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'
import { makePose } from '../src/game/anim/pose'

const id = process.argv[2] ?? 'l1'
const t = Number(process.argv[3] ?? 0.145)
const def = (ATTACKS as any)[id] ?? (MOVES as any)[id]
const clip = def.clip ?? def
const p = makePose(); sampleClip(clip, t, p)
const g = makeFighterGeom()
solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade, 1)
const f = (v: number) => v.toFixed(1).padStart(7)
console.log(`CLIP ${id}  t=${t}  dur=${clip.dur}`)
console.log(' handR', f(g.handR.x), f(g.handR.y), ' handL', f(g.handL.x), f(g.handL.y))
console.log(' elbR ', f(g.elbR.x), f(g.elbR.y), ' elbL ', f(g.elbL.x), f(g.elbL.y))
console.log(' footR', f(g.ankleR.x), f(g.ankleR.y), ' footL', f(g.ankleL.x), f(g.ankleL.y))
console.log(' hip  ', f(g.hip.x), f(g.hip.y), ' head ', f(g.headC.x), f(g.headC.y))
console.log(' STANCE WIDTH (footR.x - footL.x):', (g.ankleR.x - g.ankleL.x).toFixed(1),
  ' PUNCH DY (hand.y - shoulder.y):', (g.handR.y - g.shoulderR.y).toFixed(1),
  ' FIST FORWARD:', (g.handR.x - g.hip.x).toFixed(1))
