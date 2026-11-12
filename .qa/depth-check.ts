/** DEPTH METER — how much of the Z axis does a clip use?
 * The rig is a real 3D projection, so every joint has a z. A clip that
 * never touches z is a flat 2D drawing of a 3D skeleton. */
import { MOVES } from '../src/game/combat/moveset'
import { sampleClip } from '../src/game/anim/animator'
import { makePose, CH } from '../src/game/anim/pose'
import { solveFighter3D, makeFighterGeom } from '../src/game/anim/rig3d'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'
const g = makeFighterGeom()
const CORE = ['l1','l2','l3','l4','l5','h1','h2','h3','retreat','dashSlash','riposte','charged']
const ZCH: (keyof typeof CH)[] = ['rootZ','hipLz','hipRz','armLz','armRz','foreLz','foreRz']
console.log('move       ' + ZCH.map(c=>c.padStart(7)).join('') + '   | hipZ  handZ  footZ | span')
for (const id of CORE) {
  const m = (MOVES as Record<string, any>)[id]; if (!m?.clip) continue
  const c = m.clip
  const chan: number[] = ZCH.map(ch => {
    let lo = Infinity, hi = -Infinity
    for (const f of c.frames) { const v = f.p[CH[ch]]; if (v<lo) lo=v; if (v>hi) hi=v }
    return hi - lo
  })
  // projected depth spread of the actual skeleton
  let hipZlo=1e9,hipZhi=-1e9,handZlo=1e9,handZhi=-1e9,footZlo=1e9,footZhi=-1e9
  for (let i=0;i<=60;i++){
    const p=makePose(); sampleClip(c,(i/60)*c.dur,p)
    solveFighter3D(p,PLAYER_SPEC,g,PLAYER_SPEC.blade*1.06,1)
    hipZlo=Math.min(hipZlo,g.hip.z);hipZhi=Math.max(hipZhi,g.hip.z)
    for(const h of [g.handL,g.handR]){handZlo=Math.min(handZlo,h.z);handZhi=Math.max(handZhi,h.z)}
    for(const f of [g.ankleL,g.ankleR]){footZlo=Math.min(footZlo,f.z);footZhi=Math.max(footZhi,f.z)}
  }
  const span=(hipZhi-hipZlo)+(handZhi-handZlo)+(footZhi-footZlo)
  console.log(id.padEnd(11)+chan.map(v=>v.toFixed(2).padStart(7)).join('')+
    '   |'+(hipZhi-hipZlo).toFixed(1).padStart(6)+(handZhi-handZlo).toFixed(1).padStart(7)+(footZhi-footZlo).toFixed(1).padStart(7)+
    ' |'+span.toFixed(1).padStart(6))
}
