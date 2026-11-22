/** Verify matched visual captures and build the review boards from the actual
 * scene/HUD PNGs. No synthetic pixels other than labels and panel borders.
 * node .qa/slasher-optics-report.mjs .cache/optics-grade research/optics-grade
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const [root = '.cache/optics-grade', dest = 'research/optics-grade'] = process.argv.slice(2)
const labels = { before: 'CONTROL', v1: 'FIRST BAKE', v2: 'REVISION 1', final: 'REVISION 2 · FINAL' }
const stages = ['bridge-lamp', 'bridge-sign', 'station-sign', 'bridge-fight', 'station-fight',
  'bridge-ultra', 'station-ultra', 'bridge-forward', 'station-forward']
const receipt = { seed: 42, captureWarmup: 30, samples: 72, scenes: {} }
for (const name of stages) {
  const order = name.endsWith('forward') ? ['before', 'final'] : Object.keys(labels)
  const read = version => readFile(join(root, version, `${name}.json`), 'utf-8').then(JSON.parse)
  const control = await read('before')
  assert.equal(control.initial.seed, 42)
  assert.equal(control.config.scale, 1)
  receipt.browser = control.browser
  const scene = receipt.scenes[name] = { config: control.config, stateDigest: control.stateDigest, hudHash: control.pixelHashes.hud,
    visibleFoes: control.visibleEnemies[0], panWorldPx: control.panWorldPx, versions: {} }
  for (const version of order) {
    const sample = await read(version)
    assert.deepEqual(sample.config, control.config)
    assert.equal(sample.stateDigest, control.stateDigest, `${name}: simulation changed`)
    assert.equal(sample.pixelHashes.hud, control.pixelHashes.hud, `${name}: HUD changed`)
    assert.deepEqual(sample.final.weather, control.final.weather, `${name}: weather changed`)
    assert.ok(Math.abs(sample.panWorldPx - control.panWorldPx) < 1e-6, `${name}: camera path changed`)
    assert.deepEqual(sample.retainedAfterDestroy, [])
    const postSamples = sample.phases['post sample']?.calls ?? 0
    const postSurfaces = sample.surfaceShape.filter(s => s.startsWith('post:'))
    const expected = version === 'before' && name.endsWith('ultra') ? 72 : 0
    assert.equal(postSamples, expected, `${name}/${version}: post samples`)
    assert.equal(postSurfaces.length, expected ? 3 : 0)
    assert.ok(sample.surfaceShape.every(s => !s.startsWith('city-scratch:')))
    scene.versions[version] = { sceneHash: sample.pixelHashes.scene, postSamples, postSurfaces,
      retainedSurfaces: sample.ledger.surfaces, retainedBytes: sample.ledger.bytes, peakBytes: sample.ledger.peakBytes }
  }
  assert.notEqual(scene.versions.final.sceneHash, scene.versions.before.sceneHash, `${name}: expected new art`)
}
await mkdir(dest, { recursive: true })
await writeFile(join(dest, 'capture-receipts.json'), JSON.stringify(receipt, null, 2) + '\n')

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tx = (x, y, s, size = 20, color = '#cbd8df', weight = 500, spacing = 0) =>
  `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}">${escape(s)}</text>`
const amber = '#f1ba77'
const cap = (x, y, s, chosen = false) => tx(x, y, s, 17, chosen ? amber : '#99bbc5', 700, 2)
const rule = (w, y) => `<path d="M32 ${y}H${w - 32}" stroke="#34505c"/>`
const header = (w, kicker, name, sub) => `<path d="M32 28H81" stroke="${amber}" stroke-width="3"/>` +
  cap(32, 58, kicker, true) + tx(32, 115, name, 48, '#edf5f7', 700) + tx(34, 151, sub) + rule(w, 173)
const panel = (version, name, x, y, w, options = {}) => ({ version, name, x, y, w, ...options })
async function board(file, w, h, items, labels) {
  const plates = await Promise.all(items.map(async p => {
    const src = join(root, p.version, p.name)
    let image = sharp(`${src}-scene.png`)
    if (p.name.endsWith('fight')) image = sharp(await image.composite([{ input: `${src}-hud.png` }]).png().toBuffer())
    if (p.crop) image.extract(p.crop)
    const input = await image.resize(p.w).png().toBuffer()
    return { ...p, input, height: (await sharp(input).metadata()).height }
  }))
  const frames = plates.map(p => `<rect x="${p.x - .5}" y="${p.y - .5}" width="${p.w + 1}" height="${p.height + 1}" fill="none" stroke="#496271"/>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="DejaVu Sans,sans-serif">${frames.join('')}${labels}</svg>`
  await sharp({ create: { width: w, height: h, channels: 3, background: '#101b23' } }).composite([
    ...plates.map(({ input, x, y }) => ({ input, left: x, top: y })), { input: Buffer.from(svg), left: 0, top: 0 },
  ]).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(join(dest, file))
}

{
  const w = 1660, col = [32, 840], versions = ['before', 'final']
  const panels = ['bridge-lamp', 'station-sign'].flatMap((name, row) => versions.map((v, i) => panel(v, name, col[i], 227 + 510 * row, 788)))
  await board('before-after.jpg', w, 1244, panels,
    header(w, 'STICKMAN RISING   /   MATCHED STAGE CAPTURES', 'Baked glow, quieter backgrounds', 'Seed 42 · Low at 1× · Same camera, weather and input clock within each pair') +
    cap(col[0], 211, 'WET BRIDGE   /   CONTROL') + cap(col[1], 211, 'WET BRIDGE   /   FINAL', true) +
    tx(col[1], 701, 'Amber lamp against cooled steel, with wet sheen left on the asphalt.') +
    cap(col[0], 721, 'NIGHT STATION   /   CONTROL') + cap(col[1], 721, 'NIGHT STATION   /   FINAL', true) +
    tx(col[1], 1211, 'Stone arches, an ivory sign and a matte platform over the dark track wall.'))
}
{
  const w = 1518, col = [32, 398, 770, 1136]
  const conditions = [['before', 'bridge-fight'], ['final', 'bridge-fight'], ['before', 'station-fight'], ['final', 'station-fight']]
  await board('portrait-combat.jpg', w, 1027, conditions.map(([v, f], i) => panel(v, f, col[i], 225, 350)),
    header(w, 'STICKMAN RISING   /   PORTRAIT COMBAT', 'Same fight, different lighting', '390 × 844 CSS viewport · Low / 1× · Real HUD composited above the scene') +
    cap(col[0], 209, 'BRIDGE  /  CONTROL') + cap(col[1], 209, 'BRIDGE  /  FINAL', true) +
    cap(col[2], 209, 'STATION  /  CONTROL') + cap(col[3], 209, 'STATION  /  FINAL', true) +
    tx(32, 1009, 'Matched simulation and pixel-identical HUD within each pair. The moon is dimmer; enemy windups stay distinct.'))
}
{
  const w = 1796, cols = [32, 616, 1200], versions = ['v1', 'v2', 'final']
  const panels = versions.flatMap((v, i) => [
    panel(v, 'bridge-sign', cols[i], 228, 564),
    panel(v, 'station-sign', cols[i], 579, 564),
    panel(v, 'bridge-fight', cols[i], 930, 564, { crop: { left: 0, top: 0, width: 390, height: 160 } }),
  ])
  await board('iterations.jpg', w, 1250, panels,
    header(w, 'STICKMAN RISING   /   TWO REVISIONS', 'What changed after looking', 'Bridge sign and Station sign at Low / 1×, followed by the same portrait HUD crop') +
    versions.map((v, i) => cap(cols[i], 211, labels[v], v === 'final')).join('') +
    tx(cols[0], 562, 'Local halos, but warm tint over the whole skyline.', 18) +
    tx(cols[1], 562, 'Amber air confined to the horizon.', 18) +
    tx(cols[2], 562, 'Secondary violet spill dialed back.', 18) +
    tx(cols[0], 913, 'Cool base; the violet lamp pulls the eye.', 18) +
    tx(cols[1], 913, 'Deeper track wall; arch edges read as lines.', 18) +
    tx(cols[2], 913, 'Feathered stone edges and an ivory sign.', 18) +
    tx(cols[0], 1201, 'Moon and HUD still compete.', 18) +
    tx(cols[1], 1201, 'Cooler sky exposes the flare.', 18) +
    tx(cols[2], 1201, 'Moon toned down. HUD colors unchanged.', 18))
}
console.log(`Verified ${stages.length} matched shots; review boards saved to ${dest}`)
