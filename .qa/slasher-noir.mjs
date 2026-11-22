/** Matched production captures. Set SR_QA_URL, SR_SHOTS and SR_BROWSER_TOOLS;
 * pass --touch --force-gl for Mobile WebGL, --touch for Canvas. No test hooks
 * in the runtime; the harness supplies fixed poses, weather and clocks. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { touch, withBridge } from './bridge-browser.mjs'

const v4 = process.argv.includes('--v4')
const force = !touch || process.argv.includes('--force-gl')
const compact = process.argv.includes('--compact')
const mode = force ? touch ? 'mobile-webgl2' : 'master-webgl2' : 'mobile-canvas'
const dir = process.env.SR_SHOTS
if (dir) await mkdir(dir, { recursive: true })
await withBridge(async ({ page, open, button, phase, wait }) => {
  if (!touch && compact) await page.setViewport({ width: 880, height: 540, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'ultra', adaptiveQuality: false, showFps: false, muted: true,
  })))
  await open()
  await page.evaluate(({force, touch, v4}) => {
    const g = window.__sr
    if (force) g.allowDiagnosticMaster()
    if (touch && v4) g.preferDiagnosticMobile()
    const request = g.requestRun.bind(g)
    g.requestRun = sword => { const pass = request(sword); if (pass) g.pendingRun.seed = 42; return pass }
  }, {force, touch, v4})
  await button('ENGAGE'); await phase('playing')
  if (force) await wait(() => window.__sr.resourceSnapshot().presentation.gpu?.stratumA?.live)
  await wait(() => window.__sr.ctx && window.__sr.route && window.__sr.time >= 0)
  const frames = {}
  if (dir) await page.exposeFunction('saveBridgeCapture', async (name, png) => {
    const data = Buffer.from(png, 'base64'), file = `${mode}-${name}.png`
    await writeFile(resolve(dir, file), data)
    frames[name] = { file, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length }
  })
  const result = await page.evaluate(async ({ mode, shots, v4 }) => {
    const g = window.__sr, f = g.renderer.bridgeField, pipe = g.renderer.bridgeFinish.pipe
    cancelAnimationFrame(g.raf)
    g.enemies.length = g.props.props.length = 0; g.fx.clear(); g.banner = null; g.hitstopT = 0; g.streamQuiet = true
    let t = 14.9, cloud = .29, flash = 0
    const weather = { ...g.bg.weatherState(), key: .97, rain: .50, wet: .89, fog: .39 }
    g.bg.weatherState = () => ({ ...weather, cloud })
    g.bg.routeTime = () => t; g.bg.lightningI = () => flash
    const { cssW: w, cssH: h } = g
    const rig = (x, camX = x, roll = 0, zoom = 1.04, y = -100, floor = 0) => {
      g.player.reset(x); g.cam.startOnRoad(camX)
      if (floor !== 0) {
        g.player.y = g.player.floorY = floor
        if ('prevY' in g.player) g.player.prevY = floor
      }
      Object.assign(g.cam, { x: camX, y, zoom, rot: roll, offX: 0, offY: 0 })
    }
    const scale = g.dpr, metrics = {}

    const paint = () => {
      g.bg.t = t
      g.paint(0, false)
      const state = g.resourceSnapshot().presentation
      if (state.path !== mode) throw new Error(`Wrong path ${JSON.stringify(state)}`)
    }
    const snap = async (name) => {
      if (v4) {
        // Uploads still use the real present path. At a frozen camera, warm
        // at a small diagnostic backing, then restore the locked scale for
        // the still. This is not the 120-frame performance fixture.
        const x = g.cam.x, t0 = performance.now()
        const ready = () => {
          const bw = g.bg.bridgeStream().window, aw = pipe?.transportWindow(42)
          const plate = g.bg.bridgeStream().indices().includes(g.route.at(x).index)
          return bw && x > bw.origin + 300 && x < bw.origin + bw.width - 300 && (pipe ? bw === aw : plate)
        }
        const stream = g.bg.bridgeStream().window
        if (!(ready() && x > stream.origin + 700 && x < stream.origin + stream.width - 700)) {
          g.setDiagnosticRenderScale(mode === 'master-webgl2' ? 1 : mode === 'mobile-webgl2' ? .85 : .65); paint()
          while (!ready()) {
            if (performance.now() - t0 > 76_000) throw new Error('Timed out staging capture ' + name + ' ' + JSON.stringify({ cache: g.bg.routeCache(), gpu: pipe?.receipt(), quiet: f.uploadQuiet, x }))
            await new Promise(r => setTimeout(r, 20)); paint()
          }
          g.setDiagnosticRenderScale(scale)
        }
      }
      paint()
      if (pipe?.mode === 'mobile' && !pipe.receipt().stratumA.refreshed) paint()
      const canvas = pipe?.canvas ?? g.ctx.canvas
      if (shots) await window.saveBridgeCapture(name, canvas.toDataURL('image/png').split(',')[1])
      metrics[name] = { x: g.player.x, floor: g.player.floorY, cam: [g.cam.x, g.cam.y, g.cam.zoom, g.cam.rot], t, cloud, flash,
        casts: f.casts?.casters ?? f.sacr.casters ?? f.canvasCasts ?? 0, deck: f.casts?.deckCasts ?? f.sacr.elevatedCasters ?? 0, roadFromDeck: f.casts?.roadFromDeck ?? f.sacr.elevatedCasters ?? 0, blockers: f.blockerCount ?? 0, lights: f.count, rail: {...g.bg.scenery.railStats?.()}, moon: f.atmo.receipt(), size: [canvas.width, canvas.height] }
    }
    const settle = (e) => {
      e.arriveOnRoute(-1); e.state = 'stun'; e.stunT = 1; e.vx = 0
      e.update(0, { ...g.worldRef, time: t, arenaMinX: -Infinity, arenaMaxX: Infinity, enemyTravel: undefined })
      e.state = 'idle'
    }
    const c0 = g.route.chunk(0), cat = [...g.route.between(0, 21000)].find(c => c.role === 'catwalk' && c.left > 10200)
    const bay = [...g.route.between(0, 23000)].find(c => c.shelter?.kind === 'service' && c.left > 5100).shelter
    const market = [...g.route.between(6550, 9170)].find(c => !c.shelter && c.left > 5600)
    rig(c0.wetSign + 92, c0.wetSign + 240); t = 4.49; cloud = .25; await snap('transit')
    rig(c0.lamp - 39, c0.lamp - 75, -.021, 1.14); t = 18.9; await snap('sodium')
    // Fixed camera, weather clock, and inputs apply to every revision.
    rig((cat.platform.left + cat.platform.right) * .5, cat.platform.right - 90, .024, 1.12, -154, cat.platform.y)
    cloud = .12; t = 32.5
    await snap('catwalk'); flash = .71; await snap('sheet-lightning'); flash = 0
    t = 11.7; cloud = .55; rig(bay.terminal + 8, bay.terminal - 7, .035, 1.04, -127); await snap('service-bay')
    t = 14.4; cloud = .33
    const dx = market.left + Math.floor((market.right - market.left) * .67)
    rig(dx - 74, dx - 120, 0, 1.06, -122)
    g.debugSpawn('grunt', dx + 40); settle(g.enemies.at(-1))
    await snap('market')
    t = 21.4; cloud = .34
    g.enemies.length = 0
    const gate = g.encounters.gate; gate.state = 'locked'
    rig(gate.x - 230, gate.x - 185, 0, .98, -142)
    g.debugSpawn('boss', gate.x - 112)
    const boss = g.enemies.at(-1); settle(boss); boss.face = -1
    await snap('gemini');
    const pose = JSON.stringify(boss.geom)
    boss.flashT = 1; await snap('gemini-hit')
    if (pose !== JSON.stringify(boss.geom)) throw new Error('Hit paint changed the pose')
    if (v4 && pipe) {
      // Actual timetabled events; do not sledgehammer a train into a still.
      const r = g.bg.scenery.rail; r.wake(g.route.seed, 0, c0.lamp)
      for (const [kind, name] of ['express','freight','night-service','local'].entries()) {
        if (mode !== 'master-webgl2' && kind >= 2) break
        const event = r.schedule.events.find(e => e.kind === kind)
        rig(c0.lamp - 108, c0.lamp - 48, 0, 1.04, -110)
        const local = Math.sin(g.cam.x * .32 / 420) * 420
        const headAge = (local * event.dir + w * .21) / event.speed
        t = r.schedule.offset + event.at + headAge; cloud = .29
        await snap(`rail-${name}`)
        if (!(metrics[`rail-${name}`].rail.bodies > 0)) throw Error(`No actual rail event for ${name}`)
      }
    }
    return { metrics, renderer: g.resourceSnapshot().presentation }
  }, { mode, shots: !!dir, v4 })
  const receipt = result
  assert.equal(receipt.renderer.path, mode)
  return { mode, ...receipt, frames }
})
