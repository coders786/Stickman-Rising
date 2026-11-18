import { makeSkelGeom } from '../src/game/anim/skeleton'
/** STICKMAN RISING — tests/shadows.test.ts
 * The shadow system's laws (render/shadows.ts) and the graphics table
 * (render/graphics.ts).
 * ----------------------------------------------------------------------------
 * Two kinds of assertion here:
 *  · GEOMETRY — a shadow is long when the light is low and far, short when the
 *    body is under it; it fades as the body rises; it falls away from the light.
 *  · BUDGET — the number of canvas fills a tier spends is the number the table
 *    promises. That is what stops "we'll optimise later" from becoming a frame
 *    time regression on a phone: the pass count is asserted, not hoped for.
 * ==========================================================================*/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FIGURE_H, SHADOW_TUNING, airborneOffset, drawCastShadow, drawContactAO, shadowAlpha,
  shadowLength, silhouetteMatrix, usesCastShadow, usesPropShadows,
} from '../src/game/render/shadows'
import { GRAPHICS, classifyDevice, clampTier, featuresFor, tierIndex } from '../src/game/render/graphics'
import type { Tier } from '../src/game/render/graphics'

/** A recording 2D-context stand-in: counts the fills a painter performs. */
function recorder(): { ctx: CanvasRenderingContext2D; fills: () => number; saves: () => number; restores: () => number } {
  let fills = 0
  let saves = 0
  let restores = 0
  const noop = (): void => {}
  const ctx = {
    save: () => { saves++ },
    restore: () => { restores++ },
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    ellipse: noop, arc: noop, fill: () => { fills++ }, stroke: noop,
    fillRect: noop, drawImage: noop, translate: noop, scale: noop, transform: noop, setTransform: noop,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', filter: 'none',
  } as unknown as CanvasRenderingContext2D
  return { ctx, fills: () => fills, saves: () => saves, restores: () => restores }
}

test('shadows: length grows with reach and stays inside the authored band', () => {
  let prev = 0
  for (const r of [0, 0.1, 0.3, 0.6, 0.9, 1.25]) {
    const len = shadowLength(FIGURE_H, r)
    assert.ok(len >= FIGURE_H * SHADOW_TUNING.minLength - 1e-6)
    assert.ok(len <= FIGURE_H * SHADOW_TUNING.maxLength + 1e-6)
    if (r > 0) assert.ok(len > prev, `length did not grow at reach ${r}`)
    prev = len
  }
  // Under the key: a short blob. Far from it: a shadow over the body's own height,
  // which is what makes a low sun read as a low sun.
  assert.ok(shadowLength(FIGURE_H, 0.28) < FIGURE_H * 0.6)
  assert.ok(shadowLength(FIGURE_H, 1.25) > FIGURE_H * 1.2)
  // Degenerate input is clamped, not propagated.
  assert.ok(Number.isFinite(shadowLength(NaN, NaN)))
  assert.ok(shadowLength(1, 0) > 0)
})

test('shadows: a rising body fades, and a high one is invisible', () => {
  const ground = shadowAlpha(0.5, 0)
  assert.ok(ground > 0.4, 'a standing figure must have a real shadow')
  let prev = ground
  for (const y of [-10, -40, -80, -140, -190]) {
    const a = shadowAlpha(0.5, y)
    assert.ok(a < prev, `alpha did not fall at height ${-y}`)
    prev = a
  }
  assert.equal(shadowAlpha(0.5, -200), 0)
  assert.equal(shadowAlpha(0.5, -400), 0)
  // Above the deck it still has SOME shadow (a jump is not a teleport) ...
  assert.ok(shadowAlpha(0.5, -60) > 0.1)
  // ... and the airborne offset slides the tip along the light, never against it.
  assert.ok(airborneOffset(-60, 1, 0.6) > 0)
  assert.ok(airborneOffset(-60, -1, 0.6) < 0)
  assert.equal(airborneOffset(0, 1, 0.6), 0)
})

test('shadows: the fill count is the budget the tier table promises', () => {
  for (const tier of ['low', 'medium', 'high', 'ultra'] as Tier[]) {
    const f = featuresFor(tier)
    const rec = recorder()
    drawCastShadow(rec.ctx, {x:0,y:0,hipY:-42,face:1,scale:1,geom:makeSkelGeom()},
      {} as Path2D, .8, .5, f.penumbra)
    assert.equal(rec.fills(), f.penumbra + 1, `${tier}: ${rec.fills()} fills for penumbra ${f.penumbra}`)
    assert.equal(rec.saves(), rec.restores(), `${tier}: the painter leaked canvas state`)
  }
})

test('shadows: contact AO is drawn on every tier and never leaks state', () => {
  for (const tier of ['low', 'medium', 'high', 'ultra'] as Tier[]) {
    const f = featuresFor(tier)
    const rec = recorder()
    drawContactAO(rec.ctx, 10, 0, 30, 0.42, Math.min(1, f.penumbra))
    assert.ok(rec.fills() >= 1, `${tier}: no contact shadow`)
    assert.ok(rec.fills() <= 2, `${tier}: contact shadow costs ${rec.fills()} fills`)
    assert.equal(rec.saves(), rec.restores())
  }
})

test('shadows: nothing is painted for a shadow that cannot be seen', () => {
  const rec = recorder()
  drawCastShadow(rec.ctx, {x:0,y:-260,hipY:-300,face:1,scale:1,geom:makeSkelGeom()}, {} as Path2D, .6,.5,3)
  assert.equal(rec.fills(), 0, 'a body above the fade height still cost a fill')
})

test('shadows: the silhouette shear leans away from the light on both sides', () => {
  const right = silhouetteMatrix(1, 0.6)
  const left = silhouetteMatrix(-1, 0.6)
  assert.equal(right.a, 1)
  assert.equal(right.b, 0)
  assert.ok(right.d < 0 && right.d > -0.3, 'the silhouette must be flattened onto the plane')
  // x' = x + c·y, y negative above the deck: c<0 leans the top to +x (right).
  assert.ok(right.c < 0, 'a shadow falling right must lean its top right')
  assert.ok(left.c > 0, 'a shadow falling left must lean its top left')
  // More reach = a longer lean; the magnitude is monotone in reach.
  const near = Math.abs(silhouetteMatrix(1, 0.1).c)
  const far = Math.abs(silhouetteMatrix(1, 1.2).c)
  assert.ok(far > near, 'reach did not lengthen the lean')
})

test('shadows: the mode helpers agree with the table', () => {
  assert.equal(usesCastShadow('contact'), false)
  assert.equal(usesCastShadow('cast'), true)
  assert.equal(usesPropShadows('cast'), false)
  assert.equal(usesPropShadows('cast+props'), true)
})

test('graphics: the ladder is monotone — a better tier never spends less', () => {
  const order: Tier[] = ['low', 'medium', 'high', 'ultra']
  const rank = (m: string) => (m === 'contact' ? 0 : m === 'cast' ? 1 : 2)
  let prev = { shadow: -1, penumbra: -1, reflections: -1, dpr: -1, shafts: false, practical: false }
  for (const t of order) {
    const f = GRAPHICS[t]
    assert.ok(rank(f.shadows) >= prev.shadow, `${t}: shadow mode regressed`)
    assert.ok(f.penumbra >= prev.penumbra, `${t}: penumbra regressed`)
    // Finer reflection = a SMALLER divisor, so compare the divisor downward.
    if (f.reflection > 0) assert.ok(f.reflection <= (prev.reflections > 0 ? prev.reflections : 99), `${t}: reflection got coarser`)
    assert.ok(f.dprCap >= prev.dpr, `${t}: DPR cap regressed`)
    if (prev.shafts) assert.ok(f.shafts, `${t}: shafts disappeared at a higher tier`)
    if (prev.practical) assert.ok(f.practicalShadow, `${t}: practical shadow disappeared`)
    prev = {
      shadow: rank(f.shadows), penumbra: f.penumbra,
      reflections: f.reflection || prev.reflections, dpr: f.dprCap,
      shafts: f.shafts, practical: f.practicalShadow,
    }
  }
  // Ultra is a real tier, not a label: it is the only one with prop shadows and
  // the widest DPR cap.
  assert.equal(GRAPHICS.ultra.shadows, 'cast+props')
  // Ultra supersamples past 2× now (2.25): a desktop card has the headroom, and
  // a 4-pass penumbra reads as smooth only when the shadow itself is drawn above
  // the display's pixel density. Still a CAP, still a ceiling the tier table owns.
  assert.equal(GRAPHICS.ultra.dprCap, 2.25)
  assert.ok(GRAPHICS.ultra.penumbra > GRAPHICS.low.penumbra)
})

test('graphics: what a tier may never remove stays on', () => {
  for (const t of ['low', 'medium', 'high', 'ultra'] as Tier[]) {
    const f = featuresFor(t)
    // Contact shadow is the floor of grounding; it may not be switched off.
    assert.ok(f.penumbra >= 0)
    // An unknown tier must fall back to the CHEAP path, never the expensive one.
  }
  const unknown = featuresFor('cinematic' as Tier)
  assert.equal(unknown.shadows, 'contact')
  assert.equal(unknown.dprCap, 1)
})

test('graphics: clampTier honours the player ceiling and the floor', () => {
  assert.equal(clampTier('ultra', 'medium'), 'medium')
  assert.equal(clampTier('low', 'ultra'), 'low')
  assert.equal(clampTier('ultra', 'ultra'), 'ultra')
  assert.equal(clampTier('low', 'ultra', 'medium'), 'medium')
  assert.equal(tierIndex('low'), 0)
  assert.equal(tierIndex('ultra'), 3)
  assert.equal(tierIndex('nonsense' as Tier), 0)
})

test('graphics: a desktop is offered ultra, a phone is not', () => {
  const desktop = classifyDevice({ width: 1920, height: 1080, dpr: 1, finePointer: true, touch: false })
  assert.equal(desktop.desktop, true)
  assert.equal(desktop.ceiling, 'ultra')
  assert.equal(desktop.start, 'ultra')

  const smallLaptop = classifyDevice({ width: 1366, height: 768, dpr: 1, finePointer: true, touch: false })
  assert.equal(smallLaptop.desktop, true)
  assert.equal(smallLaptop.ceiling, 'ultra')

  const phone = classifyDevice({ width: 390, height: 844, dpr: 3, finePointer: false, touch: true })
  assert.equal(phone.desktop, false)
  assert.equal(phone.ceiling, 'medium')

  const tablet = classifyDevice({ width: 1024, height: 1366, dpr: 2, finePointer: false, touch: true })
  assert.equal(tablet.ceiling, 'high', 'a big tablet may be offered high, never ultra')

  // A touch laptop is a laptop: fine pointer wins the desktop read only when it
  // is actually fine, and a hybrid with touch is treated as mobile-conservative.
  const hybrid = classifyDevice({ width: 1920, height: 1080, dpr: 2, finePointer: true, touch: true })
  assert.equal(hybrid.desktop, false, 'a touch hybrid must not be handed ultra by default')
})

test('graphics: degenerate device input cannot ask for the expensive path', () => {
  const bad = classifyDevice({ width: 0, height: 0, dpr: NaN, finePointer: true, touch: false })
  assert.ok(Number.isFinite(bad.megapixels))
  assert.deepEqual(['low', 'medium'].includes(bad.start), true)
})
