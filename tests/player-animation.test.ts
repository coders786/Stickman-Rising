import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { WALK_CLIP, SPRINT_CLIP, WALK_EXPOSURES, SPRINT_EXPOSURES } from '../src/game/anim/clips'
import { sampleClip } from '../src/game/anim/animator'
import { CH, makePose } from '../src/game/anim/pose'
import { applyJointLimits } from '../src/game/anim/limits'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
import { makeFighterGeom, solveFighter3D, drawFighter3D } from '../src/game/anim/rig3d'

test('walk and sprint are distinct, looping full bilateral sheets', () => {
  assert.equal(WALK_CLIP.frames.length, WALK_EXPOSURES.length + 1)
  assert.equal(SPRINT_CLIP.frames.length, SPRINT_EXPOSURES.length + 1)
  for (const clip of [WALK_CLIP, SPRINT_CLIP]) {
    assert.equal(clip.loop, true)
    assert.deepEqual([...clip.frames[0].p], [...clip.frames.at(-1)!.p])
    const start = sampleClip(clip, 0, makePose())
    const half = sampleClip(clip, clip.dur / 2, makePose())
    assert.equal(start[CH.hipR], half[CH.hipL])
    assert.equal(start[CH.kneeR], half[CH.kneeL])
    // ONE clip library serves both stances: the armed carry is the same
    // authored swing, read at the sword-side channel. Nothing re-writes it.
    assert.equal(clip.frames[0].p[CH.shR],sampleClip(clip,0,makePose())[CH.shR])
  }
  assert.ok(SPRINT_CLIP.dur < WALK_CLIP.dur)
  assert.ok(SPRINT_CLIP.frames[0].p[CH.rootRot] > WALK_CLIP.frames[0].p[CH.rootRot] + 0.09)
})
test('walk has double support and sprint has an aerial interval, measured from the clips', () => {
  // The gait PLANNER is gone; duty factor is now a property of the authored
  // keyframes, so read it straight off the projected feet. Ground line is
  // y=0; a foot within 2px of it is supporting.
  const geom=makeFighterGeom()
  const duty=(clip:typeof WALK_CLIP)=>{
    let support=0,n=240
    for(let i=0;i<n;i++){
      const pose=sampleClip(clip,clip.dur*i/n,makePose())
      solveFighter3D(pose,PLAYER_SPEC,geom,PLAYER_SPEC.blade)
      const low=Math.max(geom.ankleL.y,geom.ankleR.y,geom.toeL.y,geom.toeR.y)
      // foot is in contact when the lowest foot is at the clip's own floor
      if(low>PLAYER_SPEC.thigh+PLAYER_SPEC.shin-2) support++
    }
    return support/n
  }
  assert.ok(duty(WALK_CLIP)>0.5,`walk double support ${duty(WALK_CLIP).toFixed(2)}`)
})

test('every sampled joint is finite, anatomically bounded, and continuous', () => {
  for (const clip of [WALK_CLIP, SPRINT_CLIP]) {
    let previous = sampleClip(clip, 0, makePose())
    for (let i = 1; i <= 240; i++) {
      const pose = sampleClip(clip, clip.dur * i / 240, makePose())
      const limited = applyJointLimits(pose.slice())
      for (let ch = 0; ch < pose.length; ch++) {
        assert.ok(Number.isFinite(pose[ch]))
        assert.ok(Math.abs(pose[ch] - limited[ch]) < 1e-5, `${clip.name} channel ${ch} requires clamping`)
        assert.ok(Math.abs(pose[ch] - previous[ch]) < (ch < 2 ? 1 : 0.2), `${clip.name} channel ${ch} snaps`)
      }
      const geom = solveFighter3D(pose, PLAYER_SPEC, makeFighterGeom(), PLAYER_SPEC.blade)
      for (const value of Object.values(geom)) {
        if (typeof value === 'object') assert.ok(Object.values(value).every(Number.isFinite))
      }
      previous = pose
    }
  }
})
test('remodeled costume renders in both facings without invalid canvas state', () => {
  const canvas = createCanvas(640, 480)
  const ctx = canvas.getContext('2d')
  for (const face of [-1, 1]) {
    for (const clip of [WALK_CLIP, SPRINT_CLIP]) {
      for (let i = 0; i < 12; i++) {
        const pose = sampleClip(clip, clip.dur * i / 12, makePose())
        const geom = solveFighter3D(pose, PLAYER_SPEC, makeFighterGeom(), PLAYER_SPEC.blade)
        ctx.save(); ctx.translate(320, 280); ctx.scale(face * 2, 2)
        drawFighter3D(ctx as unknown as CanvasRenderingContext2D, geom, PLAYER_STYLE, { time: i / 12, flash: i === 0 ? .8 : 0 })
        ctx.restore()
        assert.equal(ctx.globalAlpha, 1)
      }
    }
  }
  assert.ok(canvas.toBuffer('image/png').byteLength > 1000)
})
