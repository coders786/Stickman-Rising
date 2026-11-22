/** Exercise real deferred requestRun → playing for Engage + 20 Retries.
 * Uses the bundle fixtures (no UI latency measurements or pixel tracing).
 * SR_SOURCE=src SR_BROWSER_TOOLS=… node .qa/slasher-optics-retries.mjs
 * --combined tests the public run, --station the dry diagnostic; --capture uses portrait.
 * --water-relay verifies the source-driven optics and rejects any scene copy.
 * --baked-practicals verifies the authored material-only path and retained fixture art.
 * --shadow-masks checks the prop-mask dimensions and old backing release.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { build } from 'esbuild'

const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const chromium = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
const station = process.argv.includes('--station')
const combined = process.argv.includes('--combined')
assert.ok(!(station && combined), 'choose one fixture')
const capture = station || process.argv.includes('--capture')
const checkRelay = process.argv.includes('--water-relay')
const checkBaked = combined || process.argv.includes('--baked-practicals')
assert.ok(!(checkRelay && checkBaked), 'choose a single authored optics contract')
const checkMasks = process.argv.includes('--shadow-masks')
const source = resolve(process.env.SR_SOURCE || 'src')
const modern = existsSync(resolve(source, 'game/stage/run-layout.ts'))
assert.ok(!combined || modern, 'combined retries need the run composer')
const from = file => JSON.stringify(resolve(source, file))
const bundle = await build({
  stdin: { contents: `export { Game } from ${from('game/game.ts')};
    export { STATION_ART${modern ? ', BRIDGE_ART' : ''} } from ${from('game/world/art-grade.ts')};
    export { gameLedger } from ${from('game/render/ledger.ts')};`, resolveDir: process.cwd() },
  bundle: true, platform: 'browser', format: 'iife', globalName: 'retryBundle', write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await puppeteer.launch({ executablePath: process.env.SR_BROWSER_EXECUTABLE || await chromium.executablePath(),
  args: [...(chromium?.args ?? []), '--disable-gpu-compositing'], protocolTimeout: 120_000 })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  const viewport = capture ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: 640, height: 360, deviceScaleFactor: 1 }
  await page.setViewport(viewport)
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>#arena{position:fixed;inset:0;overflow:hidden}canvas{position:absolute;inset:0;width:100%;height:100%}</style>
    <div id="arena"><canvas data-render-layer="scene"></canvas><canvas data-render-layer="hud"></canvas></div>`)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const data = await page.evaluate(async ({ station, combined, capture, checkRelay, checkBaked, checkMasks }) => {
    const { Game, STATION_ART, BRIDGE_ART, gameLedger } = window.retryBundle
    const expectedScale = typeof Game.prototype.setDiagnosticRenderScale === 'function' ? 1.25 : 2.25
    const scene = document.querySelector('[data-render-layer=scene]'), hud = document.querySelector('[data-render-layer=hud]')
    // Generation slot names are reused. Track canvas identities and check
    // released backing dimensions rather than treating a reused key as a leak.
    const current = new Map()
    const acquire = gameLedger.acquire.bind(gameLedger), release = gameLedger.release.bind(gameLedger)
    gameLedger.acquire = (key, ...args) => {
      const canvas = acquire(key, ...args)
      current.set(key, canvas)
      return canvas
    }
    gameLedger.release = key => { current.delete(key); return release(key) }
    const g = new Game(combined && !Game.prototype.setDiagnosticRenderScale ? undefined : station ? STATION_ART : BRIDGE_ART,
      combined ? 'combined-run' : undefined)
    g.mount(scene, hud)
    g.applySettings({ ...g.settings, quality: 'ultra', adaptiveQuality: false, muted: true })
    g.renderer.setDesktopLighting(!capture)
    g.qaMode = true
    g.renderer.post.compose = () => { throw new Error('baked stage invoked the scene sample') }
    const rows = [], kitSize = combined ? 5 : checkBaked ? (station ? 8 : 3) : (station ? 12 : 8)
    const lampSprite = () => g.bg.fixtures[1]?.sprite
    let fixedKeys, lamp, recess, strip, fixtures, previousRunCanvases = [], masks = [], sceneSamples = 0, masksReleased = 0
    if (checkBaked) g.bg.drawReflections = () => { throw new Error('authored scene tried to draw a live mirror') }
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    const shape = entries => entries.map(({ key, w, h }) => `${key}:${w}x${h}`).sort().join('|')
    try {
      if (checkRelay || checkBaked) CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
        if (source === scene) sceneSamples++
        return drawImage.call(this, source, ...args)
      }
      for (let i = 0; i <= 20; i++) {
        if (i) g.gameOver()
        const seed = 42 + i
        await new Promise((done, fail) => {
          const timer = setTimeout(() => { off(); fail(new Error(`run ${i} timed out`)) }, 10_000)
          const off = g.on(event => {
            if (event.type === 'error' || event.type === 'phase' && event.phase === 'playing') {
              clearTimeout(timer); off()
              if (event.type === 'error') fail(new Error(`run ${i} failed`))
              else done()
            }
          })
          if (!g.requestRun('katana')) { clearTimeout(timer); off(); fail(new Error('run was not accepted')); return }
          g.pendingRun.seed = seed
        })
        const ledger = gameLedger.list()
        const fixed = ledger.filter(e => e.tag === 'stage-bake')
        if (!i) {
          fixedKeys = shape(fixed)
          lamp = lampSprite()
          recess = g.bg.dryRecess
        }
        if (fixed.length !== kitSize || shape(fixed) !== fixedKeys || lamp !== lampSprite() || recess !== g.bg.dryRecess) {
          throw new Error(`stage art rebuilt on run ${i}`)
        }
        if (checkRelay) {
          const live = ledger.filter(e => e.tag === 'water-relay')
          const canvas = live[0] && current.get(live[0].key)
          if (!i) { strip = canvas; fixtures = g.bg.wetFixtures }
          if (sceneSamples || g.bg.usesWaterRelay() === station || live.length !== (station ? 0 : 1) ||
              canvas !== strip || g.bg.wetFixtures !== fixtures || fixtures.length !== (station ? 0 : 3) ||
              canvas && canvas.height !== 52) throw new Error(`water receiver drift on run ${i}`)
        }
        if (checkMasks) {
          const entries = ledger.filter(e => e.tag === 'silhouette')
          const live = entries.map(e => current.get(e.key))
          if (live.length !== 6 || entries.some(e => e.w !== 76 || e.h !== 88) || live.some(c => !c)) {
            throw new Error(`prop-mask backing shape on run ${i}`)
          }
          for (const c of masks) {
            if (live.includes(c)) continue // warm art may be retained when the mood is the same
            if (c.width || c.height) throw new Error(`retired prop mask on run ${i}`)
            masksReleased++
          }
          masks = live
        }
        if (checkBaked && sceneSamples) throw new Error('authored stage sampled a scene canvas')
        const tags = ['city-scratch', 'post', ...(checkBaked ? ['refl', 'water-relay', 'vignette', 'practical-work'] : []), ...(station ? ['night', 'refl', 'cloudbank'] : checkRelay ? ['refl'] : [])]
        if (ledger.some(e => tags.includes(e.tag)) || previousRunCanvases.some(c => c.width || c.height)) {
          throw new Error(`stale surfaces on run ${i}`)
        }
        previousRunCanvases = ledger.filter(e => ['bake', 'night', 'cloudbank'].includes(e.tag)).map(e => current.get(e.key))
        const stats = gameLedger.stats()
        if (checkBaked && (ledger.some(e => e.tag === 'night' && e.w === 256 && e.h === 64) ||
            ledger.filter(e => e.tag === 'prop' && e.h === 88).length !== 6)) throw new Error('unused mirror art remained resident')
        if (g.bg.getProfile().seed !== seed || g.settings.quality !== 'ultra' || g.dpr !== expectedScale ||
            g.bg.hasWetSurface() === station || station && g.storm.rainScale !== 0) throw new Error(`wrong art or backing on run ${i}`)
        let shelters
        if (combined) {
          const plan = g.bg.runLayout()
          if (plan?.seed !== seed || plan.shelters.length !== 2 || plan.shelters.some(s => g.bg.surfaceWetness((s.left + s.right) / 2) !== 0)) {
            throw new Error(`composition did not reset on run ${i}`)
          }
          shelters = plan.shelters.map(s => [s.kind, s.left, s.right])
          const wx = g.bg.weatherState(), work = g.bg.weatherWork()
          if (wx?.tick !== 0 || wx.seed !== seed || g.storm.rainScale !== 0 || g.bg.lightningI() !== 0 ||
              work.streaks > 180 || work.splashes > 14 || work.wetMarks > 28 || ledger.filter(e => e.tag === 'environment-optional-bank').length > 1) {
            throw new Error(`weather did not reset or stay bounded on run ${i}`)
          }
        }
        rows.push({ seed, surfaces: stats.surfaces, bytes: stats.bytes, peakBytes: stats.peakBytes,
          stageBytes: fixed.reduce((sum, e) => sum + e.bytes, 0), ...(shelters && { shelters }) })
      }
      return { rows, fixedCount: kitSize, scale: expectedScale, scene: [scene.width, scene.height], hud: [hud.width, hud.height],
        peakBytes: gameLedger.stats().peakBytes, sceneSamples, relayStore: strip ? [strip.width, strip.height] : null,
        maskStores: masks.map(c => [c.width, c.height]), masksReleased }
    } finally {
      if (checkRelay || checkBaked) CanvasRenderingContext2D.prototype.drawImage = drawImage
      g.destroy()
      if (masks.some(c => c.width || c.height) || strip && (strip.width || strip.height) || gameLedger.list().length || current.size) {
        throw new Error('destroy did not release canvas backing stores')
      }
    }
  }, { station, combined, capture, checkRelay, checkBaked, checkMasks })
  assert.equal(data.rows.length, 21)
  assert.deepEqual(data.scene, [Math.floor(data.scale * viewport.width), Math.floor(data.scale * viewport.height)])
  assert.deepEqual(data.hud, [viewport.deviceScaleFactor * viewport.width, viewport.deviceScaleFactor * viewport.height])
  assert.deepEqual(errors, [], 'browser/game errors')
  console.log(JSON.stringify({ browser: await browser.version(), station, combined, capture, checkRelay, checkBaked, ...data, afterDestroy: 0 }, null, 2))
} finally { await browser.close() }
