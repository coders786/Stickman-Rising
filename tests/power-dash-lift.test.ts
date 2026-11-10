import test from 'node:test'
import assert from 'node:assert/strict'
import {powerDashLift} from '../src/game/anim/power-dash'
import {Player} from '../src/game/entities/player'
import type {WorldRef} from '../src/game/core/types'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'

test('power hop is a bounded ballistic arc and finishes before the catch',()=>{
 assert.equal(powerDashLift(0),0);assert.equal(powerDashLift(.075),0);assert.equal(powerDashLift(.275),0)
 assert.ok(Math.abs(powerDashLift(.175)-12)<1e-8)
 for(let i=0;i<=100;i++)assert.ok(powerDashLift(i/100)>=0&&powerDashLift(i/100)<=12)
 assert.ok(Math.abs(powerDashLift(.125)-powerDashLift(.225))<1e-8)
})

test('only a power dash lifts the rig, then returns to contact, at multiple frame rates',()=>{
 for(const hz of [30,60,120])for(const power of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const world={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{world.time+=1/hz;p.update(1/hz,world);input.endFrame(1/hz)}
  p.reset(400);input.setVirtual('dash',true)
  for(let i=0;i<Math.ceil((power?.45:.10)*hz);i++)step()
  input.setVirtual('dash',false);step();let peak=0,airSamples=0
  for(let i=0;i<Math.ceil(.8*hz);i++){
   step();const lift=(p as unknown as {dashLift:number}).dashLift
   peak=Math.max(peak,lift);if(lift>1)airSamples++
   assert.ok(p.grounded&&p.y===0,'visual lift does not change collision or invulnerability')
  }
  if(power){assert.ok(peak>10&&peak<=12.000001,`hz ${hz} power ${power} peak ${peak} state ${p.state}`);assert.ok(airSamples>=4)}else assert.equal(peak,0)
  assert.equal((p as unknown as {dashLift:number}).dashLift,0)
 }
})
