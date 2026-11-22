// Matched, production-rendered frames. Run on the control and on each
// candidate with the same flags. Pixel reads and pose/weather overrides
// are QA only; the game has no compare mode or ablation switches.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { touch, viewport, withBridge } from './bridge-browser.mjs'

const canvas = process.argv.includes('--canvas')
const optimized = !canvas && (touch || process.argv.includes('--optimized'))
const deny = process.argv.includes('--deny-art'), verify = process.argv.includes('--verify')
const cityWeather = process.argv.includes('--city-weather')
const scenes = process.argv.find(arg => arg.startsWith('--scenes='))?.slice(9).split(',') ?? ['metro', 'market', 'garden']
const path = canvas ? 'mobile-canvas' : optimized ? 'mobile-webgl2' : 'master-webgl2'
const shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })

await withBridge(async ({ page, open, button, phase, wait, frames }) => {
  if (!touch) await page.setViewport({ ...viewport, width: 1000, height: 625 })
  if (deny) {
    await page.setRequestInterception(true)
    page.on('request', r => /\/bridge\/l[12]\.webp$/.test(r.url()) ? r.respond({ status: 404 }) : r.continue())
  }
  await page.evaluateOnNewDocument(deny => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true, shake: false, showFps: false }))
    if (deny) {
      window.Worker = new Proxy(window.Worker, { construct(Worker, args) {
        if (args[1]?.name?.startsWith('bridge-')) throw new DOMException('QA worker unavailable', 'SecurityError')
        return new Worker(...args)
      } })
    }
  }, deny)
  await open()
  const build = await page.evaluate(() => [...document.scripts].map(s => s.src.split('/').at(-1)).filter(Boolean))
  await page.evaluate(({ canvas, optimized }) => {
    const game = window.__sr, request = game.requestRun.bind(game)
    if (!canvas) game.allowDiagnosticMaster()
    if (optimized) game.preferDiagnosticMobile()
    game.requestRun = sword => { const ok = request(sword); if (ok) game.pendingRun.seed = 42; return ok }
  }, { canvas, optimized })
  await button('ENGAGE'); await phase('playing'); await frames()
  await wait(path => window.__sr.graphicsPresentation().path === path && !document.querySelector('.sr-ronin-reveal'), path)
  await page.evaluate(({ path, deny, touch }) => {
    const g = window.__sr, { player: p, cam, renderer } = g, field = renderer.bridgeField
    const pipe = renderer.bridgeFinish.pipe, weather = g.bg.routeWeather.clock.sample
    cancelAnimationFrame(g.raf); g.qaMode = true; g.streamQuiet = true
    g.enemies.length = g.props.props.length = 0
    g.fx.clear(); g.projectiles.clear(); g.banner = null; g.hitstopT = 0
    if (g.pickups) g.pickups.draw = () => {}
    g.time = g.renderTime = 8.75; g.bg.routeTime = () => 28; g.bg.routeDrift = () => 12; g.bg.lightningI = () => 0
    const metro = g.route.chunk(0).shelter, garden = g.route.chunk(12).platform
    const scene = {
      metro: { x: metro.left + 137, cx: metro.left + (touch ? 122 : 63), y: 0, cy: touch ? -91 : -120, threat: metro.left + 225 },
      market: { x: 6434, cx: touch ? 6450 : 6460, y: 0, cy: touch ? -89 : -112, threat: 6517 },
      garden: { x: garden.right - 70, cx: garden.right - (touch ? 38 : 16), y: garden.y, cy: touch ? -160 : -185, threat: garden.right - 152 },
    }
    const paint = () => {
      if (!g.paint(0, false) || g.graphicsPresentation().path !== path) throw Error(`Wrong renderer: ${JSON.stringify(g.graphicsPresentation())}`)
    }
    const output = () => pipe?.canvas ?? g.canvas
    const pixels = (left, top, width, height) => {
      if (!pipe) return g.ctx.getImageData(left, top, width, height).data
      const { gl } = pipe, a = new Uint8Array(width * height * 4), stride = width * 4
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(left, output().height - top - height, width, height, gl.RGBA, gl.UNSIGNED_BYTE, a)
      const topDown = new Uint8Array(a.length)
      for (let n = 0; n < height; n++) topDown.set(a.subarray(n * stride, (n + 1) * stride), (height - 1 - n) * stride)
      return topDown
    }
    const rect = (left, top, right, bottom) => {
      const c = output(), a = g.project(left, top), b = g.project(right, bottom)
      return [Math.max(0, Math.floor(a.x * c.width / g.cssW)), Math.max(0, Math.floor(a.y * c.height / g.cssH)),
        Math.min(c.width, Math.ceil(b.x * c.width / g.cssW)), Math.min(c.height, Math.ceil(b.y * c.height / g.cssH))]
    }
    const patch = box => {
      const [l, t, r, b] = box
      if (l >= r || t >= b) return
      return pixels(l, t, r - l, b - t)
    }
    const luma = (a, i) => .2126 * a[i] + .7152 * a[i + 1] + .0722 * a[i + 2]
    const delta = (a, b) => {
      if (!a || !b) return null
      assertDims(a, b)
      let mean = 0, magnitude = 0, changed = 0, darker = 0, brighter = 0
      for (let i = 0; i < a.length; i += 4) {
        const d = luma(b, i) - luma(a, i)
        mean += d; magnitude += Math.abs(d); changed += +(Math.abs(d) >= 3); darker += +(d <= -3); brighter += +(d >= 3)
      }
      const size = a.length / 4, f = n => +(n / size).toFixed(4)
      return { mean: f(mean), magnitude: f(magnitude), changed: f(changed), darker: f(darker), brighter: f(brighter), size }
    }
    function assertDims(a, b) { if (a.length !== b.length || a.length === 0) throw Error('Unmatched patch') }
    const road = name => {
      // No foreground props or actor soles in these measurement strips.
      const x = scene[name].x
      return [rect(name === 'metro' ? metro.left - 82 : x - 120, 18, name === 'metro' ? metro.left - 23 : x + 120, 38),
        name === 'metro' ? rect(metro.left + 58, 18, metro.right - 53, 38) : null]
    }
    const roadPatch = boxes => boxes.map(box => box ? patch(box) : undefined)
    const weatherAt = wet => { weather.wet = wet; paint() }
    const detail = fractions => {
      const c = output(), box = fractions.map((v, i) => Math.round(v * (i % 2 ? c.height : c.width)))
      const [l, t, r, b] = box, width = r - l, height = b - t, pixels = patch(box)
      let mean = 0, adjacent = 0, edges = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, v = luma(pixels, i)
        mean += v
        if (x + 1 < width) { adjacent += Math.abs(v - luma(pixels, i + 4)); edges++ }
        if (y + 1 < height) { adjacent += Math.abs(v - luma(pixels, i + width * 4)); edges++ }
      }
      return { box, mean: +(mean / (width * height)).toFixed(4), adjacent: +(adjacent / edges).toFixed(4) }
    }
    // A second portrait framing includes the apron and the eave while
    // leaving the matched actor shot at its original camera.
    const exposureCam = name => touch && name === 'metro' ? metro.left + 34 : scene[name].cx
    const cityBoxes = touch ? {
      metro: { city: [.018, .277, .24, .49], glass: [.52, .325, .94, .41] },
      market: { city: [.14, .282, .214, .479], glass: [.29, .302, .70, .394] },
    } : {
      metro: { city: [.012, .307, .045, .548], glass: [.455, .357, .645, .456] },
      market: { city: [.016, .304, .222, .544], glass: [.433, .336, .714, .448] },
    }
    const fogAt = name => name === 'metro' ? .30 : name === 'market' ? .33 : .26
    window.visualRulesQA = {
      async place(name) {
        const { x, cx, y, cy, threat } = scene[name]
        const wet = name === 'metro' ? .24 : name === 'market' ? 0 : .36
        Object.assign(weather, { wet, rain: 0, fog: fogAt(name), cloud: .34, key: 1 })
        Object.assign(g.stats, { distanceMetres: Math.max(0, Math.floor((x - 240) / 10)) })
        p.reset(x); p.y = p.prevY = p.floorY = y
        cam.startOnRoad(cx); Object.assign(cam, { x: cx, y: cy, zoom: touch ? 1.53 : 1.22, rot: 0, offX: 0, offY: 0 })
        if (name === 'metro') g.bg.syncCutaway(x, y, 1)
        g.enemies.length = 0; g.debugSpawn('grunt', threat)
        const e = g.enemies[0]; e.arriveOnRoute(threat > x ? -1 : 1)
        e.y = e.py = e.floorY = y; e.state = 'windup'; e.stateT = .25; e.buildPose(0, 0); e.projectPose?.()
        const scale = g.dpr
        if (pipe) g.setDiagnosticRenderScale(1) // stage uploads without full-scale software GL
        const until = performance.now() + 90_000
        for (;;) {
          paint()
          const stream = g.bg.bridgeStream(), w = field.probeWindow
          const resident = w && field.view.left >= w.origin && field.view.right <= w.origin + w.width
          if (deny || resident && (pipe ? pipe.transportWindow(42) === w && pipe.receipt().stratumA.live : stream.plate(g.route.at(x).index, true))) break
          if (performance.now() > until) throw Error(`No settled optical coverage for ${name}: ${JSON.stringify({
            view: field.view, stream: stream.receipt(), sourceWindow: [stream.window?.id, stream.window?.origin, stream.window?.width],
            probeWindow: [w?.id, w?.origin, w?.width], quiet: field.uploadQuiet, basis: !!field.atmo.basis,
            currentPipeline: pipe === renderer.bridgeFinish.pipe, gpu: pipe?.receipt(),
          })}`)
          await new Promise(r => setTimeout(r, 20))
        }
        if (pipe) g.setDiagnosticRenderScale(scale)
        paint(); paint()
        return { pose: [p.x, p.y], camera: [cam.x, cam.y, cam.zoom], css: [g.cssW, g.cssH], backing: [output().width, output().height],
          weather: { wet: field.wet, fog: field.fog, rain: field.rain }, frame: g.graphicsPresentation().frame,
          buildWindowOrigin: field.probeWindow?.origin ?? null, sky: !!pipe?.receipt().stratumA?.live,
          draws: pipe?.receipt().frameDraws ?? null }
      },
      actor(name) {
        const { x, y } = scene[name], box = rect(x - 45, y - 97, x + 45, y - 3)
        const real = p.draw
        paint() // the GL default buffer is invalid after a browser presentation
        const before = patch(box)
        paint()
        const noop = delta(before, patch(box))
        const light = renderer.probes.get(p)
        const taps = light?.local?.map(({ sky, lunar, fixtures }) => ({ sky, lunar, brightest: Math.max(...fixtures.map(f => f.strength)) }))
        try { p.draw = () => {}; paint(); return { ...delta(patch(box), before), noop, taps } }
        finally { p.draw = real; paint() }
      },
      water(name) {
        const original = weather.wet
        cam.x = exposureCam(name)
        try {
          const boxes = road(name)
          weatherAt(0); const dry = roadPatch(boxes)
          weatherAt(.94); const wet = roadPatch(boxes)
          return { cameraX: cam.x, exposed: delta(dry[0], wet[0]), covered: delta(dry[1], wet[1]) }
        } finally { cam.x = scene[name].cx; weatherAt(original) }
      },
      haze(name, fog) {
        cam.x = fog === null ? scene[name].cx : exposureCam(name)
        weather.fog = fog ?? fogAt(name)
        paint(); paint() // include the Optimized half-rate sky update
        if (fog === null) return
        return { cameraX: cam.x, fog: field.fog, haze: field.atmo.air[1], city: detail(cityBoxes[name].city), glass: detail(cityBoxes[name].glass) }
      },
      wet() { weatherAt(.94); return field.wet },
    }
  }, { path, deny, touch })
  const stats = {}
  const capture = async (name) => {
    if (!shots) return
    await frames()
    const png = await page.screenshot({ captureBeyondViewport: false })
    await writeFile(join(shots, `${name}.png`), png)
  }
  for (const name of scenes) {
    stats[name] = await page.evaluate(name => window.visualRulesQA.place(name), name)
    assert.equal(stats[name].frame.seed, 42)
    assert.equal(stats[name].frame.kind, canvas ? 'canvas' : 'webgl')
    await capture(name === 'market' ? 'market-dry' : name)
    stats[name].actor = await page.evaluate(name => window.visualRulesQA.actor(name), name)
    if (name !== 'garden') stats[name].water = await page.evaluate(name => window.visualRulesQA.water(name), name)
    if (verify) {
      const { water, actor } = stats[name]
      assert.ok(actor.noop?.magnitude < .05 && actor.noop.changed < .005, `${name}: frozen actor read drifted ${JSON.stringify(actor.noop)}`)
      assert.ok(actor.changed > .05, `${name}: no actor contrast`)
      if (name === 'metro') assert.ok(water.covered?.magnitude < .05 && water.covered.changed < .005, `${name}: wet pixels crossed the eave or crop is missing ${JSON.stringify(water)}`)
      if (water) assert.ok(water.exposed?.mean < -.8 && water.exposed.darker > .20, `${name}: no rain darkening ${JSON.stringify(water)}`)
    }
    if (cityWeather && name !== 'garden') {
      const air = stats[name].air = {}
      for (const [key, fog] of [['clear', .08], ['haze', .86]]) {
        air[key] = await page.evaluate(([name, fog]) => window.visualRulesQA.haze(name, fog), [name, fog])
        await capture(`${name}-${key}`)
      }
      await page.evaluate(name => window.visualRulesQA.haze(name, null), name)
      if (verify) {
        assert.ok(air.haze.haze > air.clear.haze + .7 && air.haze.cameraX === air.clear.cameraX, 'city weather fixture did not select a second grade')
        assert.ok(air.haze.city.adjacent < air.clear.city.adjacent * .95, `${name}: haze did not soften the city ${JSON.stringify(air)}`)
        assert.ok(air.haze.glass.adjacent > air.clear.glass.adjacent * .8, `${name}: haze flattened the near glass ${JSON.stringify(air)}`)
      }
    }
    if (name === 'market') {
      stats[name].soaked = await page.evaluate(() => window.visualRulesQA.wet())
      await capture('market-wet')
    }
  }
  return { path, deny, build, stats }
})
