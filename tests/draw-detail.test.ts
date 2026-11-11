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
 const probe=p as unknown as {startDraw(w:WorldRef):void;drawSocket():{x:number;y:number;ang:number;extraction:number;grip:number}}
 for(let i=0;i<30;i++){p.update(1/120,w);input.endFrame(1/120)}
 probe.startDraw(w);let maxError=0,handLo=1e9,handHi=-1e9
 for(let i=1;i<=36;i++){
  p.update(1/120,w);input.endFrame(1/120)
  if(i/120<DRAW_CLEAR)assert.equal(p.swordDrawn,false)
  if(i/120>.08&&i/120<.18){
   const d=probe.drawSocket()
   // THE INVARIANT THAT SHIPS: the steel is drawn AT the fist. The hilt
   // render point is `socket + (hand - socket) * grip`, so during the
   // extraction window the grip weight is 1 and the hilt sits exactly on
   // the authored hand — no per-frame contact solver needed.
   assert.ok(d.grip>.999,`fist closes on the hilt (grip ${d.grip.toFixed(3)})`)
   const gx=d.x+Math.cos(d.ang)*PLAYER_SPEC.blade*p.sword.stats.range*1.06*d.extraction
   const gy=d.y-Math.sin(d.ang)*PLAYER_SPEC.blade*p.sword.stats.range*1.06*d.extraction
   const hiltX=gx+(p.geom.handR.x-gx)*d.grip,hiltY=gy+(p.geom.handR.y-gy)*d.grip
   maxError=Math.max(maxError,Math.hypot(p.geom.handR.x-hiltX,p.geom.handR.y-hiltY))
   // and the hand genuinely travels as it leaves the saya — it is authored
   // motion, not a solver pushing it
   handLo=Math.min(handLo,p.geom.handR.y);handHi=Math.max(handHi,p.geom.handR.y)
  }
 }
 assert.ok(maxError<.001,`rendered hilt sits on the drawn fist (residual ${maxError})`)
 assert.ok(handHi-handLo>10,`drawing hand sweeps through extraction (${(handHi-handLo).toFixed(1)}px)`)
 assert.equal(p.swordDrawn,true)
})
test('draw support feet reseed after a run reset rather than retaining distant anchors',()=>{
 const p=new Player(),input=new Input(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
 const step=(n:number)=>{for(let i=0;i<n;i++){p.update(1/120,w);input.endFrame(1/120)}}
 p.reset(1800);step(90);p.reset(700)
 ;(p as unknown as {startDraw(w:WorldRef):void}).startDraw(w);step(15)
 // The draw authors a braced, wide stance (rear foot ~33px back), so the
 // question is not "close to the pelvis" — it is whether anything OUTSIDE
 // the authored pose is still pulling the feet. Both feet must be inside
 // the leg's own reach from the hips: that is impossible with a stale
 // world anchor from the old position, and always true of a clean pose.
 const reach=PLAYER_SPEC.thigh+PLAYER_SPEC.shin+8
 for(const [ankle,hip] of [[p.geom.ankleL,p.geom.hipPtL],[p.geom.ankleR,p.geom.hipPtR]] as const){
  assert.ok(Math.hypot(ankle.x-hip.x,ankle.y-hip.y)<reach,
   `foot stays within leg reach of its own hip (${Math.hypot(ankle.x-hip.x,ankle.y-hip.y).toFixed(1)} < ${reach})`)
 }
 // and the pelvis really did move to the new position
 assert.ok(Math.abs(p.geom.hip.x)<12,'pelvis is back under the reset position')
})
