/** Production-build trace; requires external puppeteer-core and Chromium.
 * SR_BROWSER_TOOLS=.cache/browser-tools SR_QA_URL=http://127.0.0.1:3000 \
 *   node scripts/trace-graphics.mjs [--verify] [--output=path.json]
 * --hang-optics simulates a worker which never replies. --stall-gl simulates
 * an unfinished GL admission. --wait-verify waits
 * for the complete opt-in graphics self-test.
 * --retry forces gameOver through the debug handle, then clicks RETRY; this is
 * synthetic and does not measure combat/death animation.
 * --verify runs the separate shader/readback self-test and is NOT an
 * uncontaminated startup measurement. No combat input is sent. */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const bundled = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
const args = process.argv.slice(2), verify = args.includes('--verify')
const output = args.find(a => a.startsWith('--output='))?.slice(9)
const url = new URL(process.env.SR_QA_URL || 'http://127.0.0.1:3000/')
url.searchParams.set('traceGraphics', '1'); url.searchParams.set('boot', '1')
if (verify) url.searchParams.set('verifyGraphics', '1')
const browser = await puppeteer.launch({ executablePath: process.env.SR_BROWSER_EXECUTABLE || await bundled.executablePath(),
  args: bundled?.args ?? [], protocolTimeout: 120_000 })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setViewport({ width: 1120, height: 720, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({ quality: 'ultra', qualityV: 2, adaptiveQuality: false, muted: true })))
  if (args.includes('--hang-optics')) await page.evaluateOnNewDocument(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (options?.name === 'bridge-bake') return { onmessage: null, onerror: null, postMessage() {}, terminate() {} }
        super(url, options)
      }
    }
  })
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => !b.disabled && b.textContent.trim() === 'ENGAGE'), { timeout: 60000 })
  if (args.includes('--stall-gl')) await page.evaluate(() => {
    const r = window.__sr.renderer, advance = r.advanceBridgeOpening.bind(r), fallback = r.fallbackBridgeOpening.bind(r)
    let released = false
    r.advanceBridgeOpening = (...args) => released ? advance(...args) : 'renderer'
    r.fallbackBridgeOpening = () => { released = true; fallback() }
  })
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'ENGAGE'); b.dataset.traceTarget = 'yes' })
  await page.click('[data-trace-target=yes]')
  let outcome = 'playing'
  try { await page.waitForFunction(() => window.__sr?.phase === 'playing' || performance.getEntriesByName('sr:run-failed').length > 0, { timeout: 40000 }) }
  catch { outcome = 'timeout waiting for playing or run-failed' }
  if (outcome === 'playing') {
    outcome = await page.evaluate(() => window.__sr?.phase === 'playing' ? 'playing' : 'run-failed')
    if (outcome === 'playing') await page.waitForFunction(() => (window.__SR_GRAPHICS_TRACE__?.metrics['frame.js']?.count ?? 0) >= 100, { timeout: 30000 }).catch(() => {})
  }
  if (outcome === 'playing' && args.includes('--retry')) {
    await page.evaluate(() => window.__sr.gameOver())
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => !b.disabled && b.textContent.trim() === 'RETRY'), { timeout: 15000 })
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'RETRY'); b.dataset.traceRetry = 'yes' })
    await page.click('[data-trace-retry=yes]')
    try {
      await page.waitForFunction(() => window.__sr?.phase === 'playing' || performance.getEntriesByName('sr:run-failed').some(e => e.startTime > (performance.getEntriesByName('sr:retry').at(-1)?.startTime ?? Infinity)), { timeout: 40000 })
      outcome = await page.evaluate(() => window.__sr?.phase === 'playing' ? 'retry-playing' : 'retry-failed')
    } catch { outcome = 'retry-timeout' }
  }
  if (verify && args.includes('--wait-verify')) {
    await page.waitForFunction(() => ['pass', 'fail', 'live Canvas fallback'].includes(window.__GRAPHICS_DIAGNOSTICS__?.status), { timeout: 60000 }).catch(() => {})
  }
  const result = await page.evaluate(() => ({ trace: window.__SR_GRAPHICS_TRACE__?.snapshot(),
    phase: window.__sr?.phase, config: window.__sr?.renderConfig, presentation: window.__sr?.graphicsPresentation(),
    marks: performance.getEntriesByType('mark').filter(e => e.name.startsWith('sr:')).map(e => ({ name: e.name, at: e.startTime })),
    verifyStatus: window.__GRAPHICS_DIAGNOSTICS__?.status ?? null, visibility: document.visibilityState,
    userAgent: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight] }))
  const receipt = { browser: await browser.version(), url: url.href, verify, outcome, errors, ...result }
  const json = JSON.stringify(receipt, null, 2)
  if (output) await writeFile(output, json + '\n')
  else console.log(json)
} finally { await browser.close() }
