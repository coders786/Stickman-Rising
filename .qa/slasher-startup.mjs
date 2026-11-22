/** Drive the actual Engage and Retry UI. Use the same disposable browser tools
 * as slasher-replay.mjs. --inline measures the old scheduling on this build;
 * --cpu-sky forces WebGL2 unavailable. --sync-readback retains the new menu
 * path but uses synchronous GPU readback for a matched control. --plate-pixels
 * is a separate capture pass. rAF marks paint opportunity, not display.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const bundled = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
const inline = process.argv.includes('--inline'), cpu = process.argv.includes('--cpu-sky')
const glTimings = process.argv.includes('--gl-timings')
const syncReadback = process.argv.includes('--sync-readback')
const platePixels = process.argv.includes('--plate-pixels')
const browser = await puppeteer.launch({
  executablePath: process.env.SR_BROWSER_EXECUTABLE || await bundled.executablePath(),
  args: bundled?.args ?? [],
  protocolTimeout: 120000,
})
try {
  const p = await browser.newPage(), errors = []
  p.on('pageerror', error => errors.push(String(error)))
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()) })
  if (cpu) await p.evaluateOnNewDocument(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : original.call(this, type, ...args)
    }
  })
  await p.setViewport({ width: 1000, height: 560, deviceScaleFactor: 1 })
  await p.goto(process.env.SR_QA_URL || 'http://localhost:3000/', { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => window.__sr?.bg?.built && window.__sr.phase === 'attract')
  const result = await p.evaluate(async ({ inline, glTimings, syncReadback, platePixels }) => {
    const game = window.__sr
    game.autoQuality = false
    game.qaMode = true
    game.applySettings({ ...game.settings, quality: 'ultra', muted: true })
    // Remove synthetic audio RNG/time for the matched startup fixture. Actual
    // gesture-driven audio/input are separately covered by the UI smoke.
    game.audio.resume = () => {}
    game.audio.startMusic = () => {}
    if (syncReadback) {
      const create = game.bg.createNightForSeed.bind(game.bg)
      game.bg.createNightForSeed = seed => {
        const prepared = create(seed)
        if (prepared) prepared.warmDeferred = async () => prepared.ensure()
        return prepared
      }
    }
    const request = game.requestRun.bind(game)
    let seed = 42, starts = 0, firstInputs = 0
    const events = []
    const longTasks = [], gl = [], stages = []
    const restore = []
    const measure = (owner, method, accepts = () => true, samples = gl) => {
      const original = owner[method]
      if (typeof original !== 'function') return
      owner[method] = function (...args) {
        if (!accepts(...args)) return original.apply(this, args)
        const at = performance.now()
        try { return original.apply(this, args) } finally { samples.push({ method, ms: performance.now() - at }) }
      }
      restore.push(() => { owner[method] = original })
    }
    if (glTimings) {
      measure(HTMLCanvasElement.prototype, 'getContext', type => type === 'webgl2')
      for (const method of ['compileShader', 'getShaderParameter', 'linkProgram', 'getProgramParameter', 'drawArrays', 'readPixels', 'clientWaitSync', 'getBufferSubData']) {
        measure(WebGL2RenderingContext.prototype, method)
      }
      for (const method of ['setRunSeed', 'bakeSoftBand', 'buildNear', 'bakeRoadLighting', 'warm']) {
        measure(game.bg, method, undefined, stages)
      }
      measure(game, 'paint', () => game.phase === 'preparing', stages)
    }
    const observe = new PerformanceObserver(list => {
      for (const e of list.getEntries()) longTasks.push({ at: e.startTime, ms: e.duration })
    })
    observe.observe({ entryTypes: ['longtask'] })
    const off = game.on(e => {
      if (e.type === 'runStarted') starts++
      if (e.type === 'phase') {
        events.push(e.phase)
        if (e.phase === 'playing') {
          // The first legal input, before the next sim step.
          game.input.setVirtual('light', true)
          game.input.setVirtual('light', false)
        }
      }
    })
    const step = game.step.bind(game)
    game.step = dt => {
      if (game.input.pressed('light')) firstInputs++
      return step(dt)
    }
    game.requestRun = sword => {
      const random = Math.random
      let first = true
      Math.random = () => {
        if (!first) return random()
        first = false
        return (seed + .5) / 0xffffffff
      }
      try {
        if (inline) { game.startRun(sword); return true }
        return request(sword)
      } finally { Math.random = random }
    }
    const next = () => new Promise(requestAnimationFrame)
    const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
    const until = async (check, message) => {
      const deadline = performance.now() + 30_000
      do {
        if (check()) return
        await next()
      } while (performance.now() < deadline)
      if (!check()) throw new Error(`${message} (phase ${game.phase}; latest GL calls ${JSON.stringify(gl.slice(-5))})`)
    }
    const scene = game.bg.getProfile()?.seed
    if (!inline) {
      // Simulate a hidden tab while a request is outstanding; neither a second
      // click nor a hidden rAF is allowed to activate it.
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      button('ENGAGE').click()
      if (request('katana')) throw new Error('double request was accepted')
      await until(() => button('CANCEL'), 'preparing screen missing')
      await next(); await next()
      if (starts || game.bg.getProfile()?.seed !== scene) throw new Error('hidden start baked or activated')
      button('CANCEL').click()
      Reflect.deleteProperty(document, 'hidden')
      await until(() => button('ENGAGE'), 'cancel did not restore title')
      if (game.phase !== 'attract') throw new Error('cancel did not restore prior phase')
    }
    async function clickStart(label) {
      await until(() => button(label), `missing ${label}`)
      const requested = performance.now()
      gl.length = stages.length = 0
      button(label).click()
      const returned = performance.now()
      let ack = null
      if (!inline) {
        await until(() => document.querySelector('#preparing-title'), 'preparation did not commit')
        ack = performance.now() - requested
        if (game.phase !== 'preparing') throw new Error('no paint opportunity before warm')
        game.input.setVirtual('heavy', true)
        if (game.input.pressed('heavy')) throw new Error('input live before the scene was ready')
      }
      await until(() => game.phase === 'playing', 'never became playable')
      const playable = performance.now()
      await next(); await next()
      if (game.bg.getProfile()?.seed !== seed) throw new Error('seed changed while preparing')
      const probe = glTimings ? { gl: gl.slice(), stages: stages.slice() } : {}
      const pixels = platePixels ? [game.bg.scenery.sky.lastMoon.toDataURL(), game.bg.scenery.sky.lastBank.toDataURL()] : undefined
      return { label, clickHandlerMs: returned - requested, ackCommitMs: ack, readyMs: playable - requested,
        bakeMs: game.bakeMs, maxLongTaskMs: Math.max(0, ...longTasks.filter(t => t.at >= requested - 2 && t.at <= playable).map(t => t.ms)),
        plates: game.bg.plateStats(), backing: [game.canvas.width, game.canvas.height], ...probe, pixels }
    }
    try {
      const engage = await clickStart('ENGAGE')
      game.gameOver()
      ++seed // identical retry seed on both variants, not a no-op reseed
      const retry = await clickStart('RETRY')
      return { starts, firstInputs, events, engage, retry }
    } finally {
      off()
      observe.disconnect()
      for (const undo of restore) undo()
      game.destroy()
    }
  }, { inline, glTimings, syncReadback, platePixels })
  assert.deepEqual(errors, [])
  assert.equal(result.starts, 2)
  assert.equal(result.firstInputs, 2)
  for (const row of [result.engage, result.retry]) assert.equal(row.plates, null, 'continuous Bridge must not warm a legacy NightLayer')
  if (platePixels) for (const row of [result.engage, result.retry]) {
    row.plateHashes = row.pixels.map(url => createHash('sha256').update(Buffer.from(url.split(',')[1], 'base64')).digest('hex'))
    delete row.pixels
  }
  console.log(JSON.stringify({ browser: await browser.version(), inline, cpu, syncReadback, captureOnly: platePixels, ...result }, null, 2))
} finally {
  await browser.close()
}
