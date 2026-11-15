/** F07 — reflection atlas refresh identity. Old key was (span, quality):
 *  it aliased a same-width camera pan (content drawn world-translated by
 *  the old viewLeft), a moved/spawned actor inside an unchanged span, and
 *  reallocation compared reflPW AFTER assignment so a fresh empty plate
 *  never refreshed. See src/game/render/reflection-key.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reflectionRefreshKey, type ReflectionKeyInput } from '../src/game/render/reflection-key'

const base: ReflectionKeyInput = {
  spanW: 260,
  tier: 2,
  viewLeft: 1000,
  realloc: false,
  player: { id: -1, x: 1300, y: 0, face: 1, state: 'move' },
  enemies: [
    { id: -1, x: 1300, y: 0, face: 1, state: 'move' },
    { id: 12, x: 1500, y: 0, face: -1, state: 'chase' },
  ],
  enemyFrom: 1,
}

test('realloc forces a distinct key (fresh empty plate is dirty)', () => {
  const a = reflectionRefreshKey(base)
  const b = reflectionRefreshKey({ ...base, realloc: true })
  assert.notEqual(a, b)
})

test('camera origin is covered even when span and actors are unchanged', () => {
  const a = reflectionRefreshKey(base)
  const b = reflectionRefreshKey({ ...base, viewLeft: 1064 })
  assert.notEqual(a, b, 'same-width camera pan must refresh')
})

test('player root, facing and state are covered', () => {
  const a = reflectionRefreshKey(base)
  assert.notEqual(a, reflectionRefreshKey({ ...base, player: { ...base.player, x: base.player.x + 8 } }), 'root moved')
  assert.notEqual(a, reflectionRefreshKey({ ...base, player: { ...base.player, face: -1 } }), 'facing flipped')
  assert.notEqual(a, reflectionRefreshKey({ ...base, player: { ...base.player, state: 'attack' } }), 'state changed')
})

test('enemy membership and roots are covered', () => {
  const a = reflectionRefreshKey(base)
  const without = { ...base, enemies: [base.enemies[0]], enemyFrom: 1 }
  assert.notEqual(a, reflectionRefreshKey(without), 'membership change refreshes')
  const moved = {
    ...base,
    enemies: [base.enemies[0], { ...base.enemies[1], x: base.enemies[1].x + 16 }],
    enemyFrom: 1,
  }
  assert.notEqual(a, reflectionRefreshKey(moved), 'enemy root moved beyond quantization')
  const restate = {
    ...base,
    enemies: [base.enemies[0], { ...base.enemies[1], state: 'strike' }],
    enemyFrom: 1,
  }
  assert.notEqual(a, reflectionRefreshKey(restate), 'enemy state changed')
})

test('sub-quantization jitter may reuse the atlas (documented bound)', () => {
  const a = reflectionRefreshKey(base)
  // hero moves < 2 px, enemy < 4 px → same key (quantization contract)
  const jitter = {
    ...base,
    player: { ...base.player, x: base.player.x + 1 },
    enemies: [base.enemies[0], { ...base.enemies[1], x: base.enemies[1].x + 3 }],
    enemyFrom: 1,
  }
  assert.equal(a, reflectionRefreshKey(jitter), 'within quantization the atlas may hold')
})

test('identical scene yields an identical key (cache hits stay possible)', () => {
  assert.equal(reflectionRefreshKey(base), reflectionRefreshKey({ ...base, enemies: [...base.enemies] }))
})

test('quality tier changes the key', () => {
  assert.notEqual(reflectionRefreshKey(base), reflectionRefreshKey({ ...base, tier: 4 }))
})
