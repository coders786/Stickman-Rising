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
test('save retains safe counters and valid blade order, dropping a malformed list', () => {
  const save = parseSave('{"totalKills":12,"best":9007199254740992,"unlocked":["inferno","katana","inferno","thunder"]}')
  assert.deepEqual(save, { totalKills: 12, best: 0, unlocked: ['katana', 'inferno', 'thunder'] })
  assert.deepEqual(parseSave('{"totalKills":7.5,"best":250,"unlocked":["inferno","bogus"]}'),
    { totalKills: 0, best: 250, unlocked: ['katana'] })
})
test('settings keep valid player choices, never a saved art preview or non-finite volume', () => {
  assert.deepEqual(parseSettings('{"quality":"low","qualityV":2,"level":"station","sfxVolume":1e400,"musicVolume":0,"muted":true,"showFps":true,"gore":"blood"}', true, 'medium'),
    { ...DEFAULT_SETTINGS, quality: 'low', musicVolume: 0, muted: true, showFps: true, gore: 'blood' })
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

test('fresh detection starts adaptive; all chosen presets and their locks survive reload', () => {
  assert.equal(parseSettings(null, false, 'medium').adaptiveQuality, true)
  assert.equal(parseSettings(null, true, 'low').adaptiveQuality, false) // Already at the floor.
  assert.equal(parseSettings('{"quality":"low","qualityV":2,"adaptiveQuality":true}', true, 'medium').adaptiveQuality, false)
  assert.equal(parseSettings('{"qualityV":3,"adaptiveQuality":"true"}').adaptiveQuality, false)
  for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
    for (const adaptiveQuality of [true, false]) {
      const preferences = { ...DEFAULT_SETTINGS, quality, adaptiveQuality }
      const raw = JSON.stringify({ ...preferences, qualityV: 3 })
      assert.deepEqual(parseSettings(raw, true, 'medium'), preferences)
    }
  }
})
