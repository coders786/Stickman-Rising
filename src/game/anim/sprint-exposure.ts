/** Limited-animation exposure clock. Articulation samples at 10 Hz in
 * simulation seconds; root travel, gait planner, weapon/contact IK stay live.
 * No dependence on render FPS or clip playback speed. */
import {CH,makePose,type Pose} from './pose'
import type {HandGestures} from './hand-gestures'
export const SPRINT_POSE_HZ=10
export const SPRINT_EXPOSURE_CHANNELS=[CH.rootRot,CH.spine,CH.head,CH.shL,CH.elL,CH.wrL,
 CH.shR,CH.elR,CH.wrR,CH.chestYaw,CH.armLz,CH.armRz,CH.foreLz,CH.foreRz] as const
export class SprintExposure {
 active=false
 frame=0
 phase=0
 private time=0
 private ready=false
 private held=makePose()
 hands:HandGestures={leftOpen:.22,rightOpen:0,leftRoll:0,rightRoll:0}
 reset():void{this.active=false;this.ready=false;this.time=0;this.frame=0;this.phase=0}
 apply(pose:Pose,hands:HandGestures,phase:number,dt:number,active:boolean):void{
  if(!active){this.reset();return}
  this.active=true
  if(this.ready)this.time+=Number.isFinite(dt)?Math.max(0,dt):0
  const frame=Math.floor((this.time+1e-8)*SPRINT_POSE_HZ)
  if(!this.ready||frame!==this.frame){
    this.held.set(pose);Object.assign(this.hands,hands)
    this.phase=phase;this.frame=frame;this.ready=true
  }
  for(const ch of SPRINT_EXPOSURE_CHANNELS)pose[ch]=this.held[ch]
 }
}
