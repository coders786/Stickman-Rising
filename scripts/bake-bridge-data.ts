/** Authoring/inspection output only. Runtime generates these same small data
 * tiles; it does not request lossy/compressed image props at each road seam. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
import sharp from 'sharp'
import { bakeBridgeDeckMask, bakeBridgeLutStrip, bakeBridgeMaterialTiles, DECK_MASK_H, MATERIAL_COUNT, MATERIAL_TILE, PUDDLE_PITCH } from '../src/game/stage/bridge-material'

const folder = process.argv[2] ?? 'out/bridge-data'
async function main() {
  await mkdir(folder, { recursive: true })
  const manifest: { name: string; width: number; height: number; bytes: number; brotliBytes: number }[] = []
  async function write(name: string, data: Uint8Array, width: number, height: number): Promise<void> {
    const packed = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
    await Promise.all([
      writeFile(join(folder, `${name}.rgba.br`), packed),
      sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(folder, `${name}.png`)),
    ])
    manifest.push({ name, width, height, bytes: data.byteLength, brotliBytes: packed.byteLength })
  }
  await write('normal-rough-ao', bakeBridgeMaterialTiles(), MATERIAL_TILE, MATERIAL_TILE * MATERIAL_COUNT)
  await write('deck-receiver', bakeBridgeDeckMask(), PUDDLE_PITCH, DECK_MASK_H)
  for (const n of [16, 32] as const) for (const look of [0, 1, 2, 3] as const) {
    await write(`look-${n}-${['transit', 'market', 'industrial', 'boss'][look]}`, bakeBridgeLutStrip(n, look), n * n, n)
  }
  await writeFile(join(folder, 'manifest.json'), JSON.stringify({ channelPacking: 'Normal tile RG=normal XY/B=roughness/A=AO; deck RGBA=AO/roughness/puddle/emissive. LUTs are lossless RGBA.', assets: manifest }, null, 2) + '\n')
  console.log(`Wrote ${manifest.length} data sheets to ${folder}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
