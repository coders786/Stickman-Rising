/** CPU-only wall time. This is not a GPU benchmark or a phone FPS claim. */
import { bakeChunkLight, BridgeEnvAtlas } from '../src/graphics/bridge/EnvBasis'
import { BridgeRoute } from '../src/game/stage/route'
import { cpus } from 'node:os'

const route = new BridgeRoute(42), chunks = Array.from({ length: 36 }, (_, i) => route.chunk(i))
const measure = (run: () => void) => { const start = performance.now(); run(); return performance.now() - start }
const summary = (ms: number[]) => {
  ms.sort((a, b) => a - b)
  const q = (p: number) => +(ms[Math.min(ms.length - 1, Math.ceil(ms.length * p) - 1)].toFixed(3))
  return { n: ms.length, p50: q(.5), p95: q(.95), max: q(1) }
}
const first = measure(() => { bakeChunkLight(chunks[0]) })
for (const c of chunks) bakeChunkLight(c)
const individual = chunks.map(c => measure(() => { bakeChunkLight(c) }))
const atlas = new BridgeEnvAtlas(), initial = measure(() => atlas.update(route, 0, 1080))
const pan: number[] = [], steady: number[] = []
for (let x = 1; x < 22000; x += 29) {
  const version = atlas.version, ms = measure(() => atlas.update(route, x, x + 1100))
  ;(atlas.version === version ? steady : pan).push(ms)
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, seed: 42, units: 'ms wall-clock, no rendering',
  firstChunk: first, warmCodeNewTiles: summary(individual), coldAtlas: initial, overlapShifts: summary(pan), heldFrames: summary(steady) }, null, 2))
