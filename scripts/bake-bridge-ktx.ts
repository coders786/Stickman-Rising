/** Optional authoring comparison, not shipped. BASISU=/absolute/path/to/basisu npm run art:bridge-ktx.
 * The KTX2 source assets use Basis ETC1S for the soft far layer and UASTC for
 * the mid layer and tangent XY. Native transcodes are staged offline so a
 * browser never has to download a WASM encoder/decoder or transcode on a seam.
 * KTX1 is a small, standard wrapper for those final BC/ASTC/ETC block bytes. */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { bakeRippleTile } from '../src/gpu/bridge-textures'

async function run() {
  const root = resolve(process.argv[2] ?? '.cache/bridge-ktx'), work = await mkdtemp(join(tmpdir(), 'sr-basis-'))
  const tool = process.env.BASISU ? resolve(process.env.BASISU) : 'basisu'
  const transcodes = { bc7: 'BC7_RGBA', astc: 'ASTC_RGBA', etc2: 'ETC2_RGBA', bc5: 'BC5_RG' } as const
  const report: Record<string, number> = {}
  const put = async (key: string, data: Uint8Array) => { await writeFile(join(root, key), data); report[key] = data.length }
  try {
    await mkdir(root, { recursive: true })
    const basis = (args: string[]) => execFileSync(tool, args, { cwd: work, stdio: 'pipe', timeout: 120_000 })
    for (const name of ['l1', 'l2', 'ripple'] as const) {
      const normal = name === 'ripple', uastc = name !== 'l1', png = join(work, `${name}.png`)
      if (!normal) await sharp(`public/bridge/${name}.webp`).flip().ensureAlpha().png().toFile(png)
      else {
        const rg = bakeRippleTile(), rgb = new Uint8Array(64 * 64 * 3)
        for (let i = 0; i < rg.length / 2; i++) { rgb[i * 3] = rg[i * 2]; rgb[i * 3 + 1] = rg[i * 2 + 1]; rgb[i * 3 + 2] = 127 }
        await sharp(rgb, { raw: { width: 64, height: 64, channels: 3 } }).png().toFile(png)
      }
      basis(['-ktx2', '-ktx2_no_zstandard', '-mipmap', '-no_multithreading', '-file', `${name}.png`,
        ...(uastc ? ['-uastc', '-uastc_level', '2'] : ['-q', '240']),
        ...(normal ? ['-normal_map', '-separate_rg_to_color_alpha'] : [])])
      basis(['-unpack', '-ktx_only', '-file', `${name}.ktx2`])
      await put(`${name}.ktx2`, await readFile(join(work, `${name}.ktx2`)))
      const out = name === 'ripple' ? ['bc5', 'astc'] as const : name === 'l1' ? ['etc2', 'bc7'] as const : ['astc', 'etc2', 'bc7'] as const
      for (const f of out) await put(`${name}-${f}.ktx`, await readFile(join(work, `${name}_transcoded_${transcodes[f]}_0000.ktx`)))
    }
    await writeFile(join(root, 'sizes.json'), JSON.stringify(report, null, 2) + '\n')
    console.table(report)
  } finally { await rm(work, { recursive: true, force: true }) }
}
void run().catch(err => { console.error(err); process.exitCode = 1 })
