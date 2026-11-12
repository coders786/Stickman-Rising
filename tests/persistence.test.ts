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
