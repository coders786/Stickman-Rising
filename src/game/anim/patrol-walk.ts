/** Re-composed patrol walk. Original authored poses, not retargeted assets.
 * Reference principles: contact/load/pass/push, quiet head, opposed hands.
 *
 * GROUNDING: `rootY` is pelvis height ABOVE THE FLOOR, not a bob offset.
 * Each key's value is derived from its own leg pose so the stance foot lands
 * on y=0 — there is no foot IK to absorb the difference any more. If you
 * change a hip/knee/ankle angle, re-derive the matching rootY. A walk must
 * never lose both feet, so the lowest foot stays on the ground throughout.
 */
import {makeClip,keyframe} from './animator'
import {type PoseInput} from './pose'
import {PLAYER_SPEC} from './skeleton'
export function walkHandMotion(phase:number){
 const a=phase*Math.PI*2-.12
 return{left:{x:8.5*Math.cos(a),y:33+.7*Math.sin(a),roll:.065*Math.sin(a-.15),open:.24+.035*Math.sin(a)},
  right:{x:-8.5*Math.cos(a),y:33-.7*Math.sin(a),roll:-.065*Math.sin(a-.15),open:.24-.035*Math.sin(a)}}
}
function arm(x:number,y:number){
 const a=PLAYER_SPEC.upperArm,b=PLAYER_SPEC.foreArm,r=Math.min(a+b-1.5,Math.hypot(x,y))
 return{sh:Math.atan2(x,y)+Math.acos((a*a+r*r-b*b)/(2*a*r)),el:-Math.acos((r*r-a*a-b*b)/(2*a*b))}
}
const half=[
 {t:0,root:2.18,r:[.40,-.22,.19],l:[-.24,-.34,-.12]},
 {t:.06,root:0.82,r:[.28,-.37,.05],l:[-.32,-.47,-.18]},
 {t:.12,root:-0.19,r:[.14,-.28,0],l:[-.28,-.70,-.17]},
 {t:.20,root:-0.39,r:[-.07,-.20,-.04],l:[.08,-.95,.03]},
 {t:.28,root:0.54,r:[-.23,-.18,-.10],l:[.40,-.72,.14]},
 {t:.36,root:1.60,r:[-.30,-.23,-.16],l:[.49,-.40,.22]},
 {t:.44,root:2.81,r:[-.31,-.35,-.17],l:[.42,-.22,.20]},
]
const duration=1.04
export const WALK_EXPOSURES=[...half.map(q=>q.t),...half.map(q=>q.t+.5)]
const poses:PoseInput[]=WALK_EXPOSURES.map((phase,i)=>{
 const q=half[i%half.length],r=i<half.length?q.r:q.l,l=i<half.length?q.l:q.r
 const hands=walkHandMotion(phase),a=arm(hands.left.x,hands.left.y),b=arm(hands.right.x,hands.right.y)
 return{rootX:.3,rootY:q.root,rootRot:.025,spine:.012,head:-.03,
  hipR:r[0],kneeR:r[1],footR:r[2],hipL:l[0],kneeL:l[1],footL:l[2],
  shL:a.sh,elL:a.el,wrL:hands.left.roll,shR:b.sh,elR:b.el,wrR:hands.right.roll,
  pelvisYaw:.035*Math.cos(phase*Math.PI*2),chestYaw:-.045*Math.cos(phase*Math.PI*2),
  armLz:0,armRz:0,foreLz:0,foreRz:0,hipLz:0,hipRz:0,bladeYaw:0}
})
export const WALK_CLIP=makeClip('walk',[
 ...poses.map((p,i)=>keyframe(WALK_EXPOSURES[i]*duration,p,'inOutSine')),
 keyframe(duration,poses[0],'inOutSine'),
],true)
WALK_CLIP.interpolation='monotone'
