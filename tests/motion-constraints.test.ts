import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePose, CH } from '../src/game/anim/pose'
import { AnatomicalMotion } from '../src/game/anim/motion-constraints'
import { applyJointLimits } from '../src/game/anim/limits'
import { solveLegIK } from '../src/game/anim/legik'
import { WALK_CLIP, SPRINT_CLIP } from '../src/game/anim/clips'
import { Animator, sampleClip } from '../src/game/anim/animator'

test('leg IK preserves both bone lengths and valid knee bend for extreme targets', () => {
  for (const [tx, ty] of [[0,0],[0,1000],[200,0],[-80,20],[0,-80],[12,38],[1e-12,0]]) {
    const s = solveLegIK(0, 0, tx, ty, 25, 24)
    assert.ok(Math.abs(Math.hypot(s.kx,s.ky)-25) < 1e-7)
    assert.ok(Math.abs(Math.hypot(s.ax-s.kx,s.ay-s.ky)-24) < 1e-7)
    const d = Math.hypot(s.ax,s.ay)
    const flex = Math.acos(Math.max(-1,Math.min(1,(d*d-25*25-24*24)/(2*25*24))))
    assert.ok(flex >= .17-1e-7 && flex <= 2.71+1e-7)
  }
})
test('blending foot targets and resolving cannot stretch/shrink a leg', () => {
  for (let w=0;w<=1;w+=.05) {
    const s = solveLegIK(3, -4, -15 + 35*w, 20 + 15*w, 25, 24)
    assert.ok(Math.abs(Math.hypot(s.kx-3,s.ky+4)-25) < 1e-7)
    assert.ok(Math.abs(Math.hypot(s.ax-s.kx,s.ay-s.ky)-24) < 1e-7)
  }
})
test('smooth locomotion preserves keyframes, bounds and first derivatives', () => {
  const eps=1e-5
  for (const clip of [WALK_CLIP,SPRINT_CLIP]) {
    assert.equal(clip.interpolation,'monotone')
    for (const frame of clip.frames.slice(0,-1)) {
      const center=sampleClip(clip,frame.t,makePose())
      const before=sampleClip(clip,(frame.t-eps+clip.dur)%clip.dur,makePose())
      const after=sampleClip(clip,frame.t+eps,makePose())
      for (let ch=0;ch<center.length;ch++) {
        assert.ok(Math.abs(center[ch]-frame.p[ch])<1e-5)
        const left=(center[ch]-before[ch])/eps,right=(after[ch]-center[ch])/eps
        assert.ok(Math.abs(left-right)<.16,`${clip.name} velocity discontinuity at ${frame.t}, channel ${ch}`)
      }
    }
  }
})
test('walk-to-sprint transition preserves the normalized stride phase', () => {
  const anim=new Animator(); anim.play(WALK_CLIP); anim.update(WALK_CLIP.dur*.37)
  anim.play(SPRINT_CLIP,{syncPhase:true})
  assert.ok(Math.abs(anim.getTime()/SPRINT_CLIP.dur-.37)<1e-6)
})
test('damped motion is bounded and frame-rate stable', () => {
  const run=(hz:number) => {
    const tracker=new AnatomicalMotion();tracker.update(makePose(),0)
    let pose=makePose(),previous=pose[CH.rootRot]
    for(let i=0;i<hz;i++) {
      pose=makePose();pose[CH.rootRot]=.4;pose[CH.shL]=.8
      tracker.update(pose,1/hz)
      assert.ok(Math.abs(pose[CH.rootRot]-previous)<=5/hz+1e-6)
      assert.ok(pose[CH.rootRot]<=.40001)
      previous=pose[CH.rootRot]
    }
    return pose
  }
  const a=run(30),b=run(120)
  assert.ok(Math.abs(a[CH.rootRot]-b[CH.rootRot])<.001)
  assert.ok(Math.abs(a[CH.shL]-b[CH.shL])<.001)
})
test('constraints recover corrupt inputs and long frames without invalid geometry', () => {
  const bad=makePose();bad.fill(NaN);bad[CH.head]=Infinity
  applyJointLimits(bad)
  assert.ok([...bad].every(Number.isFinite))
  const tracker=new AnatomicalMotion();tracker.update(makePose(),0)
  tracker.update(bad,4)
  assert.ok([...bad].every(Number.isFinite))
})

test('anatomical elbow poles preserve 3D arm lengths and weapon reach', async () => {
  const { solveFighter3D, makeFighterGeom, FOCUS } = await import('../src/game/anim/rig3d')
  const { PLAYER_SPEC } = await import('../src/game/anim/skeleton')
  const unproject=(p:{x:number;y:number;z:number})=>({x:p.x*(FOCUS-p.z)/FOCUS,y:p.y*(FOCUS-p.z)/FOCUS,z:p.z})
  const dist=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)
  for(const clip of [WALK_CLIP,SPRINT_CLIP]) {
    for(let i=0;i<100;i++) {
      const pose=sampleClip(clip,clip.dur*i/100,makePose())
      const g=solveFighter3D(pose,PLAYER_SPEC,makeFighterGeom(),PLAYER_SPEC.blade)
      for(const [sh,el,hand] of [[g.shoulderL,g.elbL,g.handL],[g.shoulderR,g.elbR,g.handR]]) {
        assert.ok(Math.abs(dist(unproject(sh),unproject(el))-PLAYER_SPEC.upperArm)<1e-6)
        assert.ok(Math.abs(dist(unproject(el),unproject(hand))-PLAYER_SPEC.foreArm)<1e-6)
      }
    }
  }
})
