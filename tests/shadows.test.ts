import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as lighting from '../src/game/render/lighting'
import { keyLightFromStorm } from '../src/game/render/lighting'
import { SHADOW_GLSL, SHADOW_BASE_FS, SHADOW_REDUCE_FS, SHADOW_GUARD_FS } from '../src/game/render/mountain-gl/html-gl'
import { readFileSync } from 'node:fs'

/** The 2D shadow engine was removed — mountain.html's own system (the
 * world-mask interval pyramid + the twelve-ray disk inside the lightfield)
 * casts every shadow now. These tests guard both halves of that swap. */

test('the 2D shadow engine is gone from the light module', () => {
  const removed = [
    'drawPropShadow',
    'drawCastShadow',
    'drawProjectedShadow',
    'composeShadowKey',
    'projectGroundPoint',
    'shadowKeyFromPoint',
  ]
  for (const name of removed) {
    assert.equal(name in lighting, false, `${name} must not be exported`)
  }
  // the light key itself stays — the strobe rim and the scene key consume it
  assert.equal(typeof lighting.keyLightFromStorm, 'function')
  assert.equal(typeof lighting.drawStrobeRim, 'function')
  assert.ok(lighting.DOOR_LIGHT && lighting.STREET_LIGHT)
})

test('nothing draws the removed engine any more', () => {
  const renderer = readFileSync(new URL('../src/game/render/renderer.ts', import.meta.url), 'utf8')
  assert.ok(!renderer.includes('drawPropShadow('), 'renderer must not call drawPropShadow')
  assert.ok(!renderer.includes('drawCastShadow('), 'renderer must not call drawCastShadow')
  assert.ok(!renderer.includes('.drawShadow('), 'renderer must not call the entities’ drawShadow')
  const player = readFileSync(new URL('../src/game/entities/player.ts', import.meta.url), 'utf8')
  assert.ok(!player.includes('drawProjectedShadow('), 'player must not project its own shadow')
  const enemy = readFileSync(new URL('../src/game/entities/enemy.ts', import.meta.url), 'utf8')
  assert.ok(!enemy.includes('drawProjectedShadow('), 'enemy must not project its own shadow')
})

test('the html transport ships the twelve-ray disk + the certificates', () => {
  assert.ok(SHADOW_GLSL.includes('SHADOW_DISK[12]'), 'the reference’s twelve-ray penumbra disk')
  assert.ok(SHADOW_GLSL.includes('planeCertificate'), 'the constant-range certificates')
  assert.ok(SHADOW_GLSL.includes('maskTransmission'), 'the world-mask transmission')
  assert.ok(SHADOW_GLSL.includes('shadowRotation'), 'the per-cell disk rotation')
  assert.ok(SHADOW_GLSL.includes('float worldShadow(vec2 ground)'), 'the receiver entry point')
})

test('the interval pyramid passes that feed the certificates are present', () => {
  for (const [name, src] of [['base', SHADOW_BASE_FS], ['reduce', SHADOW_REDUCE_FS], ['guard', SHADOW_GUARD_FS]] as const) {
    assert.ok(src.includes('uniform sampler2D u_src'), `${name} reads its source level`)
    assert.ok(src.includes('outColor='), `${name} writes its target`)
  }
  assert.ok(SHADOW_BASE_FS.includes('*4'), 'the base pass reduces 4×4')
  assert.ok(SHADOW_REDUCE_FS.includes('*2'), 'the reduce pass halves the grid')
  assert.ok(SHADOW_GUARD_FS.includes('u_guardOrigin'), 'the guard pass pads the window')
})

test('the light key stays finite and continuous through the bolt azimuth', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const light = keyLightFromStorm(bad, bad)
    assert.ok(Object.values(light).every((v) => typeof v === 'string' || Number.isFinite(v)))
  }
  let previous = 0
  for (let i = 0; i <= 200; i++) {
    const q = keyLightFromStorm(1, -1 + i / 100)
    assert.ok(Number.isFinite(q.dirX) && Number.isFinite(q.elev) && Number.isFinite(q.i))
    if (i > 0) assert.ok(Math.abs(q.dirX - previous) < 0.05, 'dirX sweeps continuously')
    previous = q.dirX
  }
})
