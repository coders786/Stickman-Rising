import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Enemy} from '../src/game/entities/enemy'
import {ATTACKS,makeRuntimeInfo} from '../src/game/combat/attacks'
import {unarmedAttack} from '../src/game/combat/unarmed'

test('lethal shield chip resolves death before returning from the guard branch',()=>{
 const e=new Enemy('shield',450,1);e.spawning=false;e.state='chase';e.face=-1;e.blockUp=true;e.hp=1
 assert.equal(e.takeHit(makeRuntimeInfo(unarmedAttack(ATTACKS.l1),1),1,400),'killed')
 assert.equal(e.hp,0);assert.equal(e.dead,true)
})
test('already-dead targets reject repeated contact instead of reporting another kill',()=>{
 const e=new Enemy('grunt',450,1);e.dead=true;e.hp=0
 assert.equal(e.takeHit(makeRuntimeInfo(ATTACKS.l1,1),1,400),'miss')
})

import {resolveEnemyHit,rewardsConfirmedHit,type HitResolution} from '../src/game/combat/hit-resolution'
import {Game} from '../src/game/game'

const blade={bx:400,by:-40,tx:460,ty:-40}
// Exercise the actual orchestrator without starting a browser loop or replacing
// its score, combo, death, FX, or player implementations.
function contact(game:Game,e:Enemy):HitResolution{
 return (game as unknown as {hitEnemy:(id:number,b:typeof blade,a:ReturnType<typeof makeRuntimeInfo>)=>HitResolution})
  .hitEnemy(e.id,blade,makeRuntimeInfo(unarmedAttack(ATTACKS.l1),1))
}
function guardingEnemy(){
 const e=new Enemy('shield',450,1);e.spawning=false;e.state='chase';e.face=-1;e.blockUp=true;return e
}
test('Game shield pressure and guard break do not inflate confirmed-hit combo or score',()=>{
 const g=new Game();g.player.x=400;const e=guardingEnemy();g.enemies=[e]
 const a=contact(g,e),b=contact(g,e),c=contact(g,e)
 assert.equal(a.outcome,'blocked');assert.equal(b.outcome,'blocked');assert.equal(c.outcome,'guardBreak')
 for(const r of [a,b,c]){assert.equal(r.contact,'guard');assert.equal(rewardsConfirmedHit(r),false);assert.ok(r.actualDamage>0)}
 assert.equal(g.combo.hits,0);assert.equal(g.stats.score,0);assert.equal(e.state,'stun')
})
test('Game lethal chip awards one kill, no confirmed-hit combo, and rejects repeated rewards',()=>{
 const g=new Game();g.player.x=400;const e=guardingEnemy();e.hp=1;g.enemies=[e]
 const r=contact(g,e)
 assert.equal(r.outcome,'killed');assert.equal(r.contact,'guard');assert.equal(r.actualDamage,1)
 assert.equal(g.stats.kills,1);assert.equal(g.combo.hits,0)
 const score=g.stats.score,meter=g.player.meter,hp=g.player.hp
 assert.equal(contact(g,e).outcome,'miss')
 assert.equal(g.stats.kills,1);assert.equal(g.stats.score,score);assert.equal(g.player.meter,meter);assert.equal(g.player.hp,hp)
})
test('Game elite parry returns an explicit no-reward outcome',()=>{
 const g=new Game();g.player.x=400;const e=new Enemy('elite',450,1);e.state='chase';e.spawning=false;g.enemies=[e]
 const hp=e.hp,random=Math.random
 try{Math.random=()=>0;const r=contact(g,e);assert.equal(r.outcome,'parried');assert.equal(rewardsConfirmedHit(r),false)}finally{Math.random=random}
 assert.equal(e.hp,hp);assert.equal(g.combo.hits,0);assert.equal(g.stats.score,0)
})
test('armor remains damage-bearing and overkill cannot inflate resolved damage',()=>{
 const e=new Enemy('heavy',450,1);e.spawning=false;e.state='windup'
 const hp=e.hp,r=resolveEnemyHit(e,makeRuntimeInfo(ATTACKS.l1,1),1,400)
 assert.equal(r.outcome,'armored');assert.equal(r.actualDamage,hp-e.hp);assert.equal(rewardsConfirmedHit(r),true);assert.equal(e.state,'windup')
 e.hp=1;const kill=resolveEnemyHit(e,makeRuntimeInfo(ATTACKS.l1,1),1,400)
 assert.equal(kill.outcome,'killed');assert.equal(kill.actualDamage,1);assert.equal(rewardsConfirmedHit(kill),true)
})

test('Player ability meter uses actual damage and rejects repeated dead-target callbacks',()=>{
 const g=new Game();g.player.x=400;g.player.meter=0
 const e=new Enemy('grunt',450,1);e.hp=1;e.spawning=false;g.enemies=[e]
 const w=(g as unknown as {worldRef:import('../src/game/core/types').WorldRef}).worldRef
 const player=g.player as unknown as {dealAbilityDamage:(world:import("../src/game/core/types").WorldRef,e:{id:number;x:number;y:number;d:number},dmg:number,stagger:number,kb:number,kbY:number)=>void}
 const target={id:e.id,x:e.x,y:e.y,d:0}
 player.dealAbilityDamage(w,target,100,1,0,0)
 assert.equal(g.player.meter,4.25) // kill restore 4 + actual damage 1 * .25
 player.dealAbilityDamage(w,target,100,1,0,0)
 assert.equal(g.player.meter,4.25);assert.equal(g.stats.kills,1)
})
