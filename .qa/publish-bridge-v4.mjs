/** Publish only compact review images and receipts, not raw captures or builds.
 * Usage: node .qa/publish-bridge-v4.mjs [.cache/master-v4] [research/master-v4]
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const [, , root = '.cache/master-v4', out = 'research/master-v4'] = process.argv
const report = (name, ext) => readFile(join(root, 'reports', `${name}.${ext}`), 'utf8')
const readJSON = async name => JSON.parse(await report(name, 'json'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const tally = s => ({ tests: +s.match(/^# tests (\d+)$/m)[1], pass: +s.match(/^# pass (\d+)$/m)[1],
  failures: [...s.matchAll(/^not ok \d+ - (.*)$/gm)].map(m => m[1]) })
const build = (await readFile(join(root, 'preview-release/.next-build/BUILD_ID'), 'utf8')).trim()
const receipt = { build, control: 'Qcjd_L8Y3O8GalhD3VDQr', seed: 42, captures: {}, diagnostics: {}, transport: {} }
const mainScenes = ['transit', 'sodium', 'catwalk', 'sheet-lightning', 'service-bay', 'market', 'gemini', 'gemini-hit']
const paths = { master: 'master-webgl2', mobile: 'mobile-webgl2', canvas: 'mobile-canvas' }
await mkdir(out, { recursive: true })
for (const [tier, path] of Object.entries(paths)) {
  const record = await readJSON(`release-shots-${tier}`), frames = {}
  assert.equal(record.mode, path)
  for (const name of mainScenes) {
    assert.ok(record.frames[name], `${path}: missing ${name}`)
    const master = receipt.captures.master?.frames[name].scene
    if (master) for (const field of ['x', 'floor', 'cam', 't', 'cloud', 'flash']) assert.deepEqual(record.metrics[name][field], master[field], `${tier}/${name}/${field}`)
  }
  for (const [name, meta] of Object.entries(record.frames)) {
    const png = await readFile(join(root, 'release-shots', meta.file))
    assert.equal(sha(png), meta.sha256)
    const raw = await sharp(png).metadata()
    assert.deepEqual([raw.width, raw.height], record.metrics[name].size)
    const file = `${tier}-${name}.webp`
    const data = await sharp(png).resize({ width: tier === 'master' ? 1100 : 460, withoutEnlargement: true }).webp({ quality: 88, effort: 6 }).toBuffer()
    await writeFile(join(out, file), data)
    frames[name] = { ...meta, webp: file, webpSha256: sha(data), webpBytes: data.length, scene: record.metrics[name] }
  }
  const hit = async () => {
    const pixels = name => sharp(join(root, 'release-shots', record.frames[name].file)).removeAlpha().raw().toBuffer()
    const [a,b] = await Promise.all(['gemini', 'gemini-hit'].map(pixels))
    let change15 = 0, newNeutralWhite = 0, maxDelta = 0
    const neutral = (buf,i) => Math.min(buf[i],buf[i+1],buf[i+2]) >= 225
    for (let i=0;i<a.length;i+=3) {
      const delta = Math.max(...[0,1,2].map(q=>Math.abs(a[i+q]-b[i+q])))
      if (delta >= 15) change15++; maxDelta = Math.max(maxDelta, delta)
      if (neutral(b,i) && !neutral(a,i)) newNeutralWhite++
    }
    return { change15, newNeutralWhite, maxDelta }
  }
  receipt.captures[tier] = { renderer: record.renderer, frames, geminiDelta: await hit() }
  let measured, diagnosticsBuild = build
  try { measured = await readJSON(`release-verify-${tier}`) }
  catch (e) {
    if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e
    measured = await readJSON(`verify-${tier}`); diagnosticsBuild = '0kE6rwyopQIpc8iqU-CEw'
  }
  const { report: render, live, menu } = measured
  receipt.diagnostics[tier] = { build: diagnosticsBuild, status: render.status, testedViewport: measured.testedViewport,
    adapter: render.driver.renderer, programs: render.driver.linked.length, reads: render.driver.probes.length, errors: render.driver.errors,
    timing: render.timing, backing: live.backing, menu, fps: live.fpsLabel }
  if (tier === 'mobile') {
    const source = diagnosticsBuild === build ? 'release-hud' : 'shots'
    for (const name of ['live', 'settings']) {
      const png = await readFile(join(root, source, `mobile-webgl2-${name}.png`))
      const file = `touch-${name}.webp`
      const data = await sharp(png).resize({ width: 560, withoutEnlargement: true }).webp({ quality: 91 }).toBuffer()
      await writeFile(join(out, file), data)
      receipt.diagnostics[tier][name] = { file, sha256: sha(data) }
    }
  }
}
receipt.transport.master = { build: 'jj1OKw9zSwVJL7Cp8_pBK', ...await readJSON('shipping-live-master') }
receipt.transport.mobile = { build, ...await readJSON('release-live-mobile') }
receipt.transport.denied = { build: 'jj1OKw9zSwVJL7Cp8_pBK', ...await readJSON('shipping-live-denied') }
receipt.assets = { http: await readJSON('asset-http'), native: await readJSON('release-assets-native'), denied: await readJSON('release-assets-denied') }
receipt.bake = await readJSON('v4-bake')
const soak = await readJSON('shipping-retry-canvas')
receipt.retries = { build: 'jj1OKw9zSwVJL7Cp8_pBK', ...soak, summary: {
  minDistance: Math.min(...soak.rows.map(r => r.end - r.from)), gates: soak.rows.reduce((n,r)=>n+r.gates,0),
  maxSurfaces: Math.max(...soak.rows.map(r=>r.maxStores)), maxBytes: Math.max(...soak.rows.map(r=>r.maxBytes)) } }
const offline = await report('gl-release', 'log')
const baseline = JSON.parse(await readFile('research/noir/verification.json', 'utf8'))
const fullRelease = await report('full-release', 'log').catch(() => '')
const fullFinal = /^# tests /m.test(fullRelease)
receipt.tests = { focused: tally(await report('focused-release', 'log')), full: tally(fullFinal ? fullRelease : await report('full-shipping', 'log')),
  fullBuild: fullFinal ? build : 'jj1OKw9zSwVJL7Cp8_pBK',
  control: baseline.tests.full, offlinePrograms: +offline.match(/validated and linked (\d+) exact/)[1] }
assert.deepEqual(receipt.tests.full.failures, receipt.tests.control.failures)
for (const [key, file] of [['float', 'admission-float'], ['surface', 'admission-surface'], ['rolled', 'release-eave'], ['touch', 'quality-v4-touch']]) {
  try {
    receipt[key] = { build: key === 'rolled' ? build : 'jj1OKw9zSwVJL7Cp8_pBK', ...await readJSON(file) }
  } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e }
}
await writeFile(join(out, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ build, counts: Object.fromEntries(Object.entries(receipt.captures).map(([k,v])=>[k,Object.keys(v.frames).length])), tests: receipt.tests }))
