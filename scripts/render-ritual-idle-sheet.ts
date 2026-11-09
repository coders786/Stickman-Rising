/** Nine-key dash redraw: actual production rig, no concept-only substitute. */
import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {SHEATHE_CLIP,DRAW_CLIP,IDLE_CLIP} from '../src/game/anim/clips'
import {solveFighter3D,makeFighterGeom,drawFighter3D} from '../src/game/anim/rig3d'
import {PLAYER_SPEC,PLAYER_STYLE} from '../src/game/anim/skeleton'
import {handGestures} from '../src/game/anim/hand-gestures'
const c=createCanvas(2640,1250),x=c.getContext('2d')
x.fillStyle='#dee6eb';x.fillRect(0,0,c.width,c.height);x.fillStyle='#15283b'
x.font='bold 35px sans-serif';x.fillText('SWORD RITUALS / SIX NEW KEYS EACH + QUIET BREATHING IDLE',30,50)
x.font='20px sans-serif';x.fillText('Actual authored sprites / pre-contact study / live gameplay retains weapon clearance + foot contacts',30,90)
for(const [r,clip] of [SHEATHE_CLIP,DRAW_CLIP,IDLE_CLIP].entries()){
 const y=140+r*360;x.fillStyle='#15283b';x.font='bold 22px sans-serif';x.fillText(`${clip.name} / ${clip.frames.length} authored keys`,30,y)
 clip.frames.forEach((f,i)=>{
  const px=110+i*218,py=y+167,g=solveFighter3D(f.p,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
  x.save();x.translate(px,py);x.scale(1.5,1.5)
  drawFighter3D(x as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{hands:handGestures(clip.name,f.t/clip.dur,true),motionEnergy:1})
  x.strokeStyle='#647b8c';x.lineWidth=1.3;x.beginPath();x.moveTo(g.grip.x,g.grip.y);x.lineTo(g.tip.x,g.tip.y);x.stroke();x.restore()
  x.fillStyle='#15283b';x.font='17px sans-serif';x.fillText(`${Math.round(f.t*1000)} ms`,px-25,y+295)
  if((r===0&&[.11,.30,.37,.50,.70,.78].includes(f.t))||(r===1&&[.035,.085,.12,.185,.245,.275].includes(f.t))){x.fillStyle='#236b7d';x.fillText('NEW',px-20,y+321)}
 })
}
x.fillStyle='#15283b';x.font='19px sans-serif';x.fillText('Sheathe 850ms / draw 300ms / idle 5.4s / pre-contact silhouettes; weapon lines use solved endpoints before gameplay visibility gates',30,1230)
writeFileSync('research/ritual-idle-key-sheet.png',c.toBuffer('image/png'))
