/** Real Engage/Retry UI, then a fixed-step movement fixture. The QA hero
 * ignores incoming damage; bosses are defeated through the hit resolver
 * only after proving the gate collision. This is not a device FPS test.
 * Default: Engage + 20 Retries, each >=10,000 world px, at the selected size.
 */
import assert from 'node:assert/strict'
import { withBridge, touch } from './bridge-browser.mjs'

const retries = Number(process.argv.find(a => a.startsWith('--retries='))?.split('=')[1] ?? 20)
assert.ok(Number.isInteger(retries) && retries >= 0 && retries <= 40)

await withBridge(async ({ page, open, button, phase, wait }) => {
  await page.evaluateOnNewDocument(touch => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: touch ? 'medium' : 'ultra', adaptiveQuality: false, muted: true, showFps: true,
  })), touch)
  await open()
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    let seed = 42
    window.routeSoak = { old: [], starts: [], sceneSamples: 0 }
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
      if (source === g.canvas) window.routeSoak.sceneSamples++
      return drawImage.call(this, source, ...args)
    }
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = seed++; return ok }
    g.on(e => {
      if (e.type === 'runStarted') window.routeSoak.starts.push({ seed: g.route.seed, tick: g.bg.weatherState().tick,
        gate: g.encounters.gate.state, x: g.player.x, scale: g.dpr })
    })
    g.player.takeDamage = () => false
  })
  const rows = []
  for (let run = 0; run <= retries; run++) {
    await button(run ? 'RETRY' : 'ENGAGE'); await phase('playing')
    await wait(run => window.routeSoak.starts.length === run + 1 && window.__sr.route.seed === 42 + run, run)
    const result = await page.evaluate(run => {
      const g = window.__sr, q = window.routeSoak, dt = 1 / 60
      cancelAnimationFrame(g.raf)
      const retired = q.old.every(c => c.width === 0 && c.height === 0)
      const initialCache = g.bg.routeCache()
      const route = g.route, origin = 240
      const target = origin + 10_630
      let steps = 0, maxThreats = 0, maxStores = 0, maxBytes = 0, maxWeather = 0, maxSplashes = 0, maxChunks = 0, gates = 0, paints = 0
      let lastChunk = -1, passes = 0, maxDryRain = 0
      let gross = 0
      const shelters = new Set()
      const p = g.player, start = performance.now(), savedClock = g.lastFrame
      const crop = () => {
        g.renderTime = g.time
        g.paint(dt, false); paints++
        const res = g.resourceSnapshot()
        const cache = res.entries.filter(e => e.tag === 'route-chunk')
        maxChunks = Math.max(maxChunks, cache.length)
        maxStores = Math.max(maxStores, res.surfaces)
        maxBytes = Math.max(maxBytes, res.bytes)
        if (res.overBytes || res.overSurfaces || res.entries.filter(e => e.tag === 'environment-optional-bank').length > 1 ||
            res.entries.some(e => e.tag === 'route-work')) throw new Error(`backing budget/residue on seed ${route.seed}: ${JSON.stringify(res)}`)
        const w = g.bg.weatherWork()
        maxWeather = Math.max(maxWeather, w.streaks)
        maxSplashes = Math.max(maxSplashes, w.splashes)
        const view = g.bg.frontView, roof = route.shelterAt(view.left)
        if (roof && view.right <= roof.right) maxDryRain = Math.max(maxDryRain, w.streaks + w.splashes)
      }
      g.input.setVirtualAxis(1, 0)
      try {
        for (; steps < 2_700; steps++) {
          g.recordPrev()
          const from = p.x
          g.step(dt); g.input.endFrame(dt)
          g.fx.update(dt); g.bg.update(dt); g.bg.advanceActiveTicks(1, 1)
          g.updateCamera(dt); g.bg.syncCutaway(p.x, p.y, dt)
          gross += Math.abs(p.x - from)
          const n = route.at(p.x).index
          const s = route.shelterAt(p.x)
          if (s) {
            shelters.add(s.id)
            if (g.bg.surfaceWetness(p.x) !== 0 || g.enemies.some(e => !e.dead && route.shelterAt(e.x))) throw new Error(`cover leaked in seed ${route.seed}`)
          }
          const gate = g.encounters.gate
          if (gate.state === 'locked' && p.x > gate.x - 20.01) {
            if (p.x > gate.x - 20 + 1e-7) throw new Error('crossed the locked gate')
            const boss = g.enemies.find(e => e.kind === 'boss' && e.gate === gate.index && !e.dead)
            if (!boss) throw new Error('locked without boss')
            passes++
            if (passes > 16) {
              const r = g.worldRef.hitEnemy(boss.id, { bx: p.x, by: -60, tx: boss.x, ty: -44 }, {
                id: 'gate-soak-fixture', dmg: boss.maxHp * 2, heavy: true, stagger: .2, kb: 0, kbY: 0, launch: 0,
                juggle: 0, hitstop: 0, shake: 0, aoe: 0, breakGuard: true, kind: 'ability',
              })
              if (r.outcome !== 'killed' || g.worldRef.arenaMaxX !== Infinity) throw new Error('boss defeat did not open its gate: ' + r.outcome)
              g.hitstopT = g.slowmoT = 0
              g.timeScale = 1
              gates++; passes = 0
            }
          }
          if (n !== lastChunk || steps % 24 === 0) { crop(); lastChunk = n }
          maxThreats = Math.max(maxThreats, g.enemies.length)
          if (p.x >= target) break
        }
        crop()
        q.old = [...g.bg.scenery.cache.values()].map(e => e.surface)
        const finish = g.bg.routeCache()
        g.gameOver()
        return { run, seed: route.seed, retired, from: origin, end: p.x, gross, steps, paints, gates, shelters: shelters.size,
          maxThreats, maxBytes, maxStores, maxChunks, maxWeather, maxSplashes, maxDryRain,
          offscreen: finish.offscreen, evictions: finish.evicted - initialCache.evicted, elapsed: performance.now() - start }
      } finally {
        g.input.setVirtualAxis(0, 0)
        g.lastFrame = Math.max(savedClock, performance.now())
        g.raf = requestAnimationFrame(g.loop)
      }
    }, run)
    assert.ok(result.end - result.from >= 10_000 && result.gates >= 1 && result.shelters >= 2, JSON.stringify(result))
    assert.ok(result.retired && result.offscreen && result.maxChunks <= 3 && result.evictions > 2, JSON.stringify(result))
    assert.ok(result.maxThreats <= 8 && result.maxWeather <= 80 && result.maxSplashes <= 12 && result.maxDryRain === 0, JSON.stringify(result))
    rows.push(result)
  }
  const end = await page.evaluate(() => {
    const g = window.__sr, q = window.routeSoak
    g.destroy()
    return { starts: q.starts, sceneSamples: q.sceneSamples,
      lastStoresReleased: q.old.every(c => !c.width && !c.height), liveBytes: g.resourceSnapshot().bytes, liveStores: g.resourceSnapshot().surfaces }
  })
  assert.equal(end.starts.length, retries + 1)
  assert.ok(end.starts.every((s, i) => s.seed === 42 + i && s.tick === 0 && s.gate === 'ahead' && s.x === 240))
  assert.deepEqual([end.sceneSamples, end.liveBytes, end.liveStores, end.lastStoresReleased], [0, 0, 0, true])
  return { retries, realUI: true, rows, end }
})
