import {test} from 'node:test'
import assert from 'node:assert/strict'
import {InertialTransition} from '../src/game/anim/inertial-transition'
import {Animator} from '../src/game/anim/animator'
import {CH,makePose} from '../src/game/anim/pose'
import {IDLE_CLIP,JUMP_CLIP} from '../src/game/anim/clips'
import {PLAYER_SPEC} from '../src/game/anim/skeleton'
const delta=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b))
function hand(p:Float32Array){return {
 x:PLAYER_SPEC.upperArm*Math.sin(p[CH.shL])+PLAYER_SPEC.foreArm*Math.sin(p[CH.shL]+p[CH.elL]),
 y:PLAYER_SPEC.upperArm*Math.cos(p[CH.shL])+PLAYER_SPEC.foreArm*Math.cos(p[CH.shL]+p[CH.elL])}}
test('transition preserves outgoing velocity instead of easing a frozen pose from rest',()=>{
 const a=makePose({rootX:2,rootRot:.2,shL:.9,elL:-1.2}),b=makePose({rootX:6,rootRot:.65,shL:1.5,elL:-.8})
 const v=new Float32Array(a.length);v[CH.rootX]=8;v[CH.rootRot]=.7;v[CH.shL]=.5;v[CH.elL]=-.2
 const t=new InertialTransition(),out=makePose(),eps=1e-5
 t.begin(a,v,b,b,1/240,.12);t.apply(b,eps,out)
 for(const ch of [CH.rootX,CH.rootRot,CH.shL,CH.elL])assert.ok(Math.abs((out[ch]-a[ch])/eps-v[ch])<.05,`velocity ${ch}`)
})
test('same elapsed time gives the same transition at 30, 60 and 120Hz',()=>{
 const a=makePose({rootRot:.1,shL:-.6,elL:-1}),b=makePose({rootRot:.7,shL:1.7,elL:-1.3}),v=new Float32Array(a.length)
 const run=(hz:number)=>{
  const t=new InertialTransition(),p=makePose();t.begin(a,v,b,b,1/240,.24)
  for(let i=0;i<hz/10;i++)t.apply(b,1/hz,p)
  return p
 }
 const a30=run(30),a120=run(120)
 for(let ch=0;ch<a.length;ch++)assert.ok(Math.abs(a30[ch]-a120[ch])<1e-5)
})
test('front-to-back hand transfer cannot collapse through its shoulder or invert the elbow',()=>{
 const a=makePose({shL:-.5,elL:-.9}),b=makePose({shL:1.8,elL:-1.5}),v=new Float32Array(a.length)
 const t=new InertialTransition(),p=makePose();t.begin(a,v,b,b,1/240,.24)
 for(let i=0;i<120;i++){
  t.apply(b,.002,p);const h=hand(p)
  assert.ok(Math.hypot(h.x,h.y)>10)
  assert.ok(p[CH.elL]>=-2.62001&&p[CH.elL]<=-.25999)
  assert.ok([...p].every(Number.isFinite))
 }
})
test('weapon world pitch does not inherit an artificial arm-sum rotation',()=>{
 const a=makePose({shR:-.4,elR:-1.2,wrR:5.6}),b=makePose({shR:1.3,elR:-.7,wrR:3.4})
 const t=new InertialTransition(),p=makePose();t.begin(a,new Float32Array(a.length),b,b,1/240,.2)
 for(let i=0;i<25;i++){
  t.apply(b,1/120,p)
  assert.ok(Math.abs(delta(p[CH.shR]+p[CH.elR]+p[CH.wrR],4))<1e-5)
 }
})
test('prepared player transition includes procedural target changes instead of being overwritten',()=>{
 const a=new Animator(true);a.play(IDLE_CLIP,{blend:0});a.update(.1);a.applyPreparedTransition(a.pose,.1)
 const source=a.pose.slice();a.captureDisplayPose(source)
 a.play(JUMP_CLIP,{blend:.05});a.update(0)
 a.pose[CH.rootRot]+=.4 // contextual posture is prepared before the bridge
 a.applyPreparedTransition(a.pose,0)
 assert.ok(Math.abs(a.pose[CH.rootRot]-source[CH.rootRot])<1e-5)
 assert.equal(a.transitioning,true)
})
test('draw completion blends relaxed carry instead of dropping the wrist by two radians',async()=>{
 const {Player}=await import('../src/game/entities/player'),{Input}=await import('../src/game/core/input')
 const p=new Player(),input=new Input(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,
  fx:new Proxy({},{get:()=>noop}),audio:{play:noop},cam:{addTrauma:noop}} as unknown as import('../src/game/core/types').WorldRef
 p.swordDrawn=false;(p as unknown as {startDraw(world:typeof w):void}).startDraw(w)
 let previous=p.pose[CH.wrR]
 for(let i=0;i<65;i++){
  w.time+=1/120;p.update(1/120,w);input.endFrame(1/120)
  if(i>30)assert.ok(Math.abs(delta(p.pose[CH.wrR],previous))<.5,`completion wrist discontinuity at ${i}`)
  previous=p.pose[CH.wrR]
 }
})
