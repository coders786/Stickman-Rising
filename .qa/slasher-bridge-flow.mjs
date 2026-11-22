/** Matched production capture/foreground timing, against either build.
 * SwiftShader is not a device GPU benchmark; no reads or screenshots in the timing loop. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { viewport, withBridge } from './bridge-browser.mjs'

const shots = process.env.SR_SHOTS
const n = Number(process.env.SR_FRAMES ?? 18)
assert.ok(Number.isInteger(n) && n >= 6 && n <= 120)
const canvas = process.argv.includes('--canvas')
const mobile = process.argv.includes('--optimized')
const path = canvas ? 'mobile-canvas' : mobile ? 'mobile-webgl2' : 'master-webgl2'
if (shots) await mkdir(shots, { recursive: true })
await withBridge(async ({ page, open, phase, button, wait }) => {
  await page.setViewport({ ...viewport, width: 848, height: 520 })
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true, showFps: false }))
    const longTasks = window.flowLongTasks = []
    new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => [e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true })
  })
  await open()
  await page.evaluate(({ canvas, mobile }) => {
    const g = window.__sr, request = g.requestRun.bind(g)
    if (!canvas) g.allowDiagnosticMaster()
    if (mobile) g.preferDiagnosticMobile()
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = g.pendingRun.returnTo === 'gameover' ? 43 : 42; return ok }
    window.flowRuns = []
    g.on(e => {
      if (e.type !== 'phase') return
      if (e.phase === 'preparing') window.flowRuns.push({ t: performance.now(), legacyMs: 0 })
      if (e.phase === 'playing') {
        const r = window.flowRuns.at(-1)
        r.ready = performance.now() - r.t; r.seed = g.route.seed
      }
    })
    const create = g.bg.createNightForSeed.bind(g.bg)
    g.bg.createNightForSeed = seed => {
      const night = create(seed), run = window.flowRuns.at(-1)
      if (night && run) {
        const orig = night.warmDeferred.bind(night)
        night.warmDeferred = async (...args) => {
          const t = performance.now(); await orig(...args); run.legacyMs = performance.now() - t
        }
      }
      return night
    }
    const paint = g.paint.bind(g)
    g.paint = (...args) => {
      const t = performance.now(); paint(...args)
      const run = window.flowRuns.at(-1)
      if (g.phase === 'preparing' && run && !run.firstPaintMs) run.firstPaintMs = performance.now() - t
      if (!run || !['preparing', 'playing'].includes(g.phase)) return
      const stream = g.bg.bridgeStream(), pipe = g.renderer.bridgeFinish.pipe
      if (stream.window?.seed === g.route.seed && !run.window) run.window = performance.now() - run.t
      if (stream.plate(g.route.at(g.cam.x).index, !g.renderer.bridgeFinish.visible) && !run.plate) run.plate = performance.now() - run.t
      if (pipe?.transportWindow(g.route.seed) && !run.commit) run.commit = performance.now() - run.t
    }
  }, { canvas, mobile })
  await button('ENGAGE'); await phase('playing')
  await wait(path => {
    const r = window.flowRuns.at(-1)
    return r.window && r.plate && (path === 'mobile-canvas' || r.commit)
  }, path)
  const { png, ...report } = await page.evaluate(async ({ n, path, save }) => {
    const g = window.__sr, { cam, player: p, fx } = g, f = g.renderer.bridgeField
    const weather = g.bg.routeWeather.clock.sample, png = {}
    cancelAnimationFrame(g.raf); g.qaMode = true; g.enemies.length = g.props.props.length = 0
    fx.clear(); g.projectiles.clear(); g.hitstopT = 0; g.banner = null; g.streamQuiet = true
    let clock = 30
    g.bg.routeTime = () => clock; g.bg.routeDrift = () => 16; g.bg.lightningI = () => 0
    Object.assign(weather, { fog: .28, cloud: .18, key: 1, wet: .9, rain: .30 })
    const pipe = g.renderer.bridgeFinish.pipe
    const draw = () => { g.paint(0, false); if (g.graphicsPresentation().path !== path) throw Error('Wrong renderer') }
    const shot = name => { if (save) png[name] = (pipe?.canvas ?? g.canvas).toDataURL('image/png').split(',')[1] }
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const pose = x => { p.reset(x); cam.startOnRoad(x) }
    const stage = async x => {
      pose(x); const t = performance.now()
      for (;;) {
        draw()
        const s = g.bg.bridgeStream(), w = s.window
        const v = f.view, visible = [...g.route.between(v.left, v.right)]
        if (w && v.left > w.origin && v.right < w.origin + w.width && (pipe ? pipe.transportWindow(42) === w : true) &&
            visible.every(c => s.plate(c.index, !pipe))) break
        if (performance.now() - t > 60_000) throw Error(`Window did not stage at ${x}`)
        await frame()
      }
      return performance.now() - t
    }
    const reach = await stage(1150) // 91 m, opening concourse + BLAST sign
    draw(); shot('91m')
    const ground = { player: [p.x, p.y, p.floorY], head: g.project(p.x + p.face * p.scale * p.geom.headC.x, p.hipY + p.scale * p.geom.headC.y), sole: g.project(p.x, p.y), rail: { ...g.bg.scenery.rail.last } }
    const t0 = g.time
    p.doJump(g.worldRef)
    for (let i = 0; i < 24; i++) { g.time += 1/120; p.update(1/120, g.worldRef); g.updateCamera(1/120) }
    draw(); shot('91m-jump')
    const airborne = { player: [p.x, p.y, p.floorY], head: g.project(p.x + p.face * p.scale * p.geom.headC.x, p.hipY + p.scale * p.geom.headC.y), sole: g.project(p.x, p.y), rail: { ...g.bg.scenery.rail.last } }
    g.time = t0
    await stage(3070)
    if (pipe) {
      // Do not benchmark delayed first-use texture uploads or compare an
      // uncommitted scene against a fully resident one. Keep streaming
      // deadlines separate in `boot.runs`.
      const t = performance.now()
      for (;;) {
        const gpu = pipe.receipt()
        const transport = pipe.transportWindow(42), stream = g.bg.bridgeStream().window
        if (transport === stream && !gpu.transport.uploadThisFrame && !gpu.transport.staging && gpu.packedAssets.city === 'shared-webp') break
        if (performance.now()-t > 50_000) throw Error('First-use upload timeout: ' + JSON.stringify(gpu))
        await frame(); draw()
      }
    }
    // Match event-relative passes, irrespective of schedule implementation.
    const rail = g.bg.scenery.rail, timetable = rail.schedule, trains = []
    for (const dir of [1, -1]) {
      const e = timetable.events.find(e => e.dir === dir)
      const t = timetable.crossingTime?.(e, cam.x) ?? timetable.offset + e.at + Math.sin(cam.x * .32 / 420) * 420 * dir / e.speed
      clock = t + .26
      draw(); shot(dir === 1 ? 'eastbound' : 'westbound'); trains.push({ ...rail.last })
    }
    clock = 30
    const stats = a => { a.sort((x,y) => x-y); const at = q => +a[Math.floor((a.length - 1)*q)].toFixed(2); return { median: at(.5), p95: at(.95) } }
    const samples = { calm: { submit: [], gaps: [] }, busy: { submit: [], gaps: [] } }
    const bench = async (heavy, count) => {
      fx.clear(); clock = 30
      const rand = Math.random; Math.random = () => .357
      try {
        if (heavy) for (let i = 0; i < 4; i++) fx.impact(p.x - 95 + 61*i, -35 - 11*i, .85, true, ['#ff835e','#41ebff','#dcbaec','#ffe7b4'][i], '#e7c3a4')
      } finally { Math.random = rand }
      for (let i = 0; i < 3; i++) { await frame(); draw() }
      const row = samples[heavy ? 'busy' : 'calm']
      let prev = await frame()
      for (let i = 0; i < count; i++) {
        const t = performance.now(); clock += 1/60; draw(); row.submit.push(performance.now()-t)
        const now = await frame(); row.gaps.push(now-prev); prev = now
      }
      row.impulses = f.impulseCount; row.lights = f.count
    }
    g.streamQuiet = false
    for (const [first, last, count] of [[false, true, Math.floor(n/2)], [true, false, Math.ceil(n/2)]]) {
      await bench(first, count); await bench(last, count)
    }
    if (save) { await bench(true, 0); draw(); shot('heavy') }
    g.streamQuiet = true
    fx.clear()
    const measure = ({ submit, gaps, impulses, lights }) => ({ n: gaps.length, submitMs: stats(submit), rafMs: stats(gaps), impulses, lights, path })
    const calm = measure(samples.calm), busy = measure(samples.busy)
    return { reach, ground, airborne, trains, calm, busy, gpu: pipe?.receipt() ?? null, worker: g.bg.bridgeStream().receipt(), png }
  }, { n, path, save: !!shots })
  await page.evaluate(() => { const g = window.__sr; g.gameOver(); g.raf = requestAnimationFrame(g.loop) })
  await button('RETRY'); await phase('playing')
  await wait(path => { const r = window.flowRuns.at(-1); return r.window && r.plate && (path === 'mobile-canvas' || r.commit) }, path)
  const boot = await page.evaluate(() => {
    const { flowRuns: runs, flowLongTasks: longTasks } = window
    const assets = performance.getEntriesByType('resource').filter(r => r.name.includes('/bridge/')).map(r => [new URL(r.name).pathname, r.encodedBodySize, r.decodedBodySize])
    for (const r of runs) r.maxLong = Math.max(0, ...longTasks.filter(([t]) => t >= r.t - 3 && t < r.t + r.ready).map(([,ms]) => ms))
    const g = window.__sr; g.destroy()
    return { runs, assets, surfaces: g.resourceSnapshot().surfaces }
  })
  if (shots) for (const [name, b64] of Object.entries(png)) await writeFile(resolve(shots, `${name}.png`), Buffer.from(b64, 'base64'))
  assert.deepEqual(boot.runs.map(r => r.seed), [42, 43])
  assert.equal(report.busy.impulses, path === 'master-webgl2' ? 3 : 1)
  assert.ok(report.trains.every(r => r.bodies > 0))
  assert.equal(boot.surfaces, 0)
  return { ...report, boot }
})
