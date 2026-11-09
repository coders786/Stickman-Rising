import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { WALK_CLIP, SPRINT_CLIP, WALK_EXPOSURES, SPRINT_EXPOSURES } from '../src/game/anim/clips'
import { sampleClip } from '../src/game/anim/animator'
import { CH, makePose } from '../src/game/anim/pose'
import { applyJointLimits } from '../src/game/anim/limits'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
import { makeFighterGeom, solveFighter3D, drawFighter3D } from '../src/game/anim/rig3d'
import {equipmentClip} from '../src/game/anim/equipment-motion'
import { PLAYER_GAIT } from '../src/game/anim/legik'

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
    const armed=equipmentClip(clip,true)
    assert.equal(armed.frames[0].p[CH.shR],sampleClip(armed,armed.dur/2,makePose())[CH.shR],'equipment adapter stabilizes sword-side carry')
  }
  assert.ok(SPRINT_CLIP.dur < WALK_CLIP.dur)
  assert.ok(SPRINT_CLIP.frames[0].p[CH.rootRot] > WALK_CLIP.frames[0].p[CH.rootRot] + 0.09)
  assert.ok(PLAYER_GAIT.sprint.duty < 0.5, 'sprint must have an aerial interval')
  assert.ok(PLAYER_GAIT.walk.duty > 0.5, 'walk must have double support')
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
