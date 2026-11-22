import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceSimClock } from '../src/game/core/sim-clock'
import { BRIDGE_CLIMATE, composeBridgeRun, SHELTER_KIT } from '../src/game/stage/run-layout'
import { ROAD } from '../src/game/stage/road-section'
import { BEACON_X, PRACTICAL_LAMP_X, PRACTICAL_SIGN_X } from '../src/game/world/lightfield'
import { FLAT_LANE } from '../src/game/stage/flat-lane'
import { ExposureMap } from '../src/game/world/exposure'
import { ENV_TICK, EnvironmentFront, environmentRandom } from '../src/game/world/fronts'
import { SceneFront } from '../src/game/world/scene-front'
import { WEATHER_ORDER } from '../src/game/world/weather'

function replayAt(hz: number) {
  const climate = new EnvironmentFront(42, BRIDGE_CLIMATE)
  let acc = 0
  for (let i = 0; i < 38 * hz; i++) {
    const next = advanceSimClock(acc, 1 / hz)
    acc = next.acc
    climate.advance(next.steps)
    climate.interpolate(acc / ENV_TICK)
  }
  return climate
}

test('the same accepted ticks produce the same front at 30, 60 and 120 Hz', () => {
  const a = replayAt(30), b = replayAt(60), c = replayAt(120)
  assert.equal(a.sample.tick, 38 * 60)
  assert.deepEqual(a.sample, b.sample)
  assert.deepEqual(a.sample, c.sample)
  assert.ok(Math.abs(a.driftX - b.driftX) < 1e-8 && Math.abs(a.time - c.time) < 1e-8)
  assert.ok(a.sample.changes >= 1)
  const held = { ...a.sample }
  a.advance(0); a.interpolate(.77)
  assert.deepEqual(a.sample, held, 'view sample without a play tick changed climate')
})

test('a long run has legal adjacent fronts, bounded dwell, and no new flash schedule', () => {
  for (let seed = 0; seed < 6; seed++) {
    const a = new EnvironmentFront(seed, BRIDGE_CLIMATE)
    let prev = a.sample.kind, seen = 0, onset = -Infinity
    for (let t = 0; t < 60 * 600; t++) {
      a.advance(1)
      const s = a.sample
      assert.ok(s.rain >= 0 && s.rain <= 1 && s.cloud >= 0 && s.cloud <= 1 && s.wet >= 0 && s.wet <= 1)
      if (s.changes === seen) continue
      assert.equal(Math.abs(WEATHER_ORDER.indexOf(s.kind) - WEATHER_ORDER.indexOf(prev)), 1)
      assert.ok(s.tick >= onset + 20 * 60)
      assert.equal(s.startTick, s.tick)
      seen = s.changes; prev = s.kind; onset = s.tick
    }
    assert.ok(seen > 15, 'an indefinitely held one-band fixture would not prove the clock')
  }
})

test('bank lead-in precedes rain, and wet receiver memory outlasts the return to drizzle', () => {
  const f = new EnvironmentFront(8, BRIDGE_CLIMATE)
  const opening = { ...f.sample }
  f.advance(11 * 60)
  assert.equal(f.sample.kind, 'rain')
  assert.ok(f.sample.cloud > opening.cloud)
  assert.equal(f.sample.rain, opening.rain)
  f.advance(13 * 60)
  const settled = { ...f.sample }
  assert.equal(settled.s, 1)
  assert.ok(settled.key < opening.key && settled.rain > opening.rain)
  assert.ok(settled.wet > opening.wet && settled.wet < .82)
  f.advance(32 * 60)
  assert.equal(f.sample.kind, 'drizzle')
  assert.equal(f.sample.rain, opening.rain)
  assert.ok(f.sample.wet > opening.wet + .15)
})

test('new dry starts truly do not emit precipitation; independent seeds never use the world RNG', t => {
  t.mock.method(Math, 'random', () => assert.fail('front sampled ambient RNG'))
  const dry = { ...BRIDGE_CLIMATE, openings: ['clear'] as const }
  const a = new EnvironmentFront(0, dry)
  assert.equal(a.sample.rain, 0)
  const b = new EnvironmentFront(0xffffffff, dry)
  assert.equal(b.sample.rain, 0)
  const seed = a.sample.seed
  const sky = Array.from({ length: 100 }, (_, i) => environmentRandom(seed, 0x7f0bd0a5, i))
  assert.ok(new Set(sky).size === sky.length)
  const same = new EnvironmentFront(seed, dry)
  a.advance(2300); same.advance(2300)
  assert.deepEqual(a.sample, same.sample)
  assert.throws(() => a.advance(-1), RangeError)
  assert.throws(() => new EnvironmentFront(0, { ...dry, duration: -2 }), /Invalid temperate front/)
  assert.throws(() => new EnvironmentFront(0, { ...dry, dwell: [20, 1e20] }), /Invalid temperate front/)
})

test('the layout is deterministic, varied, and stays on one fixed lane for many seeds', t => {
  t.mock.method(Math, 'random', () => assert.fail('layout sampled ambient RNG'))
  const seen = new Set<number>(), sides = new Set<number>()
  for (let seed = 0; seed < 1024; seed++) {
    const plan = composeBridgeRun(seed)
    assert.deepEqual(plan, composeBridgeRun(seed))
    assert.equal(plan.seed, seed)
    assert.deepEqual(plan.exposure.zones.map(z => z.material),
      ['wet-asphalt', 'matte-paving', 'wet-asphalt', 'matte-paving', 'wet-asphalt'])
    assert.equal(plan.exposure.left, FLAT_LANE.artLeft - FLAT_LANE.artOverhang)
    assert.equal(plan.exposure.right, FLAT_LANE.artRight + FLAT_LANE.artOverhang)
    assert.ok(plan.shelters[0].right + 2 * plan.exposure.feather < plan.shelters[1].left)
    assert.equal(plan.exposure.at(FLAT_LANE.entryX).id, 'concourse')
    for (const roof of plan.shelters) {
      const kit = SHELTER_KIT[roof.kind], zone = plan.exposure.at(roof.left)
      assert.deepEqual([roof.kind, roof.left, roof.right], [zone.id, zone.left, zone.right])
      assert.equal(zone.splashes, false)
      assert.equal(zone.access.precipitation, 0)
      assert.equal(roof.right - roof.left, kit.width)
      assert.equal(roof.source.x, roof.left + kit.lampX)
      assert.equal(roof.source.y + ROAD.fixtureOffset, kit.lampY)
      assert.equal(roof.source.flicker, 0)
      assert.ok(roof.left > FLAT_LANE.waveLeft && roof.right < FLAT_LANE.waveRight)
      assert.ok([PRACTICAL_LAMP_X, BEACON_X, PRACTICAL_SIGN_X].every(x => x < roof.left - 60 || x > roof.right + 60))
      if (roof.kind === 'service') sides.add(Math.sign(roof.left - FLAT_LANE.entryX))
      else seen.add(roof.left)
    }
  }
  assert.ok(seen.size >= 70)
  assert.deepEqual([...sides].sort(), [-1, 1])
  assert.deepEqual(composeBridgeRun(-1), composeBridgeRun(0xffffffff))
})

test('all eaves share hard receiver boundaries and soft light/audio handoffs', () => {
  const { exposure } = composeBridgeRun(8)
  const front = new SceneFront(BRIDGE_CLIMATE, exposure, 8)
  assert.equal(exposure.runoff.length, 4)
  for (const { x, side } of exposure.runoff) {
    const exterior = x + 45 * side, interior = x - 45 * side
    assert.equal(exposure.at(x + .001 * side).access.precipitation, 1)
    assert.equal(exposure.at(x - .001 * side).access.precipitation, 0)
    assert.ok(front.wetnessAt(x + .001 * side) > 0)
    assert.equal(front.wetnessAt(x - .001 * side), 0)
    assert.ok(front.keyWeightAt(exterior) > front.keyWeightAt(interior) && front.keyWeightAt(interior) > .44)
    assert.ok(front.rainAudioAt(exterior) > front.rainAudioAt(interior))
    assert.ok(Math.abs(front.rainAudioAt(x - .001) - front.rainAudioAt(x + .001)) < .002)
  }
  const [open, under] = exposure.zones
  assert.throws(() => new ExposureMap([open, { ...under, left: open.right + 3 }], 20), /Bad receiver zone/)
  assert.throws(() => new ExposureMap([{ ...under, splashes: true }], 10), /Bad receiver zone/)
  front.advance(143, 1)
  const westBay = composeBridgeRun(42)
  assert.ok(front.wetnessAt(400) > 0)
  front.reset(42, westBay.exposure)
  assert.equal(front.wetnessAt(400), 0, 'the new run retained an old exposure clip')
  assert.deepEqual(front.clock.sample, new EnvironmentFront(42, BRIDGE_CLIMATE).sample)
})
