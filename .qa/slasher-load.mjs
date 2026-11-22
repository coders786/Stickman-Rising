/** Fresh-page timings for the real title, Engage, and Retry. --touch uses
 * CDP touch input. --early clicks
 * as soon as the menu is ready instead of waiting for the title backdrop.
 * --cpu-compositor disables Chromium's GPU compositor, not WebGL2, to
 * distinguish the sandbox's forced software compositor from the sky baker.
 * --cpu-raster and --cpu-canvas isolate Chromium's tile raster and Canvas2D
 * backends while leaving the compositor enabled. --split-processes removes
 * the packaged shell's in-process renderer and GPU overrides.
 * Uses the disposable browser tools described in slasher-replay.mjs. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const bundled = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
const touch = process.argv.includes('--touch')
const early = process.argv.includes('--early'), cpuCompositor = process.argv.includes('--cpu-compositor')
const cpuRaster = process.argv.includes('--cpu-raster'), cpuCanvas = process.argv.includes('--cpu-canvas')
const splitProcesses = process.argv.includes('--split-processes'), gpuInfo = process.argv.includes('--gpu-info')
const input = process.argv.includes('--input'), sameSeed = process.argv.includes('--same-seed')
const promotion = process.argv.includes('--promotion')
const stages = process.argv.includes('--stages'), assets = process.argv.includes('--asset-stages')
const deny = process.argv.includes('--deny-packed'), trace = process.env.SR_LOAD_TRACE
const url = new URL(process.env.SR_QA_URL || 'http://localhost:3000/')
const inheritedArgs = (bundled?.args ?? []).filter(arg => !splitProcesses || !['--single-process', '--in-process-gpu'].includes(arg))
const browser = await puppeteer.launch({
  executablePath: process.env.SR_BROWSER_EXECUTABLE || await bundled.executablePath(),
  args: [...inheritedArgs, ...(cpuCompositor ? ['--disable-gpu-compositing'] : []),
    ...(cpuCanvas ? ['--disable-accelerated-2d-canvas'] : []), ...(cpuRaster ? ['--disable-gpu-rasterization'] : [])],
  protocolTimeout: 120_000,
})
try {
  const p = await browser.newPage(), errors = []
  p.setDefaultTimeout(45_000)
  p.on('pageerror', error => errors.push(String(error)))
  p.on('console', m => { if (m.type() === 'error' && !(deny && m.text().includes('404'))) errors.push(m.text()) })
  if (deny) {
    await p.setRequestInterception(true)
    p.on('request', r => new URL(r.url()).pathname.startsWith('/bridge/baked-v1/')
      ? r.respond({ status: 404, body: 'denied by fixture' }) : r.continue())
  }
  if (trace) await p.tracing.start({ path: trace, categories: ['devtools.timeline', 'toplevel', 'blink.user_timing', 'cc', 'viz', 'gpu'] })
  await p.evaluateOnNewDocument(({ stages, assets, sameSeed }) => {
    const result = window.srLoad = { menuMs: null, titleSubmitMs: null, titleSceneMs: null, runs: {}, longTasks: [] }
    if (assets) {
      const asset = result.assetStages = []
      const log = (stage, at, detail = {}) => {
        if (asset.length < 1000) asset.push({ stage, at, ms: performance.now() - at, phase: window.__sr?.phase, ...detail })
      }
      const path = url => new URL(url, location.href).pathname
      const read = Response.prototype.arrayBuffer, decode = HTMLImageElement.prototype.decode
      Response.prototype.arrayBuffer = function (...args) {
        const name = path(this.url), at = performance.now()
        const pending = read.apply(this, args)
        if (name.startsWith('/bridge/')) void pending.then(bytes => log('response.bytes', at, { name, bytes: bytes.byteLength }), () => {})
        return pending
      }
      HTMLImageElement.prototype.decode = function (...args) {
        const name = path(this.src), at = performance.now(), pending = decode.apply(this, args)
        if (name.startsWith('/bridge/')) void pending.then(() => log('image.decode', at, { name }), () => log('image.denied', at, { name }))
        return pending
      }
      const WorkerClass = window.Worker
      window.Worker = new Proxy(WorkerClass, { construct(Target, args) {
        const at = performance.now(), w = new Target(...args), name = args[1]?.name
        if (!['bridge-device', 'bridge-bake', 'bridge-art'].includes(name)) return w
        log('worker.create', at, { name })
        if (name === 'bridge-device') { w.addEventListener('message', ({ data }) => log('adapter', at, { result:data })); return w }
        const sent = new Map(), post = w.postMessage, stop = w.terminate
        w.postMessage = function (r, ...args) { sent.set(r.id, performance.now()); return post.call(w, r, ...args) }
        w.terminate = function () { const at = performance.now(); stop.call(w); log('worker.terminate', at, { name }) }
        w.addEventListener('message', ({ data: r }) => {
          log('worker.reply', sent.get(r.id) ?? at, { name, type: r.type, seed: r.seed, bakeMs: r.bakeMs })
          sent.delete(r.id)
        })
        return w
      } })
      const G = WebGL2RenderingContext.prototype
      for (const key of ['texImage2D', 'texImage3D', 'texStorage2D', 'texSubImage2D', 'compressedTexSubImage2D', 'generateMipmap', 'checkFramebufferStatus']) {
        const original = G[key]
        G[key] = function (...args) {
          const at = performance.now()
          try { return original.apply(this, args) }
          finally {
            if (performance.now() - at > .2 || key === 'generateMipmap') log('gl.' + key, at, { w: args.length >= 9 ? args[3] : null, h: args.length >= 9 ? args[4] : null })
          }
        }
      }
    }
    let owner
    Object.defineProperty(window, '__sr', {
      configurable: true, get: () => owner,
      set(game) {
        owner = game
        if (stages) {
          result.stages = []
          const watch = (obj, keys, prefix = '') => {
            for (const key of keys) if (typeof obj[key] === 'function') {
              const prev = obj[key].bind(obj)
              obj[key] = (...args) => {
                const at = performance.now(), phase = game.phase
                try { return prev(...args) } finally {
                  const ms = performance.now() - at
                  if (ms >= .2 && result.stages.length < 400) result.stages.push({ stage: prefix + key, phase, at, ms })
                }
              }
            }
          }
          watch(game, ['prepareRunFrame', 'beginRun', 'paint', 'resetRoute', 'spawnRoadTraffic'])
          watch(game.bg, ['drawArena', 'drawBridgeBackdrop', 'setRunSeed', 'drawRouteWeather', 'warmAttract'], 'bg.')
          watch(game.bg.scenery ?? {}, ['draw', 'get', 'shelterKit', 'drawBelowCity'], 'scenery.')
          watch(game.bg.scenery?.sky ?? {}, ['draw', 'city', 'mist', 'detail'], 'sky.')
          watch(game.renderer.bridgeFinish, ['prepare', 'present'], 'finish.')
          watch(game.renderer.canvasReceivers, ['draw'], 'canvasReceivers.')
          watch(game.renderer.wetStrip, ['draw'], 'wetStrip.')
          watch(game.props, ['draw', 'warm'], 'props.')
          watch(game.audio, ['resume', 'startMusic', 'play'], 'audio.')
        }
        const paint = game.paint.bind(game)
        game.paint = (...args) => {
          const submitted = paint(...args)
          if (submitted === false) return false
          const now = performance.now(), run = result.current
          if (run && game.phase === 'preparing') {
            run.submitMs ??= now - run.clickAt
            run.firstKind ??= game.worldSubmit?.kind
          }
          if (run && game.phase === 'playing' && game.time > 0) {
            run.stepSubmitMs ??= now - run.clickAt
            const kind = game.worldSubmit?.kind
            if (kind === 'canvas' || kind === 'webgl') { run.richMs ??= now - run.clickAt; run.richKind ??= kind }
            if (run.richMs && game.time > .45) run.postPromotionMs ??= now - run.clickAt
          }
          if (game.phase === 'attract' && result.titleSubmitMs === null) result.titleSubmitMs = performance.now()
          return submitted
        }
      },
    })
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) result.longTasks.push({ at: e.startTime, ms: e.duration })
    }).observe({ type: 'longtask', buffered: true })
    function watchTitle() {
      const game = window.__sr
      if (!result.menuMs && game?.ctx &&
          [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'ENGAGE' && !b.disabled)) {
        result.menuMs = performance.now()
        // Pin the requested seeds without replacing real audio or UI input.
        const request = game.requestRun.bind(game)
        game.requestRun = sword => {
          const seed = game.phase === 'gameover' && !sameSeed ? 43 : 42
          const accepted = request(sword)
          if (accepted) game.pendingRun.seed = seed
          return accepted
        }
      }
      if (!result.titleSceneMs && game?.phase === 'attract' && game.bg.built) result.titleSceneMs = performance.now()
      if (!result.menuMs || !result.titleSceneMs) requestAnimationFrame(watchTitle)
    }
    requestAnimationFrame(watchTitle)
    window.addEventListener('click', e => {
      const label = e.target.closest('button')?.textContent.trim()
      if (!e.isTrusted || (label !== 'ENGAGE' && label !== 'RETRY')) return
      const clickAt = performance.now(), game = window.__sr
      const run = result.current = result.runs[label] = { clickAt, active: navigator.userActivation.isActive, paintedTitle: Boolean(result.titleSubmitMs) }
      const off = game.on(event => {
        if (event.type !== 'phase' || event.phase !== 'playing') return
        run.readyMs = performance.now() - clickAt
        run.seed = game.bg.getProfile().seed
        run.sky = game.bg.plateStats()
        run.bakeMs = game.bakeMs
        off()
        function watchPlay() {
          const elapsed = performance.now() - clickAt
          run.afterSubmitRafMs ??= elapsed // a browser paint opportunity, not scanout
          if (game.phase === 'playing' && game.time > 0.15) run.simMs = elapsed
          else requestAnimationFrame(watchPlay)
        }
        requestAnimationFrame(watchPlay)
      })
    }, true)
    const jump = event => {
      const run = result.current, game = window.__sr
      if (!event.isTrusted || !run || game.phase !== 'playing' || run.jumpAt) return
      if (event.code !== 'Space' && event.target.closest?.('button')?.textContent.trim() !== 'JUMP') return
      run.jumpAt = performance.now() - run.clickAt
      const seeJump = () => {
        if (result.current !== run) return
        if (game.player.y < -8) run.jumpMs = performance.now() - run.clickAt
        else requestAnimationFrame(seeJump)
      }
      requestAnimationFrame(seeJump)
    }
    window.addEventListener('keydown', jump, true)
    window.addEventListener('pointerdown', jump, true)
  }, { stages, assets, sameSeed })
  await p.setViewport(touch
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: 1000, height: 560, deviceScaleFactor: 1 })
  const response = await p.goto(url.href, { waitUntil: 'domcontentloaded' })
  assert.equal(response.status(), 200)
  const wait = (fn, ...args) => p.waitForFunction(fn, {}, ...args).then(h => h.dispose())
  await wait(early => window.srLoad.menuMs !== null && (early || window.srLoad.titleSubmitMs !== null), early)
  const click = async label => {
    // The buttons are already in view. Use coordinates and trusted input so
    // ElementHandle's scroll/intersection wait doesn't skew early Engage.
    const h = await p.waitForFunction(label => {
      const button = [...document.querySelectorAll('button')].find(b => !b.disabled && b.textContent.trim() === label)
      if (!button) return false
      const { x, y, width, height } = button.getBoundingClientRect()
      return width && height && [x + width / 2, y + height / 2]
    }, { polling: 25 }, label)
    const [x, y] = await h.jsonValue()
    await h.dispose()
    await (touch ? p.touchscreen.tap(x, y) : p.mouse.click(x, y))
    if (input) {
      await wait(() => window.__sr.phase === 'playing')
      if (touch) {
        const handle = await p.waitForFunction(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'JUMP'))
        const r = await handle.evaluate(b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
        await handle.dispose(); await p.touchscreen.tap(...r)
      } else await p.keyboard.press('Space')
      await wait(label => window.srLoad.runs[label]?.jumpMs > 0, label)
    }
    await wait(label => Boolean(window.srLoad.runs[label]?.simMs), label)
    if (promotion) {
      await wait(label => Boolean(window.srLoad.runs[label]?.postPromotionMs), label)
      // Deliver another trusted input after promotion, not an engine call.
      const from = await p.evaluate(() => window.__sr.player.x)
      const touchInput = touch ? await p.createCDPSession() : null
      if (touchInput) {
        const point = await p.$eval('.sr-joystick', el => {
          const r = el.getBoundingClientRect(); return { x: r.x + .97 * r.width, y: r.y + .5 * r.height }
        })
        await touchInput.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      } else await p.keyboard.down('d')
      try {
        await wait(from => window.__sr.player.x > from + 8, from)
        await p.evaluate((label, from) => { window.srLoad.runs[label].richMovement = window.__sr.player.x - from }, label, from)
      } finally {
        if (touchInput) { await touchInput.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touchInput.detach() }
        else await p.keyboard.up('d')
      }
    }
  }
  await click('ENGAGE')
  assert.equal(await p.evaluate(() => window.__sr.route?.chunk(0).shelter.kind), 'concourse')
  await p.evaluate(() => window.__sr.gameOver())
  await click('RETRY')
  if (trace) await p.tracing.stop()
  const receipt = await p.evaluate(assets => {
    const { domContentLoadedEventEnd: domMs, responseStart: ttfbMs } = performance.getEntriesByType('navigation')[0]
    const fcpMs = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
    const { menuMs, titleSubmitMs, titleSceneMs, runs, longTasks } = window.srLoad
    const bootReadyMs = performance.getEntriesByName('sr:ready')[0]?.startTime ?? null
    for (const [label, run] of Object.entries(runs)) {
      run.maxLongTaskMs = Math.max(0, ...longTasks.filter(e => e.at >= run.clickAt - 2 && e.at < run.clickAt + run.simMs).map(e => e.ms))
      run.overlappingTasks = longTasks.filter(e => e.at + e.ms >= run.clickAt && e.at < run.clickAt + run.simMs)
      const accepted = performance.getEntriesByName(`sr:${label.toLowerCase()}`).find(e => e.startTime >= run.clickAt - 2)
      const playing = accepted && performance.getEntriesByName('sr:playing').find(e => e.startTime >= accepted.startTime)
      run.acceptedToPlayMs = playing ? playing.startTime - accepted.startTime : null
    }
    const resources = assets ? performance.getEntriesByType('resource').filter(r => new URL(r.name).pathname.startsWith('/bridge/')).map(r => ({
      path: new URL(r.name).pathname, start: r.startTime, end: r.responseEnd, headers: r.responseStart - r.startTime,
      body: r.responseEnd - r.responseStart, encoded: r.encodedBodySize, decoded: r.decodedBodySize,
    })) : undefined
    const marks = performance.getEntriesByType('mark').filter(r => r.name.startsWith('sr:')).map(r => [r.name, r.startTime])
    const present = window.__sr.graphicsPresentation(), stream = window.__sr.bg.bridgeStream()?.receipt()
    window.__sr.destroy()
    return { ttfbMs, domMs, fcpMs, bootReadyMs, menuMs, titleSubmitMs, titleSceneMs, runs, stages: window.srLoad.stages,
      assets: window.srLoad.assetStages, resources, marks, longTasks, path: present.path, reason: present.reason, stream }
  }, assets)
  for (const [label, seed] of [['ENGAGE', 42], ['RETRY', sameSeed ? 42 : 43]]) {
    assert.equal(receipt.runs[label].active, true)
    assert.equal(receipt.runs[label].seed, seed)
    const r = receipt.runs[label]
    assert.ok(r.submitMs > 0 && r.readyMs >= r.submitMs && r.afterSubmitRafMs >= r.readyMs && r.stepSubmitMs > r.readyMs)
    if (input) assert.ok(r.jumpMs >= r.jumpAt && r.jumpAt >= r.readyMs)
    if (promotion) assert.ok(['canvas', 'webgl'].includes(r.firstKind) && r.richMs >= r.stepSubmitMs && r.richMovement > 8)
  }
  assert.deepEqual(errors, [])
  let gpu
  if (gpuInfo) {
    const cdp = await browser.target().createCDPSession()
    const { gpu: info } = await cdp.send('SystemInfo.getInfo')
    gpu = { devices: info.devices, featureStatus: info.featureStatus }
    await cdp.detach()
  }
  console.log(JSON.stringify({ browser: await browser.version(), touch, early, cpuCompositor, cpuCanvas, cpuRaster, splitProcesses,
    gpu, input, sameSeed, promotion, ...receipt }, null, 2))
} finally {
  await browser.close()
}
