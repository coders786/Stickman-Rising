/** Presets, opt-in scale hysteresis, short settings and real foreground FPS.
 * --pacing adds 30s with real rAF and moving road traffic (invulnerable QA hero).
 * Controlled governor samples are not hardware pacing measurements. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { withBridge, touch, viewport } from './bridge-browser.mjs'

const scales = { Low: .75, Medium: 1, High: 1.15, Ultra: 1.25 }
const storageTier = preset => preset.toLowerCase()
const dir = process.env.SR_SHOTS
if (dir) await mkdir(dir, { recursive: true })

await withBridge(async ({ page, open, button, phase, wait, pause }) => {
  await open()
  const check = async (preset, renderScale = scales[preset], adaptive = false) => {
    await wait((preset, renderScale, adaptive, stored) => {
      const g = window.__sr, prefs = JSON.parse(localStorage.getItem('sr_settings_v1') || '{}')
      const active = document.querySelector('#quality-label + [role="status"]')
      const selected = document.querySelector('[aria-labelledby="quality-label"] button[aria-pressed="true"]')
      const mode = document.querySelector('#adaptive-quality')
      return selected?.textContent === preset && active?.textContent.includes(`${adaptive ? 'Adaptive' : 'Locked'} · ${renderScale.toFixed(2)}× target`) &&
        mode?.getAttribute('aria-checked') === String(adaptive) && prefs.qualityV === 3 && prefs.quality === stored &&
        prefs.adaptiveQuality === adaptive && g.renderConfig.preset === stored.toUpperCase() && g.dpr === renderScale &&
        g.canvas.width === Math.floor(g.cssW * renderScale) && g.canvas.height === Math.floor(g.cssH * renderScale)
    }, preset, renderScale, adaptive, storageTier(preset))
  }
  await button('SETTINGS')
  const group = '[aria-labelledby="quality-label"]'
  assert.deepEqual(await page.$$eval(`${group} button`, bs => bs.map(b => [b.textContent, b.disabled])), Object.keys(scales).map(n => [n, false]))
  assert.equal(await page.$('[aria-label="Arena previews"]'), null)
  assert.equal(await page.$('[aria-describedby="ultra-hint"]'), null)
  const initial = await page.evaluate(() => window.__sr.renderConfig)
  // Fresh detection enables adaptation above Low. Picking any preset locks it.
  assert.equal(initial.adaptiveEnabled, initial.preset !== 'LOW')
  await check(Object.keys(scales).find(p => p.toUpperCase() === initial.preset), initial.renderScale, initial.adaptiveEnabled)
  for (const preset of Object.keys(scales)) { await button(preset); await check(preset) }
  if (dir) await page.screenshot({ path: resolve(dir, `${touch ? 'touch' : 'desktop'}-presets.png`), captureBeyondViewport: false })

  // Simulate a notch and a short viewport. The content scrolls; Back never moves.
  await page.setViewport({ ...viewport, height: touch ? 490 : 445 })
  await page.$eval('.sr-viewport', el => {
    el.style.setProperty('--sr-inset-top','24px'); el.style.setProperty('--sr-inset-left','12px')
    el.style.setProperty('--sr-inset-right','10px'); el.style.setProperty('--sr-inset-bottom','20px')
  })
  const compact = await page.evaluate(() => {
    const scroll = document.querySelector('[aria-label="Game preferences"]')
    const back = [...document.querySelectorAll('button')].find(b => b.textContent === 'BACK')
    const rect = () => { const r = back.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }
    const start = rect()
    const contentScrolls = scroll.scrollHeight > scroll.clientHeight
    scroll.scrollTop = scroll.scrollHeight
    return { start, end: rect(), contentScrolls, scrollTop: scroll.scrollTop,
      viewportScroll: document.documentElement.scrollHeight - innerHeight,
      sliders: [...document.querySelectorAll('[role="slider"]')].map(el => [el.getAttribute('aria-label'), el.getAttribute('aria-valuetext')]) }
  })
  assert.ok(compact.contentScrolls && compact.scrollTop > 0 && compact.viewportScroll === 0)
  assert.deepEqual(compact.start, compact.end); assert.ok(compact.start[1] >= 24 && compact.start[3] >= 44)
  assert.deepEqual(compact.sliders.map(x => x[0]), ['Shake intensity','Sound effects volume','Music volume'])
  assert.ok(compact.sliders.every(x => /^\d+%$/.test(x[1])))
  await page.focus('[role="slider"][aria-label="Music volume"]')
  const musicBefore = compact.sliders[2][1]
  await page.keyboard.press('ArrowLeft')
  await wait(before => document.querySelector('[role="slider"][aria-label="Music volume"]').getAttribute('aria-valuetext') !== before, musicBefore)
  if (touch) {
    const thumb = '[role="slider"][aria-label="Music volume"]'
    const track = await page.$eval(thumb, el => {
      const track = el.closest('[data-slot="slider"]').querySelector('[data-slot="slider-track"]')
      const r = track.getBoundingClientRect()
      return [r.x + r.width * .42, r.y + r.height / 2]
    })
    await page.touchscreen.tap(...track)
    await wait(sel => /^4[05]%$/.test(document.querySelector(sel).getAttribute('aria-valuetext')), thumb)
  }
  await button('Show FPS')
  await wait(() => window.__sr.renderConfig.showFPS)
  if (dir) await page.screenshot({ path: resolve(dir, `${touch ? 'touch' : 'desktop'}-settings.png`), captureBeyondViewport: false })
  await button('BACK')
  await page.setViewport(viewport)
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
    g.resize()
  })
  await button('ENGAGE'); await phase('playing')
  const sample = async (adaptive) => page.evaluate(adaptive => {
    const g = window.__sr, original = g.bg.getProfile(), route = g.route, scenery = g.bg.scenery
    const wx = g.bg.weatherState().tick, time = g.time
    const hudBacking = [g.hudCtx.canvas.width, g.hudCtx.canvas.height]
    const steps = []
    const off = g.on(e => {
      if (e.type === 'quality') steps.push({ ...e, shadow: g.renderer.features.shadows,
        stableHud: hudBacking[0] === g.hudCtx.canvas.width && hudBacking[1] === g.hudCtx.canvas.height })
    })
    g.scaleControl.interrupt() // clean measurement window
    for (let i = 0; i < 600; i++) g.govern(.025)
    const min = g.dpr
    if (adaptive) for (let i = 0; i < 1600; i++) g.govern(.008)
    off()
    return { min, final: g.dpr, steps, sameRun: original === g.bg.getProfile() && route === g.route && scenery === g.bg.scenery &&
      wx === g.bg.weatherState().tick && time === g.time }
  }, adaptive)
  const locked = await sample(false)
  assert.deepEqual(locked, { min: 1.25, final: 1.25, steps: [], sameRun: true })
  await pause(); await phase('paused'); await button('SETTINGS'); await check('Ultra')
  const renderer = await page.$eval('[data-active-renderer]', el => ({ text: el.textContent.trim(), live: window.__sr.graphicsPresentation() }))
  const label = { 'master-webgl2': 'WebGL2 HDR', 'mobile-webgl2': 'WebGL2 Optimized', 'mobile-canvas': 'Canvas 2D' }[renderer.live.path]
  assert.equal(renderer.text, `Last frame: ${label} · ${renderer.live.backingScale.toFixed(2)}× rendered`)
  await button('Adaptive resolution'); await check('Ultra', 1.25, true)
  await button('BACK'); await button('RESUME'); await phase('playing')
  const adaptive = await sample(true)
  assert.deepEqual(adaptive.steps.map(s => s.scale), [1.15, 1.05, .95, .85, .75, .85, .95, 1.05, 1.15, 1.25])
  assert.ok(adaptive.sameRun && adaptive.steps.every(s => s.active === 'ultra' && s.shadow === 'cast+props' && s.stableHud))
  await pause(); await phase('paused'); await button('SETTINGS')
  await button('Ultra'); await check('Ultra') // picking a preset also locks it

  let pacing
  if (process.argv.includes('--pacing')) {
    await button('BACK'); await button('RESUME'); await phase('playing')
    pacing = await page.evaluate(() => new Promise(done => {
      const g = window.__sr, start = performance.now(), rows = []
      const frame = g.frame.bind(g)
      const scale = g.dpr, seed = g.route.seed, backing = [g.canvas.width, g.canvas.height]
      const insets = { ...g.insets }
      let frames = 0, last = 0, ink = null, initialSnap = g.snapAt, badScale = 0, clears = 0
      const drawText = g.hudCtx.fillText.bind(g.hudCtx), clear = g.hudCtx.clearRect.bind(g.hudCtx)
      g.hudCtx.clearRect = (...box) => { ink = null; clears++; clear(...box) }
      g.hudCtx.fillText = (label, x, y, width) => {
        if (/^\d+ FPS$/.test(label)) ink = { label, x, y, w: width }
        drawText(label, x, y, width)
      }
      g.hud.invalidateLayer?.() // seed the text-position probe on its first frame
      g.player.takeDamage = () => false // isolate presentation under traversal, no resets from a QA death
      g.input.setVirtualAxis(1, 0)
      g.frame = t => {
        const dt = g.lastFrame ? (t - g.lastFrame) / 1000 : 0, before = g.fps
        // The current label persists until a real HUD clear.
        if (frames % 45 === 2) { g.input.setVirtual('light', true); g.input.setVirtual('light', false) }
        frame(t); frames++
        if (g.dpr !== scale || g.canvas.width !== backing[0] || g.canvas.height !== backing[1]) badScale++
        rows.push({ t, dt, before, after: g.fps, shown: g.sampledFps, snap: g.snapAt, x: g.player.x, ink })
        last = t
        if (t - start >= 30_000) {
          g.frame = frame
          g.hudCtx.fillText = drawText
          g.hudCtx.clearRect = clear
          g.input.setVirtualAxis(0, 0)
          done({ rows, frames, clears, initialSnap, badScale, endX: g.player.x, duration: last - start, insets, viewport: [g.cssW, g.cssH], seed, scale, backing })
        }
      }
    }))
    const rows = pacing.rows, stamps = [...new Set(rows.map(r => r.snap))]
    assert.ok(pacing.seed === 42 && pacing.duration >= 30_000 && pacing.scale === 1.25 && pacing.badScale === 0 && pacing.endX > 2000 && pacing.frames > 50, JSON.stringify({ ...pacing, rows: [] }))
    assert.ok(rows.slice(1).every(r => r.dt < .002 || Math.abs(r.after - (.9 * r.before + .1 / r.dt)) < 1e-6))
    assert.ok(stamps.slice(2).every((t, i) => t - stamps[i + 1] >= .25 - 1e-7))
    assert.ok(rows.every(r => r.ink?.label === `${Math.round(r.shown)} FPS` && r.ink.x >= pacing.insets.left + 16 &&
      r.ink.y >= pacing.insets.top + 16 && r.ink.y < Math.min(pacing.viewport[1] - 16, 300)))
    const ms = rows.slice(1).map(r => r.dt * 1000).sort((a, b) => a - b)
    const pct = f => +ms[Math.floor((ms.length - 1) * f)].toFixed(1)
    pacing = { ...pacing, rows: undefined, publishCount: stamps.length, p50: pct(.5), p95: pct(.95), p99: pct(.99),
      worst: pct(1), firstLabel: rows[0].ink, lastLabel: rows.at(-1).ink }
    if (dir) await page.screenshot({ path: resolve(dir, `${touch ? 'touch' : 'desktop'}-fps.png`), captureBeyondViewport: false })
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await wait(() => Boolean(window.__sr?.ctx))
  await button('SETTINGS'); await check('Ultra')
  const persisted = await page.evaluate(() => ({ ...window.__sr.renderConfig, volume: window.__sr.settings.musicVolume }))
  assert.ok(persisted.showFPS)
  return { compact, locked, adaptive, renderer: renderer.text, pacing, persisted }
})
