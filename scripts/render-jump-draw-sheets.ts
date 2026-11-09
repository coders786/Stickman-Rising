/** Reproducible sprite studies: AI concepts, observed video frames, actual rig. */
import {createCanvas,loadImage} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import * as C from '../src/game/anim/clips'
import {Animator,sampleClip,type Clip} from '../src/game/anim/animator'
import {makePose,type Pose} from '../src/game/anim/pose'
import {applyJointLimits} from '../src/game/anim/limits'
import {solveFighter3D,makeFighterGeom,drawFighter3D} from '../src/game/anim/rig3d'
import {PLAYER_SPEC,PLAYER_STYLE} from '../src/game/anim/skeleton'
import {handGestures} from '../src/game/anim/hand-gestures'
const W=2000,H=1450
function base(title:string,sub:string){
 const c=createCanvas(W,H),x=c.getContext('2d');x.fillStyle='#dce3e8';x.fillRect(0,0,W,H)
 x.fillStyle='#182b3d';x.font='bold 33px sans-serif';x.fillText(title,35,48)
 x.font='20px sans-serif';x.fillText(sub,35,84);return{c,x}
}
function row(x:ReturnType<typeof base>['x'],top:number,label:string,poses:Pose[],clip:string){
 x.fillStyle='#182b3d';x.font='20px sans-serif';x.fillText(label,35,top+20)
 poses.forEach((p,i)=>{
  const px=150+i*282,y=top+157
  applyJointLimits(p);const g=solveFighter3D(p,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
  x.strokeStyle='#afbdc8';x.beginPath();x.moveTo(px-95,top+270);x.lineTo(px+95,top+270);x.stroke()
  x.save();x.translate(px,y);x.scale(2.0,2.0)
  drawFighter3D(x as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{hands:handGestures(clip,i/6,true)})
  // Study overlay uses solved weapon endpoints; gameplay uses full sword shader.
  const visible=clip==='draw'?i/6*C.DRAW_CLIP.dur>=.12:clip==='sheathe'?i/6*C.SHEATHE_CLIP.dur<.42:true
  if(visible){
    x.strokeStyle='#536b7e';x.lineWidth=1.7;x.beginPath()
    x.moveTo(g.grip.x,g.grip.y);x.lineTo(g.tip.x,g.tip.y);x.stroke()
    x.strokeStyle='#172637';x.lineWidth=2.4;x.beginPath()
    x.moveTo(g.pommel.x,g.pommel.y);x.lineTo(g.grip.x,g.grip.y);x.stroke()
  }
  x.restore();x.fillStyle='#182b3d' ;x.font='17px sans-serif';x.fillText(`${Math.round(i/6*100)}%`,px-22,top+300)
 })
}
function samples(c:Clip){return Array.from({length:7},(_,i)=>sampleClip(c,c.dur*i/6,makePose()))}
function bridge(from:Clip,to:Clip){const a=new Animator();a.play(from,{blend:0});a.update(from.dur*.65);const poses=[a.pose.slice()];a.play(to,{blend:.12});for(let i=0;i<6;i++){a.update(.02);poses.push(a.pose.slice())}return poses}
async function main(){
 {
 const {c,x}=base('01 / JUMP ARC + LANDING SPRITES','Actual production rig / seven samples per row / pre-contact targets, not a replacement physics arc')
 const im=await loadImage('research/jump-draw-assets/ai-key.jpg');x.drawImage(im,40,110,550,320)
 x.fillStyle='#182b3d';x.font='22px sans-serif';x.fillText('AI silhouette concept / not mocap or anatomy evidence',650,160)
 for(const [i,t] of ['KEEP: compact hands, opposed knees, readable air space.','ADAPT: no giant split, no rigid double-arm throw.','CONTACT: first touch -> 45ms compression -> rebound.','Input and jump velocity remain immediate; no control delay.'].entries())x.fillText(t,650,215+i*45)
 row(x,450,'STANDING / drive -> passing knee -> tucked apex',samples(C.JUMP_CLIP),'jump')
 row(x,775,'RUNNING LEAP / supported lean -> passing leg -> recovery',samples(C.JUMP_LEAP_CLIP),'jumpLeap')
 row(x,1100,'LAND / touch -> compression -> rebound -> recover',samples(C.LAND_CLIP),'land')
 writeFileSync('research/jump-sheet-01-air.png',c.toBuffer('image/png'))
 }
 {
 const {c,x}=base('02 / SWORD DRAW + SHEATHE SPRITES','AI concept + actual rig / sayabiki-inspired off-hand retraction / continuous short wrist arc')
 const im=await loadImage('research/jump-draw-assets/ai-draw.jpg');x.drawImage(im,40,110,550,320)
 x.fillStyle='#182b3d';x.font='22px sans-serif'
 for(const [i,t] of ['AI concept / use the opposition of sword and saya hands.','Reject its huge stance and any floating/disconnected blade.','Draw: rest -> grip -> extraction -> release -> follow-through.','Steel visibility gates at 120ms; interruption stays immediate.'].entries())x.fillText(t,650,155+i*52)
 row(x,450,'DRAW / 0-300ms / new 105ms extraction + 215ms follow-through',samples(C.DRAW_CLIP),'draw')
 row(x,775,'SHEATHE / present -> meet -> home / 0-850ms',samples(C.SHEATHE_CLIP),'sheathe')
 row(x,1100,'DRAW TO GUARD / true transition samples, not duplicated sprites',bridge(C.DRAW_CLIP,C.COMBAT_IDLE_CLIP),'combatIdle')
 writeFileSync('research/jump-sheet-02-sword.png',c.toBuffer('image/png'))
 }
 {
 const {c,x}=base('03 / VIDEO OBSERVATION + SWITCHING IN-BETWEENS','Actual decoded source footage above / actual animator transition samples below / never AI-labelled as video')
 const im=await loadImage('research/jump-draw-assets/video-observation.jpg');x.drawImage(im,40,110,1000,296)
 x.fillStyle='#182b3d';x.font='21px sans-serif'
 for(const [i,t] of ['Runner source: 2.0-2.5s / 3-frame intervals.','Observe quiet head/core and bent passing limbs.','NOT a jumping or katana demonstration.','Action evidence: rebuilt gameplay capture.','Three non-endpoint samples for every clip switch.'].entries())x.fillText(t,1100,160+i*45)
 row(x,450,'RUN -> JUMP LEAP / 0-120ms bridge',bridge(C.RUN_CLIP,C.JUMP_LEAP_CLIP),'jumpLeap')
 row(x,775,'FALL -> LAND / contact pose before compression',bridge(C.FALL_CLIP,C.LAND_CLIP),'land')
 row(x,1100,'DRAW -> DASH / interrupt from current pose, no reset to idle',bridge(C.DRAW_CLIP,C.DASH_LAUNCH_CLIP),'dashLaunch')
 writeFileSync('research/jump-sheet-03-switches.png',c.toBuffer('image/png'))
 }
}
main().catch(e=>{console.error(e);process.exitCode=1})
