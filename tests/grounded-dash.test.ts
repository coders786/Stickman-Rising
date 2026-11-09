import {test} from 'node:test'
import assert from 'node:assert/strict'
import {groundedDashAct} from '../src/game/anim/grounded-dash'
import {DASH_VARIANTS} from '../src/game/combat/dash'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
import {CH} from '../src/game/anim/pose'
test('standard dash stays upright and settles into its split stance',()=>{
 for(const name of ['launch','carry','hunt','chain','pierce','carve'] as const){
  const c=DASH_VARIANTS[name],l=(c.anticipation??.08)*c.dur,d=c.driveDuration??Math.max(.04,(c.dur-l)*.58)
  let peak=0;const beats=new Set<string>()
  for(let i=0;i<=1000;i++){const a=groundedDashAct(c.dur*i/1000,c.dur,l,d);peak=Math.max(peak,a.pitch*a.weight);beats.add(a.beat);assert.ok(Number.isFinite(a.pitch)&&a.weight>=0&&a.weight<=1)}
  assert.ok(peak>.18&&peak<.21);assert.ok(beats.has('plant')&&beats.has('push')&&beats.has('drive')&&beats.has('catch')&&beats.has('rise'))
  assert.equal(groundedDashAct(0,c.dur,l,d).weight,0);assert.equal(groundedDashAct(c.dur,c.dur,l,d).weight,1);assert.equal(groundedDashAct(c.dur,c.dur,l,d).catch,1)
 }
})
test('actual standard dash remains upright, grounded and finite in both equipment modes',()=>{
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
  assert.ok(peak>.10&&peak<.30,`peak ${peak} at ${hz}Hz`);assert.ok(maxStep<.55,`pitch jump ${maxStep}`)
 }
})

test('ground power dash charges until released without leaving the ground',()=>{
 for(const hz of [30,60,120])for(const drawn of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);p.swordDrawn=drawn
  for(let i=0;i<hz/2;i++)step()
  const start=p.x;input.setVirtual('dash',true)
  for(let i=0;i<hz*.6;i++){step();assert.equal(p.state,'dashCharge');assert.equal(p.y,0);assert.equal(p.grounded,true);assert.ok(Math.abs(p.x-start)<1)}
  input.setVirtual('dash',false);step();assert.equal(p.state,'dash')
  for(let i=0;i<hz*.7;i++){step();assert.equal(p.y,0);assert.equal(p.grounded,true);assert.ok([...p.pose].every(Number.isFinite))}
  assert.ok(p.x-start>100)
 }
})
test('reset cancels a charge and a fast press-and-release fires only once',()=>{
 for(const reset of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  p.reset(400);input.setVirtual('dash',true)
  if(!reset)input.setVirtual('dash',false)
  p.update(1/120,w);input.endFrame(1/120)
  assert.equal(p.state,reset?'dashCharge':'dash')
  if(reset){input.setEnabled(false);input.setEnabled(true)}
  for(let i=0;i<90;i++){p.update(1/120,w);input.endFrame(1/120)}
  assert.equal(p.state,'move');assert.equal(p.grounded,true)
  if(reset)assert.equal(p.x,400)
 }
})

test('power drive skims close to the ground, catches and rises smoothly',()=>{
 for(const hz of [30,60,120])for(const drawn of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);p.swordDrawn=drawn;for(let i=0;i<hz/2;i++)step()
  const standing=p.hipY+1.32*p.geom.hip.y;input.setVirtual('dash',true)
  for(let i=0;i<Math.ceil(.45*hz);i++)step()
  input.setVirtual('dash',false);step()
  let lowest=-Infinity,peak=0,maxStep=0,prev=p.pose[CH.rootRot]
  for(let i=0;i<Math.ceil(.9*hz);i++){
   step();lowest=Math.max(lowest,p.hipY+1.32*p.geom.hip.y)
   peak=Math.max(peak,p.pose[CH.rootRot]);maxStep=Math.max(maxStep,Math.abs(p.pose[CH.rootRot]-prev));prev=p.pose[CH.rootRot]
   assert.equal(p.grounded,true);assert.equal(p.y,0)
   for(const foot of [p.geom.toeL,p.geom.toeR])assert.ok(p.hipY+1.32*foot.y<2,'foot must not penetrate')
   if(p.state==='dash')assert.ok(Math.max(p.hipY+1.32*p.geom.toeL.y,p.hipY+1.32*p.geom.toeR.y)>-26,'feet stay close to the ground')
  }
  assert.ok(lowest>standing+5,`catch lowers hips: ${hz} ${standing} -> ${lowest}`)
  assert.ok(peak>1.2&&peak<1.5,`held lean: ${peak}`);assert.ok(maxStep<.56,`pitch discontinuity: ${maxStep}`)
  assert.ok(p.hipY+1.32*p.geom.hip.y<lowest-2,'hips rise after catch')
 }
})

test('power sequence: planted charge, forward drive, upright split catch and rise',()=>{
 for(const hz of [30,60,120])for(const dir of [-1,1])for(const drawn of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);p.swordDrawn=drawn;p.face=dir as -1|1;input.setVirtualAxis(dir,0)
  for(let i=0;i<hz/2;i++)step()
  const standing=p.hipY+1.32*p.geom.hip.y
  input.setVirtual('dash',true);for(let i=0;i<Math.ceil(.45*hz);i++)step()
  assert.equal(String(p.state),'dashCharge');assert.equal(p.grounded,true)
  input.setVirtual('dash',false);step()
  let drive=false,catchPose=false
  for(let i=0;i<Math.ceil(hz*.9);i++){
   step();assert.equal(p.grounded,true);assert.equal(p.y,0)
   if(p.state==='dash'&&p.pose[CH.rootRot]>.55)drive=true
   const hip=p.hipY+1.32*p.geom.hip.y
   if(p.state==='dash'&&Math.abs(p.pose[CH.rootRot])<.12&&hip>standing+8){
    const front=Math.max(p.geom.ankleL.x,p.geom.ankleR.x)
    const rear=Math.min(p.geom.ankleL.x,p.geom.ankleR.x)
    catchPose ||= front>p.geom.hip.x+4&&rear<p.geom.hip.x-4
   }
  }
  assert.ok(drive,`forward drive absent at ${hz}Hz, dir=${dir}`)
  assert.ok(catchPose,`low braced catch absent at ${hz}Hz, dir=${dir}`)
  assert.ok(p.hipY+1.32*p.geom.hip.y<standing+8,'character rises again after catching')
 }
})

test('both dashes end in a low upright split stance with arms free',()=>{
 for(const hz of [30,60,120])for(const dir of [-1,1])for(const drawn of [false,true])for(const power of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);p.swordDrawn=drawn;p.face=dir as -1|1
  for(let i=0;i<hz/2;i++)step()
  const standing=p.hipY+1.32*p.geom.hip.y
  if(power){input.setVirtualAxis(dir,0);input.setVirtual('dash',true);for(let i=0;i<Math.ceil(hz*.45);i++)step();input.setVirtual('dash',false);step()}
  else p.startDash(w,dir,0)
  let peak=0,frames=0
  while(p.state==='dash'&&frames++<hz){step();peak=Math.max(peak,p.pose[CH.rootRot])}
  const g=p.geom,hip=p.hipY+1.32*g.hip.y
  assert.ok(power?peak>1.15:peak<.30,`distinct drive pitch ${peak}, power=${power}`)
  assert.ok(Math.abs(p.pose[CH.rootRot])<.16,'upright finish')
  assert.ok(hip>standing+7,'hips remain lowered for the catch')
  assert.ok(Math.max(g.ankleL.x,g.ankleR.x)>g.hip.x+4&&Math.min(g.ankleL.x,g.ankleR.x)<g.hip.x-8,'feet straddle the hip')
  assert.ok(g.handL.x>g.shoulderL.x-3||g.handR.x>g.shoulderR.x-3,'arms are not both held behind the body')
  assert.ok(Math.max(p.hipY+1.32*g.toeL.y,p.hipY+1.32*g.toeR.y)>-5,'grounded support')
  for(let i=0;i<Math.ceil(hz*.55);i++)step()
  assert.ok(p.hipY+1.32*p.geom.hip.y<hip-3,'rise after the catch')
 }
})

test('the normal stabilization does not block a sword strike',()=>{
 const p=new Player(),input=new Input(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
 const step=()=>{w.time+=1/120;p.update(1/120,w);input.endFrame(1/120)}
 p.reset(400);p.swordDrawn=true;p.startDash(w,1,0)
 while(p.state==='dash')step()
 assert.ok((p as unknown as {dashFinishT:number}).dashFinishT>0)
 input.setVirtual('light',true);step();assert.equal(String(p.state),'attack')
})

test('late early-release still performs an upright standard dash',()=>{
 for(const hz of [30,60,120]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);input.setVirtual('dash',true)
  for(let i=0;i<Math.floor(.29*hz);i++)step()
  input.setVirtual('dash',false);step()
  assert.equal((p as unknown as {dashPower:boolean}).dashPower,false)
  let peak=0;while(p.state==='dash'){step();peak=Math.max(peak,Math.abs(p.pose[CH.rootRot]))}
  assert.ok(peak<.30,`early release should not power-lean: ${peak}`)
 }
})

test('power-drive feet skim above the ground and land before stabilization',()=>{
 for(const hz of [30,60,120])for(const dir of [-1,1])for(const drawn of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);p.face=dir as -1|1;p.swordDrawn=drawn;input.setVirtualAxis(dir,0);input.setVirtual('dash',true)
  for(let i=0;i<Math.ceil(.45*hz);i++)step()
  input.setVirtual('dash',false);step();let sampled=false
  while(p.state==='dash'){
   step();const probe=p as unknown as {dashSkim:number}
   if(probe.dashSkim>6){
    const feet=[p.hipY+1.32*p.geom.toeL.y,p.hipY+1.32*p.geom.toeR.y]
    assert.ok(feet.every(y=>y<-6&&y>-26),`both feet skim near ground: ${feet}`)
    assert.equal(p.grounded,true);assert.equal(p.y,0);sampled=true
   }
  }
  assert.ok(sampled,'full skim phase was visible')
  assert.ok(Math.max(p.hipY+1.32*p.geom.toeL.y,p.hipY+1.32*p.geom.toeR.y)>-5,'catch returns to contact')
 }
})

test('power skim uses staggered foot in-betweens without drifting away from the floor',()=>{
 for(const hz of [30,60,120])for(const dir of [-1,1]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);p.face=dir as -1|1;input.setVirtualAxis(dir,0);input.setVirtual('dash',true)
  for(let i=0;i<Math.ceil(.45*hz);i++)step()
  input.setVirtual('dash',false);step();let maxSeparation=0,observations=0
  while(p.state==='dash'){
   step();if((p as unknown as {dashSkim:number}).dashSkim>6){
    const left=p.hipY+1.32*p.geom.toeL.y,right=p.hipY+1.32*p.geom.toeR.y
    assert.ok(left<-6&&left>-26&&right<-6&&right>-26)
    maxSeparation=Math.max(maxSeparation,Math.abs(left-right));observations++
   }
  }
  assert.ok(observations>=2);assert.ok(maxSeparation>.5,'the two feet do not move in lockstep')
 }
})

test('dash in-betweens preserve velocity through interior keys without joint overshoot',()=>{
 const duration=.27,h=1e-5
 for(const t of [.08,.20,.35,.50,.64,.76]){
  const sample=(u:number)=>groundedDashAct(u*duration,duration,.01,.095)
  const a=sample(t-h),b=sample(t),c=sample(t+h)
  for(const k of ['pitch','compression','rearReach','drop','catch'] as const){
   const v0=(b[k]-a[k])/h,v1=(c[k]-b[k])/h
   assert.ok(Math.abs(v0-v1)<.015,`${k} must keep velocity at ${t}: ${v0} / ${v1}`)
  }
 }
 const a=groundedDashAct(.4999*duration,duration,.01,.095),b=groundedDashAct(.5001*duration,duration,.01,.095)
 assert.ok((b.drop-a.drop)/.0002>.5,'hip drop flows through the breakdown rather than stopping at the key')
 for(let i=0;i<=1000;i++){
  const a=groundedDashAct(i/1000*duration,duration,.01,.095)
  for(const k of ['compression','rearReach','drop','catch'] as const)assert.ok(a[k]>=0&&a[k]<=1,`${k} must remain bounded`)
 }
})

test('30 fps presentation keeps the power transition readable over multiple frames',()=>{
 for(const dir of [-1,1]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const frame=()=>{for(let i=0;i<2;i++){w.time+=1/60;p.update(1/60,w);input.endFrame(1/60)}}
  p.reset(400);p.face=dir as -1|1;input.setVirtualAxis(dir,0);input.setVirtual('dash',true)
  for(let i=0;i<15;i++)frame()
  input.setVirtual('dash',false);frame();let prev=p.pose[CH.rootRot],maxDelta=0,leanFrames=0,settleFrames=0
  for(let i=0;i<30;i++){
   frame();const pitch=p.pose[CH.rootRot]
   if(p.state==='dash'){maxDelta=Math.max(maxDelta,Math.abs(pitch-prev));if(pitch>1.15)leanFrames++;if(Math.abs(pitch)<.16)settleFrames++}
   assert.ok(p.grounded&&p.y===0);prev=pitch
  }
  assert.ok(maxDelta<.36,`30fps pitch step is too abrupt: ${maxDelta}`)
  assert.ok(leanFrames>=2,'the near-horizontal drive is readable at 30fps')
  assert.ok(settleFrames>=1,'a low catch is visible before moving on')
 }
})
