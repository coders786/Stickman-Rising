import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas, Path2D as NativePath } from '@napi-rs/canvas'
import { Enemy } from '../src/game/entities/enemy'
import { drawCastShadow, drawContactAO } from '../src/game/render/shadows'
import { material } from '../src/game/lighting/material'
import type { SurfaceLight } from '../src/game/lighting/ribbons'
import type { WorldRef } from '../src/game/core/types'

const light: SurfaceLight = { r: 1, g: .68, b: .4, dx: 0.9, dy: -0.4, keyX: -1, keyGain: 1 }

test('a practical changes enemy material without painting any previously transparent pixel', () => {
  const enemy = new Enemy('grunt', 72, 1)
  enemy.spawning = false
  enemy.state = 'chase'
  enemy.update(1 / 60, { time: 0.24, arenaMinX: 0, arenaMaxX: 3000 } as WorldRef)
  const pixels = (lighting?: SurfaceLight) => {
    const g = createCanvas(144, 156).getContext('2d')
    g.translate(0, 132)
    enemy.draw(g as unknown as CanvasRenderingContext2D, 0.24, lighting)
    return g.getImageData(0, 0, 144, 156).data
  }
  const flat = pixels(),
    lit = pixels(light)
  let changed = 0
  for (let i = 0; i < lit.length; i += 4) {
    if (flat[i + 3] === 0) assert.equal(lit[i + 3], 0, 'light painted the air')
    if (Math.abs(lit[i] - flat[i]) > 4) changed++
  }
  assert.ok(changed > 90, 'light never reached the visible body')
})

test('mirroring the actor does not mirror the world light', () => {
  for (const face of [-1, 1]) {
    const ctx = createCanvas(60, 60).getContext('2d')
    ctx.translate(30, 30)
    ctx.scale(face, 1)
    ctx.fillStyle = material(
      ctx as unknown as CanvasRenderingContext2D,
      '#606060',
      { ...light, dy: 0 },
      face,
    ) as string
    ctx.fillRect(-20, -20, 40, 40)
    assert.ok(ctx.getImageData(44, 30, 1, 1).data[0] > ctx.getImageData(16, 30, 1, 1).data[0] + 12)
  }
})

test('airborne cast and contact passes leave the air above the deck empty', () => {
  const ctx = createCanvas(240, 120).getContext('2d')
  ctx.translate(0, 80)
  const actor = new Enemy('grunt', 65, 1)
  actor.y = -28
  const path = new NativePath()
  path.rect(-5, -25, 10, 70)
  drawCastShadow(ctx as unknown as CanvasRenderingContext2D, actor, path as unknown as Path2D, 0.8, 0.5, 4)
  drawContactAO(ctx as unknown as CanvasRenderingContext2D, actor.x, actor.y, 24, 0.44)
  const alpha = (y: number, h: number) =>
    ctx.getImageData(0, y, 240, h).data.some((v, i) => i % 4 === 3 && v > 0)
  assert.equal(alpha(0, 72), false)
  assert.equal(alpha(80, 24), true)
})

test('Ultra bloom samples the whole backing store, not the top-left CSS-sized crop', async () => {
  const { PostStack } = await import('../src/game/render/post')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {configurable:true,value:{createElement:()=>createCanvas(1,1)}})
  try {
    const ctx = createCanvas(320,160).getContext('2d')
    ctx.scale(2,2); ctx.fillStyle = '#080808'; ctx.fillRect(0,0,160,80)
    ctx.fillStyle = '#b0b0b0'; ctx.fillRect(112,40,40,32)
    const post = new PostStack()
    post.compose(ctx as unknown as CanvasRenderingContext2D,160,80,[],0,1)
    assert.ok(ctx.getImageData(256,112,1,1).data[0] > 184, 'emitter in the bottom-right received no bloom')
    assert.ok(ctx.getImageData(24,24,1,1).data[0] <= 9, 'dark background washed out')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
