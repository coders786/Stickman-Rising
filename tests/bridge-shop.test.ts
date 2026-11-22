import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { Player } from '../src/game/entities/player'
import { castKey, castProjection } from '../src/game/render/bridge-casts'
import { canvasGlassLoss, GLASS_IOR, glassEyeDistance, glassIncidence, glassLayer, glassLens, glassSlab } from '../src/graphics/bridge/ShopGlassOptics'
import { deckFace, deckTopDepth, deckTopPath, TOP_LANE } from '../src/game/stage/bridge-deck-face'
import { bridgeShop, shopWindowRect } from '../src/game/stage/bridge-shop-layout'
import { districtSocket } from '../src/game/stage/bridge-sockets'
import { paintLaneDashes, paintWearingCourse } from '../src/game/stage/bridge-wearing-course'
import { ROAD } from '../src/game/stage/road-section'
import { chunkLightData } from '../src/graphics/bridge/NoirGeometry'
import { BridgeRoute } from '../src/game/stage/route'
import { BridgeSACRFrame } from '../src/graphics/sacr/BridgeSACRFrame'
import { SACR_ACTOR_Z, sacrFootAO, worldToSACRX } from '../src/graphics/sacr/SACRMath'
import { SACR_MASTER_K, SACRUniformBuffer } from '../src/graphics/sacr/SACRPacker'

const close = (a: number, b: number, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`)

test('wearing course paint is opaque within the road and stitches across independently painted chunks', () => {
  const left = 872, seam = 1152, right = 1499, depth = ROAD.front - ROAD.rear
  const draw = (l: number, r: number) => {
    const c = createCanvas(r - l, depth + 6), g = c.getContext('2d')
    g.translate(-l, 3 - ROAD.rear)
    const art = g as unknown as CanvasRenderingContext2D
    paintWearingCourse(art, l, r, true); paintLaneDashes(art, l, r, true)
    assert.ok(g.getImageData(0, 0, r - l, 3).data.every(v => v === 0))
    assert.ok(g.getImageData(0, depth + 3, r - l, 3).data.every(v => v === 0))
    const pixels = g.getImageData(0, 3, r - l, depth).data
    assert.ok(pixels.every((v, i) => i % 4 !== 3 || v === 255), 'albedo cannot punch holes in road coverage')
    return pixels
  }
  const whole = draw(left, right), a = draw(left, seam), b = draw(seam, right)
  let antialiased = 0
  for (let y = 0; y < depth; y++) for (let dx = -30; dx < 30; dx++) {
    const x = seam + dx, i = 4 * (y * (right - left) + x - left)
    const t = x < seam ? a : b, j = 4 * (y * (x < seam ? seam - left : right - seam) + x - (x < seam ? left : seam))
    const delta = Math.max(...[0,1,2].map(k => Math.abs(whole[i + k] - t[j + k])))
    antialiased += +(delta > 2)
    assert.ok(delta <= 12, `a patch or dash terminates at the chunk edge: ${x}, ${y}`)
  }
  // Skia's subpixel stroke coverage can round a tiny fraction of pixels
  // differently when the line is clipped by a separately sized bitmap.
  assert.ok(antialiased < 60 * depth * .01)
  assert.ok(new Set(whole.filter((_, i) => i % 4 === 0)).size >= 45, 'the albedo carries more than a flat bands/marks palette')
})

test('storefront glazing shares a fixed world aperture layout with the painter', () => {
  const route = new BridgeRoute(42), c = route.chunk(0), metro = bridgeShop(c)!
  assert.equal(bridgeShop(c), metro)
  assert.equal(metro.x, c.shelter!.left)
  assert.equal(metro.kind, 'concourse')
  assert.equal(metro.panes.length, 4)
  assert.equal(bridgeShop(route.chunk(3)), null, 'a closed maintenance shutter is not glass')
  const shops = [...route.between(0, 90_000)].flatMap(chunk => {
    const front = bridgeShop(chunk)
    if (!front) return []
    if (chunk !== c) assert.equal(front.x, districtSocket(chunk))
    const frame = shopWindowRect(front, front.frame)
    let prev = frame.left + 2
    for (const pane of front.panes) {
      const r = shopWindowRect(front, pane)
      assert.ok(r.left > prev && r.right + 2 < frame.right, `${front.kind}: leave real mullions and frame`)
      assert.ok(r.top > frame.top + 4 && r.bottom + 3 <= frame.bottom)
      prev = r.right + 2
    }
    return [front.kind]
  })
  assert.deepEqual(new Set(shops), new Set(['concourse','metro','market','garden']))
  const { points, blockers } = chunkLightData(c)
  assert.ok(!points.some(p => p.x === 271 && p.y === -221), 'no lamp at retired Track Watch')
  assert.ok(!blockers.some(b => b.left >= 260 && b.right <= 410 && b.top < -75), 'no ghost housing')
})

test('a projected glass layer has finite depth, camera parallax and no back-side return', () => {
  const eye = { x: 170, y: -128 }, z = 6.45, lens = { x:270, y:-184, z:4.1 }
  const p = glassLayer(z, eye, lens.z)!, moved = glassLayer(z, { x:eye.x+80, y:eye.y-40 }, lens.z)!
  const t = (z + 4.8) / ((z + 4.8) + (z - lens.z))
  close(p.scale, t)
  close(lens.x * t + p.x, eye.x + t * (lens.x - eye.x))
  close(lens.y * t + p.y, eye.y + t * (lens.y - eye.y))
  close(moved.x - p.x, 80 * (1 - t)); close(moved.y - p.y, -40 * (1 - t))
  assert.ok(glassLayer(z, eye, -35)!.scale < p.scale)
  assert.equal(glassLayer(z, eye, z), null)
  assert.equal(glassLayer(z, eye, z + 1), null)
})

test('6 mm clear glass transmits head-on and conserves polarization with and without absorption', () => {
  const f0 = ((GLASS_IOR - 1) / (GLASS_IOR + 1)) ** 2
  const [clearR, clearT] = glassSlab(1, 0), [roomR, roomT] = glassSlab(1)
  close(clearR, 2 * f0 / (1 + f0)); close(clearT, 1 - clearR)
  assert.ok(roomR > .077 && roomR < .081 && roomT > .89 && roomT < .90)
  assert.deepEqual(glassSlab(0), [1, 0])
  assert.deepEqual(glassSlab(0, 0), [1, 0])
  let previous = 1
  for (const cosine of [.01, .05, .17365, .34202, .5, .7071, .85, 1]) {
    const [r,t] = glassSlab(cosine), [idealR,idealT] = glassSlab(cosine, 0)
    assert.ok(r <= previous && r >= 0 && t >= 0 && r + t < 1)
    close(idealR + idealT, 1)
    assert.ok(t < idealT && r < idealR, 'the bulk removes energy from transmitted and internal reflected paths')
    close((1 - r) * (1 - canvasGlassLoss(r,t)), t)
    previous = r
  }
  const d = glassEyeDistance(6.58)
  close(glassIncidence(d,0,0), 1)
  close(glassIncidence(d, d * Math.sqrt(3),0), .5)
  assert.ok(glassSlab(glassIncidence(d,d * 5.7,0))[0] > .50)
})

test('a polished pane keeps a tighter finite lens return without inventing radiant energy', () => {
  const clear = glassLens(6.58,5.44,.17,9), rough = glassLens(6.58,5.44,.24,9)
  assert.ok(clear.radius < rough.radius && clear.peak > rough.peak)
  close(clear.peak * clear.radius ** 2, 81)
  close(rough.peak * rough.radius ** 2, 81)
  assert.ok(glassLens(6.58,-35,.24,9).peak < rough.peak)
})

test('top clip, source projection, support packet and sole lane agree on both raised decks', () => {
  const route = new BridgeRoute(43), chunks = [...route.between(0, 28000)]
  for (const role of ['catwalk', 'cargo']) {
    const c = chunks.find(c => c.role === role)!, p = c.platform!, face = deckFace(c), x = (p.left + p.right) * .5
    const edges: number[][] = []
    deckTopPath({ moveTo: (...p) => edges.push(p), lineTo: (...p) => edges.push(p), closePath: () => {} }, p, face)
    assert.deepEqual(edges, [[p.left, p.y], [p.left + face.returnX, p.y + face.returnY],
      [p.right + face.returnX, p.y + face.returnY], [p.right, p.y]])
    const y = p.y + face.returnY * TOP_LANE, mid = p.y + face.returnY * .5
    close(deckTopDepth(x, y, p, face)!, 0)
    close(deckTopDepth(x, p.y, p, face)!, -face.near)
    assert.equal(deckTopDepth(x, p.y + 1, p, face), null, 'the vertical fascia cannot receive top contact or cast')
    assert.equal(deckTopDepth(p.left + 2, mid, p, face), null)
    assert.ok(deckTopDepth(p.right + 2, mid, p, face)! > 0, 'the diagonal return extends beyond the collision X')
    const a = new Player(); a.reset(x); a.y = a.floorY = p.y
    const moon = castKey(.84, 1, 1, []), direct = castProjection(a, moon, { support: p, face })
    const road = castProjection(a, moon, null)
    close(direct.planeY, y); assert.equal(direct.floor, p.y)
    assert.equal(road.planeY, 0); assert.ok(road.x > direct.x + 75, 'elevated actor projects separately onto the road')
    const reversed = castProjection(a, castKey(.8, 0, 0, [{ x: .2, y: .8, z: -.4, energy: 1, id: 7, visibility: 1 }]), { support: p, face })
    assert.ok(direct.d < 0 && reversed.d > 0, 'the cast goes to the side of the lane opposite the incident Z')

    const f = new BridgeSACRFrame(), l = x - 300, r = x + 300
    f.begin(l, r, x, SACR_MASTER_K, route, null); f.architecture(route, l, r); f.actor(a, 0, 0); f.seal()
    assert.equal(f.supports, 1)
    const lane = f.packet.f32.slice(SACRUniformBuffer.OFF_SUPPORTS, SACRUniformBuffer.OFF_SUPPORTS + 4)
    close(lane[0], worldToSACRX(p.left, l), 1e-6); close(lane[2], -p.y / 48, 1e-6)
    close(lane[3], face.near, 1e-6)
    const soles = f.packet.f32.slice(SACRUniformBuffer.OFF_FOOTAO, SACRUniformBuffer.OFF_FOOTAO + 4)
    assert.ok(f.feet > 0 && soles[3] <= -1)
    assert.ok(Math.abs(soles[1] - SACR_ACTOR_Z) < .13, 'feet use the inboard lane, not the fascia lip')
    assert.equal(sacrFootAO(f.packet, soles[0], soles[1]), 1, 'never put an elevated sole on the road')
    assert.ok(sacrFootAO(f.packet, soles[0], soles[1], -p.y / 48) < .65)
    assert.equal(f.packet.u32.byteLength, 3584)
  }
})
