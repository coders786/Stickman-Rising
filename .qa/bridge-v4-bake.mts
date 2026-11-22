import { performance } from 'node:perf_hooks'
import { BridgeRoute, BRIDGE_CHUNK_PX } from '../src/game/stage/route'
import { BridgeWindowBake } from '../src/graphics/bridge/BridgeWindowBake'
import { decodeWindow } from '../src/graphics/bridge/BridgeBakeProtocol'
import { chunkLightTile, enableLightTileArchive, packLightTile } from '../src/graphics/bridge/EnvBasis'
import { bakeBridgeDeckMask } from '../src/game/stage/bridge-material'

const perc = (values: number[]) => {
  const array = values.slice().sort((a,b) => a - b), p = (v: number) => Number(array[Math.ceil(array.length*v)-1].toFixed(3))
  return { n: array.length, p50: p(.50), p95: p(.95), p99: p(.99), max: p(1) }
}
const route = new BridgeRoute(42)
enableLightTileArchive(route)
const window = new BridgeWindowBake(route), chunks: number[] = [], shifts: number[] = [], decodes: number[] = []
let raw = 0, lz4 = 0
for (let i = 0; i < 24; i++) {
  const t=performance.now(), tile=chunkLightTile(route,route.chunk(i))
  chunks.push(performance.now()-t)
  const archive=packLightTile(tile); raw+=archive.rawSize; lz4+=archive.bytes.byteLength
}
for (let i=0; i<22; i++) {
  const x=BRIDGE_CHUNK_PX*i+310, msg=window.bake(i,x-570,x+2270,false)
  shifts.push(msg.bakeMs)
  const t=performance.now(); decodeWindow(msg); decodes.push(performance.now()-t)
}
const m=bakeBridgeDeckMask(), c=[0,0,0]
for(let i=2;i<m.length;i+=4)c[m[i]<52?0:m[i]<166?1:2]++
console.log(JSON.stringify({node:process.version,seed:42,units:'milliseconds',chunkBuildMs:perc(chunks),windowPackMs:perc(shifts),rawTransferViewMs:perc(decodes),
  chunkArchive:{raw,lz4,ratio:lz4/raw},drainageRatios:c.map(n=>n*4/m.length)}, null, 2))
