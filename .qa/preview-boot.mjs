/** Headless cold start in a cross-origin iframe; --direct skips the iframe.
 * --slow caps the link at 150 ms RTT / 1.5 Mbps. --held-frame withholds rAF.
 * --missing-chunk, --missing-engine and --hung-engine exercise native recovery.
 * --late-settings changes a preference before the deferred engine arrives.
 * --default-compositor leaves the packaged GPU compositor enabled.
 * --input sends a trusted jump as soon as the opening art clears.
 * Set SR_EMBED_TRACE to save a startup/compositor trace.
 * --legacy runs against the original preview and expects its blocked state.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const bundled = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
const flags = new Set(process.argv.slice(2)), legacy = flags.has('--legacy')
const failure = ['missing-chunk', 'missing-engine', 'hung-engine'].find(f => flags.has(`--${f}`))
const heldSettings = flags.has('--late-settings')
const debug = !legacy && !failure
const url = new URL(process.env.SR_QA_URL || 'http://127.0.0.1:3000/')
if (debug) url.searchParams.set('boot', '1')
const parent = new URL('/__sr-test-embed', url)
parent.hostname = url.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'
const scriptPath = p => p.startsWith('/_next/static/') && p.endsWith('.js')
const initialScripts = new Set()
if (heldSettings || (failure && failure !== 'missing-chunk')) {
  const response = await fetch(url)
  assert.equal(response.status, 200)
  const html = await response.text()
  for (const [, path] of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+\.js)(?:\?[^"#]+)?"/g)) initialScripts.add(path)
  assert.ok(initialScripts.size > 0, 'unable to identify shell scripts')
}
const trace = process.env.SR_EMBED_TRACE
const browser = await puppeteer.launch({ executablePath: process.env.SR_BROWSER_EXECUTABLE || await bundled.executablePath(),
  args: [...(bundled?.args ?? []), ...(flags.has('--default-compositor') ? [] : ['--disable-gpu-compositing'])], protocolTimeout: 120_000 })
try {
  const p = await browser.newPage(), errors = [], failed = [], held = []
  p.setDefaultTimeout(30_000)
  let block = Boolean(failure || heldSettings)
  p.on('pageerror', error => errors.push(String(error)))
  p.on('requestfailed', request => failed.push(new URL(request.url()).pathname))
  await p.setViewport({ width: 1120, height: 720, deviceScaleFactor: 1 })
  if (flags.has('--held-frame')) await p.evaluateOnNewDocument(() => {
    const raf = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window)
    const pending = new Map()
    let id = -1
    window.requestAnimationFrame = callback => { const key = id--; pending.set(key, callback); return key }
    window.cancelAnimationFrame = key => pending.delete(key)
    window.srResumeFrames = () => {
      window.requestAnimationFrame = raf
      window.cancelAnimationFrame = cancel
      for (const callback of pending.values()) raf(callback)
      pending.clear()
    }
  })
  if (flags.has('--no-storage')) await p.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage unavailable', 'SecurityError') } })
  })
  if (heldSettings) await p.evaluateOnNewDocument(() => {
    localStorage.setItem('sr_save_v1', '{"totalKills":25,"best":1000,"unlocked":["katana","inferno"]}')
    localStorage.setItem('sr_settings_v1', '{"quality":"low","qualityV":2,"muted":false}')
  })
  await p.setRequestInterception(true)
  p.on('request', req => {
    const target = new URL(req.url())
    if (target.href === parent.href) return req.respond({ status: 200, contentType: 'text/html', body:
      `<!doctype html><style>iframe{border:0;position:fixed;inset:0;width:100%;height:100%}</style><iframe src="${url.href.replaceAll('&', '&amp;')}" sandbox="allow-scripts allow-same-origin"></iframe>` })
    if (block && scriptPath(target.pathname) && !initialScripts.has(target.pathname)) {
      if (heldSettings || failure === 'hung-engine') { held.push(req); return }
      return req.abort('failed')
    }
    return req.continue()
  })
  if (flags.has('--slow')) await p.emulateNetworkConditions({ offline: false, latency: 150, download: 187500, upload: 93750 })
  if (trace) await p.tracing.start({ path: trace, categories: ['devtools.timeline', 'toplevel', 'blink.user_timing', 'cc', 'viz', 'gpu'] })
  await p.goto(flags.has('--direct') ? url.href : parent.href, { waitUntil: 'domcontentloaded' })
  const frame = flags.has('--direct') ? p.mainFrame() : await (await p.waitForSelector('iframe', { visible: true })).contentFrame()
  assert.ok(frame)
  const wait = (fn, ...args) => frame.waitForFunction(fn, { polling: 50 }, ...args).then(h => h.dispose())
  const snapshot = () => frame.evaluate(() => ({
    engine: Boolean(window.__sr?.ctx), phase: window.__sr?.phase ?? null,
    loadingArsenal: document.body.textContent.includes('LOADING ARSENAL'),
    loadingEngine: document.body.textContent.includes('LOADING GAME CODE'),
    engageEnabled: [...document.querySelectorAll('button')].some(b => !b.disabled && b.textContent.trim() === 'ENGAGE'),
    reportVisible: document.getElementById('sr-boot-report')?.hidden === false,
    report: document.querySelector('#sr-boot-report output')?.textContent ?? null,
    marks: performance.getEntriesByType('mark').filter(e => e.name.startsWith('sr:')).map(e => [e.name, e.startTime]),
  }))
  const button = async (name, attr) => {
    const coords = await frame.evaluate((name, attr) => {
      const el = [...document.querySelectorAll('button')].find(b => (attr ? b.getAttribute(attr) : b.textContent.trim()) === name)
      if (!el || el.disabled) return null
      const r = el.getBoundingClientRect()
      return [r.left + r.width / 2, r.top + r.height / 2]
    }, name, attr)
    assert.ok(coords, `Could not click ${name}`)
    return p.mouse.click(...coords)
  }
  const ready = () => wait(() => [...document.querySelectorAll('button')].some(b => !b.disabled && b.textContent.trim() === 'ENGAGE'))
  let initial
  if (failure) {
    await wait(() => Boolean(document.querySelector('h1')))
    if (!legacy) await wait(failure => document.getElementById('sr-boot-report')?.hidden === false &&
      (failure === 'hung-engine' ? /taking too long/ : /game script failed|game code could not load/).test(document.querySelector('#sr-boot-report output')?.textContent), failure)
    initial = await snapshot()
    assert.equal(initial.engageEnabled, false)
    if (failure !== 'missing-chunk') assert.ok(initial.loadingEngine, 'the menu did not load independently')
    if (!legacy) {
      block = false
      await Promise.all([frame.waitForNavigation({ waitUntil: 'domcontentloaded' }), frame.click('#sr-boot-report a')])
      assert.ok(new URL(frame.url()).searchParams.has('_boot'), 'reload should bypass stale page HTML')
    }
  } else if (heldSettings) {
    await wait(() => document.body.textContent.includes('LOADING GAME CODE'))
    initial = await snapshot()
    assert.equal(initial.engageEnabled, false)
    await button('SETTINGS')
    await wait(() => Boolean(document.querySelector('[aria-label="Mute all"]')))
    await button('Mute all', 'aria-label')
    await wait(() => JSON.parse(localStorage.getItem('sr_settings_v1')).muted)
    await button('BACK')
    block = false
    await Promise.all(held.map(req => req.continue()))
  } else if (flags.has('--held-frame')) {
    if (legacy) await wait(() => Boolean(window.__sr?.ctx))
    else await ready()
    initial = await snapshot()
    assert.equal(initial.engageEnabled, !legacy)
    if (legacy) assert.equal(initial.loadingArsenal, true)
    await frame.evaluate(() => window.srResumeFrames())
  }
  if (!block) {
    await ready()
    if (heldSettings) assert.deepEqual(await frame.evaluate(() => ({ muted: window.__sr.settings.muted,
      kills: window.__sr.lifetimeKills, unlocked: window.__sr.unlocked })), { muted: true, kills: 25, unlocked: ['katana', 'inferno'] })
    if (flags.has('--no-storage')) await wait(() => document.body.textContent.includes('Local storage is unavailable'))
    await frame.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'ENGAGE')
      const readyAt = performance.now()
      const resources = performance.getEntriesByType('resource').filter(e => new URL(e.name).pathname.startsWith('/_next/static/'))
        .map(e => ({ path: new URL(e.name).pathname, encoded: e.encodedBodySize, decoded: e.decodedBodySize, transfer: e.transferSize }))
      window.srProbe = { readyAt, resources }
      window.addEventListener('click', e => {
        if (!e.isTrusted || !b.contains(e.target)) return
        const g = window.__sr
        window.srProbe.clickAt = performance.now()
        const off = g.on(event => {
          if (event.type === 'phase' && event.phase === 'playing') {
            window.srProbe.playAt = performance.now()
            off()
          }
        })
      }, { capture: true })
    })
    await button('ENGAGE')
    if (flags.has('--input')) {
      await wait(() => window.__sr.input.enabled && !document.querySelector('.sr-ronin-reveal'))
      await frame.evaluate(() => {
        window.addEventListener('keydown', e => {
          if (!e.isTrusted || e.code !== 'Space') return
          window.srProbe.jumpAt = performance.now()
          const observe = () => {
            if (window.__sr.player.y < -9) window.srProbe.jumpSeenAt = performance.now()
            else requestAnimationFrame(observe)
          }
          requestAnimationFrame(observe)
        }, { capture: true, once: true })
      })
      await p.keyboard.press('Space')
      await wait(() => window.srProbe.jumpSeenAt >= window.srProbe.jumpAt)
    }
    await wait(() => window.__sr.phase === 'playing' && window.__sr.time >= .15)
    assert.ok(await frame.evaluate(() => window.srProbe.clickAt && window.srProbe.playAt), 'not a trusted Engage')
  }
  const final = await snapshot(), timing = await frame.evaluate(() => window.srProbe ?? null)
  if (!failure) assert.deepEqual(errors, [])
  if (debug) assert.match(final.report, /Engage → playing: \d+ ms/)
  else if (!block) assert.equal(final.reportVisible, false)
  if (trace) await p.tracing.stop()
  console.log(JSON.stringify({ browser: await browser.version(), flags: [...flags], initial, final, timing, errors, failed }, null, 2))
} finally { await browser.close() }
