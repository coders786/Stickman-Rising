import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { DECK_H, DECK_W, Ribbon } from '../src/game/lighting/ribbons'
import { gameLedger } from '../src/game/render/ledger'
import { bakePractical, materialRamp, paintPlaneTone } from '../src/game/stage/baked-finish'
import { ROAD } from '../src/game/stage/road-section'
import { Viaduct } from '../src/game/stage/viaduct'
import { ART_GRADES, BRIDGE_ART, STATION_ART } from '../src/game/world/art-grade'
import { CyberBackground } from '../src/game/world/background'
import { makeStageLights } from '../src/game/world/lightfield'

const bridge = BRIDGE_ART.finish!
const station = STATION_ART.finish!

function target(w: number, h: number) {
  const c = createCanvas(w, h)
  const g = c.getContext('2d')
  return {
    c: c as unknown as HTMLCanvasElement, g: g as unknown as CanvasRenderingContext2D,
    pixels: () => g.getImageData(0, 0, w, h).data,
  }
}

test('depth compresses city detail behind the fight without closing silhouette gaps', () => {
  const { g } = target(30, 100)
  g.fillStyle = '#101010'; g.fillRect(0, 0, 10, 100)
  g.fillStyle = '#bfbfbf'; g.fillRect(10, 0, 10, 100)
  paintPlaneTone(g, 30, 100, bridge.depth.near)
  const contrast = (y: number) => g.getImageData(15, y, 1, 1).data[0] - g.getImageData(5, y, 1, 1).data[0]
  assert.ok(contrast(91) < contrast(12) * .55, 'a foreground window competes with the combat band')
  assert.equal(g.getImageData(25, 90, 1, 1).data[3], 0, 'toning filled a parallax gap')
  assert.equal(g.globalCompositeOperation, 'source-over')
  assert.ok(bridge.depth.deep.crown > bridge.depth.far.crown && bridge.depth.far.crown > bridge.depth.near.crown)
})

test('a smooth edge finishes its falloff sooner than the matte masonry beside it', () => {
  const { g } = target(20, 100)
  for (const [x, face] of [[0, bridge.deck.metal], [10, bridge.deck.masonry]] as const) {
    g.fillStyle = materialRamp(g, 0, 0, 0, 100, face)
    g.fillRect(x, 0, 10, 100)
  }
  const falloffByQuarter = (x: number) => (g.getImageData(x, 0, 1, 1).data[0] - g.getImageData(x, 25, 1, 1).data[0]) /
    (g.getImageData(x, 0, 1, 1).data[0] - g.getImageData(x, 99, 1, 1).data[0])
  assert.ok(falloffByQuarter(3) > falloffByQuarter(13) + .3)
})

test('sharp lenses, compact scatter and soft air share one feathered fixture stamp', () => {
  for (const { lamp, sign } of [bridge.practicals, station.practicals]) for (const spec of [lamp, sign]) {
    const body = target(25, 18)
    body.g.fillStyle = '#fff2d3'; body.g.fillRect(4, 9, 17, 2)
    const { sprite, x, y } = bakePractical(target, { sprite: body.c, x: -12, y: -10 }, 0, 0, '255,149,62', spec)
    const g = sprite.getContext('2d')!
    const px = (u: number, v: number) => g.getImageData(u - x, v - y, 1, 1).data
    const a = (u: number, v: number) => px(u, v)[3]
    assert.deepEqual([...px(0, 0)], [255, 242, 211, 255], 'the light lost the lens edge')
    assert.ok(a(0, 4) > a(0, -14) * 1.6, 'there is no bright compact lobe')
    assert.ok(a(Math.floor(spec.glassX * .65), 2) > a(0, 2 - Math.floor(spec.glassX * .65)), 'the bloom does not follow the wider source')
    assert.ok(a(Math.round(spec.beam.length * .25 * spec.beam.aim), Math.round(spec.beam.length * .25)) > 10)
    assert.equal(a(0, spec.beam.length + 2), 0, 'the cone hangs below the last feather')
    for (const u of [0, sprite.width - 1]) for (let v = 0; v < sprite.height; v++) {
      assert.equal(g.getImageData(u, v, 1, 1).data[3], 0, 'scatter hits the stamp boundary')
    }
  }
})

test('the bridge keeps seeded wet patches without allocating a projection mask', () => {
  const grade = ART_GRADES['deep-noir']
  for (const seed of [42, 517]) {
    const paint = (finished: boolean) => {
      const allocations: number[][] = []
      const section = new Viaduct(seed, -200, 1300, grade.palette, (w, h) => {
        allocations.push([w, h])
        return target(w, h)
      }, grade.asphalt, finished ? bridge.deck : undefined)
      const road = target(830, 126)
      road.g.translate(0, -ROAD.rear + 1)
      section.drawRoad(road.g, 0, 830)
      return { road: road.pixels(), allocations, wet: Array.from({ length: 40 }, (_, i) => section.wetness(i * 27 - 139, .58)) }
    }
    const a = paint(false), b = paint(true)
    assert.deepEqual(a.allocations.at(-1), [Math.ceil(1300 / 4), 26], 'legacy capture lost its mask')
    assert.deepEqual(b.allocations, a.allocations.slice(0, -1))
    assert.notDeepEqual(b.wet, a.wet)
    assert.notDeepEqual(b.road, a.road)
  }
})

test('a dry receiver bakes diffuse light without sampling a wet mask', () => {
  const ribbon = new Ribbon(makeStageLights(null, 42)[0], [], 10)
  const dry = new Uint8ClampedArray(DECK_W * DECK_H * 4), wet = dry.slice()
  ribbon.bakeDeck(dry, 0, () => { throw new Error('dry floor asked for wetness') }, false)
  ribbon.bakeDeck(wet, 0, () => .8)
  const centre = 4 * (Math.floor(DECK_H * .5) * DECK_W + Math.floor(DECK_W * .5)) + 3
  assert.ok(dry[centre] > 0 && wet[centre] > dry[centre])
  assert.equal(dry[3], 0, 'diffuse light spilled out of the receiver')
})

test('the station reuses the arena passes; it needs no sky bake, wet masks or mirrors even at Ultra', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => createCanvas(1, 1) } })
  const bg = new CyberBackground('low', undefined, STATION_ART)
  const view = { x: 1300, y: -150, zoom: 1.04 }, { g, pixels } = target(390, 844)
  const paint = () => {
    bg.drawSky(g, view)
    g.save()
    g.translate(195, 422); g.scale(view.zoom, view.zoom); g.translate(-view.x, -view.y)
    bg.drawArena(g, false, view)
    g.restore()
    bg.drawWeather(g, view)
  }
  try {
    assert.equal(station.deck.surface, 'dry-platform')
    bg.resize(390, 844)
    bg.setRunSeed(42)
    bg.warm()
    paint()
    assert.equal(bg.plateStats(), null)
    assert.equal(bg.createNightForSeed(43), null)
    assert.equal(bg.storm.rainScale, 0)
    assert.equal(bg.hasWetSurface(), false)
    assert.equal(bg.surfaceWetness(1755), 0)
    assert.ok(bg.lightAt(1755, 0).warm > .4, 'the advisory no longer reaches the floor')
    assert.ok(pixels().every((v, i) => i % 4 !== 3 || v === 255), 'portrait uncovered a transparent seam')
    const before = gameLedger.stats().acquired
    bg.setQuality('ultra')
    paint()
    const dry = pixels()
    for (const forward of [false, true]) bg.drawReflections(g, view, 'ultra', forward)
    assert.deepEqual(pixels(), dry)
    assert.equal(gameLedger.stats().acquired, before, 'tier changes rebuilt the station or allocated wet optics')
    assert.ok(gameLedger.list().every(e => !['night', 'refl', 'city-scratch', 'vignette', 'practical-work'].includes(e.tag)))
    const fixed = () => gameLedger.list().filter(e => e.tag === 'stage-bake').map(e => e.key).sort()
    const stageKit = fixed()
    assert.equal(stageKit.length, 8, 'fixtures, four depth plates, and the track recess')
    const acquired = gameLedger.stats().acquired
    bg.setRunSeed(43)
    bg.warm()
    paint()
    assert.equal(bg.getProfile()?.seed, 43)
    assert.deepEqual(fixed(), stageKit)
    assert.equal(gameLedger.stats().acquired - acquired, 2, 'only the span and its light transfer should allocate')
    bg.dispose()
    assert.deepEqual(gameLedger.list(), [])
  } finally {
    bg.dispose()
    gameLedger.releaseAll()
    if (old) Object.defineProperty(globalThis, 'document', old)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
