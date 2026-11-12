/** The empty-hand kit must STEP.
 *
 * Two separate defects are pinned here, because each one was invisible in
 * isolation and each broke the complaint the user actually made ("connect
 * more strikes"):
 *
 *  1. Every `unarmed*` def had `moveX: undefined` -> 0.0px of root advance.
 *     The fighter was a stationary turret whose feet slid forward in local
 *     space under a pinned root, while all seven reference sheets advance
 *     the fighter on every frame (`research/SPRITE-SHEETS.md`).
 *  2. The opposite failure: five chained steps walked the player THROUGH a
 *     chasing grunt (measured gap closing to -15px). Nothing separates a
 *     player's body from an enemy's, so the step itself must respect range.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import { Enemy } from '../src/game/entities/enemy'
import { resolveEnemyHit } from '../src/game/combat/hit-resolution'
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
import type { WorldRef } from '../src/game/core/types'

const noop = () => {}

function world(gap: number) {
  const input = new Input(), p = new Player(), fx = new FX()
  const enemies: Enemy[] = []
  const w = {
    time: 0, timeScale: 1, arenaMinX: -5000, arenaMaxX: 5000, enemies, input, fx,
    audio: { play: noop }, cam: { addTrauma: noop },
    hitEnemy: (id: number, _b: unknown, atk: never) =>
      resolveEnemyHit(enemies.find((x) => x.id === id)!, atk, p.face, p.x),
    enemyStrikePlayer: () => 'miss',
  } as unknown as WorldRef
  p.reset(400); p.swordDrawn = false
  const e = new Enemy('grunt', 400 + gap, 1)
  e.spawning = false; e.state = 'chase'; e.face = -1; e.hp = 999999
  // Pin the id: Enemy auto-assigns a global incrementing id, so without this
  // `hitEnemy` resolves against whichever enemy was constructed in an earlier
  // test and the hit is applied to nothing.
  e.id = 1
  enemies.push(e)
  return { p, w, e, input }
}

function throwOnce(id: string, gap: number, frames = 70) {
  const { p, w, e, input } = world(gap)
  p.startAttack(unarmedAttack((ATTACKS as unknown as Record<string, never>)[id]), w)
  const x0 = p.x, hp0 = e.hp
  let minGap = Infinity
  for (let f = 0; f < frames; f++) {
    w.time += 1 / 60; p.update(1 / 60, w); e.update(1 / 60, w); input.endFrame(1 / 60)
    minGap = Math.min(minGap, Math.abs(e.x - p.x))
  }
  return { advance: p.x - x0, hit: e.hp < hp0, minGap }
}

test('every empty-hand attack carries forward travel (no turrets)', () => {
  // The bug was a missing channel on every def, so assert on the DEF, not
  // on a sample: this catches a future move that forgets to step.
  for (const id of ['l1', 'l2', 'l3', 'l4', 'l5', 'h1', 'h2', 'h3']) {
    const a = unarmedAttack((ATTACKS as unknown as Record<string, never>)[id]) as {
      moveX?: number; moveXAt?: number; groundDrive?: { duration: number; acceleration: number }
    }
    assert.ok(a.moveX !== undefined && a.moveX !== 0, `${id} has no moveX`)
    if (a.moveX! > 0) {
      assert.ok(a.groundDrive, `${id} steps without a bounded drive`)
      assert.ok(a.groundDrive!.duration <= 0.26, `${id} drive eats the recovery beat`)
      assert.ok(a.moveXAt! >= 0 && a.moveXAt! < 0.3, `${id} step fires outside the clip`)
    }
  }
})

test('a light strike steps in but never walks through its target', () => {
  // At a real combat standoff the strike must close distance...
  const near = throwOnce('l1', 34)
  assert.ok(near.hit, 'jab at 34px must connect')
  assert.ok(near.minGap > 8, `jab overran the body (minGap ${near.minGap.toFixed(0)}px)`)

  // ...and each individual light steps a bounded amount, so a 5-hit string
  // (~150px of naive travel) can never outrun a 34px standoff.
  for (const id of ['l1', 'l2', 'l3', 'l4', 'l5']) {
    const r = throwOnce(id, 260) // far away: the clamp never binds, full step
    assert.ok(r.advance > 5, `${id} barely moved (${r.advance.toFixed(1)}px)`)
    assert.ok(r.advance < 55, `${id} steps too far for a string (${r.advance.toFixed(1)}px)`)
  }
})

test('the step is range-aware: it stops short of a body already in reach', () => {
  const inReach = throwOnce('l3', 34)
  const farAway = throwOnce('l3', 300)
  assert.ok(farAway.advance > inReach.advance + 10,
    `clamp did not engage (in-reach ${inReach.advance.toFixed(1)} vs far ${farAway.advance.toFixed(1)})`)
})

test('the full light string connects most of its strikes against a chaser', async () => {
  // The end-to-end acceptance: the user's complaint was that a string falls
  // apart after the first hit. Re-run the live harness a few times -- it is
  // deliberately unseeded (see .qa/combo-live.ts on why seeding pins the
  // grunt's orbit side and produces one deterministic standoff).
  const { run } = await import('../.qa/combo-live')
  const landed: number[] = []
  for (let k = 0; k < 5; k++) landed.push(run(['l1', 'l2', 'l3', 'l4', 'l5']).landed)
  landed.sort((a, b) => a - b)
  const median = landed[Math.floor(landed.length / 2)]
  assert.ok(median >= 10,
    `light string only connected ${median} times: ${JSON.stringify(landed)}`)
})

test('a connecting strike puts the striking joint ON the body, not near it', () => {
  // The complement to tests/blade-cleave.test.ts: that file asks whether the
  // EDGE reached the body, this asks whether the FIST did. An unarmed combo
  // that reports hits while the limb is short of the body is the "I punched
  // air and it flinched" read. Measured slack (distance from the striking
  // joint to the nearest body sphere, minus that sphere's radius) must be
  // inside the attack's own authored `pad`.
  for (const id of ['l1', 'l2', 'l3', 'l4', 'l5', 'h1', 'h2', 'h3']) {
    const { p, w, e, input } = world(34)
    const def = unarmedAttack((ATTACKS as unknown as Record<string, never>)[id]) as {
      hit: { pad?: number }
    }
    p.startAttack(unarmedAttack((ATTACKS as unknown as Record<string, never>)[id]), w)
    let slack = Infinity
    for (let f = 0; f < 120 && p.state === 'attack'; f++) {
      // sheathed stance: updateBladeWorld writes the striking limb into
      // `this.blade` (not `limbSeg`, which is the drawn-blade-but-punching path)
      const limb = { bx: p.blade.bx, by: p.blade.by, tx: p.blade.tx, ty: p.blade.ty }
      const bodyX = e.x, hp0 = e.hp
      w.time += 1 / 60; p.update(1 / 60, w); input.endFrame(1 / 60)
      if (e.hp < hp0) {
        let best = Infinity
        for (const sp of [{ oy: 14, r: 15 }, { oy: 48, r: 21 }, { oy: 78, r: 17 }]) {
          const cy = e.y - sp.oy * e.scale
          best = Math.min(best, distSeg(bodyX, cy, limb) - sp.r * e.scale)
        }
        slack = best
        break
      }
    }
    assert.ok(slack !== Infinity, `${id} never connected at a 34px standoff`)
    const pad = def.hit.pad ?? 0
    assert.ok(slack <= pad, `${id} credited a hit ${slack.toFixed(1)}px from the body (pad ${pad})`)
  }
})

function distSeg(px: number, py: number, s: { bx: number; by: number; tx: number; ty: number }): number {
  const dx = s.tx - s.bx, dy = s.ty - s.by
  const L2 = dx * dx + dy * dy
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - s.bx) * dx + (py - s.by) * dy) / L2)) : 0
  return Math.hypot(px - (s.bx + t * dx), py - (s.by + t * dy))
}

test('every reachable empty-hand strike has a working range band, and lands ON the body in it', () => {
  // The acceptance criterion behind "connect more strikes", stated as a
  // property: every unarmed move the player can chain into must connect
  // somewhere useful AND put the striking joint on the body when it does.
  //
  // It must NOT be "connects at 34px". A lunging move needs room for its own
  // wind-up: measured, sakugaScorpion connects at 67-100px and misses at
  // 34px, srOnslaught at 50-100 and misses at 34 -- both correctly, because
  // at point-blank they are still travelling when their window closes. The
  // first version of this test asserted point-blank for every move and
  // reported those two as broken.
  const moves = ['l1', 'l2', 'l3', 'l4', 'l5', 'h1', 'h2', 'h3',
    'viperPalm', 'ironRoot', 'omegaPalm', 'sakugaScorpion', 'srOnslaught', 'srOmega']
  const failures: string[] = []
  for (const id of moves) {
    const def = unarmedAttack((ATTACKS as unknown as Record<string, never>)[id]) as {
      hit: { pad?: number }
    }
    const bands: number[] = []
    let bestSlackAt = Infinity, bestGap = -1
    for (const gap of [34, 50, 67, 85, 100, 120]) {
      const { p, w, e, input } = world(gap)
      p.startAttack(unarmedAttack((ATTACKS as unknown as Record<string, never>)[id]), w)
      for (let f = 0; f < 160; f++) {
        // pin the body: Enemy picks a random `side` in its constructor, so a
        // chasing grunt orbits away during these 1.33s clips and the result
        // goes flaky (measured: failed in 5 of 6 runs before pinning).
        e.x = 400 + gap
        const limb = { bx: p.blade.bx, by: p.blade.by, tx: p.blade.tx, ty: p.blade.ty }
        const bodyX = e.x, hp0 = e.hp
        w.time += 1 / 60; p.update(1 / 60, w); e.update(1 / 60, w); input.endFrame(1 / 60)
        if (e.hp < hp0) {
          let slack = Infinity
          for (const sp of [{ oy: 14, r: 15 }, { oy: 48, r: 21 }, { oy: 78, r: 17 }]) {
            const cy = e.y - sp.oy * e.scale
            slack = Math.min(slack, distSeg(bodyX, cy, limb) - sp.r * e.scale)
          }
          bands.push(gap)
          if (slack < bestSlackAt) { bestSlackAt = slack; bestGap = gap }
          break
        }
      }
    }
    if (!bands.length) { failures.push(`${id} (connects at no tested range)`); continue }
    if (bestSlackAt > (def.hit.pad ?? 0) + 1) {
      failures.push(`${id} (best contact ${bestSlackAt.toFixed(1)}px off at ${bestGap}px, pad ${def.hit.pad})`)
    }
  }
  assert.deepEqual(failures, [], failures.join('; '))
})
