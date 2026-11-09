import {test} from 'node:test'
import assert from 'node:assert/strict'
import {brakeVelocity,dragVelocity,attackDriveVelocity,landingLoad} from '../src/game/physics/player-motor'

test('passive motors dissipate speed without sign reversal at all supported steps',()=>{
 for(const sign of [-1,1])for(const hz of [30,60,120]){
  let v=sign*480
  for(let i=0;i<hz;i++){const next=brakeVelocity(v,2800,1/hz);assert.ok(Math.abs(next)<=Math.abs(v));assert.ok(next*sign>=0);v=next}
  assert.equal(Math.abs(v),0)
  assert.ok(Math.abs(dragVelocity(sign*480,.4,1/hz))<480)
 }
})
test('finite strike drive retains overspeed, mirrors, and cannot stack unbounded speed',()=>{
 for(const sign of [-1,1]){
  assert.equal(attackDriveVelocity(sign*480,sign*150,3000,1/60),sign*480)
  assert.equal(attackDriveVelocity(0,sign*150,3000,1/60),sign*50)
  let v=-sign*480
  for(let i=0;i<120;i++){const next=attackDriveVelocity(v,sign*150,3000,1/120);assert.ok(Math.abs(next-v)<=25);v=next}
  assert.equal(v,sign*150)
 }
})
test('landing load uses incoming normal momentum and bounded visual pressure',()=>{
 const a=landingLoad(700),b=landingLoad(700,140),hard=landingLoad(1650)
 assert.equal(b.impulse,2*a.impulse);assert.equal(b.energy,2*a.energy)
 assert.ok(hard.absorptionTime>a.absorptionTime);assert.ok(hard.pressure>=a.pressure)
 assert.equal(landingLoad(-100).impulse,0)
 for(const speed of [0,10,700,1650,10000]){const r=landingLoad(speed);assert.ok(r.pressure>=0&&r.pressure<=1);assert.ok(r.compression>=0&&r.compression<=1)}
})

import {Game} from '../src/game/game'
import {ATTACKS} from '../src/game/combat/attacks'
import type {WorldRef} from '../src/game/core/types'
function setup(){
 const g=new Game(),p=g.player,w=(g as unknown as {worldRef:WorldRef}).worldRef
 p.reset(0);p.swordDrawn=true;w.arenaMinX=-10000;w.arenaMaxX=10000
 return{g,p,w}
}
test('actual sword light strike preserves incoming carry and finite drive across both directions and rates',()=>{
 for(const hz of [30,60,120])for(const direction of [-1,1])for(const incoming of [0,480,900]){
  const {g,p,w}=setup();p.face=direction as -1|1;p.vx=incoming*direction;p.startAttack(ATTACKS.l1,w)
  let largest=0
  for(let frame=0;frame<hz*.4;frame++){
   let remaining=1/hz
   while(remaining>1e-6){const dt=Math.min(remaining,1/60),old=p.vx;p.update(dt,w);g.input.endFrame(dt);remaining-=dt
    largest=Math.max(largest,Math.abs(p.vx-old));assert.ok(p.vx*direction>=0);assert.ok([...p.pose,p.x,p.y].every(Number.isFinite))}
  }
  assert.ok(largest<=65+1e-8,`velocity snap ${largest}`)
  if(incoming===900)assert.ok(p.vx*direction>500,'strike must not erase overspeed')
 }
})
test('locomotion helper extraction preserves the accepted 60 Hz coast envelope',()=>{
 const {g,p,w}=setup();p.vx=480
 for(let i=0;i<120;i++){p.update(1/60,w);g.input.endFrame(1/60)}
 assert.ok(Math.abs(p.x-37.222222222222214)<1e-8);assert.equal(p.vx,0)
})
test('landing captures incoming load once, preserves tangent carry, and resets cleanly',()=>{
 const {g,p,w}=setup();p.y=-1;p.grounded=false;p.vy=700;p.vx=350
 p.update(1/120,w);g.input.endFrame(1/120)
 assert.equal(p.grounded,true);assert.equal(p.vy,0);assert.ok(p.vx>340)
 assert.ok(p.landingLoad.impulse>70*700)
 const load=p.landingLoad
 p.update(1/120,w);assert.equal(p.landingLoad,load,'ground support must not retrigger impact')
 p.reset(0);assert.equal(p.landingLoad.impulse,0)
})

test('parry opens defense immediately but catches momentum over finite support time',()=>{
 for(const hz of [60,120])for(const direction of [-1,1])for(const drawn of [false,true]){
  const {g,p,w}=setup();p.swordDrawn=drawn;p.vx=480*direction
  ;(p as unknown as {enterParry:(world:WorldRef)=>void}).enterParry(w)
  assert.equal(p.vx,480*direction);assert.equal(p.parryWindowOpen,true)
  for(let i=0;i<hz*.15;i++){
   const before=p.vx;p.update(1/hz,w);g.input.endFrame(1/hz)
   assert.ok(Math.abs(p.vx-before)<=8000/hz+1e-8);assert.ok(p.vx*direction>=0)
  }
  assert.equal(Math.abs(p.vx),0)
 }
})
