import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GRAPHICS_RULES } from '../src/game/render/rules'
import { DECK_VERT, DECK_FRAG } from '../src/game/render/mountain-gl/shaders'

/** UNIVERSAL GRAPHICS RULES — pinned so an accidental edit to the
 *  mandatory constants fails review, and so the reference port's systems
 *  (light falloff, occluder shadows, water waves) stay present. */

test('graphics rules pin the reference composition', () => {
  assert.equal(GRAPHICS_RULES.composition.HY, 0.74)
  assert.equal(GRAPHICS_RULES.composition.VPX, 0.565)
  assert.equal(GRAPHICS_RULES.composition.VPY, 0.34)
  assert.deepEqual([...GRAPHICS_RULES.depths.ranges], [0.1, 0.18, 0.29, 0.42])
  assert.equal(GRAPHICS_RULES.depths.mid, 0.06)
  assert.equal(GRAPHICS_RULES.depths.envBack, 110)
})

test('graphics rules carry the reference light/shadow/water laws', () => {
  assert.equal(GRAPHICS_RULES.light.falloffPower, 2)
  assert.equal(GRAPHICS_RULES.shadow.dirZScale, 0.55)
  assert.equal(GRAPHICS_RULES.water.trains.length, 3)
  assert.ok(GRAPHICS_RULES.bake.perFrame.includes('lighting'))
  assert.ok(GRAPHICS_RULES.bake.perFrame.includes('waterWaves'))
  assert.equal(GRAPHICS_RULES.order[0], 'sky')
  assert.ok(GRAPHICS_RULES.order.indexOf('deck') < GRAPHICS_RULES.order.indexOf('entities'))
})

test('shirogane derives its scene constants from the rules (mandatory)', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/game/world/shirogane.ts', import.meta.url)),
    'utf8',
  )
  assert.ok(src.includes('GRAPHICS_RULES.depths.envBack'), 'ENV_BACK must come from the rules')
  assert.ok(src.includes('GRAPHICS_RULES.composition.HY'), 'horizon ratio must come from the rules')
  assert.ok(src.includes('GRAPHICS_RULES.depths.ranges'), 'range depths must come from the rules')
  assert.ok(src.includes('GRAPHICS_RULES.depths.mid'), 'mid depth must come from the rules')
})

test('mountain-gl ports the reference systems', () => {
  // the shader host compiles the vertex + the fused deck compositor
  assert.ok(DECK_VERT.includes('aPos'))
  assert.ok(DECK_FRAG.includes('#version 300 es'))
  // SH_LIGHT_QUAD falloff law
  assert.ok(DECK_FRAG.includes('f * f'), 'quadratic falloff (rules.light.falloffPower)')
  // SH_DIRECTIONAL occluder interval walk
  assert.ok(DECK_FRAG.includes('keyOccluded'))
  assert.ok(DECK_FRAG.includes('t1 > t0'), 'light-space interval overlap test')
  // WATER_FS wave trains
  assert.ok(DECK_FRAG.includes('waveX'))
  assert.ok(DECK_FRAG.includes('0.148') && DECK_FRAG.includes('0.205') && DECK_FRAG.includes('0.511'))
  // the deck compositor is the only pass (no dead reference programs)
  assert.ok(DECK_FRAG.includes('uOcc['), 'occluder array uniform')
})
