/** Verify replay parity and make a review board using only captured game
 * pixels. Usage: node .qa/slasher-water-report.mjs [capture-root] [dest] */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const [root = '.cache/water-relay', dest = 'research/water-relay'] = process.argv.slice(2)
const read = async (side, name) => JSON.parse(await readFile(join(root, side, `${name}.json`), 'utf8'))
const png = (side, name, layer) => join(root, side, `${name}-${layer}.png`)
const sides = ['before', 'after']
const profiles = ['desktop-forward', 'desktop-capture', 'portrait-capture']
const expectedLayout = cfg => [cfg.width, cfg.height, Math.floor(cfg.width * cfg.scale), Math.floor(cfg.height * cfg.scale),
  cfg.width, cfg.height, cfg.tier, cfg.route]
function parity(a, b, name) {
  assert.deepEqual(b.config, a.config, `${name}: invalid fixture`)
  assert.deepEqual(a.initial.layout, expectedLayout(a.config))
  assert.deepEqual(b.final.layout, a.final.layout, `${name}: backing changed`)
  assert.deepEqual(a.final.layout, a.initial.layout)
  assert.equal(a.softwareRequested, true)
  assert.equal(b.softwareRequested, true)
  assert.equal(a.initial.seed, 42)
  assert.equal(b.initial.seed, 42)
  assert.equal(b.browser, a.browser)
  assert.equal(b.tick, a.tick)
  assert.equal(b.eventDigest, a.eventDigest, `${name}: combat changed`)
  assert.deepEqual(b.final.weather, a.final.weather, `${name}: weather changed`)
  assert.ok(Math.abs(a.panWorldPx - b.panWorldPx) < 1e-6, `${name}: camera changed`)
  for (const r of [a, b]) assert.deepEqual(r.retainedAfterDestroy, [])
}
const receipt = {
  method: 'Fixed 60 Hz sim input clock; actual rAF callbacks in headless Chromium with GPU disabled. Not presented frames or a real-device FPS benchmark. Pacing trials separate from profiling and pixel captures.',
  base: await readFile(join(root, 'control', 'patch.sha256'), 'utf8').then(s => s.trim().split(/\s+/)[0]).catch(() => null),
  browser: '', pacing: {}, optics: {}, captures: {},
}
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const round = v => Number(v.toFixed(2))
const durations = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))
function run(r) {
  return { rafMs: durations(r.rafMs), submitMs: durations(r.submitMs), stallsOver250ms: r.visibleStalls250ms,
    bakeMs: round(r.bakeMs), ticks: r.tick, peakActors: r.maxBodies, eventDigest: r.eventDigest }
}
for (const kind of profiles) {
  const trials = []
  for (let trial = 1; trial <= 3; trial++) {
    const [a, b] = await Promise.all(sides.map(s => read(s, `${kind}-pacing-${trial}`)))
    parity(a, b, kind)
    assert.equal(a.config.scale, 2.25)
    assert.equal(a.config.tier, 'ultra')
    assert.ok(a.maxBodies >= 8 && b.maxBodies === a.maxBodies)
    assert.ok(!a.captureOnly && !b.captureOnly && !a.config.stages && !b.config.stages && !a.config.traceState && !b.config.traceState)
    assert.equal(a.sceneSamples, null)
    assert.equal(b.sceneSamples, null)
    trials.push({ order: trial % 2 === 0 ? 'after-before' : 'before-after', before: run(a), after: run(b) })
  }
  const [a, b] = await Promise.all(sides.map(s => read(s, `${kind}-profile`)))
  parity(a, b, kind)
  assert.equal(a.sceneSamples, a.config.route === 'forward' ? 0 : a.samples)
  assert.equal(b.sceneSamples, 0)
  const strip = b.surfaceShape.filter(s => s.startsWith('water-relay:'))
  assert.deepEqual(strip, [`water-relay:${Math.ceil(Math.hypot(b.config.width, b.config.height)) + 24}x52`])
  assert.equal(b.surfaceShape.some(s => s.startsWith('refl:')), false)
  assert.equal(b.phases['live water strip'].calls, b.samples)
  const pass = (r, key) => round((r.phases[key]?.submitMs ?? 0) / r.samples)
  const optics = r => ({ output: r.initial.layout.slice(2, 6), sceneTargetSamples: r.sceneSamples, frames: r.samples,
    postSamples: r.phases['post sample']?.calls ?? 0, strip: r.surfaceShape.filter(s => /^(water-relay|refl):/.test(s)),
    meanSubmitPerFrameMs: { 'mirror and moon glitter': pass(r, 'mirror (includes forward glints)'),
      'live water strip': pass(r, 'live water strip'), 'actor grounding': pass(r, 'actor grounding') },
    offscreenBytes: r.ledger.bytes, retainedAfterDestroy: r.retainedAfterDestroy.length })
  receipt.browser = b.browser
  receipt.optics[kind] = { before: optics(a), after: optics(b) }
  receipt.pacing[kind] = { viewport: [b.config.width, b.config.height], scale: b.config.scale,
    warmup: b.config.warmup, framesPerTrial: b.samples, trials,
    medianP95RafMs: sides.map(s => median(trials.map(t => t[s].rafMs.p95))),
    medianP99RafMs: sides.map(s => median(trials.map(t => t[s].rafMs.p99))),
    medianP95SubmitMs: sides.map(s => median(trials.map(t => t[s].submitMs.p95))),
    medianWarmSceneBuildMs: sides.map(s => median(trials.map(t => t[s].bakeMs))),
  }
}
for (const name of ['lamp', 'sign', 'fight', 'station']) {
  const [a, b] = await Promise.all(sides.map(s => read(s, name)))
  parity(a, b, name)
  assert.ok(a.stateDigest)
  assert.equal(a.stateDigest, b.stateDigest)
  assert.equal(b.pixelHashes.hud, a.pixelHashes.hud)
  const dry = name === 'station'
  if (dry) {
    assert.ok(b.final.weather === null && b.surfaceShape.every(s => !/^(water-relay|refl|night):/.test(s)))
    // A rasterizer can round subpixel clip boundaries by a channel value.
    // Check the actual pixel deltas instead of assuming a PNG hash match.
    if (a.pixelHashes.scene !== b.pixelHashes.scene) {
      const [left, right] = await Promise.all(sides.map(s => sharp(png(s, name, 'scene')).raw().toBuffer()))
      assert.equal(left.length, right.length)
      let max = 0, changed = 0
      for (let i = 0; i < left.length; i++) {
        const diff = Math.abs(left[i] - right[i]); max = Math.max(diff, max); changed += Number(diff > 0)
      }
      assert.ok(max <= 2 && changed < left.length * .002, `dry image changed: ${max}, ${changed}`)
      receipt.dryRasterRounding = { maxChannelDelta: max, changedChannels: changed }
    }
  } else assert.notEqual(a.pixelHashes.scene, b.pixelHashes.scene)
  receipt.captures[name] = { config: b.config, seed: b.initial.seed, layout: b.final.layout, weather: b.final.weather,
    stateDigest: b.stateDigest, eventDigest: b.eventDigest, hudHash: b.pixelHashes.hud,
    sceneHash: [a.pixelHashes.scene, b.pixelHashes.scene], cameraPanPx: round(b.panWorldPx), visibleFoes: b.visibleEnemies[0] }
}
await mkdir(dest, { recursive: true })
await writeFile(join(dest, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n')

const amber = '#ffd095', ice = '#a2bccb', white = '#f2f7fa'
const t = (x, y, s, size, color = ice, weight = 400, kern = 0) =>
  `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" letter-spacing="${kern}">${s}</text>`
const rule = (w, y) => `<path d="M32 ${y}H${w - 32}" stroke="#354959"/>`
const title = (w, line, sub) => `<path d="M32 30h60" stroke="${amber}" stroke-width="3"/>` +
  t(32, 60, 'STICKMAN RISING   /   WET BRIDGE', 17, amber, 700, 2) + t(30, 113, line, 46, white, 700) +
  t(32, 148, sub, 19) + rule(w, 171)
const column = (left, y, right) => t(left, y, 'BEFORE', 17, ice, 700, 2) + t(right, y, 'AFTER', 17, amber, 700, 2)
async function board(file, width, height, items, text) {
  const panel = await Promise.all(items.map(async p => {
    let image = sharp(png(p.side, p.name, 'scene'))
    if (p.crop) image = image.extract(p.crop)
    image = image.resize(p.w, p.h, { fit: 'fill' })
    let input = await image.png().toBuffer()
    if (p.hud) {
      const ui = await sharp(png(p.side, p.name, 'hud')).resize(p.w, p.h, { fit: 'fill' }).png().toBuffer()
      input = await sharp(input).composite([{ input: ui }]).png().toBuffer()
    }
    return { input, left: p.x, top: p.y }
  }))
  const borders = items.map(p => `<rect x="${p.x - .5}" y="${p.y - .5}" width="${p.w + 1}" height="${p.h + 1}" fill="none" stroke="#46616e"/>`).join('')
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="DejaVu Sans, sans-serif">${borders}${text}</svg>`
  await sharp({ create: { width, height, channels: 3, background: '#101923' } })
    .composite([...panel, { input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: 93, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(join(dest, file))
}
{
  const w = 1456, cols = [32, 744], items = sides.flatMap((side, i) => [
    { side, name: 'lamp', x: cols[i], y: 218, w: 680, h: 381 },
    { side, name: 'lamp', x: cols[i], y: 666, w: 680, h: 184, crop: { left: 246, top: 340, width: 470, height: 127 } },
    { side, name: 'sign', x: cols[i], y: 920, w: 680, h: 184, crop: { left: 347, top: 340, width: 470, height: 127 } },
  ])
  await board('before-after.jpg', w, 1159, items,
    title(w, 'Water on Wet Bridge', 'Same seed, drizzle, camera and game state. Low preset at 1× highlights baked detail.') +
    column(cols[0], 205, cols[1]) + rule(w, 623) +
    t(32, 650, '01   STREETLAMP  /  AMBER LENS AND POLE', 16, white, 700, 1.5) +
    rule(w, 877) + t(32, 905, '02   ROAD SIGN  /  INVERTED LETTERING, INTERRUPTED BY RIPPLES', 16, white, 700, 1.5) +
    t(32, 1139, 'Crops are enlarged from the captured game. Road paint and the fight lane remain above the reflective film.', 17))
}
{
  const cols = [32, 459], w = 879
  await board('absolute-ultra-portrait.jpg', w, 1101,
    sides.map((side, i) => ({ side, name: 'fight', x: cols[i], y: 219, w: 388, h: 840, hud: true })),
    title(w, 'Live water, full scene scale', 'Absolute Ultra · 390 × 844 CSS viewport · 877 × 1899 scene') +
    column(cols[0], 205, cols[1]) + t(32, 1085, 'Same pose, combat cues and HUD. The reflections use the current pose, not a prior frame.', 15))
}
console.log(`Verified captures, scene-sampling counts and pacing; results saved to ${dest}`)
