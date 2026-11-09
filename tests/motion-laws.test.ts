import {test} from 'node:test'
import assert from 'node:assert/strict'
import {tractionAcceleration,quadraticDragVelocity,contactVelocity,impulseFraction} from '../src/game/physics/motion-laws'
import {DashBody} from '../src/game/physics/dash-body'
import {DASH_VARIANTS} from '../src/game/combat/dash'
import {Game} from '../src/game/game'
import type {WorldRef} from '../src/game/core/types'

test('traction obeys support/friction limit; air has no ground traction',()=>{
 assert.equal(tractionAcceleration(10000,2,2050),4100)
 assert.equal(tractionAcceleration(-10000,2,2050),-4100)
 assert.equal(tractionAcceleration(2600),2600)
 assert.equal(tractionAcceleration(1000,0),0)
 assert.equal(tractionAcceleration(1000,2,0),0)
})
test('quadratic drag dissipates energy, mirrors, and composes across time partitions',()=>{
 for(const v of [-10000,-480,0,480,10000])for(const dt of [0,1/120,1/30,.1,10]){
  const next=quadraticDragVelocity(v,.0007,dt)
  assert.ok(Math.abs(next)<=Math.abs(v));assert.ok(next*v>=0)
  const partitioned=quadraticDragVelocity(quadraticDragVelocity(v,.0007,dt/2),.0007,dt/2)
  assert.ok(Math.abs(partitioned-next)<1e-9)
 }
})
test('inelastic contact removes incoming normal momentum only',()=>{
 assert.equal(contactVelocity(-480,1),0);assert.equal(contactVelocity(480,1),480)
 assert.equal(contactVelocity(480,-1),0);assert.equal(contactVelocity(-480,-1),-480)
})
test('dash impulse is finite across every variant, direction, and update rate',()=>{
 assert.equal(impulseFraction(-1),0);assert.equal(impulseFraction(2),1)
 for(const cfg of Object.values(DASH_VARIANTS))for(const hz of [30,60,120])for(const direction of [-1,1]){
  const b=new DashBody(cfg,0,0,direction,0,true)
  while(b.age<b.duration-1e-8)b.step(Math.min(1/hz,b.duration-b.age),true)
  assert.ok(b.deliveredImpulse<=b.impulseBudget+1e-7)
  assert.ok(b.deliveredImpulse>0);assert.ok(Number.isFinite(b.motorWork))
  assert.equal(b.momentumX,b.mass*b.vx);assert.equal(b.momentumY,b.mass*b.vy)
 }
})
test('wall absorbs energy once without deleting tangential velocity',()=>{
 const b=new DashBody(DASH_VARIANTS.air,480,-300,1,0,false)
 b.blockX();assert.equal(b.vx,0);assert.equal(b.vy,-300)
 assert.equal(b.wallImpulse,-b.mass*480);assert.equal(b.wallEnergyLost,.5*b.mass*480*480)
 b.blockX();assert.equal(b.wallEnergyLost,.5*b.mass*480*480)
 b.step(.05,false);assert.equal(b.vx,0);assert.equal(b.phase,'wall')
})
test('Player bounds extreme overspeed braking by traction and publishes net momentum',()=>{
 const g=new Game(),p=g.player,w=(g as unknown as {worldRef:WorldRef}).worldRef
 p.reset(0);w.arenaMinX=-100000;w.arenaMaxX=100000
 g.input.axisX=()=>1;p.vx=5000
 const old=p.vx;p.update(1/120,w)
 assert.ok(old-p.vx<=4612.5/120+1e-8);assert.ok(p.vx>480)
 assert.equal(p.physicsMetrics.momentumX,p.physicsMetrics.mass*p.vx)
 assert.equal(p.physicsMetrics.energy,.5*p.physicsMetrics.mass*(p.vx*p.vx+p.vy*p.vy))
 assert.ok(p.physicsMetrics.supportLoad>0)
 p.y=-100;p.grounded=false;p.update(1/120,w);assert.equal(p.physicsMetrics.supportLoad,0)
 p.reset(0);assert.equal(p.physicsMetrics.energy,0)
})
