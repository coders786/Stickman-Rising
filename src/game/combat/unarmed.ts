/** Empty-hand intent equivalents. No invisible sword, blade arc or slash AoE. */
import {keyframe,makeClip,type Clip} from '../anim/animator'
import {makePose,type PoseInput} from '../anim/pose'
import {applyJointLimits} from '../anim/limits'
import {PLAYER_SPEC} from '../anim/skeleton'
import type {AttackDef} from './attacks'
export type StrikeHand='left'|'right'
export function handPose(side:StrikeHand,x:number,y:number):PoseInput{
 const a=PLAYER_SPEC.upperArm,b=PLAYER_SPEC.foreArm,r=Math.max(12,Math.min(a+b-2,Math.hypot(x,y)))
 const sh=Math.atan2(x,y)+Math.acos(Math.max(-1,Math.min(1,(a*a+r*r-b*b)/(2*a*r))))
 const el=-Math.acos(Math.max(-1,Math.min(1,(r*r-a*a-b*b)/(2*a*b))))
 return side==='left'?{shL:sh,elL:el}:{shR:sh,elR:el}
}
const GUARD:PoseInput={rootRot:.13,spine:.035,head:-.13,rootY:3,
 hipR:.48,kneeR:-.68,footR:.12,hipL:-.38,kneeL:-.55,footL:.08,
 pelvisYaw:-.06,chestYaw:.08,...handPose('left',15,8),...handPose('right',10,10),wrL:0,wrR:0}
type Style='jab'|'cross'|'hook'|'elbow'|'palm'|'uppercut'|'hammer'
function actionClip(style:Style,hand:StrikeHand,duration:number,air=false):Clip{
 const other:StrikeHand=hand==='left'?'right':'left'
 const targets:Record<Style,[number,number]>={jab:[32,4],cross:[33,3],hook:[26,-3],elbow:[17,3],palm:[32,6],uppercut:[22,-4],hammer:[26,15]}
 const [x,y]=targets[style],sign=hand==='right'?1:-1
 const poses:PoseInput[]=[
  GUARD,
  {...GUARD,rootRot:.10,rootY:3.7,pelvisYaw:-.09*sign,chestYaw:.13*sign,
   ...handPose(hand,style==='hammer'?6:3,style==='hammer'?-6:14)},
  {...GUARD,rootRot:.19,rootY:3.3,pelvisYaw:.03*sign,chestYaw:-.02*sign,
   ...handPose(hand,x*.62,y+4),...handPose(other,12,7)},
  {...GUARD,rootX:3,rootRot:.28,rootY:3.8,spine:.045,head:-.25,
   pelvisYaw:.13*sign,chestYaw:-.10*sign,kneeR:-.78,kneeL:-.45,
   ...handPose(hand,x,y),...handPose(other,11,7)},
  {...GUARD,rootX:2,rootRot:.22,rootY:3.5,pelvisYaw:.09*sign,chestYaw:-.07*sign,
   ...handPose(hand,x*.83,y+2),...handPose(other,12,8)},
  {...GUARD,rootRot:.16,rootY:3.2,...handPose(hand,16,10)},
  GUARD,
 ]
 if(air)for(const p of poses){p.hipR=.75;p.kneeR=-1.25;p.hipL=-.25;p.kneeL=-1.1;p.rootY=-1}
 const times=[0,.16,.30,.40,.56,.78,1]
 const c=makeClip(`unarmed${style[0].toUpperCase()+style.slice(1)}${air?'Air':''}`,poses.map((p,i)=>{
  const f=keyframe(times[i]*duration,p,'inOutSine');applyJointLimits(f.p);return f
 }))
 c.interpolation='monotone';return c
}
const cache=new Map<string,AttackDef>()
export function unarmedAttack(base:AttackDef):AttackDef{
 if(base.strikeHand)return base
 const cached=cache.get(base.id);if(cached)return cached
 const id=base.id,air=base.requires==='air'
 let style:Style='palm',hand:StrikeHand='right',duration=.42
 if(id==='l1'||id==='a1'){style='jab';hand='left';duration=.30}
 else if(id==='l2'||id==='a2'||id==='riposte'){style='cross';duration=.34}
 else if(id==='l3'||id==='a3'||id==='spin'){style='hook';hand='left';duration=.38}
 else if(id==='l4'||id==='retreat'){style='elbow';duration=.38}
 else if(id==='launcher'){style='uppercut';duration=.44}
 else if(id==='h1'){style='hook';duration=.44}
 else if(id==='h2'){style='palm';duration=.46}
 else if(id==='h3'||id==='slam'||id==='dive'){style='hammer';duration=.50}
 else if(id==='charged'){style='palm';duration=.60}
 else if(id==='dashSlash'||id==='dashHeavy'){style='palm';duration=.36}
 const heavy=base.hit.heavy||base.kind==='charged',clip=actionClip(style,hand,duration,air)
 const def:AttackDef={id,label:`${heavy?'POWER ':''}${style.toUpperCase()}`,kind:base.kind,requires:base.requires,
  clip,strikeHand:hand,strikeJoint:style==='elbow'?'elbow':'hand',grip:0,chain:base.chain,cancel:duration*.70,
  hit:{start:duration*.34,end:duration*.56,dmg:heavy?22:12,stagger:heavy?.42:.2,
   kb:heavy?210:95,kbY:style==='uppercut'?-240:0,launch:style==='uppercut'?420:0,
   hitstop:heavy?.065:.035,shake:heavy?.16:.07,heavy,pad:style==='elbow'?7:5,breakGuard:heavy},
  trail:{start:duration*.34,end:duration*.56},swingSfx:{t:duration*.26,name:heavy?'swingHeavy':'swing'},
  float:air?.8:undefined,
  moveY:id==='slam'||id==='dive'?650:undefined,moveYAt:id==='slam'||id==='dive'?duration*.28:undefined}
 cache.set(base.id,def);return def
}
export const UNARMED_PARRY=makeClip('unarmedParry',[
 keyframe(0,GUARD),keyframe(.08,{...GUARD,rootY:4.2,rootRot:.09,head:-.09,
  ...handPose('left',18,4),...handPose('right',14,6)}),keyframe(.3,GUARD)])
export const UNARMED_CHARGE=makeClip('unarmedCharge',[
 keyframe(0,GUARD),keyframe(.4,{...GUARD,rootY:5,rootRot:.18,head:-.17,
  pelvisYaw:-.14,chestYaw:.12,...handPose('right',0,18),...handPose('left',17,9)}),
 keyframe(.8,{...GUARD,rootY:5.2,rootRot:.18,head:-.17,
  pelvisYaw:-.14,chestYaw:.12,...handPose('right',0,18),...handPose('left',17,9)})])
for(const c of [UNARMED_PARRY,UNARMED_CHARGE]){
 for(const f of c.frames)applyJointLimits(f.p)
 c.interpolation='monotone'
}
export const UNARMED_GUARD=makePose(GUARD)
