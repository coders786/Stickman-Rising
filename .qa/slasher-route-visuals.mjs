/** Live inputs from planted seed-42 checkpoints. Gate/shelter streaming and
 * unbroken distance are verified separately by slasher-route-soak.mjs. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { withBridge, touch } from './bridge-browser.mjs'

const dir = process.env.SR_SHOTS
if (dir) await mkdir(dir, { recursive: true })

await withBridge(async ({ page, open, button, phase, wait, frames }) => {
  const shot = async name => { if (dir) await page.screenshot({ path: resolve(dir, `${touch ? 'touch' : 'desktop'}-${name}.png`), captureBeyondViewport: false }) }
  await page.evaluateOnNewDocument(touch => localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3,
    quality: touch ? 'medium' : 'ultra', adaptiveQuality: false, showFps: true, muted: true })), touch)
  await open()
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  })
  await button('ENGAGE'); await phase('playing'); await frames(); await shot('metro-approach')
  const platform = await page.evaluate(() => {
    const g = window.__sr
    g.qaMode = true; g.enemies.length = 0
    const c = [...g.route.between(10_000, 18_000)].find(c => c.role === 'catwalk'), p = c.platform
    const x = p.left + (p.right - p.left) * .45
    while (g.encounters.gate.x < x) {
      g.encounters.gate.state = 'locked'; g.encounters.openGate(g.encounters.gate.index)
    }
    g.player.reset(x); g.cam.startOnRoad(x); g.lastFrame = performance.now()
    const view = window.bridgeJump = { apex: 0, headY: Infinity, height: g.cssH }
    const update = g.updateCamera.bind(g)
    g.updateCamera = dt => {
      update(dt)
      if (g.player.y >= view.apex) return
      const a = g.player, h = a.geom.headC
      view.apex = a.y
      view.headY = Math.min(view.headY, g.project(a.x + h.x * a.face * a.scale, a.hipY + h.y * a.scale).y)
    }
    return p
  })
  const cdp = touch ? await page.createCDPSession() : null
  const touchPoint = (sel, id, dy = .5) => page.$eval(sel, (el, id, dy) => {
    const r = el.getBoundingClientRect()
    return { id, x: r.x + r.width / 2, y: r.y + r.height * dy }
  }, id, dy)
  const jump = async down => {
    if (cdp) {
      const j = await touchPoint('[data-action="jump"]', 1)
      const joy = down && await touchPoint('.sr-joystick', 0, .93)
      if (joy) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [joy] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: joy ? [joy, j] : [j] })
    } else {
      if (down) await page.keyboard.down('s')
      await page.keyboard.down('Space')
    }
  }
  const lift = async () => {
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    else { await page.keyboard.up('Space'); await page.keyboard.up('s') }
  }
  await jump(false)
  await wait(y => window.__sr.player.y < y - 1 || (window.__sr.player.grounded && window.__sr.player.y === y), platform.y)
  await lift()
  await wait(y => window.__sr.player.grounded && window.__sr.player.y === y, platform.y)
  await frames()
  const footing = await page.evaluate(() => {
    const g = window.__sr, p = g.player
    return { x: p.x, y: p.y, floorY: p.floorY, toes: [p.geom.toeL, p.geom.toeR].map(t => p.hipY + p.scale * t.y),
      biome: g.buildHudState().route.biome, weather: g.bg.weatherWork() }
  })
  assert.equal(footing.y, footing.floorY)
  assert.ok(footing.toes.every(y => y <= platform.y + 2.5) && footing.toes.some(y => Math.abs(y - platform.y) < 5))
  assert.equal(footing.biome, 'Sky Garden District')
  const headroom = await page.evaluate(() => window.bridgeJump)
  assert.ok(headroom.apex <= platform.y && headroom.headY > 28 && headroom.headY < headroom.height, JSON.stringify(headroom))
  await shot('garden-skywalk')
  await jump(true)
  await wait(y => window.__sr.player.y > y + 8, platform.y)
  await lift(); await wait(() => window.__sr.player.grounded && window.__sr.player.y === 0)

  // A close frame from the real boss's windup, not a scaled character mock-up.
  const gate = await page.evaluate(() => {
    const g = window.__sr
    g.encounters = new g.encounters.constructor(g.route)
    const x = g.encounters.gate.x - 238
    g.player.reset(x); g.cam.startOnRoad(x); g.enemies.length = 0
    g.player.takeDamage = () => false
    g.qaMode = false
    return g.encounters.gate.x
  })
  await wait(() => window.__sr.enemies.some(e => e.kind === 'boss' && e.patternStep === 1 && e.patternT > .35))
  await page.evaluate(() => cancelAnimationFrame(window.__sr.raf))
  const boss = await page.evaluate(() => {
    const g = window.__sr, b = g.enemies.find(e => e.kind === 'boss'), p = g.player
    const head = g.project(b.x + b.face * b.scale * b.geom.headC.x, b.hipY + b.scale * b.geom.headC.y)
    return { gate: g.encounters.gate.state, bossX: b.x, heroX: p.x, hp: b.hp, scale: b.scale, head,
      hero: g.project(p.x, p.y), controlsTop: document.querySelector('.sr-touch-actions')?.getBoundingClientRect().top ?? null, view: [g.cssW, g.cssH], zoom: g.cam.zoom }
  })
  assert.equal(boss.gate, 'locked')
  assert.ok(boss.bossX < gate && boss.heroX < gate && boss.head.x > 16 && boss.head.x < boss.view[0] - 16, JSON.stringify(boss))
  assert.ok(boss.head.y >= 128 && boss.head.y < boss.view[1] - 36, JSON.stringify(boss))
  if (touch) assert.ok(boss.hero.y + 16 < boss.controlsTop, JSON.stringify(boss))
  await shot('boss-windup')

  // Leave the freeze at a Market Overpass pose, then draw and swing via UI.
  await page.evaluate(() => {
    const g = window.__sr, c = g.route.chunk(5), x = c.left + 765
    g.qaMode = true; g.enemies.length = 0; g.fx.clear()
    g.encounters.openGate(g.encounters.gate.index); g.worldRef.arenaMaxX = Infinity
    g.banner = null; g.hitstopT = 0; g.player.reset(x); g.cam.startOnRoad(x)
    g.lastFrame = performance.now(); g.raf = requestAnimationFrame(g.loop)
  })
  if (touch) await button('DRAW')
  else await page.keyboard.press('q')
  await wait(() => window.__sr.player.swordDrawn && !window.__sr.player.sheathAct)
  await page.evaluate(() => {
    const g = window.__sr, x = g.player.x
    g.debugSpawn('grunt', x + 64)
    const e = g.enemies.at(-1); e.arriveOnRoute(-1); e.vx = 0; e.state = 'stun'; e.stunT = 5
    // Keep each 1/60 s simulation pose visible to this visual sample even
    // if a software adapter stalls. Pacing and real-time input latency are
    // measured separately; the key/touch edge here is still a real event.
    const render = g.frame.bind(g)
    g.frame = () => render(g.lastFrame + 1000 / 60 + .000001)
    const add = g.fx.drawAdditive.bind(g.fx)
    g.fx.drawAdditive = (ctx, t, a) => {
      add(ctx, t, a)
      if (!a || window.bridgeRibbon) return
      const f = g.renderer.bridgeField
      for (let n = 0; n < f.count; n++) {
        const k = n * 4
        if (f.source[k + 3] !== 3) continue
        const span = [f.source[k] + f.cam.x, f.source[k+1], f.shape[k] + f.cam.x, f.shape[k+1]]
        if (span.every((x, i) => Math.abs(x - [a.bx, a.by, a.tx, a.ty][i]) < .001)) window.bridgeBladeSpan = span
      }
      if (a.trail.count < 4) return
      window.bridgeRibbon = { solvedEmitter: window.bridgeBladeSpan, count: a.trail.count, hilt: [a.bx, a.by], tip: [a.tx, a.ty],
        renderProjection: g.project(a.tx, a.ty), controlsTop: document.querySelector('.sr-touch-actions')?.getBoundingClientRect().top ?? null, age: a.trail.clock - a.trail.born[(a.trail.head - a.trail.count + a.trail.N) % a.trail.N] }
      queueMicrotask(() => cancelAnimationFrame(g.raf))
    }
  })
  if (touch) await button('SLASH')
  else await page.keyboard.press('j')
  await wait(() => window.bridgeRibbon)
  const ribbon = await page.evaluate(() => window.bridgeRibbon)
  assert.ok(ribbon.count >= 4 && ribbon.count <= 36 && ribbon.age < .140)
  assert.ok(ribbon.solvedEmitter?.length === 4, JSON.stringify(ribbon))
  if (touch) assert.ok(ribbon.renderProjection.y < ribbon.controlsTop, JSON.stringify(ribbon))
  await shot('market-katana')
  if (process.argv.includes('--cinematic')) {
    await page.evaluate(() => {
      const g = window.__sr, x = g.cam.x
      g.hitstopT = g.slowmoT = 0; g.timeScale = 1; g.fx.clear(); g.enemies.length = 0
      g.player.reset(x); g.cam.startOnRoad(x)
      g.debugSpawn('grunt', x + 88)
      const e = g.enemies.at(-1); e.arriveOnRoute(-1); e.hp = e.maxHp * .4; e.vx = 0; e.state = 'stun'; e.stunT = 12
      const r = window.bridgeExecution = { base: g.cam.zoom, peak: g.cam.zoom, entered: false, finished: false }
      const update = g.updateCamera.bind(g)
      g.updateCamera = dt => {
        update(dt)
        r.entered ||= !!g.exec
        r.finished ||= r.entered && !g.exec
        r.peak = Math.max(r.peak, g.cam.zoom)
        r.last = g.cam.zoom
      }
      g.lastFrame = performance.now(); g.raf = requestAnimationFrame(g.loop)
    })
    await wait(() => Boolean(window.__sr.findExecuteTarget()))
    if (touch) await button('EXEC')
    else await page.keyboard.press('e')
    await wait(() => window.bridgeExecution.finished && Math.abs(window.bridgeExecution.last - window.bridgeExecution.base) < .002)
    const r = await page.evaluate(() => window.bridgeExecution)
    assert.ok(r.peak > r.base * 1.12 && r.finished, JSON.stringify(r))
  }
  const execution = await page.evaluate(() => window.bridgeExecution ?? null)
  await cdp?.detach()
  return { fixtures: 'planted checkpoints; live jump, drop, draw and attack inputs; fixed single-step ribbon sample', seed: 42, platform, footing, headroom, drop: true, boss, ribbon, execution }
})
