import { enableLightTileArchive } from './EnvBasis'
import { BridgeRoute } from '../../game/stage/route'
import { BridgeWindowBake } from './BridgeWindowBake'
import type { BakeReply, BakeRequest } from './BridgeBakeProtocol'

// Optical lane only: no Canvas/storage or image decoder on this worker.
const scope = self as unknown as { onmessage: ((e: MessageEvent<BakeRequest>) => void) | null;
  postMessage: (reply: BakeReply, transfers?: Transferable[]) => void }
let route: BridgeRoute | undefined, baker: BridgeWindowBake | undefined

scope.onmessage = ({ data: r }) => {
  const t = performance.now()
  try {
    if (route?.seed !== r.seed) { route = new BridgeRoute(r.seed); enableLightTileArchive(route); baker = new BridgeWindowBake(route) }
    if (r.type !== 'window') throw new Error('Unexpected optics request')
    const reply = baker!.bake(r.id, r.left, r.right, false)
    scope.postMessage(reply, [reply.blob.bytes.buffer])
  } catch (error) { scope.postMessage({ type: 'error', id: r.id, seed: r.seed, error: String(error), bakeMs: performance.now() - t }) }
}
