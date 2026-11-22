/** Matched Ultra finish, using the live renderer at fixed seed, poses and weather.
 * Point SR_QA_URL at either build; SR_SHOTS saves native backing captures. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { viewport, withBridge, useCompactGL } from './bridge-browser.mjs'

const compact = process.argv.includes('--compact')
const direct = process.argv.includes('--direct')
const shots = process.env.SR_SHOTS
const verifyOptics = process.argv.includes('--verify-optics')
const verifyBounds = process.argv.includes('--verify-bounds')
const verifyMotion = process.argv.includes('--verify-motion')
if (shots) await mkdir(shots, { recursive: true })
await withBridge(async ({ page, open, button, phase, wait }) => {
  await page.setViewport({ ...viewport, width: 848, height: 520 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true, showFps: false,
  })))
  await open()
  if (compact) await useCompactGL(page)
  if (direct) {
    // Optics probes need a fixed render workload, not a second copy of the
    // browser opening test. Use the game's explicit scripted-run entry point.
    await page.evaluate(() => {
      const g = window.__sr, random = Math.random
      g.allowDiagnosticMaster(); g.qaMode = true
      Math.random = () => 42.5 / 0xffffffff
      try { g.startRun('katana') } finally { Math.random = random }
    })
  } else {
    await page.evaluate(() => {
      const g = window.__sr, request = g.requestRun.bind(g)
      g.allowDiagnosticMaster()
      g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
    })
    await button('ENGAGE'); await phase('playing')
  }
  await wait(() => window.__sr.graphicsPresentation().path === 'master-webgl2')
  const { png, ...receipt } = await page.evaluate(async ({ save, verifyOptics, verifyBounds, direct, verifyMotion }) => {
    const g = window.__sr, f = g.renderer.bridgeField, pipe = g.renderer.bridgeFinish.pipe, gl = pipe.gl
    const weather = g.bg.routeWeather.clock.sample, { cam, player } = g
    const { width, height } = pipe.canvas, png = {}, frames = {}
    cancelAnimationFrame(g.raf); g.qaMode = true; g.enemies.length = g.props.props.length = 0
    g.fx.clear(); g.projectiles.clear(); g.hitstopT = 0; g.banner = null; g.streamQuiet = true
    g.time = g.renderTime = 7.25; g.bg.t = 30
    g.applyMotionPreference(false)
    Object.assign(weather, { fog: .28, cloud: .18, key: 1, wet: .9, rain: .27 })
    g.bg.routeTime = () => 30; g.bg.routeDrift = () => 16; g.bg.lightningI = () => 0
    const paint = () => {
      g.paint(0, false)
      if (g.graphicsPresentation().path !== 'master-webgl2') throw Error('Lost HDR')
    }
    const stage = async (x, cx, roll, y, zoom) => {
      player.reset(x); cam.startOnRoad(cx)
      Object.assign(cam, { x: cx, y, rot: roll, zoom, offX: 0, offY: 0 })
      const deadline = performance.now() + 65_000, scale = g.dpr
      g.setDiagnosticRenderScale(1)
      do {
        paint()
        const w = g.bg.bridgeStream().window
        if (w && cx > w.origin + 400 && cx < w.origin + w.width - 400 && pipe.transportWindow(42) === w &&
            pipe.receipt().stratumA.live) break
        if (performance.now() > deadline) throw Error('Transport did not commit at ' + cx)
        await new Promise(r => setTimeout(r, 20))
      } while (true)
      g.setDiagnosticRenderScale(scale)
    }
    // Take the opaque HDR backing before bloom as well as the finished scene.
    // Diagnostic readbacks happen here, not in the game loop.
    const snap = name => {
      paint()
      // JS draw submission, intentionally not GPU completion or scanout.
      const submits = new Array(20)
      for (let i = 0; i < submits.length; i++) {
        const t = performance.now(); paint(); submits[i] = performance.now() - t
      }
      submits.sort((a,b) => a-b)
      const cpuSubmitMs = { samples: submits.length, median: submits[10], p95: submits[18], max: submits[19] }
      const hdr = new Float32Array(width * height * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, pipe.scene.fbo)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, hdr)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      if (save) png[name] = pipe.canvas.toDataURL('image/png').split(',')[1]
      const r = pipe.receipt()
      frames[name] = { cam: [cam.x, cam.y, cam.rot, cam.zoom], wet: f.wet, lights: f.count, time: f.weatherTime,
        targetBytes: r.targetBytes, draws: r.frameDraws, dataBytes: r.dataBytes, bloomLevels: r.bloomLevels,
        bloom: r.bloom, backing: r.size, cpuSubmitMs, post2d: g.renderer.bridgeReceipt().post2d ?? null,
        committed: pipe.transportWindow(42)?.origin ?? null }
      return hdr
    }
    const difference = (a, b, filter) => {
      let max = 0, sum = 0, samples = 0, changed = 0
      const co = Math.cos(cam.rot), si = Math.sin(cam.rot)
      for (let sy = 1; sy < height; sy += 3) for (let sx = 1; sx < width; sx += 3) {
        const px = ((sx + .5) / width - .5) * g.cssW / cam.zoom, py = (.5 - (sy + .5) / height) * g.cssH / cam.zoom
        const x = cam.x + px * co + py * si, y = cam.y - px * si + py * co
        if (!filter(x, y)) continue
        const i = (sy * width + sx) * 4
        const d = Math.max(Math.abs(a[i]-b[i]), Math.abs(a[i+1]-b[i+1]), Math.abs(a[i+2]-b[i+2]))
        samples++; changed += +(d > .001); sum += d; max = Math.max(max, d)
      }
      return { samples, changed, max, mean: sum / samples }
    }
    const c = g.route.chunk(2)
    await stage(c.lamp - 119, c.lamp - 48, -.024, -109, 1.12)
    const wet = snap('lamp-rain'); weather.wet = 0
    const dry = snap('lamp-dry'); weather.wet = .9
    const road = (x, y) => y > 9 && y < 48
    const rainChange = difference(dry, wet, road)

    g.debugSpawn('grunt', c.lamp + 36)
    const e = g.enemies.at(-1); e.arriveOnRoute(-1); e.state = 'stun'; e.stunT = 1; e.vx = 0
    e.update(0, { ...g.worldRef, time: 30, arenaMinX: -Infinity, arenaMaxX: Infinity, enemyTravel: undefined })
    e.state = 'idle'
    const calm = snap('calm')
    const at = [player.x, player.y, e.x, e.y, g.time]
    const random = Math.random
    Math.random = () => .357
    try {
      g.fx.lightningCast({ enemies: [], minX: 0, maxX: Infinity }, player.x + 34, -83, 1, .08, { color: '#41f6ff', maxLen: 165 })
    } finally { Math.random = random }
    const bolt = g.fx.lightning.bolts.find(b => b.active)
    if (!bolt?.legs.length) throw Error('Missing lightning channel')
    const strike = snap('strike')
    const combat = difference(calm, strike, (x, y) => x > player.x - 15 && x < e.x + 42 && y > -118 && y < 45)
    if ([player.x, player.y, e.x, e.y, g.time].some((n, i) => n !== at[i])) throw Error('Changing lights advanced gameplay')
    let motion = null
    if (direct || verifyMotion) {
      g.fx.clear()
      g.applyMotionPreference(false)
      g.fx.motionLine(player.x - 28, player.y - 54, 1, 0, 148, .24, '#58e9ff')
      snap('motion-trail')
      const bright = frames['motion-trail'].post2d?.trailBlits ?? 0
      g.applyMotionPreference(true)
      snap('motion-reduced')
      const reduced = frames['motion-reduced'].post2d?.trailBlits ?? 0
      motion = { bright, reduced }
      if (verifyMotion && !(bright > 0 && reduced === 0)) throw Error(JSON.stringify({ bright, reduced }))
      g.fx.clear(); g.applyMotionPreference(false)
    }
    g.enemies.length = 0

    const shelter = g.route.chunk(3).shelter
    await stage(shelter.terminal - 31, shelter.right - 28, .055, -120, 1.08)
    const eaveWet = snap('eaves'); weather.wet = 0
    const eaveDry = snap('eaves-dry')
    const shelterRoad = difference(eaveDry, eaveWet, (x, y) => road(x, y) && x > shelter.left + 12 && x < shelter.right - 12)
    const openRoad = difference(eaveDry, eaveWet, (x, y) => road(x, y) && x > shelter.right + 12)
    // The actual bloom shader, using uniform 1x1 radiance sources so the
    // first filter and the reconstruction can be checked independently.
    let bloom = null
    if (verifyOptics) {
      const texel = () => {
        const texture = pipe.texture(gl.TEXTURE_2D, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, null)
        return texture
      }
      const input = texel(), output = texel(), wide = texel(), tight = texel(), fbo = gl.createFramebuffer()
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Bloom fixture incomplete')
        const src = { color: input, width: 1, height: 1 }, dst = { color: output, fbo, width: 1, height: 1 }
        const wideTarget = { color: wide, width: 1, height: 1 }, tightTarget = { color: tight, width: 1, height: 1 }
        gl.useProgram(pipe.filter.handle)
        const upload = (texture, rgb) => {
          gl.bindTexture(gl.TEXTURE_2D, texture)
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array([...rgb, 1]))
        }
        const sample = (rgb, pass, skirts) => {
          upload(input, rgb)
          upload(wide, skirts?.[0] ?? rgb)
          upload(tight, skirts?.[1] ?? rgb)
          pipe.blur(src, dst, pass, wideTarget, tightTarget)
          const out = new Float32Array(4)
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out)
          return [...out.subarray(0, 3)]
        }
        bloom = { grey: [.88, 1, 1.125, 1.25, 1.5, 1.75].map(v => sample([v, v, v], 0)[0]),
          arc: sample([0, .20, 2], 0), uniform: sample([.25, .5, .75], 2),
          skirts: sample([.5, 0, 0], 2, [[0, .5, 0], [0, 0, .5]]) }
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.deleteFramebuffer(fbo); for (const texture of [input, output, wide, tight]) gl.deleteTexture(texture)
      }
    }
    let spotRain = null
    if (verifyBounds) {
      // Same shaders, frozen rain slots: one spot, no other eligible light
      // and no blocker. Zero bounds disable only the broad phase in probes.
      const c = f.cam, rt = pipe.scene, { width, height } = rt
      f.count = f.roofs = f.blockerCount = f.impulseCount = f.ventCount = 0
      f.weatherBounds.set([1e20, 1e20, -1e20, -1e20])
      f.rain = 1; f.wind = 0; f.weatherTime = 24; f.quiet = false
      // Illuminate a real cluster well inside the finite cone, with the
      // right side of the view still outside its broad-phase box.
      if (!f.light(1, c.x - 148, -211, 350, '#ffcf72', 3.6, 8, c.x - 148, -85, .92)) throw Error('Isolated rain spot was culled')
      const implicit = f.weatherBounds.slice()
      const raster = () => {
        const data = new Float32Array(width * height * 4)
        gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo); gl.viewport(0, 0, width, height)
        gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        gl.bindVertexArray(pipe.vao); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        pipe.particles(f, g.cssW, g.cssH, false); gl.disable(gl.BLEND)
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, data)
        return data
      }
      const bounded = raster(); f.weatherBounds.fill(0); const exact = raster()
      f.count = 0; const unlit = raster()
      let differs = 0, max = 0, lit = 0, coverage = 0
      for (let i = 0; i < exact.length; i += 4) {
        differs += +(bounded[i] !== exact[i] || bounded[i+1] !== exact[i+1] || bounded[i+2] !== exact[i+2] || bounded[i+3] !== exact[i+3])
        const red = exact[i] - unlit[i]
        lit += +(red > .001); max = Math.max(max, red); coverage += +(exact[i+3] > 0)
      }
      spotRain = { implicit: [...implicit], differs, lit, max, coverage }
    }
    const glError = gl.getError()
    g.destroy()
    const teardown = g.resourceSnapshot().surfaces
    return { png, frames, rainChange, combat, motion, shelterRoad, openRoad, bloom, spotRain, glError, teardown }
  }, { save: !!shots, verifyOptics, verifyBounds, direct, verifyMotion })
  for (const [name, bytes] of Object.entries(png)) await writeFile(resolve(shots, `${name}.png`), Buffer.from(bytes, 'base64'))
  const { rainChange, combat, shelterRoad, openRoad, teardown, glError } = receipt
  assert.ok(rainChange.samples > (compact ? 150 : 2000) && rainChange.changed > (compact ? 15 : 30), JSON.stringify(rainChange))
  assert.ok(combat.changed > (compact ? 12 : 25) && combat.max > .1, JSON.stringify(combat))
  assert.ok(shelterRoad.samples > (compact ? 40 : 480) && openRoad.samples > (compact ? 50 : 800) &&
    openRoad.changed > (compact ? 3 : 12), JSON.stringify({ shelterRoad, openRoad }))
  assert.equal(shelterRoad.max, 0, 'weather wetness cannot cross the rolled eave')
  assert.deepEqual([glError, teardown], [0, 0])
  if (verifyBounds) {
    const r = receipt.spotRain
    assert.ok(r.differs === 0 && r.lit > (compact ? 0 : 25) && r.max > .005 && r.coverage > r.lit, JSON.stringify(r))
  }
  if (verifyOptics) {
    const close = (a, b) => assert.ok(Math.abs(a - b) < .002, `${a} != ${b}`)
    const { grey, arc, uniform, skirts } = receipt.bloom
    grey.forEach((v, i) => close(v, [0, 0, .01796875, .071875, .2875, .53][i]))
    assert.ok(arc[0] === 0 && arc[1] > .02 && arc[2] > .39)
    uniform.forEach((v, i) => close(v, [.4, .8, 1.2][i]))
    skirts.forEach((v, i) => close(v, [.21, .09, .5][i]))
  }
  return receipt
})
