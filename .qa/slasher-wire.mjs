// Cold, real Engage request sets; count same-origin response bodies as
// delivered by the production server. Hardened Chromium can zero sizes in
// Resource Timing, so use timings for attribution and HTTP for byte counts.
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { base, withBridge } from './bridge-browser.mjs'

const gl = process.argv.includes('--gl'), optimized = process.argv.includes('--optimized')
const eligible = path => path === '/' || /^\/(?:_next\/static|bridge)\//.test(path)
const measure = path => new Promise((resolve, reject) => {
  const url = new URL(path, base), transport = url.protocol === 'https:' ? https : http
  const req = transport.get(url, { headers: { 'accept-encoding': 'br, gzip' } }, res => {
    const chunks = []
    res.on('data', c => chunks.push(c)).on('error', reject).on('end', () => {
      try {
        assert.equal(res.statusCode, 200, path)
        const raw = Buffer.concat(chunks), encoding = res.headers['content-encoding'] ?? 'identity'
        const decoded = encoding === 'br' ? brotliDecompressSync(raw) : encoding === 'gzip' ? gunzipSync(raw) : raw
        resolve({ path, bytes: raw.length, decoded: decoded.length, encoding })
      } catch (e) { reject(e) }
    })
  })
  req.on('error', reject).setTimeout(15_000, () => req.destroy(new Error(`Timed out: ${path}`)))
})

await withBridge(async ({ page, open, button, phase }) => {
  await page.setViewport({ width: 600, height: 380, deviceScaleFactor: 1 })
  await page.setCacheEnabled(false)
  const requests = new Set(), workerScripts = new Set()
  page.on('request', r => {
    const u = new URL(r.url())
    if (u.origin === base.origin && eligible(u.pathname)) requests.add(u.pathname)
  })
  page.on('workercreated', worker => {
    // Turbopack browser Worker URLs encode their static module list in
    // params. importScripts itself is not a page ResourceTiming event.
    const url = new URL(worker.url()), param = url.searchParams.get('params') ?? new URLSearchParams(url.hash.slice(1)).get('params')
    workerScripts.add(url.pathname)
    if (param) for (const path of (JSON.parse(param)[0] ?? [])) {
      if (typeof path === 'string') workerScripts.add(new URL(path.startsWith('static/') ? `/_next/${path}` : path, base).pathname)
    }
  })
  await page.evaluateOnNewDocument(({ optimized }) => localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: optimized ? 'medium' : 'ultra', adaptiveQuality: false, muted: true })), { optimized })
  await open()
  await page.evaluate(gl => {
    const g = window.__sr
    if (gl) g.allowDiagnosticMaster()
    g.on(e => {
      if (e.type === 'phase' && e.phase === 'preparing') g.pendingRun.seed = 42
      if (e.type === 'phase' && e.phase === 'playing') {
        window.srWireOpening = g.graphicsPresentation()
        queueMicrotask(() => cancelAnimationFrame(g.raf))
      }
    })
  }, gl)
  await button('ENGAGE'); await phase('playing')
  const result = await page.evaluate(async () => {
    const g = window.__sr, start = window.srWireOpening
    const marks = Object.fromEntries(performance.getEntriesByType('mark').filter(m => m.name.startsWith('sr:')).map(m => [m.name.slice(3), m.startTime]))
    const epoch = performance.now(), steps = 6
    g.lastFrame = epoch
    for (let i = 0; i < steps; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      g.frame(epoch + (i + 1) * (1000 / 60))
    }
    await document.fonts.ready
    const resources = performance.getEntriesByType('resource').map(e => ({ file: new URL(e.name).pathname, end: e.responseEnd }))
    const runTime = g.time, pending = g.bg.bridgeStream().receipt()
    g.destroy()
    return { marks, resources, frame: start.frame, path: start.path, runTime, stream: pending, surfaces: g.resourceSnapshot().surfaces }
  })
  assert.equal(result.path, gl ? optimized ? 'mobile-webgl2' : 'master-webgl2' : 'mobile-canvas')
  assert.equal(result.frame.time, 0); assert.ok(result.runTime > 0 && result.surfaces === 0)
  const filesBy = at => new Set(['/', ...result.resources.filter(r => r.end > 0 && r.end <= at && eligible(r.file)).map(r => r.file)])
  const menu = filesBy(result.marks.ready), opening = filesBy(result.marks['run-submit'])
  for (const f of workerScripts) if (eligible(f)) opening.add(f)
  const play = new Set([...filesBy(Infinity), ...opening, ...requests])
  const files = await Promise.all([...play].sort().map(measure))
  const stats = paths => {
    const parts = files.filter(f => paths.has(f.path))
    const sum = xs => xs.reduce((sum, f) => sum + f.bytes, 0)
    return { requests: parts.length, bytes: sum(parts), bridge: sum(parts.filter(f => f.path.startsWith('/bridge/'))),
      code: sum(parts.filter(f => /\.(?:css|js)$/.test(f.path))), fonts: sum(parts.filter(f => /\.woff2$/.test(f.path))) }
  }
  return { ...result, viewport: page.viewport(), bodies: { menu: stats(menu), opening: stats(opening), play: stats(play) }, files }
})
