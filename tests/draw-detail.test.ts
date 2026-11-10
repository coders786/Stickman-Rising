import {test} from 'node:test'
import assert from 'node:assert/strict'
import {drawDetail,DRAW_CLEAR} from '../src/game/anim/draw-detail'
import {handGestures} from '../src/game/anim/hand-gestures'
import {PLAYER_SPEC} from '../src/game/anim/skeleton'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
test('hand closes before steel emerges; extraction and saya opposition are continuous, not a visibility switch',()=>{
 let last=0
 for(let i=0;i<=300;i++){
  const d=drawDetail(i/1000)
  assert.ok(d.extraction>=last);assert.ok(d.extraction-last<.016)
  if(d.extraction>0)assert.equal(d.rightOpen,0)
  assert.equal(d.retract,d.extraction*18*(1-d.turn));last=d.extraction
 }
 assert.equal(drawDetail(0).extraction,0);assert.equal(drawDetail(DRAW_CLEAR).extraction,1)
 assert.ok(handGestures('draw',0,false).rightOpen>.3)
 assert.equal(handGestures('draw',.3,false).rightOpen,0)
})
test('actual draw maintains hand contacts through extraction and arms only after tip clearance',()=>{
 const input=new Input(),p=new Player(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
 const probe=p as unknown as {startDraw(w:WorldRef):void;drawSocket():{x:number;y:number;ang:number;extraction:number}}
 for(let i=0;i<30;i++){p.update(1/120,w);input.endFrame(1/120)}
 probe.startDraw(w);let maxError=0
 for(let i=1;i<=36;i++){
  p.update(1/120,w);input.endFrame(1/120)
  if(i/120<DRAW_CLEAR)assert.equal(p.swordDrawn,false)
  if(i/120>.08&&i/120<.18){
   const d=probe.drawSocket(),len=PLAYER_SPEC.blade*p.sword.stats.range*1.06
   // PLAYER_SPEC actual blade size is used by the production socket.
   const targetX=d.x+Math.cos(d.ang)*len*d.extraction,targetY=d.y-Math.sin(d.ang)*len*d.extraction
   maxError=Math.max(maxError,Math.hypot(p.geom.handR.x-targetX,p.geom.handR.y-targetY))
  }
 }
 assert.ok(maxError<5,`projected fist/hilt contact residual ${maxError}`)
 assert.equal(p.swordDrawn,true)
})
test('draw support feet reseed after a run reset rather than retaining distant anchors',()=>{
 const p=new Player(),input=new Input(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
 const step=(n:number)=>{for(let i=0;i<n;i++){p.update(1/120,w);input.endFrame(1/120)}}
 p.reset(1800);step(90);p.reset(700)
 ;(p as unknown as {startDraw(w:WorldRef):void}).startDraw(w);step(15)
 for(const ankle of [p.geom.ankleL,p.geom.ankleR])assert.ok(Math.abs(ankle.x)<30,'feet must remain under the new pelvis')
})
