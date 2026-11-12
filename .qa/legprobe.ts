/** Projected hip->knee->ankle in world units for a kick pose, so "folded
 * shin" can be measured instead of eyeballed. */
import { kickExtend, footAt } from '../src/game/combat/fullbody'
import { makePose, CH } from '../src/game/anim/pose'
import { solveFighter3D, makeFighterGeom } from '../src/game/anim/rig3d'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'
const g=makeFighterGeom(), S=1.32
console.log('fwd  up  | thigh  shin  fold(deg)  ankle.x  ankle.z')
for(const [fwd,up] of [[40,-26],[42,-28],[44,-27],[45,-25],[46,-26],[47,-28],[43,-29]] as [number,number][]){
  const p=makePose()
  const ext:any = kickExtend('right', fwd, up)
  for(const k of Object.keys(ext)) if(k in CH) (p as any)[(CH as any)[k]] = ext[k]
  solveFighter3D(p,PLAYER_SPEC,g,PLAYER_SPEC.blade*1.06,1)
  const h=g.hipPtR, k=g.kneeR, a=g.ankleR
  const th=Math.hypot(k.x-h.x,k.y-h.y,k.z-h.z), sn=Math.hypot(a.x-k.x,a.y-k.y,a.z-k.z)
  // fold = angle between thigh and shin; 180 = straight leg
  const dot=((k.x-h.x)*(a.x-k.x)+(k.y-h.y)*(a.y-k.y)+(k.z-h.z)*(a.z-k.z))/(th*sn)
  console.log(String(fwd).padStart(3),String(up).padStart(4),'|',
    (th*S).toFixed(1).padStart(5),(sn*S).toFixed(1).padStart(5),
    (Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI).toFixed(0).padStart(9),
    ((a.x-g.hip.x)*S).toFixed(1).padStart(8), a.z.toFixed(1).padStart(7))
}
