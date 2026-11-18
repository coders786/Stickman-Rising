// Real browser/rAF and full simulation, not 1000 / JavaScript submit time.
// As with player-motor-browser.mjs, Chromium is supplied outside the repo.
import { createRequire } from 'node:module'
import path from 'node:path'
const tools = createRequire(
  path.resolve(
    process.env.SR_BROWSER_TOOLS || '/home/user/browser-tools',
    'package.json',
  ),
)
const { chromium } = tools('playwright-core'),
  bundle = tools('@sparticuz/chromium').default
const uncapped = process.env.SR_UNCAPPED === '1'
const browser = await chromium.launch({
  executablePath: await bundle.executablePath(),
  args: [
    ...bundle.args,
    ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
  ],
})
try {
  const p = await browser.newPage({
    viewport: { width: 1000, height: 520 },
    deviceScaleFactor: 1,
  })
  await p.goto(process.env.SR_QA_URL || 'http://localhost:3100')
  await p.waitForFunction(() => window.__sr?.ctx)
  console.log('Mounted; starting Ultra session')
  await p.evaluate(() => {
    const g = window.__sr
    g.applySettings({ ...g.settings, quality: 'ultra' })
    g.autoQuality = false
    const rand = Math.random
    let seed = 0xa17e
    Math.random = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
    try {
      g.startRun('katana')
    } finally {
      Math.random = rand
    }
    g.dprTarget = 1
    g.resize()
    g.player.x = 1715
    g.debugSpawn('heavy', 1790)
    g.debugSpawn('grunt', 1650)
  })
  console.log('Warming play loop')
  const result = await p.evaluate(async () => {
    const g = window.__sr,
      frames = [],
      n = 240
    let last = 0,
      i = 0,
      bodies = 0
    await new Promise((done) => {
      function sample(ts) {
        if (i++ > 48) {
          frames.push(ts - last)
          bodies += g.renderer.cullDrawn
        }
        last = ts
        if (frames.length < n) requestAnimationFrame(sample)
        else done()
      }
      requestAnimationFrame(sample)
    })
    frames.sort((a, b) => a - b)
    return {
      fps: +((1000 * n) / frames.reduce((a, b) => a + b)).toFixed(1),
      p50: frames[n / 2],
      p95: frames[Math.ceil(0.95 * n) - 1],
      worst: frames.at(-1),
      meanEnemiesDrawn: +(bodies / n).toFixed(1),
      quality: g.settings.quality,
      pipeline: g.renderer.graphicsSummary(),
      dpr: g.dpr,
      errors: g.frameErrors,
    }
  })
  console.log({ uncapped, ...result })
  if (result.errors) process.exitCode = 1
} finally {
  await browser.close()
}
