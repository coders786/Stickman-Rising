/** Motion-matched transition residuals, in seconds rather than rendered frames.
 * Arms travel in shoulder-relative polar hand space: a hand cannot lerp
 * through its shoulder, and a fixed-length two-link solve owns the elbow.
 * This is constrained animation, NOT a rigid-body human simulation.
 */
import {CH,CH_COUNT,makePose,type Pose} from './pose'
import {PLAYER_SPEC} from './skeleton'
import {clamp} from '../core/utils'
const ARMS=[[CH.shL,CH.elL,CH.wrL],[CH.shR,CH.elR,CH.wrR]] as const
const TAU=2*Math.PI
const near=(a:number,b:number)=>a+Math.round((b-a)/TAU)*TAU
function encode(p:Pose,out:Pose):void{
 out.set(p)
 for(const [sh,el,wr] of ARMS){
  const x=PLAYER_SPEC.upperArm*Math.sin(p[sh])+PLAYER_SPEC.foreArm*Math.sin(p[sh]+p[el])
  const y=PLAYER_SPEC.upperArm*Math.cos(p[sh])+PLAYER_SPEC.foreArm*Math.cos(p[sh]+p[el])
  out[sh]=Math.atan2(x,y);out[el]=Math.hypot(x,y)
  out[wr]=p[sh]+p[el]+p[wr] // absolute weapon/hand pitch, not an isolated wrist spin
 }
}
function decode(p:Pose):void{
 for(const [sh,el,wr] of ARMS){
  const a=PLAYER_SPEC.upperArm,b=PLAYER_SPEC.foreArm
  const min=Math.sqrt(a*a+b*b+2*a*b*Math.cos(2.62))
  const max=Math.sqrt(a*a+b*b+2*a*b*Math.cos(.26))
  const r=clamp(p[el],min,max),angle=p[sh],pitch=p[wr]
  const bend=-Math.acos(clamp((r*r-a*a-b*b)/(2*a*b),-1,1))
  p[sh]=clamp(angle+Math.acos(clamp((a*a+r*r-b*b)/(2*a*r),-1,1)),-1.05,3.05)
  p[el]=bend;p[wr]=pitch-p[sh]-p[el]
 }
}
export class InertialTransition{
 private offset=makePose();private deltaVelocity=makePose()
 private advanced=makePose();private source=makePose();private dest=makePose();private next=makePose();private work=makePose()
 age=0;duration=0;private armDuration=0
 begin(source:Pose,velocity:Pose,target:Pose,targetNext:Pose,sampleDt:number,requested:number,armLimit=Infinity):void{
  encode(source,this.source);encode(target,this.dest);encode(targetNext,this.next)
  for(let ch=0;ch<CH_COUNT;ch++)this.advanced[ch]=source[ch]+velocity[ch]*sampleDt
  encode(this.advanced,this.work)
  // A low requested crossfade is not permission to rotate a torso/arm
  // through a large angle in 18ms. Action clocks are never slowed here.
  const angular=Math.max(Math.abs(source[CH.rootRot]-target[CH.rootRot]),
   ...ARMS.map(([sh])=>Math.abs(near(this.source[sh],this.dest[sh])-this.dest[sh])))
  this.duration=requested<=0?0:clamp(Math.max(requested,.07+angular*.10),.07,.28)
  this.armDuration=Math.min(this.duration,Math.max(.015,armLimit))
  this.age=0
  for(const ch of [CH.wrL,CH.wrR,CH.shL,CH.shR]){
   this.source[ch]=near(this.source[ch],this.dest[ch])
   this.work[ch]=near(this.work[ch],this.source[ch])
   this.next[ch]=near(this.next[ch],this.dest[ch])
  }
  for(let ch=0;ch<CH_COUNT;ch++){
   const cap=ch<2||ch===CH.elL||ch===CH.elR?100:12
   this.offset[ch]=this.source[ch]-this.dest[ch]
   const v0=clamp((this.work[ch]-this.source[ch])/sampleDt,-cap,cap)
   const v1=clamp((this.next[ch]-this.dest[ch])/sampleDt,-cap,cap)
   this.deltaVelocity[ch]=v0-v1
  }
 }
 apply(target:Pose,dt:number,out:Pose):void{
  this.age+=Number.isFinite(dt)?Math.max(0,dt):0
  if(this.duration<=0||this.age>=this.duration){out.set(target);return}
  encode(target,this.dest)
  for(let ch=0;ch<CH_COUNT;ch++){
   const arm=ch>=CH.shL&&ch<=CH.wrR
   const duration=arm?this.armDuration:this.duration
   const u=Math.min(1,this.age/duration),u2=u*u,u3=u2*u,u4=u3*u,u5=u4*u
   const position=1-10*u3+15*u4-6*u5,velocity=u-6*u3+8*u4-3*u5
   this.work[ch]=this.dest[ch]+this.offset[ch]*position+this.deltaVelocity[ch]*duration*velocity
  }
  decode(this.work);out.set(this.work)
 }
 get active():boolean{return this.age<this.duration}
}
