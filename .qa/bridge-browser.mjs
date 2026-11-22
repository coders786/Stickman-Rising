/** Shared browser launcher for the live Bridge checks; no runtime QA dependencies. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const bundled = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
export const touch = process.argv.includes('--touch')
export const viewport = touch
  ? { width: 400, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { width: 1180, height: 660, deviceScaleFactor: 1 }
export const base = new URL(process.env.SR_QA_URL ?? 'http://localhost:3000/')

// A correctness fixture for software GL. Keep the real DOM viewport, all
// effect passes, and the startup gate. This does not measure native speed.
export const compactFactor = Number(process.env.SR_GL_TEST_SCALE ?? '.34')
export const useCompactGL = page => page.evaluate(factor => {
  const finish = window.__sr.renderer.bridgeFinish, run = finish.pipeline.bind(finish)
  finish.pipeline = (tier,w,h,scale,ready) => run(tier,w,h,scale,(pipe,b) => ready(pipe, {
    w: Math.floor(b.w * factor), h: Math.floor(b.h * factor), scale: b.scale * factor,
  }))
}, compactFactor)

export async function withBridge(run) {
  const browser = await puppeteer.launch({
    executablePath: process.env.SR_BROWSER_EXECUTABLE || await bundled.executablePath(),
    args: [...(bundled?.args ?? []), ...(process.env.SR_SOFTWARE === '1' ? ['--disable-gpu'] : []),
      ...(process.argv.includes('--cpu-compositor') ? ['--disable-gpu-compositing'] : [])],
    protocolTimeout: 180_000,
  })
  try {
    const page = await browser.newPage(), errors = []
    page.setDefaultTimeout(45_000)
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()) })
    if (!touch) await page.evaluateOnNewDocument(() => {
      const media = window.matchMedia.bind(window)
      window.matchMedia = query => {
        const result = media(query)
        if (query === '(pointer: fine)') Object.defineProperty(result, 'matches', { value: true })
        return result
      }
    })
    await page.setViewport(viewport)
    const wait = async (fn, ...args) => (await page.waitForFunction(fn, { polling: 25 }, ...args)).dispose()
    const button = async (label) => {
      const handle = await page.waitForFunction(name => {
        const b = [...document.querySelectorAll('button')].find(b => !b.disabled &&
          (b.getAttribute('aria-label') || b.textContent.trim()) === name)
        if (!b) return false
        const r = b.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && [r.x + r.width / 2, r.y + r.height / 2]
      }, { polling: 25 }, label)
      const [x, y] = await handle.jsonValue(); await handle.dispose()
      assert.ok(x >= 0 && y >= 0, `${label} offscreen`)
      await (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y))
    }
    const open = async (url = base) => {
      const result = await page.goto(String(url), { waitUntil: 'domcontentloaded' })
      assert.equal(result?.status(), 200)
      await wait(() => window.__sr?.ctx && [...document.querySelectorAll('button')].some(b => !b.disabled && b.textContent.trim() === 'ENGAGE'))
    }
    const phase = value => wait(value => window.__sr.phase === value, value)
    const frames = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
    const pause = () => touch ? button('Pause') : page.keyboard.press('p')
    const receipt = await run({ page, browser, open, button, phase, wait, frames, pause })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ browser: await browser.version(), software: process.env.SR_SOFTWARE === '1', touch, viewport, ...receipt }, null, 2))
  } finally { await browser.close() }
}
