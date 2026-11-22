/** Packaged app, real UI and diagnostic shader readback. Software GL is
 * deliberately enabled only with --force-gl; these are not device benchmarks.
 * SR_BROWSER_TOOLS points at puppeteer-core + @sparticuz/chromium (or supply a
 * browser via SR_BROWSER_EXECUTABLE). --touch uses a 400×844 CSS viewport. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { base, touch, viewport, withBridge } from './bridge-browser.mjs'

const force = process.argv.includes('--force-gl')
const compact = process.argv.includes('--compact')
assert.ok(!compact || force && !touch, '--compact is a reduced desktop software test')
const testedViewport = compact ? { ...viewport, width: 600, height: 380 } : viewport
const shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })
const expectedPath = force ? touch ? 'mobile-webgl2' : 'master-webgl2' : 'mobile-canvas'
const prefs = JSON.stringify({ qualityV: 3, quality: 'medium', adaptiveQuality: true, showFps: false, muted: true })
const url = new URL(base); url.searchParams.set('verifyGraphics', '1')

await withBridge(async ({ page, open, button, phase, wait, pause, frames }) => {
  if (compact) await page.setViewport(testedViewport)
  const gfx = () => page.evaluate(() => window.__GRAPHICS_DIAGNOSTICS__)
  const assets = new Map()
  page.on('response', r => {
    const file = new URL(r.url()).pathname
    if (file.startsWith('/bridge/')) assets.set(file, r.status())
  })
  await page.evaluateOnNewDocument(value => { localStorage.setItem('sr_settings_v1', value) }, prefs)
  await open(url)
  await wait(() => window.__GRAPHICS_DIAGNOSTICS__?.driver)
  const { driver } = await gfx()
  assert.ok(driver.ok, JSON.stringify(driver))
  assert.equal(driver.linked.length, 15)
  assert.deepEqual(driver.mips, [[512, 128], [256, 64], [128, 32], [64, 16]])
  assert.equal(driver.formats.mobileRoad, 'RGBA8')
  if (force && !touch) assert.equal(driver.formats.masterRoad, 'RGBA16F')
  for (const tier of ['masterRoad', 'mobileRoad']) assert.deepEqual(driver.offsets[tier], [0, 640, 1664, 2176, 2432, 3072, 3456])
  for (const read of driver.probes) {
    assert.ok(read.pass && read.glError === 0 && read.maxError <= .009)
    if (read.name === 'Dry AO') assert.ok(read.left[0] < .6 && read.right[0] === 1)
    if (read.name === 'Catwalk Underside') assert.ok(read.left[2] === 1 && read.left[3] === 0 && read.right[2] === 0 && read.right[3] === 1)
    if (read.name === 'Crossing dry shadows / baked umbra') assert.ok(read.left[1] >= .28 && read.left[1] <= .30 && read.right[0] === 0)
    if (read.name === 'Catwalk blocker / RGB9_E5') assert.ok(read.left[0] === 0 && read.right[0] === 1 && read.right[1] > read.right[2])
    if (read.name === 'Dual Arc') assert.ok(read.right[0] > read.left[0] * 1.8 && read.right[3] === read.left[3])
    if (read.name === 'Finite emitter penumbra') assert.ok(read.left[0] === 1 && read.right[0] === 0 && read.right[1] > .10 && read.right[2] > 4 * read.left[2])
    if (read.name === 'Damp aggregate / pooled water') assert.ok(read.left[1] === 0 && read.right[1] > .90 && read.left[0] > 5 * read.right[0] && read.left[3] > 10 * read.right[3])
  }
  for (const name of ['Finite emitter penumbra', 'Damp aggregate / pooled water']) {
    const reads = driver.probes.filter(read => read.name === name)
    assert.deepEqual(reads.map(read => read.tier), ['masterRoad'])
    assert.ok(reads[0].pass)
  }
  if (process.argv.includes('--driver-only')) return { url: url.pathname + url.search, driver }
  const lock = { preset: 'ULTRA', adaptiveEnabled: false, renderScale: 1.25, showFPS: true }
  assert.deepEqual(await page.evaluate(() => window.__sr.renderConfig), lock)
  await page.evaluate(force => {
    const g = window.__sr
    if (force) g.allowDiagnosticMaster()
    g.player.takeDamage = () => false // keep the 120-frame sample in one run
    const request = g.requestRun.bind(g)
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
    window.__sacrQA = { cloth: null, fps: null }
    const drawPlayer = g.player.draw.bind(g.player)
    g.player.draw = (...a) => { window.__sacrQA.cloth = a[3]; drawPlayer(...a) }
    const ctx = g.hudCtx, ink = ctx.fillText.bind(ctx)
    ctx.fillText = (label, x, y, width) => {
      if (/^\d+ FPS$/.test(label)) window.__sacrQA.fps = [label, x, y, width]
      ink(label, x, y, width)
    }
    const wrap = document.querySelector('.sr-viewport')
    for (const [side, px] of Object.entries({ top: 24, left: 11, right: 9, bottom: 13 })) wrap.style.setProperty(`--sr-inset-${side}`, `${px}px`)
    g.resize()
  }, force)
  await button('ENGAGE'); await phase('playing')
  await (await page.waitForFunction(() => !!window.__GRAPHICS_DIAGNOSTICS__?.timing, { polling: 250, timeout: 225_000 })).dispose()
  const report = await gfx(), { timing } = report
  assert.equal(report.status, force ? 'pass' : 'live Canvas fallback', JSON.stringify(report))
  assert.deepEqual(timing.paths, { [expectedPath]: 120 })
  console.error(`${expectedPath}: ${timing.frames} frames; ${timing.fps} FPS; gap p95 ${timing.frameIntervalMs.p95} ms (not GPU time)`)
  assert.ok(timing.ultraLocked && timing.fpsVisible)
  assert.equal(timing.minRequestedScale, 1.25)
  assert.equal(timing.minBackingScale, force && touch ? 1 : 1.25)
  const live = await page.evaluate(() => {
    const g = window.__sr, hud = g.hudCtx.canvas, [label, x, y, w] = window.__sacrQA.fps
    const sx = hud.width / g.cssW, sy = hud.height / g.cssH
    const ink = g.hudCtx.getImageData(Math.round(x * sx), Math.round((y - 15) * sy), Math.floor(w * sx), Math.round(16 * sy)).data
    let litPixels = 0
    // Count white/icy glyphs, not the underlying dark HUD plate.
    for (let i = 0; i < ink.length; i += 4) if (ink[i] > 128 && ink[i + 1] > 170 && ink[i + 2] > 170 && ink[i + 3] > 112) litPixels++
    const resources = g.resourceSnapshot()
    return { fpsLabel: label, litPixels, clothNodes: window.__sacrQA.cloth, insets: g.insets,
      fpsPosition: [x, y, w], artDecoded: !!resources.presentation.gpu?.stratumA?.live, presentation: resources.presentation,
      backing: [g.canvas.width, g.canvas.height], hud: [hud.width, hud.height], stores: resources.surfaces,
      bytes: resources.bytes, over: resources.overSurfaces }
  })
  assert.match(live.fpsLabel, /^\d+ FPS$/)
  assert.ok(live.litPixels > 20 && live.over === 0 && live.fpsPosition[0] >= 16 + live.insets.left)
  assert.equal(live.clothNodes, force && !touch ? 5 : 2)
  if (force) {
    const { gpu } = live.presentation
    assert.equal(gpu.maxK, touch ? 4 : 6)
    assert.equal(gpu.format, touch ? 'RGBA8' : 'RGBA16F')
    assert.equal(gpu.uboBytes, 3584)
    assert.deepEqual(gpu.roadSize, touch ? [200, 422] :
      [testedViewport.width, testedViewport.height].map(n => Math.floor(n * 1.25)))
    assert.deepEqual(gpu.sectorLut, (touch ? [256, 16] : [1024, 32]))
    assert.ok(live.artDecoded)
    assert.deepEqual(gpu.stratumA.size, touch ? [96, 96] : [256, 88])
    assert.equal(gpu.stratumA.format, touch ? 'RGBA8' : 'RGBA16F')
    for (const asset of ['baked-v1/sky.bin.br', 'l1.webp', 'l2.webp']) assert.equal(assets.get(`/bridge/${asset}`), 200)
  } else assert.equal(live.presentation.gpu, null)
  if (shots) await page.screenshot({ path: resolve(shots, `${expectedPath}-live.png`), captureBeyondViewport: false })

  await pause(); await phase('paused'); await button('SETTINGS')
  const menu = await page.$eval('[data-settings-back]', back => {
    const rect = back.getBoundingClientRect(), { x, y, width: w, height: h } = rect
    const hud = document.querySelector('[data-render-layer="hud"]')
    const target = document.elementFromPoint(x + w / 2, y + h / 2)
    return { x, y, w, h, hudVisibility: getComputedStyle(hud).visibility, hit: back.contains(target),
      right: innerWidth - x - w, label: document.querySelector('#quality-label + [role="status"]')?.textContent,
      preset: document.querySelector('[aria-labelledby="quality-label"] button[aria-pressed="true"]')?.textContent,
      active: document.querySelector('[data-active-renderer]')?.textContent.trim() }
  })
  assert.ok(menu.w >= 44 && menu.h >= 44 && menu.y >= 24 + 16 && menu.right >= 9 + 16 && menu.hit)
  assert.equal(menu.hudVisibility, 'hidden')
  assert.match(menu.label, /Locked · 1\.25× target/)
  assert.equal(menu.preset, 'Ultra')
  assert.match(menu.active, new RegExp(force ? touch ? 'WebGL2 Optimized' : 'WebGL2 HDR' : 'Canvas 2D'))
  if (shots) await page.screenshot({ path: resolve(shots, `${expectedPath}-settings.png`), captureBeyondViewport: false })
  await page.$eval('button[aria-label="Show FPS"]', el => el.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await button('Show FPS')
  await wait(() => !window.__sr.renderConfig.showFPS)
  assert.deepEqual(await page.evaluate(() => window.__sr.renderConfig), { ...lock, showFPS: false })
  await button('BACK'); await button('RESUME'); await phase('playing'); await frames()
  const toggle = await page.evaluate(() => ({ ink: window.__sr.hud.lastFpsDraw, original: localStorage.getItem('sr_settings_v1'),
    hud: getComputedStyle(window.__sr.hudCtx.canvas).visibility, config: window.__sr.renderConfig }))
  assert.equal(toggle.ink, null)
  assert.equal(toggle.hud, 'visible')
  assert.equal(toggle.original, prefs, 'diagnostic override must not save preferences')
  assert.deepEqual(toggle.config, { ...lock, showFPS: false })
  return { url: url.pathname + url.search, syntheticSafeInsets: true, testedViewport, expectedPath, force, report, live, menu, toggle }
})
