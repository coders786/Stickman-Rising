// Validate matched receipts, then make the comparison board from real game pixels.
// node .qa/slasher-shadow-report.mjs [replay output dir] [report output dir]
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const root = process.argv[2] || '.cache/shadow-footprint/final'
const dest = process.argv[3] || 'research/shadow-footprint'
const fixtures = ['low', 'medium', 'high', 'ultra', 'absolute', 'portrait', 'station']
const load = async (side, name) => JSON.parse(await readFile(join(root, side, `${name}.json`), 'utf8'))
const round = value => Math.round(value * 100) / 100
const near = (a, b) => Math.abs(a - b) < 1e-6
const receipt = ({ bakes, ...state }) => ({ ...state, bakes: bakes && [bakes.moonSource, bakes.starSource, bakes.sprites] })
async function pair(name) {
  const rows = await Promise.all(['before', 'after'].map(side => load(side, name)))
  const [b, a] = rows
  assert.deepEqual(b.config, a.config, name)
  assert.ok(a.config.fixed && b.softwareRequested && a.softwareRequested, name)
  assert.equal(b.browser, a.browser, name)
  for (const key of ['eventDigest', 'stateDigest', 'clock', 'tick', 'samples', 'outputRgbaBytes', 'maxBodies', 'attackFrames', 'echoFrames']) {
    assert.equal(b[key], a[key], `${name}: ${key}`)
  }
  for (const key of ['visibleEnemies', 'player', 'score']) assert.deepEqual(b[key], a[key], `${name}: ${key}`)
  for (const key of ['initial', 'final']) assert.deepEqual(receipt(b[key]), receipt(a[key]), `${name}: ${key}`)
  assert.ok(near(b.panWorldPx, a.panWorldPx) && Object.keys(a.view).every(k => near(b.view[k], a.view[k])), `${name}: camera changed`)
  for (const row of rows) {
    assert.deepEqual(row.retainedAfterDestroy, [], `${name}: leaked backing`)
    assert.equal(row.droppedSimSeconds, 0, `${name}: dropped sim time`)
  }
  return rows
}
const proof = { methodology: 'Fixed 60 Hz replay input/sim, observed Chromium rAF and submit intervals with GPU disabled. Timing is not hardware or presented FPS. Three paired runs; reverse order in the middle. Profile hooks and PNG captures are separate.', profiles: {}, pacing: {}, stills: {} }

function count(row) {
  const { actors, props } = row.shadowDraws
  const sum = Object.fromEntries(Object.keys(actors.hero).map(k => [k, actors.hero[k] + actors.enemies[k]]))
  const actorPaints = sum.contact + sum.key + sum.practical + sum.graded
  return { samples: row.samples, byActor: actors, propBlits: props.blits,
    perFrame: { actorPaints: round(actorPaints / row.samples), castPaints: round((actorPaints - sum.contact) / row.samples), propBlits: round(props.blits / row.samples) },
    groundingSubmitMsPerFrame: round(row.phases['actor grounding'].submitMs / row.samples),
    sceneReads: row.sceneSamples, waterRelay: row.surfaceShape.filter(s => s.startsWith('water-relay:')),
    trackedBytes: row.ledger.liveBytes ?? row.ledger.createdBytes,
  }
}
const stats = row => ({ rafMs: Object.fromEntries(Object.entries(row.rafMs).map(([k, v]) => [k, round(v)])),
  submitMs: Object.fromEntries(Object.entries(row.submitMs).map(([k, v]) => [k, round(v)])), stalls250ms: row.visibleStalls250ms })
function median(rows) {
  const middle = key => Object.fromEntries(Object.keys(rows[0][key]).map(k => [k, rows.map(r => r[key][k]).sort((a, b) => a - b)[1]]))
  return { rafMs: middle('rafMs'), submitMs: middle('submitMs') }
}
for (const name of fixtures) {
  const rows = await pair(`${name}-profile`)
  const [b, a] = rows
  assert.ok(a.stateDigest && a.config.stages && a.config.shadowMetrics, name)
  const cast = a.config.tier === 'high' || a.config.tier === 'ultra'
  const props = a.config.tier === 'ultra'
  for (const type of ['hero', 'enemies']) {
    const old = b.shadowDraws.actors[type], now = a.shadowDraws.actors[type]
    assert.equal(old.calls, now.calls, `${name}: actor selection`)
    assert.equal(old.outlines, now.outlines, `${name}: outline reuse changed`)
    assert.equal(old.inPractical, now.inPractical, `${name}: light probe changed`)
    assert.ok(now.contact > 0 && now.contact <= now.calls * 2, `${name}: contact budget`)
    assert.equal(now.key + now.practical, 0, `${name}: stacked casts survived`)
    if (cast) assert.ok(now.graded > 0 && now.graded <= now.calls, `${name}: cast budget`)
    else assert.equal(now.graded, 0, `${name}: Low/Medium paid for casts`)
  }
  if (props) {
    assert.ok(a.shadowDraws.props.blits > 0, `${name}: prop caster wasn't sampled`)
    // The silhouette's coverage can grow past the prop origin at an edge, so
    // compare the pair rather than assuming both culled exactly the same roots.
    assert.ok(a.shadowDraws.props.blits < b.shadowDraws.props.blits, `${name}: prop blits not reduced`)
  } else assert.equal(a.shadowDraws.props.blits, 0)
  const profile = rows.map(count)
  assert.ok(profile.every(r => r.sceneReads === 0), `${name}: scene snapshots`)
  assert.deepEqual(profile[0].waterRelay, profile[1].waterRelay, `${name}: relay allocation`)
  assert.equal(profile[1].waterRelay.length, name === 'low' || name === 'station' ? 0 : 1)
  assert.ok(profile[1].perFrame.actorPaints < profile[0].perFrame.actorPaints)
  proof.profiles[name] = { config: a.config, layout: a.initial.layout, stateDigest: a.stateDigest, eventDigest: a.eventDigest, before: profile[0], after: profile[1] }
  proof.browser = a.browser
  const before = [], after = []
  for (const run of [1, 2, 3]) {
    const [old, now] = await pair(`${name}-pacing-${run}`)
    assert.ok(now.config.fixture === 'crowd' && now.samples === 90 && now.config.warmup === 36)
    assert.ok(!now.config.stages && !now.config.traceState && !now.config.shadowMetrics && !now.config.shadowRaster && !now.pixelHashes)
    assert.equal(now.sceneSamples, null)
    assert.equal(now.eventDigest, a.eventDigest)
    before.push(stats(old)); after.push(stats(now))
  }
  proof.pacing[name] = { before, after, medianBefore: median(before), medianAfter: median(after) }
}

proof.isolatedRaster = { methodology: 'One frozen 2.25× dry Station crowd frame. Repeat only the shadow painters into a shallow CPU canvas, including backdrop clear and a one-pixel flush on that test canvas, not the game scene. Medians of three paired runs.', before: [], after: [] }
for (const run of [1, 2, 3]) {
  const [b, a] = await pair(`station-raster-${run}`)
  for (const [side, row] of [['before', b], ['after', a]]) {
    assert.ok(row.config.shadowRaster && row.config.scale === 2.25 && row.config.scene === 'station')
    const r = row.shadowRaster
    assert.deepEqual(r.backdrop, b.shadowRaster.backdrop)
    assert.equal(r.frozenCalls, row.visibleEnemies[0] + 2)
    assert.equal(r.batch, 24)
    assert.equal(r.laps, 36)
    proof.isolatedRaster[side].push({ ...r, elapsedMsPerDraw: Object.fromEntries(Object.entries(r.elapsedMsPerDraw).map(([k, v]) => [k, round(v)])) })
  }
}
const frames = Object.fromEntries(fixtures.map(name => [`${name}-lamp`, null]))
frames['absolute-fight'] = null
frames['absolute-jump'] = null
for (const name of Object.keys(frames)) {
  const [b, a] = await pair(name)
  assert.ok(a.stateDigest)
  assert.equal(b.pixelHashes.hud, a.pixelHashes.hud, `${name}: HUD bytes changed`)
  assert.notEqual(b.pixelHashes.scene, a.pixelHashes.scene, `${name}: grounding invisible`)
  assert.equal(b.pixelHashes.relay, a.pixelHashes.relay, `${name}: virtual image changed`)
  if (name === 'low-lamp' || name === 'station-lamp') assert.equal(a.pixelHashes.relay, undefined)
  else assert.ok(a.pixelHashes.relay)
  if (name === 'absolute-jump') assert.ok(a.player.y < -20, 'jump proof not airborne')
  frames[name] = a
  proof.stills[name] = { config: a.config, view: a.view, player: a.player, stateDigest: a.stateDigest,
    eventDigest: a.eventDigest, hudHash: a.pixelHashes.hud, relayHash: a.pixelHashes.relay ?? null,
    sceneHash: [b.pixelHashes.scene, a.pixelHashes.scene] }
}

await mkdir(dest, { recursive: true })
await writeFile(join(dest, 'verification.json'), JSON.stringify(proof, null, 2) + '\n')
const WIDTH = 1440, PAD = 28, GAP = 12, PW = (WIDTH - 2 * PAD - GAP) / 2
const svgText = (x, y, text, size = 19, fill = '#d1ebf5', bold = true) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="DejaVu Sans, sans-serif" font-weight="${bold ? 700 : 400}" font-size="${size}">${text}</text>`
const panes = []
let labels = ''
const filename = (side, name) => join(root, side, `${name}-scene.png`)
// Equal world-space crops per matching preset. Don't lower DPR to compare.
async function strip(side, name) {
  const image = sharp(filename(side, name))
  const { width, height } = await image.metadata(), { config, view, player } = frames[name]
  const w = Math.floor(504 * view.zoom * config.scale), h = Math.floor(191 * view.zoom * config.scale)
  const x = width / 2 + (player.x - 28 - view.x) * view.zoom * config.scale
  const y = height / 2 + (-37 - view.y) * view.zoom * config.scale
  const left = Math.max(0, Math.min(Math.floor(x - w / 2), width - w))
  const top = Math.max(0, Math.min(Math.floor(y - h / 2), height - h))
  return image.extract({ left, top, width: w, height: h }).resize(PW, 262).png().toBuffer()
}
const header = (title, subtitle) =>
  svgText(PAD, 45, title, 30) + svgText(PAD, 76, subtitle, 17, '#a5bdcb', false) +
  svgText(PAD, 119, 'BEFORE · STACKED PASSES', 17, '#ffc69e') + svgText(PAD + PW + GAP, 119, 'AFTER · SOLES + ONE CAST', 17, '#a4efdf')
labels = header('STICKMAN RISING / SHADOW PASS', 'Same scene, same pose and backing size in each pair. Cropped to the road and feet.')
const titles = { low: 'LOW  1×', medium: 'MEDIUM  1.25×', high: 'HIGH  1.5×', ultra: 'ULTRA  2× (REPLAY)', absolute: 'ABSOLUTE ULTRA  2.25×', station: 'NIGHT STATION  2.25×' }
let top = 141
for (const name of ['low', 'medium', 'high', 'ultra', 'absolute', 'station']) {
  const { before, after } = proof.profiles[name]
  labels += svgText(PAD, top + 19, `${titles[name]}    /    ${before.perFrame.actorPaints.toFixed(1)} → ${after.perFrame.actorPaints.toFixed(1)} actor shadow paints per crowd frame`, 17)
  for (const [i, side] of ['before', 'after'].entries()) {
    panes.push({ input: await strip(side, `${name}-lamp`), left: PAD + i * (PW + GAP), top: top + 32 })
  }
  top += 308
}
async function board(file, height) {
  const svg = Buffer.from(`<svg width="${WIDTH}" height="${height}">${labels}</svg>`)
  await sharp({ create: { width: WIDTH, height, channels: 3, background: '#101923' } })
    .composite([...panes, { input: svg, left: 0, top: 0 }]).jpeg({ quality: 92, mozjpeg: true }).toFile(join(dest, file))
}
await board('before-after.jpg', top + 12)

panes.length = 0
labels = header('ABSOLUTE ULTRA / SHADOWS IN MOTION', 'Fixed 2.25× scene. Combat and jumping desktop replays; capture route on the portrait viewport.')
top = 141
for (const [name, title] of [['absolute-fight', 'CROWD / FULL POSES'], ['absolute-jump', 'JUMP / ONLY A SOFT CAST REMAINS'], ['portrait-lamp', 'PORTRAIT / CAPTURE ROUTE']]) {
  labels += svgText(PAD, top + 19, title, 17)
  const portrait = name === 'portrait-lamp'
  const w = portrait ? 370 : PW, h = portrait ? 801 : 390
  for (const [i, side] of ['before', 'after'].entries()) {
    panes.push({ input: await sharp(filename(side, name)).resize(w, h).png().toBuffer(), left: PAD + i * (PW + GAP) + Math.floor((PW - w) / 2), top: top + 32 })
  }
  top += 46 + h
}
await board('absolute-ultra.jpg', top + 8)
console.table(Object.fromEntries(fixtures.map(name => [name, { actorBefore: proof.profiles[name].before.perFrame.actorPaints,
  actorAfter: proof.profiles[name].after.perFrame.actorPaints, p95Before: proof.pacing[name].medianBefore.rafMs.p95,
  p95After: proof.pacing[name].medianAfter.rafMs.p95, submitBefore: proof.pacing[name].medianBefore.submitMs.p95,
  submitAfter: proof.pacing[name].medianAfter.submitMs.p95 }])))
