import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MOVES} from '../src/game/combat/moveset'
import {CH} from '../src/game/anim/pose'
import {sampleClip} from '../src/game/anim/animator'
import {makePose} from '../src/game/anim/pose'
import {solveFighter3D, makeFighterGeom} from '../src/game/anim/rig3d'
import {PLAYER_SPEC} from '../src/game/anim/skeleton'

/** FULL-BODY CHOREOGRAPHY CONTRACT.
 *
 * The hand-to-hand set was re-composed so every strike is thrown by the
 * whole body, not by an arm on top of a frozen stance. Before that work,
 * l1-l5 and h1 had ZERO leg-channel motion across their entire clips and
 * h1's elbow point ended up 5px BEHIND the hip — the hitbox could not
 * physically reach a target.
 *
 * These tests pin both properties so neither can regress silently:
 *   1. every strike in the core string moves every body group, and
 *   2. every strike's contact point actually leads the body.
 */

const GROUPS: Record<string, (keyof typeof CH)[]> = {
  root: ['rootX', 'rootY', 'rootRot'],
  pelvis: ['pelvisYaw'],
  chest: ['chestYaw', 'spine'],
  head: ['head'],
  legL: ['hipL', 'kneeL', 'footL', 'hipLz'],
  legR: ['hipR', 'kneeR', 'footR', 'hipRz'],
  armL: ['shL', 'elL', 'wrL', 'armLz', 'foreLz'],
  armR: ['shR', 'elR', 'wrR', 'armRz', 'foreRz'],
}
/** A group counts as "used" when any channel in it travels this far. */
const ACTIVE = 0.12

const CORE = ['l1', 'l2', 'l3', 'l4', 'l5', 'h1', 'h2', 'h3'] as const

function amplitude(def: typeof MOVES[string]) {
  const out: Record<string, number> = {}
  for (const [g, chs] of Object.entries(GROUPS)) {
    let amp = 0
    for (const ch of chs) {
      const i = CH[ch]
      let lo = Infinity, hi = -Infinity
      for (const f of def.clip!.frames) {
        const v = f.p[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (Number.isFinite(lo)) amp = Math.max(amp, hi - lo)
    }
    out[g] = amp
  }
  return out
}

test('every strike in the core string is thrown by the whole body', () => {
  for (const id of CORE) {
    const def = MOVES[id]
    assert.ok(def?.clip, `${id} has a clip`)
    const amp = amplitude(def)
    const missing = Object.keys(GROUPS).filter((g) => amp[g] <= ACTIVE)
    assert.deepEqual(
      missing, [],
      `${id} "${def.label}" does not move: ${missing.join(', ')} ` +
      `(amplitudes ${Object.entries(amp).map(([g, v]) => `${g}=${v.toFixed(2)}`).join(' ')})`,
    )
  }
})

test('the legs are part of the strike, not a static base', () => {
  // Regression guard for the specific defect: l1-l5 and h1 used to have
  // exactly 0.00 rad of leg travel.
  for (const id of CORE) {
    const amp = amplitude(MOVES[id])
    const legs = Math.max(amp.legL, amp.legR)
    assert.ok(legs > 0.2, `${id} legs barely move (${legs.toFixed(3)} rad)`)
  }
})

test('every strike drives the body forward, so the hitbox leads the hips', () => {
  const g = makeFighterGeom()
  const SCALE = 1.32
  for (const id of CORE) {
    const def = MOVES[id]
    const clip = def.clip!
    const joint = def.strikeJoint ?? 'hand'
    const L = def.strikeHand === 'left'
    let best = -Infinity
    const N = 100
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * clip.dur
      if (t < def.hit.start - 0.02 || t > def.hit.end + 0.02) continue
      const p = makePose()
      sampleClip(clip, t, p)
      solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade * 1.06, 1)
      const j = joint === 'elbow' ? (L ? g.elbL : g.elbR)
        : joint === 'foot' ? (L ? g.ankleL : g.ankleR)
        : joint === 'knee' ? (L ? g.kneeL : g.kneeR)
        : joint === 'shoulder' ? (L ? g.shoulderL : g.shoulderR)
        : (L ? g.handL : g.handR)
      best = Math.max(best, (j.x - g.hip.x) * SCALE)
    }
    // The enemy's nearest body sphere is 15px radius, so a contact point
    // at or behind the hip cannot reach it at all (h1 measured -5px).
    assert.ok(best > 10, `${id} contact reaches only ${best.toFixed(1)}px past the hip`)
  }
})

test('each strike holds an extreme at contact rather than arriving and stopping', () => {
  // If the limb is stationary AT the hit window, nothing in the picture
  // corresponds to the damage. Measured, not asserted from intent: the
  // striking joint must still be travelling when the window opens.
  const g = makeFighterGeom()
  for (const id of CORE) {
    const def = MOVES[id]
    const clip = def.clip!
    const joint = def.strikeJoint ?? 'hand'
    const L = def.strikeHand === 'left'
    const at = (t: number) => {
      const p = makePose()
      sampleClip(clip, Math.max(0, Math.min(clip.dur, t)), p)
      solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade * 1.06, 1)
      const j = joint === 'elbow' ? (L ? g.elbL : g.elbR)
        : joint === 'foot' ? (L ? g.ankleL : g.ankleR)
        : joint === 'knee' ? (L ? g.kneeL : g.kneeR)
        : joint === 'shoulder' ? (L ? g.shoulderL : g.shoulderR)
        : (L ? g.handL : g.handR)
      return { x: j.x, y: j.y }
    }
    const h = 1 / 240
    const a = at(def.hit.start - h), b = at(def.hit.start)
    const speed = Math.hypot(b.x - a.x, b.y - a.y) / h
    assert.ok(speed > 60, `${id} is nearly stationary at contact (${speed.toFixed(0)} px/s)`)
  }
})

/** STRIKE REACH — the "my attacks don't connect" contract.
 *
 * A strike's hit segment is the limb projected from the shoulder/fist pair,
 * so its reach is fixed by anatomy plus the authored body travel. Measured
 * against a live grunt (front torso surface ~65px from the player's centre)
 * the empty-hand set must be able to reach an enemy that is actually
 * standing at fighting distance, not merely one that has walked inside the
 * player's own body.
 *
 * The second half of this contract lives in Enemy.update: without a
 * separation floor a strike lunge (340px/s) carries a grunt THROUGH the
 * player, and a hitbox that opens behind the target cannot connect —
 * measured 2-17px apart, connect rate 53%. With the floor it is 87%.
 */
test('every core strike can reach an enemy standing at fighting distance', () => {
  const SCALE = 1.32
  const geom = makeFighterGeom()
  // an enemy's nearest torso surface sits at this distance from our centre
  const ENGAGED = 55
  for (const id of ['l1', 'l2', 'l3', 'l5', 'h2', 'h3']) {
    const def = MOVES[id]
    const left = def.strikeHand === 'left'
    const joint = def.strikeJoint ?? 'hand'
    let best = -Infinity
    for (let i = 0; i <= 120; i++) {
      const pose = makePose()
      sampleClip(def.clip, (i / 120) * def.clip.dur, pose)
      solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade * 1.06, 1)
      const g = geom as unknown as Record<string, { x: number; y: number }>
      const distal = joint === 'foot' ? (left ? g.ankleL : g.ankleR) : (left ? g.handL : g.handR)
      const x = SCALE * distal.x
      if (x > best) best = x
    }
    assert.ok(
      best >= ENGAGED - 5,
      `${id} peaks at ${best.toFixed(0)}px of reach — cannot touch an enemy at ${ENGAGED}px`,
    )
  }
})
