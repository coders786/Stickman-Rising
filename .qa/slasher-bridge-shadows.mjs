/** Freeze a real Metro Link encounter and ablate each grounding term.
 * Run at a production URL with --optimized, --touch, or --canvas (SR_SOFTWARE=1).
 * SR_SHOTS saves finished frames plus luma-difference maps. Driver readbacks
 * and the cast/reflection switches below are fixture code, not frame work. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { touch, viewport, withBridge } from './bridge-browser.mjs'

const canvas = process.argv.includes('--canvas'), mobile = touch || process.argv.includes('--optimized')
const verify = process.argv.includes('--verify-rewrite'), shots = process.env.SR_SHOTS
const mode = canvas ? 'mobile-canvas' : mobile ? 'mobile-webgl2' : 'master-webgl2'
if (shots) await mkdir(shots, { recursive: true })
await withBridge(async ({ page, open, button, phase, wait }) => {
  if (!touch) await page.setViewport({ ...viewport, width: 792, height: 510 })
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true }))
  })
  await open()
  await page.evaluate(({ canvas, mobile }) => {
    const g = window.__sr, request = g.requestRun.bind(g)
    if (!canvas) g.allowDiagnosticMaster()
    if (mobile) g.preferDiagnosticMobile()
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  }, { canvas, mobile })
  await button('ENGAGE'); await phase('playing')
  await wait(mode => window.__sr.graphicsPresentation().path === mode, mode)
  const { png, ...report } = await page.evaluate(async ({ mode, save, touch, verify }) => {
    const g = window.__sr, { cam, renderer } = g, f = renderer.bridgeField, b = f.sacr
    const pipe = renderer.bridgeFinish.pipe, gl = pipe?.gl, hdr = mode === 'master-webgl2'
    cancelAnimationFrame(g.raf); g.qaMode = true; g.enemies.length = g.props.props.length = 0
    // Reset an untouched rig, not an animation crossfade left by however
    // many live frames were needed to acquire a renderer on this browser.
    const p = g.player = new g.player.constructor()
    g.fx.clear(); g.projectiles.clear(); g.banner = null; g.hitstopT = 0; g.streamQuiet = true
    g.time = g.renderTime = 7.25
    const weather = g.bg.routeWeather.clock.sample
    Object.assign(weather, { fog: .28, cloud: .24, key: 1, wet: .9, rain: 0 })
    g.bg.routeTime = () => 30; g.bg.routeDrift = () => 16; g.bg.lightningI = () => 0
    if (g.pickups) g.pickups.draw = () => {}
    const c = g.route.chunk(2), x = c.lamp - 39
    const world = { ...g.worldRef, time: 7.25, arenaMinX: -Infinity, arenaMaxX: Infinity, enemyTravel: undefined }
    p.reset(x); p.swordDrawn = true; p.update(1/120, world)
    const rng = Math.random
    try { Math.random = () => .47; g.debugSpawn('heavy', x + 105) } finally { Math.random = rng }
    const e = g.enemies.at(-1); e.arriveOnRoute(-1); e.state = 'stun'; e.stunT = 1; e.vx = 0
    e.update(0, world)
    cam.startOnRoad(x - (touch ? 34 : 105)); Object.assign(cam, { zoom: touch ? 1.26 : 1.58, y: -82, rot: 0, offX: 0, offY: 0 })
    const paint = () => { g.paint(0, false); if (g.graphicsPresentation().path !== mode) throw Error('Wrong renderer: ' + g.graphicsPresentation().path) }
    const deadline = performance.now() + 60_000
    g.setDiagnosticRenderScale(1)
    do {
      paint()
      const s = g.bg.bridgeStream(), w = f.probeWindow
      const visible = [...g.route.between(f.view.left, f.view.right)]
      if (w && f.view.left > w.origin && f.view.right <= w.origin + w.width &&
          (!pipe || (pipe.transportWindow(42) === s.window && pipe.receipt().stratumA.live)) && visible.every(c => s.plate(c.index, !pipe))) break
      if (performance.now() > deadline) throw Error('No matching shadow window: ' + JSON.stringify(g.graphicsPresentation()))
      await new Promise(r => setTimeout(r, 16))
    } while (true)
    g.setDiagnosticRenderScale(1.25); paint()
    const win = f.probeWindow, target = pipe?.canvas ?? g.canvas, w = target.width, h = target.height, png = {}
    const frame = () => [p.x,p.y,p.hp,e.x,e.y,e.hp,g.time, p.geom.toeL.x,p.geom.toeR.x]
    const before = frame(), seal = b.seal.bind(b)
    const originals = { shade: renderer.shade, cast: renderer.routeCast, mirror: renderer.routeMirror }
    const snap = (name, { wet = 0, direct = true, soles = true, returns = true } = {}) => {
      weather.wet = wet
      if (pipe) {
        b.seal = () => {
          seal()
          const data = b.packet.u32
          if (!direct) b.casters = 0
          if (!soles) data.fill(0, 544, 608)
          if (!returns) data.fill(0, 0, 160)
        }
      } else {
        renderer.shade = function (...args) {
          if (!soles) args[10] = true // GPU grounding owns this frame (skip just Canvas grounding).
          originals.shade.apply(this, args)
        }
        renderer.routeCast = direct ? originals.cast : () => ({ slope: 0, gain: 0 })
        renderer.routeMirror = returns ? originals.mirror : () => {}
      }
      paint()
      let data
      if (pipe) {
        data = hdr ? new Float32Array(w*h*4) : new Uint8Array(w*h*4)
        gl.bindFramebuffer(gl.FRAMEBUFFER, pipe.scene.fbo)
        gl.readPixels(0, 0, w, h, gl.RGBA, hdr ? gl.FLOAT : gl.UNSIGNED_BYTE, data)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      } else data = g.ctx.getImageData(0, 0, w, h).data
      if (save && name) png[name] = target.toDataURL().split(',')[1]
      return data
    }
    const wet = snap('metro-wet', {wet:.9}), dry = snap('metro-dry')
    const contact = snap(null, {direct:false}), bare = snap(null, {direct:false,soles:false})
    const water = snap(null, {wet:.9, returns:false})
    const region = () => {
      const px = g.project(p.x, 0), cy = Math.floor(px.y * h / g.cssH)
      const lo = Math.max(1, Math.round(px.x * w / g.cssW) - Math.round(117 * f.cam.zoom * w / g.cssW))
      const hi = Math.min(w - 1, lo + Math.round(242 * f.cam.zoom * w / g.cssW))
      return { cy, lo, hi, ht: Math.min(h - cy, Math.ceil(51 * f.cam.zoom * h / g.cssH)) }
    }
    const row = y => pipe ? h - y - 1 : y
    const lum = (p,i) => (.2126*p[i]+.7152*p[i+1]+.0722*p[i+2])/(hdr?1:255)
    const sample = (a, c, name, absolute = false) => {
      const { cy, lo, hi, ht } = region(), width = hi - lo
      const map = save && name ? new ImageData(width, ht) : null
      const values = new Float32Array(width * ht)
      let n = 0, max = 0, sum = 0
      for (let y = 0; y < ht; y++) for (let j = 0; j < width; j++) {
        const k = y*width+j, i = (row(cy+y)*w+lo+j)*4
        const raw = lum(c,i) - lum(a,i), d = absolute ? Math.abs(raw) : Math.max(0,raw)
        values[k] = d; n += +(d > .0006); max = Math.max(max,d); sum += d
        if (map) { map.data.fill(Math.min(255, 1080*Math.sqrt(d)), k*4, k*4+3); map.data[k*4+3] = 255 }
      }
      let edgePeak = 0, interiorPeak = 0, onEdge = 0, interior = 0, edgeN = 0, interiorN = 0
      const rowX = j => f.cam.x + ((lo+j+.5)/w-.5)*g.cssW/f.cam.zoom
      for (let j=1; j<width; j++) {
        const edge = Math.floor((rowX(j)-win.origin)/win.width*512) !== Math.floor((rowX(j-1)-win.origin)/win.width*512)
        for (let y=2; y<ht; y++) {
          const k = y*width+j, d = Math.abs(values[k] - values[k-1])
          if (Math.max(values[k], values[k-1]) < .0006) continue
          if (edge) { edgePeak = Math.max(edgePeak,d); onEdge += d; edgeN++ }
          else { interiorPeak = Math.max(interiorPeak,d); interior += d; interiorN++ }
        }
      }
      if (map) {
        const c = document.createElement('canvas'); c.width = width; c.height = ht
        c.getContext('2d').putImageData(map,0,0); png[name] = c.toDataURL().split(',')[1]
      }
      return { n, max, sum, vectorSeam: { peak: edgePeak, mean: onEdge/Math.max(1,edgeN), n: edgeN }, between: { peak: interiorPeak, mean: interior/Math.max(1,interiorN), n: interiorN } }
    }
    const layers = { cast: sample(dry, contact, 'only-casts'), contact: sample(contact, bare, 'only-contact'), return: sample(wet, water, 'only-wet-return', true) }
    const unchanged = frame()
    let lighting = null, pulse = null, jump = null
    if (verify) {
      // Suppress just lunar energy for this check. A practical may remove
      // its own lamp sheen, but it must leave the isolated actor return alone.
      // Canvas source-over wet silhouettes follow caster ink by construction;
      // compare packed returns in linear HDR / RGBA8 separately on WebGL.
      if (pipe) {
        weather.key = 0
        const a = snap(null, {wet:.9}), r = snap(null, {wet:.9,returns:false})
        const u = snap(null, {wet:.9,direct:false}), v = snap(null, {wet:.9,direct:false,returns:false})
        const {cy,lo,hi,ht} = region()
        let samples = 0, max = 0, sum = 0
        for (let y = 0; y < ht; y++) for (let j=lo; j<hi; j++) {
          const i = (row(cy+y)*w+j)*4, ar = lum(a,i)-lum(r,i), ur = lum(u,i)-lum(v,i)
          if (Math.max(Math.abs(ar), Math.abs(ur)) < .004) continue
          const d = Math.abs(ar-ur)
          samples++; max = Math.max(max,d); sum += d
        }
        lighting = { samples, max, mean: sum/Math.max(1,samples) }
      }
      weather.key = 1
      const emit = g.fx.bridgeEmitters
      const strike = (dx, name) => {
        g.fx.bridgeEmitters = frame => frame.light(3, x + dx, -56, 221, '#55ddff', 3.1, 7, x + dx, -56, 0, 12)
        return snap(name, {wet:.9})
      }
      const left = strike(-55, 'metro-impact'), right = strike(56, null)
      pulse = { lit: sample(wet,left,null,true).n, moved: sample(left,right,null,true).n, samePose: frame().every((v,i) => v === unchanged[i]) }
      g.fx.bridgeEmitters = emit
      p.doJump(world)
      for (let i=0; i<14; i++) p.update(1/120, world)
      const up = snap('metro-lifted', {wet:.9,direct:false}), hollow = snap(null, {wet:.9,direct:false,soles:false})
      const airborne = sample(up,hollow,null)
      jump = { height: -p.y, contactSum: airborne.sum, plantedSum: layers.contact.sum }
    }
    b.seal = seal; renderer.shade = originals.shade; renderer.routeCast = originals.cast; renderer.routeMirror = originals.mirror
    const receipt = { mode, css: [g.cssW,g.cssH], size: [w,h], subjects: [x,e.x], origin: win.origin, windowWidth: win.width,
      before, unchanged, layers, jump, lighting, pulse, packet: pipe ? b.receipt() : null, glError: gl?.getError() ?? 0 }
    g.destroy()
    return { ...receipt, teardown: g.resourceSnapshot().surfaces, png }
  }, { mode, save: !!shots, touch, verify })
  if (shots) for (const [name, b64] of Object.entries(png)) await writeFile(resolve(shots, `${name}.png`), Buffer.from(b64,'base64'))
  assert.deepEqual(report.before, report.unchanged)
  assert.deepEqual([report.glError, report.teardown], [0,0])
  assert.ok(report.layers.contact.n > 50 && report.layers.cast.n > 50 && report.layers.return.n > 20, JSON.stringify(report.layers))
  if (verify) {
    const { cast } = report.layers
    if (!canvas) assert.ok(cast.vectorSeam.mean < cast.between.mean * 1.5, JSON.stringify(cast))
    if (report.lighting) assert.ok(report.lighting.samples > 50 && report.lighting.mean < (mobile ? .0025 : .0006), JSON.stringify(report.lighting))
    assert.ok(report.pulse.lit > 50 && report.pulse.moved > 50 && report.pulse.samePose, JSON.stringify(report.pulse))
    assert.ok(report.jump.height > 40 && report.jump.contactSum < report.jump.plantedSum * .82, JSON.stringify(report.jump))
    assert.ok(!report.packet || (report.packet.maxK === (mobile ? 4 : 6) && report.packet.shadowK === (mobile ? 1 : 2)))
  }
  return report
})
