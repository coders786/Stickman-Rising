import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import {Enemy} from '../src/game/entities/enemy'
import {resolveEnemyHit} from '../src/game/combat/hit-resolution'
import type {WorldRef} from '../src/game/core/types'

function setup(hz=120){
 const input=new Input(),p=new Player(),fx=new FX(),noop=()=>{},hits:number[]=[]
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx,
  audio:{play:noop},cam:{addTrauma:noop},hitEnemy:(id:number,_blade:unknown,atk:Parameters<typeof resolveEnemyHit>[1])=>{
   const e=w.enemies.find((e:Enemy)=>e.id===id)!;hits.push(id);return resolveEnemyHit(e,atk,p.face,p.x)
  }} as unknown as WorldRef
 const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
 p.reset(400);p.swordDrawn=true
 return {input,p,w,step,hits}
}
function charge(s:ReturnType<typeof setup>,hz:number){
 s.input.setVirtual('dash',true)
 for(let i=0;i<Math.ceil(hz*.45);i++)s.step()
}

test('power dash charges on hold, waits at full, then launches on release',()=>{
 for(const hz of [30,60,120])for(const dir of [-1,1]){
  const s=setup(hz),{p,input,step}=s;input.setVirtualAxis(dir,0)
  const x=p.x;charge(s,hz)
  assert.equal(p.state,'dashCharge');assert.ok(Math.abs(p.x-x)<1);assert.equal(p.grounded,true)
  for(let i=0;i<Math.ceil(hz*.3);i++)step()
  assert.equal(p.state,'dashCharge');assert.ok(Math.abs(p.x-x)<1,'full charge must wait for release')
  input.setVirtual('dash',false);step();assert.equal(p.state,'dash')
  let peak=0;for(let i=0;i<Math.ceil(hz*.35);i++){step();peak=Math.max(peak,p.vx*dir);assert.equal(p.grounded,true);assert.equal(p.y,0)}
  assert.ok(peak>1100,`charged speed ${peak} at ${hz}Hz`);assert.ok((p.x-x)*dir>120)
 }
})

test('early release gives a regular grounded dash rather than a powered dash',()=>{
 for(const hz of [30,60,120]){
  const {p,input,step}=setup(hz);input.setVirtual('dash',true);step()
  assert.equal(p.state,'dashCharge');input.setVirtual('dash',false);step()
  assert.equal(p.state,'dash');assert.equal((p as unknown as {dashPower:boolean}).dashPower,false)
  assert.ok(p.x>400);assert.equal(p.grounded,true)
 }
})

test('power is stronger than tap and stabilizes before rising',()=>{
 for(const hz of [30,60,120]){
  const run=(powered:boolean)=>{
   const s=setup(hz);s.input.setVirtual('dash',true)
   for(let i=0;i<(powered?Math.ceil(.45*hz):1);i++)s.step()
   s.input.setVirtual('dash',false);s.step();let peak=0,last=0,frames=0
   while(s.p.state==='dash'&&frames++<hz){s.step();peak=Math.max(peak,s.p.vx);last=s.p.vx}
   return {...s,peak,last}
  }
  const tap=run(false),power=run(true)
  assert.ok(power.peak>tap.peak+100,`${hz}: ${tap.peak} ${power.peak}`)
  let recovery=(power.p as unknown as {dashRecoverT:number}).dashRecoverT
  assert.ok(recovery>0&&recovery<=.34);const speed=power.p.vx
  power.step();assert.ok(power.p.vx<speed,'recovery brakes, not velocity teleport')
  recovery=(power.p as unknown as {dashRecoverT:number}).dashRecoverT
  for(let i=0;i<Math.ceil(.4*hz);i++)power.step()
  assert.equal((power.p as unknown as {dashRecoverT:number}).dashRecoverT,0)
  assert.ok(recovery<.34)
 }
})

test('light cancels a charge; heavy arms the dual chamber; both ride a released dash',()=>{
 for(const attack of ['light','heavy'] as const)for(const hz of [30,60,120]){
  // ---- LIGHT CANCELS. It throws the ordinary light strike and must not
  // spend the power-dash cost: combat/stamina.ts states costs are charged on
  // LAUNCH, so a cancel into an attack is free. ----
  const charging=setup(hz);const before=charging.p.stamina
  charging.input.setVirtual('dash',true);charging.step()
  charging.input.setVirtual(attack,true);charging.step()
  if(attack==='light'){
   assert.equal(charging.p.state,'attack')
   assert.equal(charging.p.stamina,before,'an interrupted charge is free')
  }else{
   // ---- HEAVY ARMS THE DUAL CHAMBER instead of interrupting. Holding it
   // converts the invested coil into RAIJIN ZAN (drawn) / RAIJIN KEN
   // (sheathed). This is by design (research/ANIM-GAP-CURRICULUM.md: the
   // anticipation is "BY DESIGN paid inside the planted DUAL_CHARGE coils"),
   // so a heavy press must NOT cut the charge — that would make the dual
   // release unreachable. ----
   assert.equal(charging.p.state,'dashCharge')
   // arming classifies on a HOLD beat (HEAVY_HOLD_ARM), so a TAP stays a
   // plain heavy — hold past the beat to reach the chamber
   for(let i=0;i<Math.ceil(.22*hz);i++)charging.step()
   const armed=(charging.p as unknown as {dashDualArmed:boolean}).dashDualArmed
   assert.equal(armed,true,'heavy held inside the charge arms the dual chamber')
   charging.input.setVirtual('heavy',false)
  }
  charging.input.setVirtual(attack,false)

  // ---- A RELEASED POWER DASH CONVERTS THE PRESS INTO THE CHARGED STRIKE.
  // The startup was already paid in the coil, so the body does not restart
  // it; both keys route to the dedicated charged attack. ----
  const s=setup(hz);charge(s,hz);s.input.setVirtual('dash',false);s.step()
  for(let i=0;i<Math.ceil(.06*hz);i++)s.step()
  const x=s.p.x;s.input.setVirtual(attack,true);s.step()
  assert.equal(s.p.state,'attack')
  const got=(s.p as unknown as {action:{def:{id:string}}}).action.def.id
  assert.ok(['powerArc','powerSlash'].includes(got),`charged strike — got ${got}`)
  assert.equal((s.p as unknown as {dashPower:boolean}).dashPower,true,'the strike rides the powered dash')
  s.input.setVirtual(attack,false);let peak=s.p.vx
  for(let i=0;i<Math.ceil(.18*hz);i++){s.step();peak=Math.max(peak,s.p.vx)}
  assert.ok(s.p.x-x>100);assert.ok(peak>1000)
 }
})

test('a normal dash can still cancel a sword attack and reverse immediately',()=>{
 const {p,input,step}=setup();input.setVirtual('dash',true);input.setVirtual('dash',false);step()
 for(let i=0;i<15;i++)step()
 input.setVirtual('light',true);step();input.setVirtual('light',false);assert.equal(p.state,'attack')
 input.setVirtualAxis(-1,0);input.setVirtual('dash',true);step()
 assert.equal(p.state,'dash');assert.ok(p.dashBody);assert.equal((p as unknown as {action:unknown}).action,null)
})

test('a dash slash resolves damage to multiple enemies along the path',()=>{
 for(const hz of [30,60,120]){
  const {p,w,input,step,hits}=setup(hz)
  for(const x of [460,510,560]){const e=new Enemy('grunt',x,1);e.spawning=false;e.state='chase';w.enemies.push(e)}
  input.setVirtual('dash',true);input.setVirtual('dash',false);step();input.setVirtual('light',true);step();input.setVirtual('light',false)
  for(let i=0;i<Math.ceil(hz*.3);i++)step()
  assert.ok(new Set(hits).size>=2,`horde contacts at ${hz}Hz: ${hits.length}`);assert.equal(p.grounded,true)
 }
})

test('focus reset cancels a charge and wall contact stops the power dash',()=>{
 const s=setup();charge(s,120);s.input.setEnabled(false);s.input.setEnabled(true);s.step()
 assert.equal(s.p.state,'move');assert.equal(s.p.x,400)
 const t=setup();t.w.arenaMaxX=530;charge(t,120);t.input.setVirtual('dash',false)
 for(let i=0;i<90;i++){t.step();assert.ok(t.p.x<=510.00001);assert.equal(t.p.grounded,true)}
 assert.notEqual(t.p.state,'dash')
})

test('holding a new charge through recovery waits for stabilization; releasing early cancels it',()=>{
 for(const retain of [true,false]){
  const s=setup();charge(s,120);s.input.setVirtual('dash',false);s.step()
  let n=0;while(s.p.state==='dash'&&n++<120)s.step()
  assert.ok((s.p as unknown as {dashRecoverT:number}).dashRecoverT>0)
  s.input.setVirtual('dash',true);s.step();assert.notEqual(s.p.state,'dashCharge')
  if(!retain)s.input.setVirtual('dash',false)
  for(let i=0;i<55;i++)s.step()
  assert.equal(s.p.state,retain?'dashCharge':'move')
 }
})

test('charged burst emits bounded grounded accents only after release',()=>{
 for(const hz of [30,60,120]){
  const s=setup(hz),calls:string[]=[]
  s.w.fx=new Proxy({}, {get:(_,key)=>()=>calls.push(String(key))}) as WorldRef['fx']
  charge(s,hz);assert.equal(calls.filter(x=>x==='speedStreaks').length,0)
  s.input.setVirtual('dash',false);for(let i=0;i<Math.ceil(.6*hz);i++)s.step()
  assert.equal(calls.filter(x=>x==='shockwave').length,1)
  assert.equal(calls.filter(x=>x==='speedStreaks').length,5)
  assert.ok(calls.filter(x=>x==='shadowSmear').length<=6)
 }
})

test('stabilizing after power does not prevent a sword attack',()=>{
 const s=setup();charge(s,120);s.input.setVirtual('dash',false);s.step()
 let n=0;while(s.p.state==='dash'&&n++<120)s.step()
 assert.ok((s.p as unknown as {dashRecoverT:number}).dashRecoverT>0)
 s.input.setVirtual('light',true);s.step()
 assert.equal(s.p.state,'attack')
 assert.ok((s.p as unknown as {dashRecoverT:number}).dashRecoverT>0)
})

test('ready cue fires once, and charge motion never fires on input reset',()=>{
 const s=setup(),calls:string[]=[]
 s.w.audio={play:(name:string)=>{calls.push(name)}} as unknown as WorldRef['audio']
 charge(s,120);for(let i=0;i<120;i++)s.step()
 assert.equal(calls.filter(x=>x==='chargeReady').length,1)
 assert.equal(s.p.state,'dashCharge');s.input.setEnabled(false);s.input.setEnabled(true);s.step()
 assert.equal(s.p.state,'move');assert.equal(s.p.x,400)
})

test('charged dash has a distinct clip, near-horizontal drive, and grounded low recovery',()=>{
 for(const hz of [30,60,120])for(const dir of [-1,1]){
  const s=setup(hz);s.input.setVirtualAxis(dir,0);charge(s,hz);s.input.setVirtual('dash',false);s.step()
  const probe=s.p as unknown as {animator:{getClip():{name:string}|null},dashRecoverT:number}
  assert.equal(probe.animator.getClip()?.name,'powerDash')
  let peak=0
  while(s.p.state==='dash'){s.step();peak=Math.max(peak,s.p.pose[2])}
  assert.ok(peak>1.20,`power lean ${peak}`)
  const low=s.p.hipY+1.32*s.p.geom.hip.y
  for(let i=0;i<Math.ceil(.10*hz);i++){
   s.step();assert.ok(probe.dashRecoverT>0)
   assert.ok(Math.max(s.p.hipY+1.32*s.p.geom.toeL.y,s.p.hipY+1.32*s.p.geom.toeR.y)>-6,'recovery has ground support')
  }
  assert.ok(s.p.hipY+1.32*s.p.geom.hip.y>low-5,'hold the low stabilization before rising')
  for(let i=0;i<Math.ceil(.45*hz);i++)s.step()
  assert.ok(s.p.hipY+1.32*s.p.geom.hip.y<low-3,'rise after settling')
 }
})

test('opposite input cannot instantly steer power skid, but attacks remain available',()=>{
 for(const hz of [30,60,120]){
  const s=setup(hz);charge(s,hz);s.input.setVirtual('dash',false);s.step()
  while(s.p.state==='dash')s.step()
  const before=s.p.vx;assert.ok(before>0)
  s.input.setVirtualAxis(-1,0);s.step()
  assert.ok(s.p.vx>0&&s.p.vx<before,'momentum dissipates rather than reversing')
  assert.equal(s.p.face,1,'do not turn during the committed skid')
  s.input.setVirtual('light',true);s.step();assert.equal(s.p.state,'attack')
 }
})

test('power charge tremor and launch shatter fire within bounded effects',()=>{
 for(const dir of [-1,1]){
  const s=setup(),fx=new FX(),shakes:number[]=[]
  s.w.fx=fx;s.w.cam={addTrauma:(n:number)=>{shakes.push(n)}} as unknown as WorldRef['cam']
  s.input.setVirtualAxis(dir,0);charge(s,120)
  assert.ok(shakes.some(n=>n>0),'charge has camera feedback')
  s.input.setVirtual('dash',false);for(let i=0;i<32;i++)s.step()
  const particles=(fx as unknown as {particles:{type:string,vx:number,vy:number}[]}).particles
  const rocks=particles.filter(p=>p.type==='rock')
  assert.ok(rocks.length>0&&rocks.length<=12)
  assert.ok(rocks.every(p=>p.vx*dir<0),'stones fly opposite travel')
  assert.ok(shakes.some(n=>n>=.3),'launch has a distinct impact shake')
 }
})

test('power dash keeps its own timing and travels through an enemy pocket',()=>{
 for(const hz of [30,60,120]){
  const s=setup(hz)
  for(const x of [470,525,580]){const e=new Enemy('grunt',x,1);e.spawning=false;e.state='chase';s.w.enemies.push(e)}
  charge(s,hz);s.input.setVirtual('dash',false);s.step()
  assert.equal((s.p as unknown as {dashPower:boolean}).dashPower,true)
  s.input.setVirtual('light',true);s.step();s.input.setVirtual('light',false)
  for(let i=0;i<Math.ceil(.5*hz);i++)s.step()
  assert.ok(s.p.x>550,'power carries through the group')
  assert.ok(new Set(s.hits).size>=2,`power slash should hit multiple targets at ${hz}Hz`)
 }
})

test('both landings resist movement until stabilized, then accept a queued jump',()=>{
 for(const hz of [30,60,120])for(const power of [false,true]){
  const s=setup(hz)
  if(power){charge(s,hz);s.input.setVirtual('dash',false);s.step()}
  else s.p.startDash(s.w,1,0)
  while(s.p.state==='dash')s.step()
  const probe=s.p as unknown as {dashRecoverT:number;dashFinishT:number}
  assert.ok(probe.dashRecoverT>0||probe.dashFinishT>0)
  const speed=s.p.vx;s.input.setVirtualAxis(-1,0);s.input.setVirtual('jump',true);s.step()
  assert.equal(s.p.grounded,true,'jump waits for landing recovery')
  assert.ok(s.p.vx>0&&s.p.vx<speed,'opposing input cannot turn the skid')
  s.input.setVirtual('jump',false)
  let n=0;while(s.p.grounded&&n++<hz)s.step()
  assert.equal(s.p.grounded,false,'queued jump starts once stabilized')
  assert.ok(s.p.vy<0)
 }
})

test('dash stamina is spent only on launch and interrupted charges cost nothing',()=>{
 for(const hz of [30,60,120]){
  const s=setup(hz);const full=s.p.stamina
  s.input.setVirtual('dash',true);for(let i=0;i<Math.ceil(hz*.4);i++)s.step()
  assert.equal(s.p.stamina,full,'charging does not spend stamina')
  s.input.setVirtual('light',true);s.step();assert.equal(s.p.state,'attack');assert.equal(s.p.stamina,full)
  const n=setup(hz);n.input.setVirtual('dash',true);n.input.setVirtual('dash',false);n.step()
  assert.equal(n.p.stamina,n.p.maxStamina-45,'normal dash costs 45')
  const b=setup(hz);charge(b,hz);b.input.setVirtual('dash',false);b.step()
  assert.equal(b.p.stamina,b.p.maxStamina-120,'power dash costs 120 once')
 }
})

test('low stamina prevents new dashes, never blocks attacks, and regenerates after delay',()=>{
 for(const hz of [30,60,120]){
  const s=setup(hz);s.p.stamina=0;s.input.setVirtual('dash',true);s.input.setVirtual('dash',false);s.step()
  assert.equal(s.p.state,'move','cannot dash without 45 stamina');assert.ok(s.p.stamina>=0)
  s.input.setVirtual('light',true);s.step();assert.equal(s.p.state,'attack','attacks do not cost dash stamina')
  s.input.setVirtual('light',false)
  for(let i=0;i<Math.ceil(hz*1.3);i++)s.step()
  assert.notEqual(s.p.state,'dash','failed press must not auto-fire later')
  assert.ok(s.p.stamina>=45,'stamina regenerates')
  const b=setup(hz);b.input.setVirtual('dash',true);b.input.setVirtual('dash',false);b.step()
  const spent=b.p.stamina
  for(let i=0;i<Math.floor(.7*hz);i++)b.step()
  assert.equal(b.p.stamina,spent,'regen waits after spending')
  for(let i=0;i<hz;i++)b.step()
  assert.ok(b.p.stamina>spent,'regen resumes')
  b.p.reset(400);assert.equal(b.p.stamina,b.p.maxStamina,'new runs refill stamina')
 }
})

test('charged release falls back to a normal dash when power stamina is insufficient',()=>{
 for(const hz of [30,60,120]){
  const s=setup(hz);s.p.stamina=100;charge(s,hz);const before=s.p.stamina;s.input.setVirtual('dash',false);s.step()
  assert.equal(s.p.state,'dash');assert.equal((s.p as unknown as {dashPower:boolean}).dashPower,false)
  assert.equal(s.p.stamina,before-45)
 }
})

test('air and combat-cancel dashes spend stamina and direct calls cannot bypass it',()=>{
 const air=setup();air.p.grounded=false;air.p.y=-20;air.p.startDash(air.w,1,0)
 assert.equal(air.p.stamina,air.p.maxStamina-45)
 const low=setup();low.p.stamina=0;low.p.startDash(low.w,1,0,true)
 assert.equal(low.p.state,'move');assert.equal(low.p.stamina,0)
 const s=setup();s.input.setVirtual('light',true);s.step();s.input.setVirtual('light',false)
 s.input.setVirtual('dash',true);s.step();assert.equal(s.p.state,'dash');assert.equal(s.p.stamina,s.p.maxStamina-45)
})
