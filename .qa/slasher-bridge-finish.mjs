/** Runs against the production preview. Exercises the output lifecycle using
 * real WebGL2 loss/restore; --deny=float|surface|master-surface|auto covers admission.
 * --wide-cap exceeds the Master limit with a wider, cheaper Optimized backing
 * for software QA. --context-only checks loss/restore; --road-only isolates
 * the Optimized wetness/edge resolve at the same final aperture. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { withBridge, viewport, useCompactGL } from './bridge-browser.mjs'

const direct = process.argv.includes('--direct')
const legacyGraph = process.argv.includes('--legacy-graph')
const shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })
const compact = process.argv.includes('--compact')
const denial = process.argv.find(x => x.startsWith('--deny='))?.slice(7) ?? ''
const pending = process.argv.includes('--pending')
const v4 = process.argv.includes('--v4'), wideCap = process.argv.includes('--wide-cap')
const contextOnly = process.argv.includes('--context-only'), roadOnly = process.argv.includes('--road-only')
assert.ok(['', 'float', 'surface', 'master-surface', 'auto'].includes(denial))
assert.ok([!!denial, pending, contextOnly, roadOnly].filter(Boolean).length <= 1)
assert.ok(!direct || !pending && !denial)
await withBridge(async ({ page, open, button, phase, wait, frames }) => {
  await page.setViewport({ ...viewport, ...(roadOnly ? { width: 700, height: 448 } : { width: 736, height: 470 }) })
  await page.evaluateOnNewDocument(mode => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true }))
    if (mode === 'float') {
      const request = WebGL2RenderingContext.prototype.getExtension
      WebGL2RenderingContext.prototype.getExtension = function (name) {
        return ['EXT_color_buffer_float', 'EXT_color_buffer_half_float'].includes(name) ? null : request.call(this, name)
      }
    }
  }, denial)
  await open()
  if (compact) await useCompactGL(page)
  await page.evaluate(({ mode, roadOnly }) => {
    const g = window.__sr
    const request = g.requestRun.bind(g)
    let seed = 42
    g.requestRun = sword => {
      const ok = request(sword)
      if (ok) g.pendingRun.seed = seed++
      return ok
    }
    if (mode !== 'auto') g.allowDiagnosticMaster()
    if (roadOnly) g.preferDiagnosticMobile()
    const refused = []
    if (mode.endsWith('surface')) {
      const scope = g.renderer.bridgeFinish.scope, acquire = scope.tryAcquire.bind(scope)
      scope.tryAcquire = (...args) => {
        if (mode === 'surface' || args[3] === 'bridge-master-actors') { refused.push(args[3]); return null }
        return acquire(...args)
      }
    }
    const settle = async (mode, reason) => {
      const start = performance.now(), deadline = start + 32_000
      let paints = 0
      do {
        g.paint(0, false); paints++
        const r = g.graphicsPresentation(), sky = r.gpu?.stratumA
        // The final sky upload can set `live` after this frame chose the
        // Canvas sky. Compare pixels only after the GPU sky actually drew.
        const skyDrawn = sky?.live && sky.frames > 0
        if (r.path === mode && (mode === 'mobile-canvas' || skyDrawn) && (!reason || new RegExp(reason).test(r.reason))) return
        await new Promise(requestAnimationFrame)
      } while (performance.now() < deadline)
      const diagnostics = { paints, elapsed: performance.now() - start, uploadQuiet: g.renderer.bridgeField.uploadQuiet,
        skyUploads: g.renderer.bridgeFinish.pipe?.skyUpload, presentation: g.graphicsPresentation() }
      throw Error(`Admission timeout for ${mode}: ${JSON.stringify(diagnostics)}`)
    }
    window.finishQA = { settle, refused, async capture(label, mode, reason) {
      cancelAnimationFrame(g.raf)
      const canvas = document.querySelector('[data-render-layer=finish]')
      const before = [g.player.x, g.player.y, g.player.hp, g.time, g.bg.weatherState().tick]
      await settle(mode, reason)
      const after = [g.player.x, g.player.y, g.player.hp, g.time, g.bg.weatherState().tick]
      // Matched JS/driver submission only. This does not wait for GPU completion
      // or measure browser compositor/scanout, and every sample uses dt=0.
      const submits = []
      for (let i = 0; i < 20; i++) {
        const t = performance.now(); g.paint(0, false); submits.push(performance.now() - t)
      }
      submits.sort((a, b) => a - b)
      const res = g.resourceSnapshot(), r = res.presentation
      r.cpuSubmitMs = { samples: submits.length, median: submits[Math.floor(submits.length / 2)],
        p95: submits[Math.ceil(submits.length * .95) - 1], max: submits.at(-1) }
      const hud = g.hudCtx?.canvas
      const pipe = g.renderer.bridgeFinish.pipe
      const { cssW: width, cssH: height } = g
      const road = [-30, 42].map(y => g.project(g.cam.x, y).y)
      const composed = { width, height, road, insets: g.insets, hp: g.player.hp, id: g.graphicsPresentation().frame.id }
      return { label, seed: g.route?.seed, before, after, dpr: g.dpr, draw: [canvas.width, canvas.height],
        scene: [g.canvas.width, g.canvas.height], hud: [hud.width, hud.height], hidden: canvas.hidden, config: g.renderConfig,
        composed,
        gpuResources: res.entries.filter(e => /^bridge-(master|mobile)-actors$/.test(e.tag)).length,
        propAtlases: res.entries.filter(e => e.tag === 'route-prop-atlas').length, overSurfaces: res.overSurfaces, ...r }
    } }
  }, { mode: denial, roadOnly })
  if (direct) await page.evaluate(() => {
    const g = window.__sr, random = Math.random
    g.qaMode = true; Math.random = () => 42.5 / 0xffffffff
    try { g.startRun('katana') } finally { Math.random = random }
  })
  const rows = []
  if (pending) {
    await button('ENGAGE'); await phase('playing')
    const r = await page.evaluate(() => {
      const g = window.__sr, f = g.renderer.bridgeFinish, out = document.querySelector('[data-render-layer=finish]')
      cancelAnimationFrame(g.raf); f.releaseFrame(); f.retry()
      // Deny only the async completion query. Link real driver programs,
      // then change tier and quit while neither pipeline has a framebuffer.
      const proto = WebGL2RenderingContext.prototype, ext = proto.getExtension
      proto.getExtension = function (name) { return name === 'KHR_parallel_shader_compile' ? null : ext.call(this, name) }
      try {
        g.paint(0, false)
        const a = f.pipe
        if (!a || a.mode !== 'master' || a.programs.length !== 0) throw Error('Master did work at context acquire')
        g.paint(0, false)
        const n = a.programs.length, status = g.graphicsPresentation()
        g.preferDiagnosticMobile(); g.paint(0, false); const b = f.pipe
        if (!b || b === a || b.mode !== 'mobile') throw Error('Pending Master not replaced')
        g.paint(0, false)
        const m = b.programs.length, retired = a.programs.length
        g.quitToMenu(); g.paint(0, false)
        const released = !f.pipe && !b.programs.length && out.hidden && out.width === 0 && out.height === 0
        const glError = b.gl.getError()
        g.destroy()
        return { n, m, retired, released, status: status.path, reason: status.reason, glError, surfaces: g.resourceSnapshot().surfaces }
      } finally { proto.getExtension = ext }
    })
    assert.deepEqual(r, { n: 1, m: 1, retired: 0, released: true, status: 'mobile-canvas', reason: 'Preparing WebGL programs and textures', glError: 0, surfaces: 0 })
    return { pending, ...r }
  }
  let dryRaster = null, dryResolve = null, surfaceAttempts = null
  const canvasPath = 'mobile-canvas', mobile = 'mobile-webgl2', master = 'master-webgl2'
  // A single opaque sky texel is not a scene witness. Independently check
  // the road and HUD in browser composition at the exact captured submit.
  const get = async (label, mode, reason) => {
    const r = await page.evaluate((label, mode, reason) => window.finishQA.capture(label, mode, reason), label, mode, reason?.source)
    assert.deepEqual(r.before, r.after, `painting advanced gameplay at ${label}`)
    assert.equal(r.path, mode, JSON.stringify(r))
    assert.equal(r.hidden, mode === canvasPath)
    assert.deepEqual(r.config, { preset: 'ULTRA', renderScale: 1.25, adaptiveEnabled: false, showFPS: false })
    await frames()
    const png = await page.screenshot({ captureBeyondViewport: false })
    if (shots) await writeFile(resolve(shots, `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${mode}.png`), png)
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width, height, road, insets, hp, id } = r.composed
    assert.equal(await page.evaluate(() => window.__sr.graphicsPresentation().frame.id), id)
    const sx = info.width / width, sy = info.height / height
    const sample = (x, y) => data.subarray(3 * (y * info.width + x), 3 * (y * info.width + x) + 3)
    const roadTones = new Set()
    let backdropHoles = 0, roadSamples = 0, hpInk = 0
    for (let y = Math.max(0, Math.ceil(road[0] * sy)); y < Math.min(info.height, road[1] * sy); y += 2) {
      for (let x = Math.ceil(info.width * .10); x < info.width * .84; x += 2) {
        const [red, green, blue] = sample(x, y)
        roadTones.add((red >> 3) << 8 | (green >> 3) << 4 | (blue >> 4))
        if (red === 22 && green === 25 && blue === 28) backdropHoles++
        roadSamples++
      }
    }
    const top = Math.round((insets.top + 24 + 16) * sy), l = Math.round((insets.left + 24) * sx)
    for (let x = l; x < l + 50 * sx; x++) {
      const [red, green, blue] = sample(x, top)
      if (red === 255 && green === 102 && blue === 126) hpInk++
    }
    assert.ok(roadSamples > 100 && roadTones.size > 8 && backdropHoles / roadSamples < .04 && (hp <= 0 || hpInk >= 40 * sx),
      `${label}: incomplete composition (${[roadSamples, roadTones.size, backdropHoles, hpInk]})`)
    Object.assign(r.composed, { roadTones: roadTones.size, backdropHoles, roadSamples, hpInk })
    assert.deepEqual([r.propAtlases, r.overSurfaces], [0, 0])
    if (reason) assert.match(r.reason, reason)
    if (r.gpu) {
      assert.equal(r.gpu.format, mode === master ? 'RGBA16F' : 'RGBA8')
      assert.equal(r.gpu.maxK, mode === master ? 6 : 4)
      assert.equal(r.gpu.bloomLevels, mode === master ? (legacyGraph ? 4 : 3) : 0)
      assert.ok(r.gpu.stratumA?.live)
      assert.deepEqual(r.gpu.stratumA.size, r.draw[0] >= r.draw[1] ? (mode === master ? [256, 88] : [160, 56]) : (mode === master ? [160, 144] : [96, 96]))
      assert.deepEqual(r.gpu.uboOffsets, v4 ? [0, 640, 1664, 2176, 2432, 3072, 3456] : [0, 640, 1664, 2176])
      if (mode === mobile) {
        assert.ok(Math.min(...r.draw) <= 1080 && Math.max(...r.draw) <= 1920)
        assert.deepEqual(r.gpu.roadSize, r.draw.map(n => Math.ceil(n / 2)))
      }
      assert.equal(r.gpuResources, 1)
      assert.deepEqual(r.draw, r.scene)
      assert.deepEqual(r.gpu.size, r.scene)
    } else {
      assert.equal(r.gpuResources, 0)
      assert.deepEqual(r.draw, [0, 0])
    }
    rows.push(r)
    return r
  }
  if (!direct) { await button('ENGAGE'); await phase('playing'); await frames() }
  else await wait(() => window.__sr.phase === 'playing')
  if (denial) {
    const wantsMobile = denial === 'float' || denial === 'master-surface'
    await get(denial, wantsMobile ? mobile : canvasPath, denial === 'float' ? /RGBA16F color buffer unavailable/ :
      denial.endsWith('surface') ? /surface budget/ : /WebGL2 hardware path unavailable|Software WebGL adapter/)
    if (denial.endsWith('surface')) {
      surfaceAttempts = await page.evaluate(() => {
        const g = window.__sr, f = g.renderer.bridgeFinish, current = f.pipe
        for (let i = 0; i < 4; i++) {
          g.paint(0, false)
          if (f.pipe !== current || f.warming) throw Error('A denied tier restarted pipeline warmup')
        }
        return window.finishQA.refused.slice()
      })
      assert.deepEqual(surfaceAttempts, denial === 'surface' ? ['bridge-master-actors', 'bridge-mobile-actors'] : ['bridge-master-actors'])
    }
  } else if (!roadOnly) {
    const first = await get('engage', master)
    await page.evaluate(() => {
      const output = document.querySelector('[data-render-layer=finish]')
      const gl = output.getContext('webgl2'), ext = gl.getExtension('WEBGL_lose_context')
      if (!ext) throw Error('Actual context-loss extension is unavailable')
      window.finishQA.ext = ext
      output.addEventListener('webglcontextlost', () => { window.finishQA.lost = true }, { once: true })
      output.addEventListener('webglcontextrestored', () => { window.finishQA.restored = true }, { once: true })
      ext.loseContext()
    })
    await wait(() => window.finishQA.lost)
    const lost = await get('context lost', canvasPath, /WebGL context lost/)
    assert.deepEqual(lost.hud, first.hud)
    if (!compact) assert.deepEqual(lost.scene, first.scene)
    await page.evaluate(() => window.finishQA.ext.restoreContext())
    await wait(() => window.finishQA.restored)
    await get('context restored', master)
  } else await get('engage', mobile)
  if (!denial && !contextOnly && !roadOnly) {
    await page.evaluate(() => window.__sr.inspect.setView('solo'))
    await get('inspect', canvasPath, /not requested/)
    await page.evaluate(() => window.__sr.inspect.setView('off'))
    await get('inspect closed', master)
    const capView = wideCap ? { width: 3100, height: 720 } : { width: 1810, height: 1230 }
    await page.setViewport({ ...viewport, ...capView })
    await page.evaluate(() => window.__sr.resize())
    await get('over pixel cap', mobile, /viewport budget/)
    await page.setViewport({ ...viewport, width: 700, height: 448 })
    await page.evaluate(() => window.__sr.resize())
    const resized = await get('resized', master)
    assert.notDeepEqual(resized.scene, rows[0].scene)
  }
  if (!denial && !contextOnly && !roadOnly) {
    // Toggle only precipitation while the entire world is frozen at a
    // rolled eave. Compare actual framebuffer pixels in world coordinates,
    // excluding the 8u AA boundary; a mask receipt alone cannot prove this.
    dryRaster = await page.evaluate(async v4 => {
      const g = window.__sr, output = document.querySelector('[data-render-layer=finish]')
      const s = g.route.chunk(3).shelter
      g.player.reset(s.terminal); g.cam.startOnRoad(s.terminal); g.cam.rot = .09
      g.bg.advanceActiveTicks(720, 1)
      g.bg.syncCutaway(s.terminal, 0, 1)
      const report = []
      const finish = g.renderer.bridgeFinish
      for (const path of ['master-webgl2', 'mobile-webgl2', 'mobile-canvas']) {
        const gpu = path !== 'mobile-canvas'
        if (v4) g.renderer.diagnosticMobile = path !== 'master-webgl2'
        g.renderer.setDesktopLighting(path === 'master-webgl2')
        if (!gpu) finish.refused.mobile = 'QA: suppress WebGL'
        await window.finishQA.settle(path)
        const c = gpu ? output : g.canvas, {width: w, height: h} = c
        if (g.resourceSnapshot().presentation.path !== path) throw Error(`missing ${path} for rain raster`)
        const raster = () => {
          if (!gpu) return g.ctx.getImageData(0, 0, w, h).data
          const gl = output.getContext('webgl2'), data = new Uint8Array(w * h * 4)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data)
          return data
        }
        const on = raster(), work = { ...g.bg.weatherWork() }, fw = g.renderer.bridgeFinish.pipe
        const painter = g.bg.routeWeather, draw = painter.draw, particles = fw?.particles
        painter.draw = () => {}
        if (fw) fw.particles = () => {}
        let off
        try { g.paint(0, false); off = raster() }
        finally { painter.draw = draw; if (fw) fw.particles = particles }
        const cam = g.cam, co = Math.cos(cam.rot), si = Math.sin(cam.rot)
        let dryDiff = 0, wetDiff = 0, drySamples = 0
        for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
          const sy = ((gpu ? h - y - .5 : y + .5) / h - .5) * g.cssH / cam.zoom
          const sx = ((x + .5) / w - .5) * g.cssW / cam.zoom
          const wx = cam.x + cam.offX + sx * co + sy * si
          const wy = cam.y + cam.offY - sx * si + sy * co
          if (wy < -300 || wy > 50 || Math.abs(wx - s.left) < 8 || Math.abs(wx - s.right) < 8) continue
          const at = (y * w + x) * 4
          const delta = Math.max(...[0, 1, 2].map(k => Math.abs(on[at + k] - off[at + k])))
          const dry = s.left <= wx && wx < s.right
          if (dry) drySamples++
          if (delta > 3) {
            if (dry) dryDiff++
            else wetDiff++
          }
        }
        report.push({ path, roll: cam.rot, dryDiff, wetDiff, drySamples, work })
      }
      finish.retry()
      if (v4) g.renderer.diagnosticMobile = false
      g.renderer.setDesktopLighting(true)
      return report
    }, v4)
    for (const r of dryRaster) {
      assert.ok(r.drySamples > 2000 && r.wetDiff > 10 && r.dryDiff === 0, JSON.stringify(r))
    }
  }
  if (!denial && !contextOnly) {
    // Toggle only wetness at Pass 3, before actor/HUD or bloom. Test
    // resolved (full-resolution) scene pixels on both sides of a rolled
    // covered eave, including the first 2 logical pixels of dry deck.
    dryResolve = await page.evaluate(async ({ v4, roadOnly }) => {
      const g = window.__sr, s = g.route.chunk(3).shelter
      if (roadOnly) {
        g.player.reset(s.terminal); g.bg.advanceActiveTicks(720, 1)
        g.bg.syncCutaway(s.terminal, 0, 1)
      }
      g.cam.startOnRoad(s.left + 16); g.cam.rot = .09
      const report = []
      for (const mode of roadOnly ? ['mobile'] : ['master', 'mobile']) {
        const hdr = mode === 'master'
        if (v4) g.renderer.diagnosticMobile = !hdr
        g.renderer.setDesktopLighting(hdr)
        await window.finishQA.settle(`${mode}-webgl2`)
        const p = g.renderer.bridgeFinish.pipe
        if (!p || p.mode !== mode) throw Error(`missing ${mode} for road raster`)
        const { gl } = p, { width: w, height: h } = p.scene
        const original = p.ground
        const read = wet => {
          const data = hdr ? new Float32Array(w * h * 4) : new Uint8Array(w * h * 4)
          p.ground = function(f, cssW, cssH, scene) {
            const old = f.wet
            f.wet = wet
            try { original.call(p, f, cssW, cssH, scene) }
            finally { f.wet = old }
            gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo)
            gl.readPixels(0, 0, w, h, gl.RGBA, hdr ? gl.FLOAT : gl.UNSIGNED_BYTE, data)
            const err = gl.getError()
            if (err) throw Error(`road readback error ${err}`)
          }
          g.paint(0, false)
          if (g.renderer.bridgeFinish.pipe !== p) throw Error('lost road presenter')
          return data
        }
        let on, off
        try { on = read(.92); off = read(0) }
        finally { p.ground = original }
        const c = g.cam, co = Math.cos(c.rot), si = Math.sin(c.rot)
        let drySamples = 0, dryEaveSamples = 0, dryDiff = 0, wetDiff = 0, edgeSamples = 0, blankEdge = 0, blackEdge = 0
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const sx = ((x + .5) / w - .5) * g.cssW / c.zoom
          const sy = (.5 - (y + .5) / h) * g.cssH / c.zoom
          const wx = c.x + c.offX + sx * co + sy * si, wy = c.y + c.offY - sx * si + sy * co
          const k = (y * w + x) * 4
          if (Math.abs(wy) > 50 && Math.abs(wy) <= 51.9) {
            edgeSamples++
            // Isolated dark aggregate texels can quantize to RGB zero in
            // the linear RGBA8 store. Alpha detects a real uncovered strip.
            blankEdge += +(on[k+3] !== (hdr ? 1 : 255))
            blackEdge += +(on[k] + on[k+1] + on[k+2] === 0)
          }
          if (wy <= -50 || wy >= 50 || Math.abs(wx - s.left) < .08 || Math.abs(wx - s.right) < .08) continue
          const dry = wx >= s.left && wx < s.right
          if (dry) { drySamples++; if (wx - s.left < 2 || s.right - wx < 2) dryEaveSamples++ }
          if ([0, 1, 2].some(i => Math.abs(on[k + i] - off[k + i]) > (hdr ? 1e-6 : 0))) {
            if (dry) dryDiff++
            else wetDiff++
          }
        }
        report.push({ mode, roadSize: p.receipt().roadSize, drySamples, dryEaveSamples, dryDiff, wetDiff, edgeSamples, blankEdge, blackEdge, roll: c.rot })
      }
      if (v4) g.renderer.diagnosticMobile = false
      g.renderer.setDesktopLighting(true)
      return report
    }, { v4, roadOnly })
    for (const r of dryResolve) assert.ok(r.drySamples > 2000 && r.dryEaveSamples > 20 && r.dryDiff === 0 &&
      r.wetDiff > 500 && r.edgeSamples > 300 && r.blankEdge === 0 && r.blackEdge < r.edgeSamples * .005, JSON.stringify(dryResolve))
  }
  if (!denial && !contextOnly && !roadOnly) {
    await page.evaluate(() => {
      const g = window.__sr
      window.finishQA.retired = [...g.bg.scenery.cache.values()].map(e => e.surface)
      g.gameOver()
      g.lastFrame = performance.now(); g.raf = requestAnimationFrame(g.loop)
    })
    await button('RETRY'); await phase('playing'); await frames()
    assert.equal((await get('retry', master)).seed, 43)
    assert.ok(await page.evaluate(() => window.finishQA.retired.every(c => c.width === 0 && c.height === 0)))
  }
  const end = await page.evaluate(() => {
    const g = window.__sr, finish = document.querySelector('[data-render-layer=finish]')
    g.destroy()
    const r = g.resourceSnapshot()
    return { stores: r.surfaces, bytes: r.bytes, presentation: r.presentation, finish: [finish.width, finish.height, finish.hidden] }
  })
  assert.deepEqual([end.stores, end.bytes, end.presentation.gpu, ...end.finish], [0, 0, null, 0, 0, true])
  return { denial, contextOnly, roadOnly, wideCap, rows, dryRaster, dryResolve, surfaceAttempts, end }
})
