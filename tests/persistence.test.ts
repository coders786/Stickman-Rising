import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSave, parseSettings, readStorage, writeStorage } from '../src/lib/persistence'
import { DEFAULT_SETTINGS } from '../src/game/core/types'

test('corrupt or incomplete saves always recover safe counters and katana', () => {
  for (const raw of [null, '{', 'null', '[]', '{"unlocked":null}', '{"totalKills":-1,"best":"bad"}']) {
    const save = parseSave(raw)
    assert.equal(save.totalKills, 0)
    assert.equal(save.best, 0)
    assert.deepEqual(save.unlocked, ['katana'])
  }
  assert.deepEqual(parseSave('{"totalKills":12,"best":30,"unlocked":["katana","katana"]}'), { totalKills: 12, best: 30, unlocked: ['katana'] })
})
test('settings reject invalid types/ranges and retain valid fields', () => {
  assert.deepEqual(parseSettings('null'), DEFAULT_SETTINGS)
  const settings = parseSettings('{"musicVolume":-1,"sfxVolume":"loud","quality":"ultra","shake":false,"gore":null}', true)
  assert.equal(settings.quality, 'ultra')
  assert.equal(parseSettings('{"quality":"impossible"}', true).quality, 'medium')
  assert.equal(settings.shake, false)
  assert.equal(settings.musicVolume, DEFAULT_SETTINGS.musicVolume)
  assert.equal(settings.sfxVolume, DEFAULT_SETTINGS.sfxVolume)
  assert.equal(settings.gore, 'energy')
  assert.equal(parseSettings('{"shakeIntensity":1.5}').shakeIntensity, 1.5)
})
test('storage access safely fails outside the browser', () => {
  assert.equal(readStorage('key'), null)
  assert.equal(writeStorage('key', 'value'), false)
})

test('settings: a legacy "low" is not treated as a choice', () => {
  // Before this build, 'low' was the hard-coded default, so every returning
  // player has it saved. It must not pin them to the cheapest tier forever.
  const legacy = JSON.stringify({ quality: 'low', shake: true })
  const detected = parseSettings(legacy, false, 'high')
  assert.equal(detected.quality, 'high', 'a legacy default was treated as a choice')

  // A choice made AFTER migration is honoured, even when it is 'low'.
  const chosen = JSON.stringify({ quality: 'low', qualityV: 2 })
  assert.equal(parseSettings(chosen, false, 'high').quality, 'low')

  // No detection available (SSR / headless): keep what was saved.
  assert.equal(parseSettings(legacy, false, undefined).quality, 'low')

  // A legacy record that is NOT the old default is a real choice.
  const saved = JSON.stringify({ quality: 'ultra' })
  assert.equal(parseSettings(saved, true, 'medium').quality, 'ultra')
})
