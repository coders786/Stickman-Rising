/** Assert the release packs against the pre-conditioning production bytes.
 * Usage: node --import tsx .qa/slasher-pack-parity.mts <control public/bridge>
 * Also checks the deck/volume layout via the production restore functions. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { unpackBridgePlanes } from '../src/graphics/bridge/BridgeAssetCodec'
import { SKY_PACK_LAYOUT, SKY_PACK_TAG } from '../src/graphics/bridge/SkyBasis'
import { bakeBridgeDeckMask, unpackBridgeLut } from '../src/game/stage/bridge-material'
import { DECK_PACK_LAYOUT, DECK_PACK_TAG, gradePackLayout, gradePackTag } from '../src/game/stage/bridge-packed-material'

const old = process.argv[2]
assert.ok(old, 'Pass the prior production public/bridge path')
const release = 'public/bridge/baked-v1'
const decode = (dir: string, file: string) => brotliDecompressSync(readFileSync(join(dir, file)))
const same = (label: string, actual: Uint8Array, expected: Uint8Array) => {
  assert.ok(Buffer.from(actual).equals(expected), `${label} did not restore the exact signal`)
  return { bytes: expected.byteLength, sha256: createHash('sha256').update(actual).digest('hex') }
}
const sky = same('sky', unpackBridgePlanes(decode(release, 'sky.bin.br'), SKY_PACK_LAYOUT, SKY_PACK_TAG), decode(old, 'sky-basis-v5.rgba.br'))
const deck = same('deck', bakeBridgeDeckMask(unpackBridgePlanes(decode(release, 'deck.bin.br'), DECK_PACK_LAYOUT, DECK_PACK_TAG)), decode(old, 'packed-v4/deck.rgba.br'))
const grades = [16, 32].map(n => {
  assert.ok(n === 16 || n === 32)
  const slab = n ** 3 * 4, raw = decode(old, `packed-v4/lut-${n}.rgba.br`)
  const expected = Buffer.concat([0, 1, 2, 3].map(i => unpackBridgeLut(raw.subarray(i * slab, (i + 1) * slab), n)))
  return same(`grade ${n}`, unpackBridgePlanes(decode(release, `look-${n}.bin.br`), gradePackLayout(n), gradePackTag(n)), expected)
})
console.log(JSON.stringify({ sky, deck, grades }, null, 2))
