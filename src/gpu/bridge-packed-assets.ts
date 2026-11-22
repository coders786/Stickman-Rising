import { BAKED_ROOT, DECK_PACK, gradePack } from '../graphics/bridge/BridgeAssetCodec'

const pending = new Map<string, Uint8Array<ArrayBuffer> | null>()
const unavailable = new Set<string>()
const transfers = new Map<string, AbortController>()
export function packedBytes(name: string): Uint8Array<ArrayBuffer> | null {
  if (typeof window === 'undefined') return null
  if (!pending.has(name)) {
    pending.set(name, null)
    const transfer = new AbortController()
    transfers.set(name, transfer)
    void fetch(`${BAKED_ROOT}${name}`, { signal: transfer.signal }).then(r => {
      if (!r.ok) throw new Error(`Bridge asset HTTP ${r.status}`)
      return r.arrayBuffer()
    }).then(buffer => {
      if (transfers.get(name) !== transfer) return
      pending.set(name, new Uint8Array(buffer)); transfers.delete(name)
    }, () => {
      if (transfers.get(name) !== transfer) return
      unavailable.add(name); transfers.delete(name)
    })
  }
  return pending.get(name) ?? null
}

export function discardPendingPackedBridge(): void {
  for (const [name, transfer] of transfers) { pending.delete(name); transfer.abort() }
  transfers.clear()
}
/** A pending transfer is not a denial. Select the local equivalent only
 * after failure (or when the resolved payload fails its layout check). */
export function packedSettled(name: string): boolean {
  return typeof window === 'undefined' || !!packedBytes(name) || unavailable.has(name)
}
export const warmPackedBridge = (master: boolean) => { packedBytes(DECK_PACK); packedBytes(gradePack(master ? 32 : 16)) }
