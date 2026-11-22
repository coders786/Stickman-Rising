import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@shaderfrog/glsl-parser/index.js'
import { Enemy } from '../src/game/entities/enemy'
import { makeSkelGeom } from '../src/game/anim/skeleton'
import { GPUActorBatch, GPU_ACTOR_CAPACITY, GPU_ACTOR_STRIDE } from '../src/game/render/gpu-actor-batch'
import { ACTOR_PROTOTYPE_FRAG, ACTOR_PROTOTYPE_VERT } from '../src/gpu/bridge-actor-prototype-shaders'

function actor() {
  const geom = makeSkelGeom()
  Object.assign(geom.hip, { x: 2, y: 3 })
  Object.assign(geom.hipPtL, { x: -3, y: 5 })
  Object.assign(geom.kneeL, { x: -5, y: 15 })
  Object.assign(geom.waist, { x: 3, y: -2 })
  Object.assign(geom.chest, { x: 4, y: -10 })
  Object.assign(geom.headC, { x: 5, y: -20 })
  return { x: 1000, y: 0, hipY: -40, scale: 2, face: -1, geom }
}

test('prototype uses live detailed rig, camera-relative transform and optional weapon', () => {
  const batch = new GPUActorBatch(), a = actor()
  batch.begin(990); batch.actor(a, 0x804020)
  assert.equal(batch.count, 14) // two full limbs per side, torso/neck and head
  assert.deepEqual(Array.from(batch.data.slice(0, 4)), [16, -30, 20, -10])
  assert.deepEqual(Array.from(batch.data.slice(6, 9)), [128 / 255, 64 / 255, 32 / 255].map(Math.fround))
  batch.begin(990)
  batch.actor(a, 0, 1, [{ a: { x: 0, y: 0 }, b: { x: 10, y: -5 }, r0: 1.5, r1: .7 }])
  assert.equal(batch.count, 15)
  assert.deepEqual(Array.from(batch.data.slice(14 * GPU_ACTOR_STRIDE, 14 * GPU_ACTOR_STRIDE + 4)), [10, -40, -10, -50])
  assert.deepEqual(Array.from(batch.data.slice(5 * GPU_ACTOR_STRIDE, 5 * GPU_ACTOR_STRIDE + 4)), [6, -34, 4, -44])
})

test('bounded overflow and invalid coordinates require whole-batch fallback; begin resets', () => {
  const batch = new GPUActorBatch(), a = actor()
  batch.begin(0)
  for (let i = 0; i < 100; i++) batch.actor(a, 0)
  assert.equal(batch.overflow, true)
  assert.equal(batch.count, GPU_ACTOR_CAPACITY)
  batch.begin(0); batch.actor({ ...a, scale: NaN }, 0)
  assert.equal(batch.overflow, true)
  batch.begin(0); batch.actor(a, 0)
  assert.equal(batch.overflow, false); assert.equal(batch.count, 14)
})

test('prototype shaders parse as GLSL ES 3', () => {
  assert.doesNotThrow(() => parse(ACTOR_PROTOTYPE_VERT))
  assert.doesNotThrow(() => parse(ACTOR_PROTOTYPE_FRAG))
})

test('diagnostic pass submits bounded instances and disposes resources', async () => {
  const { BridgeActorPrototype } = await import('../src/gpu/bridge-actor-prototype')
  const calls: { name: string; args: unknown[] }[] = []
  const constants: Record<string, number> = { ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2, FLOAT: 3, BLEND: 4,
    SRC_ALPHA: 5, ONE_MINUS_SRC_ALPHA: 6, ONE: 7, TRIANGLE_STRIP: 8 }
  const gl = new Proxy(constants, { get(target, prop: string) {
    if (prop in target) return target[prop]
    return (...args: unknown[]) => {
      calls.push({ name: prop, args })
      if (prop === 'createVertexArray' || prop === 'createBuffer' || prop === 'getUniformLocation') return {}
    }
  } }) as unknown as WebGL2RenderingContext
  const pass = new BridgeActorPrototype(gl, {} as WebGLProgram), batch = new GPUActorBatch()
  batch.begin(990); batch.actor(actor(), 0xffffff)
  assert.equal(pass.draw(batch, 800, 600, -20, 1.2, .2), true)
  assert.deepEqual(calls.find(c => c.name === 'drawArraysInstanced')?.args, [8, 0, 4, 14])
  assert.equal(calls.find(c => c.name === 'bufferSubData')?.args[4], 14 * GPU_ACTOR_STRIDE)
  batch.overflow = true
  assert.equal(pass.draw(batch, 800, 600, 0, 1, 0), false)
  assert.equal(calls.filter(c => c.name === 'drawArraysInstanced').length, 1)
  pass.dispose(); pass.dispose()
  assert.equal(calls.filter(c => c.name === 'deleteBuffer').length, 1)
  assert.equal(calls.filter(c => c.name === 'deleteVertexArray').length, 1)
})


test('enemy weapon diagnostic follows the actual weapon origin and reach', () => {
  const expected = { grunt: 30, assassin: 20, heavy: 34, gunner: 34, elite: 44, boss: 92 } as const
  for (const [kind, length] of Object.entries(expected)) {
    const e = new Enemy(kind as keyof typeof expected, 0, 1)
    e.geom.handR.x = 3; e.geom.handR.y = 7; e.geom.bladeAngle = 0
    const parts = e.bridgePrototypeWeapon()
    assert.equal(parts[0].b.x, 3 + length, kind)
    assert.equal(parts[0].b.y, 7, kind)
    if (kind === 'heavy') assert.equal(parts.length, 2)
    if (kind === 'gunner') assert.equal(parts[0].a.x, -7)
  }
  const shield = new Enemy('shield', 0, 1); shield.geom.handL.x = 11
  assert.equal(shield.bridgePrototypeWeapon()[0].a.x, 17)
  assert.deepEqual(new Enemy('drone', 0, 1).bridgePrototypeWeapon(), [])
})

test('enemy aim, actor ordering and socket positions survive facing and camera changes', () => {
  const e = new Enemy('gunner', 300, 1)
  e.state = 'aim'; e.perch = {} as NonNullable<Enemy['perch']>
  ;(e as unknown as { aimAngle: number }).aimAngle = Math.PI / 2
  e.geom.handR.x = 6; e.geom.handR.y = -3; e.geom.bladeAngle = 0
  const parts = e.bridgePrototypeWeapon()
  assert.ok(Math.abs(parts[0].b.x - 6) < 1e-6)
  assert.ok(Math.abs(parts[0].b.y - 31) < 1e-6)
  const a = actor(), batch = new GPUActorBatch()
  batch.begin(990); batch.actor(a, 0, 1, undefined, 8)
  assert.equal(batch.data[4], 8) // enemy half-width in local space, scaled by 2
  const rear = Array.from(batch.data.slice(0, 4))
  a.face = 1; batch.actor(a, 0)
  assert.deepEqual(rear, [16, -30, 20, -10])
  assert.deepEqual(Array.from(batch.data.slice(14 * GPU_ACTOR_STRIDE, 14 * GPU_ACTOR_STRIDE + 4)), [4, -30, 0, -10])
  assert.equal(batch.count, 28)
})

test('player diagnostic follows shared saya and omits transitional false blade', async () => {
  const { Player } = await import('../src/game/entities/player')
  const p = new Player()
  p.geom.hip.x = 5; p.geom.hip.y = 8
  p.geom.grip.x = 12; p.geom.grip.y = -4
  p.geom.bladeProjAngle = Math.PI / 2; p.geom.bladeProjLen = 30
  p.swordDrawn = false
  const sheathed = p.bridgePrototypeWeapon()
  assert.equal(sheathed.length, 1)
  assert.deepEqual(sheathed[0].a, { x: 8, y: 9 })
  assert.ok(sheathed[0].b.x < sheathed[0].a.x)
  p.swordDrawn = true
  const drawn = p.bridgePrototypeWeapon()
  assert.equal(drawn.length, 2)
  assert.ok(Math.abs(drawn[1].b.x - 12) < 1e-8)
  assert.ok(Math.abs(drawn[1].b.y - 26) < 1e-8)
  ;(p as unknown as { sheathAct: unknown }).sheathAct = { mode: 'draw', t: .2, dur: .3 }
  assert.equal(p.bridgePrototypeWeapon().length, 1)
  ;(p as unknown as { sheathAct: unknown }).sheathAct = { mode: 'sheathe', t: .2, dur: .8 }
  assert.equal(p.bridgePrototypeWeapon().length, 1)
})
