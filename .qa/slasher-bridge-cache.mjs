/** Compare the shipped Ultra decoder with the current archive decoder and
 * transferable window views. Pass the local Ultra standalone directory:
 * node --expose-gc --import tsx .qa/slasher-bridge-cache.mjs /path/to/ultra
 * This is a CPU-only microbenchmark, not startup/network or GPU timing. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BridgeRoute } from '../src/game/stage/route.ts'
import { chunkLightTile, packLightTile } from '../src/graphics/bridge/EnvBasis.ts'
import { packBake, unpackBake } from '../src/graphics/bridge/BridgeLZ4.ts'
import { BridgeWindowBake } from '../src/graphics/bridge/BridgeWindowBake.ts'
import { decodeWindow } from '../src/graphics/bridge/BridgeBakeProtocol.ts'

assert.ok(process.argv[2], 'Pass the local shipped Ultra standalone build directory')
const chunks = join(process.argv[2], '.next-build/static/chunks')
const read = f => readFileSync(join(chunks, f), 'utf8')
const shard = readdirSync(chunks).filter(f => f.endsWith('.js')).find(f => read(f).includes('LZ4 output length'))
assert.ok(shard, 'Ultra decoder shard missing')
const source = read(shard).match(/,0,(function\(\w+,\w+=\w+\.rawSize\)\{[^\n]*?throw RangeError\("LZ4 output length"\);return \w+\.buffer\})/)?.[1]
assert.ok(source, 'Ultra decoder signature changed')
// This tool takes our own local control build, not a fetched script or URL.
const shipped = Function(`return (${source})`)()
const route = new BridgeRoute(42)
const corpus = Array.from({ length: 24 }, (_, n) => packLightTile(chunkLightTile(route, route.chunk(n))))
for (const b of corpus) assert.deepEqual(new Uint8Array(shipped(b)), new Uint8Array(unpackBake(b)))
const stats = a => {
  const b = a.slice().sort((x,y) => x-y)
  return { n: b.length, p50: b[Math.floor(b.length*.5)], p95: b[Math.ceil(b.length*.95)-1] }
}
let sum = 0
const batch = fn => {
  for (let i = 0; i < 3; i++) for (const b of corpus) sum += new Uint8Array(fn(b))[b.rawSize - 413]
}
batch(shipped); batch(unpackBake)
const archive = [[], []]
for (let i = 0; i < 16; i++) for (const k of [i%2, 1-i%2]) {
  global.gc?.()
  const t = performance.now(); batch(k === 0 ? shipped : unpackBake); archive[k].push((performance.now()-t)/3)
}
const live = new BridgeWindowBake(route).bake(1, 1200, 2350, false)
const packed = packBake(live.blob.bytes.buffer)
assert.equal(packed.lz4, true)
assert.deepEqual(new Uint8Array(shipped(packed)), live.blob.bytes)
const raw = () => decodeWindow(live)
const compressed = () => decodeWindow({ ...live, blob: { ...packed, bytes: new Uint8Array(shipped(packed)), lz4: false } })
const view = raw()
assert.deepEqual(compressed(), view)
assert.ok([view.shadow, view.vectors, view.architecture, ...view.light.map(l => l.data), ...view.curb.map(l => l.data)]
  .every(v => v.buffer === live.blob.bytes.buffer))
const window = [[], []]
for (let i = 0; i < 50; i++) for (const k of [i%2, 1-i%2]) {
  const t = performance.now(); sum += (k === 0 ? compressed() : raw()).curb[0].data[2329] & 511
  window[k].push(performance.now() - t)
}
console.log(JSON.stringify({ node: process.version, control: readFileSync(join(process.argv[2], '.next-build/BUILD_ID'), 'utf8').trim(), shard,
  seed: 42, archive: { tiles: corpus.length, rawBytes: corpus.reduce((n,b) => n+b.rawSize,0), packedBytes: corpus.reduce((n,b) => n+b.bytes.byteLength,0),
    shippedDecodeBatchMs: stats(archive[0]), currentDecodeBatchMs: stats(archive[1]) },
  window: { packedBytes: packed.bytes.byteLength, rawBytes: live.blob.rawSize, identicalBytes: true, reusedBuffer: true,
    shippedBlockAndViewsMs: stats(window[0]), rawViewsMs: stats(window[1]) }, checksum: sum }, null, 2))
