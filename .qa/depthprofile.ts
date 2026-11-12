/** Per-beat Z profile of a clip: how much depth each channel actually
 * travels, and whether the far and near ends are ever BOTH populated. */
import { MOVES } from '../src/game/combat/moveset'
import { sampleClip } from '../src/game/anim/animator'
import { solveFighter3D, makeFighterGeom } from '../src/game/anim/rig3d'
import { makePose } from '../src/game/anim/pose'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'
const ids = process.argv.slice(2)
const g = makeFighterGeom()
for (const id of ids) {
  const clip = MOVES[id].clip!
  const N = 24
  let minRoot = 1e9, maxRoot = -1e9, minHand = 1e9, maxHand = -1e9, minFoot = 1e9, maxFoot = -1e9
  const rows: any[] = []
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * clip.dur
    const p = makePose(); sampleClip(clip, t, p)
    solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade * 1.06, 1)
    const hz = Math.max(Math.abs(g.handR.z), Math.abs(g.handL.z)) * Math.sign(g.handR.z||1), fz = Math.max(Math.abs(g.ankleR.z), Math.abs(g.ankleL.z)) * Math.sign(g.ankleR.z||1)
    minRoot = Math.min(minRoot, g.hip.z); maxRoot = Math.max(maxRoot, g.hip.z)
    minHand = Math.min(minHand, hz); maxHand = Math.max(maxHand, hz)
    minFoot = Math.min(minFoot, fz); maxFoot = Math.max(maxFoot, fz)
    rows.push({ t, hip: g.hip.z, hand: hz, foot: fz })
  }
  console.log(`\n${id}  dur ${clip.dur}`)
  console.log(`  hipZ  ${minRoot.toFixed(1)} .. ${maxRoot.toFixed(1)}  (travel ${(maxRoot-minRoot).toFixed(1)})`)
  console.log(`  handZ ${minHand.toFixed(1)} .. ${maxHand.toFixed(1)}  (travel ${(maxHand-minHand).toFixed(1)})`)
  console.log(`  footZ ${minFoot.toFixed(1)} .. ${maxFoot.toFixed(1)}  (travel ${(maxFoot-minFoot).toFixed(1)})`)
  // separation: is anything ever in FRONT of something else in a readable way?
  const sep = rows.map(r => Math.max(Math.abs(r.hand - r.hip), Math.abs(r.hand - r.foot), Math.abs(r.foot - r.hip)))
  console.log(`  max separation at any beat: ${Math.max(...sep).toFixed(1)}`)
  const spread = Math.max(maxHand, maxFoot, maxRoot) - Math.min(minHand, minFoot, minRoot)
  console.log(`  SPAN ${spread.toFixed(1)}`)
}
