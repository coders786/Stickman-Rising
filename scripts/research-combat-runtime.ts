import {resolveEnemyHit} from '../src/game/combat/hit-resolution'
import {writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {Player} from '../src/game/entities/player'
import {Enemy,PLAYER_X_REF,type EnemyKind} from '../src/game/entities/enemy'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import {ATTACKS,makeRuntimeInfo,type AttackRuntimeInfo} from '../src/game/combat/attacks'
import {unarmedAttack} from '../src/game/combat/unarmed'
import type {WorldRef} from '../src/game/core/types'
const noop=()=>{},originalRandom=Math.random
let seed=123456;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
type Row={id:string;stance:string;hz:number;kind:string;range:number;contacts:number;outcomes:string[];energyAboveRegen:number;enemyMinY:number;distance:number;firstContact:number|null}
const rows:Row[]=[];let updates=0
function world(input:Input):WorldRef{return{time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop,zoomPulse:noop},addHitstop:noop,addSlowmo:noop,spawnProjectile:noop,enemyStrikePlayer:()=>false} as unknown as WorldRef}
try{
 for(const drawn of [false,true])for(const hz of [30,60,120])for(const kind of ['grunt','shield','heavy'] as EnemyKind[])for(const range of [35,75,140])for(const a of Object.values(ATTACKS)){
  const input=new Input(),w=world(input),p=new Player();p.reset(400);p.swordDrawn=drawn
  for(let i=0;i<Math.round(hz*.25);i++){p.update(1/hz,w);input.endFrame(1/hz)}
  if(a.requires==='air'){p.y=-90;p.grounded=false;p.vy=0}
  const e=new Enemy(kind,p.x+range,1);e.spawning=false;e.state=kind==='heavy'?'windup':'chase';e.hp=e.maxHp=10000;e.face=-1;e.blockUp=kind==='shield'
  w.enemies=[e];p.energy=10;p.meter=0
  const r:Row={id:a.id,stance:drawn?'sword':'unarmed',hz,kind,range,contacts:0,outcomes:[],energyAboveRegen:0,enemyMinY:e.y,distance:0,firstContact:null}
  w.hitEnemy=(_id,blade,info)=>{r.contacts++;r.firstContact??=w.time;const result=resolveEnemyHit(e,info,info.unarmed?p.face:Math.sign(blade.tx-blade.bx)||p.face,p.x);r.outcomes.push(result.outcome);return result}
  p.startAttack(a,w)
  for(let i=0;i<hz;i++){
   w.time+=1/hz;PLAYER_X_REF.x=p.x;PLAYER_X_REF.y=p.y
   p.update(1/hz,w);e.update(1/hz,w);input.endFrame(1/hz);updates++
   assert.ok([...p.pose,...e.pose,p.x,p.y,e.x,e.y].every(Number.isFinite),'non-finite runtime probe')
   r.enemyMinY=Math.min(r.enemyMinY,e.y)
  }
  r.energyAboveRegen=Number((p.energy-13).toFixed(5));r.distance=p.x-400;rows.push(r)
 }
 const direct:{stance:string;launch:number;vyOnHit:number;minY:number}[]=[]
 for(const drawn of [false,true]){
  const e=new Enemy('grunt',450,1);e.spawning=false;e.state='chase';e.hp=e.maxHp=10000
  const w=world(new Input()),a=drawn?ATTACKS.launcher:unarmedAttack(ATTACKS.launcher)
  const info:AttackRuntimeInfo=makeRuntimeInfo(a,1);e.takeHit(info,1,400)
  const vyOnHit=e.vy;let minY=0
  for(let i=0;i<120;i++){e.update(1/120,w);minY=Math.min(minY,e.y)}
  direct.push({stance:drawn?'sword':'unarmed',launch:info.launch,vyOnHit,minY})
 }
 const e=new Enemy('grunt',450,1);e.state='launched';e.spawning=false;e.y=-100;e.vy=-640;e.update(.01,world(new Input()))
 const gravityFromVelocity=(e.vy+640)/.01
 const shield=new Enemy('shield',450,1);shield.spawning=false;shield.state='chase';shield.face=-1;shield.blockUp=true;shield.hp=1
 const chipOutcome=shield.takeHit(makeRuntimeInfo(unarmedAttack(ATTACKS.l1),1),1,400)
 const shieldChip={outcome:chipOutcome,hp:shield.hp,dead:shield.dead}
 const heavy=new Enemy('heavy',450,1);heavy.spawning=false;heavy.state='windup';const beforeHp=heavy.hp
 const armorOutcome=heavy.takeHit(makeRuntimeInfo(ATTACKS.l1,1),1,400)
 const armoredDamage={outcome:armorOutcome,hpLost:beforeHp-heavy.hp,state:heavy.state}
 const blockedReward=rows.filter(r=>r.contacts>0&&r.outcomes.every(x=>x==='blocked')&&r.energyAboveRegen>0)
 const summary={cases:rows.length,updates,allFinite:true,seed:123456,contacts:rows.reduce((n,r)=>n+r.contacts,0),casesWithContact:rows.filter(r=>r.contacts>0).length,onlyBlockedCasesWithEnergyReward:blockedReward.length,blockedExamples:blockedReward.slice(0,4),directLauncher:direct,gravityFromVelocity,shieldChip,armoredDamage}
 writeFileSync('research/combat-runtime-study.json',JSON.stringify({scope:'Actual Player+Enemy, direct startAttack; seeded randomness; no real Game score/elite parry/camera/hitstop/projectiles; enemy attacks do not damage player. Initial heavy windup/shield guard, then real enemy updates. Not true-combo or balance certification.',summary,rows},null,2)+'\n')
 console.log(JSON.stringify(summary,null,2))
}finally{Math.random=originalRandom}
