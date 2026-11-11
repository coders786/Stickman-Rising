import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Animator,sampleClip} from '../src/game/anim/animator'
import {WALK_CLIP,RUN_CLIP,SPRINT_CLIP} from '../src/game/anim/clips'
import {makePose} from '../src/game/anim/pose'
import {solveFighter3D,makeFighterGeom} from '../src/game/anim/rig3d'
import {PLAYER_SPEC} from '../src/game/anim/skeleton'
import {DASH_VARIANTS} from '../src/game/combat/dash'
import {DashBody} from '../src/game/physics/dash-body'

/* MOVEMENT RHYTHM — restored after the gait planner was deleted.
 *
 * The original file imported GaitPlanner and was removed wholesale with the
 * legik module. Three of its four tests never depended on the planner at all:
 * they pin the DASH motor (still very much alive in physics/dash-body.ts) and
 * the fact that every dash clip plays to completion. Those are restored here,
 * with the gait-clock test re-expressed against the clips themselves — which
 * is where the cadence now lives. */

const GROUND = PLAYER_SPEC.thigh + PLAYER_SPEC.shin
const geom = makeFighterGeom()

/** Lowest foot height in local units (+ = through the floor, − = clear of it). */
function footHeight(clip: typeof WALK_CLIP, t: number): number {
  const pose = sampleClip(clip, t, makePose())
  solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
  return Math.max(geom.ankleL.y, geom.ankleR.y, geom.toeL.y, geom.toeR.y) - GROUND
}

test('each authored gait cycle contains exactly two footfalls', () => {
  // A stride cycle is two steps: one per foot. This is the invariant the
  // deleted GaitPlanner was enforcing; now it is a property of the keyframes,
  // so assert it directly rather than trusting a planner to generate it.
  for (const [name, clip, minDur, maxDur] of [
    ['walk', WALK_CLIP, 0.9, 1.2],
    ['run', RUN_CLIP, 0.4, 0.65],
    ['sprint', SPRINT_CLIP, 0.45, 0.7],
  ] as const) {
    assert.ok(clip.loop, `${name} loops`)
    assert.ok(clip.dur >= minDur && clip.dur <= maxDur, `${name} dur ${clip.dur}`)
    // A STEP is a foot passing from behind the pelvis to in front of it.
    // That is the gait-cycle invariant that survives deleting the planner:
    // one step per foot per cycle. (Counting floor-contact transitions does
    // not work — a walk never loses ground contact, so nothing ever lands.)
    const n = 720
    const rel: { l: number; r: number }[] = []
    for (let i = 0; i < n; i++) {
      const pose = sampleClip(clip, clip.dur * i / n, makePose())
      solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
      const hipX = (geom.hipPtL.x + geom.hipPtR.x) / 2
      rel.push({ l: geom.ankleL.x - hipX, r: geom.ankleR.x - hipX })
    }
    const steps = (k: 'l' | 'r') => {
      let c = 0
      for (let i = 1; i < n; i++) if (rel[i - 1][k] < 0 && rel[i][k] >= 0) c++
      return c
    }
    assert.equal(steps('l'), 1, `${name}: left foot takes one step per cycle`)
    assert.equal(steps('r'), 1, `${name}: right foot takes one step per cycle`)
  }
})

test('walk keeps double support and sprint spends real time airborne', () => {
  // Duty factor is what separates a walk from a run from a sprint. Measured
  // off the authored clips: walk should never leave the ground, sprint must.
  const bothFeetClear = (clip: typeof WALK_CLIP, threshold: number) => {
    let clear = 0
    const n = 480
    for (let i = 0; i < n; i++) if (footHeight(clip, clip.dur * i / n) < -threshold) clear++
    return clear / n
  }
  const walkAir = bothFeetClear(WALK_CLIP, 2)
  const sprintAir = bothFeetClear(SPRINT_CLIP, 2)
  assert.equal(walkAir, 0, `walk never leaves the ground (${(walkAir * 100).toFixed(1)}% airborne)`)
  assert.ok(sprintAir > 0.02, `sprint has a flight phase (${(sprintAir * 100).toFixed(1)}% airborne)`)
})

test('dash acceleration has a visible load, burst and slower catch', () => {
  // The load/burst/catch envelope is pinned on the LAUNCH variant, which is
  // the forward dash the timing was tuned against. The other variants carry
  // their own durations by design (retreat/air are deliberately shorter,
  // pivot is deliberately longer), so a single dur band across all of them
  // would be asserting a rule the game does not have.
  const cfg = DASH_VARIANTS.launch, a = cfg.anticipation!
  assert.ok(cfg.dur >= 0.25 && cfg.dur <= 0.28, 'compact action without a long recovery')
  assert.ok(cfg.dur * a > 0 && cfg.dur * a < 0.01, 'minimal planted load for responsive movement')
  const body = new DashBody(cfg, 0, 0, 1, 0, true)
  body.step(cfg.dur * a, true)
  assert.ok(body.vx < 1, 'the load has no instant burst')
  while (body.progress < 0.67) body.step(1 / 480, true)
  const peak = body.vx
  assert.ok(peak > 700, `burst reaches ${peak.toFixed(0)}`)
  while (body.progress < 1) body.step(1 / 480, true)
  assert.ok(body.vx < peak - 150, 'ground catch dissipates speed without a hard exit cut')
})

test('every dash variant plays its clip to the authored recovery', () => {
  // The dash clip's OWN duration is the performance; nothing retimes it.
  // A variant whose blend speed cannot reach the end of its clip would
  // freeze mid-recovery when the state ends.
  for (const [name, variant] of Object.entries(DASH_VARIANTS)) {
    const animator = new Animator()
    animator.play(variant.clip, { blend: 0, speed: variant.clip.dur / variant.dur })
    animator.update(variant.dur)
    assert.ok(animator.progress() > 0.999, `${name} reaches its authored recovery (${animator.progress().toFixed(3)})`)
  }
})
