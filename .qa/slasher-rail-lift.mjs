/** Fixed-clock pan, jump and zoom against the deck's world transform. Then
 * advance the clock alone to check the stock (not the rail) moves. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withBridge, touch, viewport } from './bridge-browser.mjs'

const legacy = process.argv.includes('--baseline'), gl = process.argv.includes('--gl'), shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })
const mode = gl ? touch ? 'mobile-webgl2' : 'master-webgl2' : 'mobile-canvas'
await withBridge(async ({ page, open, button, phase, frames, wait }) => {
  if (!touch) await page.setViewport({ ...viewport, width: 984, height: 610 })
  await page.evaluateOnNewDocument(gl => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: gl ? 'ultra' : 'high', adaptiveQuality: false, muted: true, shake: false,
  })), gl)
  await open()
  await page.evaluate(({gl,touch}) => {
    const g = window.__sr, request = g.requestRun.bind(g)
    if (gl) { g.allowDiagnosticMaster(); if (touch) g.preferDiagnosticMobile() }
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  }, {gl,touch})
  await button('ENGAGE'); await phase('playing')
  await wait(mode => window.__sr.graphicsPresentation().path === mode, mode)
  await page.evaluate(legacy => {
    const g = window.__sr, { cam, player: p } = g, scenery = g.bg.scenery
    cancelAnimationFrame(g.raf); g.qaMode = true; g.enemies.length = 0; g.fx.clear(); g.hitstopT = 0
    const x = 3088, train = scenery.rail.schedule.events.find(e => e.kind === 0)
    let clock = scenery.rail.schedule.crossingTime(train, x) + .24
    g.bg.advanceActiveTicks(720, 1); g.bg.routeTime = () => clock; g.bg.lightningI = () => 0
    Object.assign(g.bg.routeWeather.clock.sample, { cloud: .48, fog: .43, rain: .31, wet: .74 })
    p.reset(x); cam.startOnRoad(x); cam.setShakeEnabled(false)
    g.props.setRoute(g.route, x, Infinity)
    let streetY
    const belowCity = scenery.drawBelowCity.bind(scenery)
    scenery.drawBelowCity = (...args) => streetY = belowCity(...args)
    window.railShot = name => {
      if (name === 'pan') { cam.x = x + 84; p.x = p.px = x + 84 }
      if (name === 'jump') {
        p.x = p.px = x; cam.x = x
        p.doJump(g.worldRef)
        for (let i = 0; i < 23; i++) {
          g.time += 1 / 120; p.update(1 / 120, g.worldRef); g.updateCamera(1 / 120)
          cam.x = x; cam.rot = cam.offX = cam.offY = 0
        }
      }
      if (name === 'zoom') cam.zoom *= .94
      if (name === 'train-moves') clock += .065
      g.paint(0, false)
      const { rail } = scenery, last = rail.last, model = legacy ? .32 : .74
      const half = g.cssW * .5 / last.scale, zero = legacy ? x * .32 - half : (cam.x / model - half)
      const bearings = rail.blockers.slice(0, last.blockers).map(b => ({
        id: Math.round((b.left + zero - 14) / 426), x: b.left * last.scale,
        worldX: (b.left + zero) * model,
      }))
      return { x, time: clock, camera: { x: cam.x, y: cam.y, zoom: cam.zoom }, bodyY: p.y,
        heroHead: g.project(p.x + p.face * p.scale * p.geom.headC.x, p.hipY + p.scale * p.geom.headC.y),
        lane: g.project(cam.x, 0).y, height: g.cssH, width: g.cssW, streetY, bearings, dir: train.dir,
        stockWorldX: (last.leadX + zero) * model, rail: { ...last }, path: g.graphicsPresentation().path }
    }
    window.railShot('grounded')
  }, legacy)
  await wait(lit => window.__sr.bg.bridgeStream().plate(2, lit), !gl)
  const shot = async name => {
    const state = await page.evaluate(name => window.railShot(name), name)
    if (shots) { await frames(); await writeFile(join(shots, `${name}.png`), await page.screenshot({ captureBeyondViewport: false })) }
    return state
  }
  const grounded = await shot('grounded'), pan = await shot('pan'), air = await shot('jump'), zoom = await shot('zoom'), travelling = await shot('train-moves')
  const railDelta = air.rail.railY - grounded.rail.railY, footingDelta = air.rail.footingY - grounded.rail.footingY
  assert.equal(grounded.camera.x, air.camera.x)
  assert.ok(air.bodyY < -72 && air.heroHead.y > 45 && air.heroHead.y < air.lane - 70, JSON.stringify(air.heroHead))
  assert.ok(grounded.rail.bearings >= 1)
  for (const v of [grounded, pan, air, zoom, travelling]) {
    assert.equal(v.path, mode)
    assert.equal(v.rail.trains, 1, JSON.stringify(v))
    assert.ok(v.rail.bodies > 0 && Math.abs(v.streetY - v.rail.footingY) < .001, JSON.stringify(v))
    if (!legacy) {
      const { x, zoom } = v.camera
      assert.ok(Math.abs((v.rail.railY - v.lane) / zoom + 252) < .001)
      assert.ok(Math.abs((v.rail.footingY - v.lane) / zoom - 98) < .001)
      assert.ok(v.bearings.every(b => Math.abs(b.worldX - (b.id * 426 + 14) * .74) < .001 && Math.abs(b.x - (v.width * .5 + (b.worldX - x) * zoom)) < .001))
    }
  }
  const shared = grounded.bearings.find(a => pan.bearings.some(b=>b.id===a.id))
  assert.ok(shared, 'no shared fixed lattice witness')
  const cameraTravel = pan.bearings.find(b=>b.id===shared.id).x - shared.x
  if (!legacy) {
    assert.ok(Math.abs(cameraTravel + 84 * pan.camera.zoom) < .001)
    assert.ok([pan, air, zoom].every(q => Math.abs(q.stockWorldX - grounded.stockWorldX) < .001))
    assert.ok(Math.abs(railDelta - footingDelta) < .002 && Math.abs(railDelta - (air.lane - grounded.lane)) < .002)
    const actual = travelling.stockWorldX - zoom.stockWorldX, want = .065 * travelling.rail.speed * travelling.dir * .74
    assert.ok(Math.abs(actual - want) < .001, JSON.stringify({actual,want}))
    assert.deepEqual(travelling.bearings, zoom.bearings)
  }
  const resources = await page.evaluate(() => { const g = window.__sr; g.destroy(); return g.resourceSnapshot().surfaces })
  assert.equal(resources, 0)
  return { legacy, grounded, pan, air, zoom, travelling, railDelta, footingDelta, cameraTravel, resources }
})
