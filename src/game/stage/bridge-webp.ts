import { GLASS_ATLAS_H, GLASS_ENV_W, GLASS_PLATE } from '../../graphics/bridge/ShopGlassOptics'

/** Pre-baked route art. The procedural plates stay available if fetch/decode
 * fails. Track settlement separately from success for the opening gate. */
type Plate = 'stratum-a' | 'l1' | 'l2' | 'metro-street' | 'deck-pier' | 'props-v2' | typeof GLASS_PLATE
type Art = { image: HTMLImageElement; state: 'pending' | 'ready' | 'failed' }
const images: Partial<Record<Plate, Art>> = {}
const opening: readonly Plate[] = ['l1', 'l2', 'metro-street', 'deck-pier', 'props-v2', GLASS_PLATE]

function getPlate(name: Plate): Art | undefined {
  if (typeof Image === 'undefined') return
  let art = images[name]
  if (!art) {
    const image = new Image(), canDecode = typeof image.decode === 'function'
    const entry: Art = art = images[name] = { image, state: 'pending' }
    const ready = () => {
      const valid = name === GLASS_PLATE ? image.naturalWidth === GLASS_ENV_W && image.naturalHeight === GLASS_ATLAS_H : image.naturalWidth > 0
      entry.state = valid ? 'ready' : 'failed'
    }
    const failed = () => { entry.state = 'failed' }
    image.decoding = 'async'
    if (!canDecode) {
      image.addEventListener('load', ready, { once: true })
      image.addEventListener('error', failed, { once: true })
    }
    image.src = `/bridge/${name}.webp`
    // `complete` only says the bytes arrived. Don't force the first decode
    // synchronously on the first world submit.
    if (canDecode) void image.decode().then(ready, failed)
  }
  return art
}

export function bridgePlate(name: Plate): HTMLImageElement | null {
  const art = getPlate(name)
  return art?.state === 'ready' ? art.image : null
}

export function bridgeOpeningPlatesSettled(): boolean {
  let done = true
  for (const name of opening) if (getPlate(name)?.state === 'pending') done = false
  return done
}

export function bridgeCityPlatesSettled(): boolean {
  const far = getPlate('l1'), mid = getPlate('l2')
  return far?.state !== 'pending' && mid?.state !== 'pending'
}

/** A timed-out retry starts a new transfer, but keeps already admitted art. */
export function discardPendingBridgePlates(): void {
  for (const name of opening) {
    const art = images[name]
    if (art?.state !== 'pending') continue
    delete images[name]
    art.image.removeAttribute('src')
  }
}
