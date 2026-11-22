import assert from 'node:assert/strict'
import test from 'node:test'
import {
  f16ToF32, f32ToF16, packArcPrim, packCapsulePrim, packHalf2x16, unpackArcMeta, unpackCapsuleMeta, unpackHalf2x16,
  unpackUnorm4x8_ES30, packArchProfile, packFootAO, readColumnSlot, SACRColumnBinner, SACR_MASTER_K, SACR_MOBILE_K, SACR_V4_BIN_SLOTS, SACRUniformBuffer,
  SACR_PRIORITY, type SACRBinItem,
} from '../src/graphics/sacr/SACRPacker'
import { bakeStratumMips, decodeRGB9E5, encodeRGB9E5, sampleStratumMips, stratumV, STRATUM_H, STRATUM_W } from '../src/graphics/sacr/SACRAtlas'
import { uploadSACRFrame, uploadStratumB } from '../src/graphics/sacr/SACRGL'

const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)

test('SACR std140: 3584 bytes, exact section offsets, shared uint/float views and retained ArchProfile', () => {
  const b = new SACRUniformBuffer()
  assert.equal(b.raw.byteLength, 3584)
  assert.equal(b.u32.buffer, b.raw); assert.equal(b.f32.buffer, b.raw)
  assert.equal(b.f32.length, 896)
  assert.deepEqual([SACR_V4_BIN_SLOTS, SACR_MOBILE_K, SACR_MASTER_K], [8, 4, 6])
  assert.deepEqual([SACRUniformBuffer.OFF_COLBINS, SACRUniformBuffer.OFF_PRIMPOOL,
    SACRUniformBuffer.OFF_ARCHPROFILE, SACRUniformBuffer.OFF_FOOTAO, SACRUniformBuffer.OFF_SHADOWBINS, SACRUniformBuffer.OFF_BLOCKERS, SACRUniformBuffer.OFF_SUPPORTS], [0, 160, 416, 544, 608, 768, 864])
  b.u32[0] = 0x4321; b.u32[160] = 0x1234
  packArchProfile(b, 0, 1.1, 2.5, 2, 3, [1, .5, 0])
  packFootAO(b, 0, 3, 2, .5, .0625)
  assert.deepEqual(Array.from(b.u32.slice(416, 420)), [1100, 2500, 0x42004000, 0xff0080ff])
  assert.deepEqual(Array.from(b.f32.slice(544, 548)), [3, 2, .5, .0625])
  b.clearFrame()
  assert.ok(b.u32.slice(0, 416).every(n => n === 0))
  assert.ok(b.u32.slice(544).every(n => n === 0))
  assert.deepEqual(Array.from(b.u32.slice(416, 420)), [1100, 2500, 0x42004000, 0xff0080ff])
  b.clearArchitecture(); assert.ok(b.u32.every(n => n === 0))
})

test('binary16: low X / high Y, proper rounded exponent carry, signed values and small normals', () => {
  assert.equal(packHalf2x16(1, -2), 0xc0003c00)
  assert.deepEqual(unpackHalf2x16(0xc0003c00), [1, -2])
  assert.equal(f32ToF16(1.9999), 0x4000)
  assert.equal(f32ToF16(-1.9999), 0xc000)
  assert.equal(f32ToF16(2 ** -25), 0)
  assert.equal(f32ToF16(2 ** -25 + 2 ** -46), 1)
  assert.equal(f32ToF16(2 ** -24), 1)
  assert.equal(f32ToF16(1 + 2 ** -11), 0x3c00)
  assert.equal(f32ToF16(1 + 3 * 2 ** -11), 0x3c02)
  assert.equal(f16ToF32(1), 2 ** -24)
  assert.equal(f32ToF16(65504), 0x7bff)
  assert.equal(f32ToF16(65520), 0x7c00)
  assert.equal(f16ToF32(0xfc00), -Infinity)
  assert.ok(Object.is(f16ToF32(f32ToF16(-0)), -0))
  assert.ok(Number.isNaN(f16ToF32(f32ToF16(NaN))))
})

test('64 capsule IDs: exact metadata, 0–30 m grid followed by off-grid small coordinates, radii .02–1.20, energy error <15%', () => {
  const b = new SACRUniformBuffer(), ids = new Set<number>()
  const light = [0, .5, 4, 25] as const
  for (let i = 0; i < 64; i++) {
    // 1/64-m lattice samples the full range without asking binary16 for
    // precision it cannot encode. Off-grid/tolerance limits tested below.
    const ax = Math.round(i * 30 * 64 / 63) / 64, bx = 30 - ax
    const ay = .0011 + i * .061, by = 3.98 - ay, r0 = .02 + i * (1.18 / 63), r1 = .02 * (1 + i % 60)
    const e = light[i % light.length], q = 160 + 4 * i
    packCapsulePrim(b, i, ax, ay, bx, by, r0, bx, r1, 199, 123, 36, e, i)
    const [x, y] = unpackHalf2x16(b.u32[q]), [tx, ty] = unpackHalf2x16(b.u32[q + 1]), [radius, z] = unpackHalf2x16(b.u32[q + 2])
    for (const err of [x - ax, y - ay, tx - bx, ty - by, z - bx]) assert.ok(Math.abs(err) < .002)
    assert.ok(radius > 0 && Math.abs(radius - r0) < .0005)
    const m = unpackCapsuleMeta(b.u32[q + 3]); ids.add(m.charID)
    const eWord = e === 0 ? 0 : Math.round(Math.log2(4 * e + 1) / .23)
    assert.equal(b.u32[q + 3], ((1 + i % 60) + 24 * 2 ** 6 + 15 * 2 ** 11 + 4 * 2 ** 16 + eWord * 2 ** 21 + i * 2 ** 26) >>> 0)
    assert.equal(m.charID, i); assert.ok(Math.abs(m.r1 - r1) < 1e-10)
    assert.deepEqual(m.rgb, [24 / 31, 15 / 31, 4 / 31])
    if (e === 0) assert.equal(m.emis, 0)
    else assert.ok(relative(m.emis, e) < .15)
  }
  assert.equal(ids.size, 64)
  assert.equal(b.u32[416], 0, 'last pool slot cannot overlap the architecture')
})

test('binary16 precision boundary is explicit: arbitrary high coordinates cannot satisfy a 2 mm bound', () => {
  const actual = f16ToF32(f32ToF16(20.005))
  assert.equal(actual, 20)
  assert.equal(f16ToF32(f32ToF16(20) + 1) - 20, .015625)
  assert.ok(Math.abs(actual - 20.005) > .002)
  for (let i = 0; i < 3001; i++) {
    const x = i / 100 + .00027
    assert.ok(Math.abs(f16ToF32(f32ToF16(x)) - x) <= .007813)
  }
})

test('15–350° arcs have a negative radius flag, unit input and <.8° full-aperture error', () => {
  const b = new SACRUniformBuffer()
  for (let i = 0; i < 64; i++) {
    const theta = (15 + i * 335 / 63) * Math.PI / 360, phi = i * .21, r = .02 + 1.18 * i / 63
    packArcPrim(b, i, 1 + i / 8, .5, Math.cos(phi), Math.sin(phi), r, 6, .02 + i % 15 * .01, theta, 211, 223, 151, 25)
    const o = 160 + i * 4, [radius, z] = unpackHalf2x16(b.u32[o + 2]), [x, y] = unpackHalf2x16(b.u32[o + 1])
    assert.ok(radius < 0 && Math.abs(radius + r) < .0005)
    assert.equal(z, 6)
    assert.ok(Math.abs(Math.hypot(x, y) - 1) < .0004)
    const m = unpackArcMeta(b.u32[o + 3]), q = Math.round(theta / Math.PI * 255)
    assert.equal(b.u32[o + 3], (2 + i % 15 | q << 6 | 13 << 14 | 27 << 18 | 9 << 23 | 29 << 27) >>> 0)
    assert.ok(Math.abs(m.thetaHalf - theta) * 360 / Math.PI < .8)
    assert.ok(relative(m.emis, 25) < .15)
  }
  assert.throws(() => packArcPrim(b, 0, 0, 0, .5, .5, 2, 3, .07, 1, 255, 255, 255, 4), /unit vector/)
})

test('manual unorm4×8 decode uses unsigned little byte lanes, including high bit and zero', () => {
  assert.deepEqual(unpackUnorm4x8_ES30(0x80ff7f01), [1 / 255, 127 / 255, 1, 128 / 255])
  assert.deepEqual(unpackUnorm4x8_ES30(0xff000000), [0, 0, 0, 1])
  assert.deepEqual(unpackUnorm4x8_ES30(0), [0, 0, 0, 0])
})

test('RGB9_E5_REV zero exact; requested uniform luminances along all three channels round-trip within .25%', () => {
  assert.equal(encodeRGB9E5(0, 0, 0), 0)
  assert.deepEqual(decodeRGB9E5(encodeRGB9E5(2 ** -24, 0, 0)), [2 ** -24, 0, 0])
  for (const x of [1e-4, .5, 1, 12.5, 1024, 65000]) {
    for (const c of decodeRGB9E5(encodeRGB9E5(x, x, x))) assert.ok(relative(c, x) < .0025, `${c} from ${x}`)
    assert.deepEqual(decodeRGB9E5(encodeRGB9E5(0, 0, x)).slice(0, 2), [0, 0])
  }
  const q = encodeRGB9E5(1, 2, 3)
  assert.deepEqual(decodeRGB9E5(q), [1, 2, 3]); assert.equal(q, (128 | 256 << 9 | 384 << 18 | 17 << 27) >>> 0)
})

test('byte IDs 1–64, ±1.2 m column dilation, K admission before exact half-depth ascending sort', () => {
  const b = new SACRUniformBuffer(), bin = new SACRColumnBinner(), items: SACRBinItem[] = []
  for (let i = 0; i < 64; i++) {
    const x = .5 + i, zObj = i * .0625
    packCapsulePrim(b, i, x, 0, x, 1, .02, zObj, .02, 255, 255, 255, 0, i)
    items.push({ index: i, minX: x, maxX: x, zObj, priority: SACR_PRIORITY.enemy, distance: i })
  }
  bin.write(b, items, 80, 4)
  for (let i = 0; i < 64; i++) {
    const col = Array.from({ length: 4 }, (_, s) => readColumnSlot(b, i, s))
    assert.ok(col.includes(i + 1))
    assert.ok(col.includes(Math.min(64, i + 2)))
    assert.ok(!col.includes(i + 3))
    assert.equal(readColumnSlot(b, i, 4), 0)
  }
  const priorities = [3, 3, 3, 3, 2, 1, 0, 3, 3, 3] as const
  const crowd = items.slice(0, 10).map((p, i) => ({ ...p, minX: 2.3, maxX: 2.4, priority: priorities[i], distance: i === 7 ? .1 : i + 1 }))
  bin.write(b, crowd, 80, 4)
  for (const col of [1, 2, 3]) assert.deepEqual(Array.from({ length: 8 }, (_, s) => readColumnSlot(b, col, s)), [5, 6, 7, 8, 0, 0, 0, 0])
  bin.write(b, crowd, 80, SACR_MASTER_K)
  assert.deepEqual(Array.from({ length: SACR_V4_BIN_SLOTS }, (_, s) => readColumnSlot(b, 2, s)), [1, 2, 5, 6, 7, 8, 0, 0])
  assert.equal(readColumnSlot(b, 0, 0), 0); assert.equal(readColumnSlot(b, 4, 0), 0)
  assert.equal(b.u32[4], 0x06050201); assert.equal(b.u32[5], 0x00000807)
})

test('RGB9_E5 explicitly uploads 4 separate band-safe mips; one UBO update and no Y inversion', () => {
  const image = new Float32Array(STRATUM_W * STRATUM_H * 3)
  for (let i = 0; i < STRATUM_W * STRATUM_H; i++) image[i * 3 + Number(i >= STRATUM_W * STRATUM_H / 2)] = 1
  const mips = bakeStratumMips(image)
  assert.deepEqual(mips.map(m => [m.w, m.h]), [[512, 128], [256, 64], [128, 32], [64, 16]])
  for (const m of mips) {
    const end = m.w * m.h / 2
    assert.ok(m.data.subarray(0, end).every(x => decodeRGB9E5(x)[0] === 1 && decodeRGB9E5(x)[1] === 0))
    assert.ok(m.data.subarray(end).every(x => decodeRGB9E5(x)[0] === 0 && decodeRGB9E5(x)[1] === 1))
  }
  for (const lod of [0, 1.2, 2.75, 3]) {
    assert.deepEqual(sampleStratumMips(mips, -.2, stratumV(1, false, lod), lod), [1, 0, 0])
    assert.deepEqual(sampleStratumMips(mips, 1.2, stratumV(0, true, lod), lod), [0, 1, 0])
  }
  assert.equal(stratumV(0, false, 0), .004); assert.equal(stratumV(1, true, 0), .996)
  const log: [string, ...unknown[]][] = []
  const tracingGL = new Proxy({}, { get: (_, key: string) => /^[A-Z0-9_]+$/.test(key) ? key : (...args: unknown[]) => {
    log.push([key, ...args])
    if (key === 'getParameter') return true // DOM upload flags already set
    if (key === 'getError') return 'NO_ERROR'
  } }) as WebGL2RenderingContext
  const texture = {} as WebGLTexture, buffer = {} as WebGLBuffer, packet = new SACRUniformBuffer()
  uploadStratumB(tracingGL, texture, mips)
  uploadSACRFrame(tracingGL, buffer, packet)
  assert.deepEqual(log.filter(([k]) => k === 'texImage2D'), mips.map((m, i) =>
    ['texImage2D', 'TEXTURE_2D', i, 'RGB9_E5', m.w, m.h, 0, 'RGB', 'UNSIGNED_INT_5_9_9_9_REV', m.data]))
  assert.deepEqual(log.filter(([k]) => k === 'bufferSubData'), [['bufferSubData', 'UNIFORM_BUFFER', 0, packet.u32]])
  assert.deepEqual(log.filter(([k, param]) => k === 'pixelStorei' && param === 'UNPACK_FLIP_Y_WEBGL'), [
    ['pixelStorei', 'UNPACK_FLIP_Y_WEBGL', false], ['pixelStorei', 'UNPACK_FLIP_Y_WEBGL', true]])
  assert.ok(!log.some(([k]) => k === 'generateMipmap'))
})
