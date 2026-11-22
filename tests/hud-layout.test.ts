import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { HUD, hudRegions, type HudBox, type HudState } from '../src/game/render/hud'

const base: HudState = { hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, stamina: 600, maxStamina: 600,
  dashCharge: 0, slashCharge: 0, swordDrawn: false, fistStrike: 'punch', staminaCooldown: 0, meter: 100,
  swordName: 'KATANA', swordColor: '#0ff', abilityName: 'STRIKE', abilityCost: 20,
  combo: { hits: 35, mult: 4.5, rank: 'S', timer: 2, timerMax: 2.6, rankUpT: 0, lastHitT: 0 }, wave: 3, enemiesLeft: 5, kills: 12,
  score: 123, boss: { hp: 50, maxHp: 100, name: 'BOSS' }, banner: null, executePrompt: null, ultReady: true,
  abilityReady: true, fps: 60, showFps: true, particleLevel: 2, runTime: 30, attract: false,
  route: { metres: 540, sector: 2, biome: 'Market Overpass', safe: null, gate: { locked: true, distance: 0, eta: null } } }
const overlap = (a: HudBox, b: HudBox) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

function traceHud(w: number, h: number, state: Partial<HudState>) {
  const ctx = createCanvas(w, h).getContext('2d'), texts: Array<{ text: string; x: number; y: number }> = []
  const original = ctx.fillText.bind(ctx)
  ctx.fillText = (text, x, y, maxWidth) => { texts.push({ text, x, y }); original(text, x, y, maxWidth) }
  new HUD().draw(ctx as unknown as CanvasRenderingContext2D, w, h, { ...base, ...state }, 1 / 60)
  return { ctx, texts }
}

test('top HUD regions do not overlap, honour safe area and leave the pause alone', () => {
  const inset = { left: 13, top: 24, right: 9, bottom: 15 }
  for (const w of [320, 400, 640, 800, 1100]) for (const touch of [false, true]) {
    const r = hudRegions(w, 700, touch, 50, inset)
    const boxes = [r.vitality, r.telemetry, r.score, r.fps]
    if (touch) boxes.push({ x: r.r - 44, y: r.top, w: 44, h: 44 })
    for (const [i, a] of boxes.entries()) {
      assert.ok(a.x >= r.l && a.y >= r.top && a.x + a.w <= r.r && a.y + a.h <= r.bottom, `${w} ${touch}`)
      for (const b of boxes.slice(i + 1)) assert.equal(overlap(a, b), false, `${w} ${touch} ${JSON.stringify([a, b])}`)
    }
    const { texts } = traceHud(w, 700, { touch, insets: inset, shield: 50 })
    assert.equal(texts.at(-1)?.text, '60 FPS')
    for (const label of ['POWER READY','SECTOR 02', 'MARKET OVERPASS', '540 m', 'GATE LOCKED', 'SHIELD', touch ? 'READY' : 'R READY'])
      assert.ok(texts.some(t => t.text === label), label)
    assert.ok(!texts.some(t => t.text.startsWith('WAVE ')))
  }
})

test('HUD distinguishes power charging, exhaustion and regeneration', () => {
  for (const [patch, label] of [[{dashCharge:.5}, 'CHARGING 50%'], [{dashCharge:1}, 'RELEASE: POWER'],
    [{stamina:20}, 'EXHAUSTED'], [{stamina:80}, 'POWER LOW'], [{stamina:300,staminaCooldown:.5}, 'RECOVERING']] as const) {
    assert.ok(traceHud(400, 700, patch).texts.some(t => t.text === label), label)
  }
})

test('anchored execute / service tips follow the world projection and FPS can be hidden', () => {
  const p = { x: 219, y: 440 }
  const exec = traceHud(400, 844, { touch: true, executePrompt: p, showFps: false }).texts
  assert.ok(exec.some(t => t.text === 'TAP EXEC' && Math.abs(t.x - p.x) <= .5 && t.y < p.y))
  assert.ok(!exec.some(t => t.text.endsWith(' FPS')))
  const service = traceHud(400, 844, { terminal: { ...p, progress: .625, buff: 'Vampiric Execute' } }).texts
  assert.ok(service.some(t => t.text === 'HOLD E  1.5s' && Math.abs(t.x - p.x) <= .5 && t.y < p.y))
  assert.ok(service.some(t => t.text === 'Vampiric Execute'))
})

test('delayed health remains visible and separate from current HP', () => {
  const w = 800, h = 400, b = hudRegions(w, h, false).vitality
  const { ctx } = traceHud(w, h, { hp: 50 })
  const rgb = (x: number) => Array.from(ctx.getImageData(x, b.y + 24, 1, 1).data).slice(0, 3)
  assert.deepEqual(rgb(b.x + 18), [255, 102, 126])
  assert.deepEqual(rgb(b.x + b.w - 44), [242, 184, 192])
})

// Compare the retained layer to a full, freshly cleared paint at the same
// CSS size and backing, using the same frame sequence for health easing.
function layerOracle() {
  const hud = new HUD(), full = new HUD()
  const ctx = createCanvas(1, 1).getContext('2d'), ref = createCanvas(1, 1).getContext('2d')
  const layer = ctx as unknown as CanvasRenderingContext2D
  const calls = { clears: 0, transforms: 0, rects: 0, text: [] as string[] }
  const clear = ctx.clearRect.bind(ctx), transform = ctx.setTransform.bind(ctx)
  const fill = ctx.fillRect.bind(ctx), line = ctx.fillText.bind(ctx)
  ctx.clearRect = (...box) => { calls.clears++; clear(...box) }
  ctx.setTransform = (...args: unknown[]) => { calls.transforms++; Reflect.apply(transform, ctx, args) }
  ctx.fillRect = (...box) => { calls.rects++; fill(...box) }
  ctx.fillText = (text, x, y, width) => { calls.text.push(text); line(text, x, y, width) }
  const pixels = () => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
  const step = (s: HudState, paint: boolean, dt = 0, w = 800, h = 560, ratio = 1) => {
    const bw = Math.round(w * Math.min(2, ratio)), bh = Math.round(h * Math.min(2, ratio))
    const { clears, transforms, rects, text } = calls, words = text.length
    assert.equal(hud.drawLayer(layer, w, h, s, dt, ratio), paint)
    assert.equal(calls.clears - clears, +paint)
    assert.equal(calls.transforms - transforms, +paint)
    if (!paint) { assert.equal(calls.rects, rects); assert.equal(calls.text.length, words) }
    assert.deepEqual([ctx.canvas.width, ctx.canvas.height], [bw, bh])
    if (ref.canvas.width !== bw) ref.canvas.width = bw
    if (ref.canvas.height !== bh) ref.canvas.height = bh
    ref.setTransform(bw / w, 0, 0, bh / h, 0, 0)
    ref.clearRect(0, 0, w, h)
    full.draw(ref as unknown as CanvasRenderingContext2D, w, h, s, dt)
    assert.ok(Buffer.from(pixels()).equals(Buffer.from(ref.getImageData(0, 0, bw, bh).data)), 'retained pixels differ from full redraw')
    assert.equal(hud.lastFpsDraw, full.lastFpsDraw)
    return calls.text.slice(words)
  }
  return { hud, ctx, full, layer, calls, step, pixels }
}

test('unchanged separate HUD does no Canvas work even as hidden values and rounded telemetry advance', () => {
  const { step, hud } = layerOracle()
  const s = structuredClone(base)
  s.runTime = 14
  s.route!.gate = { distance: 380.2, locked: false, eta: 21.2 }
  s.combo.rankUpT = .4
  s.banner = { title: 'SERVICE', sub: 'FLOW HELD', t: .27, dur: 2, color: '#9fe4c8' }
  step(s, true)
  for (let i = 1; i <= 12; i++) {
    s.runTime += 1 / 60; s.route!.metres += .02; s.route!.gate!.distance -= .01; s.route!.gate!.eta! += .02
    s.score += .02; s.fps -= .02; s.combo.rankUpT -= .02; s.banner.t += 1 / 60
    s.particleLevel = i % 3
    step(s, false, 1 / 60)
    assert.equal(hud.lastFpsDraw, '60 FPS')
  }
  s.runTime = 16
  assert.ok(!step(s, true).some(x => x.startsWith('A/D MOVE')))
  s.route!.metres = 541
  assert.ok(step(s, true).includes('541 m'))
  s.fps = 59.4
  assert.equal(step(s, true).at(-1), '59 FPS')
  s.showFps = false
  step(s, true)
  s.fps = 77
  step(s, false)
  assert.equal(hud.lastFpsDraw, null)
  s.route = undefined // legacy arena uses scene name and rounded time instead
  step(s, true)
  s.runTime += .13
  step(s, false)
  s.runTime += .5
  assert.ok(step(s, true).includes('17 s'))
})

test('retained HUD immediately repaints changing vitals and cues, erasing moved or expired ink', () => {
  const { ctx, step, pixels } = layerOracle(), s = structuredClone(base)
  const has = (words: string[], ...labels: string[]) => labels.forEach(label => assert.ok(words.includes(label), label))
  const alphaAt = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3]
  step(s, true); step(s, false)
  Object.assign(s, { hp: 18, shield: 15, energy: 12, abilityReady: false, meter: 70, ultReady: false,
    dashCharge: .53, executePrompt: { x: 172, y: 361 }, terminal: { x: 620, y: 421, progress: .2, buff: 'NIGHT EDGE' },
    buff: { name: 'IRON LUNGS', seconds: 8 }, banner: { title: 'RUSH', sub: 'STAY SHARP', color: '#fff', t: .21, dur: 1 } })
  has(step(s, true), '18', 'SHIELD', 'CHARGING 53%', '70%', '12 EN', 'E  EXECUTE', 'HOLD E  1.5s', 'IRON LUNGS', 'RUSH')
  step(s, false) // same eased value at dt zero (tick-zero opening uses that clock)
  const hp = hudRegions(800, 560, false, s.shield).vitality
  assert.deepEqual([...ctx.getImageData(hp.x + hp.w * .6 | 0, hp.y + 24, 1, 1).data], [242, 184, 192, 255])
  step(s, true, .25) // simulation HP stays 18: delayed health still moves
  assert.notDeepEqual([...ctx.getImageData(hp.x + hp.w * .6 | 0, hp.y + 24, 1, 1).data], [242, 184, 192, 255])
  assert.ok(alphaAt(154, 333) && alphaAt(587, 363), 'initial projected cues have ink')
  s.executePrompt!.x = 346; s.terminal!.x = 456; s.terminal!.y = 507
  s.terminal!.progress = .75; s.boss!.hp = 33; s.combo.timer -= .4; s.combo.rankUpT = .2
  has(step(s, true), 'E  EXECUTE', 'HOLD E  1.5s')
  assert.equal(alphaAt(154, 333), 0); assert.equal(alphaAt(587, 363), 0)
  Object.assign(s, { dashCharge: 0, slashCharge: 1, swordDrawn: true })
  has(step(s, true), 'RELEASE: RAIJIN ZAN')
  step(s, false)
  s.swordDrawn = false; s.fistStrike = 'kick'
  has(step(s, true), 'RELEASE: FUJIN KYAKU')
  s.executePrompt!.x = -40; s.terminal = undefined; s.banner!.t = s.banner!.dur
  s.buff = undefined; s.boss = null; s.combo.hits = s.combo.rankUpT = 0; s.combo.rank = ''
  const words = step(s, true)
  for (const label of ['E  EXECUTE', 'HOLD E  1.5s', 'RUSH', 'BOSS', 'IRON LUNGS']) assert.ok(!words.includes(label), label)
  assert.equal(alphaAt(325, 333), 0); assert.equal(alphaAt(458, 453), 0)
  s.attract = true
  step(s, true)
  assert.ok(!pixels().some(Boolean), 'title kept stale fight ink')
  s.hp = 100
  step(s, false, 1 / 60)
})

test('touch, safe insets, CSS size, backing reset, restoration and inline HUD retain the same ink', () => {
  const { hud, full, ctx, step, layer, calls, pixels } = layerOracle(), s = structuredClone(base)
  const w = 400, h = 612, ratio = 1.37
  const render = (paint: boolean, cssW = w, scale = ratio) => step(s, paint, 0, cssW, h, scale)
  s.executePrompt = { x: 150, y: 380 }
  render(true); render(false)
  s.touch = true
  assert.ok(render(true).includes('TAP EXEC'))
  s.insets = { left: 17, top: 21, right: 13, bottom: 19 }
  render(true); render(false)
  s.insets.top++ // Same object, new safe area.
  render(true)
  render(true, w + .1) // CSS-to-backing transform changes, backing dimensions do not.
  render(false, w + .1)
  render(true, w, 3); render(false, w, 2) // independent and capped HUD DPR
  ctx.canvas.width = 1
  render(true)
  layer.isContextLost = () => true
  const count = calls.clears
  assert.equal(hud.drawLayer(layer, w, h, s, 1 / 60, ratio), false)
  assert.equal(calls.clears, count)
  layer.isContextLost = () => false
  ctx.canvas.width = ctx.canvas.width // New blank storage, identical dimensions.
  render(true); render(false)
  const world = createCanvas(w, h).getContext('2d')
  for (const fill of ['#356', '#767']) {
    world.fillStyle = fill; world.fillRect(0, 0, w, h)
    hud.draw(world as unknown as CanvasRenderingContext2D, w, h, s, 0)
    const left = s.insets.left + 16, top = s.insets.top + 16
    assert.deepEqual([...world.getImageData(left + 6, top + 1, 1, 1).data], [255, 145, 166, 255])
    assert.equal(world.getImageData(0, 0, 1, 1).data[3], 255, 'inline HUD cleared scene')
  }
  render(true); render(false)
  hud.reset(); full.reset()
  render(true); assert.ok(pixels().some(Boolean))
})
