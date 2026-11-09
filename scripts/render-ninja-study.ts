/** Pre-contact FK study of actual conditional pose code (not concept art). */
import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {SPRINT_CLIP,SPRINT_DRIVE_CLIP,DASH_LAUNCH_CLIP,DASH_CARRY_CLIP} from '../src/game/anim/clips'
import {sampleClip} from '../src/game/anim/animator'
import {makePose} from '../src/game/anim/pose'
import {applyJointLimits} from '../src/game/anim/limits'
import {ContextMotion,DEFAULT_CONTEXT,type MotionContext} from '../src/game/anim/context-motion'
import {solveFighter3D,makeFighterGeom,drawFighter3D} from '../src/game/anim/rig3d'
import {PLAYER_SPEC,PLAYER_STYLE} from '../src/game/anim/skeleton'
import {handGestures} from '../src/game/anim/hand-gestures'
const canvas=createCanvas(2000,1380),ctx=canvas.getContext('2d')
ctx.fillStyle='#d7dfe5';ctx.fillRect(0,0,2000,1380)
ctx.fillStyle='#172637';ctx.font='32px sans-serif';ctx.fillText('NINJA RONIN / CORE LEAN + NATURAL HANDS',35,48)
ctx.font='17px sans-serif';ctx.fillText('Pure black body / no eyes or ponytail / outlined by shape, not colored costume details',35,80)
ctx.fillText('Authored targets + conditional hand choreography / pre-contact FK study; gameplay retains final foot + grip IK',35,108)
const rows:[string,Partial<MotionContext>][]=[
 ['SPRINT / CRUISE',{speed:480,forward:480,clip:'sprint'}],
 ['SPRINT / POWER',{speed:480,forward:480,clip:'sprintDrive'}],
 ['DASH / LAUNCH',{state:'dash',speed:800,forward:800,swordDrawn:true,clip:'dashLaunch'}],
 ['DASH / CARRY',{state:'dash',speed:950,forward:950,swordDrawn:true,clip:'dashCarry'}],
]
rows.forEach(([label,delta],row)=>{
 const top=145+row*305;ctx.fillStyle='#172637';ctx.font='17px sans-serif';ctx.fillText(label,25,top+105)
 const clip=[SPRINT_CLIP,SPRINT_DRIVE_CLIP,DASH_LAUNCH_CLIP,DASH_CARRY_CLIP][row]
 for(let i=0;i<6;i++){
  const phase=clip.loop?i/6:i/5,c:MotionContext={...DEFAULT_CONTEXT,...delta,clip:clip.name,phase},layer=new ContextMotion();let pose=makePose()
  for(let tick=0;tick<120;tick++){pose=sampleClip(clip,clip.dur*phase,makePose());layer.apply(pose,c,1/120);applyJointLimits(pose)}
  const x=320+i*295,hip=top+148,g=solveFighter3D(pose,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
  ctx.strokeStyle='#adbac6';ctx.beginPath();ctx.moveTo(x-95,top+270);ctx.lineTo(x+100,top+270);ctx.stroke()
  ctx.save();ctx.translate(x,hip);ctx.scale(2.2,2.2)
  drawFighter3D(ctx as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{motionEnergy:delta.speed!/480,hands:layer.hands(handGestures(clip.name,phase,!!delta.swordDrawn),c)})
  ctx.restore();ctx.fillStyle='#172637';ctx.font='16px sans-serif';ctx.fillText(`cycle ${Math.round(phase*100)}%`,x-40,top+292)
 }
})
writeFileSync(process.argv[2]??'research/ninja-lean-study.png',canvas.toBuffer('image/png'))
