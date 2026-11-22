import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { featuresFor, QUALITY_NAMES, QUALITY_PRESETS, RENDERER_NAMES, lockQualityPreset, type Tier } from '../src/game/render/graphics'
import { gameLedger } from '../src/game/render/ledger'
import type { Viaduct } from '../src/game/stage/viaduct'
import type { PracticalStamp } from '../src/game/stage/baked-finish'
import { BRIDGE_ART, STATION_ART } from '../src/game/world/art-grade'
import { CyberBackground } from '../src/game/world/background'
import { drawRoofProps, type RoofProp } from '../src/game/world/roofprops'

const tiers = ['low', 'medium', 'high', 'ultra'] as const

test('quality labels are ordered, keep saved IDs and cannot imply renderer admission', () => {
  assert.deepEqual(QUALITY_PRESETS, tiers)
  assert.deepEqual(tiers.map(tier => QUALITY_NAMES[tier]), ['Low', 'Medium', 'High', 'Ultra'])
  assert.deepEqual(Object.values(RENDERER_NAMES), ['WebGL2 HDR', 'WebGL2 Optimized', 'Canvas 2D'])
  for (const tier of tiers) assert.deepEqual(lockQualityPreset({ quality: 'ultra' as Tier, adaptiveQuality: true }, tier), {
    quality: tier, adaptiveQuality: false,
  })
})

function withCanvas(run: () => void): void {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement: () => createCanvas(1, 1) },
  })
  try { run() } finally {
    gameLedger.releaseAll()
    if (old) Object.defineProperty(globalThis, 'document', old)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

test('roof finish adds contact, hardware and a keyed bevel without changing the lit fixture', () => {
  const props: RoofProp[] = [
    { kind: 'cabinet', x: 44, y: 62, w: 20, h: 28, phase: .1, lit: false },
    { kind: 'bulb', x: 112, y: 62, w: 6, h: 46, phase: .5, lit: true },
  ]
  const render = (tier: Tier, side: -1 | 1 = 1) => {
    const g = createCanvas(160, 76).getContext('2d')
    g.fillStyle = '#292929'
    g.fillRect(0, 0, 160, 76)
    const ctx = g as unknown as CanvasRenderingContext2D
    assert.equal(drawRoofProps(ctx, props, 0, 160, featuresFor(tier).roofFinish, .8, side), 2)
    return (x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data)
  }
  const [low, med, high, ultra] = tiers.map(t => render(t))
  assert.ok(med(44, 64)[2] < low(44, 64)[2], 'the cabinet gained no contact')
  assert.ok(high(44, 47)[0] > med(44, 47)[0], 'the cabinet gained no panel finish')
  assert.ok(ultra(53, 47)[2] > high(53, 47)[2] + 20, 'no moon-facing bevel')
  const otherSide = render('ultra', -1)
  assert.deepEqual(otherSide(53, 47), high(53, 47))
  assert.ok(otherSide(34, 47)[2] > high(34, 47)[2] + 20)
  for (const sample of [med, high, ultra]) assert.deepEqual(sample(112, 22), low(112, 22), 'bulb output changed')
})

test('authored fixtures spend one culled blit each on every tier and both routes', () => withCanvas(() => {
  const w = 1150, h = 520
  const cam = { x: 1300, y: -126, zoom: 1, rot: .06 }
  for (const art of [BRIDGE_ART, STATION_ART]) {
    const bg = new CyberBackground('low', undefined, { ...art, clean: true })
    bg.setRunSeed(42)
    bg.resize(w, h)
    bg.warm()
    const profile = bg.getProfile(), weather = bg.weatherState()
    const probe = () => ({ ...bg.lightAt(832, -92) })
    const light = probe(), allocations = gameLedger.stats().acquired
    const { fixtures, street } = bg as unknown as { street: Viaduct; fixtures: PracticalStamp[] }
    const ctx = createCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D
    const blit = ctx.drawImage.bind(ctx)
    const calls: Array<[number, number[]]> = []
    ctx.drawImage = (source: CanvasImageSource, ...args: number[]) => {
      const i = fixtures.findIndex(s => s.sprite === source)
      if (i >= 0) calls.push([i, args])
      Reflect.apply(blit, ctx, [source, ...args])
    }
    street.drawWetGlints = () => { throw new Error('authored glint draw') }
    bg.drawLightPools = () => { throw new Error('authored pool modulation') }
    const paint = (tier: Tier, forward: boolean, view = cam) => {
      bg.setQuality(tier)
      calls.length = 0
      bg.drawArena(ctx, forward, view)
      return calls.slice()
    }
    try {
      assert.equal(bg.usesBakedOptics(), true)
      const base = paint('low', true)
      assert.deepEqual(base.map(c => c[0]), [0, 1, 2])
      assert.ok(base.every(c => c[1].length === 2))
      for (const forward of [false, true]) for (const tier of tiers) assert.deepEqual(paint(tier, forward), base)
      assert.deepEqual(paint('ultra', true, { ...cam, x: -4000 }), [])
      assert.deepEqual(paint('ultra', false, { ...cam, y: -1500 }), [])
      assert.equal(bg.getProfile(), profile)
      assert.deepEqual(bg.weatherState(), weather)
      assert.deepEqual(probe(), light)
      assert.equal(gameLedger.stats().acquired, allocations)
    } finally { bg.dispose() }
  }
  assert.deepEqual(gameLedger.list(), [])
}))
