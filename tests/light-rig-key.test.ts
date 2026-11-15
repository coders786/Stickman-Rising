/** F09 — light-map coherence signature must cover RGB. Old signature
 *  omitted color: changing only a point light's color (red → blue) kept an
 *  identical cached map while a fresh blue rig differed (the stale-RGB
 *  probe witness). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lightSignature, type LightInput, type RGB } from '../src/game/render/lights'

const base: LightInput[] = [
  { kind: 'dir', x: 100, y: 40, range: 0, intensity: 0.5, color: [186, 214, 236] },
  { kind: 'point', x: 300, y: 200, range: 260, intensity: 0.34, color: [255, 154, 77] },
]

test('changing only a light color changes the signature', () => {
  const a = lightSignature(1280, 720, [118, 126, 144], base)
  const red: RGB = [255, 0, 0]
  const blue: RGB = [0, 0, 255]
  const lightsRed = base.map((l, i) => (i === 1 ? { ...l, color: red } : l))
  const lightsBlue = base.map((l, i) => (i === 1 ? { ...l, color: blue } : l))
  const b = lightSignature(1280, 720, [118, 126, 144], lightsRed)
  const c = lightSignature(1280, 720, [118, 126, 144], lightsBlue)
  assert.notEqual(a, b, 'red color must invalidate the cache key')
  assert.notEqual(b, c, 'red and blue keys must differ')
  assert.notEqual(a, c)
})

test('identical inputs produce an identical signature (coherence)', () => {
  const a = lightSignature(1280, 720, [118, 126, 144], base)
  const b = lightSignature(1280, 720, [118, 126, 144], base.map((l) => ({ ...l })))
  assert.equal(a, b)
})

test('geometry, intensity, ambient and size all remain covered', () => {
  const a = lightSignature(1280, 720, [118, 126, 144], base)
  const moved = base.map((l, i) => (i === 1 ? { ...l, x: l.x + 4 } : l))
  const dimmer = base.map((l, i) => (i === 1 ? { ...l, intensity: l.intensity + 0.02 } : l))
  assert.notEqual(a, lightSignature(1280, 720, [118, 126, 144], moved), 'position covered')
  assert.notEqual(a, lightSignature(1280, 720, [118, 126, 144], dimmer), 'intensity covered')
  assert.notEqual(a, lightSignature(1280, 720, [100, 100, 100], base), 'ambient covered')
  assert.notEqual(a, lightSignature(640, 360, [118, 126, 144], base), 'size covered')
})
