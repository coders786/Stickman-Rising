/** Actual game rig exposures used beneath the reference-sheet annotations. */
import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {SPRINT_CLIP} from '../src/game/anim/clips'
import {sampleClip} from '../src/game/anim/animator'
import {makePose} from '../src/game/anim/pose'
import {ContextMotion,DEFAULT_CONTEXT} from '../src/game/anim/context-motion'
import {handGestures} from '../src/game/anim/hand-gestures'
import {applyJointLimits} from '../src/game/anim/limits'
import {solveFighter3D,makeFighterGeom,drawFighter3D} from '../src/game/anim/rig3d'
import {drawArticulatedHand} from '../src/game/anim/humanoid'
import {PLAYER_SPEC,PLAYER_STYLE} from '../src/game/anim/skeleton'
const canvas=createCanvas(2000,850),ctx=canvas.getContext('2d')
ctx.fillStyle='#dce3e8';ctx.fillRect(0,0,2000,850)
for(let i=0;i<5;i++){
 const time=i*.1,phase=(time*480/220)%1,layer=new ContextMotion()
 const c={...DEFAULT_CONTEXT,clip:'sprint',phase,speed:480,forward:480}
 let pose=makePose()
 for(let j=0;j<120;j++){pose=sampleClip(SPRINT_CLIP,phase*SPRINT_CLIP.dur,makePose());layer.apply(pose,c,1/120)}
 layer.composeSprintArms(pose,c)
 applyJointLimits(pose)
 const g=solveFighter3D(pose,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
 const hands=layer.hands(handGestures('sprint',phase,false),c)
 ctx.save();ctx.beginPath();ctx.rect(i*400,0,400,450);ctx.clip();ctx.translate(i*400+180,230);ctx.scale(3,3)
 drawFighter3D(ctx as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{hands});ctx.restore()
 ctx.fillStyle='#1c3040';ctx.font='24px sans-serif';ctx.fillText(`${time.toFixed(1)}s / phase ${Math.round(phase*100)}%`,i*400+30,430)
 ctx.save();ctx.beginPath();ctx.rect(i*400+10,465,380,335);ctx.clip()
 ctx.translate(i*400+215,650);ctx.scale(14,14)
 ctx.rotate(Math.atan2(g.handL.y-g.elbL.y,g.handL.x-g.elbL.x)+hands.leftRoll)
 ctx.fillStyle='#000';ctx.beginPath();ctx.moveTo(-9,-1.5);ctx.lineTo(-.6,-1)
 ctx.lineTo(-.6,1);ctx.lineTo(-9,1.5);ctx.closePath();ctx.fill()
 drawArticulatedHand(ctx as unknown as CanvasRenderingContext2D,'#000000',hands.leftOpen);ctx.restore()
 ctx.fillStyle='#1c3040';ctx.font='19px sans-serif';ctx.fillText('PRODUCTION WRIST / PALM / FINGERS',i*400+15,830)
}
writeFileSync('research/arm-reference-assets/rig-exposures.png',canvas.toBuffer('image/png'))
