import { Ribbon, DECK_W, DECK_H } from '../src/game/lighting/ribbons'
import { makeStageLights } from '../src/game/world/lightfield'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { CyberBackground } from '../src/game/world/background'
import { BRIDGE_ART } from '../src/game/world/art-grade'
import type { Tier } from '../src/game/render/graphics'
import type { BuildingAnim } from '../src/game/world/buildings'
import { gameLedger } from '../src/game/render/ledger'
import { PostStack } from '../src/game/render/post'

function withCanvasDocument(run: () => void): void {
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

test('fractional skyline and parallax joins never open a transparent screen row', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra')
  bg.setRunSeed(543)
  for (const [w, h, x, y, zoom] of [[640, 360, 0, -95.47, 0.91], [320, 740, 6826.5, -60.8, 1.16]]) {
    bg.resize(w, h)
    const g = createCanvas(w, h).getContext('2d')
    bg.drawSky(g as unknown as CanvasRenderingContext2D, { x, y, zoom })
    const data = g.getImageData(0, 0, w, h).data
    for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255, `alpha at pixel ${(i - 3) / 4}`)
  }
}))

test('near signs track each pan even while the background sky is cached', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra', undefined, { clean: true })
  bg.resize(640, 360)
  bg.warm()
  const anims = (bg as unknown as { bandAnims: { near: BuildingAnim[] } }).bandAnims
  anims.near = [{ kind: 'buzz', band: 'near', tx: 200, ty: 370, w: 16, h: 4, phase: .2, rate: 1 }]
  const ctx = createCanvas(640, 360).getContext('2d')
  const cam = { x: 200, y: -95, zoom: 1 }
  bg.drawSky(ctx as unknown as CanvasRenderingContext2D, cam)
  const moon = bg.moonX
  const red = (x: number) => ctx.getImageData(x, 102, 1, 1).data[0]
  const edge = red(139)
  const core = red(145)
  assert.ok(core > edge + 30, 'fixture needs a readable edge')
  cam.x += 5 // 1.5 CSS px on the near plane, below the slow sky rebuild threshold
  bg.drawSky(ctx as unknown as CanvasRenderingContext2D, cam)
  assert.equal(bg.moonX, moon, 'the distant cache should still be a hit')
  assert.ok(red(139) > edge + 15, 'near sign was frozen along with the sky')
}))

test('capture reflection follows the rolled lane without spilling beyond the span or deck', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra')
  const w = 480, h = 280, g = createCanvas(w * 2, h * 2).getContext('2d')
  const ctx = g as unknown as CanvasRenderingContext2D
  bg.resize(w, h)
  g.scale(2, 2)
  for (const rot of [0, 0.06, -0.06]) {
    // Put the span's left end at screen centre. Red in the source means
    // we can distinguish mirror pixels from both black deck and sky glitter.
    const cam = { x: -1174, y: 0, zoom: 1, rot }
    const lanePixel = (localX: number, localY: number) => g.getImageData(
      Math.round(2 * (w / 2 + localX * Math.cos(rot) - localY * Math.sin(rot))),
      Math.round(2 * (h / 2 + localX * Math.sin(rot) + localY * Math.cos(rot))), 1, 1,
    ).data[0]
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    g.save()
    g.translate(w / 2, h / 2)
    g.rotate(rot)
    g.fillStyle = '#f00'
    g.fillRect(-w, -h, 2 * w, h)
    g.restore()
    bg.drawReflections(ctx, cam, 'ultra', false)
    assert.ok(lanePixel(160, 5) > 15, `reflection detached from lane at roll ${rot}`)
    assert.equal(lanePixel(-100, 15), 0, 'reflection escaped the span')
    assert.equal(lanePixel(160, 54), 0, 'reflection escaped across the front girder')
  }
}))

test('the city light bake has no luminous bottom row to turn into a horizon strip', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra')
  bg.warm()
  const { cityGlow: plate } = bg as unknown as { cityGlow: ReturnType<typeof createCanvas> }
  const g = plate.getContext('2d')
  const bottom = g.getImageData(0, plate.height - 1, plate.width, 1).data
  const core = g.getImageData(0, Math.floor(plate.height * .75), plate.width, 1).data
  for (let i = 3; i < bottom.length; i += 4) assert.equal(bottom[i], 0)
  assert.ok(core.some((v, i) => i % 4 === 3 && v > 20), 'feathering must not remove the body of the glow')
}))

test('the bridge keeps warm ambient light as weather and quality change', () => withCanvasDocument(() => {
  const w = 700, h = 540, cam = { x: 1540, y: -100, zoom: 1 }
  const bg = new CyberBackground('high', undefined, BRIDGE_ART)
  bg.setRunSeed(42) // haze → clear → drizzle, without changing the scene seed
  bg.resize(w, h)
  const g = createCanvas(w, h).getContext('2d')
  const ctx = g as unknown as CanvasRenderingContext2D
  const meanRGB = (x: number, y: number, width: number, height: number) => {
    const pixels = g.getImageData(x, y, width, height).data
    const sum = [0, 0, 0]
    for (let i = 0; i < pixels.length; i += 4) {
      for (let c = 0; c < 3; c++) sum[c] += pixels[i + c]
    }
    return sum.map(v => v / (width * height))
  }
  const render = (tier: Tier, forward = false) => {
    bg.setQuality(tier)
    bg.drawSky(ctx, cam)
    ctx.save()
    ctx.translate(w / 2 - cam.x, h / 2 - cam.y)
    bg.drawArena(ctx, forward, cam)
    ctx.restore()
    // Compare the base lighting before adding moving mirrors or flashes.
    return {
      skyline: meanRGB(80, 140, 540, 112),
      horizon: meanRGB(40, 250, 620, 65),
      road: meanRGB(35, 385, 630, 31),
      district: meanRGB(50, 465, 610, 59),
    }
  }
  assert.equal(bg.weatherState()?.kind, 'haze')
  const warm = render('high')
  assert.ok(warm.skyline[2] > warm.skyline[0] + 5, 'the amber air should not tint the upper skyline')
  assert.ok(warm.horizon[0] - warm.horizon[2] > warm.skyline[0] - warm.skyline[2] + 8,
    'keep the warm air concentrated behind the rail')
  assert.ok(warm.horizon[0] > warm.skyline[0] + 10, 'keep the city bounce near the rail')
  const wetBefore = bg.surfaceWetness(1500)
  const stable = (tier: Tier, forward: boolean) => {
    const frame = render(tier, forward)
    for (const region of ['skyline', 'horizon', 'road', 'district'] as const) {
      const delta = Math.max(...frame[region].map((v, c) => Math.abs(v - warm[region][c])))
      // Small architectural animation detail may differ across tiers.
      assert.ok(delta < (region === 'district' ? .01 : 2.5),
        `${bg.weatherState()?.kind} ${tier}/${forward ? 'forward' : 'capture'} ${region} shifted by ${delta.toFixed(2)}`)
    }
  }
  const checkTiers = () => {
    for (const q of ['ultra', 'high', 'medium', 'low'] as const) {
      stable(q, false)
      stable(q, true)
    }
  }
  checkTiers()
  for (const kind of ['clear', 'drizzle'] as const) {
    for (let i = 0; i < 400; i++) {
      const wx = bg.weatherState()
      if (wx?.kind === kind && wx.s === 1) break
      bg.update(0.1)
    }
    assert.equal(bg.weatherState()?.kind, kind)
    assert.equal(bg.weatherState()?.s, 1, 'the front should reach its final band')
    checkTiers()
  }
  assert.ok(bg.storm.rainScale > 0.2, 'rain should still respond to the weather front')
  assert.ok(bg.surfaceWetness(1500) > wetBefore * 2, 'rain/splash material should still respond to wetness')
}))

test('a vertical reflection remains horizontally continuous through the wet deck', () => withCanvasDocument(() => {
  const bg = new CyberBackground('ultra')
  const w = 420, h = 280, g = createCanvas(w, h).getContext('2d')
  bg.resize(w, h)
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#f00'; g.fillRect(210, 50, 12, 90)
  bg.drawReflections(g as unknown as CanvasRenderingContext2D, { x: 900, y: 0, zoom: 1 }, 'ultra', false)
  const centroid = (y: number) => {
    const row = g.getImageData(203, y, 26, 1).data
    let sum = 0, weighted = 0
    for (let x = 0; x < 26; x++) { sum += row[x * 4]; weighted += x * row[x * 4] }
    assert.ok(sum > 30, `reflection has a blank row at ${y}`)
    return weighted / sum
  }
  const base = centroid(147)
  for (let y = 148; y <= 176; y++) assert.ok(Math.abs(centroid(y) - base) < 1, `lateral seam at row ${y}`)
}))


function redSum(ctx: SKRSContext2D, x: number, y: number, w: number, h: number): number {
  const data = ctx.getImageData(x, y, w, h).data
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += data[i]
  return sum
}

test('thin reflected emitters survive fractional pans at different tiers and DPRs', () => withCanvasDocument(() => {
  const w = 480, h = 300
  const bg = new CyberBackground('high', undefined, { clean: true })
  bg.setRunSeed(543)
  bg.resize(w, h)
  // No sky draw, so moon glitter stays at the far left, outside the sample.
  for (const dpr of [1, 2]) {
    const g = createCanvas(w * dpr, h * dpr).getContext('2d')
    g.scale(dpr, dpr)
    for (const tier of ['medium', 'high', 'ultra'] as const) for (const rot of [0, .011]) {
      const samples: number[] = []
      for (let i = 0; i < 24; i++) {
        g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
        g.save(); g.translate(w / 2, h / 2); g.rotate(rot); g.translate(-w / 2, -h / 2)
        g.fillStyle = '#f00'; g.fillRect(210 + i / 2, 70, 2, 80)
        g.restore()
        bg.drawReflections(g as unknown as CanvasRenderingContext2D, { x: 800, y: 0, zoom: 1, rot }, tier)
        samples.push(redSum(g, 193 * dpr, 153 * dpr, 60 * dpr, 45 * dpr))
      }
      const min = Math.min(...samples), max = Math.max(...samples)
      assert.ok(min > 200 && max / min < 2, `${tier} / DPR ${dpr} / roll ${rot} lost its emitter: ${min}–${max}`)
    }
  }
}))

test('viewport clipping preserves reflection depth and zoom does not resize the buffer', () => withCanvasDocument(() => {
  const w = 480, h = 300, g = createCanvas(w, h).getContext('2d')
  const ctx = g as unknown as CanvasRenderingContext2D
  const bg = new CyberBackground('ultra', undefined, { clean: true })
  bg.resize(w, h)
  const render = (deckY: number, zoom = 1) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
    g.fillStyle = '#f00'; g.fillRect(200, deckY - 26, 80, 5)
    bg.drawReflections(ctx, { x: 800, y: (h / 2 - deckY) / zoom, zoom }, 'ultra')
  }
  const centroid = (deckY: number) => {
    render(deckY)
    let energy = 0, depth = 0
    for (let y = 1; y < 52; y++) {
      const sum = redSum(g, 220, deckY + y, 40, 1)
      energy += sum; depth += sum * (y + .5)
    }
    assert.ok(energy > 500, 'reflection disappeared inside the receiver')
    return depth / energy
  }
  const reference = centroid(95)
  for (const deckY of [70, 45, 28]) assert.ok(Math.abs(centroid(deckY) - reference) < 1.5)
  const buffer = () => gameLedger.list().find(e => e.tag === 'refl')!
  const original = buffer()
  for (const zoom of [.85, .95, 1.08, 1.2, 1.3]) {
    render(110, zoom)
    assert.deepEqual(buffer(), original)
  }
  gameLedger.release(original.key)
  assert.ok(Math.abs(centroid(95) - reference) < 1, 'a backing-store release blanked the next frame')
}))

test('the wet edge keeps its moonlight when the lane crosses the viewport', () => withCanvasDocument(() => {
  const w = 480, h = 300, g = createCanvas(w, h).getContext('2d')
  const ctx = g as unknown as CanvasRenderingContext2D
  const bg = new CyberBackground('ultra')
  bg.resize(w, h)
  bg.drawSky(ctx, { x: 800, y: 150, zoom: 1 })
  const glitter = (deckY: number) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
    bg.drawReflections(ctx, { x: 800, y: h / 2 - deckY, zoom: 1 }, 'ultra', true)
    return redSum(g, 0, 0, w, 55)
  }
  const a = glitter(1), b = glitter(-1)
  assert.ok(a > 1000 && Math.abs(a - b) < a * .08, `glitter blinked: ${a} vs ${b}`)
}))

test('Ultra bloom still catches narrow sign strokes between downsample positions', () => withCanvasDocument(() => {
  const w = 256, h = 160
  for (const dpr of [1, 2]) {
    const g = createCanvas(w * dpr, h * dpr).getContext('2d')
    g.scale(dpr, dpr)
    const post = new PostStack()
    const energy = () => redSum(g, 70 * dpr, 25 * dpr, 80 * dpr, 110 * dpr)
    for (let i = 0; i < 16; i++) {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
      g.fillStyle = '#f00'; g.fillRect(92 + i / 2, 30, 3, 100)
      const before = energy()
      post.compose(g as unknown as CanvasRenderingContext2D, w, h, [], 0, 1)
      assert.ok(energy() > before + 200, `bloom lost a visible sign at phase ${i}, DPR ${dpr}`)
    }
  }
}))

test('practical light atlas fades to zero at both asphalt boundaries', () => {
  const [, lamp] = makeStageLights(null, 52, true)
  const pixels = new Uint8ClampedArray(DECK_W * DECK_H * 4)
  new Ribbon(lamp, [], 10).bakeDeck(pixels, 0)
  for (let x = 0; x < DECK_W; x++) {
    assert.equal(pixels[x * 4 + 3], 0)
    assert.equal(pixels[((DECK_H - 1) * DECK_W + x) * 4 + 3], 0)
  }
  assert.ok(pixels.some((v, i) => i % 4 === 3 && v > 0), 'lamp must still illuminate the deck')
})
