import { BridgeRoute } from '../../game/stage/route'
import { paintNoirShelter } from '../../game/stage/noir-shelter'
import { paintChunk, chunkPlateTop, PLATE_BOTTOM } from '../../game/stage/bridge-plate-paint'
import { bakeCanvasChunkLighting } from '../../game/stage/bridge-canvas-light'
import { SHELTER_KIT } from '../../game/stage/run-layout'
import { ROAD } from '../../game/stage/road-section'
import type { BakeReply, BakeRequest } from './BridgeBakeProtocol'

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BakeRequest>) => void) | null;
  postMessage: (reply: BakeReply, transfers?: Transferable[]) => void
}
let route: BridgeRoute | undefined
const shelters = new Map<keyof typeof SHELTER_KIT, { sprite: OffscreenCanvas; y: number }>()

// The GPU needs only albedo. Canvas needs only its baked radiance plate.
// Shade in place and transfer one backing store; neither mode waits for
// the other renderer's pixels or recomputes the GPU window on this lane.
scope.onmessage = ({ data: r }) => {
  const t = performance.now()
  let bitmap: ImageBitmap | undefined
  try {
    if (r.type !== 'plate') throw new Error('Unexpected raster request')
    if (typeof OffscreenCanvas !== 'function') throw new Error('Worker OffscreenCanvas unavailable')
    if (route?.seed !== r.seed) route = new BridgeRoute(r.seed)
    const c = route.chunk(r.index), top = chunkPlateTop(c)
    const art = new OffscreenCanvas(c.right - c.left, PLATE_BOTTOM - top)
    // Keep the painter and its source stamp on the same raster backend.
    // A GPU shelf drawn into a CPU lighting plate forces a synchronous GPU
    // readback before the worker can even run its local pixel loop.
    const g = art.getContext('2d', { willReadFrequently: true })
    if (!g) throw new Error('Worker scenery context unavailable')
    let stamp
    if (c.shelter) {
      const kind = c.shelter.kind
      stamp = shelters.get(kind)
      if (!stamp) {
        const { width, ridgeY } = SHELTER_KIT[kind], y = ridgeY - 12
        const sprite = new OffscreenCanvas(width, ROAD.front - y)
        paintNoirShelter(sprite.getContext('2d', { willReadFrequently: true })!, kind, y)
        stamp = { sprite, y }; shelters.set(kind, stamp)
      }
    }
    g.translate(0, -top); paintChunk(g, c, stamp)
    if (r.lit) bakeCanvasChunkLighting(g, route, c, top)
    bitmap = art.transferToImageBitmap()
    scope.postMessage({ type: 'plate', id: r.id, seed: r.seed, index: r.index, lit: r.lit, bitmap, bakeMs: performance.now() - t }, [bitmap])
  } catch (error) {
    bitmap?.close()
    scope.postMessage({ type: 'error', id: r.id, seed: r.seed, error: String(error), bakeMs: performance.now() - t })
  }
}
