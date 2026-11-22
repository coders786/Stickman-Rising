import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { createCanvas } from '@napi-rs/canvas'
import sharp from 'sharp'
import { lintShader, rgb9MipErrors } from '../scripts/lint-webgl'
import { Game } from '../src/game/game'
import { DEFAULT_SETTINGS } from '../src/game/core/types'
import { lockQualityPreset } from '../src/game/render/graphics'
import { hudRegions, type HudBox } from '../src/game/render/hud'
import { BridgeRoute, travelledMetres } from '../src/game/stage/route'
import { paintTransitSign } from '../src/game/stage/route-art'
import { shelterPortal } from '../src/game/stage/run-layout'
import { BridgeFrame, BRIDGE_LIGHT, MOBILE_FLASH_LIMIT } from '../src/game/render/bridge-frame'
import { Camera, LOGICAL_HEIGHT } from '../src/game/core/camera'
import { bridgeBacking, MASTER_PIXEL_LIMIT } from '../src/graphics/sacr/BridgeBacking'
import { SACR_DILATION, SACR_MASTER_K, SACR_PRIORITY, SACRUniformBuffer, unpackArcMeta, unpackCapsuleMeta, unpackHalf2x16 } from '../src/graphics/sacr/SACRPacker'
import { BRIDGE_PROGRAMS } from '../src/gpu/bridge-programs'

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? sourceFiles(join(root, e.name)) : /\.[cm]?[jt]sx?$/.test(e.name) ? [join(root, e.name)] : [])
}

test('real Ultra preset click semantics lock 1.25x immediately; actual HUD draws a toggleable final FPS label', () => {
  const game = new Game(), texts: string[] = []
  const ctx = createCanvas(400, 844).getContext('2d')
  const fill = ctx.fillText.bind(ctx)
  ctx.fillText = (text, x, y, width) => { texts.push(text); fill(text, x, y, width) }
  game.phase = 'playing'; game.touchControls = true
  game.applySettings({ ...DEFAULT_SETTINGS, quality: 'ultra', adaptiveQuality: true, showFps: false })
  for (let i = 0; i < 500; i++) game['scaleControl'].frame(33)
  assert.ok(game.renderConfig.renderScale < 1.25)
  const lock = lockQualityPreset({ ...DEFAULT_SETTINGS, quality: 'ultra', adaptiveQuality: true }, 'ultra')
  game.applySettings({ ...lock, showFps: true })
  assert.deepEqual(game.renderConfig, { preset: 'ULTRA', adaptiveEnabled: false, renderScale: 1.25, showFPS: true })
  for (let i = 0; i < 300; i++) assert.equal(game['scaleControl'].frame(60), false)
  game['sampledFps'] = 57
  const draw = () => game.hud.draw(ctx as unknown as CanvasRenderingContext2D, 400, 844, game['buildHudState'](), 1 / 60)
  draw()
  assert.equal(game.hud.lastFpsDraw, '57 FPS'); assert.equal(texts.at(-1), '57 FPS')
  for (const label of [/^STYLE /, /^SECTOR /, /\b\d+ m$/, /^OVERDRIVE$/]) assert.ok(texts.some(s => label.test(s)), String(label))
  game.applySettings({ ...lock, showFps: false }); texts.length = 0; draw()
  assert.equal(game.hud.lastFpsDraw, null); assert.ok(!texts.some(s => s.endsWith(' FPS')))
  assert.equal(game.renderConfig.renderScale, 1.25)
})

test('400×844: parsed Settings Back target >=44px stays in the safe header; live HUD plates do not overlap', () => {
  const css = readFileSync('src/app/globals.css', 'utf8')
  const src = ts.createSourceFile('page.tsx', readFileSync('src/app/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let button: ts.JsxOpeningElement | undefined, hud: ts.JsxSelfClosingElement | undefined
  function visit(n: ts.Node) {
    if (ts.isJsxOpeningElement(n) && n.attributes.getText(src).includes('data-settings-back')) button = n
    if (ts.isJsxSelfClosingElement(n) && n.attributes.getText(src).includes('data-render-layer="hud"')) hud = n
    ts.forEachChild(n, visit)
  }
  visit(src)
  assert.ok(button?.getText(src).includes('sr-settings-back'))
  assert.match(button!.getText(src), /setScreen\(settingsFrom === 'paused' \? 'paused' : 'title'\)/)
  assert.match(hud!.getText(src), /screen === 'settings' \? 'hidden' : 'visible'/)
  const rule = css.match(/\.sr-settings-back\s*\{([^}]*)\}/)?.[1] ?? ''
  const px = (name: string) => Number(rule.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1])
  const minHeight = px('min-block-size'), minWidth = px('min-inline-size')
  assert.ok(minHeight >= 44 && minWidth >= 44)
  const header = css.match(/\.sr-settings\s*\{([^}]*)\}/)?.[1] ?? ''
  const safe = (edge: string) => Number(header.match(new RegExp(`var\\(--sr-inset-${edge}\\) \\+ (\\d+)px`))?.[1])
  const w = 400, h = 844, inset = { top: 24, right: 9, bottom: 13, left: 11 }
  const back: HudBox = { x: w - Math.max(inset.right + safe('right'), w * .04) - minWidth, y: inset.top + safe('top'), w: minWidth, h: minHeight }
  assert.ok(back.x > w / 2 && back.y >= 16 + inset.top && back.y + back.h < h * .25)
  assert.ok(back.x + back.w <= w - 16 - inset.right)
  const r = hudRegions(w, h, true, 50, inset), boxes = [r.vitality, r.telemetry, r.score, r.fps, back]
  for (const [i, a] of boxes.entries()) {
    assert.ok(a.x >= r.l && a.x + a.w <= r.r && a.y >= r.top && a.y + a.h <= r.bottom)
    for (const b of boxes.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
      `400×844 boxes overlap: ${JSON.stringify([a, b])}`)
  }
  for (const f of sourceFiles('src')) assert.doesNotMatch(readFileSync(f, 'utf8'), /\bratings?\b/i, f)
})

test('the actual continuous route reaches 15,000px on ten seeds; advisory and shelter spacing, sequential painted CITY LINK signs', () => {
  for (const seed of [0, 1, 8, 42, 61, 87, 91, 1001, 0x9e3779b9, 0xffffffff]) {
    const route = new BridgeRoute(seed), chunks = [...route.between(0, 15000)]
    let wet = -Infinity, shelter = -Infinity, x = 0, transitSign = 0
    assert.ok(chunks.at(-1)!.right >= 15000)
    const ctx = { fillText: (s: string) => {
      const match = s.match(/^CITY LINK \/ (\d+)$/); assert.ok(match); assert.equal(Number(match[1]), ++transitSign)
    } } as unknown as CanvasRenderingContext2D
    for (const c of chunks) {
      assert.equal(c.left, x); x = c.right
      paintTransitSign(ctx, c)
      if (c.wetSign !== null) { assert.ok(c.wetSign - wet >= 1800); wet = c.wetSign }
      if (c.shelter) { assert.ok(c.shelter.left - shelter >= 2500); shelter = c.shelter.left }
    }
    assert.ok(wet > 10000 && shelter > 8000 && transitSign >= 10)
  }
  assert.equal(travelledMetres(1240), 100, 'HUD does not consume the 48 px/m presentation units')
  assert.equal(LOGICAL_HEIGHT, 540)
})

test('live route packet retains atlas at sub-chunk camera moves, rolls across chunks, and packs actual boot/scarf and light geometry', () => {
  const game = new Game(), route = new BridgeRoute(42), f = new BridgeFrame()
  const bay = route.chunk(3).shelter!, portal = shelterPortal(bay)
  const start = () => f.begin({ x: bay.left - 101, y: -112, zoom: 1.22, rot: .02 }, 1180, 660, 7.5, .48, .55, .76, .7, 0, 0, 0)
  start()
  const p = game.player
  // Real solved pose, translated as the route's render lerp does.
  p.reset(bay.left - 100)
  for (let i = 0; i < 4; i++) p.update(1 / 60, game['worldRef'])
  const { s, left, right } = { s: f.sacr, ...f.view }
  s.begin(left, right, f.cam.x, SACR_MASTER_K, route)
  assert.ok(s.camWorldX < f.cam.x / 48 && s.stratum.portals >= 1)
  const arch = Array.from(s.packet.u32.slice(416, 544)), firstVersion = s.stratum.version
  assert.ok(arch.some((v, i) => i % 4 === 0 && Math.abs(s.stratum.originX + v / 1000 - portal.left / 48) < .001))
  s.begin(left + .2, right + .2, f.cam.x + .2, SACR_MASTER_K, route)
  assert.equal(s.stratum.version, firstVersion); assert.deepEqual(Array.from(s.packet.u32.slice(416, 544)), arch)
  s.actor(p, 0, SACR_PRIORITY.player, undefined, p.bridgeScarfNodes())
  assert.equal(s.scarves, 2)
  const count = s.primitives
  assert.ok(count > 4 && s.feet > 0)
  for (let j = 0; j < count; j++) assert.equal(unpackCapsuleMeta(s.packet.u32[160 + j * 4 + 3]).charID, 0)
  f.impulseLimit = MOBILE_FLASH_LIMIT
  f.light(BRIDGE_LIGHT.point, p.x, -40, 120, '#ffffff', .8, 1)
  f.light(BRIDGE_LIGHT.impulse, p.x, -60, 130, '#aaccff', 2.6, 3, p.x + 50, -40, 0, 19)
  assert.equal(f.light(BRIDGE_LIGHT.impulse, p.x, -60, 160, '#ffffff', 3, 1), false)
  assert.deepEqual(Array.from(f.mobileFlashIndices), [1, -1])
  f.impulseLimit = 4
  f.strikeArc(p.x, -60, 60, .8, 4, '#ffeeaa', 3.3, 2.7)
  f.packReflectedImpulses(); s.seal()
  assert.equal(s.emissives, 2); assert.equal(s.arcs, 1)
  const pos = unpackHalf2x16(s.packet.u32[160 + count * 4])
  const nom = (p.x - left - .2) / 48
  assert.ok(Math.abs(pos[0] - nom) < .004 && pos[1] === 1.25)
  assert.ok(unpackArcMeta(s.packet.u32[160 + (count + 1) * 4 + 3]).emis > 20)
  assert.ok(Array.from(s.packet.u32.slice(0, 160)).some(Boolean))
  s.begin(left + 15000, right + 15000, f.cam.x + 15000, 4, route)
  assert.ok(s.stratum.version > firstVersion && s.stratum.originX > 200)
  assert.deepEqual(s.stratum.mips.map(m => m.w), [512, 256, 128, 64])
  assert.equal(SACR_DILATION, 1.2)
  assert.equal(s.packet.raw.byteLength, SACRUniformBuffer.BYTE_LENGTH)
})

test('presentation tier is separate from the preference: capped portrait/landscape Mobile, native Master and no hidden downgrade', async () => {
  assert.deepEqual(bridgeBacking('master', 1180, 660, 1.25), { scale: 1.25, w: 1475, h: 825 })
  assert.ok(1475 * 825 < MASTER_PIXEL_LIMIT)
  assert.deepEqual(bridgeBacking('master', 1180, 660, .75), { scale: .75, w: 885, h: 495 })
  assert.deepEqual(bridgeBacking('mobile', 400, 844, 1.25), { scale: 1, w: 400, h: 844 })
  assert.equal(bridgeBacking('mobile', 400, 844, .75).scale, .85)
  for (const [w, h] of [[3840, 2160], [2160, 3840], [5000, 640]]) {
    const b = bridgeBacking('mobile', w, h, 1.25)
    assert.ok(Math.max(b.w, b.h) <= 1920 && Math.min(b.w, b.h) <= 1080)
  }
  const cam = new Camera(); cam.setTravelFraming(true); cam.setViewport(400, 844); cam.startOnRoad(240)
  assert.equal(cam.zoom, 844 / 540)
  assert.match(BRIDGE_PROGRAMS.masterRoad[1], new RegExp(`#define SACR_K ${SACR_MASTER_K}`))
  assert.match(BRIDGE_PROGRAMS.mobileRoad[1], /#define SACR_K 4/)
  for (const [name, w, h] of [['stratum-a', 256, 64], ['l1', 1024, 240], ['l2', 1024, 280]] as const) {
    const data = await sharp(`public/bridge/${name}.webp`).metadata()
    assert.deepEqual([data.format, data.width, data.height], ['webp', w, h])
  }
})

test('the build linter rejects wrong GLSL version, ES-incompatible ops, std140 drift, packed mips and UBO aliasing', () => {
  assert.ok(lintShader('void main(){}', 'versionless').some(s => s.includes('#version 300 es')))
  const shell = '#version 300 es\nprecision highp float; precision highp int;\n'
  for (const word of ['unpackUnorm4x8', 'packUnorm4x8', 'imageLoad', 'imageStore', 'atomicOr', 'uintBitsToFloat']) {
    assert.ok(lintShader(`${shell} void main(){${word}(0u);}`, 'reject').some(s => s.includes(`forbidden WebGL2 op ${word}`)))
  }
  const block = 'layout(std140) uniform B { uvec4 data[8]; };'
  const a = `${shell} ${block} uniform int i; void main(){ uvec4 q=data[i]; uint u=q[i]+data[i][i]; }`
  assert.ok(lintShader(a, 'array').filter(x => x.includes('dynamic vector-lane')).length >= 2)
  assert.deepEqual(lintShader(`${shell} ${block} uniform int i; void main(){ uint u=data[i].w; }`, 'safe array'), [])
  assert.ok(lintShader(BRIDGE_PROGRAMS.mobileRoad[1].replace('u_FootAO[16]', 'u_FootAO[15]'), 'layout').some(s => s.includes('3584 bytes')))
  assert.deepEqual(rgb9MipErrors('uploadStratumB(gl, tex, mips);', 'upload'), [])
  assert.ok(rgb9MipErrors("gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB9_E5); gl.generateMipmap(gl.TEXTURE_2D)", "bad")[0]?.includes("explicit levels"))
})
