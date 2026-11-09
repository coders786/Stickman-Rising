import {writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {Player} from '../src/game/entities/player'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
const cases:{hz:number;drawn:boolean;direction:number;speed:number;minHip:number;maxHip:number;maxFootOffset:number;updates:number}[]=[]
let updates=0
for(const hz of [30,60,120])for(const drawn of [false,true])for(const direction of [-1,1])for(const axis of [.12,.2,.28,.42,.56]){
 const p=new Player(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-50000,arenaMaxX:50000,enemies:[],fx:new FX(),audio:{play:noop},cam:{addTrauma:noop},input:{axisX:()=>axis*direction,axisY:()=>0,pressed:()=>false,down:()=>false,buffered:()=>false,takeBuffered:()=>false,pressStamp:()=>-1}} as unknown as WorldRef
 p.reset(500);p.swordDrawn=drawn
 let minHip=Infinity,maxHip=-Infinity,maxFootOffset=0
 for(let i=0;i<hz*6;i++){
  w.time+=1/hz;p.update(1/hz,w);updates++
  assert.ok([...p.pose].every(Number.isFinite))
  for(const a of [p.geom.ankleL,p.geom.ankleR,p.geom.handL,p.geom.handR])assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y))
  if(i<hz)continue
  const hip=p.hipY+1.32*p.geom.hip.y
  minHip=Math.min(minHip,hip);maxHip=Math.max(maxHip,hip)
  maxFootOffset=Math.max(maxFootOffset,Math.abs(p.geom.ankleL.x-p.geom.hip.x),Math.abs(p.geom.ankleR.x-p.geom.hip.x))
 }
 assert.ok(maxHip< -54,'pelvis collapses');assert.ok(maxFootOffset<40,'foot outruns leg support')
 cases.push({hz,drawn,direction,speed:Math.abs(p.vx),minHip,maxHip,maxFootOffset,updates:hz*6})
}
const report={cases:cases.length,updates,simulationSeconds:cases.length*6,allPosesFinite:true,worstHipHeight:Math.max(...cases.map(c=>c.maxHip)),maxFootOffset:Math.max(...cases.map(c=>c.maxFootOffset)),results:cases}
writeFileSync('research/patrol-walk-audit.json',JSON.stringify(report,null,2)+'\n');console.log({...report,results:undefined})
