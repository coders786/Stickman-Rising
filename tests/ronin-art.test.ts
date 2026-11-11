import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDLE_CLIP, COMBAT_IDLE_CLIP, WALK_CLIP, SPRINT_CLIP } from '../src/game/anim/clips'
import { CH, makePose } from '../src/game/anim/pose'
import { sampleClip } from '../src/game/anim/animator'
import { applyJointLimits } from '../src/game/anim/limits'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
import { PLAYER_GAIT, GaitPlanner } from '../src/game/anim/legik'

test('anime proportions preserve the limb and blade reach contracts', () => {
  assert.equal(PLAYER_STYLE.model,'shadow-ronin')
  assert.ok(PLAYER_SPEC.torso <= 33)
  assert.ok(PLAYER_SPEC.headR < 6.5)
  assert.equal(PLAYER_SPEC.thigh+PLAYER_SPEC.shin,49)
  assert.equal(PLAYER_SPEC.upperArm+PLAYER_SPEC.foreArm,42)
  assert.equal(PLAYER_SPEC.upperArm,22)
  assert.equal(PLAYER_SPEC.foreArm,20)
  assert.equal(PLAYER_SPEC.blade,56)
})
test('rest and combat guard have an intentional lowered, flexed martial posture', () => {
  for (const clip of [IDLE_CLIP,COMBAT_IDLE_CLIP]) {
    for(let i=0;i<120;i++) {
      const pose=sampleClip(clip,clip.dur*i/120,makePose())
      assert.ok(pose[CH.rootY]>=2.5)
      assert.ok(pose[CH.rootRot]>.07 && pose[CH.rootRot]<.2)
      assert.ok(pose[CH.kneeL]<-.25 && pose[CH.kneeR]<-.35)
      assert.ok(pose[CH.hipR]-pose[CH.hipL]>.5)
      const bounded=applyJointLimits(pose.slice())
      for(let ch=0;ch<pose.length;ch++)assert.ok(Math.abs(pose[ch]-bounded[ch])<1e-5)
    }
  }
  assert.ok(SPRINT_CLIP.frames[0].p[CH.rootRot] > WALK_CLIP.frames[0].p[CH.rootRot]+.09)
})
test('parked foot IK retains the broader martial stance without marching in place', () => {
  const gait=new GaitPlanner()
  for(let i=0;i<240;i++)gait.update(0,0,1,0,PLAYER_GAIT.idle,1/120,true,3,true)
  assert.equal(gait.standing,true)
  assert.equal(gait.cadence,0)
  assert.ok(gait.footR.planted && gait.footL.planted)
  assert.ok(gait.footR.x-gait.footL.x>33)
})
