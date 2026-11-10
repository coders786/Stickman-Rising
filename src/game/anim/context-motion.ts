/** Reference-informed conditional pose choreography. Deterministic, bounded,
 * blended BEFORE anatomical/weapon/contact solvers; never edits blade channels. */
import {CH,CH_COUNT,type Pose} from './pose'
import {clamp,clamp01,damp} from '../core/utils'
import {PLAYER_SPEC} from './skeleton'
import {runningHandMotion} from './hand-kinematics'
import type {HandGestures} from './hand-gestures'

export interface MotionContext {
  state:string; clip:string; phase:number; speed:number; forward:number;
  acceleration:number; threat:number; surrounded:boolean; health:number;
  grounded:boolean; vy:number; swordDrawn:boolean; entrySpeed:number;
  landingImpact:number; counter:boolean; attackKind:string; dashVariant:string;
}
export const DEFAULT_CONTEXT:MotionContext={state:'move',clip:'idle',phase:0,speed:0,forward:0,
 acceleration:0,threat:0,surrounded:false,health:1,grounded:true,vy:0,swordDrawn:false,
 entrySpeed:0,landingImpact:0,counter:false,attackKind:'light',dashVariant:'launch'}
export function selectMotionVariation(c:MotionContext):string {
 const injured=c.health<.35,pressure=c.surrounded?'surrounded':c.threat>.55?'guarded':'open'
 if(c.state==='dead')return c.grounded?'fallen':'airborne-fall'
 if(c.state==='hurt')return c.grounded?(injured?'wounded-stagger':'recoil'):'airborne-recoil'
 if(c.state==='dash')return `dash-${c.dashVariant}-${injured?'protected':c.swordDrawn?'armed':'free'}`
 if(c.state==='attack')return `${c.attackKind}-${c.counter?'counter':!c.grounded?'airborne':c.speed>250?'pursuit':pressure}`
 if(c.state==='parry')return c.surrounded?'parry-enclosed':c.threat>.55?'parry-contact':'parry-ready'
 if(c.state==='charge')return c.surrounded?'charge-braced':c.threat>.55?'charge-guarded':'charge-centered'
 if(c.state==='scripted')return c.surrounded?'technique-crowd':'technique-focused'
 if(/flourish|sheathe|draw/i.test(c.clip))return `ritual-${c.threat>.4?'alert':'relaxed'}`
 if(/stop|brake/i.test(c.clip))return `${c.entrySpeed>300?'skid':'soft-stop'}-${injured?'protected':pressure}`
 if(/land/i.test(c.clip))return c.landingImpact>700?'hard-landing':c.speed>220?'rolling-landing':'soft-landing'
 if(!c.grounded)return c.vy>350?'fall-brace':c.vy>=-100?'apex-balance':c.speed>250?'travel-tuck':'vertical-rise'
 if(injured)return c.speed>36?'wounded-travel':'wounded-rest'
 if(c.speed<36)return `rest-${pressure}`
 if(c.forward< -40)return `retreat-${pressure}`
 if(c.threat>.55&&c.speed<300)return `combat-${c.surrounded?'enclosed':'advance'}`
 if(c.speed<210)return c.threat>.25?'cautious-patrol':'patrol'
 return `${c.speed>400?'sprint':'run'}-${c.acceleration>650?'drive':'cruise'}-${c.swordDrawn?'armed':'free'}`
}
export {referenceHandArc} from './hand-kinematics'
function handTarget(out:Float32Array,side:'L'|'R',x:number,y:number):void {
 const u=PLAYER_SPEC.upperArm,f=PLAYER_SPEC.foreArm
 const r=clamp(Math.hypot(x,y),12,u+f-2),a=Math.acos(clamp((u*u+r*r-f*f)/(2*u*r),-1,1))
 out[side==='L'?CH.shL:CH.shR]=Math.atan2(x,y)+a
 out[side==='L'?CH.elL:CH.elR]=-(Math.PI-Math.acos(clamp((u*u+f*f-r*r)/(2*u*f),-1,1)))
}
export class ContextMotion {
  variation='rest-open'
  private offsets=new Float32Array(CH_COUNT)
  private targets=new Float32Array(CH_COUNT)
  private scratch=new Float32Array(CH_COUNT)
  private injury=0
  private guard=0
  reset():void{this.offsets.fill(0);this.targets.fill(0);this.injury=0;this.guard=0}
  apply(p:Pose,c:MotionContext,dt:number):void {
    this.variation=selectMotionVariation(c)
    const step=Number.isFinite(dt)?clamp(dt,0,.1):0
    this.injury=damp(this.injury,clamp01((.45-c.health)/.3),10,step)
    this.guard=damp(this.guard,clamp01(c.threat+(c.surrounded?.2:0)),10,step)
    const d=this.targets;d.fill(0)
    const phase=clamp01(c.phase),hands=runningHandMotion(phase,c.clip==='walk'?100:c.speed),beat=Math.sin(phase*Math.PI)
    const injury=this.injury,guard=this.guard
    const ritual=/flourish|sheathe|draw/i.test(c.clip)
    const stopping=/stop|brake/i.test(c.clip),landing=/land/i.test(c.clip)
    if(c.state==='move' && !ritual){
      if(stopping){
        const severity=clamp01(c.entrySpeed/480)
        d[CH.rootY]=beat*severity*1.1;d[CH.head]=-.025*beat*severity
        d[CH.elL]=-(.1*severity+.08*injury)*beat
      }else if(landing){
        const severity=clamp01(c.landingImpact/1000)
        const travel=clamp01(c.speed/480)
        d[CH.rootY]=severity*beat*1.8*(1-travel*.3);d[CH.elL]=-(.12*severity+.08*travel)*beat
        d[CH.rootRot]=travel*.025*beat;d[CH.head]=-travel*.025*beat
      }else if(!c.grounded){
        const fall=clamp01(c.vy/900),travel=clamp01(c.speed/480)
        d[CH.head]=-.035*fall;d[CH.shL]=.12*travel-.10*fall;d[CH.elL]=-.14*fall
      }else{
        const running=clamp01((c.speed-150)/130),drive=clamp01(c.acceleration/2400)
        // Reference runner: stable core/head and compact opposed hand arcs.
        const front=guard*4
        const protect=injury*.65
        const x=(front+hands.left.x)*(1-protect)+4*protect
        const y=(hands.left.y-3*guard)*(1-protect)+20*protect
        handTarget(this.scratch,'L',x,y)
        const w=c.speed>210?.9:c.speed>36?.68:guard*.5+injury*.45
        d[CH.shL]=(this.scratch[CH.shL]-p[CH.shL])*w
        d[CH.elL]=(this.scratch[CH.elL]-p[CH.elL])*w
        if(!c.swordDrawn&&c.speed>210){
          handTarget(this.scratch,'R',hands.right.x,hands.right.y)
          d[CH.shR]=(this.scratch[CH.shR]-p[CH.shR])*.96
          d[CH.elR]=(this.scratch[CH.elR]-p[CH.elR])*.96
        }
        d[CH.rootRot]=drive*running*.035+guard*.018
        d[CH.head]=-d[CH.rootRot]-.03*injury
        d[CH.rootY]=guard*.45+injury*.55
        // Hurt posture protects the ribs; it doesn't invent a new leg cadence.
        d[CH.chestYaw]=injury*.025
      }
    }else if(c.state==='dash'){
      d[CH.elL]=-.08*injury*beat;d[CH.head]=-.025*injury
    }else if(c.state==='attack'){
      // Leave right arm + weapon path intact. Counter/pressure reads in gaze
      // and off-hand gathering; two-hand grip IK still has final authority.
      d[CH.head]=(c.counter?-.045:-.018*guard)*beat
      d[CH.elL]=-(c.counter?.13:.08*guard)*beat
      d[CH.armLz]=c.surrounded?-.035*beat:0
    }else if(c.state==='parry'||c.state==='charge'){
      d[CH.rootY]=guard*.65;d[CH.head]=-.04*guard;d[CH.elL]=-.12*guard
    }else if(c.state==='hurt'){
      d[CH.head]=.05*injury*beat;d[CH.elL]=-.12*injury
    }else if(c.state==='dead'){
      d[CH.head]=c.grounded?.025: -.025
    }else if(c.state==='scripted'){
      d[CH.head]=c.surrounded?-.035:0;d[CH.armLz]=-.025*guard
    }else if(ritual){d[CH.head]=-.035*guard}
    // Bounded filter is shared at 30/60/120 Hz. No stochastic variant flicker.
    for(let ch=0;ch<CH_COUNT;ch++){
      // Free sword-side arm must escape its low weapon-carry base; the
      // old uniform .85 cap kept its forward fist down at the hip.
      const cap=ch<2?2:ch===CH.shR?1.65:ch===CH.shL||ch===CH.elL||ch===CH.elR?.9:.1
      this.offsets[ch]=damp(this.offsets[ch],clamp(d[ch],-cap,cap),18,step)
      // Never leak free-running right-arm offsets into an attack/drawn grip.
      if((ch===CH.shR||ch===CH.elR)&&(c.state!=='move'||c.swordDrawn))continue
      p[ch]+=this.offsets[ch]
    }
  }
  /** Exact sprint key silhouette, composed AFTER continuous tracking. A
   * double filter on these arms used to lag them ~quarter of a stride. */
  composeSprintArms(p:Pose,c:MotionContext):void{
    if(c.state!=='move'||!c.grounded||!/^sprint/.test(c.clip))return
    const h=runningHandMotion(c.phase,c.speed),protect=this.injury*.65
    handTarget(this.scratch,'L',(h.left.x+this.guard*4)*(1-protect)+4*protect,
      (h.left.y-this.guard*3)*(1-protect)+20*protect)
    p[CH.shL]=this.scratch[CH.shL];p[CH.elL]=this.scratch[CH.elL]
    if(!c.swordDrawn){
      handTarget(this.scratch,'R',h.right.x,h.right.y)
      p[CH.shR]=this.scratch[CH.shR];p[CH.elR]=this.scratch[CH.elR]
    }
  }
  hands(base:HandGestures,c:MotionContext):HandGestures {
    const closed=clamp01(this.guard*.6+this.injury*.45)
    return {...base,leftOpen:base.leftOpen*(1-closed),leftRoll:base.leftRoll*(1-this.injury*.5),
      rightOpen:c.swordDrawn?0:base.rightOpen}
  }
}
