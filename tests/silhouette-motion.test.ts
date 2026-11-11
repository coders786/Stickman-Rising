import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCanvas} from '@napi-rs/canvas'
import {Player} from '../src/game/entities/player'
import type {WorldRef} from '../src/game/core/types'
import {IDLE_CLIP,STOP_CLIP} from '../src/game/anim/clips'
import {sampleClip,Animator} from '../src/game/anim/animator'
import {applyJointLimits} from '../src/game/anim/limits'
import {makePose} from '../src/game/anim/pose'
import {makeFighterGeom,solveFighter3D,drawFighter3D} from '../src/game/anim/rig3d'
import {PLAYER_SPEC,PLAYER_STYLE} from '../src/game/anim/skeleton'
import {handGestures} from '../src/game/anim/hand-gestures'

test('null-black silhouette has no white eyes or colored body details, with a compact untied head',()=>{
 const canvas=createCanvas(600,600),ctx=canvas.getContext('2d')
 const g=solveFighter3D(sampleClip(IDLE_CLIP,0,makePose()),PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
 ctx.translate(300,350);ctx.scale(3,3)
 drawFighter3D(ctx as unknown as CanvasRenderingContext2D,g,PLAYER_STYLE)
 const pixels=ctx.getImageData(0,0,600,600).data
 let black=0
 for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]===255){
   assert.equal(pixels[i],pixels[i+1]);assert.equal(pixels[i+1],pixels[i+2])
   assert.equal(pixels[i],0,'opaque body pixels must be pure #000000');black++
 }
 assert.ok(black>2500)
 const tail=ctx.getImageData(Math.round(300+(g.headC.x-14)*3),Math.round(350+(g.headC.y-7)*3),12,15).data
 assert.ok([...tail].every(v=>v===0),'no ponytail behind the head')
})
test('release plays the complete seven-exposure stop at zero velocity before idle',()=>{
 for(const hz of [30,60,120]){
  let axis=.3
  const noop=()=>{}
  const fx=new Proxy({}, {get:()=>noop})
  const world={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],fx,audio:{play:noop},cam:{addTrauma:noop},
    input:{axisX:()=>axis,axisY:()=>0,pressed:()=>false,down:()=>false,buffered:()=>false,takeBuffered:()=>false,pressStamp:()=>-1}} as unknown as WorldRef
  const p=new Player(),probe=p as unknown as {animator:Animator}
  for(let i=0;i<hz;i++){world.time+=1/hz;p.update(1/hz,world)}
  axis=0;let held=0,zeroVelocityStop=0
  for(let i=0;i<hz*.8;i++){
    world.time+=1/hz;p.update(1/hz,world)
    if(probe.animator.getClip()?.name==='stop'){held+=1/hz;if(Math.abs(p.vx)<1)zeroVelocityStop++}
  }
  assert.ok(held>=.45,`stop cut short at ${hz} Hz: ${held}`)
  assert.ok(zeroVelocityStop>hz*.3)
  assert.equal(probe.animator.getClip()?.name,'idle')
 }
 assert.equal(STOP_CLIP.frames.length,7)
 assert.deepEqual(STOP_CLIP.frames.at(-1)!.p,IDLE_CLIP.frames[0].p)
})
test('hand choreography covers every animation family and preserves held grips',()=>{
 for(const name of ['idle','walk','run','sprint','stop','brake','dashLaunch','jump','fall','land','parry','charge','flourish','draw','sheathe','hurt','dead','l1']){
  const poses=[0,.2,.5,.8,1].map(t=>handGestures(name,t,true))
  for(const h of poses){assert.ok(Object.values(h).every(Number.isFinite));assert.ok(h.leftOpen>=0&&h.leftOpen<=1);assert.ok(h.rightOpen<=(name==='draw'?.36:.05))}
  if(!/hurt|dead/.test(name))assert.ok(new Set(poses.map(p=>p.leftOpen.toFixed(4))).size>1,`${name} fingers are frozen`)
 }
 assert.ok(handGestures('stop',.5,false).leftOpen>handGestures('idle',.5,false).leftOpen)
})

test('stop in-betweens remain finite and within joint limits',()=>{
 let previous=sampleClip(STOP_CLIP,0,makePose())
 for(let i=1;i<=240;i++){
   const p=sampleClip(STOP_CLIP,STOP_CLIP.dur*i/240,makePose())
   const limited=applyJointLimits(p.slice())
   for(let ch=0;ch<p.length;ch++){
     assert.ok(Number.isFinite(p[ch]));assert.ok(Math.abs(p[ch]-limited[ch])<1e-5)
     assert.ok(Math.abs(p[ch]-previous[ch])<(ch<2?.6:.12))
   }
   previous=p
 }
})

test('actual airborne-to-ground contact plays a condition-driven landing before idle',()=>{
 // SEVERITY IS CONDITION-DRIVEN, not a state label: the landing clip is
 // chosen from the real impact velocity, and the same physics quantity
 // (landingLoad.pressure) scales the compression, the dust count and the
 // audio volume. Asserting the physics means the test cannot be satisfied
 // by a cosmetic string — and it must hold identically at 30/60/120 Hz.
 for(const hz of [30,60,120]){
  const noop=()=>{},fx=new Proxy({}, {get:()=>noop})
  const land=(vy0:number)=>{
   const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],fx,audio:{play:noop},cam:{addTrauma:noop},
     input:{axisX:()=>0,axisY:()=>0,pressed:()=>false,down:()=>false,buffered:()=>false,takeBuffered:()=>false,pressStamp:()=>-1}} as unknown as WorldRef
   const p=new Player(),probe=p as unknown as {animator:Animator;landingImpact:number}
   p.y=-40;p.vy=vy0;p.grounded=false
   let frames=0,impact=0,pressure=0
   for(let i=0;i<hz;i++){
    w.time+=1/hz;p.update(1/hz,w)
    if(probe.animator.getClip()?.name==='land'){frames++;impact=Math.max(impact,probe.landingImpact);pressure=Math.max(pressure,p.landingLoad.pressure)}
   }
   return {frames,impact,pressure,final:probe.animator.getClip()?.name,p}
  }
  const soft=land(200),heavy=land(1400)
  // the clip actually plays for a real slice of time
  assert.ok(soft.frames>=Math.floor(hz*.1),`${hz}Hz landing disappeared: ${soft.frames}`)
  // and it hands back to idle when it is done
  assert.equal(soft.final,'idle')
  // severity tracks impact velocity monotonically — this is the behaviour
  // the removed 'hard-landing' label used to describe
  assert.ok(heavy.impact>soft.impact,`${hz}Hz impact ${soft.impact}→${heavy.impact}`)
  assert.ok(heavy.pressure>soft.pressure+.2,`${hz}Hz pressure ${soft.pressure.toFixed(2)}→${heavy.pressure.toFixed(2)}`)
  assert.ok(heavy.pressure<=1&&soft.pressure>=0,'pressure stays normalized')
 }
})

test('stop severity latches pre-deceleration momentum consistently at 30/60/120 Hz',()=>{
 // The skid's severity is latched from the momentum the body carried INTO
 // the deceleration, before friction has taken any of it. Two consequences
 // are testable: the latch is the ENTRY speed (not a post-friction sample),
 // and it is the same at every frame rate — friction per-frame differs 4x
 // across 30/60/120 Hz, so anything sampled after deceleration would smear.
 const latched:number[]=[]
 for(const hz of [30,60,120]){
  let axis=1;const noop=()=>{},fx=new Proxy({}, {get:()=>noop})
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],fx,audio:{play:noop},cam:{addTrauma:noop},
    input:{axisX:()=>axis,axisY:()=>0,pressed:()=>false,down:()=>false,buffered:()=>false,takeBuffered:()=>false,pressStamp:()=>-1}} as unknown as WorldRef
  const p=new Player(),probe=p as unknown as {animator:Animator;stopEntrySpeed:number}
  for(let i=0;i<hz;i++){w.time+=1/hz;p.update(1/hz,w)}
  const vBefore=Math.abs(p.vx)
  axis=0;w.time+=1/hz;p.update(1/hz,w)
  const entry=probe.stopEntrySpeed,after=Math.abs(p.vx)
  assert.ok(entry>250,`${hz}Hz latches pre-deceleration momentum (${entry.toFixed(0)})`)
  // it is the entry speed, not the post-frame speed
  assert.ok(Math.abs(entry-vBefore)<1,`${hz}Hz latch ${entry.toFixed(2)} vs entry ${vBefore.toFixed(2)}`)
  assert.ok(after<vBefore-10,`${hz}Hz friction actually decelerated this frame`)
  // and the skid clip is what plays
  assert.match(probe.animator.getClip()?.name??'',/stop/,`${hz}Hz`)
  latched.push(entry)
 }
 // frame-rate independence: friction is applied per-frame, the LATCH is not
 const spread=Math.max(...latched)-Math.min(...latched)
 assert.ok(spread<1.5,`same stop at every rate: ${latched.map(v=>v.toFixed(2)).join(' / ')} (spread ${spread.toFixed(2)})`)
})
