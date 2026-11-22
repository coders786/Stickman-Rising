// Real composed frames with the real loader. Hold an atlas response, then
// inject a main-thread hitch *after* the third valid world+HUD submit. A
// phase/flag-only gate, or a fixed art delay, cannot pass this probe.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { withBridge, touch, viewport, useCompactGL } from './bridge-browser.mjs'

const compact = process.argv.includes('--compact')
const gl = process.argv.includes('--gl'), animated = process.argv.includes('--animated')
const size = { ...viewport, ...(touch ? { width: 400, height: 760 } : gl ? { width: 700, height: 460 } : { width: 960, height: 620 }), deviceScaleFactor: 1 }
const shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })

await withBridge(async ({ page, open, button, phase, wait, frames }) => {
  await page.setViewport(size)
  if (!animated) await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'reduce' }])
  const held = []
  let release = false
  await page.setRequestInterception(true)
  page.on('request', r => {
    if (!release && new URL(r.url()).pathname === '/bridge/shop-return-v2.webp') held.push(r)
    else void r.continue()
  })
  await page.evaluateOnNewDocument(gl => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV:3, quality:gl?'ultra':'high', adaptiveQuality:false, muted:true, shake:false }))
    // Observe real decode start/completion (not ResourceTiming delivery).
    const atlas = window.atlasTrace = []
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = function (...args) {
      const pending = decode.apply(this, args)
      if (this.src.endsWith('/bridge/shop-return-v2.webp')) {
        atlas.push({ start:performance.now(), phase:window.__sr?.phase, modal:!!document.querySelector('.sr-interlude') })
        void pending.then(() => { atlas.at(-1).decoded = performance.now() }, () => {})
      }
      return pending
    }
    // Visibility is controlled only in one explicit test step, independent
    // of the actual browser screenshot/compositor in the foreground.
    Object.defineProperty(document, 'hidden', { configurable:true, get:() => !!window.openingQA?.hidden })
  }, gl)
  await open()
  if (compact) await useCompactGL(page)
  await page.evaluate(({ gl, animated }) => {
    const g = window.__sr, request = g.requestRun.bind(g), paint = g.paint.bind(g)
    if (gl) { g.allowDiagnosticMaster(); g.preferDiagnosticMobile(); g.setDiagnosticRenderScale(1) }

    let seed = 42
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = seed++; return ok }
    const state = () => {
      const p = g.graphicsPresentation(), stream = g.bg.bridgeStream(), at = performance.now()
      return { at, phase:g.phase, stage:g.pendingRun?.stage, frame:p.frame, path:p.path, tier:g.renderConfig.preset, faults:p.faults,
        raf:g.pendingRun?.frameAt ?? null, waiting:!!g.pendingRun, presented:!!g.pendingRun?.presented,
        modal:!!document.querySelector('.sr-interlude'),
        handoff:!!document.querySelector('[data-cut]'), input:g.input.enabled, music:!!g.audio.timer,
        tick:g.hordeTick, time:g.time, weather:g.bg.routeTime(), atlas:window.atlasTrace[0]?.decoded ?? null,
        props:g.props.props.length, lighting:p.field, glass:p.glass, gpu:p.gpu?.stratumA ?? null,
        transport:p.gpu?.transport.active ?? null, opticalSeed:stream.openingWindow()?.seed ?? null,
        plateCount:stream.receipt().plates }
    }
    const q = window.openingQA = { state, attempts:[], block:false, hidden:false }
    const sampleCut = attempt => {
      const trace = attempt.cutAnimation = { duration:null, samples:[] }, requestedAt = performance.now()
      const sample = () => {
        if (q.attempts.at(-1) !== attempt || !document.querySelector('.sr-ronin-reveal')) return
        const veil = document.querySelector('.sr-ronin-reveal .sr-ronin-veil')
        const animation = veil?.getAnimations().find(candidate => candidate.animationName === 'sr-cut-out')
        if (animation) {
          const duration = Number(animation.effect?.getTiming().duration), current = Number(animation.currentTime ?? 0)
          const progress = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0
          trace.duration = duration
          trace.samples.push({ at:performance.now(), progress, transform:getComputedStyle(veil).transform })
          if (progress < 1 && animation.playState !== 'finished') requestAnimationFrame(sample)
          else trace.ended = performance.now()
        } else if (performance.now() - requestedAt < 1000) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }
    document.addEventListener('click', e => {
      const action = e.target.closest('button')?.textContent.trim()
      if (action === 'ENGAGE' || action === 'RETRY') q.attempts.push({ action, trusted:e.isTrusted && navigator.userActivation.isActive, before:state(), frames:[] })
    }, true)
    g.paint = (...args) => {
      const loading = g.phase === 'preparing'
      if (loading && q.block) return false
      const ok = paint(...args)
      if (loading && ok) {
        const attempt = q.attempts.at(-1)
        attempt.frames.push(state())
        if (attempt.frames.length === 3) {
          // The next rAF must see the hitch even if these three submits
          // alone would have met cadence. Keep the veil observable after it.
          const at = performance.now()
          while (performance.now() - at < 190) { /* injected fixture only */ }
          attempt.hitchMs = performance.now() - at
          q.block = true
        }
      }
      return ok
    }
    g.on(e => {
      if (e.type === 'runRevealing') {
        const attempt = q.attempts.at(-1)
        attempt.cut = state()
        if (animated) sampleCut(attempt)
      }
      if (e.type !== 'phase' || e.phase !== 'playing') return
      q.attempts.at(-1).ready = state()
      // Capture the actual exposed tick-zero world, then resume the usual
      // frame loop for trusted controls. No injected Canvas/GL readbacks.
      queueMicrotask(() => cancelAnimationFrame(g.raf))
    })
  }, { gl, animated })
  const state = () => page.evaluate(() => window.openingQA.state())
  const capture = async (name, covered) => {
    const png = Buffer.from(await page.screenshot({ captureBeyondViewport:false }))
    if (shots) await writeFile(join(shots, name + '.png'), png)
    const { data, info:{ width, height } } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject:true })
    // These projected strips never intersect the ink card, steel edge or
    // stage label. Look at actual RGB, not a CSS attribute alone.
    const strips = [[0,0,width,17], [0,40,12,height-90], [width-12,40,width,height-90], [0,height-12,width,height]]
    const bright = strips.map(([l,t,r,b]) => {
      let n = 0
      for (let y=t; y<b; y++) for (let x=l; x<r; x++) {
        const i = (y*width+x)*3
        n += +(Math.max(data[i],data[i+1],data[i+2]) > 8)
      }
      return n
    })
    if (covered) assert.deepEqual(bright, [0,0,0,0], name + ': no arena pixels through the veil')
    else assert.ok(bright[1] > 300 && bright[2] > 300, name + ': no blank world at first exposure')
    return bright
  }

  const tests = [], path = gl ? 'mobile-webgl2' : 'mobile-canvas'
  for (const [i, action] of ['ENGAGE', 'RETRY'].entries()) {
    await button(action)
    let pending = null, frozenPixels = null
    if (!i) {
      await wait(() => {
        const g = window.__sr, r = g.pendingRun
        return r?.opening && g.bg.bridgeStream().openingSettled(r.opening.visible) && r.stage === 'background'
      })
      assert.equal(held.length, 1)
      pending = await state()
      assert.ok(!pending.handoff && pending.modal && pending.atlas === null && pending.time === 0 && pending.opticalSeed === 42)
      assert.notEqual(pending.frame?.seed, 42)
      await page.keyboard.press('ArrowRight')
      frozenPixels = await capture('awaiting-atlas', true)
      release = true
      await Promise.all(held.map(r => r.continue()))
    }
    await wait(() => window.openingQA.block === true || window.__sr.phase === 'playing')
    await frames()
    const hitched = await state()
    assert.ok(hitched.phase === 'preparing' && hitched.modal && !hitched.handoff && !hitched.input && !hitched.music, JSON.stringify(hitched))
    assert.deepEqual([hitched.frame.time, hitched.frame.hud, hitched.path, hitched.tick, hitched.weather], [0,'layer',path,0,0])
    const hitchPixels = await capture(`${action.toLowerCase()}-covered`, true)
    if (!i) {
      await page.evaluate(() => { window.openingQA.hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
      await frames()
      assert.equal((await state()).frame.id, hitched.frame.id)
      await page.evaluate(() => { window.openingQA.hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    }
    await page.evaluate(() => { window.openingQA.block = false })
    await phase('playing').catch(async error => {
      const detail = await page.evaluate(() => ({ state:window.openingQA.state(), rafs:window.openingQA.attempts.at(-1).frames.map(f => f.raf) }))
      throw new Error(`${error.message} ${JSON.stringify(detail)}`)
    })
    await wait(() => !document.querySelector('.sr-ronin-reveal'))
    const exposedPixels = await capture(`${action.toLowerCase()}-exposed`, false)
    const a = await page.evaluate(() => window.openingQA.attempts.at(-1))
    if (animated) {
      const trace = a.cutAnimation, samples = trace?.samples ?? []
      const transforms = new Set(samples.map(sample => sample.transform))
      assert.ok(trace && trace.duration > 100 && trace.duration <= 1000, `${action}: missing finite shutter animation`)
      assert.ok(samples.length >= 6 && samples[0].progress <= .25 && samples.at(-1).progress >= .9,
        `${action}: shutter did not advance over real animation frames: ${JSON.stringify(trace)}`)
      assert.ok(transforms.size >= 3, `${action}: shutter transform did not visibly progress`)
      a.cutAnimation = { duration:trace.duration, frames:samples.length, distinctTransforms:transforms.size,
        firstProgress:samples[0].progress, lastProgress:samples.at(-1).progress,
        firstTransform:samples[0].transform, lastTransform:samples.at(-1).transform }
    }
    assert.ok(a.trusted && a.hitchMs >= 190 && a.frames.length >= 6)
    assert.ok(a.frames.every(f => f.modal && !f.input && !f.music && f.path === path && f.atlas && f.opticalSeed === 42+i))
    const last = a.frames.slice(-3)
    assert.ok(last[1].raf - last[0].raf <= 100 && last[2].raf - last[1].raf <= 100, 'paced real submits')
    assert.ok(a.cut.at >= last[2].at && a.ready.at >= a.cut.at && a.ready.frame.id === last[2].frame.id)
    assert.deepEqual([a.cut.input, a.cut.music, a.cut.frame.id, a.cut.time], [false, false, a.ready.frame.id, 0])
    assert.deepEqual([a.ready.path, a.ready.frame.kind, a.ready.frame.seed, a.ready.frame.hp, a.ready.frame.hud, a.ready.time, a.ready.tick, a.ready.input, a.ready.music, a.ready.modal],
      [path,gl?'webgl':'canvas',42+i,100,'layer',0,0,true,true,false])
    if (gl) assert.ok(a.ready.gpu.live && a.ready.gpu.frames > 0 && a.ready.transport !== null && a.ready.glass.baked > 0)
    await page.evaluate(() => { const g = window.__sr; g.raf = requestAnimationFrame(g.loop) })
    if (touch) await button('JUMP'); else await page.keyboard.press('Space')
    await wait(() => window.__sr.player.y < -9)
    tests.push({ pending, frozenPixels, hitched, hitchPixels, exposedPixels, ...a })
    if (!i) { await page.evaluate(() => { const g=window.__sr; g.player.hp=0; g.paint(0,false); g.gameOver() }); await phase('gameover') }
  }
  let cancelledAfterSubmit = null
  if (process.argv.includes('--cancel')) {
    await page.evaluate(() => window.__sr.gameOver()); await phase('gameover')
    await button('RETRY')
    await wait(() => window.openingQA.block)
    const covered = await state()
    assert.ok(covered.presented && covered.modal && covered.waiting && !covered.handoff)
    assert.equal(covered.frame.seed, 44)
    const coverPixels = await capture('retry-abandoned-covered', true)
    await button('MENU'); await phase('attract')
    await wait(() => window.__sr.graphicsPresentation().frame?.kind === 'title')
    const title = await state()
    assert.equal(title.waiting || title.modal || title.handoff || title.input || title.music, false)
    await page.evaluate(() => { window.openingQA.block = false })
    cancelledAfterSubmit = { covered, coverPixels, title }
  }
  const finish = await page.evaluate(() => {
    const g = window.__sr
    const marks = performance.getEntriesByType('mark').filter(m => /^sr:(engage|retry|run-|playing|first-step)/.test(m.name)).map(m => [m.name,m.startTime])
    const atlas = window.atlasTrace
    g.destroy()
    return { marks, atlas, surfaces:g.resourceSnapshot().surfaces }
  })
  assert.equal(finish.surfaces,0)
  assert.equal(finish.atlas[0].phase,'preparing')
  const at = label => finish.marks.find(([name]) => name === `sr:${label}`)[1]
  assert.ok(finish.atlas[0].start < at('run-workers') && at('run-workers') < finish.atlas[0].decoded, 'I/O and workers overlap the cut-in')
  return { gl, animated, size, tests, cancelledAfterSubmit, ...finish }
})
