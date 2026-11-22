/** Live v2 optical proofs. QA supplies fixed visual clocks and (separately
 * from the stills) three known cloud columns. Readbacks are never in gameplay.
 * --touch exercises optimized GL; --canvas exercises the complete fallback.
 * Use SR_SOFTWARE=1 with --canvas; --deny-sky also exercises missing assets. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { touch, viewport, withBridge } from './bridge-browser.mjs'

const canvas = process.argv.includes('--canvas'), deny = process.argv.includes('--deny-sky')
const expected = canvas ? 'mobile-canvas' : touch ? 'mobile-webgl2' : 'master-webgl2'
const dir = process.env.SR_SHOTS
if (dir) await mkdir(dir, { recursive: true })

await withBridge(async ({ page, open, phase, button, wait }) => {
  if (!touch) await page.setViewport({ ...viewport, width: 820, height: 520 })
  const loads = []
  page.on('response', r => { if (new URL(r.url()).pathname.endsWith('baked-v1/sky.bin.br')) loads.push(r.status()) })
  if (deny) {
    await page.setRequestInterception(true)
    page.on('request', r => void (new URL(r.url()).pathname.endsWith('baked-v1/sky.bin.br') ? r.respond({ status: 404 }) : r.continue()))
  }
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'ultra', adaptiveQuality: false, showFps: false, muted: true,
  })))
  await open()
  await page.evaluate(({ canvas, touch }) => {
    const g = window.__sr, request = g.requestRun.bind(g)
    if (!canvas) g.allowDiagnosticMaster()
    if (touch) g.preferDiagnosticMobile()
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  }, { canvas, touch })
  await button('ENGAGE'); await phase('playing')
  if (!deny) await wait(canvas => canvas ? !!window.__sr.renderer.bridgeField.atmo.basis
    : window.__sr.graphicsPresentation().gpu?.stratumA?.live, canvas)
  const report = await page.evaluate(async ({ expected, deny, save }) => {
    const g = window.__sr, f = g.renderer.bridgeField, a = f.atmo, p = g.renderer.bridgeFinish.pipe
    const gl = p?.gl, w = g.cssW, h = g.cssH, hdr = p?.mode === 'master'
    const before = { ...g.renderConfig }
    cancelAnimationFrame(g.raf)
    g.enemies.length = g.props.props.length = 0
    g.fx.clear(); g.banner = null; g.hitstopT = 0; g.streamQuiet = true
    const worldWeather = g.bg.routeWeather.clock.sample
    Object.assign(worldWeather, { fog: .23, cloud: .20, key: .97, wet: .82, rain: .28 })
    let time = 32.5, drift = 0, flash = 0
    g.bg.routeTime = () => time; g.bg.routeDrift = () => drift; g.bg.lightningI = () => flash
    const pose = (x, cx, y, zoom, rot, floor = 0) => {
      g.player.reset(x); g.player.y = g.player.floorY = floor
      if ('prevY' in g.player) g.player.prevY = floor
      g.cam.startOnRoad(cx); Object.assign(g.cam, { x: cx, y, zoom, rot, offX: 0, offY: 0 })
    }
    const stamp = () => p?.receipt().stratumA
    const paint = (settle = true) => {
      g.paint(0, false)
      if (g.graphicsPresentation().path !== expected) throw new Error(`Unexpected render path: ${JSON.stringify(g.graphicsPresentation())}`)
      if (settle && p && !stamp().refreshed) g.paint(0, false)
    }
    const png = {}, states = {}, snaps = () => (p?.canvas ?? g.canvas).toDataURL('image/png').split(',')[1]
    const capture = name => { paint(); states[name] = a.receipt(); if (save) png[name] = snaps() }
    const stage = async () => {
      const start = performance.now(), requested = g.dpr
      g.setDiagnosticRenderScale(hdr ? 1 : p ? .85 : .65)
      do {
        paint()
        const win = g.bg.bridgeStream().window
        if (win && g.cam.x > win.origin + 240 && g.cam.x < win.origin + win.width - 240 &&
          (!p || p.transportWindow(42) === win)) break
        if (performance.now() - start > 58_000) throw new Error(`Window did not commit at ${g.cam.x}`)
        await new Promise(r => setTimeout(r, 22))
      } while (true)
      g.setDiagnosticRenderScale(requested); paint()
    }
    const cat = [...g.route.between(10_000, 21_000)].find(c => c.platform && c.role === 'catwalk').platform
    pose((cat.left + cat.right) * .5, cat.right - 81, -142, 1.10, .016, cat.y)
    await stage()
    capture('clear')
    if (deny) {
      const sample = g.ctx.getImageData(0, 0, g.canvas.width, Math.floor(100 * g.canvas.height / h)).data
      const high = sample.filter((x, i) => i % 4 === 2 && x > 25).length
      const r = { denied: a.basis === null, high, phase: a.phaseEnergy, ...a.receipt() }
      g.destroy()
      return { ...r, path: expected, states, png, teardown: g.resourceSnapshot().surfaces }
    }
    const d = a.basis, outside = new a.constructor()
    const fit = (dr, cover) => outside.update(d, g.cam, w, h, 42, a.look,
      { time, drift: dr, cover, haze: worldWeather.fog, flash: 0 })
    let best = 0, bestDrift = 0
    // Find a real edge in the shipped atlas. These stills never use the
    // controlled columns used below for the numerical verification.
    for (let dr = -96; dr <= 96; dr += .75) {
      fit(dr, .91)
      const ts = [-.51, 0, .51].map(dy => outside.transmission(outside.moon[0] - .43 * outside.moon[2], outside.moon[1] + dy * outside.moon[3]))
      const contrast = Math.max(...ts) - Math.min(...ts)
      if (contrast > best && outside.moonTransmission > .1 && outside.moonTransmission < .8) { best = contrast; bestDrift = dr }
    }
    drift = bestDrift; worldWeather.cloud = .91; worldWeather.fog = .57
    capture('broken-cloud')
    flash = .75; capture('sheet-lightning'); flash = 0
    worldWeather.cloud = .34; worldWeather.fog = .82
    capture('haze')

    // Controlled optical slabs: identical projection, phase, zoom and
    // weather, but a completely clear, half-opaque or opaque cloud column.
    const W = 640, H = 144, planeBytes = W*H*4, original = d.cloud.slice()
    const cloud = new Uint8Array(original.length)
    const put = () => {
      d.cloud.set(cloud)
      if (p) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, p.skyTextures.cloud)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, cloud.length / (W * 4), gl.RGBA, gl.UNSIGNED_BYTE, cloud)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      } else {
        // Production sky bytes are immutable; the fixture intentionally isn't.
        Object.assign(g.bg.scenery.sky, { skyHash: '', moonHash: '', mistHash: '' })
      }
    }
    const disc = (dx, dy) => {
      const x = a.moonX + dx * a.radius, y = a.moonY - dy * a.radius, count = 3
      let sum = 0
      const { width, height } = p?.canvas ?? g.canvas
      const ix = Math.round(x * width / w), iy = Math.round(y * height / h)
      const im = new Uint8Array(count * count * 4)
      if (p) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.readPixels(ix - 1, height - iy - 2, count, count, gl.RGBA, gl.UNSIGNED_BYTE, im)
      } else im.set(g.ctx.getImageData(ix - 1, iy - 1, count, count).data)
      for (let i = 0; i < im.length; i += 4) sum += im[i] + im[i+1] + im[i+2]
      return sum / (3 * count * count)
    }
    const luminosity = () => ({ ...a.receipt(), top: disc(-.47, .40), bottom: disc(-.47, -.40) })
    worldWeather.cloud = .99; worldWeather.fog = .23; worldWeather.rain = 0
    // With the new rail framed at nonzero depth, the old 1.10 crop put
    // the test disc behind the elevated rail on desktop. Sample clear sky
    // here; the natural stills above retain their full foreground geometry.
    pose(cat.left - 35, cat.right - 81, -152, .90, 0, 0)
    put(); paint(); const open = luminosity()
    const row = Math.ceil((a.stormDeck[2] + a.stormDeck[3] * a.moon[1]) * (H-1))
    for (let i = planeBytes + row * W * 4; i < planeBytes * 2; i += 4) cloud[i] = 255
    put(); paint(); const partial = luminosity()
    for (let i = planeBytes; i < planeBytes * 2; i += 4) cloud[i] = 255
    put(); paint(); const hidden = luminosity()
    cloud.set(original); put()

    // Different weather extinction at the same sheltered point. Take the
    // witness under the roof with the ground and dressings dry, but verify
    // the color really moved in open sky around it.
    const bay = [...g.route.between(5500, 23000)].find(c => c.shelter?.kind === 'service').shelter
    pose(bay.terminal + 6, bay.terminal - 23, -121, 1.05, .09)
    worldWeather.key = 0; worldWeather.wet = 0; worldWeather.cloud = .45; worldWeather.fog = .12
    await stage()
    const scene = () => {
      const { width, height } = p?.canvas ?? g.canvas, data = new Uint8Array(width * height * 4)
      if (p) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data)
      } else data.set(g.ctx.getImageData(0, 0, width, height).data)
      return { data, width, height }
    }
    const low = scene(); worldWeather.fog = .87; paint(); const high = scene()
    const fog = { dryCount: 0, dryMax: 0, skyChanged: 0 }
    for (let y = 0, i = 0; y < low.height; y++) for (let x = 0; x < low.width; x++, i += 4) {
      const u = (x+.5)/low.width, v = p ? 1-(y+.5)/low.height : (y+.5)/low.height
      const diff = Math.max(...[0,1,2].map(k => Math.abs(low.data[i+k] - high.data[i+k])))
      if (v < .23 && diff > 3) fog.skyChanged++
      const c = f.cam, sx = (u-.5)*w/c.zoom, sy = (v-.5)*h/c.zoom, co = Math.cos(c.rot), si = Math.sin(c.rot)
      const wx = c.x + sx*co + sy*si, wy = c.y - sx*si + sy*co
      if (wx > bay.left + 28 && wx < bay.right - 32 && wy > 9 && wy < 43) { fog.dryCount++; fog.dryMax = Math.max(fog.dryMax, diff) }
    }

    let driver = null
    if (p) {
      // Compare the cache with the CPU evaluator over a 7x7 lattice. This
      // includes the cache’s mist-alpha channel, which is never companded.
      const cache = p.skyCache, rgb = hdr ? new Float32Array(cache.width*cache.height*4) : new Uint8Array(cache.width*cache.height*4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, cache.fbo)
      gl.readPixels(0, 0, cache.width, cache.height, gl.RGBA, hdr ? gl.FLOAT : gl.UNSIGNED_BYTE, rgb)
      const optics = g.bg.scenery.sky.optics, evalRGB = new Float32Array(3)
      const ratio = a.air[0] / Math.max(a.air[0], stamp().opticalCeiling)
      const aa = Math.min(.24, Math.max(.018, .48 / Math.min(cache.width*a.moon[2], cache.height*ratio*a.moon[3])))
      let rgbError = 0, alphaError = 0, brightestMist = 0
      for (let v = 1; v < 8; v++) for (let u = 1; u < 8; u++) {
        const x = Math.floor(u * cache.width / 8), y = Math.floor(v * cache.height / 8)
        const U = (x+.5)/cache.width, V = (y+.5)/cache.height/ratio, i = (y*cache.width+x)*4
        optics.sky(a, U, V, evalRGB, aa)
        for (let k = 0; k < 3; k++) rgbError = Math.max(rgbError, Math.abs(evalRGB[k] - (hdr ? rgb[i+k] : (rgb[i+k]/255)**2)))
        const mist = hdr ? rgb[i+3] : rgb[i+3]/255
        alphaError = Math.max(alphaError, Math.abs(mist - optics.mist(a, U, V))); brightestMist = Math.max(brightestMist, mist)
      }
      const fb = gl.createFramebuffer(), tex = gl.createTexture(), N = 32
      gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('atmosphere probe FBO incomplete')
      const probe = (program, uniform, value) => {
        gl.useProgram(program.handle); gl.bindVertexArray(p.vao); gl.viewport(0, 0, N, N)
        gl.uniform1i(program.loc(uniform), value)
        p.skyUniforms(program, f); gl.uniform2f(program.loc('uSkyView'), 1, 1)
        if (program === p.skyProgram) p.bindSkyBasis(program, f, 0)
        else p.input(program, 'u_StratumA', 5, p.skyCache.color)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        const data = new Uint8Array(N*N*4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, data)
        gl.uniform1i(program.loc(uniform), 0)
        return data
      }
      const t = probe(p.skyProgram, 'uSkyProbe', 1)
      const fluxError = Math.max(...[a.centerTransmission, a.moonTransmission, a.key[0]].map((v, i) => Math.abs(t[i]/255-v)))
      const base = probe(p.base, 'uBaseProbe', 1), road = probe(p.road, 'u_SacrProbe', 6)
      const returnError = base.reduce((err, v, i) => Math.max(err, Math.abs(v-road[i])), 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex)
      driver = { size: stamp().size, format: stamp().format, rgbError, alphaError, brightestMist, fluxError, returnError, glError: gl.getError() }
    }

    // Keep the shipping Mobile refresh/hold, except for flash onset/tail.
    const submits = []
    if (p) {
      if (stamp().frames % 2) paint(false)
      for (const n of [0, 0, 0, .83, .54, .54, 0, 0]) {
        flash = n; drift += .04; g.cam.x += .35; paint(false)
        submits.push([stamp().refreshed, stamp().moonVis === a.key[0]])
      }
    }
    g.applyMotionPreference(true); flash = .9; paint()
    const decks = () => [...a.highDeck, ...a.stormDeck, ...a.mistDeck]
    const frozen = decks(); time += 12; drift += 38; paint()
    const quiet = { flash: a.key[1], time: a.time, frozen: frozen.every((v,i) => v === decks()[i]) }
    const variants = []
    if (p) {
      // Take actual sky-cache texels inside all four seeded discs so this
      // comparison sees the variant phase/relief uniforms, not just mist.
      g.applyMotionPreference(false); flash = drift = 0
      const optics = g.bg.scenery.sky.optics, rgb = new Float32Array(3)
      for (let seed = 40; seed <= 43; seed++) {
        g.resetRoute(seed); g.bg.setRunSeed(seed)
        Object.assign(g.bg.routeWeather.clock.sample, { fog: .25, cloud: 0, key: 1, wet: .72, rain: 0 })
        paint()
        const { fbo, width, height } = p.skyCache
        const ratio = a.air[0] / Math.max(a.air[0], stamp().opticalCeiling)
        const aa = Math.min(.24, Math.max(.018, .48 / Math.min(width*a.moon[2], height*ratio*a.moon[3])))
        const data = hdr ? new Float32Array(4) : new Uint8Array(4)
        let max = 0
        for (const dx of [-.56, -.27, .20, .55]) {
          const x = Math.floor((a.moon[0] + dx*a.moon[2]) * width), y = Math.floor(a.moon[1]*ratio*height)
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
          gl.readPixels(x, y, 1, 1, gl.RGBA, hdr ? gl.FLOAT : gl.UNSIGNED_BYTE, data)
          optics.sky(a, (x+.5)/width, (y+.5)/height/ratio, rgb, aa)
          for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(rgb[k] - (hdr ? data[k] : (data[k]/255)**2)))
        }
        variants.push({ seed, name: a.receipt().moonVariant, energy: a.phaseEnergy, max, glError: gl.getError() })
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        if (save) png[`moon-${seed}`] = snaps()
      }
    }
    const after = { ...g.renderConfig }, frame = g.graphicsPresentation().path
    g.destroy()
    return { path: frame, view: [w,h], before, after, states, naturalEdgeContrast: best, open, partial, hidden, fog, driver, submits,
      quiet, variants, png, teardown: g.resourceSnapshot().surfaces }
  }, { expected, deny, save: !!dir })
  const { png, ...r } = report
  if (dir) for (const [name, bytes] of Object.entries(png)) await writeFile(resolve(dir, `${expected}-${deny ? 'denied-' : ''}${name}.png`), Buffer.from(bytes, 'base64'))
  if (process.env.SR_RAW_REPORT) await writeFile(process.env.SR_RAW_REPORT, JSON.stringify(r, null, 2))
  assert.equal(r.teardown, 0)
  assert.ok(loads.includes(deny ? 404 : 200), `atlas status ${loads}`)
  if (deny) { assert.ok(canvas && r.denied && r.high > 100 && r.phase > .4); return { loads, ...r } }
  assert.equal(r.path, expected)
  assert.deepEqual(r.before, r.after)
  assert.ok(r.naturalEdgeContrast > .25, `authored atlas never made a partial edge: ${r.naturalEdgeContrast}`)
  const { open: o, partial: a, hidden: c } = r
  assert.ok(o.moonTransmission > .94 && a.moonTransmission > .24 && a.moonTransmission < .86 && c.moonTransmission < .004,
    JSON.stringify({ open: o, partial: a, hidden: c }))
  assert.ok(o.top > 112 && a.top < o.top * .60 && Math.abs(a.bottom - o.bottom) < 7 && c.bottom < o.bottom * .60,
    JSON.stringify({ open: o, partial: a, hidden: c }))
  assert.ok(r.fog.dryCount > 450 && r.fog.dryMax <= 2 && r.fog.skyChanged > 200, JSON.stringify(r.fog))
  if (r.driver) {
    assert.equal(r.driver.format, touch ? 'RGBA8' : 'RGBA16F'); assert.deepEqual(r.driver.size, touch ? [96,96] : [256,88])
    assert.ok(r.driver.glError === 0 && r.driver.rgbError < .010 && r.driver.alphaError < .008 && r.driver.brightestMist > .10 &&
      r.driver.fluxError < .006 && r.driver.returnError <= 1, JSON.stringify(r.driver))
    assert.deepEqual(r.submits.map(x => x[0]), touch ? [true,false,true,true,true,false,true,false] : Array(8).fill(true))
    assert.ok(r.submits.every(x => x[1]))
    assert.deepEqual(r.variants.map(v => v.name), ['Porcelain full', 'Copper half', 'Silver gibbous', 'Ash crescent'])
    assert.ok(r.variants.every(v => v.glError === 0 && v.max < (touch ? .025 : .013)), JSON.stringify(r.variants))
  }
  assert.deepEqual(r.quiet, { flash: 0, time: 0, frozen: true })
  return { loads, ...r }
})
