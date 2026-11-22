/** Same-frame ablation of an exposed grate's dry steam. Run with --canvas
 * and SR_SOFTWARE=1 for the direct painter, or default for Master. */
import assert from 'node:assert/strict'
import { withBridge, viewport } from './bridge-browser.mjs'

const canvas = process.argv.includes('--canvas')
await withBridge(async ({ page, open, button, phase, wait }) => {
  const path = canvas ? 'mobile-canvas' : 'master-webgl2'
  await page.setViewport({ ...viewport, width: 716, height: 466 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true, shake: false,
  })))
  await open()
  await page.evaluate(canvas => {
    const g = window.__sr, request = g.requestRun.bind(g)
    if (!canvas) g.allowDiagnosticMaster()
    g.setDiagnosticRenderScale(1)
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  }, canvas)
  await button('ENGAGE'); await phase('playing')
  await wait(path => window.__sr.worldSubmit.kind !== 'starter' && window.__sr.graphicsPresentation().path === path, path)
  const report = await page.evaluate(async ({ canvas, path }) => {
    const g = window.__sr, frame = g.renderer.bridgeField, routeWeather = g.bg.routeWeather
    cancelAnimationFrame(g.raf); g.qaMode = true; g.enemies.length = 0; g.fx.clear(); g.projectiles.clear(); g.hitstopT = 0
    const x = 9678, outlet = 43 // Seed 42, Market Overpass, front grate.
    g.player.reset(x - 96); g.cam.startOnRoad(x)
    routeWeather.advance(780, 1)
    const sample = routeWeather.clock.sample
    Object.assign(sample, { rain: 0, wet: 0, fog: .38, cloud: .21 })
    g.bg.lightningI = () => 0
    const pipe = g.renderer.bridgeFinish.pipe
    const paint = () => {
      if (!g.paint(0, false) || g.graphicsPresentation().path !== path) throw Error(`Lost ${path}`)
    }
    const t = performance.now()
    do {
      paint()
      const w = g.bg.bridgeStream().window
      if (w && w.origin < x && w.origin + w.width > x && (!pipe || pipe.transportWindow(42) === w && pipe.skyFrame)) break
      if (performance.now() - t > 50_000) throw Error('Market transport did not settle')
      await new Promise(r => setTimeout(r, 20))
    } while (true)
    g.streamQuiet = false
    const roi = () => {
      const out = pipe?.canvas ?? g.canvas, dx = out.width / g.cssW, dy = out.height / g.cssH
      const a = g.project(x - 25, outlet - 82), b = g.project(x + 45, outlet + 3)
      const l = Math.floor(a.x * dx), y = Math.floor(a.y * dy), w = Math.ceil(b.x * dx) - l, h = Math.ceil(b.y * dy) - y
      if (!pipe) return g.ctx.getImageData(l, y, w, h).data
      const gl = pipe.gl, rgba = new Uint8Array(w * h * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(l, out.height - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      return rgba
    }
    const state = () => ({ rain: frame.rain, rainStrokes: routeWeather.work.streaks,
      instances: pipe?.rainInstances ?? 0, motes: pipe?.moteInstances ?? 0, x: frame.vents[0] + frame.cam.x,
      y: frame.vents[1], count: frame.ventCount })
    const vents = routeWeather.vents.bind(routeWeather), gather = frame.gather.bind(frame)
    let suppress = false, painted = 0
    routeWeather.vents = (...args) => {
      if (suppress) return
      painted++; return vents(...args)
    }
    frame.gather = (...args) => { gather(...args); if (suppress) frame.ventCount = 0 }
    paint(); const dry = state(), withVent = roi()
    suppress = true; paint(); const without = roi()
    let changed = 0, peak = 0
    for (let i = 0; i < without.length; i += 4) {
      const d = Math.abs(withVent[i] - without[i]) + Math.abs(withVent[i + 1] - without[i + 1]) + Math.abs(withVent[i + 2] - without[i + 2])
      changed += +(d > 4); peak = Math.max(peak, d)
    }
    suppress = false; sample.rain = .72; sample.wet = .83; paint(); const shower = state()
    const before = painted
    g.applyMotionPreference(true); paint(); const quiet = { ...state(), ventPaints: painted - before }
    const tick = routeWeather.clock.sample.tick
    g.pause(); g.frame(g.lastFrame + 200); const paused = routeWeather.clock.sample.tick
    const errors = pipe?.gl.getError() ?? 0
    g.destroy()
    return { canvas, path, dry, shower, quiet, changed, peak, tick, paused, errors }
  }, { canvas, path })
  assert.ok(report.changed > 6 && report.peak > 7, JSON.stringify(report))
  assert.equal(report.dry.rain, 0)
  assert.equal(report.dry.rainStrokes + report.dry.instances, 0)
  assert.ok(report.shower.rain > .58 && report.shower.rainStrokes + report.shower.instances > 0)
  if (!canvas) assert.deepEqual([report.dry.x, report.dry.y, report.dry.count, report.dry.motes], [9678, 43, 1, 84])
  assert.deepEqual([report.quiet.count, report.quiet.motes, report.quiet.ventPaints, report.paused, report.errors], [0, 0, 0, report.tick, 0])
  return report
})
