import assert from 'node:assert/strict'
import test from 'node:test'
import { LightningSystem, type RayReflector } from '../src/game/fx/lightning'

function countHits(bounces: number): number {
  const enemies: RayReflector[] = [100, 250, 400].map((x, id) => ({ x, y: 0, scale: 1, dead: false, spawning: false, id }))
  const system = new LightningSystem()
  // Hold each reflected leg on the same horizontal track so this test checks
  // the bounce budget, not the visual aim-assist's random candidate choice.
  ;(system as unknown as { pickReflection: (...args: never[]) => { dx: number; dy: number } }).pickReflection = () => ({ dx: 1, dy: 0 })
  let hits = 0
  system.cast({ enemies, minX: -1000, maxX: 1000 }, 0, -48, 1, 0, {
    color: '#b2e8ff', energy: 1, maxLen: 500, bounces, dmg: 1, hit: () => { hits++ },
  })
  assert.equal(system.count, 1, 'even a non-reflecting bolt retains its initial leg')
  return hits
}

test('lightning counts actual reflector mirrors, not the initial or terminal contact', () => {
  assert.equal(countHits(0), 1, 'zero reflections can still strike the first body')
  assert.equal(countHits(1), 2, 'one reflection reaches at most a second body')
  assert.equal(countHits(2), 3, 'two reflections reach at most a third body')
})

test('a zero-bounce visual cast still travels when there are no reflectors', () => {
  const system = new LightningSystem()
  system.cast({ enemies: [], minX: -1000, maxX: 1000 }, 0, -48, 1, 0, {
    color: '#b2e8ff', energy: 1, maxLen: 120, bounces: 0,
  })
  assert.equal(system.count, 1)
})
