import {walkHandMotion} from './patrol-walk'
/** Shared hand-space choreography for arm targets AND wrist/finger rendering. */
import {clamp01} from '../core/utils'
// Twelve phase landmarks: quick forward recovery, compact front reversal,
// then a longer downward/back drive. Not a per-frame sine or random offset.
// Shape-preserving periodic Hermite creates C1 in-betweens at any render Hz.
const ARC_X=[15,14,9,1,-7,-13,-14,-11,-5,2,10,14]
const ARC_Y=[19,18,20,23,27,30,30,28,25,22,20,19]
function arcChannel(values:readonly number[],phase:number):number{
 const scaled=((phase%1+1)%1)*values.length,i=Math.floor(scaled),t=scaled-i
 const a=values[(i+values.length-1)%values.length],b=values[i],c=values[(i+1)%values.length],d=values[(i+2)%values.length]
 const tangent=(u:number,v:number)=>u*v<=0?0:2*u*v/(u+v)
 const m=tangent(b-a,c-b),n=tangent(c-b,d-c),t2=t*t,t3=t2*t
 return (2*t3-3*t2+1)*b+(t3-2*t2+t)*m+(-2*t3+3*t2)*c+(t3-t2)*n
}
export function referenceHandArc(phase:number):{x:number;y:number}{
 const t=Number.isFinite(phase)?phase:0
 return {x:arcChannel(ARC_X,t),y:arcChannel(ARC_Y,t)}
}
// Re-composed sprint path: rib-height punch, elbow-driven down/back sweep,
// longer open rear arm, then compact recovery. Ten phase landmarks are NOT
// ten steps or a one-second gait: actual stride phase still follows distance.
export const SPRINT_HAND_X=[15,17,10,0,-11,-16,-14,-4,7,13] as const
export const SPRINT_HAND_Y=[17,18,21,25,29,30,27,23,20,18] as const
export function sprintHandArc(phase:number){
 const t=Number.isFinite(phase)?phase:0
 return{x:arcChannel(SPRINT_HAND_X,t),y:arcChannel(SPRINT_HAND_Y,t)}
}
/** Opposed arm pumping with a soft wrist lag and loosely curled fingers.
 * This is an athletic hand path, not a rigid both-arms-back Naruto pose. */
export function runningHandMotion(phase:number,speed:number){
 if(speed<=150)return walkHandMotion(phase)
 const run=clamp01((speed-150)/130),sprint=clamp01((speed-350)/130)
 const a=referenceHandArc(phase),b=referenceHandArc(phase+.5)
 const lagA=referenceHandArc(phase-.035),lagB=referenceHandArc(phase+.465)
 const amp=6+7*run+2*sprint,y=32-7*run
 const sa=sprintHandArc(phase),sb=sprintHandArc(phase+.5)
 const sla=sprintHandArc(phase-.04),slb=sprintHandArc(phase+.46)
 const mix=(a:number,b:number)=>a+(b-a)*sprint
 return {
  left:{x:mix(2*run+amp*a.x/13,sa.x),y:mix(y+run*(a.y-25),sa.y),
    roll:mix(lagA.x/13*.10,sla.x/17*.09),
    open:mix(.22+.07*(1-Math.abs(lagA.x)/13),.22+.12*clamp01((17-sla.x)/34))},
  right:{x:mix(1+amp*b.x/13,sb.x),y:mix(y+run*(b.y-25),sb.y),
    roll:mix(lagB.x/13*.10,slb.x/17*.09),
    open:mix(.22+.07*(1-Math.abs(lagB.x)/13),.22+.12*clamp01((17-slb.x)/34))},
 }
}

/** Anime load/stream/catch hand paths. Forearm targets, not shoulder spins. */
export function dashHandMotion(clip:string,phase:number){
 const t=clamp01(phase),times=[0,.10,.35,.68,1]
 const lx=[9,2,-18,-10,13],ly=[18,23,24,27,20]
 const rx=[6,0,-12,-6,9],ry=[21,25,27,28,23]
 let i=0;while(i<3&&t>times[i+1])i++
 let u=clamp01((t-times[i])/(times[i+1]-times[i]));u=u*u*(3-2*u)
 const at=(a:number[])=>a[i]+(a[i+1]-a[i])*u
 const left={x:at(lx),y:at(ly)},right={x:at(rx),y:at(ry)}
 const guard=Math.sin(Math.PI*t)
 if(/retreat|vault/i.test(clip)){left.x+=22*guard;left.y-=12*guard}
 if(/carve/i.test(clip)){left.x+=25*guard;left.y-=14*guard}
 return{left,right}
}
