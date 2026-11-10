import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DashBody,powerThrustEnvelope} from '../src/game/physics/dash-body'
import {DASH_VARIANTS} from '../src/game/combat/dash'
import {Input} from '../src/game/core/input'
import {Player} from '../src/game/entities/player'
import type {WorldRef} from '../src/game/core/types'
import type {Animator} from '../src/game/anim/animator'
import {SPRINT_DRIVE_CLIP,SPRINT_CLIP} from '../src/game/anim/clips'
import {sampleClip} from '../src/game/anim/animator'
import {CH,makePose} from '../src/game/anim/pose'
function simulate(hz:number,vx=0,dx=1){
 const b=new DashBody(DASH_VARIANTS.launch,vx,0,dx,0,true);let x=0
 while(b.age<b.duration-1e-8)x+=b.step(Math.min(1/hz,b.duration-b.age),true).x
 return{x,vx:b.vx,b}
}
function world(input:Input):WorldRef{
 const noop=()=>{},fx=new Proxy({}, {get:()=>noop})
 return {time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],fx,input,audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
}
function advance(p:Player,w:WorldRef,seconds:number,hz=120){for(let i=0;i<Math.round(seconds*hz);i++){w.time+=1/hz;p.update(1/hz,w);w.input.endFrame(1/hz)}}
test('dash motor preserves entry velocity and earns acceleration/reversal with force',()=>{
 const b=new DashBody(DASH_VARIANTS.launch,-480,0,1,0,true)
 assert.equal(b.vx,-480);b.step(.025,true);assert.ok(b.vx<0,'cannot instantly reverse existing momentum')
 b.step(.075,true);assert.ok(b.forceX>0);assert.equal(b.forceX,b.ax*b.mass)
 while(b.age<b.duration)b.step(1/120,true)
 assert.ok(b.vx>0);assert.ok(b.kineticEnergy>0);assert.equal(b.momentum,b.mass*Math.hypot(b.vx,b.vy))
 const standing=simulate(120),running=simulate(120,480)
 assert.ok(running.x>standing.x+40);assert.ok(running.vx>standing.vx)
})
test('force integration agrees across 30/60/120 Hz and stays bounded through every variant',()=>{
 for(const initial of [-480,0,480]){
  const a=simulate(30,initial),b=simulate(120,initial)
  assert.ok(Math.abs(a.x-b.x)<.1);assert.ok(Math.abs(a.vx-b.vx)<.5)
 }
 for(const cfg of Object.values(DASH_VARIANTS)){
  const b=new DashBody(cfg,0,0,1,0,true);let prev=0
  for(let i=0;i<120;i++){
   b.step(cfg.dur/120,true)
   assert.ok([b.vx,b.vy,b.forceX,b.kineticEnergy,b.poseProgress].every(Number.isFinite))
   assert.ok(b.poseProgress>=prev-1e-8);prev=b.poseProgress
   assert.ok(Math.abs(b.vx)<1301)
  }
  assert.ok(b.poseProgress>.999)
 }
})
test('gravity survives horizontal air dash; walls absorb rather than reflect momentum',()=>{
 const b=new DashBody(DASH_VARIANTS.air,200,500,1,0,false)
 b.step(.1,false);assert.ok(b.vy>500);assert.ok(b.forceY>0)
 const wall=new DashBody(DASH_VARIANTS.launch,300,0,1,0,true)
 wall.step(.1,true);wall.blockX();const delta=wall.step(.1,true)
 assert.equal(wall.vx,0);assert.equal(delta.x,0);assert.equal(wall.phase,'wall')
})
test('motor work is capped through chains; passive recovery dissipates kinetic energy',()=>{
 let vx=480
 for(let i=0;i<20;i++){
  const b=new DashBody(DASH_VARIANTS.carry,vx,0,1,0,true)
  while(b.age<b.duration)b.step(1/120,true)
  assert.ok(b.vx<1301);vx=b.vx
 }
 const b=new DashBody(DASH_VARIANTS.launch,0,0,1,0,true)
 while(b.progress<.75)b.step(1/480,true)
 const energy=b.kineticEnergy;b.step(.04,true);assert.ok(b.kineticEnergy<energy)
})
test('force peak and authored push pose share one phase clock',()=>{
 const cfg=DASH_VARIANTS.launch,b=new DashBody(cfg,0,0,1,0,true)
 const load=cfg.dur*cfg.anticipation!,drive=cfg.driveDuration??(cfg.dur-load)*.58
 b.age=load+drive*.5
 assert.ok(Math.abs(b.poseProgress-.25)<1e-8)
 assert.ok(Math.abs(b.poseProgress*cfg.clip.dur-.075)<1e-8)
})
test('A/D double-tap-and-hold recognizes both taps between frames; repeats/blur cannot latch sprint',t=>{
 let now=10;t.mock.method(performance,'now',()=>now*1000)
 const input=new Input(),probe=input as unknown as {onKeyDown(e:KeyboardEvent):void;onKeyUp(e:KeyboardEvent):void;onBlur():void}
 const event=(code:string,repeat=false)=>({code,repeat,target:null,preventDefault(){}} as unknown as KeyboardEvent)
 for(const [code,dir] of [['KeyA',-1],['KeyD',1]] as const){
  probe.onBlur();probe.onKeyDown(event(code));assert.equal(input.sprintDirection(),0)
  now+=.04;probe.onKeyUp(event(code));now+=.08;probe.onKeyDown(event(code))
  assert.equal(input.sprintDirection(),dir)
  input.endFrame(0);now+=1;probe.onKeyDown(event(code,true));assert.equal(input.sprintDirection(),dir)
  probe.onKeyUp(event(code));assert.equal(input.sprintDirection(),0)
  now+=.5;probe.onKeyDown(event(code));assert.equal(input.sprintDirection(),0)
  probe.onBlur();assert.equal(input.sprintDirection(),0)
 }
})
test('single hold is 350; double-tap hold reaches 480 with a distinct power-stride clip',t=>{
 let now=20;t.mock.method(performance,'now',()=>now*1000)
 const input=new Input(),p=new Player(),w=world(input),probe=p as unknown as {animator:Animator}
 input.setVirtual('right',true);advance(p,w,.8);assert.equal(p.vx,350);assert.equal(probe.animator.getClip()?.name,'run')
 now+=1;input.setVirtual('right',false);advance(p,w,.1)
 now+=.08;input.setVirtual('right',true);advance(p,w,.04)
 now+=.05;input.setVirtual('right',false);now+=.08;input.setVirtual('right',true)
 const clips=new Set<string>();for(let i=0;i<60;i++){advance(p,w,1/120);clips.add(probe.animator.getClip()?.name??'')}
 assert.ok(clips.has('sprintDrive'),[...clips].join(','));assert.ok(clips.has('sprint'));assert.equal(p.vx,480)
 input.setVirtual('right',false);advance(p,w,.7);assert.equal(p.vx,0)
 const a=sampleClip(SPRINT_DRIVE_CLIP,0,makePose()),b=sampleClip(SPRINT_CLIP,0,makePose())
 assert.ok(a[CH.rootRot]>b[CH.rootRot]+.05)
})
test('player exit keeps velocity; next movement update eases overspeed instead of clamping it',()=>{
 for(const hz of [30,60,120]){
  const input=new Input(),p=new Player(),w=world(input)
  input.setVirtualAxis(1,0);p.startDash(w,1,0)
  let frames=0;while(p.state==='dash'&&frames++<hz){advance(p,w,1/hz,hz)}
  assert.ok(p.vx>350);const exit=p.vx
  advance(p,w,1/hz,hz);assert.ok(p.vx<exit&&p.vx>0,'finite stabilization slows without reversing')
  assert.ok([...p.pose].every(Number.isFinite));assert.ok(p.x>400)
 }
})
test('ground reaction cancels downward motion; vault lifts only after motor force exceeds weight',()=>{
 const down=new DashBody(DASH_VARIANTS.launch,200,0,0,1,true)
 const ground=down.step(.1,true);assert.equal(ground.y,0);assert.equal(down.vy,0)
 const vault=new DashBody(DASH_VARIANTS.vault,0,0,0,-1,true)
 const load=vault.step(.005,true);assert.equal(load.takeoff,false);assert.equal(load.y,0)
 const lift=vault.step(.07,true);assert.ok(lift.takeoff);assert.ok(lift.y<0);assert.ok(vault.vy<0)
 const falling=new DashBody(DASH_VARIANTS.air,0,1400,0,-1,false)
 falling.step(.02,false);assert.ok(falling.vy>1000,'upward input must overcome existing fall momentum')
})
test('opposite input and pause clear sprint intent rather than leaving a runaway latch',t=>{
 let now=50;t.mock.method(performance,'now',()=>now*1000)
 const input=new Input();input.setVirtual('right',true);now+=.04;input.setVirtual('right',false)
 now+=.06;input.setVirtual('right',true);assert.equal(input.sprintDirection(),1)
 input.setVirtual('left',true);assert.equal(input.sprintDirection(),0)
 input.setEnabled(false);input.setEnabled(true);input.setVirtual('right',true);assert.equal(input.sprintDirection(),0)
})
test('opposing momentum selects the new pivot dash before frame-dependent walking friction',()=>{
 for(const hz of [30,60,120]){
  const input=new Input(),p=new Player(),w=world(input)
  p.vx=240;input.setVirtual('left',true);input.setVirtual('dash',true);input.setVirtual('dash',false)
  advance(p,w,1/hz,hz)
  assert.equal(p.dashVariant,'pivot');assert.ok(p.vx>0,'brace must retain incoming momentum')
  assert.equal((p as unknown as {animator:Animator}).animator.getClip()?.name,'dashPivot')
 }
})
test('dash-carried leap cannot shave incoming horizontal overspeed to the old jump cap',()=>{
 const input=new Input(),p=new Player(),w=world(input)
 p.vx=800;input.setVirtualAxis(1,0);input.setVirtual('jump',true)
 advance(p,w,1/120)
 assert.ok(p.vx>750);assert.ok(!p.grounded);assert.ok(p.vy<0)
})
test('arena depenetration while moving away does not apply an incoming wall impulse',()=>{
 const input=new Input(),p=new Player(),w=world(input)
 p.x=w.arenaMinX+10;p.vx=200;p.startDash(w,1,0)
 advance(p,w,1/120)
 assert.ok(p.vx>0);assert.notEqual(p.dashBody?.phase,'wall')
})

test('juicy forward family reaches speed quickly, keeps a catch, and never teleports entry',()=>{
 for(const key of ['launch','carry','chain','hunt'] as const){
  const cfg=DASH_VARIANTS[key],entry=key==='carry'?480:0
  const b=new DashBody(cfg,entry,0,1,0,true)
  assert.equal(b.vx,entry)
  let peak=entry,reach=Infinity
  while(b.age<b.duration-1e-8){
   b.step(Math.min(1/480,b.duration-b.age),true)
   peak=Math.max(peak,b.vx)
   if(b.vx>800)reach=Math.min(reach,b.age)
  }
  assert.ok(reach<.13,`${key}: fast burst ${reach}`)
  assert.ok(peak>900&&peak<1301,`${key}: controlled peak ${peak}`)
  assert.ok(b.vx<peak-100,`${key}: visible deceleration catch`)
  assert.ok(b.vx>350,`${key}: momentum survives exit`)
 }
})
test('propulsion accents fire once per dash, never during load, and reset on reuse',()=>{
 const input=new Input(),p=new Player(),w=world(input),calls:string[]=[]
 w.fx=new Proxy({}, {get:(_,key)=>()=>calls.push(String(key))}) as WorldRef['fx']
 for(let i=0;i<2;i++){
  calls.length=0;p.vx=0;p.startDash(w,1,0)
  advance(p,w,1/120);assert.equal(calls.filter(k=>k==='motionLine').length,0)
  advance(p,w,.3)
  assert.equal(calls.filter(k=>k==='motionLine').length,3)
  assert.equal(calls.filter(k=>k==='speedStreaks').length,1)
 }
})

test('charged propulsion is reported as drive and the later planted catch dissipates speed',()=>{
 for(const hz of [30,60,120])for(const dir of [-1,1]){
  const b=new DashBody(DASH_VARIANTS.launch,0,0,dir,0,true)
  while(b.age<.19-1e-8)b.step(Math.min(1/hz,.19-b.age),true,b.vx,b.vy,true)
  assert.equal(b.boosting,true);assert.equal(b.phase,'drive')
  while(b.age<.31-1e-8)b.step(Math.min(1/hz,.31-b.age),true,b.vx,b.vy,true)
  assert.equal(b.boosting,false)
  const speed=Math.abs(b.vx)
  while(b.age<.38-1e-8)b.step(Math.min(1/hz,.38-b.age),true,b.vx,b.vy,true)
  assert.ok(Math.abs(b.vx)<speed,'catch must dissipate momentum after thrust')
  assert.ok(b.vx*dir>0,'braking cannot reverse the dash')
 }
})


test('powered thrust ramps smoothly into and out of its bounded drive window',()=>{
 assert.equal(powerThrustEnvelope(.10),0);assert.equal(powerThrustEnvelope(.30),0)
 assert.equal(powerThrustEnvelope(.16),1)
 const h=.00001
 for(const t of [.10,.135,.265,.30]){
  const l=(powerThrustEnvelope(t)-powerThrustEnvelope(t-h))/h
  const r=(powerThrustEnvelope(t+h)-powerThrustEnvelope(t))/h
  assert.ok(Math.abs(l-r)<.1,`force derivative continuous at ${t}`)
 }
 for(let i=0;i<=1000;i++){const v=powerThrustEnvelope(i/1000*.4);assert.ok(v>=0&&v<=1)}
})
