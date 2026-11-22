import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DEFAULT_SIM_CLOCK, MAX_FRAME_DT } from '../src/game/core/sim-clock'
import { PROP_POOL_LIMIT, PROP_SPAWN_SEARCH_LIMIT, PropField } from '../src/game/world/props'
import { WAVE_SPAWN_SEARCH_LIMIT } from '../src/game/world/waves'
import { SACR_MASTER_K, SACR_MOBILE_K, SACR_V4_BIN_SLOTS, SACRUniformBuffer } from '../src/graphics/sacr/SACRPacker'
import { BRIDGE_PROGRAMS } from '../src/gpu/bridge-programs'

test('P0 work budgets stay bounded while the SACR v4 wire ABI remains unchanged', () => {
  assert.equal(MAX_FRAME_DT, 0.05)
  assert.equal(DEFAULT_SIM_CLOCK.maxSteps, 2)
  assert.equal(DEFAULT_SIM_CLOCK.maxBacklog, 2 / 60)
  assert.ok(PROP_SPAWN_SEARCH_LIMIT <= 8)
  assert.ok(WAVE_SPAWN_SEARCH_LIMIT <= 8)

  assert.deepEqual([SACR_MOBILE_K, SACR_MASTER_K], [4, 6])
  assert.equal(SACR_V4_BIN_SLOTS, 8)
  assert.equal(SACRUniformBuffer.BYTE_LENGTH, 3584)
  assert.match(BRIDGE_PROGRAMS.mobileRoad[1], /#define SACR_K 4/)
  assert.match(BRIDGE_PROGRAMS.masterRoad[1], /#define SACR_K 6/)
  assert.match(BRIDGE_PROGRAMS.masterBase[1], /#define SACR_K 6/)
  assert.match(BRIDGE_PROGRAMS.receiver[1], /#define SACR_K 6/)
})

test('prop placement has an unconditional safe fallback and a fixed-size reusable pool', () => {
  const makeCrowded = () => {
    const field = new PropField()
    field.reset(42)
    const internal = field as unknown as { hash: (n: number) => number; pickX: (px: number) => number; spawn: (px: number) => void }
    internal.hash = () => .5 // all eight sampled candidates land at 2020
    field.props.push({ id: 1, kind: 'fuel', x: 2020, hp: 0, dead: true, respawn: 20, hitAt: -10, born: 0 })
    return { field, internal, x: internal.pickX(1300) }
  }
  const a = makeCrowded(), b = makeCrowded()
  assert.equal(PROP_POOL_LIMIT, 6)
  assert.equal(a.x, b.x, 'the exhausted-search fallback must replay from the same seed')
  assert.ok(a.x >= 140 && a.x <= 2700)
  assert.ok(Math.abs(a.x - 1300) >= 220)
  assert.ok(Math.abs(a.x - 2020) >= 240)
  assert.ok(Math.abs(a.x - 1755) >= 170)
  assert.ok(Math.abs(a.x - 830) >= 110)

  for (let i = 0; i < 100; i++) {
    a.field.props[0].dead = true
    a.internal.spawn(1300)
    assert.ok(a.field.props.length <= PROP_POOL_LIMIT, 'destroyed arrivals are recycled instead of growing history')
  }
})

test('hot Canvas draw paths do not allocate radial gradients per frame', () => {
  for (const file of ['src/game/entities/player.ts', 'src/game/fx/lightning.ts',
    'src/game/render/bridge-shop-glass.ts', 'src/game/world/run-pickups.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /createRadialGradient/, `${file} has a hot-path radial gradient`)
  }
})
