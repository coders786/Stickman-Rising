import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SPRINT_CLIP,SPRINT_DRIVE_CLIP,DASH_LAUNCH_CLIP,DASH_CARRY_CLIP} from '../src/game/anim/clips'
import {sampleClip} from '../src/game/anim/animator'
import {CH,makePose} from '../src/game/anim/pose'
import {applyJointLimits} from '../src/game/anim/limits'
import {runningHandMotion} from '../src/game/anim/hand-kinematics'
import {handGestures} from '../src/game/anim/hand-gestures'

test('ninja sprint and dash lean from the core while the head stays balanced',()=>{
 for(const clip of [SPRINT_CLIP,SPRINT_DRIVE_CLIP,DASH_LAUNCH_CLIP,DASH_CARRY_CLIP]){
  for(let i=0;i<=240;i++){
   const p=sampleClip(clip,clip.dur*i/240,makePose()),safe=applyJointLimits(p.slice())
   for(let ch=0;ch<p.length;ch++)assert.ok(Math.abs(p[ch]-safe[ch])<1e-5,`${clip.name} channel ${ch}`)
   assert.ok(Math.abs(p[CH.spine])<.06,'do not fold at the waist')
   assert.ok(Math.abs(p[CH.rootRot]+p[CH.spine]+p[CH.head])<.15,'gaze counterbalances lean')
   if(clip.loop)assert.ok(p[CH.rootRot]>.50&&p[CH.rootRot]<.65)
  }
 }
 assert.ok(sampleClip(DASH_LAUNCH_CLIP,.060,makePose())[CH.rootRot]>.5)
 assert.ok(sampleClip(DASH_CARRY_CLIP,.06,makePose())[CH.rootRot]>.5)
})
test('free hands pump oppositely with relaxed wrists and bounded reachable paths',()=>{
 let covariance=0
 for(let i=0;i<120;i++){
  const t=i/120,h=runningHandMotion(t,480)
  covariance+=(h.left.x-2)*(h.right.x-1)/120
  for(const hand of [h.left,h.right]){
   assert.ok(Math.hypot(hand.x,hand.y)<36)
   assert.ok(Math.abs(hand.roll)<=.101)
   assert.ok(hand.open>=.219&&hand.open<=.341)
  }
  const fingers=handGestures('sprint',t,false),held=handGestures('sprint',t,true)
  assert.equal(fingers.leftRoll,h.left.roll);assert.equal(fingers.rightRoll,h.right.roll)
  assert.equal(fingers.leftOpen,h.left.open);assert.equal(held.rightOpen,0);assert.equal(held.rightRoll,0)
 }
 assert.ok(covariance< -40,'arms must not swing forward/back together')
})
test('hand-space and wrist choreography close smoothly across the gait seam',()=>{
 const epsilon=1e-5,a=runningHandMotion(-epsilon,480),b=runningHandMotion(epsilon,480)
 for(const side of ['left','right'] as const)for(const key of ['x','y','open','roll'] as const){
  assert.ok(Math.abs(a[side][key]-b[side][key])<.01,`${side} ${key} seam`)
 }
 for(const clip of ['dashLaunch','dashCarry','dashPivot'])for(let i=0;i<=120;i++){
  const h=handGestures(clip,i/120,true)
  assert.equal(h.rightOpen,0);assert.equal(h.rightRoll,0)
  assert.ok(h.leftOpen>=.15&&h.leftOpen<=.33)
 }
})
