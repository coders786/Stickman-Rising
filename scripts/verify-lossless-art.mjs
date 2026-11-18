/** Try lossless WebP without touching sources. Keep it only when sRGB RGBA
 * round-trips byte-for-byte (including alpha) and the result is smaller.
 * Usage: node scripts/verify-lossless-art.mjs <output-dir> <image> [...] */
import sharp from 'sharp'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { createHash } from 'node:crypto'

const [out, ...paths] = process.argv.slice(2)
if (!out || !paths.length) throw new Error('Expected a destination and at least one image')
await mkdir(out, { recursive: true })
const sha = data => createHash('sha256').update(data).digest('hex')
const rgba = image => sharp(image).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const report = []
const stored = new Map()
for (const path of paths) {
  const original = await readFile(path)
  const meta = await sharp(original).metadata()
  if ((meta.pages ?? 1) !== 1) throw new Error(`Still images only: ${path}`)
  const before = await rgba(original)
  const converted = await sharp(original).toColourspace('srgb').webp({ lossless: true, effort: 6 }).toBuffer()
  const after = await rgba(converted)
  const exact = before.info.width === after.info.width && before.info.height === after.info.height && before.data.equals(after.data)
  // Retain the original if format metadata (orientation, ICC) could affect presentation.
  const replace = exact && converted.length < original.length && !meta.icc && !meta.orientation
  const bytes = replace ? converted : original
  const hash = sha(bytes)
  const asset = stored.get(hash) ?? `${basename(path, extname(path))}-${hash.slice(0, 12)}${replace ? '.webp' : extname(path)}`
  if (!stored.has(hash)) await writeFile(join(out, asset), bytes)
  stored.set(hash, asset)
  report.push({ source: path, asset, originalBytes: original.length, encodedBytes: bytes.length, decodedRgbaBytes: before.data.length,
    width: before.info.width, height: before.info.height, candidateExact: exact, replaced: replace, sha256: hash })
}
await writeFile(join(out, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`)
console.table(report.map(({ source, originalBytes, encodedBytes, decodedRgbaBytes, replaced }) => ({ source, originalBytes, encodedBytes, decodedRgbaBytes, replaced })))
