/** Real compressed, denied, and malformed bake delivery with a frozen
 * tick-zero HDR scene. No native skyline variant or GPU transcode download. */
import assert from 'node:assert/strict'
import { withBridge, viewport } from './bridge-browser.mjs'

const deny = process.argv.includes('--deny'), corrupt = process.argv.includes('--corrupt')
const files = ['deck.bin.br', 'look-32.bin.br']
await withBridge(async ({ page, open, button, phase, wait }) => {
  await page.setViewport({ ...viewport, width: 600, height: 380 })
  await page.evaluateOnNewDocument(({ deny, corrupt, files }) => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true }))
    if (!deny && !corrupt) return
    const fetch = window.fetch.bind(window)
    window.fetch = (resource, options) => {
      const url = new URL(typeof resource === 'string' ? resource : resource.url ?? resource.href, location.href)
      if (url.origin === location.origin && files.some(name => url.pathname === `/bridge/baked-v1/${name}`)) {
        return Promise.resolve(deny ? new Response(null, { status: 404 }) : new Response(new Uint8Array(4)))
      }
      return fetch(resource, options)
    }
  }, { deny, corrupt, files })
  const loaded = new Set(), oldRequests = []
  page.on('request', r => { if (/\/packed-v4\/|\.ktx2?$/.test(new URL(r.url()).pathname)) oldRequests.push(r.url()) })
  page.on('response', r => { if (r.ok()) loaded.add(new URL(r.url()).pathname) })
  await open()
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    g.allowDiagnosticMaster()
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
    g.on(e => {
      if (e.type === 'phase' && e.phase === 'playing') {
        window.v4Opening = g.graphicsPresentation()
        queueMicrotask(() => cancelAnimationFrame(g.raf))
      }
    })
  })
  await button('ENGAGE'); await phase('playing')
  await wait(() => window.__sr.graphicsPresentation().path === 'master-webgl2')
  let decoded = null
  if (!deny && !corrupt) {
    decoded = await page.evaluate(async files => Object.fromEntries(await Promise.all(files.map(async name => {
      const r = await fetch(`/bridge/baked-v1/${name}`)
      const bytes = new Uint8Array(await r.arrayBuffer())
      return [name, { status: r.status, encoding: r.headers.get('content-encoding'), bytes: bytes.length, tag: new TextDecoder().decode(bytes.subarray(0, 4)) }]
    }))), files)
    assert.deepEqual(decoded, {
      'deck.bin.br': { status: 200, encoding: 'br', bytes: 212996, tag: 'BDK1' },
      'look-32.bin.br': { status: 200, encoding: 'br', bytes: 524292, tag: 'BL32' },
    })
  }
  const r = await page.evaluate(() => {
    const g = window.__sr, p = g.renderer.bridgeFinish.pipe, opening = window.v4Opening, pr = opening.gpu
    if (opening.frame.kind !== 'webgl' || opening.frame.time !== 0 || !pr.transport.active || pr.packedAssets.city !== 'shared-webp') {
      throw Error('Entered before textures were resident: ' + JSON.stringify(opening))
    }
    const gl = p.gl, color = new Float32Array(4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.scene.fbo)
    gl.readPixels(33, p.scene.height - 62, 1, 1, gl.RGBA, gl.FLOAT, color)
    const result = { config: g.renderConfig, packed: pr.packedAssets, sky: pr.stratumA, pixel: [...color], glError: gl.getError() }
    g.destroy(); return { ...result, liveSurfaces: g.resourceSnapshot().surfaces }
  })
  assert.deepEqual(oldRequests, [])
  assert.equal(r.packed.deck, deny || corrupt ? 'local' : 'brotli')
  assert.equal(r.packed.lut, deny || corrupt ? 'local' : 'brotli')
  assert.deepEqual(r.packed.lutVolumes, Array(4).fill(r.packed.lut))
  assert.equal(r.glError, 0); assert.ok(r.pixel[3] > 0 && r.pixel.slice(0, 3).some(v => v > .002))
  assert.ok(r.sky.live && r.config.renderScale === 1.25 && !r.config.adaptiveEnabled)
  assert.equal(r.liveSurfaces, 0)
  return { ...r, deny, corrupt, decoded, fetched: [...loaded].filter(path => path.startsWith('/bridge/')) }
})
