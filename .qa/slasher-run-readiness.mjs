/** Real menu gestures, transfers and GL draws. Pin the driver polls/HTTP
 * responses independently so a temporary Canvas frame cannot satisfy Play.
 * --lose loses GL before publication; --lose-cut loses it during the reveal. */
import assert from 'node:assert/strict'
import { withBridge, viewport, touch, compactFactor, useCompactGL } from './bridge-browser.mjs'

const optimized = process.argv.includes('--optimized'), sync = process.argv.includes('--sync')
const compact = process.argv.includes('--compact')
const holdGlass = process.argv.includes('--hold-glass')
const loseBefore = process.argv.includes('--lose'), loseCut = process.argv.includes('--lose-cut')
assert.ok(!loseBefore || !loseCut, 'choose one context-loss point')
const lose = loseBefore || loseCut, lut = `/bridge/baked-v1/look-${optimized ? 16 : 32}.bin.br`
const path = optimized ? 'mobile-webgl2' : 'master-webgl2'
await withBridge(async ({ page, open, button, wait, phase, frames }) => {
  const size = touch ? { ...viewport, width: 400, height: 760, deviceScaleFactor: 1 } : { ...viewport, width:700, height:460 }
  await page.setViewport(size)
  const pending = { lut: [], city: [], glass: [] }, released = new Set()
  await page.setRequestInterception(true)
  page.on('request', r => {
    const name = new URL(r.url()).pathname
    const slot = name === lut ? 'lut' : holdGlass && name === '/bridge/shop-return-v2.webp' ? 'glass' :
      name === '/bridge/l1.webp' ? 'city' : null
    if (slot && !released.has(slot)) { pending[slot].push(r); return }
    return r.continue()
  })
  const release = async (slot) => {
    released.add(slot)
    await Promise.all(pending[slot].map(r => r.continue()))
  }
  await page.evaluateOnNewDocument(sync => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV:3, quality:'ultra', adaptiveQuality:false, muted:true }))
    const q = window.readinessDriver = { compileHold: !sync, fenceHold: true, hidden: false, shaderPolls: 0, fencePolls: 0, links: 0, blits: 0, completionShim: false }
    Object.defineProperty(document, 'hidden', { get: () => q.hidden, configurable: true })
    const proto = WebGL2RenderingContext.prototype, getExtension = proto.getExtension
    proto.getExtension = function (name) {
      if (name !== 'KHR_parallel_shader_compile') return getExtension.call(this, name)
      if (sync) return null
      const extension = getExtension.call(this, name)
      if (extension) return extension
      // Headless SwiftShader may hide this extension. Drive the same polling
      // branch with a shim, but still link and validate actual GLSL programs.
      q.completionShim = true
      return { COMPLETION_STATUS_KHR:0x91b1 }
    }
    const getParameter = proto.getProgramParameter, link = proto.linkProgram, fence = proto.clientWaitSync, blit = proto.blitFramebuffer
    proto.getProgramParameter = function (program, name) {
      if (name === 0x91b1) {
        if (q.compileHold) { q.shaderPolls++; return false }
        if (q.completionShim) return true // real LINK_STATUS checked immediately afterward
      }
      return getParameter.call(this, program, name)
    }
    proto.linkProgram = function (...args) { q.links++; return link.apply(this, args) }
    proto.clientWaitSync = function (...args) {
      q.fencePolls++
      if (q.fenceHold && window.__sr?.phase === 'preparing') return this.TIMEOUT_EXPIRED
      return fence.apply(this, args)
    }
    proto.blitFramebuffer = function (...args) { q.blits++; return blit.apply(this, args) }
  }, sync)
  await open()
  if (compact) await useCompactGL(page)
  await page.evaluate(({ optimized, loseCut }) => {
    const g = window.__sr, q = window.readinessDriver
    g.allowDiagnosticMaster(); g.setDiagnosticRenderScale(1)
    if (optimized) g.preferDiagnosticMobile()

    const request = g.requestRun.bind(g)
    let seed = 42
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = seed++; return ok }
    const state = () => {
      const p = g.graphicsPresentation(), prep = g.pendingRun, finish = g.renderer.bridgeFinish, stream = g.bg.bridgeStream(), hud = g.hudCtx.canvas
      const w = stream.openingWindow()
      return {
        at: performance.now(), phase:g.phase, stage:prep?.stage, initialized:!!prep?.initialized, seed:g.route.seed, frame:p.frame, path:p.path,
        input:g.input.enabled, music:!!g.audio.timer, overlay:!!document.querySelector('.sr-interlude'), touch:!!document.querySelector('.sr-touch-surface'),
        tick:g.hordeTick, time:g.time, weather:g.bg.routeTime(), rain:g.bg.routeRainTime(), player:[g.player.x, g.player.y, g.player.hp],
        threat:g.enemies.map(e => [e.x,e.y,e.stateT]), priorGL:[finish.output.width, finish.output.height, finish.output.hidden], priorHUD:[hud.width, hud.height],
        staged:p.staged, pipeSize:[finish.pipe?.w, finish.pipe?.h], size:[g.cssW,g.cssH], gpu:p.gpu, blits:q.blits, links:q.links,
        optics:w && { seed:w.seed, id:w.id, origin:w.origin }, stream:stream.receipt(), glass: g.renderer.glass.receipt(),
        atlas: performance.getEntriesByName(new URL('/bridge/shop-return-v2.webp',location.href).href).at(-1)?.responseEnd ?? null,
        platesReady:!!(prep?.opening && stream.openingSettled(prep.opening.visible)),
        cutId:prep?.cut?.id,
      }
    }
    const record = window.readinessQA = { state, starts:[], clicks:[], stages:[], draws:[], cuts:[] }
    if (loseCut) {
      const finish = g.finishOpeningCut.bind(g)
      g.finishOpeningCut = id => { if (id !== record.cuts[0]?.cutId) finish(id) }
    }
    const paint = g.paint.bind(g)
    g.paint = (...args) => {
      const r = g.pendingRun, start = performance.now()
      const ok = paint(...args)
      if (r && (ok || record.draws.length < 8) && record.draws.length < 200)
        record.draws.push({ raf:r.frameAt, at:performance.now(), js:performance.now()-start, ok, stage:r.stage, faults:g.presentationFaults })
      return ok
    }
    window.addEventListener('click', e => {
      const label = e.target.closest('button')?.textContent.trim()
      if (label==='ENGAGE' || label==='RETRY') record.clicks.push({ label, at:performance.now(), trusted:e.isTrusted && navigator.userActivation.isActive, before:state() })
    }, true)
    g.on(e => {
      if (e.type === 'runPreparing') record.stages.push(e.stage)
      if (e.type === 'runRevealing') record.cuts.push(state())
      if (e.type === 'phase' && e.phase === 'playing') record.starts.push(state())
    })
  }, { optimized, loseCut })
  const state = () => page.evaluate(() => window.readinessQA.state())
  const checkHold = (held, previous) => {
    assert.ok(held.initialized && held.overlay && !held.touch && !held.input && !held.music)
    assert.ok(held.player[2] === 100 && held.threat.length >= 1)
    assert.deepEqual([held.phase, held.tick, held.time, held.weather, held.rain], ['preparing',0,0,0,0])
    assert.deepEqual(held.frame, previous.frame, 'no publication during asset/driver holds')
    assert.deepEqual(held.priorGL, previous.priorGL, 'do not resize/clear the published GL backing while preparing')
    assert.equal(held.blits, previous.blits)
  }
  await button('ENGAGE')
  await wait(() => window.__sr.pendingRun?.initialized && window.__sr.renderer.bridgeFinish.pipe?.programs.length > 0)
  const prior = await page.evaluate(() => window.readinessQA.clicks[0].before)
  const parallel = await page.evaluate(() => !window.__sr.renderer.bridgeFinish.pipe?.compileStatus ? 'off' : window.readinessDriver.completionShim ? 'shim' : 'native')
  if (parallel !== 'off') await wait(() => window.readinessDriver.shaderPolls > 0)
  const shaderHold = await state()
  checkHold(shaderHold, prior)
  assert.equal(shaderHold.stage,'renderer')
  await page.evaluate(() => { window.readinessDriver.compileHold = false })
  await wait(() => window.readinessQA.state().platesReady && window.__sr.renderer.bridgeFinish.pipe?.setupMs['grade-source'] !== undefined)
  const gradeHold = await state()
  assert.equal(pending.lut.length,1)
  checkHold(gradeHold, prior)
  assert.equal(gradeHold.stage,'renderer')
  assert.ok(!gradeHold.staged)
  await release('lut')
  await wait(() => window.__sr.renderer.bridgeFinish.pipe?.assembled)
  let glassHold = null, cityHold = null
  if (holdGlass) {
    assert.equal(pending.glass.length, 1)
    glassHold = await state()
    checkHold(glassHold, prior)
    assert.ok(!glassHold.staged)
  }
  if (pending.city.length) {
    await wait(() => window.__sr.pendingRun?.stage === 'background')
    cityHold = await state()
    checkHold(cityHold, prior)
    assert.ok(!cityHold.staged)
  }
  await release('city')
  if (holdGlass) {
    await wait(() => window.__sr.renderer.bridgeFinish.skyReady && window.__sr.pendingRun?.stage === 'background')
    glassHold = await state()
    checkHold(glassHold, prior)
    assert.ok(!glassHold.staged && glassHold.atlas === null, 'loaded sky does not excuse outstanding glass')
    await release('glass')
  }
  await wait(() => window.readinessQA.state().staged && window.readinessDriver.fencePolls > 0)
  const fenced = await state()
  checkHold(fenced, prior)
  assert.deepEqual(fenced.player, gradeHold.player)
  assert.deepEqual(fenced.threat, gradeHold.threat)
  assert.equal(fenced.stage,'frame')
  const loseContext = () => page.evaluate(async () => {
    const pipe = window.__sr.renderer.bridgeFinish.pipe, ext = pipe.gl.getExtension('WEBGL_lose_context')
    if (!ext) throw Error('No WebGL loss extension')
    const lost = new Promise(resolve => pipe.canvas.addEventListener('webglcontextlost',resolve,{once:true}))
    ext.loseContext(); await lost
  })
  if (loseBefore) {
    await loseContext()
  } else {
    await page.keyboard.press('ArrowRight')
    await page.evaluate(() => {
      const q = window.readinessDriver
      q.hidden = true; q.fenceHold = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await frames(); await frames()
    checkHold(await state(), prior)
    await page.evaluate(() => {
      window.readinessDriver.hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }
  let lostAtCut = null
  if (loseCut) {
    await wait(() => document.querySelector('.sr-ronin-reveal[data-cut]') && window.readinessQA.cuts.length === 1)
    const interrupted = await state()
    assert.equal(interrupted.frame.kind, 'webgl')
    assert.deepEqual([interrupted.time, interrupted.input, interrupted.music], [0,false,false])
    await loseContext()
    await wait(() => !document.querySelector('.sr-ronin-reveal[data-cut]') && window.__sr.pendingRun?.cut === undefined)
    const covered = await state()
    assert.deepEqual([covered.phase, covered.overlay, covered.time, covered.input, covered.music], ['preparing',true,0,false,false])
    // The real animation can still have a queued completion. It must be
    // ignored even after recovery starts qualifying new Canvas frames.
    await page.evaluate(id => {
      const g = window.__sr
      Object.getPrototypeOf(g).finishOpeningCut.call(g,id)
    }, interrupted.cutId)
    lostAtCut = { interrupted, covered }
  }
  const playing = () => phase('playing').catch(async error => {
    const trace = await page.evaluate(() => ({ state: window.readinessQA.state(), draws:window.readinessQA.draws,
      marks:performance.getEntriesByType('mark').filter(m => m.name.startsWith('sr:')).map(m => [m.name,m.startTime]) }))
    throw Error(`${error.message} ${JSON.stringify(trace)}`)
  })
  await playing()
  const first = await page.evaluate(() => window.readinessQA.starts[0])
  const checkStart = (first, seed) => {
    assert.deepEqual([first.phase, first.time, first.tick, first.weather, first.input, first.music, first.overlay], ['playing',0,0,0,true,true,false])
    assert.deepEqual([first.frame.seed, first.frame.time, first.frame.hp, first.frame.hud], [seed,0,100,'layer'])
    assert.ok(first.frame.threats > 0)
    assert.equal(first.path, lose ? 'mobile-canvas' : path)
    if (!lose) {
      assert.equal(first.frame.kind,'webgl')
      assert.ok(first.gpu.programs.length === (optimized ? 6 : 9) && first.gpu.frameDraws >= (optimized ? 6 : 10))
      assert.equal(first.gpu.bloomLevels, optimized ? 0 : 3)
      assert.equal(first.gpu.bloomUpPasses, 0)
      assert.deepEqual(first.gpu.packedAssets.lutVolumes, ['brotli','brotli','brotli','brotli'])
      assert.equal(first.gpu.packedAssets.city, 'shared-webp')
      assert.ok(first.gpu.stratumA.live && first.gpu.transport.active === first.optics.id)
      assert.equal(first.gpu.transport.staging, null)
      assert.equal(first.optics.seed, seed)
    } else {
      assert.equal(first.frame.kind,'canvas')
      assert.ok(first.stream.lit && !first.gpu && !first.staged)
    }
  }
  checkStart(first, 42)
  if (holdGlass) {
    assert.ok(first.atlas && first.atlas < first.at)
    assert.ok(first.glass.panes > 0 && first.glass.baked > 0, JSON.stringify(first.glass))
  }
  await wait(() => window.__sr.time > .06)
  assert.deepEqual((await state()).player.slice(0,2), first.player.slice(0,2), 'discard input entered during preparation')
  if (touch) await button('JUMP'); else await page.keyboard.press('Space')
  await wait(() => window.__sr.player.y < -9)
  if (lose) {
    const cuts = await page.evaluate(() => window.readinessQA.cuts)
    assert.deepEqual(cuts.map(c => c.path), loseCut ? [path, 'mobile-canvas'] : ['mobile-canvas'])
    assert.ok(cuts.every(c => c.overlay && !c.input && !c.music && c.time === 0))
    assert.equal(cuts.at(-1).frame.id, first.frame.id)
    return { optimized, sync, lose, parallel, shaderHold, gradeHold, glassHold, cityHold, fenced, lostAtCut, cuts, first }
  }

  // Retry with hot programs. Cancel *after* reserving a differently sized
  // opening/post frame; Results must still own the prior frame and HUD.
  await page.evaluate(() => {
    const g = window.__sr
    g.player.hp = 0; g.paint(0,false); g.gameOver()
    window.readinessDriver.fenceHold = true
  })
  await phase('gameover'); await frames()
  const results = await state()
  const resultText = () => page.evaluate(() => [...document.querySelectorAll('h2')].find(h => h.textContent === 'YOU HAVE FALLEN')?.parentElement?.textContent)
  const card = await resultText()
  // Sample a corner of the composed Results backing, away from the buttons
  // whose keyboard focus changes on Cancel. No canvas/GL readback.
  const resultPatch = () => page.screenshot({ clip:{ x:0, y:48, width:128, height:64 }, captureBeyondViewport:false })
  const retainedPixels = await resultPatch()
  await button('RETRY'); await wait(() => window.readinessQA.state().staged)
  assert.equal((await state()).links, first.links, 'Retry reuses resident shader programs')
  const resized = { ...size, width: size.width + 38, height: size.height + 22 }
  await page.setViewport(resized)
  await wait(([w,h]) => {
    const r = window.readinessQA.state()
    return r.staged && r.pipeSize[0] === w && r.pipeSize[1] === h
  }, [compact ? Math.floor(resized.width * compactFactor) : resized.width, compact ? Math.floor(resized.height * compactFactor) : resized.height])
  const retryHeld = await state()
  checkHold(retryHeld, results)
  assert.deepEqual(retryHeld.priorHUD, results.priorHUD)
  if (touch) await button('CANCEL'); else await page.keyboard.press('Escape')
  await phase('gameover'); await frames()
  const cancelled = await state()
  assert.equal(await resultText(), card)
  assert.deepEqual([cancelled.frame, cancelled.priorGL, cancelled.priorHUD, cancelled.blits], [results.frame, results.priorGL, results.priorHUD, results.blits])
  assert.ok(!cancelled.stream.worker && !cancelled.stream.plateWorker && !cancelled.staged && !cancelled.music)
  await page.setViewport(size); await frames()
  assert.deepEqual(await resultPatch(), retainedPixels, 'cancelled Retry must retain the composed Results pixels')
  await page.setViewport(resized); await frames()
  await page.evaluate(() => { window.readinessDriver.fenceHold = false })
  await button('RETRY'); await playing()
  const { starts, clicks, stages } = await page.evaluate(() => window.readinessQA)
  const retry = starts.at(-1)
  checkStart(retry, 44)
  assert.ok(clicks.length === 3 && clicks.every(c => c.trusted) && starts.length === 2)
  assert.equal(retry.links, first.links)
  assert.deepEqual(retry.priorGL, [(compact ? Math.floor(resized.width * compactFactor) : resized.width),
    (compact ? Math.floor(resized.height * compactFactor) : resized.height), false])
  const teardown = await page.evaluate(() => {
    const g = window.__sr; g.destroy(); return { stores:g.resourceSnapshot().surfaces, staged:g.graphicsPresentation().staged }
  })
  assert.deepEqual(teardown, { stores:0, staged:false })
  return { optimized, sync, lose, parallel, shaderHold, gradeHold, glassHold, cityHold, fenced, first, retryHeld, cancelled, retry, stages,
    retryMs: retry.at - clicks.at(-1).at, teardown }
})
