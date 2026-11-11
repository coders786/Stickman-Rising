/** Two equipment-specific upper-body libraries on the same physical gait.
 * Names deliberately preserve logical clip clocks/selection; equipment tags
 * distinguish the silhouettes without resetting phase or inserting steps.
 */
import type {Clip} from './animator'
import {CH} from './pose'
import {applyJointLimits} from './limits'
import {runningHandMotion,dashHandMotion} from './hand-kinematics'
import {handPose} from '../combat/unarmed'
const cache=new WeakMap<Clip,{free?:Clip;armed?:Clip}>()
export function equipmentClip(base:Clip,drawn:boolean):Clip{
 if(base.equipment||! /^(idle|walk|run|sprint|sprintDrive|jump|jumpLeap|airJump|fall|land|stop|brake|combatIdle|combatStep|backpedal|powerDash|dash\w+)$/.test(base.name))return base
 let pair=cache.get(base);if(!pair){pair={};cache.set(base,pair)}
 const key=drawn?'armed':'free';if(pair[key])return pair[key]!
 const clip:Clip={...base,equipment:key,source:base,frames:base.frames.map(f=>{
  const p=f.p.slice(),phase=f.t/base.dur,air=/jump|fall/i.test(base.name),dash=/^(?:dash|powerDash)/.test(base.name)
  const assign=(side:'left'|'right',x:number,y:number)=>{
   const q=handPose(side,x,y)
   if(side==='left'){p[CH.shL]=q.shL!;p[CH.elL]=q.elL!}
   else{p[CH.shR]=q.shR!;p[CH.elR]=q.elR!}
  }
  if(!drawn){
   if(/walk|run|sprint/.test(base.name)){
    const h=runningHandMotion(phase,/sprint/.test(base.name)?480:/run/.test(base.name)?350:100)
    assign('left',h.left.x,h.left.y);assign('right',h.right.x,h.right.y)
   }else if(air){
    assign('left',13+3*Math.sin(phase*Math.PI),18+4*phase)
    assign('right',4-8*Math.sin(phase*Math.PI),22+3*phase)
   }else if(dash){const h=dashHandMotion(base.name,phase);assign('left',h.left.x,h.left.y);assign('right',h.right.x,h.right.y)}
   else if(/combat|backpedal/.test(base.name)){assign('left',15,8);assign('right',10,10)}
   else if(/land|stop|brake/.test(base.name)){
    assign('left',12,23);assign('right',6,25)
   }
   p[CH.wrR]=dash?.12*Math.sin(phase*Math.PI*2):0;p[CH.wrL]=dash?-.16*Math.sin(phase*Math.PI):0
  }else{
   // Safe rear-up carry: weapon direction is counter-solved, independent
   // of arm pumping/air tuck. Guard modes retain a forward-up blade.
   const guard=/combat|backpedal/.test(base.name),land=/land/.test(base.name)
   if(air){assign('right',8,20);assign('left',15,18+phase*3)}
   else if(dash){const h=dashHandMotion(base.name,phase);assign('left',h.left.x,h.left.y);assign('right',-6,24)}
   else if(guard){assign('right',18,13);assign('left',12,14)}
   else if(land){assign('right',12,18)}
   else if(base.name==='walk'){assign('right',5,31)}
   else if(/run|sprint|stop|brake/.test(base.name)){assign('right',8,25)}
   if(air||dash||guard||land||/walk|run|sprint|stop|brake/.test(base.name)){
    const absolute=guard||land?2.45:4.3
    p[CH.wrR]=absolute-p[CH.shR]-p[CH.elR]
    p[CH.bladeYaw]=guard?.03:-.12
   }
  }
  applyJointLimits(p);return{...f,p}
 })}
 pair[key]=clip;return clip
}
