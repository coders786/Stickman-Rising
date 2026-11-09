import {test} from 'node:test'
import assert from 'node:assert/strict'
import {groundedDashAct} from '../src/game/anim/grounded-dash'
import {DASH_VARIANTS} from '../src/game/combat/dash'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
import {CH} from '../src/game/anim/pose'
test('low-drive sequence peaks at seventy degrees and eases in/out with stationary endpoints',()=>{
 for(const name of ['launch','carry','hunt','chain','pierce','carve'] as const){
  const c=DASH_VARIANTS[name],l=(c.anticipation??.08)*c.dur,d=c.driveDuration??Math.max(.04,(c.dur-l)*.58)
  let peak=0;const beats=new Set<string>()
  for(let i=0;i<=1000;i++){const a=groundedDashAct(c.dur*i/1000,c.dur,l,d);peak=Math.max(peak,a.pitch*a.weight);beats.add(a.beat);assert.ok(Number.isFinite(a.pitch)&&a.weight>=0&&a.weight<=1)}
  assert.ok(peak>1.21&&peak<1.23);assert.ok(beats.has('plant')&&beats.has('push')&&beats.has('drive')&&beats.has('catch')&&beats.has('rise'))
  assert.equal(groundedDashAct(0,c.dur,l,d).weight,0);assert.equal(groundedDashAct(c.dur,c.dur,l,d).weight,0)
 }
})
test('actual grounded dash stays on the roof, reaches low drive and remains finite in both modes',()=>{
 for(const hz of [30,60,120])for(const drawn of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  p.reset(400);p.swordDrawn=drawn
  for(let i=0;i<hz/2;i++){p.update(1/hz,w);input.endFrame(1/hz)}
  p.startDash(w,1,0);let peak=0,maxStep=0,prev=p.pose[CH.rootRot]
  for(let i=0;i<hz*.8;i++){
   p.update(1/hz,w);input.endFrame(1/hz);peak=Math.max(peak,p.pose[CH.rootRot]);maxStep=Math.max(maxStep,Math.abs(p.pose[CH.rootRot]-prev));prev=p.pose[CH.rootRot]
   assert.equal(p.y,0);assert.equal(p.grounded,true);
   if(p.state==='dash')assert.ok(Math.max(p.hipY+1.32*p.geom.toeL.y,p.hipY+1.32*p.geom.toeR.y)> -5,'both feet float during grounded drive');assert.ok([...p.pose].every(Number.isFinite))
   for(const toe of [p.geom.toeL,p.geom.toeR])assert.ok(p.hipY+1.32*toe.y<2,'foot digs through roof')
  }
  assert.ok(peak>1.0,`peak ${peak} at ${hz}Hz`);assert.ok(maxStep<.55,`pitch jump ${maxStep}`)
 }
})

test('hold loads without travel; release launches a real horizontal leap and lands in both stances',()=>{
 for(const hz of [30,60,120])for(const drawn of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);p.swordDrawn=drawn
  for(let i=0;i<hz/2;i++)step()
  input.setVirtual('dash',true);const start=p.x
  for(let i=0;i<hz*.6;i++){step();assert.equal(p.state,'dashLoad');assert.equal(p.y,0);assert.equal(p.grounded,true);assert.ok(Math.abs(p.x-start)<1)}
  assert.equal(p.dashBody,null,'charging must not start a motor')
  input.setVirtual('dash',false);let peak=0,minY=0,landed=false,air=false
  for(let i=0;i<hz*1.2;i++){
   step();peak=Math.max(peak,p.pose[CH.rootRot]);minY=Math.min(minY,p.y)
   assert.ok([...p.pose].every(Number.isFinite));
   if(!p.grounded){air=true;assert.ok(p.y<0)}
   if(air&&p.grounded)landed=true
   for(const toe of [p.geom.toeL,p.geom.toeR])assert.ok(p.hipY+1.32*toe.y<2,'flight recovery penetrates floor')
  }
  assert.ok(peak>1.45);assert.ok(minY< -15);assert.ok(p.x-start>100);assert.ok(landed);assert.equal(p.dashLaunched,true)
 }
})
test('quick release selects normal grounded dash instead of the loaded leap',()=>{
 const p=new Player(),input=new Input(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
 p.reset(400);input.setVirtual('dash',true);p.update(1/120,w);input.endFrame(1/120)
 assert.equal(p.state,'dashLoad');input.setVirtual('dash',false);p.update(1/120,w)
 assert.equal(p.state,'dash');assert.equal(p.dashLaunched,false);assert.equal(p.grounded,true)
})

test('input reset cancels a loaded dash rather than firing on resume',()=>{
 const p=new Player(),input=new Input(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
 p.reset(400);input.setVirtual('dash',true)
 for(let i=0;i<60;i++){p.update(1/120,w);input.endFrame(1/120)}
 input.setEnabled(false);input.setEnabled(true);p.update(1/120,w)
 assert.equal(p.state,'move');assert.equal(p.dashLaunched,false);assert.equal(p.dashBody,null)
})
