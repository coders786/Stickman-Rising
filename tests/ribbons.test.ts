import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RibbonField,
  newProbe,
  DECK_W,
  DECK_H,
} from '../src/game/lighting/ribbons'
import { makeStageLights } from '../src/game/world/lightfield'
const light = { ...makeStageLights(null, 0)[0], x: 0, gain: 1, flicker: 0 }
const wall = { left: -50, right: 50, height: 130 }
const sample = (field: RibbonField, x = 0, h = 0) =>
  field.sample(x, -h, newProbe())
test('opaque silhouettes block, partial apertures feather, elevated receivers see over them', () => {
  const f = new RibbonField([light], [wall], 5),
    clear = new RibbonField([light], [], 5)
  assert.equal(sample(f).warm, 0)
  assert.ok(
    sample(f, 65).warm > 0 && sample(f, 65).warm < sample(clear, 65).warm,
  )
  assert.equal(sample(f, 0, 200).warm, sample(clear, 0, 200).warm)
  const twice = new RibbonField([light], [wall, wall], 5)
  assert.deepEqual(f.ribbons[0].direct, twice.ribbons[0].direct)
})
test('first diffuse return reaches a direct shadow; colours add instead of electing a winner', () => {
  const f = new RibbonField([light], [{ left: -13, right: 13, height: 100 }], 5)
  const p = sample(f)
  assert.equal(p.warm, 0)
  assert.ok(p.r > 0 && p.r > p.b)
  const blue = { ...light, kind: 'cool' as const },
    a = sample(new RibbonField([light], [])),
    b = sample(new RibbonField([blue], []))
  const both = sample(new RibbonField([light, blue], []))
  assert.equal(both.r, a.r + b.r)
  assert.equal(both.b, a.b + b.b)
})
test('changing gain does not rebake the receiver or leak stale values outside support', () => {
  const f = new RibbonField([{ ...light, flicker: 1 }], []),
    r = f.ribbons[0],
    direct = r.direct
  const p = sample(f),
    before = p.warm
  f.tick(1.37)
  f.sample(0, 0, p)
  assert.notEqual(p.warm, before)
  assert.equal(direct, r.direct)
  f.sample(1e4, 0, p)
  assert.equal(p.r + p.g + p.b, 0)
  assert.equal(p.caster, null)
})
test('deck irradiance is occluded, not a shared radial image', () => {
  const bake = (blocks: (typeof wall)[]) => {
    const px = new Uint8ClampedArray(DECK_W * DECK_H * 4)
    new RibbonField([light], blocks).ribbons[0].bakeDeck(px, 0)
    return px
  }
  const clear = bake([]),
    shadow = bake([wall])
  assert.ok(shadow.some((n, i) => i % 4 === 3 && n < clear[i]))
  assert.ok(shadow.some((n, i) => i % 4 === 3 && n > 0))
})
