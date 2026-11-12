import test from 'node:test'
import assert from 'node:assert/strict'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
import type {AttackDef} from '../src/game/combat/attacks'

function press(action:'light'|'heavy',x=0,y=0){
 const input=new Input(),player=new Player(),noop=()=>{}
 const world={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop,zoomPulse:noop},addHitstop:noop,addSlowmo:noop,hitEnemy:noop} as unknown as WorldRef
 input.setVirtualAxis(x,y);input.setVirtual(action,true)
 // A quick K tap is released before simulation; holding K intentionally
 // enters the charged-kick chamber.
 if(action==='heavy')input.setVirtual(action,false)
 player.update(1/120,world)
 return (player as unknown as {action:{def:AttackDef}|null}).action!.def
}

test('J is exclusively the upper-body strike lane',()=>{
 for(const [x,y] of [[0,0],[1,0],[1,1],[0,1],[-1,0]]){
  const def=press('light',x,y)
  assert.notEqual(def.strikeJoint,'foot',`${x},${y}: ${def.id}`)
  assert.notEqual(def.strikeJoint,'knee',`${x},${y}: ${def.id}`)
 }
})

test('K is exclusively the leg strike lane',()=>{
 for(const [x,y] of [[0,0],[1,0],[0,1],[-1,0]]){
  const def=press('heavy',x,y)
  assert.ok(def.strikeJoint==='foot'||def.strikeJoint==='knee',`${x},${y}: ${def.id}/${def.strikeJoint}`)
 }
})

test('down-forward J is a fast-recovery high launcher and forward J is an approach fist',()=>{
 const electric=press('light',1,1)
 assert.equal(electric.id,'thunderRisingFist')
 assert.ok((electric.hit.launch??0)>=500)
 assert.ok(electric.cancel<=.32)
 const approach=press('light',1,0)
 assert.equal(approach.id,'drivingDemonFist')
 assert.ok((approach.moveX??0)>=240)
 assert.ok(approach.hit.heavy)
})
