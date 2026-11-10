/** Baseline only: actual Player update, Game-owned collaborators, no rendering.
 * Match Game's <=1/60 substeps; do not confuse capture Hz with physics Hz. */
import {writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {Game} from '../src/game/game'
import {ATTACKS} from '../src/game/combat/attacks'
import type {WorldRef} from '../src/game/core/types'
const originalRandom=Math.random
let seed=123456
Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
type Row={scenario:string;captureHz:number;direction:number;substeps:number;initialVx:number;finalVx:number;displacement:number;minY:number;stopTime:number|null;reverseTime:number|null;landingTime:number|null;maxDeltaV:number}
const rows:Row[]=[]
try{
 for(const captureHz of [30,60,120])for(const direction of [-1,1])for(const scenario of ['coast','reverse','airDrift','overspeed','jump','attackCarry']){
  const g=new Game(),p=g.player
  const w=(g as unknown as {worldRef:WorldRef}).worldRef
  w.arenaMinX=-10000;w.arenaMaxX=10000;p.reset(0);p.face=direction as -1|1
  p.vx=direction*(scenario==='overspeed'?900:scenario==='jump'?350:480)
  p.swordDrawn=true
  g.input.axisX=()=>scenario==='reverse'?-direction:scenario==='overspeed'?direction:0
  g.input.axisY=()=>0
  if(scenario==='airDrift'){p.y=-300;p.grounded=false;p.vy=-200}
  if(scenario==='jump'){
   // Direct initial launch condition: isolates the trajectory from input buffering.
   p.vy=-950;p.grounded=false
  }
  if(scenario==='attackCarry')p.startAttack(ATTACKS.l1,w)
  let elapsed=0,minY=p.y,maxDeltaV=0,stopTime:number|null=null,reverseTime:number|null=null,landingTime:number|null=null
  let airborne=!p.grounded,substeps=0
  const initialVx=p.vx
  for(let frame=0;frame<captureHz*2;frame++){
   let remaining=1/captureHz
   while(remaining>1e-6){
    const dt=Math.min(remaining,1/60),before=p.vx
    w.time+=dt;p.update(dt,w);g.input.endFrame(dt);elapsed+=dt;substeps++
    assert.ok([p.x,p.y,p.vx,p.vy,...p.pose].every(Number.isFinite))
    minY=Math.min(minY,p.y);maxDeltaV=Math.max(maxDeltaV,Math.abs(p.vx-before))
    if(stopTime===null&&Math.abs(p.vx)<.01)stopTime=elapsed
    if(reverseTime===null&&p.vx*direction<0)reverseTime=elapsed
    if(airborne&&p.grounded&&landingTime===null)landingTime=elapsed
    airborne ||= !p.grounded
    remaining-=dt
   }
  }
  rows.push({scenario,captureHz,direction,substeps,initialVx,finalVx:p.vx,displacement:p.x,minY,stopTime,reverseTime,landingTime,maxDeltaV})
 }
 writeFileSync(process.argv[2]??'research/player-physics-baseline.json',JSON.stringify({scope:'Actual Player with Game collaborators, no enemies/render/audio context, 2 simulation seconds; <=1/60 steps matching Game cap; initial launch state is not a jump-input test. Seed 123456. No physical SI units or performance claims.',rows},null,2)+'\n')
 console.log(JSON.stringify(rows.filter(r=>r.direction===1),null,2))
}finally{Math.random=originalRandom}
