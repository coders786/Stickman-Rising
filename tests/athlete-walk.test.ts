import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Player} from '../src/game/entities/player'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
import {dashHandMotion,runningHandMotion} from '../src/game/anim/hand-kinematics'
import {equipmentClip} from '../src/game/anim/equipment-motion'
import {DASH_LAUNCH_CLIP} from '../src/game/anim/clips'
import {CH} from '../src/game/anim/pose'
test('walk keeps a tall supported pelvis with short stepping rather than a wide crouch',()=>{
 for(const drawn of [false,true]){
  const p=new Player(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-50000,arenaMaxX:50000,enemies:[],fx:new FX(),audio:{play:noop},cam:{addTrauma:noop},input:{axisX:()=>.28,axisY:()=>0,pressed:()=>false,down:()=>false,buffered:()=>false,takeBuffered:()=>false,pressStamp:()=>-1}} as unknown as WorldRef
  p.reset(400);p.swordDrawn=drawn
  for(let i=0;i<480;i++){
   p.update(1/120,w)
   if(i<120)continue
   assert.ok(p.hipY+1.32*p.geom.hip.y< -56,'walk must not sink into combat crouch')
   for(const a of [p.geom.ankleL,p.geom.ankleR])assert.ok(Math.abs(a.x-p.geom.hip.x)<38)
  }
 }
})
test('walking hands have equal relaxed reach and dash hands express load, stream and catch',()=>{
 for(let i=0;i<120;i++){
  const h=runningHandMotion(i/120,100)
  assert.ok(Math.abs(h.left.y-h.right.y)<1.5,'free hands stay relaxed at equal overall height')
 }
 const load=dashHandMotion('dashLaunch',0),drive=dashHandMotion('dashLaunch',.35),catchPose=dashHandMotion('dashLaunch',1)
 assert.ok(drive.left.x<load.left.x-20);assert.ok(catchPose.left.x>drive.left.x+25)
 assert.ok(dashHandMotion('dashCarve',.35).left.y<drive.left.y-10)
 const clip=equipmentClip(DASH_LAUNCH_CLIP,false)
 assert.ok(new Set(clip.frames.map(f=>f.p[CH.shL].toFixed(2))).size>4)
})
