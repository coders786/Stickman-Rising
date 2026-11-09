import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
import {ATTACKS} from '../src/game/combat/attacks'
import {unarmedAttack} from '../src/game/combat/unarmed'
import {equipmentClip} from '../src/game/anim/equipment-motion'
import {RUN_CLIP,SPRINT_CLIP,JUMP_CLIP,JUMP_LEAP_CLIP,FALL_CLIP,LAND_CLIP,DASH_LAUNCH_CLIP} from '../src/game/anim/clips'
import {CH} from '../src/game/anim/pose'
import {applyJointLimits} from '../src/game/anim/limits'
import type {Animator} from '../src/game/anim/animator'
function setup(){
 const input=new Input(),p=new Player(),hits:number[]=[],noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),
 audio:{play:noop},cam:{addTrauma:noop,zoomPulse:noop},addHitstop:noop,addSlowmo:noop,
 hitEnemy:(id:number)=>hits.push(id)} as unknown as WorldRef
 const step=(seconds:number)=>{for(let i=0;i<Math.round(seconds*120);i++){w.time+=1/120;p.update(1/120,w);input.endFrame(1/120)}}
 const probe=p as unknown as {animator:Animator;action:{def:typeof ATTACKS.l1}|null;blade:{bx:number;by:number;tx:number;ty:number};startDraw(w:WorldRef):void}
 return{input,p,w,hits,step,probe}
}
test('every sword attack intent has a bounded, short-contact empty-hand equivalent',()=>{
 for(const base of Object.values(ATTACKS)){
  const a=unarmedAttack(base)
  assert.equal(a.id,base.id);assert.ok(a.strikeHand);assert.equal(a.requires,base.requires)
  assert.ok(!a.traj&&!a.drawFlash&&!a.hit.aoe&&!a.slamImpact)
  assert.ok(a.clip.frames.length>=7&&a.hit.start<a.hit.end&&a.hit.end<a.cancel)
  assert.ok(a.hit.pad!<=7);assert.equal(a.grip,0)
  for(const f of a.clip.frames){
   const safe=applyJointLimits(f.p.slice())
   for(let ch=0;ch<safe.length;ch++)assert.ok(Math.abs(safe[ch]-f.p[ch])<1e-5)
  }
 }
})
test('sheathed and drawn movement share gait clocks and legs, not arm silhouettes',()=>{
 for(const base of [RUN_CLIP,SPRINT_CLIP,JUMP_CLIP,JUMP_LEAP_CLIP,FALL_CLIP,LAND_CLIP,DASH_LAUNCH_CLIP]){
  const free=equipmentClip(base,false),armed=equipmentClip(base,true)
  assert.equal(free.equipment,'free');assert.equal(armed.equipment,'armed')
  assert.equal(free.dur,armed.dur);assert.equal(free.loop,base.loop)
  assert.notDeepEqual([...free.frames[1].p],[...armed.frames[1].p])
  for(let i=0;i<base.frames.length;i++)for(const ch of [CH.hipL,CH.kneeL,CH.hipR,CH.kneeR])assert.ok(Math.abs(free.frames[i].p[ch]-armed.frames[i].p[ch])<1e-5)
  assert.equal(equipmentClip(base,false),free,'cached, not allocated each frame')
 }
})
test('light, heavy, parry, charge, dash and ability do not silently draw the sword',()=>{
 for(const key of ['light','heavy','parry','dash','ability'] as const){
  const {input,p,step,probe}=setup();input.setVirtual(key,true);step(.025)
  assert.equal(p.swordDrawn,false,key)
  if(key==='light')assert.ok(probe.action?.def.strikeHand)
  if(key==='heavy'||key==='parry')assert.match(probe.animator.getClip()!.name,/^unarmed/)
 }
})
test('Q draw selects real sword attacks and mode persists while idle',()=>{
 const {p,w,step,probe}=setup();probe.startDraw(w);step(.4)
 assert.equal(p.swordDrawn,true);step(2);assert.equal(p.swordDrawn,true,'no surprise auto-sheath')
 p.startAttack(ATTACKS.l1,w);assert.equal(probe.action?.def,ATTACKS.l1)
})
test('fists hit nearby bodies once, never a sword-length distant target',()=>{
 const {p,w,step,probe,hits}=setup();step(.1)
 w.enemies=[{id:1,x:p.x+45,y:0,scale:1,dead:false,spawning:false},
 {id:2,x:p.x+155,y:0,scale:1,dead:false,spawning:false}] as WorldRef['enemies']
 p.startAttack(ATTACKS.l1,w);step(.31)
 assert.equal(p.swordDrawn,false);assert.ok(hits.includes(1),JSON.stringify({hits,blade:probe.blade}))
 assert.equal(hits.filter(h=>h===1).length,1);assert.ok(!hits.includes(2))
 assert.ok(Math.hypot(probe.blade.tx-probe.blade.bx,probe.blade.ty-probe.blade.by)<14)
})
test('unarmed ability and ultimate keep steel home and use contact, not a phantom blade cinematic',()=>{
 const {p,w,probe}=setup();const energy=p.energy;p.startAbility(w)
 assert.equal(p.swordDrawn,false);assert.ok(probe.action?.def.strikeHand);assert.ok(p.energy<energy)
 p.meter=100;p.startUnarmedFinisher(w,true)
 assert.equal(p.meter,0);assert.equal(p.swordDrawn,false);assert.equal(p.state,'attack')
 assert.equal(probe.action?.def.hit.dmg,65);assert.ok(!probe.action?.def.hit.aoe)
})
test('jab reaches the authored contact pose inside its damage window, not after recovery',()=>{
 const {p,w,step,probe}=setup();step(.2);p.startAttack(ATTACKS.l1,w)
 const def=probe.action!.def
 let furthest=0
 for(let i=0;i<35;i++){
  const time=probe.animator.getTime();step(1/120)
  if(time>=def.hit.start&&time<=def.hit.end){
   const sh=p.pose[CH.shL],el=p.pose[CH.elL]
   const x=20*Math.sin(sh)+18*Math.sin(sh+el)
   furthest=Math.max(furthest,x)
  }
 }
 assert.ok(furthest>29,`contact was softened into a late guard: ${furthest}`)
})
test('empty-hand combos never acquire pooled slash trails and elbow contact uses the elbow',()=>{
 const {p,w,step,probe}=setup();step(.1)
 p.startAttack(ATTACKS.l4,w);step(.15)
 assert.equal(probe.action?.def.strikeJoint,'elbow')
 assert.equal((w.fx as unknown as {trails:unknown[]}).trails.length,0)
 const x=p.x+p.face*1.32*p.geom.elbR.x,y=p.hipY+1.32*p.geom.elbR.y
 assert.ok(Math.abs(probe.blade.tx-x)<1e-5&&Math.abs(probe.blade.ty-y)<1e-5)
})
test('air heavy and powered attacks keep their air stance instead of falling back to a weak jab',()=>{
 const {p,input,step,probe,w}=setup();p.grounded=false;p.y=-160;p.vy=-50
 input.setVirtual('heavy',true);step(1/120)
 assert.equal(probe.action?.def.id,'slam');assert.ok(probe.action?.def.strikeHand)
 p.energy=100;p.startAbility(w);assert.equal(probe.action?.def.hit.dmg,30)
 assert.equal(probe.action?.def.requires,'air');assert.equal(p.swordDrawn,false)
 p.meter=100;p.startUnarmedFinisher(w,true)
 assert.equal(probe.action?.def.hit.dmg,65);assert.equal(probe.action?.def.requires,'air')
})
