// Rollback and higher-detail world receipts. --reference runs on the last
// shaded build: capture its usual world, plus the same player's draw with
// the old optional light argument omitted. Candidate ink must match that
// isolated pose exactly; world pixels are expected to improve separately.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withBridge, touch, viewport } from './bridge-browser.mjs'

const folder = process.env.SR_SHOTS
if (!folder) throw Error('Set SR_SHOTS')
const reference = process.argv.includes('--reference')
const fallback = process.argv.includes('--deny-worker')
const canvas = process.argv.includes('--canvas')
const settledOnly = process.argv.includes('--settled-only')
const lean = process.argv.includes('--lean')
assert.ok(!lean || canvas, 'Lean is a Canvas path')
const optimized = !canvas && (touch || process.argv.includes('--optimized'))
const expected = canvas ? 'mobile-canvas' : optimized ? 'mobile-webgl2' : 'master-webgl2'
const names = process.argv.find(arg => arg.startsWith('--scenes='))?.slice(9).split(',') ?? ['entry', 'warm', 'left', 'cool', 'open', 'covered', 'strike']
await mkdir(folder, { recursive: true })

await withBridge(async ({ page, open, button, phase, wait, frames }) => {
  await page.setViewport({ ...viewport, ...(touch ? { width: 412, height: 780 } : { width: 960, height: 620 }), deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(fallback => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true, shake: false }))
    if (fallback) window.Worker = new Proxy(window.Worker, { construct(Target, args) {
      if (args[1]?.name?.startsWith('bridge-')) throw new DOMException('QA worker denied', 'SecurityError')
      return Reflect.construct(Target, args)
    } })
  }, fallback)
  await open()
  await page.evaluate(({ canvas, optimized }) => {
    const g = window.__sr, request = g.requestRun.bind(g)
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
    if (!canvas) g.allowDiagnosticMaster()
    if (optimized) g.preferDiagnosticMobile()
    g.setDiagnosticRenderScale(1)
    g.on(e => { if (e.type === 'phase' && e.phase === 'playing') queueMicrotask(() => cancelAnimationFrame(g.raf)) })
  }, { canvas, optimized })
  if (settledOnly) {
    // An offline look witness, not a loader/timing test. On forced software
    // GL, warm the renderer outside the gesture path at the native capture
    // size even if that adapter can't meet gameplay cadence.
    await page.evaluate(async expected => {
      const g = window.__sr
      cancelAnimationFrame(g.raf)
      g.beginRun('katana', { seed:42 }); g.openCombat()
      const deadline = performance.now() + 65_000
      do {
        g.paint(0, false)
        const { path, gpu } = g.graphicsPresentation()
        if (path === expected && (!gpu || (gpu.stratumA?.live && gpu.stratumA.frames > 0))) return
        await new Promise(resolve => setTimeout(resolve, 40))
      } while (performance.now() < deadline)
      throw Error('Unable to warm the visual fixture: ' + JSON.stringify(g.graphicsPresentation()))
    }, expected)
  } else {
    await button('ENGAGE'); await phase('playing')
    await wait(() => !document.querySelector('.sr-ronin-reveal'))
  }
  await page.evaluate(({ expected, fallback, lean }) => {
    const g = window.__sr, p = g.player, bg = g.bg, f = g.renderer.bridgeField, weather = bg.routeWeather.clock.sample
    g.qaMode = true; g.enemies.length = g.props.props.length = 0
    g.projectiles.clear(); g.fx.clear(); g.banner = null; g.hitstopT = 0; g.streamQuiet = true
    bg.drawNearRain = () => {}; bg.drawWeather = () => {}; bg.drawMotes = () => {}
    if (g.pickups) g.pickups.draw = () => {}
    const draw = p.draw, fixtures = f.receiveFixtures.bind(f)
    let fixtureTaps = 0, ink = false
    f.receiveFixtures = (...args) => { fixtureTaps++; return fixtures(...args) }
    p.draw = function (...args) { ink ||= !!args[4]; return draw.apply(this, args) }
    const actorHash = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 420; canvas.height = 360
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.setTransform(2, 0, 0, 2, 191.4 - 2 * p.x, 262.7)
      const tails = g.settings.reduceMotion ? 0 : expected === 'master-webgl2' ? 5 : 2
      draw.call(p, ctx, g.renderTime, false, tails) // no optional pigment, even on T15
      const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let opaque = 0, black = 0
      for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 3] === 255) {
        opaque++; black += +(bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0)
      }
      canvas.width = canvas.height = 0
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('')
      return { sha256, opaque, black }
    }
    bg.lightningI = () => 0
    bg.routeTime = () => 8.4; bg.routeDrift = () => 0
    const paint = (capture = false) => {
      if (!g.paint(0, false, lean) || g.graphicsPresentation().path !== expected) throw Error(JSON.stringify(g.graphicsPresentation()))
      // A paused software-GL compositor can still have the previous
      // backbuffer when the screenshot request arrives. Fence only in QA.
      if (capture) g.renderer.bridgeFinish.pipe?.gl.finish()
    }
    window.playerLightQA = {
      async scene(name) {
        const viaduct = g.route.chunk(1), shelter = g.route.chunk(3).shelter, industrial = g.route.chunk(19)
        const x = name === 'warm' || name === 'strike' ? viaduct.lamp - 77 : name === 'cool' ? industrial.lamp - 79
          : name === 'covered' ? shelter.left + 107 : name === 'entry' ? 240 : name === 'left' ? 330 : viaduct.lamp + 178
        p.reset(x); p.swordDrawn = name === 'strike'
        g.stats.distanceMetres = Math.max(0, x - 240) / 10
        g.time = g.renderTime = 8.4
        if (name === 'strike') {
          const dt = 1 / 120, input = g.input, w = g.worldRef
          input.setVirtual('light', true)
          for (let i = 0; i < 22; i++) { w.time = 8.4 + i * dt; p.update(dt, w); if (!i) input.setVirtual('light', false); input.endFrame(dt) }
          assertPose(p.action?.def?.id)
        }
        function assertPose(id) { if (!id) throw Error('Missing strike sample') }
        g.fx.clear()
        const c = g.cam
        c.startOnRoad(x); Object.assign(c, { x: x + 12, y: -111, zoom: innerWidth < innerHeight ? 1.18 : 1.49, rot: name === 'cool' ? .038 : 0, offX: 0, offY: 0 })
        bg.syncCutaway(x, 0, 1)
        Object.assign(weather, { cloud: .29, fog: .24, key: .94, rain: 0, wet: .32 })
        // Don't mix a provisional plate with a completed one in the
        // ablations. Wait for both transport and the visible plates.
        const stream = bg.bridgeStream(), deadline = performance.now() + 50_000
        for (;;) {
          paint()
          const visible = [...g.route.between(f.view.left, f.view.right)].map(c => c.index)
          if (lean || fallback || (f.probeWindow && f.probeWindow === stream.window && stream.openingSettled(visible))) break
          if (performance.now() >= deadline) throw Error('No settled witness: ' + JSON.stringify(g.graphicsPresentation()))
          await new Promise(resolve => setTimeout(resolve, 85))
        }
        fixtureTaps = 0; ink = false; paint(true)
        const project = j => g.project(p.x + p.face * p.scale * j.x, p.hipY + p.scale * j.y)
        const joints = Object.fromEntries(['headC', 'chest', 'hip', 'elbL', 'elbR', 'handL', 'handR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR'].map(k => [k, project(p.geom[k])]))
        const look = g.graphicsPresentation(), work = g.bg.scenery.stats()
        return { x:p.x, y:p.hipY, pose:p.action?.def?.id ?? 'ready', joints, cam:{x:c.x,y:c.y,zoom:c.zoom,rot:c.rot}, frame:look.frame,
          lunar:f.atmo.key[0], streamed:!lean && !!f.probeWindow, casterCount:f.sacr.casters, impulses:f.impulseCount,
          atlas: { width: f.probeWindow?.width ?? 0, seed: f.probeWindow?.seed ?? null },
          plateBytes:work.worker.plateBytes, platePixels: work.platePixels ?? null, plates: work.worker.plates,
          fixtureTaps, ink, actor:await actorHash() }
      },
    }
  }, { expected, fallback, lean })
  const scenes = {}
  for (const name of names) {
    scenes[name] = await page.evaluate(n => window.playerLightQA.scene(n), name)
    await frames()
    await page.screenshot({ path: join(folder, name + '.png'), captureBeyondViewport: false })
  }
  for (const [name, scene] of Object.entries(scenes)) {
    assert.equal(scene.frame.kind, lean ? 'starter' : canvas ? 'canvas' : 'webgl')
    assert.equal(scene.fixtureTaps, reference ? 6 : 0, `playable material receiver in ${name}`)
    assert.equal(scene.ink, reference)
    assert.ok(scene.actor.black > 900 && scene.actor.black <= scene.actor.opaque)
    if (!lean && !fallback) assert.equal(scene.atlas.seed, 42)
    if (!canvas) assert.ok(scene.casterCount > 0)
    if (!lean && name === 'strike') assert.ok(scene.impulses > 0, 'the live blade stays a world emitter')
  }
  const teardown = await page.evaluate(() => {
    const g = window.__sr, f = g.renderer.bridgeField
    g.destroy()
    return { surfaces:g.resourceSnapshot().surfaces, opticalWindows:Number(!!f.probeWindow || !!f.streamWindow), curbMips:f.sacr.stratum.mips.length }
  })
  assert.equal(teardown.surfaces, 0)
  if (!reference && process.argv.includes('--check-retirement')) assert.deepEqual(teardown, { surfaces:0, opticalWindows:0, curbMips:0 })
  return { path: expected, reference, fallback, lean, settledOnly, measuredViewport: page.viewport(), scenes, teardown }
})
