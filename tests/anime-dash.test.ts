import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DASH_LAUNCH_CLIP,DASH_CHAIN_CLIP,DASH_HUNT_CLIP,DASH_CARRY_CLIP,SPRINT_CLIP} from '../src/game/anim/clips'
import {sampleClip} from '../src/game/anim/animator'
import {CH,makePose} from '../src/game/anim/pose'
import {applyJointLimits} from '../src/game/anim/limits'
import {DASH_VARIANTS} from '../src/game/combat/dash'
import {DashBody} from '../src/game/physics/dash-body'
test('anime forward dashes add exactly four authored breakdowns and retain readable bent-arm silhouettes',()=>{
 for(const [clip,old] of [[DASH_LAUNCH_CLIP,9],[DASH_CHAIN_CLIP,9],[DASH_HUNT_CLIP,9],[DASH_CARRY_CLIP,8]] as const){
  assert.equal(clip.frames.length,old+4)
  for(let i=1;i<clip.frames.length;i++){
   assert.ok(clip.frames[i].t>clip.frames[i-1].t,'in-betweens must have ordered times')
   assert.notDeepEqual([...clip.frames[i].p],[...clip.frames[i-1].p],'in-betweens must not duplicate holds')
  }
  for(let i=0;i<=360;i++){
   const p=sampleClip(clip,clip.dur*i/360,makePose()),safe=applyJointLimits(p.slice())
   for(let ch=0;ch<p.length;ch++)assert.ok(Math.abs(p[ch]-safe[ch])<1e-5,`${clip.name} ch ${ch}`)
   assert.ok(p[CH.elL]<-.7&&p[CH.elR]<-.7)
   assert.ok(Math.abs(p[CH.spine])<.06)
   assert.ok(Math.abs(p[CH.rootRot]+p[CH.spine]+p[CH.head])<.15)
  }
 }
})
test('compact drive remains readable without slowing propulsion or extending invulnerability',()=>{
 for(const key of ['launch','carry','chain','hunt'] as const){
  const cfg=DASH_VARIANTS[key],b=new DashBody(cfg,key==='carry'?480:0,0,1,0,true)
  let readable=0,reach=Infinity
  while(b.age<cfg.dur-1e-8){
   const dt=Math.min(1/480,cfg.dur-b.age);b.step(dt,true)
   const p=sampleClip(cfg.clip,b.poseProgress*cfg.clip.dur,makePose())
   if(p[CH.rootRot]>.45)readable+=dt
   assert.ok(p[CH.rootRot]<.7,`${key}: no flight pose`)
   if(b.vx>800)reach=Math.min(reach,b.age)
  }
  assert.ok(readable>=.06,`${key}: ${readable}s drive visibility`)
  assert.ok(reach<.13);assert.ok(cfg.dur>=.25&&cfg.dur<=.28)
  assert.ok(cfg.iframes<=.13,'longer posing must not grant longer dodge immunity')
 }
})
test('sprint curve stays athletic, balanced and continuous across the cycle seam',()=>{
 let lo=Infinity,hi=-Infinity
 for(let i=0;i<=240;i++){
  const p=sampleClip(SPRINT_CLIP,SPRINT_CLIP.dur*i/240,makePose())
  lo=Math.min(lo,p[CH.rootRot]);hi=Math.max(hi,p[CH.rootRot])
  assert.ok(Math.abs(p[CH.spine]-.04)<1e-6)
  assert.ok(Math.abs(p[CH.rootRot]+p[CH.spine]+p[CH.head])<.06)
 }
 assert.ok(lo>.50&&hi<.65)
 assert.deepEqual([...sampleClip(SPRINT_CLIP,0,makePose())],[...sampleClip(SPRINT_CLIP,SPRINT_CLIP.dur,makePose())])
})
