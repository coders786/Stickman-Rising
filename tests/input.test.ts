import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Input } from '../src/game/core/input'

test('disable/resume clears buffered attacks and touch axes', () => {
  const input = new Input()
  input.setVirtual('light', true)
  input.setVirtualAxis(1, -1)
  assert.equal(input.buffered('light'), true)
  input.setEnabled(false)
  input.setVirtual('heavy', true)
  input.setVirtualAxis(1, 1)
  assert.equal(input.axisX(), 0)
  assert.equal(input.axisY(), 0)
  input.setEnabled(true)
  assert.equal(input.pressed('light'), false)
  assert.equal(input.buffered('light'), false)
  assert.equal(input.down('heavy'), false)
  assert.equal(input.buffered('heavy'), false)
})
test('touch input clamps axes and rejects NaN', () => {
  const input = new Input()
  input.setVirtualAxis(10, -20)
  assert.equal(input.axisX(), 1)
  assert.equal(input.axisY(), -1)
  input.setVirtualAxis(NaN, Infinity)
  assert.equal(input.axisX(), 0)
  assert.equal(input.axisY(), 0)
})
test('an attack buffer can be consumed only once', () => {
  const input = new Input()
  input.setVirtual('light', true)
  assert.equal(input.takeBuffered('light'), true)
  assert.equal(input.takeBuffered('light'), false)
  input.endFrame(0)
  assert.equal(input.pressed('light'), false)
  assert.equal(input.down('light'), true)
})
