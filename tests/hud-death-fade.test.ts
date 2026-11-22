/** The death screen is a MODE change, not a slow frame: the in-game HUD ink is
 *  retired with one compositor transition and restored for the next run, so the
 *  terminal card never sits on top of a live score/sector panel. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { HUD, hudRegions, type HudState } from '../src/game/render/hud'
import { HUD_DEATH_FADE_MS, hudDeathOpacity, restoreHudInk, retireHudInk } from '../src/game/render/hud-fade'

const ink = (): { opacity: string; transition: string } => ({ opacity: '1', transition: '' })

test('the fade is a 200 ms ramp from full ink to none', () => {
  assert.equal(HUD_DEATH_FADE_MS, 200)
  assert.equal(hudDeathOpacity(0), 1)
  assert.equal(hudDeathOpacity(-5), 1)
  assert.ok(Math.abs(hudDeathOpacity(100) - .5) < 1e-9)
  assert.equal(hudDeathOpacity(200), 0)
  assert.equal(hudDeathOpacity(10_000), 0)
})

test('retiring ink uses one linear compositor transition; a new run clears it', () => {
  const style = ink()
  assert.equal(retireHudInk(style), 0)
  assert.equal(style.opacity, '0')
  assert.equal(style.transition, 'opacity 200ms linear')
  assert.equal(restoreHudInk(style), 1)
  assert.equal(style.opacity, '1')
  // A retry must not inherit the death fade.
  assert.equal(style.transition, 'none')
})

test('reduced motion reaches the same end state without animating', () => {
  const style = ink()
  retireHudInk(style, true)
  assert.equal(style.opacity, '0')
  assert.equal(style.transition, 'none')
})

function state(opacity: number, w: number): HudState {
  return {
    hp: 72, maxHp: 100, stamina: 80, maxStamina: 100, energy: 50, maxEnergy: 100,
    dashCharge: 1, slashCharge: 0, swordDrawn: true, fistStrike: 'punch',
    staminaCooldown: 0, meter: .4, swordName: 'KATANA / DRAWN', swordColor: '#fff',
    abilityName: 'CROSSING DRAW', abilityCost: 30,
    combo: { hits: 3, mult: 1.2, rank: 'C', timer: 1, timerMax: 3, rankUpT: 0, lastHitT: 0 },
    wave: 2, enemiesLeft: 4, kills: 9, score: 2048, boss: null, banner: null,
    executePrompt: null, ultReady: true, abilityReady: true, fps: 60, showFps: false,
    particleLevel: 2, runTime: 12, attract: false, opacity,
    route: { sector: 3, biome: 'VIADUCT', metres: 412, safe: false, gate: undefined } as unknown as HudState['route'],
    insets: { left: 0, top: 0, right: 0, bottom: 0 },
    width: w,
  } as unknown as HudState
}

test('a zero-opacity HUD layer paints no ink, and a restored one does', () => {
  const canvas = createCanvas(320, 200)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  const hud = new HUD()
  hud.drawLayer(ctx, 320, 200, state(0, 320), 1 / 60, 1)
  const blank = ctx.getImageData(0, 0, 320, 200).data
  assert.equal(blank.some(v => v !== 0), false, 'opacity 0 must leave the layer empty')

  // The same state with full ink must mark the vitality plate.
  const full = hud.drawLayer(ctx, 320, 200, state(1, 320), 1 / 60, 1)
  assert.equal(full, true)
  const painted = ctx.getImageData(0, 0, 320, 200).data
  assert.equal(painted.some(v => v !== 0), true, 'full ink must paint the HUD')

  // Fading changes the ink stamp, so a cached layer cannot stay opaque.
  const faded = hud.drawLayer(ctx, 320, 200, state(.5, 320), 1 / 60, 1)
  assert.equal(faded, true, 'a changed opacity must invalidate the cached layer')
})

test('the fade never moves HUD geometry', () => {
  const a = hudRegions(1180, 660, false), b = hudRegions(1180, 660, false)
  assert.deepEqual(a, b)
  assert.equal(a.vitality.x, 16)
})
