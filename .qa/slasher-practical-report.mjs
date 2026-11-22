/** Validate the matched receipts and publish compact play-scale stills. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const root = process.argv[2] ?? '.cache/practical-optics/final'
const dest = process.argv[3] ?? 'research/practical-optics'
const sides = ['before', 'after']
const load = (side, name) => readFile(join(root, side, `${name}.json`), 'utf8').then(JSON.parse)
const match = async name => {
  const [a, b] = await Promise.all(sides.map(side => load(side, name)))
  assert.equal(a.browser, b.browser, name)
  assert.equal(a.softwareRequested, b.softwareRequested, name)
  assert.deepEqual(a.config, b.config, name)
  for (const key of ['tick', 'maxBodies', 'attackFrames', 'echoFrames', 'eventDigest', 'stateDigest', 'player', 'score', 'simTime', 'droppedSimSeconds', 'samples', 'outputRgbaBytes']) {
    assert.deepEqual(a[key], b[key], `${name}: ${key}`)
  }
  assert.ok(Math.abs(a.panWorldPx - b.panWorldPx) < 1e-6, `${name}: pan`)
  for (const key of Object.keys(a.view)) assert.ok(Math.abs(a.view[key] - b.view[key]) < 1e-6, `${name}: camera ${key}`)
  // Plate source and weather must agree. Optional decorative glitter was
  // removed; its sprite count and volatile bake measurements can differ.
  const comparable = ({ bakes, ...state }) => ({ ...state, plates: bakes && [bakes.moonSource, bakes.starSource] })
  for (const key of ['initial', 'final']) assert.deepEqual(comparable(a[key]), comparable(b[key]), `${name}: ${key}`)
  for (const row of [a, b]) assert.deepEqual(row.retainedAfterDestroy, [], name)
  return [a, b]
}
const round = n => Number(n.toFixed(2))
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]
const timing = runs => Object.fromEntries(['rafMs', 'submitMs'].map(key => [key, Object.fromEntries(
  ['p50', 'p95', 'p99', 'max'].map(p => [p, round(median(runs.map(row => row[key][p])))])
)]))
const replays = {}
let browser, softwareRequested
for (const fixture of ['high', 'bridge', 'portrait', 'station']) {
  const pairs = await Promise.all([1, 2, 3].map(i => match(`${fixture}-pacing-${i}`)))
  const profiles = await match(`${fixture}-profile`)
  const { config, initial, tick, maxBodies } = profiles[1]
  browser = profiles[1].browser
  softwareRequested = profiles[1].softwareRequested
  assert.ok(pairs.flat().every(row => !row.config.stages && !row.captureOnly && !row.config.traceState))
  assert.ok(profiles.every(row => row.sceneSamples === 0 && row.config.stages && !row.captureOnly))
  const [before, after] = profiles
  assert.equal(before.optics.vignette, config.frames)
  assert.ok(before.optics.scatter > 0 && before.optics.shafts > 0 && after.optics.bodies > 0)
  if (config.wet) assert.ok(before.optics.actorStrip === config.frames && before.optics.propStrip > 0 && before.optics.wetGlints > 0)
  assert.ok(Object.entries(after.optics).every(([name, count]) => name === 'bodies' || count === 0))
  assert.deepEqual(before.shadowDraws, after.shadowDraws, `${fixture}: shadow workload`)
  assert.ok(after.surfaceShape.every(s => !/^(refl|water-relay|vignette|practical-work|post|night:256x64):?/.test(s)))
  replays[fixture] = {
    layout: initial.layout, seed: config.seed, wet: config.wet, scale: config.scale, tier: config.tier,
    warmup: config.warmup, samples: config.frames, tick, maxBodies,
    ...Object.fromEntries(sides.map((side, i) => {
      const runs = pairs.map(p => p[i]), p = profiles[i]
      return [side, {
        ...timing(runs), trials: runs.map(r => ({ rafMs: r.rafMs, submitMs: r.submitMs, stalls250ms: r.visibleStalls250ms })),
        submits: Object.fromEntries(Object.entries(p.phases).map(([name, row]) => [name, { calls: row.calls, meanMs: round(row.submitMs / p.samples) }])),
        optics: p.optics, shadows: p.shadowDraws, sceneSamples: p.sceneSamples, surfaces: p.ledger.surfaces, bytes: p.ledger.bytes,
        outputBytes: p.outputRgbaBytes, retiredAll: p.retainedAfterDestroy.length === 0,
      }]
    })),
  }
}

const shots = {}
for (const name of ['lamp', 'sign', 'fight', 'portrait', 'station']) {
  const [a, b] = await match(name)
  assert.ok(a.captureOnly && b.captureOnly && a.config.traceState && a.stateDigest)
  assert.equal(a.pixelHashes.hud, b.pixelHashes.hud, `${name}: the HUD hasn't changed`)
  assert.notEqual(a.pixelHashes.scene, b.pixelHashes.scene, `${name}: no optical art changed`)
  shots[name] = { layout: b.final.layout, view: b.view, player: b.player, weather: b.final.weather,
    eventDigest: b.eventDigest, stateDigest: b.stateDigest, hudSha256: b.pixelHashes.hud }
}
await mkdir(dest, { recursive: true })
await writeFile(join(dest, 'verification.json'), JSON.stringify({ browser, softwareRequested,
  timing: 'Medians of three alternating before/after rAF runs per side; fixed sim, no canvas hooks or captures. Not presented FPS.',
  replays, shots,
}, null, 2) + '\n')

const playFrame = async (side, name, width, height) => {
  const prefix = join(root, side, name)
  const scene = await sharp(`${prefix}-scene.png`).resize(width, height).png().toBuffer()
  const hud = await sharp(`${prefix}-hud.png`).resize(width, height).png().toBuffer()
  return sharp(scene).composite([{ input: hud }]).toBuffer()
}
const label = (x, y, title, size = 16, color = '#a9bcc8', weight = 400) =>
  `<text x="${x}" y="${y}" font-family="monospace" font-size="${size}" fill="${color}" font-weight="${weight}">${title}</text>`
async function board(file, title, subtitle, rows, width) {
  const gap = 18, pad = 28, W = width * 2 + gap + pad * 2
  const H = 150 + rows.reduce((h, [,, sceneH]) => h + sceneH + 55, 0)
  let text = label(pad, 30, 'STICKMAN RISING   /   RENDER STUDY', 13, '#e4af76', 700) + label(pad, 66, title, 31, '#edf3f5', 700) +
    label(pad, 96, subtitle, 14, '#97aabb') + label(pad, 128, '01   BEFORE', 16, '#b2c4cb', 700) +
    label(pad + width + gap, 128, '02   AFTER', 16, '#ffd293', 700)
  const columns = []
  let y = 150
  for (const [name, caption, sceneH] of rows) {
    for (const [i, side] of sides.entries()) {
      columns.push({ input: await playFrame(side, name, width, sceneH), top: y, left: pad + i * (width + gap) })
    }
    text += label(pad, y + sceneH + 27, caption, 14, '#c1ced7')
    y += sceneH + 55
  }
  const heading = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#101821"/><path d="M${pad} 107 H${W - pad}" stroke="#354754"/>${text}</svg>`)
  await sharp(heading).composite(columns).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(join(dest, file))
}
await board('before-after.jpg', 'Practical light, not live mirrors', 'Matched camera, rain, HUD and render scale. No added screen blur.', [
  ['lamp', '01   Wet Bridge / streetlamp and road finish / 2.25×', 420],
  ['fight', '02   Wet Bridge / same crowd frame / 2.25×', 420],
  ['sign', '03   Wet Bridge / warning sign and guide lights / Low at 1×', 420],
], 741)
await board('portrait.jpg', 'Absolute Ultra in portrait', 'Same encounter at 390×844 CSS / 2.25× scene backing.', [
  ['portrait', 'Wet Bridge / portrait replay', 844],
], 390)
await board('station.jpg', 'Dry platform, warm practicals', 'Same scene backing, no rain or wet material on either side.', [
  ['station', 'Night Station / dry control / 2.25×', 420],
], 741)
