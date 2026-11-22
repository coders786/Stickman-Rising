/** Live Bridge seams, shared rain voice and contextual actions. Real CDP
 * movement/taps and keyboard; planted checkpoints and health are fixtures. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { withBridge, base, touch } from './bridge-browser.mjs'

const dir = process.env.SR_SHOTS
if (dir) await mkdir(dir, { recursive: true })

await withBridge(async ({ page, open, button, phase, wait, frames, pause }) => {
  await page.evaluateOnNewDocument(touch => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: touch ? 'medium' : 'ultra', showFps: true }))
  }, touch)
  if (process.argv.includes('--legacy-links')) for (const value of ['station', 'bridge', 'rain-market']) {
    const url = new URL(base); url.searchParams.set('stage', value)
    await open(url)
    assert.equal(await page.evaluate(() => window.__sr.route?.chunk(0).role), 'transit')
    assert.equal(new URL(page.url()).searchParams.get('stage'), value)
    assert.equal(await page.$('[aria-label="Arena previews"]'), null)
  }
  await open()
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    const samples = window.bridgeQA = { starts: [], ink: [], r: 0 }
    let seed = 42
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = seed++; return ok }
    g.on(e => { if (e.type === 'runStarted') samples.starts.push([g.route.seed, g.bg.weatherState().tick]) })
    const text = g.hudCtx.fillText.bind(g.hudCtx)
    g.hudCtx.fillText = (s, x, y, w) => {
      if (/EXEC|SERVICE|HOLD E|OVERDRIVE|FPS/.test(s)) samples.ink.push([s, x, y]); if (samples.ink.length > 120) samples.ink.shift()
      text(s, x, y, w)
    }
  })
  const hidden = value => page.evaluate(value => {
    if (value) Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    else Reflect.deleteProperty(document, 'hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
  await hidden(true); await button('ENGAGE'); await phase('preparing'); await button('CANCEL'); await phase('attract'); await hidden(false)
  assert.deepEqual(await page.evaluate(() => window.bridgeQA.starts), [])
  // Reuse the same known drizzle seed for the first real run.
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g); let seed = 42
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = seed++; return ok }
  })
  await button('ENGAGE'); await phase('playing')
  await wait(() => window.__sr.audio.rain?.level > 0 && window.__sr.audio.graph?.ctx.state === 'running')
  const entry = await page.evaluate(() => {
    const g = window.__sr
    g.qaMode = true // keep seam checks isolated; traffic is exercised in soak
    g.enemies.length = 0
    g.fx.clear()
    window.bridgeOwner = { route: g.route, voice: g.audio.rain, p: g.player, cam: g.cam }
    return g.route.chunk(0).shelter
  })
  const cdp = touch ? await page.createCDPSession() : null
  const walk = async (dir, x) => {
    const key = dir < 0 ? 'a' : 'd'
    if (cdp) {
      const point = await page.$eval('.sr-joystick', (el, dir) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width * (dir < 0 ? .03 : .97), y: r.y + r.height * .5 }
      }, dir)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    } else await page.keyboard.down(key)
    try { await wait((dir, x) => dir * (window.__sr.player.x - x) >= 0, dir, x) }
    finally {
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      else await page.keyboard.up(key)
    }
    await frames()
  }
  const state = () => page.evaluate(() => {
    const g = window.__sr, o = window.bridgeOwner, x = g.player.x
    return { x, y: g.player.y, time: g.runTime, tick: g.bg.weatherState().tick, wet: g.bg.surfaceWetness(x),
      cover: g.route.shelterAt(x)?.kind ?? null, key: g.bg.keyWeightAt(x), drive: g.bg.rainAudioAt(x), level: g.audio.rain?.level,
      same: g.route === o.route && g.audio.rain === o.voice && g.player === o.p && g.cam === o.cam,
      score: g.stats.score, phase: g.phase }
  })
  const outside = await state()
  await walk(1, entry.terminal - 15)
  const covered = await state()
  await walk(1, entry.right + 48)
  const east = await state()
  await walk(-1, entry.left - 48)
  const west = await state()
  await walk(1, entry.left + 72)
  const returned = await state()
  const seams = [outside, covered, east, west, returned]
  assert.deepEqual(seams.map(s => Boolean(s.cover)), [false, true, false, false, true])
  assert.ok(seams.every(s => s.same && s.phase === 'playing' && s.y === 0 && s.score === outside.score && (s.wet === 0) === !!s.cover), JSON.stringify(seams))
  assert.ok(seams.slice(1).every((s, i) => s.tick > seams[i].tick && s.time > seams[i].time))
  assert.ok(covered.drive < outside.drive * .36 && covered.key < outside.key)
  assert.ok(seams.every(s => Math.abs(s.drive - s.level) < .04), JSON.stringify(seams))
  assert.equal(page.url(), base.href)

  // Observe a retained hold: weather and physics stay still while hidden/paused.
  await hidden(true); await phase('paused')
  const stopped = await state(); await frames(); assert.equal((await state()).tick, stopped.tick)
  await hidden(false); await button('RESUME'); await phase('playing')
  const frozen = await page.evaluate(() => {
    const g = window.__sr
    cancelAnimationFrame(g.raf)
    const t = g.time, tick = g.bg.weatherState().tick, now = performance.now()
    g.hitstopT = .2; g.environmentAccum = 0; g.lastFrame = now
    for (let i = 1; i <= 6; i++) g.frame(now + i * 1000 / 60)
    g.lastFrame = performance.now(); g.hitstopT = 0; g.raf = requestAnimationFrame(g.loop)
    return { dt: g.time - t, ticks: g.bg.weatherState().tick - tick }
  })
  assert.deepEqual(frozen, { dt: 0, ticks: 6 })

  const service = await page.evaluate(() => {
    const g = window.__sr, s = [...g.route.between(0, 8000)].find(c => c.shelter?.kind === 'service').shelter
    g.player.reset(s.terminal); g.cam.startOnRoad(s.terminal)
    g.player.hp = 33; for (let i = 0; i < 10; i++) g.combo.onHit(); g.publishActions()
    return { id: s.id, buff: s.buff }
  })
  await wait(() => window.bridgeQA.ink.some(x => ['TAP SERVICE', 'HOLD E  1.5s'].includes(x[0])))
  if (dir) await page.screenshot({ path: resolve(dir, `${touch ? 'touch' : 'desktop'}-service.png`), captureBeyondViewport: false })
  if (touch) await button('SERVICE')
  else await page.keyboard.down('e')
  await wait(() => window.__sr.service.progress > 0 && window.__sr.service.progress < 1.5)
  await wait(id => window.__sr.service.isUsed(id), service.id)
  if (!touch) await page.keyboard.up('e')
  const reward = await page.evaluate(() => {
    const g = window.__sr
    return { hp: g.player.hp, shield: g.player.shield, remaining: g.service.remaining, active: g.service.buff,
      flow: g.combo.hits, best: g.combo.bestRank }
  })
  assert.deepEqual({ ...reward, remaining: Math.ceil(reward.remaining) }, { hp: 73, shield: 50, remaining: 30, active: service.buff, flow: 0, best: 'B' })
  await wait(() => !document.querySelector('[data-action="service"]'))

  const exec = await page.evaluate(() => {
    const g = window.__sr, s = g.route.shelterAt(g.player.x), x = s.right + 320
    g.player.reset(x); g.player.hp = 58; g.cam.startOnRoad(x); g.enemies.length = 0
    for (const offset of [100, 58]) {
      g.debugSpawn('grunt', x + offset)
      const e = g.enemies.at(-1); e.arriveOnRoute(-1); e.vx = 0; e.state = 'stun'; e.stunT = 9; e.hp = 2
    }
    g.publishActions()
    return g.enemies.at(-1).id
  })
  await wait(touch => window.bridgeQA.ink.some(x => x[0] === (touch ? 'TAP EXEC' : 'E  EXECUTE')), touch)
  if (dir) await page.screenshot({ path: resolve(dir, `${touch ? 'touch' : 'desktop'}-execute.png`), captureBeyondViewport: false })
  if (touch) await button('EXEC')
  else await page.keyboard.press('e')
  await wait(id => window.__sr.exec?.enemy.id === id, exec)
  await wait(() => !window.__sr.exec && window.__sr.stats.kills === 1)
  await page.evaluate(() => {
    const g = window.__sr
    g.enemies.length = 0; g.player.meter = 100; g.publishActions()
  })
  if (touch) {
    await wait(() => document.querySelector('[data-action="ult"][data-ready="true"]'))
    await button('Overdrive')
  } else await page.keyboard.press('r')
  await wait(() => window.__sr.player.meter === 0)
  await wait(() => !document.querySelector('[data-action="ult"][data-ready="true"]'))
  await pause(); await phase('paused')
  await button('RESUME'); await phase('playing')
  await page.evaluate(() => window.__sr.gameOver()); await phase('gameover')
  await button('RETRY'); await phase('playing')
  const teardown = await page.evaluate(async () => {
    const g = window.__sr, ctx = g.audio.graph.ctx
    const newRoute = g.route !== window.bridgeOwner.route, starts = window.bridgeQA.starts
    g.destroy(); await new Promise(r => setTimeout(r, 40))
    return { newRoute, starts, audioClosed: ctx.state === 'closed', stores: g.resourceSnapshot().surfaces }
  })
  await cdp?.detach()
  assert.deepEqual(teardown, { newRoute: true, starts: [[42, 0], [43, 0]], audioClosed: true, stores: 0 })
  return { seams, frozen, service, reward, execute: exec, overdrive: true, teardown }
})
