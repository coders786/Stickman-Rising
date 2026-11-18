import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeStageLights } from '../src/game/world/lightfield'
import { CyberBackground } from '../src/game/world/background'

test('amber specimen changes lamp color without moving the receiver source', () => {
  const [sign, lamp, ...rest] = makeStageLights(null, 52)
  const [reviewSign, reviewLamp, ...reviewRest] = makeStageLights(null, 52, true)
  assert.equal(lamp.kind, 'cool')
  assert.deepEqual(reviewLamp, { ...lamp, kind: 'warm', flicker: 0 })
  assert.deepEqual(reviewSign, sign)
  assert.deepEqual(reviewRest, rest)
})

test('specimen mutes reflected actor contrast without changing the seeded scene default', () => {
  assert.equal(new CyberBackground('ultra').actorReflectionGain(), 1)
  const specimen = new CyberBackground('ultra', undefined, { grade: 'deep-noir', amberSpecimen: true })
  assert.ok(specimen.actorReflectionGain() > 0 && specimen.actorReflectionGain() < 1)
})
