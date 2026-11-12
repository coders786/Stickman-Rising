/** At the CONTACT beat, is the sword arm EXTENDED toward the target?
 * Reports shR/elR and the resulting tip X offset from the player. */
import { ATTACKS } from '../src/game/combat/attacks'
import { CH } from '../src/game/anim/pose'
import { solveFighter3D, makeFighterGeom } from '../src/game/anim/rig3d'
import { makePose } from '../src/game/anim/pose'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'
import { sampleClip } from '../src/game/anim/animator'
const g = makeFighterGeom()
console.log('attack        shR    elR    tipX   armExt')
for (const id of ['l1','l4','axeKick','cyclone','ironRoot','srOneslaught','stepKick','spinHook','srOnslaught','viperPalm','ultPalm']) {
  const d = (ATTACKS as any)[id]
  if (!d?.clip) { console.log(id, 'missing'); continue }
  const tc = d.hit.start + (d.hit.end - d.hit.start) * 0.5
  const p = makePose()
  sampleClip(d.clip, tc, p)
  solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade * 1.06, 1)
  const sh = p[CH.shR], el = p[CH.elR]
  console.log(id.padEnd(13), sh.toFixed(2).padStart(6), el.toFixed(2).padStart(6),
    (g.tip.x).toFixed(0).padStart(6), (sh + el).toFixed(2).padStart(7))
}
