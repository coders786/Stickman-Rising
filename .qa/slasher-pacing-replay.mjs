// A fixed foreground travel workload over real Engage and prepared lighting.
// It reports real rAF gaps, not 1000 / JS time. A separate --profile pass
// times the hot paths and must not be compared with uninstrumented pacing.
import assert from 'node:assert/strict'
import { withBridge, touch } from './bridge-browser.mjs'

const args = process.argv.slice(2), gl = args.includes('--gl'), auto = args.includes('--auto'), prof = args.includes('--profile')
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const quality = option('quality', 'ultra'), fresh = args.includes('--fresh'), small = args.includes('--small')
const samples = Number(process.env.SR_FRAMES ?? 144), warm = Number(option('warm', 36))
assert.ok(Number.isInteger(samples) && samples > 1 && Number.isInteger(warm) && warm > 0)
await withBridge(async ({ page, open, button, phase, wait }) => {
  if (!touch) await page.setViewport({ width: Number(option('width', small ? 544 : gl ? 800 : 1180)), height: Number(option('height', small ? 340 : gl ? 480 : 660)), deviceScaleFactor: 1 })
  if (!fresh) await page.evaluateOnNewDocument(({ quality, auto }) => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality, adaptiveQuality: auto, muted: true, shake: false }))
  }, { quality, auto })
  await open()
  await page.evaluate(gl => {
    const g = window.__sr
    if (gl) g.allowDiagnosticMaster()
    g.on(e => {
      if (e.type === 'phase' && e.phase === 'preparing') g.pendingRun.seed = 42
      if (e.type === 'phase' && e.phase === 'playing') queueMicrotask(() => cancelAnimationFrame(g.raf))
    })
  }, gl)
  await button('ENGAGE'); await phase('playing')
  await wait(() => !document.querySelector('.sr-ronin-reveal'))
  const result = await page.evaluate(async ({ samples, prof, warm, fresh, small }) => {
    const g = window.__sr, sky = g.bg.scenery.sky, stream = g.bg.bridgeStream()
    // Sample the same traversal at the same weather tick and actor pose
    // regardless of how many wall seconds the sandbox takes to present it.
    cancelAnimationFrame(g.raf)
    g.qaMode = true; g.enemies.length = 0; g.fx.clear()
    g.player.reset(660); g.cam.startOnRoad(660); g.bg.advanceActiveTicks(260, 1)
    const start = g.player.x, stamps = new Float64Array(samples), submit = new Float64Array(samples)
    const marks = Object.fromEntries(performance.getEntriesByType('mark').filter(m => m.name.startsWith('sr:')).map(m => [m.name, m.startTime]))
    const spans = {}, row = {}
    const watch = (owner, keys, prefix) => {
      if (!owner) return
      for (const key of keys) {
        const orig = owner[key]
        if (typeof orig !== 'function') continue
        const tag = prefix + key; spans[tag] = []
        owner[key] = function (...args) { const t = performance.now(); try { return orig.apply(this, args) } finally { row[tag] = (row[tag] ?? 0) + performance.now() - t } }
      }
    }
    if (prof) {
      watch(g, ['paint', 'step', 'prepareRunFrame', 'buildHudState'], 'game.')
      watch(sky, ['draw', 'mist', 'city', 'life', 'detail'], 'sky.')
      watch(g.bg, ['drawArena', 'drawRouteExterior', 'drawRouteWeather', 'drawBridgeWater', 'drawNearRain', 'drawBridgeBackdrop'], 'bg.')
      watch(g.hud, ['draw', 'drawLayer'], 'hud.')
      watch(g.renderer.glass, ['draw', 'finish', 'finishTile'], 'glass.')
      watch(g.renderer.bridgeField, ['gather', 'gatherBlockers'], 'field.')
      watch(g.renderer.bridgeFinish?.pipe, ['present', 'advanceSky', 'advanceTransport', 'uploadLayers', 'bloom', 'gradeWorld'], 'gpu.')
    }
    const sizes = new Set(), paths = new Set(), epoch = performance.now(), long = []
    let hidden = document.hidden
    const visibility = () => { if (document.hidden) hidden = true }
    document.addEventListener('visibilitychange', visibility)
    const observer = new PerformanceObserver(list => long.push(...list.getEntries().map(e => e.duration)))
    observer.observe({ type: 'longtask' })
    const realClock = g.settings.adaptiveQuality || fresh
    let i = 0, last = 0
    g.lastFrame = epoch; g.input.setVirtualAxis(1, 0)
    await new Promise((resolve, reject) => {
      function frame(now) {
        try {
          for (const key in spans) row[key] = 0
          const before = performance.now()
          if (!realClock) g.frame(epoch + (i + 1) * 1000 / 60)
          else g.frame(now)
          const ms = performance.now() - before
          if (i >= warm) {
            stamps[i - warm] = now - last; submit[i - warm] = ms
            for (const key in spans) spans[key].push(row[key])
          }
          sizes.add(`${g.canvas.width}×${g.canvas.height}`); paths.add(g.renderer.bridgePath)
          last = now
          if (++i >= warm + samples) resolve()
          else requestAnimationFrame(frame)
        } catch (e) { reject(e) }
      }
      requestAnimationFrame(frame)
    })
    observer.disconnect(); g.input.setVirtualAxis(0, 0)
    document.removeEventListener('visibilitychange', visibility)
    const stats = xs => { const sorted = [...xs].sort((a, b) => a - b), at = p => sorted[Math.ceil(sorted.length * p) - 1];
      return { p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1), mean: sorted.reduce((a, b) => a + b, 0) / sorted.length } }
    const pace = stats(stamps), state = g.graphicsPresentation(), playerX = g.player.x
    const resources = performance.getEntriesByType('resource').map(e => ({ file: new URL(e.name).pathname, encoded: e.encodedBodySize, decoded: e.decodedBodySize }))
    const streamReceipt = stream.receipt(), frameErrors = g.frameErrors
    g.destroy()
    return { viewport: [innerWidth, innerHeight, devicePixelRatio], frames: samples, quality: g.settings.quality, adaptive: g.settings.adaptiveQuality, realClock, hidden,
      fps: 1000 / pace.mean, raf: pace, js: stats(submit), over33: stamps.filter(x => x > 33.9).length, over50: stamps.filter(x => x > 50).length, over250: stamps.filter(x => x > 250).length,
      long, sizes: [...sizes], paths: [...paths], start, playerX, fresh, small, timings: Object.fromEntries(Object.entries(spans).map(([k, v]) => [k, stats(v)])),
      prepareMs: marks['sr:run-submit'] - marks['sr:engage'], readyMs: marks['sr:ready'], state, stream: streamReceipt,
      surfaceCount: g.resourceSnapshot().surfaces, frameErrors, resources }
  }, { samples, prof, warm, fresh, small })
  assert.equal(result.hidden, false, 'pacing fixture lost foreground visibility')
  assert.equal(result.frameErrors, 0)
  assert.equal(result.surfaceCount, 0)
  assert.equal(result.state.frame.kind, gl ? 'webgl' : 'canvas')
  assert.ok(result.playerX > result.start + Math.min(180, samples + warm), 'replay did not travel')
  return result
})
