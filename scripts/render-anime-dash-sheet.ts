/** Nine-key dash redraw: actual production rig, no concept-only substitute. */
import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {DASH_LAUNCH_CLIP,DASH_CHAIN_CLIP,DASH_CARRY_CLIP} from '../src/game/anim/clips'
import {solveFighter3D,makeFighterGeom,drawFighter3D} from '../src/game/anim/rig3d'
import {PLAYER_SPEC,PLAYER_STYLE} from '../src/game/anim/skeleton'
import {handGestures} from '../src/game/anim/hand-gestures'
const c=createCanvas(2200,1250),x=c.getContext('2d')
x.fillStyle='#dee6eb';x.fillRect(0,0,c.width,c.height);x.fillStyle='#15283b'
x.font='bold 35px sans-serif';x.fillText('ANIME DASH / FOUR NEW BREAKDOWNS + EXTENDED DRIVE',30,50)
x.font='20px sans-serif';x.fillText('Actual authored sprites / pre-contact study / live gameplay retains weapon clearance + foot contacts',30,90)
for(const [r,clip] of [DASH_LAUNCH_CLIP,DASH_CHAIN_CLIP,DASH_CARRY_CLIP].entries()){
 const y=140+r*360;x.fillStyle='#15283b';x.font='bold 22px sans-serif';x.fillText(`${clip.name} / ${clip.frames.length} authored keys`,30,y)
 clip.frames.forEach((f,i)=>{
  const px=125+i*242,py=y+167,g=solveFighter3D(f.p,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
  x.save();x.translate(px,py);x.scale(1.65,1.65)
  drawFighter3D(x as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{hands:handGestures(clip.name,f.t/clip.dur,true),motionEnergy:1})
  x.strokeStyle='#647b8c';x.lineWidth=1.3;x.beginPath();x.moveTo(g.grip.x,g.grip.y);x.lineTo(g.tip.x,g.tip.y);x.stroke();x.restore()
  x.fillStyle='#15283b';x.font='17px sans-serif';x.fillText(`${Math.round(f.t*1000)} ms`,px-25,y+295)
  if(r<2&&[1,3,5,7].includes(i)){x.fillStyle='#236b7d';x.fillText('NEW',px-20,y+321)}
 })
}
x.fillStyle='#15283b';x.font='19px sans-serif';x.fillText('Load -> release -> push -> stretch -> flight -> gather -> catch -> rebound -> settle / motor pulse is NOT slowed',30,1230)
writeFileSync('research/anime-dash-nine-keys.png',c.toBuffer('image/png'))
