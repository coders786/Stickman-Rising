import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, Path2D as NativePath } from '@napi-rs/canvas'
import { makeSkelGeom } from '../src/game/anim/skeleton'
import { newProbe } from '../src/game/lighting/ribbons'
import { gameLedger } from '../src/game/render/ledger'
import { ROAD } from '../src/game/stage/road-section'
import { PropField } from '../src/game/world/props'
import type { PointLight } from '../src/game/world/lightfield'

import {
  FIGURE_H, SHADOW_TUNING, drawCastShadow, drawContactAO, moonShadowSlope, shadowAlpha, steerShadow,
  shadowLength, silhouetteMatrix, usesCastShadow, usesPropShadows, type ShadowActor,
} from '../src/game/render/shadows'
import { Renderer } from '../src/game/render/renderer'
import type { BackgroundRenderer } from '../src/game/world/background'
import { GRAPHICS, classifyDevice, featuresFor } from '../src/game/render/graphics'
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
    fillRect: () => { fills++ }, drawImage: noop, translate: noop, scale: noop, transform: noop, setTransform: noop,
    clip: noop, rect: noop, createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', filter: 'none',
  } as unknown as CanvasRenderingContext2D
  return { ctx, fills: () => fills, saves: () => saves, restores: () => restores }
}

function posedActor(): ShadowActor {
  const geom = makeSkelGeom()
  Object.assign(geom.ankleL, { x: -19, y: 43 })
  Object.assign(geom.toeL, { x: -8, y: 44 })
  Object.assign(geom.ankleR, { x: 19, y: 43 })
  Object.assign(geom.toeR, { x: 30, y: 44 })
  return { geom, x: 140, y: 0, hipY: -46, face: 1, scale: 1 }
}

const lamp = { id: 'test', x: 100, y: -180, kind: 'warm' } as PointLight

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
})

test('shadows: a strong practical steers the cast without a snap at a handoff', () => {
  const key = moonShadowSlope(-1, .85)
  const p = newProbe()
  p.caster = lamp
  assert.equal(steerShadow(key, 200, -48, p), key)
  p.castW = .8
  assert.ok(steerShadow(key, 200, -48, p) > 0)
  assert.ok(steerShadow(key, 40, -48, p) < 0)
  assert.equal(steerShadow(key, lamp.x, -48, p), 0)
  p.castW = .001
  const weak = steerShadow(key, 200, -48, p)
  p.caster = { ...lamp, x: 240 }
  assert.ok(Math.abs(steerShadow(key, 200, -48, p) - weak) < .0001)
})

test('shadows: one draw for a graded cast and no backing/clip state leaks', () => {
  const rec = recorder()
  let ramps = 0
  const gradient = rec.ctx.createLinearGradient
  rec.ctx.createLinearGradient = (...args) => { ramps++; return gradient(...args) }
  drawCastShadow(rec.ctx, posedActor(), {} as Path2D, .8)
  assert.equal(rec.fills(), 1)
  assert.equal(ramps, 1)
  assert.equal(rec.saves(), rec.restores())
})

test('shadows: soft footprints follow each sole, fade independently and mirror with facing', () => {
  const g = createCanvas(280, 80).getContext('2d') as unknown as CanvasRenderingContext2D
  g.translate(0, 40)
  const actor = posedActor()
  const sample = (x: number, y: number) => g.getImageData(x, y + 40, 1, 1).data[3]
  const paint = () => { g.clearRect(0, -40, 280, 80); drawContactAO(g, actor) }
  paint()
  assert.ok(sample(126, 1) > 130 && sample(164, 1) > 130, 'wide stance lost a shoe')
  assert.equal(sample(145, 1), 0, 'a pelvis blob connects a wide stance')
  assert.ok(sample(117, 1) < sample(126, 1) / 2, 'sole edge is not feathered')
  actor.geom.ankleR.y -= 17
  actor.geom.toeR.y -= 17
  paint()
  assert.ok(sample(164, 1) < sample(126, 1) / 4, 'a swing foot stayed fully anchored')
  actor.face = -1
  paint()
  assert.ok(sample(154, 1) > 130 && sample(116, 1) < sample(154, 1) / 4)
  actor.y = -80
  actor.hipY -= 80
  paint()
  assert.equal(g.getImageData(0, 0, 280, 80).data.some(Boolean), false)
})

test('shadows: cast tip fades and jump pulls the footprint away from takeoff', () => {
  const g = createCanvas(360, 160).getContext('2d') as unknown as CanvasRenderingContext2D
  g.translate(0, 64)
  const path = new NativePath(); path.rect(-4, -61, 8, 106)
  const actor = posedActor()
  const paint = (slope: number) => {
    g.clearRect(0, -64, 360, 160)
    drawCastShadow(g, actor, path as unknown as Path2D, slope)
    const pixels = g.getImageData(0, 0, 360, 160).data
    let alpha = 0, weightedX = 0
    for (let i = 3; i < pixels.length; i += 4) {
      alpha += pixels[i]
      weightedX += pixels[i] * (((i - 3) / 4) % 360)
    }
    return { alpha, x: weightedX / alpha }
  }
  paint(0)
  const strength = (y: number) => g.getImageData(actor.x, 64 + y, 1, 1).data[3]
  assert.ok(strength(3) > 110 && strength(17) < strength(3) / 2)
  const standing = paint(.8)
  actor.y = -54; actor.hipY -= 54
  const jump = paint(.8)
  assert.ok(jump.alpha > 0 && jump.alpha < standing.alpha * .7)
  assert.ok(jump.x > standing.x + 12)
  assert.ok(paint(-.8).x < actor.x - 12)
})

test('shadows: a rolled 2.25× boss projection never crosses the receiver', () => {
  const w = 1050, h = 402, dpr = 2.25, roll = .09
  const g = createCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D
  const path = new NativePath(); path.rect(-12, -98, 24, 165)
  const actor = { ...posedActor(), x: 42, scale: 3, hipY: -162, face: -1 }
  g.translate(w * .5, h * .5); g.rotate(roll); g.scale(dpr, dpr)
  drawCastShadow(g, actor, path as unknown as Path2D, -.95)
  const { data } = g.getImageData(0, 0, w, h)
  let painted = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 2) continue
    const x = ((i - 3) / 4 % w + .5 - w / 2) / dpr
    const y = (Math.floor((i - 3) / 4 / w) + .5 - h / 2) / dpr
    const depth = y * Math.cos(roll) - x * Math.sin(roll)
    assert.ok(depth >= ROAD.lane - .5 && depth <= ROAD.front + .5, `cast leaked to ${depth}`)
    painted++
  }
  assert.ok(painted > 2500)
})

test('tiers share the wet pose without budgeting a second projection for strong practicals', () => {
  const geom = makeSkelGeom()
  for (const [i, name] of ['hip', 'chest', 'headC', 'shoulderR', 'shoulderL', 'elbL', 'elbR',
    'handL', 'handR', 'kneeR', 'kneeL', 'ankleR', 'ankleL', 'toeR', 'toeL'].entries()) {
    Object.assign(geom[name as keyof typeof geom], { x: (i % 2 ? -1 : 1) * i, y: i * 4 - 20 })
  }
  const actor: ShadowActor = { geom, x: 100, y: 0, hipY: -48, face: 1, scale: 1 }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Path2D')
  let builds = 0, links = 0
  class CountingOutline {
    constructor() { builds++ }
    moveTo() {}
    lineTo() {}
    arc() {}
    closePath() { links++ }
  }
  Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: CountingOutline })
  try {
    const render = new Renderer()
    const shade = (render as unknown as { shade(
      ctx: CanvasRenderingContext2D, bg: BackgroundRenderer, actor: ShadowActor,
      moonSlope: number, gain: number, keyX: number, wetSurface: boolean,
    ): void }).shade.bind(render)
    const bg = { surfaceWetness: () => .85,
      lightAt: (_x: number, _y: number, out: ReturnType<typeof newProbe>) => {
        out.caster = lamp; out.castW = .85; return out
      },
    } as unknown as BackgroundRenderer
    for (const wetSurface of [true, false]) {
      for (const forward of [false, true]) {
        render.setDesktopLighting(forward)
        for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
          builds = links = 0
          const paths: Path2D[] = []
          const rec = recorder()
          const fill = rec.ctx.fill
          rec.ctx.fill = (path?: Path2D | CanvasFillRule) => { if (typeof path === 'object') paths.push(path); fill() }
          render.setQuality(tier)
          shade(rec.ctx, bg, actor, -.7, 1, .8, wetSurface)
          const cast = tier === 'high' || tier === 'ultra'
          const mirror = wetSurface && forward && tier !== 'low'
          assert.deepEqual([builds, links, paths.length], [cast || mirror ? 1 : 0, cast ? 12 : mirror ? 6 : 0, +cast + +mirror])
          if (cast && mirror) assert.equal(paths[0], paths[1], 'mirror and cast rebuilt the same outline')
          const contacts = rec.fills() - paths.length
          assert.ok(contacts >= 1 && contacts <= 2, `${tier}: missing or stacked contact`)
          assert.equal(rec.saves(), rec.restores())
        }
      }
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'Path2D', original)
    else Reflect.deleteProperty(globalThis, 'Path2D')
  }
})

test('shadows: nothing is painted for a shadow that cannot be seen', () => {
  const rec = recorder()
  drawCastShadow(rec.ctx, {x:0,y:-260,hipY:-300,face:1,scale:1,geom:makeSkelGeom()}, {} as Path2D, .6)
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

test('props: only the physical mask casts, one blit per visible faded-in caster', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => createCanvas(1, 1) } })
  const props = new PropField()
  const masks: HTMLCanvasElement[] = []
  try {
    props.warm()
    for (const [id, x, born, dead] of [[1, 115, -1, false], [2, 610, -1, false],
      [3, 130, 0, false], [4, 145, -1, true]] as const) {
      props.props.push({ id, kind: 'med', x, born, dead, hp: 2, hitAt: -10, respawn: 0 })
    }
    const { ctx } = recorder()
    ctx.drawImage = (mask: HTMLCanvasElement) => masks.push(mask)
    props.drawShadows(ctx, -1, .85, 0, 290)
    assert.equal(masks.length, 1)
    const [mask] = masks
    assert.deepEqual([mask.width, mask.height], [76, 88], 'mask includes reflection rows')
    const ink = mask.getContext('2d')!
    const alpha = (x: number, y: number) => ink.getImageData(x, y, 1, 1).data[3]
    assert.equal(alpha(2, 38), 0, 'glow casts a shadow')
    assert.equal(alpha(38, 8), 0, 'label casts a shadow')
    assert.ok(alpha(38, 25) > 0 && alpha(38, 25) < alpha(38, 84) * .5, 'cast should fade into its tip')
  } finally {
    props.dispose()
    assert.ok(masks.every(c => c.width === 0 && c.height === 0))
    assert.deepEqual(gameLedger.list(), [])
    if (original) Object.defineProperty(globalThis, 'document', original)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('shadows: the mode helpers agree with the table', () => {
  assert.equal(usesCastShadow('contact'), false)
  assert.equal(usesCastShadow('cast'), true)
  assert.equal(usesPropShadows('cast'), false)
  assert.equal(usesPropShadows('cast+props'), true)
})

test('graphics: cast/props and unrelated tier caps are fixed feature sets', () => {
  const order: Tier[] = ['low', 'medium', 'high', 'ultra']
  const rank = (m: string) => (m === 'contact' ? 0 : m === 'cast' ? 1 : 2)
  let prev = { shadow: -1, reflections: -1, dpr: -1, shaftLayers: 0 }
  for (const t of order) {
    const f = GRAPHICS[t]
    assert.ok(rank(f.shadows) >= prev.shadow, `${t}: shadow mode regressed`)
    // Finer reflection = a SMALLER divisor, so compare the divisor downward.
    if (f.reflection > 0) assert.ok(f.reflection <= (prev.reflections > 0 ? prev.reflections : 99), `${t}: reflection got coarser`)
    assert.ok(f.dprCap >= prev.dpr, `${t}: DPR cap regressed`)
    assert.ok(f.shaftLayers >= prev.shaftLayers, `${t}: shaft detail regressed`)
    prev = {
      shadow: rank(f.shadows),
      reflections: f.reflection || prev.reflections, dpr: f.dprCap,
      shaftLayers: f.shaftLayers,
    }
  }
  assert.deepEqual(order.map(t => featuresFor(t).shadows), ['contact', 'contact', 'cast', 'cast+props'])
  assert.equal(GRAPHICS.ultra.dprCap, 1.25)
})

test('graphics: an unknown tier falls back to the cheapest grounding', () => {
  const unknown = featuresFor('cinematic' as Tier)
  assert.equal(unknown.shadows, 'contact')
  assert.equal(unknown.dprCap, .75)
})

test('graphics: device class suggests a starting preset only', () => {
  const desktop = classifyDevice({ width: 1920, height: 1080, dpr: 1, finePointer: true, touch: false })
  assert.equal(desktop.desktop, true)
  assert.equal(desktop.start, 'medium')

  const smallLaptop = classifyDevice({ width: 1366, height: 768, dpr: 1, finePointer: true, touch: false })
  assert.equal(smallLaptop.desktop, true)

  const phone = classifyDevice({ width: 390, height: 844, dpr: 3, finePointer: false, touch: true })
  assert.equal(phone.desktop, false)
  assert.equal(phone.start, 'low')

  const tablet = classifyDevice({ width: 1024, height: 1366, dpr: 2, finePointer: false, touch: true })

  assert.equal(tablet.start, 'medium')

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

test('the bridge Mobile stamp spans both soles in one draw and disappears at altitude', () => {
  const actor = posedActor(), pen = recorder()
  drawContactAO(pen.ctx, actor, .72, true)
  assert.equal(pen.fills(), 1)
  assert.equal(pen.saves(), pen.restores())
  drawContactAO(pen.ctx, { ...actor, y: -62, hipY: -108 }, .72, true)
  assert.equal(pen.fills(), 1)
})
