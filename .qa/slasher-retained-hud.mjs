/** Same-scale A/B over real Engage. --pixels checks exact backing RGBA and
 * lifecycle separately from the foreground quiet/busy replay; --control
 * expects the previous full-clear release. No readbacks during pacing. */
import assert from 'node:assert/strict'
import { withBridge, viewport, touch } from './bridge-browser.mjs'

const pixels = process.argv.includes('--pixels'), control = process.argv.includes('--control')
const frames = Number(process.env.SR_FRAMES ?? 144), warm = 36
assert.ok(Number.isInteger(frames) && frames > 1)
await withBridge(async ({ page, open, button, phase, wait }) => {
  // Low scene backing, native desktop/2x portrait HUD. Both releases use
  // identical, locked settings (the replay isn't a quality-scale A/B).
  await page.evaluateOnNewDocument(pixels => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'low', adaptiveQuality: false, showFps: pixels, muted: true, shake: false,
  })), pixels)
  await open()
  await page.evaluate(pixels => {
    const g = window.__sr, hud = g.hudCtx, c = hud.canvas
    const q = window.hudQA = { totals: { clears: 0, pixels: 0, text: 0, rects: 0 }, trusted: [], starts: [], words: [], ms: 0 }
    let since = 0, seed = 42
    const clear = hud.clearRect, text = hud.fillText, fill = hud.fillRect, stroke = hud.strokeRect
    hud.clearRect = function (x, y, w, h) {
      if (x !== 0 || y !== 0 || w !== g.cssW || h !== g.cssH) throw Error('Expected the full authoritative clear')
      q.totals.clears++; q.totals.pixels += c.width * c.height
      if (pixels) q.words.length = 0
      clear.call(this, x, y, w, h)
    }
    hud.fillText = function (label, x, y, w) {
      q.totals.text++
      if (pixels) q.words.push(label)
      text.call(this, label, x, y, w)
    }
    hud.fillRect = function (x, y, w, h) { q.totals.rects++; fill.call(this, x, y, w, h) }
    hud.strokeRect = function (x, y, w, h) { q.totals.rects++; stroke.call(this, x, y, w, h) }
    if (!pixels) {
      const draw = g.renderer.drawHud
      g.renderer.drawHud = function (scene, world, w, h, dt) {
        const t = performance.now()
        draw.call(this, scene, world, w, h, dt)
        q.ms += performance.now() - t
      }
    }
    window.addEventListener('click', e => {
      const label = e.target.closest('button')?.textContent.trim()
      if (label === 'ENGAGE' || label === 'RETRY') q.trusted.push([label, e.isTrusted && navigator.userActivation.isActive])
    }, true)
    g.on(e => {
      if (e.type === 'phase' && e.phase === 'preparing') { g.pendingRun.seed = seed++; since = q.totals.clears }
      if (e.type === 'phase' && e.phase === 'playing' && q.starts.length < seed - 42) {
        q.starts.push({ frame: g.graphicsPresentation().frame, clears: q.totals.clears - since, fps: g.hud.lastFpsDraw, words: [...q.words] })
        queueMicrotask(() => cancelAnimationFrame(g.raf))
      }
    })
    q.sizes = () => ({ css: [g.cssW, g.cssH], scene: [g.canvas.width, g.canvas.height], layer: [c.width, c.height], bytes: c.width * c.height * 4 })
    q.flush = (prev) => Object.fromEntries(Object.keys(prev).map(key => [key, q.totals[key] - prev[key]]))
    if (pixels) q.image = async () => {
      const { data } = hud.getImageData(0, 0, c.width, c.height)
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('')
      return { sha, blank: !data.some(Boolean), size: q.sizes(), words: [...q.words] }
    }
  }, pixels)
  await button('ENGAGE'); await phase('playing')
  await wait(() => !document.querySelector('.sr-ronin-reveal'))
  const first = await page.evaluate(() => window.hudQA.starts[0])
  assert.deepEqual([first.frame.kind, first.frame.time, first.frame.hp, first.frame.seed, first.frame.hud, first.clears], ['canvas', 0, 100, 42, 'layer', 1])
  assert.ok(first.frame.threats > 0)
  if (pixels) {
    const opening = await page.evaluate(() => window.hudQA.image())
    assert.ok(!opening.blank && opening.words.includes('60 FPS'))
    const samples = await page.evaluate(async () => {
      const g = window.__sr, q = window.hudQA, ctx = g.hudCtx, c = ctx.canvas
      const visits = {}, state = g.buildHudState()
      const build = g.buildHudState
      g.buildHudState = () => state
      const draw = () => { if (!g.paint(0, false)) throw Error('QA pose was not submitted') }
      const tick = (n = 1) => { while (n--) g.frame(g.lastFrame + 1000 / 60) }
      const sample = async (name, action) => {
        const before = { ...q.totals }
        action()
        visits[name] = { ...await q.image(), cost: q.flush(before), hud: g.worldSubmit.hud, hpEase: +g.hud.hpDisplay.toFixed(6) }
      }
      await sample('same-playing', () => { state.runTime += .001; draw(); draw() })
      g.pause(); tick()
      const pausedId = g.worldSubmit.id
      await sample('same-paused', () => tick(8))
      if (g.worldSubmit.id !== pausedId) throw Error('Unexpected paused scene repaint')
      await sample('scene-scale-only', () => { g.setDiagnosticRenderScale(.85); tick() })
      await sample('cues', () => {
        Object.assign(state, { hp: 18, shield: 20, dashCharge: .56, stamina: 124, meter: 75, ultReady: false,
          banner: { title: 'NIGHT WATCH', sub: 'FLOW HELD', color: '#dece9e', t: .23, dur: 1 },
          boss: { hp: 412, maxHp: 600, name: 'GEMINI MK-II' },
          buff: { name: 'NIGHT EDGE', seconds: 5 }, executePrompt: { x: g.cssW * .37, y: g.cssH * .66 },
          terminal: { x: g.cssW * .74, y: g.cssH * .83, progress: .61, buff: 'RUN FLUX' } })
        Object.assign(state.combo, { hits: 18, rank: 'B', rankUpT: .25, timer: 1.7, mult: 2.5 })
        tick()
      })
      await sample('easing', () => tick(9))
      await sample('moved-cues', () => { state.executePrompt.x = g.cssW * .64; state.terminal.y += 17; state.terminal.progress = .91; draw() })
      await sample('expired', () => {
        state.executePrompt = null; state.terminal = undefined; state.banner.t = 1; state.boss = null; state.buff = undefined
        state.showFps = false; state.shield = 0; state.dashCharge = 0
        draw()
      })
      g.viewport.style.setProperty('--sr-inset-left', '17px')
      g.viewport.style.setProperty('--sr-inset-top', '24px')
      await sample('insets', () => { g.resize(); draw() }) // live, shared insets in state
      await sample('touch-mode', () => { state.touch = !state.touch; draw() })
      await sample('context-restored', () => {
        // A restored context can have a blank backing at the same size.
        c.width = c.width; c.dispatchEvent(new Event('contextrestored')); draw()
      })
      await sample('inspected', () => { window.__srInspect.setView('solo'); draw(); draw() })
      window.__srInspect.setView('off')
      await sample('leave-inspector', draw)
      await sample('context-lost', () => {
        ctx.isContextLost = () => true; c.dispatchEvent(new Event('contextlost')); draw(); draw()
      })
      delete ctx.isContextLost
      await sample('leave-fallback', () => { c.dispatchEvent(new Event('contextrestored')); draw() })
      g.buildHudState = build
      q.pausedTick = tick
      return visits
    })
    for (const [name, n] of [['same-playing', 2], ['same-paused', 8], ['scene-scale-only', 1]]) {
      const s = samples[name]
      assert.equal(s.cost.clears, control ? n : 0, name)
      assert.equal(s.sha, opening.sha, name)
      if (!control) assert.deepEqual(s.cost, { clears: 0, pixels: 0, text: 0, rects: 0 }, name)
    }
    assert.ok(samples.cues.words.includes('CHARGING 56%') && samples.cues.words.includes(touch ? 'TAP EXEC' : 'E  EXECUTE') &&
      samples.cues.words.includes(touch ? 'TAP SERVICE' : 'HOLD E  1.5s') && samples.cues.words.includes('NIGHT WATCH'))
    assert.ok(samples.easing.hpEase < samples.cues.hpEase && samples.easing.hpEase > 18)
    assert.equal(samples.easing.cost.clears, 9)
    assert.notEqual(samples['moved-cues'].sha, samples.easing.sha)
    for (const label of ['CHARGING 56%', 'TAP EXEC', 'E  EXECUTE', 'TAP SERVICE', 'HOLD E  1.5s', 'NIGHT WATCH', 'GEMINI MK-II', '60 FPS'])
      assert.ok(!samples.expired.words.includes(label), label)
    assert.equal(samples.inspected.hud, 'world'); assert.equal(samples['context-lost'].hud, 'world')
    assert.equal(samples.inspected.cost.clears, 0); assert.equal(samples['context-lost'].cost.clears, 0)
    for (const name of ['context-restored', 'leave-inspector', 'leave-fallback']) {
      assert.equal(samples[name].hud, 'layer', name)
      assert.equal(samples[name].cost.clears, 1, name)
      assert.equal(samples[name].sha, samples['touch-mode'].sha, name)
    }
    await page.setViewport({ ...viewport, width: viewport.width - 37, height: viewport.height + 19 })
    await wait(() => window.__sr.cssW === innerWidth && window.__sr.cssH === innerHeight)
    const resized = await page.evaluate(async () => { window.hudQA.pausedTick(); return window.hudQA.image() })
    await page.setViewport({ ...viewport, width: viewport.width - 37, height: viewport.height + 19, deviceScaleFactor: touch ? 1.5 : 1.25 })
    // Chromium can change DPR without firing ResizeObserver. Give the
    // control's paused world the same explicit resize notification.
    const resizeDpr = await page.evaluate(async () => {
      window.__sr.resize(); window.hudQA.pausedTick()
      return window.hudQA.image()
    })
    assert.deepEqual(resizeDpr.size.css, resized.size.css)
    assert.notDeepEqual(resizeDpr.size.layer, resized.size.layer)
    await page.evaluate(() => {
      const g = window.__sr
      g.player.hp = 0; g.paint(0, false); g.gameOver()
      // Restart the sole stopped callback while the Results card is up.
      g.raf = requestAnimationFrame(g.loop)
    })
    await phase('gameover'); await button('RETRY'); await phase('playing')
    const retry = await page.evaluate(async () => ({ ...window.hudQA.starts[1], image: await window.hudQA.image() }))
    assert.deepEqual([retry.frame.kind, retry.frame.time, retry.frame.hp, retry.frame.seed, retry.frame.hud, retry.clears], ['canvas', 0, 100, 43, 'layer', 1])
    assert.ok(retry.words.includes('100') && retry.words.includes('60 FPS'))
    await page.evaluate(() => {
      const g = window.__sr
      g.quitToMenu(); g.frame(g.lastFrame + 16); g.frame(g.lastFrame + 16)
    })
    await wait(() => !!document.querySelector('[data-title-menu][data-title-ready]'))
    const end = await page.evaluate(async () => {
      const g = window.__sr, q = window.hudQA
      const title = await q.image(), visibility = getComputedStyle(g.hudCtx.canvas).visibility
      g.destroy()
      return { title, visibility, trusted: q.trusted, surfaces: g.resourceSnapshot().surfaces }
    })
    assert.ok(end.title.blank && end.visibility === 'hidden', JSON.stringify(end))
    assert.deepEqual(end.trusted, [['ENGAGE', true], ['RETRY', true]])
    assert.equal(end.surfaces, 0)
    return { control, first, opening, samples, resized, resizeDpr, retry, ...end }
  }

  const pacing = await page.evaluate(async ({ frames, warm }) => {
    const g = window.__sr, q = window.hudQA, state = g.buildHudState.bind(g)
    g.qaMode = true; g.enemies.length = 0; g.fx.clear(); g.banner = null
    g.player.reset(660); g.cam.startOnRoad(660); g.bg.advanceActiveTicks(260, 1)
    const stats = numbers => {
      const a = [...numbers].sort((l, r) => l - r), at = p => +a[Math.ceil(a.length * p) - 1].toFixed(3)
      return { p50: at(.5), p95: at(.95), p99: at(.99), mean: +((a.reduce((sum, x) => sum + x, 0)) / a.length).toFixed(3) }
    }
    let hidden = document.hidden
    const onVisibility = () => { if (document.hidden) hidden = true }
    document.addEventListener('visibilitychange', onVisibility)
    const run = async (busy) => {
      const start = g.player.x, worldStart = g.worldSubmit.id, size = q.sizes(), epoch = performance.now()
      let i = 0, last = undefined, totals
      const raf = [], js = [], hud = []
      g.lastFrame = epoch
      if (busy) {
        const w = g.cssW, h = g.cssH
        g.hud.reset()
        // Deterministic busy ink on top of the same real low-scale world.
        // A separate no-readback run, not a combat/balance benchmark.
        g.buildHudState = () => {
          const s = state(), pulse = i % 60 / 60
          Object.assign(s, { hp: 18, stamina: 108 + 60 * pulse, dashCharge: pulse,
            boss: { hp: 450 - i, maxHp: 600, name: 'GEMINI MK-II' }, buff: { name: 'NIGHT EDGE', seconds: 8 - (i / 60 | 0) },
            executePrompt: { x: w * .33 + pulse * 44, y: h * .68 }, terminal: { x: w * .73, y: h * .86, progress: pulse, buff: 'RUN FLUX' },
            banner: { title: 'GATE LOCKED', sub: 'SECTOR 03', color: '#ffd09f', t: .08 + pulse * .3, dur: .6 } })
          Object.assign(s.combo, { hits: 35, rank: 'S', timer: 2 - pulse, mult: 4.5, rankUpT: .3 - pulse })
          return s
        }
        g.input.setVirtualAxis(1, 0)
      }
      await new Promise((resolve, reject) => {
        const frame = now => {
          try {
            if (i === warm) totals = { ...q.totals }
            q.ms = 0
            const t = performance.now()
            g.frame(epoch + (i + 1) * 1000 / 60) // deterministic inputs/weather; measure real callback spacing
            const work = performance.now() - t
            if (i >= warm) { raf.push(now - last); js.push(work); hud.push(q.ms) }
            last = now
            if (++i < warm + frames) requestAnimationFrame(frame)
            else resolve()
          } catch (error) { reject(error) }
        }
        requestAnimationFrame(frame)
      })
      g.input.setVirtualAxis(0, 0)
      return { frames, worldSubmits: g.worldSubmit.id - worldStart - warm, size, start, end: g.player.x,
        cost: q.flush(totals), raf: stats(raf), js: stats(js), hudJs: stats(hud), over50: raf.filter(gap => gap > 50).length }
    }
    const quiet = await run(false), busy = await run(true), errors = g.frameErrors
    document.removeEventListener('visibilitychange', onVisibility)
    g.destroy()
    return { quiet, busy, errors, hidden, surfaces: g.resourceSnapshot().surfaces, trusted: q.trusted }
  }, { frames, warm })
  assert.equal(pacing.hidden, false); assert.equal(pacing.errors, 0); assert.equal(pacing.surfaces, 0)
  assert.deepEqual(pacing.trusted, [['ENGAGE', true]])
  assert.ok(pacing.quiet.end === pacing.quiet.start && pacing.busy.end > pacing.busy.start + 50)
  assert.deepEqual([pacing.quiet.worldSubmits, pacing.busy.worldSubmits], [frames, frames])
  assert.equal(pacing.quiet.cost.clears, control ? frames : 0)
  assert.equal(pacing.busy.cost.clears, frames)
  return { control, first, ...pacing }
})
