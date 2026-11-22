/** Real touch UI; isolate backdrop blur with an inline override on the control
 * build, or assert the shipped treatment with --flat. No stats/readbacks during
 * the timing window other than requestAnimationFrame timestamps. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const chromium = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
const flat = process.argv.includes('--flat')
const shot = process.argv.find(arg => arg.startsWith('--screenshot='))?.slice('--screenshot='.length)
const software = process.env.SR_SOFTWARE === '1'
const browser = await puppeteer.launch({
  executablePath: process.env.SR_BROWSER_EXECUTABLE || await chromium.executablePath(),
  args: [...(chromium?.args ?? []), ...(software ? ['--disable-gpu'] : [])], protocolTimeout: 120_000,
})
const viewport = { width: flat ? 400 : 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const trials = []
try {
  for (const mode of flat ? ['flat'] : ['stock', 'no-blur', 'no-blur', 'stock', 'stock', 'no-blur']) {
    const page = await browser.newPage(), errors = []
    page.setDefaultTimeout(45_000)
    try {
      page.on('pageerror', error => errors.push(String(error)))
      page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(msg.text()) })
      await page.setViewport(viewport)
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('sr_settings_v1', JSON.stringify({ quality: 'ultra', qualityV: 2, adaptiveQuality: false, muted: true, showFps: false }))
      })
      await page.goto(process.env.SR_QA_URL || 'http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' })
      await (await page.waitForFunction(() => window.__sr?.bg?.getProfile())).dispose()
      await page.evaluate(() => {
        const g = window.__sr
        g.qaMode = true
        g.autoQuality = false
        const off = g.on(event => {
          if (event.type !== 'phase') return
          if (event.phase === 'preparing') g.pendingRun.seed = 42
          if (event.phase === 'playing') {
            queueMicrotask(() => cancelAnimationFrame(g.raf))
            off()
          }
        })
      })
      const engage = await page.waitForFunction(() => [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'ENGAGE' && !b.disabled))
      await engage.asElement().tap()
      await engage.dispose()
      await (await page.waitForFunction(() => window.__sr?.phase === 'playing' && document.querySelector('[aria-label="SLASH"]'))).dispose()
      const row = await page.evaluate(async mode => {
        const g = window.__sr, continuous = Boolean(g.route)
        if (continuous && mode !== 'flat') throw new Error('Use --flat for the current Bridge and a frozen control for blur comparisons')
        const surfaces = [...document.querySelectorAll(mode === 'flat' ? '.sr-touch-surface' : '.backdrop-blur-sm')]
        const beforeFilter = surfaces.map(e => getComputedStyle(e).backdropFilter)
        const expected = continuous ? 10 : 11
        if (surfaces.length !== expected || beforeFilter.some(filter => mode === 'flat' ? filter !== 'none' : !filter.includes('blur'))) {
          throw new Error(`Unexpected touch treatment: ${JSON.stringify(beforeFilter)}`)
        }
        if (mode === 'no-blur') for (const surface of surfaces) surface.style.backdropFilter = 'none'
        const filters = surfaces.map(e => getComputedStyle(e).backdropFilter)
        const layout = () => [g.canvas.width, g.canvas.height, g.hudCtx.canvas.width, g.hudCtx.canvas.height, g.dpr, g.settings.quality]
        const size = layout()
        const x = continuous ? g.route.chunk(0).shelter.right + 28 : 810
        g.player.reset(x); g.cam.startOnRoad(x)
        if (continuous) g.bg.advanceActiveTicks(540, 1)
        else {
          // Reset title-dwell effects in the historical blur control.
          const storm = new g.storm.constructor(g.settings.quality)
          storm.resize(g.cssW, g.cssH)
          storm.applyProfile(g.bg.getProfile().weather)
          storm.setSharpRain(true)
          g.storm = g.bg.storm = storm
          for (let i = 0; i < 2400; i++) {
            const wx = g.bg.weatherState()
            if (wx?.kind === 'drizzle' && wx.s === 1) break
            g.bg.update(.1)
          }
        }
        const wx = g.bg.weatherState()
        if (g.bg.getProfile().seed !== 42 || wx?.kind !== 'drizzle' || wx.s !== 1 || !g.touchControls || g.renderer.forward) {
          throw new Error(`not the same wet touch replay: ${JSON.stringify({ seed: g.bg.getProfile().seed, wx, touch: g.touchControls, forward: g.renderer.forward })}`)
        }
        g.input.setVirtualAxis(1, 0)
        const warmup = 30, samples = 72, intervals = new Float64Array(samples)
        let previous = 0, i = 0, state = 0xa9b14, hidden = 0
        const onVisibility = () => { if (document.hidden) hidden++ }
        document.addEventListener('visibilitychange', onVisibility)
        const epoch = performance.now(), random = Math.random
        g.lastFrame = epoch
        try {
          await new Promise((done, reject) => {
            function frame(now) {
              try {
                if (++i > warmup) intervals[i - warmup - 1] = now - previous
                previous = now
                Math.random = () => {
                  state = (Math.imul(state, 1664525) + 1013904223) >>> 0
                  return state / 4294967296
                }
                try { g.frame(epoch + i * 1000 / 60) } finally { Math.random = random }
                if (i === warmup + samples) done()
                else requestAnimationFrame(frame)
              } catch (error) { reject(error) }
            }
            requestAnimationFrame(frame)
          })
        } finally {
          document.removeEventListener('visibilitychange', onVisibility)
          g.input.setVirtualAxis(0, 0)
        }
        if (hidden || document.hidden || layout().some((value, j) => value !== size[j])) throw new Error('replay lost its locked layout/visibility')
        const ordered = intervals.slice().sort()
        const at = q => ordered[Math.ceil(samples * q) - 1]
        return { mode, continuous, startX: x, layers: filters.filter(filter => filter !== 'none').length, surfaces: surfaces.length, layout: size,
          samples, p50: at(.5), p95: at(.95), p99: at(.99), stalls250ms: intervals.filter(ms => ms > 250).length,
          seed: g.bg.getProfile().seed, playerX: g.player.x, time: g.time, weather: g.bg.weatherState() }
      }, mode)
      const scale = row.continuous ? 1.25 : 2.25
      assert.deepEqual(row.layout, [Math.floor(viewport.width * scale), Math.floor(viewport.height * scale), viewport.width * 2, viewport.height * 2, scale, 'ultra'])
      assert.equal(row.layers, mode === 'stock' ? 11 : 0)
      assert.ok(row.playerX - row.startX > 150, 'viewport did not pan behind the touch controls')
      assert.deepEqual(errors, [], 'browser/game errors')
      trials.push(row)
      if (shot && trials.length === (flat ? 1 : 6)) {
        await mkdir(dirname(shot), { recursive: true })
        await page.screenshot({ path: shot })
      }
    } finally { await page.close() }
  }
  const { seed, playerX, time, weather } = trials[0]
  for (const run of trials) {
    assert.equal(run.seed, seed)
    assert.ok(Math.abs(run.playerX - playerX) < 1e-6 && Math.abs(run.time - time) < 1e-6)
    assert.deepEqual(run.weather, weather)
  }
  console.log(JSON.stringify({ browser: await browser.version(), softwareRequested: software, viewport, trials }, null, 2))
} finally { await browser.close() }
