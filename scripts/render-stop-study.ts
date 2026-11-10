/** Render the actual silhouette stop choreography, before gameplay contact IK. */
import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {STOP_CLIP} from '../src/game/anim/clips'
import {sampleClip} from '../src/game/anim/animator'
import {makePose} from '../src/game/anim/pose'
import {solveFighter3D,makeFighterGeom,drawFighter3D} from '../src/game/anim/rig3d'
import {PLAYER_SPEC,PLAYER_STYLE} from '../src/game/anim/skeleton'
import {handGestures} from '../src/game/anim/hand-gestures'
const canvas=createCanvas(2100,700),ctx=canvas.getContext('2d')
ctx.fillStyle='#d4dbe2';ctx.fillRect(0,0,2100,700)
ctx.fillStyle='#26334b';ctx.font='36px sans-serif';ctx.fillText('SHADOW RONIN / SMOOTH STOP + HAND FOLLOW-THROUGH',45,65)
ctx.font='18px sans-serif';ctx.fillText('SEVEN AUTHORED EXPOSURES / CONTINUOUS IN-BETWEENS / PURE BLACK BODY + FACE / NO PONYTAIL',45,103)
const labels=['CATCH','LOAD','ABSORB','REBOUND','SETTLE','FOLLOW-THROUGH','REST']
STOP_CLIP.frames.forEach((f,i)=>{
 const p=sampleClip(STOP_CLIP,f.t,makePose()),g=solveFighter3D(p,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
 ctx.save();ctx.translate(110+i*295,400);ctx.scale(2.9,2.9)
 drawFighter3D(ctx as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{hands:handGestures('stop',f.t/STOP_CLIP.dur,false)})
 ctx.restore();ctx.fillStyle='#26334b';ctx.font='20px sans-serif';ctx.fillText(labels[i],40+i*295,610)
 ctx.font='17px sans-serif';ctx.fillText(`${Math.round(f.t*1000)} ms`,40+i*295,643)
})
writeFileSync('research/ronin-stop-study.png',canvas.toBuffer('image/png'))
