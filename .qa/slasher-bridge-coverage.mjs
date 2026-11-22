/** Compositor-level proof. Uses browser screenshots, not canvas.toDataURL or
 * GL readPixels, and freezes the callback so image and sim receipt are paired.
 * --denied holds/denies optional fetches and both lanes. --gl tests real loss. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { withBridge, viewport, touch } from './bridge-browser.mjs'

const denied = process.argv.includes('--denied'), glTest = process.argv.includes('--gl'), shots = process.env.SR_SHOTS
const legacy = process.argv.includes('--baseline')
if (shots) await mkdir(shots, { recursive: true })
await withBridge(async ({ page, open, button, phase, wait, frames }) => {
  if (!touch) await page.setViewport({ ...viewport, width: glTest ? 716 : 896, height: glTest ? 466 : 564 })
  const delayed = []
  let denyNow = false
  if (denied) {
    await page.setRequestInterception(true)
    page.on('request', r => {
      if (!new URL(r.url()).pathname.startsWith('/bridge/')) return r.continue()
      if (!denyNow) { delayed.push(r); return }
      return r.respond({ status: 404, body: '' })
    })
  }
  await page.evaluateOnNewDocument(({ denied, glTest }) => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: glTest ? 'ultra' : 'medium', adaptiveQuality: false, muted: true, shake: false }))
    if (denied) window.Worker = class { constructor() { throw Error('QA worker denied') } }
  }, { denied, glTest })
  await open()
  await page.evaluate(({ glTest, legacy }) => {
    const g = window.__sr
    const request = g.requestRun.bind(g), draw = g.renderer.draw.bind(g.renderer), emergency = g.renderer.drawBridgeEmergency?.bind(g.renderer)
    let seed = 42, muteBodies = false
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = seed++; return ok }
    if (glTest) { g.allowDiagnosticMaster(); g.setDiagnosticRenderScale(1) }
    g.on(e => {
      if (e.type === 'phase' && e.phase === 'playing') queueMicrotask(() => cancelAnimationFrame(g.raf))
    })
    const snap = () => {
      const frame = g.graphicsPresentation().frame
      const ink = document.querySelector('[data-bridge-recovering]')
      const r = g.graphicsPresentation()
      const body = a => [a.geom.headC, a.geom.chest, a.geom.kneeR].map(j => g.project(a.x + a.face * a.scale * j.x, a.hipY + a.scale * j.y))
      const threats = g.enemies.filter(e => !e.spawning && !e.dead).map(e => ({ body: body(e), tell: g.project(e.x, e.hipY - 78 * e.scale - 4), state: e.state }))
      return { frame, hp: g.player.hp, sim: g.time, width: g.cssW, height: g.cssH, held: !!ink,
        path: r.path, fallback: r.fallbackLayer, fallbackReady: r.fallbackReady,
        fallbackSize: r.fallbackLayer ? [...document.querySelectorAll('canvas')].filter(c => c.dataset.renderLayer === r.fallbackLayer).map(c => [c.width, c.height])[0] : null,
        hero: body(g.player), threats, insets: g.insets, road: [g.project(g.cam.x, -32).y, g.project(g.cam.x, 39).y] }
    }
    const freezeBodies = (yes) => {
      if (yes === muteBodies) return
      muteBodies = yes
      for (const a of [g.player, ...g.enemies]) {
        if (yes) { a.qaRealDraw = a.draw; a.draw = () => {} }
        else if (a.qaRealDraw) { a.draw = a.qaRealDraw; delete a.qaRealDraw }
      }
    }
    const stub = (ctx, _world, w, h) => { ctx.fillStyle = '#16191c'; ctx.fillRect(0, 0, w, h); throw Error('QA interrupted after the sky') }
    window.coverageQA = { snap, draw: (provisional = false) => g.paint(0, false, provisional), freezeBodies,
      tick(n = 1) { for (let i = 0; i < n; i++) g.frame(g.lastFrame + 1000 / 60 + .011); return snap() },
      fault(kind) {
        g.renderer.draw = kind ? stub : draw
        if (!legacy) g.renderer.drawBridgeEmergency = kind === 'both' ? stub : emergency
      },
      pose() {
        g.qaMode = true; g.hitstopT = 0; g.fx.clear(); g.projectiles.clear(); g.banner = null
        const p = g.player, x = 240
        p.reset(x); g.cam.startOnRoad(x); Object.assign(g.bg.routeWeather.clock.sample, { rain: .34, wet: .48, cloud: .5, fog: .52 })
        p.hp = 92
        const e = g.enemies[0]; if (!e) throw Error('No threat at entry')
        g.enemies.length = 1
        e.x = e.px = x + 102; e.y = e.py = 0; e.state = 'windup'; e.stateT = .25
        e.buildPose(0, 0); e.projectPose?.()
        g.debugSpawn('grunt', x - 91); g.enemies.at(-1).arriveOnRoute(1)
        g.paint(0, false)
        return snap()
      },
    }
  }, { glTest, legacy })
  const capture = async label => {
    await frames()
    const state = await page.evaluate(() => window.coverageQA.snap())
    const png = await page.screenshot({ captureBeyondViewport: false })
    assert.deepEqual(await page.evaluate(() => window.coverageQA.snap()), state, `sim or frame changed during ${label}`)
    if (shots) await writeFile(join(shots, `${label}.png`), png)
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const pixelRect = (x0, y0, x1, y1, visit) => {
      const x = Math.max(0, Math.floor(x0 * info.width / state.width)), y = Math.max(0, Math.floor(y0 * info.height / state.height))
      const r = Math.min(info.width, Math.ceil(x1 * info.width / state.width)), b = Math.min(info.height, Math.ceil(y1 * info.height / state.height))
      let count = 0
      for (let v = y; v < b; v++) for (let u = x; u < r; u++) { visit((v * info.width + u) * 3, (u + .5) * state.width / info.width); count++ }
      return count
    }
    let hole = 0, black = 0, bareBlack = 0, bareRoad = 0, warning = 0, hpInk = 0
    const skyTone = new Set(), roadTone = new Set(), w = state.width, h = state.height
    pixelRect(w * .09, h * .12, w * .63, h * .31, i => skyTone.add(data[i] >> 1))
    // Keep the exposed road check independent of the literal black figures,
    // which can occupy several percent of the narrow portrait road sample.
    const figures = [state.hero, ...state.threats.map(t => t.body)].map(j => {
      const xs = j.map(p => p.x); return [Math.min(...xs) - 22, Math.max(...xs) + 22]
    })
    const roadPx = pixelRect(w * .14, state.road[0], w * .83, state.road[1], (i, x) => {
      const [r, g, b] = data.subarray(i, i + 3), dark = +(r < 5 && g < 5 && b < 5)
      roadTone.add(r >> 1); hole += +(r === 22 && g === 25 && b === 28); black += dark
      if (!figures.some(([l, r]) => x >= l && x <= r)) { bareRoad++; bareBlack += dark }
    })
    for (const a of state.threats) if (a.state === 'windup') pixelRect(a.tell.x - 18, a.tell.y - 17, a.tell.x + 18, a.tell.y + 20,
      i => { warning += +(data[i] > 146 && data[i] > 1.48 * data[i + 1] && data[i] > 1.19 * data[i + 2]) })
    assert.ok(bareRoad > 200 && skyTone.size > 5 && roadTone.size > 6 && hole / roadPx < .03 && bareBlack / bareRoad < .03,
      `${label}: no complete sky+road (${[skyTone.size, roadTone.size, hole, bareBlack, bareRoad]})`)
    // Actual HUD color in the bar, not a witness about the canvas size.
    const top = (state.insets?.top ?? 0) + 16, left = (state.insets?.left ?? 0) + 16, span = w - left - 16 - (state.insets?.right ?? 0)
    const bar = (span < 580 ? Math.round(span * .37) : Math.min(264, Math.round(span * .33))) - 16
    pixelRect(left + 8, top + 23, left + 8 + bar, top + 27, i => { hpInk += +(data[i] === 255 && data[i+1] === 102 && data[i+2] === 126) })
    if (!state.held) {
      const expected = bar * 4 * info.width * info.height / (w * h) * state.hp / 100
      assert.ok(hpInk >= expected * .84 && hpInk <= expected * 1.09, `${label}: wrong composed HP bar (${hpInk}/${expected})`)
    } else assert.equal(hpInk, 0, `${label}: held pose with a live HUD`)
    return { state, image: { hpInk, skyTones: skyTone.size, roadTones: roadTone.size, hole, black, roadPx, bareBlack, bareRoad, warning }, data, pixelRect }
  }
  const rows = []
  const record = async (label, bodyWitness = false, provisional = false) => {
    const full = await capture(label)
    if (!legacy) assert.equal(full.state.frame.hp, full.state.hp, `${label}: HUD/sim receipt mismatch`)
    if (bodyWitness) {
      await page.evaluate(provisional => { const q = window.coverageQA; q.freezeBodies(true); q.draw(provisional) }, provisional)
      const clean = await capture(`${label}-no-bodies`)
      const visible = full.state.threats.filter(t => t.body[0].x > 15 && t.body[0].x < full.state.width - 15)
      for (const [i, joints] of [full.state.hero, ...visible.map(t => t.body)].entries()) {
        const counts = []
        for (const [part, { x, y }] of joints.entries()) {
          let differs = 0
          const tested = full.pixelRect(x - 9, y - 8, x + 9, y + 8, k => {
            differs += +(Math.abs(full.data[k] - clean.data[k]) + Math.abs(full.data[k + 1] - clean.data[k + 1]) + Math.abs(full.data[k + 2] - clean.data[k + 2]) > 30)
          })
          assert.ok(differs > tested * .045 && differs >= 8, `${label}: body ${i}/${part} not present in composed view (${differs}/${tested}, ${x}, ${y})`)
          counts.push(differs)
        }
        ;(full.image.bodies ??= []).push(counts)
      }
      await page.evaluate(provisional => { const q = window.coverageQA; q.freezeBodies(false); q.draw(provisional) }, provisional)
    }
    rows.push({ label, ...full.state, image: full.image })
    return full
  }
  await button('ENGAGE')
  if (denied) {
    if (!legacy) {
      await wait(() => window.__sr.pendingRun?.initialized && document.querySelector('.sr-interlude-signal')?.dataset.stage === 'background')
      assert.equal(await page.evaluate(() => window.__sr.time), 0)
    } else await phase('playing')
    assert.ok(delayed.length > 0)
    denyNow = true
    await Promise.all(delayed.map(r => r.respond({ status: 404, body: '' })))
  }
  await phase('playing')
  // The simulation callback is already frozen on submit. Let only the
  // decorative veil clear so the compositor exposes that same tick-zero draw.
  await wait(() => !document.querySelector('.sr-ronin-reveal, .sr-crossing-online'))
  const first = await record('engage', !glTest && !legacy)
  assert.equal(first.state.sim, 0)
  assert.ok(first.state.threats.length >= 1, 'real opening threat required')
  if (!legacy) assert.equal(first.state.frame.threats, first.state.threats.length)
  if (!legacy) assert.ok(['canvas', 'webgl'].includes(first.state.frame.kind), 'full opening background at tick zero')

  if (glTest) {
    await page.evaluate(async () => {
      const g = window.__sr, deadline = performance.now() + 60_000
      while (g.graphicsPresentation().path !== 'master-webgl2' || !g.renderer.bridgeFinish.pipe?.skyFrame) {
        if (performance.now() >= deadline) throw Error('Master admission timeout')
        g.paint(0, false); await new Promise(requestAnimationFrame)
      }
      window.coverageQA.pose()
    })
    await record('master', true)
    const loss = await page.evaluate(async () => {
      const g = window.__sr, q = window.coverageQA, pipe = g.renderer.bridgeFinish.pipe, ext = pipe.gl.getExtension('WEBGL_lose_context')
      if (!ext) throw Error('loss extension unavailable')
      window.restoreBridge = () => ext.restoreContext()
      const lost = new Promise(resolve => pipe.canvas.addEventListener('webglcontextlost', resolve, { once: true }))
      ext.loseContext(); await lost
      return { before: g.time, recovery: q.tick() }
    })
    assert.equal(loss.before, loss.recovery.sim, 'stepped before repainting a lost GL frame')
    await record('context-lost-canvas', true, true)
    await page.evaluate(() => window.restoreBridge())
    await wait(() => !window.__sr.renderer.bridgeFinish.lost)
    await page.evaluate(async () => {
      const g = window.__sr, deadline = performance.now() + 60_000
      while (g.graphicsPresentation().path !== 'master-webgl2') {
        if (performance.now() >= deadline) throw Error('Context restore timeout')
        g.paint(0, false); await new Promise(requestAnimationFrame)
      }
    })
    await record('context-restored')
    await page.evaluate(() => window.__sr.preferDiagnosticMobile())
    await page.evaluate(async () => {
      const g = window.__sr, deadline = performance.now() + 60_000
      while (g.graphicsPresentation().path !== 'mobile-webgl2') {
        if (performance.now() >= deadline) throw Error('Tier handoff timeout')
        g.paint(0, false); await new Promise(requestAnimationFrame)
      }
    })
    await record('optimized')
  } else {
    await page.evaluate(() => window.coverageQA.pose())
    await record('full-canvas')
    if (!legacy) {
      // 2D loss is simulated at the context API. This is independent of the
      // real WebGL loss exercised in the other invocation.
      const noHud = await page.evaluate(() => {
        const g = window.__sr, hud = g.hudCtx, q = window.coverageQA, before = g.time
        hud.isContextLost = () => true
        hud.canvas.dispatchEvent(new Event('contextlost'))
        const held = q.snap().held, recovered = q.tick()
        return { before, held, recovered }
      })
      assert.equal(noHud.before, noHud.recovered.sim)
      assert.ok(noHud.held && !noHud.recovered.held && noHud.recovered.frame.hud === 'world', JSON.stringify(noHud))
      await record('hud-unavailable-inline')
      const paused = await page.evaluate(() => {
        const g = window.__sr, q = window.coverageQA, hud = g.hudCtx
        delete hud.isContextLost
        hud.canvas.dispatchEvent(new Event('contextrestored'))
        g.pause(); const one = q.tick(), two = q.tick(3)
        g.resume()
        return { one: one.frame, two: two.frame }
      })
      assert.deepEqual(paused.one, paused.two)
      assert.equal(paused.one.hud, 'layer')
      await record('hud-restored')
    }
  }
  if (!legacy) {
    await page.evaluate(() => { const q = window.coverageQA; q.fault('normal'); q.draw() })
    const short = await record('interrupted-source', true)
    assert.equal(short.state.frame.kind, 'emergency')
    assert.ok(short.image.warning >= 6, 'missing telegraph in same-turn recovery')
    const hold = await page.evaluate(() => { const q = window.coverageQA; q.fault('both'); return q.tick() })
    assert.ok(hold.held)
    assert.equal(hold.frame.id, short.state.frame.id + 2) // only the body-oracle redraws advanced coverage
    assert.equal(hold.hp, 92)
    const held = await page.evaluate(() => window.coverageQA.tick(30))
    assert.deepEqual([held.sim, held.hp, held.frame.id], [hold.sim, hold.hp, hold.frame.id], 'combat behind a failed presentation')
    const resize = touch ? { ...viewport, width: 428, height: 800 } : { ...viewport, width: 980, height: 590 }
    await page.setViewport(resize); await frames()
    const resized = await capture('held-after-resize')
    rows.push({ label: 'held-after-resize', ...resized.state, image: resized.image })
    assert.ok(resized.state.held)
    assert.deepEqual([resized.state.sim, resized.state.hp, resized.state.frame.id, resized.state.fallbackSize],
      [hold.sim, hold.hp, hold.frame.id, hold.fallbackSize], 'resize must not erase/resize the retained frame')
    // Press Jump while the last pose is retained. It must not be delivered
    // to the resumed simulation after the recovery submit.
    if (touch) await button('JUMP')
    else await page.keyboard.press('Space')
    assert.equal(await page.evaluate(() => window.__sr.input.pressed('jump')), true)
    const fixed = await page.evaluate(() => { const q = window.coverageQA; q.fault(''); return q.tick() })
    assert.equal(fixed.sim, held.sim)
    assert.ok(!fixed.held && fixed.frame.id > held.frame.id)
    await record('recovered')
    const resumed = await page.evaluate(() => {
      const state = window.coverageQA.tick(4), g = window.__sr
      return { time: state.sim, y: g.player.y, stale: g.input.pressed('jump') }
    })
    assert.ok(resumed.time > held.sim && resumed.y === 0 && !resumed.stale, JSON.stringify(resumed))
  }
  await page.evaluate(() => {
    const g = window.__sr; g.qaMode = false; g.gameOver()
    g.lastFrame = performance.now(); g.raf = requestAnimationFrame(g.loop)
  })
  let cancelled = null
  if (!legacy && !glTest) {
    await wait(() => [...document.querySelectorAll('h2')].some(h => h.textContent === 'YOU HAVE FALLEN'))
    const resultCard = () => page.evaluate(() => [...document.querySelectorAll('h2')].find(h => h.textContent === 'YOU HAVE FALLEN')?.parentElement.textContent)
    const text = await resultCard()
    const before = await page.evaluate(() => {
      const q = window.coverageQA
      q.fault('both')
      return q.snap().frame
    })
    await button('RETRY')
    await wait(() => window.__sr.pendingRun?.initialized && window.__sr.graphicsPresentation().held)
    await button('CANCEL'); await phase('gameover'); await frames()
    await page.evaluate(() => window.coverageQA.fault(''))
    await page.setViewport({ ...viewport, width: touch ? 412 : 948, height: touch ? 820 : 572 }); await frames()
    assert.equal(await resultCard(), text)
    cancelled = await page.evaluate(() => {
      const q = window.coverageQA
      const g = window.__sr, r = q.snap()
      return { frame: r.frame, held: r.held, pending: !!g.pendingRun }
    })
    assert.deepEqual(cancelled, { frame: before, held: false, pending: false })
  }
  await button('RETRY'); await phase('playing')
  await wait(() => !document.querySelector('.sr-ronin-reveal, .sr-crossing-online'))
  const retry = await record('retry', !legacy)
  assert.equal(retry.state.sim, 0)
  if (!legacy) {
    assert.deepEqual([retry.state.frame.seed, retry.state.hp], [cancelled ? 44 : 43, 100])
    assert.ok(['canvas', 'webgl'].includes(retry.state.frame.kind), 'full Retry background at tick zero')
  }
  const teardown = await page.evaluate(() => {
    const g = window.__sr; g.destroy()
    return { stores: g.resourceSnapshot().surfaces, coverageBytes: g.graphicsPresentation().coverageBytes,
      hudBytes: g.hudCtx.canvas.width * g.hudCtx.canvas.height * 4 }
  })
  assert.equal(teardown.stores, 0)
  if (!legacy) assert.deepEqual(teardown, { stores: 0, coverageBytes: 0, hudBytes: 0 })
  return { denied, glTest, rows, cancelled, teardown }
})
