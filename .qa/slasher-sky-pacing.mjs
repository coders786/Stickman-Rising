/** Production Canvas skyline work and parity fixture. --cpu-compositor
 * separates CPU submission from the packaged browser's software GL waits.
 * SR_SHOTS saves like-for-like frozen frames; --deny-city denies both WebPs.
 * These are application submit timings, not presentation or GPU timings. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { viewport, withBridge } from './bridge-browser.mjs'

const deny = process.argv.includes('--deny-city'), cache = process.argv.includes('--expect-reuse')
const dir = process.env.SR_SHOTS
if (dir) await mkdir(dir, { recursive: true })

await withBridge(async ({ page, open, button, phase, wait }) => {
  if (!viewport.isMobile) await page.setViewport({ ...viewport, width: 1000, height: 560 })
  if (deny) {
    await page.setRequestInterception(true)
    page.on('request', r => /^\/bridge\/l[12]\.webp$/.test(new URL(r.url()).pathname)
      ? r.respond({status: 404}) : r.continue())
  }
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'medium', adaptiveQuality: false, muted: true, shake: false }))
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (name, ...args) {
      return name === 'webgl2' && this.dataset.renderLayer === 'finish' ? null : get.call(this, name, ...args)
    }
  })
  await open()
  await wait(mask => window.__sr.bg.titleAssets() === mask, deny ? 1 : 7)
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    g.requestRun = sword => { const accepted = request(sword); if (accepted) g.pendingRun.seed = 42; return accepted }
  })
  await button('ENGAGE'); await phase('playing')

  const result = await page.evaluate(async save => {
    const g = window.__sr, sky = g.bg.scenery.sky, stream = g.bg.bridgeStream()
    cancelAnimationFrame(g.raf); g.qaMode = true; g.banner = null
    g.enemies.length = 0; g.hitstopT = 0; g.fx.clear(); g.streamQuiet = true
    g.setDiagnosticRenderScale(1)
    const wx = g.bg.routeWeather.clock.sample
    let tick = 9
    g.bg.routeTime = () => tick; g.bg.routeDrift = () => tick * .3; g.bg.lightningI = () => wx.flash ?? 0
    const pose = (x, y, fog, flash = 0) => {
      Object.assign(wx, { fog, cloud: .42, wet: .8, rain: .15, flash })
      g.cam.startOnRoad(x); g.cam.y = y; g.cam.offX = g.cam.offY = g.cam.rot = 0
      g.player.reset(x)
    }
    const paint = () => {
      if (!g.paint(0, false) || g.graphicsPresentation().path !== 'mobile-canvas' || g.worldSubmit.kind !== 'canvas') throw Error('Complete Canvas scene did not submit')
    }
    const raf = () => new Promise(done => requestAnimationFrame(done))
    const start = performance.now()
    pose(380, -135, .38)
    do {
      paint()
      if (stream.window && stream.plate(0, true) && (g.cssW < 670 || stream.plate(1, true))) break
      if (performance.now() - start > 32_000) throw Error('Local Canvas transport never settled')
      await raf()
    } while (true)

    const watched = new WeakSet(), scope = sky.scope, acquire = scope.tryAcquire.bind(scope)
    let paints = 0
    scope.tryAcquire = (key, ...args) => {
      const c = acquire(key, ...args)
      if (!c || !key.startsWith('noir-city-air') || watched.has(c)) return c
      watched.add(c)
      const ctx = c.getContext('2d', { willReadFrequently: true }), clear = ctx.clearRect.bind(ctx)
      ctx.clearRect = (...region) => { paints++; clear(...region) }
      return c
    }
    const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1]
    const fixtures = {}, png = {}
    let cityMs = 0, opticalMs = 0
    for (const key of ['city', 'draw', 'mist']) {
      const draw = sky[key].bind(sky)
      sky[key] = (...args) => {
        const t = performance.now(); draw(...args)
        if (key === 'city') cityMs += performance.now() - t
        else opticalMs += performance.now() - t
      }
    }
    // Repeat a stable grade, pan along it, then drive real height/fog
    // changes and flash onset. Only the graded cards may retain pixels.
    for (const [name, project] of [
      ['parked', () => pose(380, -135, .38)],
      ['pan', i => { tick = 9 + i / 10; pose(260 + i * 8, -135, .38) }],
      ['weather', i => { tick = 30 + i / 10; pose(460, -133 - i, .22 + i * .021, i > 19 ? .42 : 0) }],
    ]) {
      const canvas = [], city = [], optical = [], initial = paints
      for (let i = 0; i < 24; i++) {
        await raf(); project(i); cityMs = opticalMs = 0
        const t = performance.now(); paint(); canvas.push(performance.now() - t); city.push(cityMs); optical.push(opticalMs)
      }
      fixtures[name] = { frames: canvas.length, cityPaints: paints - initial, canvasMedianMs: median(canvas), cityMedianMs: median(city), opticalMedianMs: median(optical) }
      // Exclude pixel serialization from every timed frame.
      if (save) png[name] = g.ctx.canvas.toDataURL('image/png').split(',')[1]
    }
    // Compare the *committed* Canvas backing, away from the deliberately
    // black player and the dark asphalt at the center of the viewport.
    const { width, height } = g.ctx.canvas
    const witness = g.ctx.getImageData(Math.round(width * .22), Math.round(height * .12), Math.round(width * .15), Math.round(height * .20)).data
    let lit = 0
    for (let i = 0; i < witness.length; i += 4) lit += +(witness[i + 3] === 255 && Math.max(witness[i], witness[i + 1], witness[i + 2]) > 24)
    const visible = lit > 100
    const cards = g.resourceSnapshot().entries.filter(s => s.tag === 'bridge-city-aerial-perspective').length
    g.destroy()
    return { fixtures, cards, visible, afterDestroy: g.resourceSnapshot().surfaces, png }
  }, Boolean(dir))
  const { png, ...summary } = result
  for (const [pass, bytes] of Object.entries(png)) await writeFile(resolve(dir, `${pass}.png`), Buffer.from(bytes, 'base64'))
  assert.equal(summary.visible, true)
  assert.equal(summary.afterDestroy, 0)
  if (cache) {
    assert.equal(summary.cards, 2)
    assert.ok(summary.fixtures.parked.cityPaints <= 2 && summary.fixtures.pan.cityPaints <= 2, JSON.stringify(summary.fixtures))
    assert.ok(summary.fixtures.weather.cityPaints > 6, 'real weather still invalidates display grade')
  }
  return { deny, cpuCompositor: process.argv.includes('--cpu-compositor'), ...summary }
})
