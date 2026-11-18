import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { POINT, FLOOD, SIGN_FACE, emission } from '../src/game/lighting/emitters'
import { RibbonField, newProbe } from '../src/game/lighting/ribbons'
import { liveGain, makeStageLights } from '../src/game/world/lightfield'
import { CyberBackground } from '../src/game/world/background'

test('shape, not tint, controls omni, cone and panel emission', () => {
  assert.equal(emission(POINT, 0, -1, -1), 1)
  assert.equal(emission(FLOOD, 26, 100, 32), 1)
  assert.equal(emission(FLOOD, -150, 100, 32), 0)
  const penumbra = emission(FLOOD, 73, 100, 32)
  assert.ok(penumbra > 0 && penumbra < 1)
  assert.equal(emission(SIGN_FACE, 0, 0, -10), 0)
  assert.equal(emission(SIGN_FACE, 30, 10, 10), 1)
  assert.ok(emission(SIGN_FACE, 110, 0, 10) < 0.5)
})
test('two competing practicals hand off without flipping a full-strength shadow', () => {
  const point = {
    ...makeStageLights(null, 3)[2],
    x: -75,
    y: -60,
    gain: 1,
    flicker: 0,
  }
  const f = new RibbonField([point, { ...point, id: 'other', x: 75 }], [], 5)
  const a = f.sample(-3, 0, newProbe()),
    b = f.sample(3, 0, newProbe()),
    mid = f.sample(0, 0, newProbe())
  assert.notEqual(a.caster?.id, b.caster?.id)
  assert.ok(mid.neon > 0.8 && mid.castW < 0.005)
  assert.ok(Math.abs(a.castW - b.castW) < 0.005)
})
test('streetlamp ballast stays continuous at 120 Hz even on the stormiest seed profile', () => {
  const l = makeStageLights({ light: { warm: 1, cool: 1, flicker: 1 } }, 1)[1]
  let prev = liveGain(l, 0)
  for (let i = 1; i < 1200; i++) {
    const v = liveGain(l, i / 120)
    assert.ok(v >= l.gain * 0.8 && Math.abs(v - prev) < 0.01)
    prev = v
  }
})
test('panning past a different light does not switch off the pool under the observer', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: { createElement: () => createCanvas(1, 1) },
    configurable: true,
  })
  try {
    const bg = new CyberBackground('medium')
    bg.setRunSeed(123)
    bg.resize(1000, 520)
    const tile = createCanvas(100, 54),
      ctx = tile.getContext('2d')
    ctx.translate(-1705, 0)
    const sample = (cx: number) => {
      // Fixed world-space patch within both frusta. Move only the camera.
      Object.assign(
        (bg as unknown as { lastCam: { x: number; zoom: number } }).lastCam,
        { x: cx, zoom: 1 },
      )
      ctx.clearRect(1705, 0, 100, 54)
      bg.drawLightPools(ctx as unknown as CanvasRenderingContext2D)
      return Buffer.from(ctx.getImageData(0, 0, 100, 54).data)
    }
    const a = sample(1350),
      b = sample(1810)
    assert.ok(a.some((n) => n > 0))
    assert.deepEqual(a, b)
    bg.setQuality('ultra')
    assert.ok(sample(1810).some((n) => n > 0))
    bg.setQuality('medium')
    assert.deepEqual(sample(1350), a)
  } finally {
    if (old) Object.defineProperty(globalThis, 'document', old)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('moving camera: cached sky keeps its moon; quality changes cannot move the light field',()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'document')
 Object.defineProperty(globalThis,'document',{value:{createElement:()=>createCanvas(1,1)},configurable:true})
 try{
  const bg=new CyberBackground('ultra');bg.setRunSeed(543);bg.resize(640,360)
  const ctx=createCanvas(640,360).getContext('2d') as unknown as CanvasRenderingContext2D
  const cam={x:200,y:-95,zoom:1};bg.drawSky(ctx,cam)
  const moon=bg.raySources(640,360,cam)[0]
  bg.update(1/120);cam.x+=2;bg.drawSky(ctx,cam)
  assert.deepEqual(bg.raySources(640,360,cam)[0],moon,'the moon rays slipped on a sky-cache hit')
  cam.x+=180;bg.drawSky(ctx,cam);assert.notEqual(bg.moonX,moon[0],'the repaint must track the pan')
  const probe=()=>Array.from({length:22},(_,i)=>{const p=bg.lightAt(i*110,-25);return [p.r,p.g,p.b,p.castW]})
  const before=probe();for(const q of ['medium','low','high','ultra'] as const){bg.setQuality(q);assert.deepEqual(probe(),before)}
 }finally{if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document')}
})
