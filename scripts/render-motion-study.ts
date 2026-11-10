/** Actual rig study, not AI artwork. Run before/after motion changes. */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { sampleClip } from '../src/game/anim/animator'
import { makePose } from '../src/game/anim/pose'
import { WALK_CLIP,RUN_CLIP,SPRINT_CLIP } from '../src/game/anim/clips'
import { DASH_VARIANTS } from '../src/game/combat/dash'
import { applyJointLimits } from '../src/game/anim/limits'
import { solveFighter3D,makeFighterGeom,drawFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC,PLAYER_STYLE } from '../src/game/anim/skeleton'
if(process.argv.includes('--before'))throw new Error('BEFORE is a preserved historical render; new code cannot recreate the old motion.')
const before=false
const canvas=createCanvas(1800,1100),ctx=canvas.getContext('2d')
ctx.fillStyle='#d6dce2';ctx.fillRect(0,0,1800,1100)
const text=(s:string,x:number,y:number,size=22)=>{ctx.font=`${size}px sans-serif`;ctx.fillStyle='#26334b';ctx.fillText(s,x,y)}
text(`SHADOW RONIN / ${before?'BEFORE':'REVISED'} MOTION MECHANICS`,50,65,38)
text('ACTUAL RIG + JOINT LIMITS / AUTHORED POSES BEFORE GAMEPLAY CONTACT IK',50,103,18)
text('DASH: COMPRESSION → PUSH → FLIGHT → CATCH → RECOVERY',50,160,24)
const cfg=DASH_VARIANTS.launch
for(let i=0;i<5;i++){
 const phase=[0,.2,.46,.73,1][i],p=sampleClip(cfg.clip,phase*(before?cfg.dur:cfg.clip.dur),makePose());applyJointLimits(p)
 const g=solveFighter3D(p,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
 ctx.save();ctx.translate(175+i*350,420);ctx.scale(3.4,3.4);drawFighter3D(ctx as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{time:phase*cfg.dur});ctx.restore()
 text(`${Math.round(phase*cfg.dur*1000)} ms`,70+i*350,640)
 text(['LOAD','PUSH','FLIGHT','CATCH','SETTLE'][i],70+i*350,674,18)
}
for(const [i,clip] of [WALK_CLIP,RUN_CLIP,SPRINT_CLIP].entries()){
 const p=sampleClip(clip,clip.dur*.12,makePose());applyJointLimits(p)
 const g=solveFighter3D(p,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
 ctx.save();ctx.translate(275+i*570,880);ctx.scale(2.5,2.5);drawFighter3D(ctx as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{time:.12});ctx.restore()
 text(clip.name.toUpperCase(),170+i*570,1055)
}
writeFileSync(`research/ronin-motion-${before?'before':'revised'}.png`,canvas.toBuffer('image/png'))
