import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as library from '../src/game/anim/clips'
import {Animator,sampleClip,type Clip} from '../src/game/anim/animator'
import {CH,makePose} from '../src/game/anim/pose'
import {Input} from '../src/game/core/input'
import {Player} from '../src/game/entities/player'
import type {WorldRef} from '../src/game/core/types'
const clips=Object.values(library).filter((v):v is Clip=>!!v&&typeof v==='object'&&'frames' in v&&'dur' in v)
test('every authored switch keeps finite motion and settles in elapsed time, not frame count',()=>{
 for(const from of clips)for(const to of clips){
  const a=new Animator();a.play(from,{blend:0});a.update(from.dur*.37)
  const start=a.pose.slice();a.play(to,{blend:.018,restart:true})
  assert.deepEqual([...a.pose],[...start])
  a.update(0)
  for(const ch of [CH.rootX,CH.rootY,CH.shL,CH.elL])assert.ok(Math.abs(a.pose[ch]-start[ch])<1e-4)
  for(let i=0;i<40;i++){a.update(1/120);assert.ok([...a.pose].every(Number.isFinite))}
  assert.equal(a.transitioning,false)
  const target=sampleClip(to,a.getTime(),makePose())
  for(const ch of [CH.rootX,CH.rootY])assert.ok(Math.abs(a.pose[ch]-target[ch])<1e-5)
 }
})
test('final constrained display seeds switches without accumulating procedural offsets',()=>{
 const a=new Animator();a.play(library.IDLE_CLIP,{blend:0});a.update(.1)
 const shown=a.pose.slice();shown[CH.shL]=1.1;a.captureDisplayPose(shown)
 a.update(.01);assert.notEqual(a.pose[CH.shL],shown[CH.shL])
 a.play(library.JUMP_CLIP,{blend:.08});a.update(0)
 assert.ok(Math.abs(a.pose[CH.shL]-1.1)<1e-5)
})
test('draw has extraction/follow-through breakdowns and no full-turn wrist unwind',()=>{
 const c=library.DRAW_CLIP
 assert.ok(c.frames.some(f=>f.t===.105));assert.ok(c.frames.some(f=>f.t===.215))
 let last=sampleClip(c,0,makePose())
 for(let i=1;i<=300;i++){
  const p=sampleClip(c,c.dur*i/300,makePose())
  assert.ok(Math.abs(p[CH.wrR]-last[CH.wrR])<.06)
  assert.ok(p[CH.wrR]>4.8&&p[CH.wrR]<7.5);last=p
 }
 assert.ok(library.LAND_CLIP.frames[1].p[CH.rootY]>library.LAND_CLIP.frames[0].p[CH.rootY]+4)
 for(const c of [library.JUMP_CLIP,library.JUMP_LEAP_CLIP,library.LAND_CLIP])assert.ok(c.frames.length>=4)
})
test('deliberate draw gates steel once and remains interruptible before extraction',()=>{
 const input=new Input(),p=new Player(),calls:string[]=[],noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,
  fx:new Proxy({},{get:(_,key)=>()=>calls.push(String(key))}),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
 const probe=p as unknown as {startDraw(w:WorldRef):void;sheathAct:unknown}
 const step=(n:number)=>{for(let i=0;i<n;i++){w.time+=1/120;p.update(1/120,w);input.endFrame(1/120)}}
 p.swordDrawn=false;probe.startDraw(w);step(12);assert.equal(p.swordDrawn,false)
 step(12);assert.equal(p.swordDrawn,true);step(25)
 assert.equal(calls.filter(c=>c==='screenFlash').length,1);assert.equal(probe.sheathAct,null)
 p.swordDrawn=false;probe.startDraw(w);step(3);input.setVirtual('jump',true);step(1)
 assert.equal(p.grounded,false);assert.equal(probe.sheathAct,null)
 assert.equal(p.swordDrawn,false,'jump does not force a snap draw')
})
