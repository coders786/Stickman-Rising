import {test} from 'node:test'
import assert from 'node:assert/strict'
import {evaluateDash, type DashConditions} from '../src/game/combat/dash'
const base:DashConditions={grounded:true,dx:1,dy:0,face:1,speed:0,pocketTarget:false,huntTarget:false,surrounded:false,enemyNearW:0,chain:0}
test('immediate surrounding geometry chooses breakaway even before proximity smoothing catches up',()=>{
 assert.equal(evaluateDash({...base,surrounded:true,pocketTarget:true}),'carve')
 assert.equal(evaluateDash({...base,rearTarget:true}),'hunt')
 assert.equal(evaluateDash({...base,pocketTarget:true}),'pierce')
 assert.equal(evaluateDash({...base,huntTarget:true}),'hunt')
 assert.equal(evaluateDash({...base,grounded:false,surrounded:true}),'air')
 assert.equal(evaluateDash({...base,forwardMomentum:-300}),'pivot')
})
test('surrounded weave is a deep whole-core diagonal with restrained depth and a level gaze',async()=>{
 const {DASH_CARVE_CLIP}=await import('../src/game/anim/clips')
 const {sampleClip}=await import('../src/game/anim/animator')
 const {CH,makePose}=await import('../src/game/anim/pose')
 const {applyJointLimits}=await import('../src/game/anim/limits')
 let peak=0
 for(let i=0;i<=120;i++){
  const p=sampleClip(DASH_CARVE_CLIP,DASH_CARVE_CLIP.dur*i/120,makePose()),safe=applyJointLimits(p.slice())
  peak=Math.max(peak,p[CH.rootRot]);assert.ok(Math.abs(p[CH.spine])<.04)
  assert.ok(Math.abs(p[CH.rootRot]+p[CH.spine]+p[CH.head])<.05)
  assert.ok(Math.abs(p[CH.pelvisYaw])<.5)
  for(let ch=0;ch<p.length;ch++)assert.ok(Math.abs(p[ch]-safe[ch])<1e-5)
 }
 assert.ok(peak>.69)
})
