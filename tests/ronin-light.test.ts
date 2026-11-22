import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { drawFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_STYLE } from '../src/game/anim/skeleton'
import { Player } from '../src/game/entities/player'
import { newReceiverRig, RECEIVER, sampleReceiverRig } from '../src/game/lighting/receiver'
import { BRIDGE_LIGHT, BridgeFrame } from '../src/game/render/bridge-frame'
import { BridgeRoute } from '../src/game/stage/route'

const paint = (p: Player, ghost?: string, flash = 0) => {
  const ctx = createCanvas(310, 320).getContext('2d') as unknown as CanvasRenderingContext2D
  ctx.translate(154.3, 156.7); ctx.rotate(.041); ctx.scale(2.27 * p.face, 2.27)
  ctx.createLinearGradient = ctx.createRadialGradient = () => { throw new Error('Ronin ink must be flat') }
  drawFighter3D(ctx, p.geom, PLAYER_STYLE, {
    ghost, flash, time: 7.2,
    hands: { leftOpen: .95, rightOpen: .22, leftRoll: .19, rightRoll: -.2 },
    scarfCount: 4, scarfNodes: [{ x: -2, y: -40 }, { x: -9, y: -43 }, { x: -16, y: -40 }, { x: -23, y: -42 }],
  })
  return ctx.getImageData(0, 0, 310, 320).data
}

test('the Ronin keeps flat opaque ink, including both hands and scarf, independent of signed Z', () => {
  const p = new Player()
  for (const face of [-1, 1] as const) {
    p.reset(240); p.face = face
    const plain = paint(p)
    let solid = 0, antialiased = 0
    for (let i = 0; i < plain.length; i += 4) {
      assert.equal(plain[i] | plain[i + 1] | plain[i + 2], 0)
      solid += +(plain[i + 3] === 255)
      antialiased += +(plain[i + 3] > 0 && plain[i + 3] < 255)
    }
    assert.ok(solid > 1000 && antialiased > 100)
    for (const joint of Object.values(p.geom)) if (typeof joint === 'object') joint.z = 500 - joint.z * 6
    assert.deepEqual(paint(p), plain)
    assert.ok(!Buffer.from(paint(p, '#182025')).equals(Buffer.from(plain)), 'authored echoes keep their tint')
    assert.ok(!Buffer.from(paint(p, undefined, .72)).equals(Buffer.from(plain)), 'the hit flash still paints')
  }
})

test('the retained material receiver still supplies opposing practicals, occlusion and combat to enemies', () => {
  const route = new BridgeRoute(42), f = new BridgeFrame(), p = new Player()
  const read = (x: number, blocked = false, flash = false) => {
    p.reset(x)
    f.begin({ x, y: -110, zoom: 1.49, rot: 0 }, 960, 620, 8.4, .32, .24, .94, -.62, 0, 0, 0)
    f.gatherBlockers(route, undefined, undefined, blocked ? [{ left: 2113, right: 2135, top: -216, bottom: -79, kind: 'cargo' }] : [])
    if (flash) f.light(BRIDGE_LIGHT.impulse, x + 18, -79, 134, '#8fe8ff', 2.3, 4, x + 60, -86)
    const parts = newReceiverRig()
    // Same posed receiver interface used for enemy armor. Do not call this
    // with the playable Ronin in the renderer; the rig just supplies a pose here.
    sampleReceiverRig(f, p, parts)
    return parts
  }
  const warm = read(2086), left = read(330), cool = read(22839), blocked = read(2086, true), strike = read(2086, false, true)
  const head = RECEIVER.head, torso = RECEIVER.torso
  assert.ok(warm[head].fixtures[0].r > .4 && warm[torso].fixtures[0].dx > .25)
  assert.ok(left[torso].fixtures[0].dx < -.5)
  assert.ok(cool[head].fixtures[0].b > cool[head].fixtures[0].r * 1.6)
  assert.ok(blocked[head].fixtures[0].r < .1 * warm[head].fixtures[0].r)
  assert.ok(strike[head].b > .08 && strike[head].dx > 0)
})
