/** M04 + M05 — projectile birth reset and swept collision.
 *  M04: a recycled projectile must not carry its previous life's
 *       interpolation history (old spawn() left finite px/py → alpha-lerp
 *       dragged the newborn across the screen).
 *  M05: collision must sweep the step segment with relative body motion —
 *       endpoint-only testing credited zero hits for a 1 440 px/s reflected
 *       bullet crossing a body inside one allowed 50 ms tick (the evidence
 *       witness reproduced below with actual speeds/geometry). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAYER_BODY, PLAYER_POS, ProjectilePool, type Projectile } from '../src/game/entities/projectiles'
import type { WorldRef } from '../src/game/core/types'
import type { Enemy } from '../src/game/entities/enemy'

function stubWorld(over: Partial<{
  strike: (dmg: number, dir: number, heavy: boolean, x: number) => boolean
  enemies: unknown[]
}> = {}) {
  const hits: { id: number; bx: number; by: number }[] = []
  const strikes: { dmg: number; x: number }[] = []
  const noop = () => {}
  const w = {
    time: 0, timeScale: 1, arenaMinX: -50000, arenaMaxX: 50000,
    quality: 'high' as const, gore: 'energy' as const,
    enemies: over.enemies ?? [],
    fx: { sparks: noop, embers: noop, burst: noop, shockwave: noop, impact: noop },
    audio: { play: noop },
    cam: { addTrauma: noop, zoomPulse: noop },
    input: { axisX: () => 0, axisY: () => 0, pressed: () => false, down: () => false, buffered: () => false, takeBuffered: () => false, pressStamp: () => -1 },
    projectiles: { spawn: noop },
    hitEnemy: (id: number, blade: { bx: number; by: number }) => {
      hits.push({ id, bx: blade.bx, by: blade.by })
      return { kind: 'hit' as const }
    },
    enemyStrikePlayer: (dmg: number, dir: number, heavy: boolean, x: number) => {
      strikes.push({ dmg, x })
      return over.strike ? over.strike(dmg, dir, heavy, x) : false
    },
    spawnProjectile: noop, addHitstop: noop, addSlowmo: noop, screenFlash: noop,
    onEnemyKilled: noop,
  } as unknown as WorldRef
  return { w, hits, strikes }
}

function fakeEnemy(id: number, x: number, y: number, scale = 1): Enemy {
  return {
    id, x, y, scale, dead: false, spawning: false,
    px: Number.NaN, py: Number.NaN,
  } as unknown as Enemy
}

test('M04: recycled projectile birth renders at its spawn point, not a ghost', () => {
  const pool = new ProjectilePool()
  const internals = pool as unknown as { list: Projectile[] }
  pool.spawn({ kind: 'bullet', x: 30, y: -40, vx: 10, vy: 0, dmg: 1, life: 99 })
  const first = internals.list[0]
  // let it drift, then recycle through clear()
  first.x = 100
  first.y = -50
  pool.clear()
  assert.equal(internals.list.length, 0)

  pool.spawn({ kind: 'bullet', x: 100, y: -50, vx: 0, vy: 0, dmg: 1, life: 99 })
  const reborn = internals.list[0]
  assert.equal(reborn, first, 'the pool recycles the object')
  assert.ok(!Number.isFinite(reborn.px), 'birth resets interpolation history to NaN')
  assert.ok(!Number.isFinite(reborn.py))

  // alpha-lerp must fall back to the actual position (fresh-birth contract)
  const cx = reborn.x
  pool.lerpRender(0.5)
  assert.equal(reborn.x, cx, 'a newborn never interpolates toward its previous life')
  pool.unlerpRender()
})

test('M04: fresh spawn also starts with NaN history (negative control)', () => {
  const pool = new ProjectilePool()
  const internals = pool as unknown as { list: Projectile[] }
  pool.spawn({ kind: 'orb', x: 30, y: -40, vx: 5, vy: 0, dmg: 1, life: 99 })
  const p = internals.list[0]
  assert.ok(!Number.isFinite(p.px))
  pool.lerpRender(0.5)
  assert.equal(p.x, 30)
  pool.unlerpRender()
})

test('M05: fast enemy bullet sweeps through the player body within one tick', () => {
  // endpoint-only control: bullet starts (-40,-45), vx 2000, dt .05 →
  // endpoint (60,-45): distance 60 from body center (0,-45) > radius 30 →
  // the old check MISSED. The segment crosses the body.
  PLAYER_POS.x = 0
  PLAYER_POS.y = 0
  PLAYER_BODY.x0 = 0; PLAYER_BODY.y0 = 0
  PLAYER_BODY.x1 = 0; PLAYER_BODY.y1 = 0
  const { w, strikes } = stubWorld({ strike: () => false })
  const pool = new ProjectilePool()
  pool.spawn({ kind: 'bullet', x: -40, y: -45, vx: 2000, vy: 0, dmg: 5, life: 2 }, false)

  const x1 = -40 + 2000 * 0.05
  const endDist = Math.hypot(x1 - PLAYER_POS.x, -45 - (PLAYER_POS.y - 45))
  assert.ok(endDist > 30, 'control: endpoint test really does miss')

  pool.update(0.05, w)
  assert.equal(strikes.length, 1, 'the swept body check must fire')
  assert.equal(pool.count, 0, 'bullet dies on a confirmed body contact')
})

test('M05: the evidence witness — reflected 1440 px/s bullet hits the enemy it used to miss', () => {
  // Actual source geometry from EVIDENCE.md: after a parry the bullet runs
  // vx −1440; one allowed 50 ms tick travels (0,−45)→(−72,−45) and passes
  // 11 px from enemy CENTER (−36,−34) with radius 30 — endpoint distance
  // ≈37.6 > 30 (zero hits), swept segment intersects the disc.
  // Enemy root y = 0 → body center y = 0 − 34·scale = −34.
  PLAYER_POS.x = 10
  PLAYER_POS.y = 0
  PLAYER_BODY.x0 = 10; PLAYER_BODY.y0 = 0
  PLAYER_BODY.x1 = 10; PLAYER_BODY.y1 = 0
  const enemy = fakeEnemy(7, -36, 0, 1)
  const { w, hits } = stubWorld({ enemies: [enemy] })
  const pool = new ProjectilePool()
  pool.spawn({ kind: 'bullet', x: 0, y: -45, vx: -1440, vy: 0, dmg: 10, life: 2 }, true)

  // endpoint-only distance for the same step (the old miss):
  const x1 = 0 + -1440 * 0.05
  const endDist = Math.hypot(x1 - enemy.x, -45 - (enemy.y - 34 * enemy.scale))
  assert.ok(endDist > 30 * enemy.scale, `control: endpoint test misses (${endDist.toFixed(1)} > 30)`)

  pool.update(0.05, w)
  assert.equal(hits.length, 1, 'swept contact must credit the hit')
  assert.equal(hits[0].id, 7)
  // contact lies on the swept segment before the enemy center
  assert.ok(hits[0].bx <= 0 && hits[0].bx >= -36, 'contact lies between start and the enemy')
  assert.equal(pool.count, 0, 'friendly projectile is spent on contact')
})

test('M05: a slow bullet that misses the body still misses (no fat hitboxes)', () => {
  PLAYER_POS.x = 0
  PLAYER_POS.y = 0
  PLAYER_BODY.x0 = 0; PLAYER_BODY.y0 = 0
  PLAYER_BODY.x1 = 0; PLAYER_BODY.y1 = 0
  const { w, strikes } = stubWorld({ strike: () => false })
  const pool = new ProjectilePool()
  pool.spawn({ kind: 'bullet', x: -40, y: -120, vx: 800, vy: 0, dmg: 5, life: 2 }, false)
  pool.update(0.05, w)
  assert.equal(strikes.length, 0, 'a clean miss must not contact')
  assert.equal(pool.count, 1, 'bullet continues')
})

test('M05: relative sweep catches an enemy crossing a stationary projectile', () => {
  PLAYER_POS.x = 0
  PLAYER_POS.y = 0
  PLAYER_BODY.x0 = 0; PLAYER_BODY.y0 = 0
  PLAYER_BODY.x1 = 0; PLAYER_BODY.y1 = 0
  // Stationary orb at (0,−45); enemy root sweeps 60→−60 during the tick,
  // crossing the orb. Body center y = e.y−34 = −45 → e.y = −11.
  // Endpoint-only: enemy ends at −60, distance 60 > 30 → MISS.
  // Relative sweep: crossing happens mid-step → HIT.
  const enemy = fakeEnemy(3, -60, -11, 1)
  enemy.px = 60
  const { w, hits } = stubWorld({ enemies: [enemy] })
  const pool = new ProjectilePool()
  pool.spawn({ kind: 'orb', x: 0, y: -45, vx: 0, vy: 0, dmg: 5, life: 2 }, true)

  const endDist = Math.hypot(0 - enemy.x, -45 - (enemy.y - 34 * enemy.scale))
  assert.ok(endDist > 30, 'control: endpoint test misses the crossed body')

  pool.update(0.05, w)
  assert.equal(hits.length, 1, 'relative motion sweep must catch the crossing')
})
