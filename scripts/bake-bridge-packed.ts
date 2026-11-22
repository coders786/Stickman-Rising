/** Release data only. Lossless Brotli of drainage and the four grade volumes;
 * no GPU transcode tool or browser required. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
import { BAKED_ROOT, DECK_PACK, gradePack, packBridgePlanes, type PlaneLayout } from '../src/graphics/bridge/BridgeAssetCodec'
import { bakeBridgeDeckMask, bakeBridgeLutStrip, unpackBridgeLut, type LookIndex } from '../src/game/stage/bridge-material'
import { DECK_PACK_LAYOUT, DECK_PACK_TAG, gradePackLayout, gradePackTag } from '../src/game/stage/bridge-packed-material'

async function main() {
  const dir = process.argv[2] ?? `public${BAKED_ROOT}`
  await mkdir(dir, { recursive: true })
  const put = async (file: string, pixels: Uint8Array, layout: PlaneLayout, tag: string) => {
    const bytes = brotliCompressSync(packBridgePlanes(pixels, layout, tag), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
    await writeFile(join(dir, file), bytes)
    console.log(`${file}: ${bytes.length} on wire / ${pixels.length} signal bytes`)
  }
  const mask = bakeBridgeDeckMask(), pool = new Uint8Array(mask.length >>> 2)
  for (let i = 0; i < pool.length; i++) pool[i] = mask[i * 4 + 2]
  await put(DECK_PACK, pool, DECK_PACK_LAYOUT, DECK_PACK_TAG)
  for (const n of [16, 32] as const) {
    const volume = Buffer.concat(([0, 1, 2, 3] as LookIndex[]).map(i => unpackBridgeLut(bakeBridgeLutStrip(n, i), n)))
    await put(gradePack(n), volume, gradePackLayout(n), gradePackTag(n))
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
