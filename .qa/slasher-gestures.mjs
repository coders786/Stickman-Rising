/** Headless browser gesture/lifecycle smoke. --touch uses CDP touch events;
 * desktop forces the fine-pointer media query if headless reports no pointer.
 * Visibility, defeat, HP and a held prep are QA injections.
 * Audio, the React buttons, keyboard and touch controls are not stubbed. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const bundled = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
const touch = process.argv.includes('--touch')
const viewport = touch
  ? { width: 400, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { width: 1000, height: 560, deviceScaleFactor: 1 }
const browser = await puppeteer.launch({
  executablePath: process.env.SR_BROWSER_EXECUTABLE || await bundled.executablePath(),
  args: [...(bundled?.args ?? []), ...(process.argv.includes('--cpu-compositor') ? ['--disable-gpu-compositing'] : [])],
  protocolTimeout: 120_000,
})
try {
  const p = await browser.newPage(), errors = []
  p.setDefaultTimeout(40_000)
  p.on('pageerror', error => errors.push(String(error)))
  p.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(msg.text()) })
  if (!touch) await p.evaluateOnNewDocument(() => {
    const media = window.matchMedia.bind(window)
    window.matchMedia = query => {
      const result = media(query)
      if (query === '(pointer: fine)') Object.defineProperty(result, 'matches', { value: true })
      return result
    }
  })
  await p.setViewport(viewport)
  await p.goto(process.env.SR_QA_URL || 'http://localhost:3000/', { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => window.__sr?.phase === 'attract' && window.__sr.bg.built)
  const button = async name => {
    const handle = await p.waitForFunction(label => [...document.querySelectorAll('button')]
      .find(b => !b.disabled && (b.getAttribute('aria-label') || b.textContent.trim()) === label && b.getClientRects().length), {}, name)
    const el = handle.asElement()
    assert.ok(el, name)
    try { await (touch ? el.tap() : el.click()) } finally { await handle.dispose() }
  }
  const wait = fn => p.waitForFunction(fn).then(handle => handle.dispose())
  const paint = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const phase = value => p.waitForFunction(value => window.__sr.phase === value, {}, value).then(handle => handle.dispose())
  const hidden = value => p.evaluate(value => {
    if (value) Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    else Reflect.deleteProperty(document, 'hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
  await p.evaluate(() => {
    const g = window.__sr
    g.autoQuality = false
    g.qaMode = true
    g.applySettings({ ...g.settings, muted: false })
    const trace = window.slasherTrace = { starts: 0, lightEdges: 0, clicks: [], phases: [] }
    window.addEventListener('click', e => {
      const label = e.target.closest('button')?.textContent.trim()
      if (['ENGAGE', 'RETRY', 'CANCEL'].includes(label)) {
        trace.clicks.push([label, e.isTrusted, navigator.userActivation.isActive])
      }
    }, true)
    g.on(e => {
      if (e.type === 'runStarted') trace.starts++
      if (e.type === 'phase') trace.phases.push(e.phase)
    })
    const step = g.step.bind(g)
    g.step = dt => {
      if (g.input.pressed('light')) trace.lightEdges++
      return step(dt)
    }
  })
  await hidden(true)
  await button('ENGAGE')
  await phase('preparing')
  await wait(() => Boolean(document.getElementById('preparing-title')))
  await p.keyboard.press('j') // must not become the new run's first edge
  const pending = await p.evaluate(() => {
    const g = window.__sr
    const old = g.bg.getProfile().seed
    const duplicate = g.requestRun('katana')
    g.applySettings({ ...g.settings, quality: 'low' })
    const seed = g.pendingRun.seed
    const expected = seed
    return { old, duplicate, seed, expected }
  })
  await paint()
  assert.equal(pending.duplicate, false)
  assert.deepEqual(await p.evaluate(() => [window.slasherTrace.starts, window.__sr.bg.getProfile().seed]), [0, pending.old])
  await hidden(false)
  await phase('playing')
  await wait(() => window.__sr.audio.graph?.ctx.state === 'running' && window.__sr.audio.timer !== null)
  const engage = await p.evaluate(() => {
    const g = window.__sr
    return { seed: g.bg.getProfile().seed, requested: g.lastRunSeed, route: g.renderer.forward, tier: g.settings.quality,
      starts: window.slasherTrace.starts, lightEdges: window.slasherTrace.lightEdges, plates: g.bg.plateStats() }
  })
  assert.equal(engage.seed, pending.expected)
  assert.equal(engage.requested, pending.seed)
  assert.equal(engage.route, !touch)
  assert.equal(engage.tier, 'low')
  assert.equal(engage.starts, 1)
  assert.equal(engage.lightEdges, 0)
  const attack = () => touch ? button('SLASH') : p.keyboard.press('j')
  await attack()
  await wait(() => window.slasherTrace.lightEdges === 1)
  await paint()

  // The vitality plate is now direct HUD ink. Damage must update the live
  // value before the trailing fill, without building a viewport-sized store.
  const lowHp = await p.evaluate(async () => {
    const g = window.__sr, initial = g.hud.hpDisplay
    // Optics/raster now stream during the opener. Other owners may admit
    // or retire a route plate mid-fixture; measure HUD allocations only.
    const hudBytes = () => g.resourceSnapshot().entries.filter(e => e.tag.toLowerCase().includes('hud')).reduce((n,e)=>n+e.bytes,0)
    const backing = g.hudCtx.canvas, bytes = hudBytes()
    g.player.hp = 10
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
    return { hp: g.player.hp, initial, delayed: g.hud.hpDisplay, stableBacking: g.hudCtx.canvas === backing,
      before: [g.cssW, backing.width], bytesAdded: hudBytes() - bytes }
  })
  assert.ok(lowHp.hp === 10 && lowHp.delayed < lowHp.initial && lowHp.delayed > 10 && lowHp.stableBacking)
  assert.equal(lowHp.bytesAdded, 0)
  await p.setViewport({ ...viewport, width: viewport.width - 16 })
  await p.waitForFunction(w => window.__sr.hudCtx.canvas.width !== w, {}, lowHp.before[1]).then(handle => handle.dispose())

  await p.evaluate(() => {
    const g = window.__sr
    const receipt = window.slasherPaused = { scene: 0, hud: 0 }
    g.player.hp = g.player.maxHp
    g.hud.reset() // settled health for the zero-ink-work test; easing tested above
    const drawScene = g.renderer.draw.bind(g.renderer), clearHud = g.hudCtx.clearRect.bind(g.hudCtx)
    g.renderer.draw = (...args) => { receipt.scene++; return drawScene(...args) }
    g.hudCtx.clearRect = (...args) => { receipt.hud++; return clearHud(...args) }
  })
  if (touch) await button('Pause')
  else await p.keyboard.press('p')
  await phase('paused')
  await paint()
  const pauseProbe = (retain = true) => p.evaluate(async retain => {
    const g = window.__sr, count = window.slasherPaused
    g.retainPausedScene = retain
    const tick = () => g.bg.weatherState()?.tick ?? g.storm.snapshot.time
    const begin = { ...count }, time = g.time, weather = tick()
    for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame)
    return { scene: count.scene - begin.scene, hud: count.hud - begin.hud,
      frozen: g.time === time && tick() === weather }
  }, retain)
  const paused = await pauseProbe()
  const pauseControl = await pauseProbe(false)
  assert.ok(paused.frozen && pauseControl.frozen)
  assert.equal(paused.scene, 0)
  assert.equal(paused.hud, 0, 'a settled paused HUD should not clear')
  assert.ok(pauseControl.scene >= 7)
  const invalidation = await p.evaluate(async () => {
    const g = window.__sr, count = window.slasherPaused
    g.retainPausedScene = true
    const before = count.scene, night = g.bg.getProfile()
    g.applySettings({ ...g.settings, quality: 'high' })
    // Simulate restoration of a blank backing on the same-sized canvas.
    g.canvas.width = g.canvas.width
    g.canvas.dispatchEvent(new Event('contextrestored'))
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
    return { scene: count.scene - before, sameNight: g.bg.getProfile() === night,
      alpha: g.ctx.getImageData(2, 2, 1, 1).data[3], rgb: [...g.ctx.getImageData(2, 2, 1, 1).data].slice(0, 3) }
  })
  assert.equal(invalidation.scene, 1, 'multiple invalidations should coalesce')
  assert.equal(invalidation.sameNight, true)
  assert.ok(invalidation.rgb.some(Boolean), 'restored backing is blank')
  // Inspect mode still draws on each editor frame and gets one clean repaint
  // on exit. Measure the transition before resuming actual input.
  await p.evaluate(() => window.__srInspect.setView('edit'))
  const editor = await pauseProbe()
  assert.ok(editor.scene >= 7)
  await p.evaluate(() => window.__srInspect.setView('off'))
  await paint()
  await hidden(true)
  const hiddenPause = await pauseProbe()
  assert.equal(hiddenPause.scene + hiddenPause.hud, 0)
  await hidden(false)
  await button('RESUME')
  await phase('playing')
  await attack()
  await wait(() => window.slasherTrace.lightEdges === 2)
  await paint()

  // Keep the acknowledged request uncommitted using the real visibility
  // guard. A cancelled Retry must not reseed or spin up a new worker lane.
  await p.evaluate(() => window.__sr.gameOver())
  await hidden(true)
  const before = await p.evaluate(() => {
    const g = window.__sr
    window.heldStream = g.bg.bridgeStream()
    return g.bg.getProfile().seed
  })
  await button('RETRY'); await phase('preparing'); await paint()
  assert.equal(await p.evaluate(() => window.__sr.audio.timer), null, 'Retry stops Results audio under the loader')
  await button('CANCEL'); await phase('gameover')
  assert.deepEqual(await p.evaluate(() => {
    const g = window.__sr
    const w = g.bg.bridgeStream().window
    return [g.bg.getProfile().seed, g.audio.timer, !w || w.seed === g.lastRunSeed,
      g.bg.bridgeStream() === window.heldStream, g.pendingRun, window.slasherTrace.starts]
  }), [before, null, true, true, null, 1])
  await hidden(false)
  await button('RETRY')
  await phase('playing')
  const retry = await p.evaluate(() => ({ ...window.__sr.bg.plateStats(), audio: window.__sr.audio.graph?.ctx.state }))
  assert.equal(retry.audio, 'running')
  await attack()
  await wait(() => window.slasherTrace.lightEdges === 3)
  await paint()

  // A separate Game mounts the same output canvases after destruction. An
  // outstanding request on the old game must never overwrite the new owner.
  await p.evaluate(() => window.__sr.gameOver())
  await hidden(true)
  await button('RETRY'); await phase('preparing')
  const teardown = await p.evaluate(() => {
    const old = window.__sr
    const request = old.pendingRun, stream = old.bg.bridgeStream()
    old.destroy()
    const storesReleased = old.resourceSnapshot().surfaces === 0
    const workersReleased = !stream.running && stream.window === null && stream.indices().length === 0
    const next = new old.constructor()
    next.mount(old.mountCanvas ?? old.canvas, old.hudCtx.canvas)
    return { queued: Boolean(request), workersReleased,
      oldDestroyed: old.destroyed, pending: old.pendingRun,
      newOwner: window.__sr === next, storesReleased }
  })
  await hidden(false)
  await wait(() => window.__sr.bg.built)
  const trace = await p.evaluate(() => {
    window.__sr.destroy()
    return window.slasherTrace
  })
  assert.deepEqual(teardown, { queued: true, workersReleased: true,
    oldDestroyed: true, pending: null, newOwner: true, storesReleased: true })
  assert.equal(trace.starts, 2)
  assert.equal(trace.lightEdges, 3)
  assert.ok(trace.clicks.length >= 2 && trace.clicks.every(([, trusted, active]) => trusted && active))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ browser: await browser.version(), touch, engage, retry, cancelledUncommittedRoute: true, lowHp, paused, pauseControl, invalidation, editor, hiddenPause, teardown, trace }, null, 2))
} finally {
  await browser.close()
}
