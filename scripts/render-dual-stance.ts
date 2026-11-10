/** Actual-rig comparison of equipment and empty-hand contact key poses. */
import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {equipmentClip} from '../src/game/anim/equipment-motion'
import {RUN_CLIP,JUMP_LEAP_CLIP,DASH_LAUNCH_CLIP} from '../src/game/anim/clips'
import {ATTACKS} from '../src/game/combat/attacks'
import {unarmedAttack} from '../src/game/combat/unarmed'
import {sampleClip,type Clip} from '../src/game/anim/animator'
import {solveFighter3D,makeFighterGeom,drawFighter3D} from '../src/game/anim/rig3d'
import {PLAYER_SPEC,PLAYER_STYLE} from '../src/game/anim/skeleton'
import {handGestures} from '../src/game/anim/hand-gestures'
function sheet(title:string,rows:{label:string;clip:Clip;drawn:boolean}[],path:string){
 const c=createCanvas(2100,120+rows.length*310),x=c.getContext('2d')
 x.fillStyle='#dee6eb';x.fillRect(0,0,c.width,c.height);x.fillStyle='#16283b'
 x.font='bold 31px sans-serif';x.fillText(title,30,45)
 x.font='18px sans-serif';x.fillText('Production rig / pre-contact targets / no bone stretching / final gameplay IK and inertial entry remain authoritative',30,82)
 rows.forEach(({label,clip,drawn},r)=>{
  const top=120+r*310;x.fillStyle='#16283b';x.font='20px sans-serif';x.fillText(label,30,top+15)
  for(let i=0;i<7;i++){
   const phase=clip.name.startsWith('unarmed')?[0,.16,.30,.40,.56,.78,1][i]:i/6
   const p=sampleClip(clip,clip.dur*phase,new Float32Array(28))
   const g=solveFighter3D(p,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade),px=150+i*290,py=top+149
   x.save();x.translate(px,py);x.scale(1.85,1.85)
   drawFighter3D(x as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE,{hands:handGestures(clip.name,phase,drawn)})
   if(drawn){x.strokeStyle='#536e82';x.lineWidth=1.5;x.beginPath();x.moveTo(g.grip.x,g.grip.y);x.lineTo(g.tip.x,g.tip.y);x.stroke()}
   x.restore();x.fillStyle='#16283b';x.font='16px sans-serif';x.fillText(`${Math.round(phase*100)}%`,px-18,top+270)
  }
 })
 writeFileSync(path,c.toBuffer('image/png'))
}
sheet('TWO STANCES / SHARED GAIT, DIFFERENT HANDS + WEAPON CARRIAGE',[
 {label:'SHEATHED / free run: opposed hands',clip:equipmentClip(RUN_CLIP,false),drawn:false},
 {label:'DRAWN / run: controlled rear-up blade carry',clip:equipmentClip(RUN_CLIP,true),drawn:true},
 {label:'SHEATHED / running leap: compact air balance',clip:equipmentClip(JUMP_LEAP_CLIP,false),drawn:false},
 {label:'DRAWN / running leap: stable weapon pitch through tuck',clip:equipmentClip(JUMP_LEAP_CLIP,true),drawn:true},
 {label:'SHEATHED / dash: both free arms gather behind the drive',clip:equipmentClip(DASH_LAUNCH_CLIP,false),drawn:false},
 {label:'DRAWN / dash: blade stays clear of the recovery leg',clip:equipmentClip(DASH_LAUNCH_CLIP,true),drawn:true},
],'research/dual-stance-movement.png')
sheet('EMPTY-HAND COMBAT / CHAMBER, TRANSFER, CONTACT, RECOIL, GUARD',[
 ...['l1','l2','l3','l4','h2','launcher'].map(id=>({label:`${id} / ${unarmedAttack(ATTACKS[id]).label} / guarded non-striking hand`,clip:unarmedAttack(ATTACKS[id]).clip,drawn:false})),
],'research/dual-stance-combat.png')
