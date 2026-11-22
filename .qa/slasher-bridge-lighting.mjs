/** Historical v1/Noir linear probes. Run against the frozen v1 build,
 * not the current layered atmosphere. See slasher-atmosphere.mjs for v2. */
/** Production renderer verification, not a device timing benchmark.
 * The software adapter and fixed presentation inputs are local to this tab.
 * All GL reads and alternate inputs below are QA-only. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { touch, viewport, withBridge } from './bridge-browser.mjs'

const shots = process.env.SR_SHOTS
const rawReport = process.env.SR_RAW_REPORT
if (shots) await mkdir(shots, { recursive: true })
const tier = touch ? 'mobile' : 'master'
const view = touch ? viewport : { ...viewport, width: 736, height: 470 }
await withBridge(async ({ page, open, phase, button, wait }) => {
  await page.setViewport(view)
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'ultra', adaptiveQuality: false, showFps: false, muted: true,
  })))
  await open()
  await page.evaluate(() => {
    const g = window.__sr
    g.allowDiagnosticMaster()
    g.player.takeDamage = () => false
    const request = g.requestRun.bind(g)
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  })
  await button('ENGAGE'); await phase('playing')
  await wait(() => window.__sr.resourceSnapshot().presentation.gpu?.stratumA?.live)
  const report = await page.evaluate((tier, takeShots) => {
    const g = window.__sr
    cancelAnimationFrame(g.raf)
    g.enemies.length = 0; g.props.props.length = 0
    const p = g.renderer.bridgeFinish.pipe, f = g.renderer.bridgeField, gl = p.gl, master = tier === 'master'
    if (p.mode !== tier) throw new Error(`wrong tier ${JSON.stringify(p.receipt())}`)
    const before = { ...g.renderConfig }
    const frames = () => p.receipt().stratumA
    const d = f.atmo.basis, wanted = p.canvas.getContext('webgl2') === gl
    if (!wanted || !d || !p.skyTextures) throw new Error('Assets/GL context missing')
    if (d.cloud.length !== 512 * 128 * 4) throw new Error('v1-only probe. Use slasher-atmosphere.mjs for the current sky.')
    const paint = () => {
      g.paint(0, false)
      if (g.renderer.bridgeFinish.pipe !== p || !f.liveSky) throw new Error(`Unexpected fallback ${JSON.stringify(g.resourceSnapshot().presentation)}`)
    }
    const pose = (x, roll = 0) => {
      g.player.reset(x); g.cam.startOnRoad(x)
      Object.assign(g.cam, { x, y: -115, zoom: 1.07, rot: roll, offX: 0, offY: 0 })
    }
    let t = 13, cloud = .15, flash = 0
    const weather = { ...g.bg.weatherState(), key: .97, rain: .62, wet: .93, fog: .41 }
    g.bg.weatherState = () => ({ ...weather, cloud })
    g.bg.routeTime = () => t; g.bg.lightningI = () => flash
    const read = (target, format = master ? 'half' : 'byte') => {
      const data = format === 'half' ? new Float32Array(target.width * target.height * 4) : new Uint8Array(target.width * target.height * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
      gl.readPixels(0, 0, target.width, target.height, gl.RGBA, format === 'half' ? gl.FLOAT : gl.UNSIGNED_BYTE, data)
      const e = gl.getError(); if (e) throw new Error(`readPixels ${e} (${format})`)
      return { data, width: target.width, height: target.height, scale: format === 'half' ? 1 : 255 }
    }
    const gray = (a, i) => (a.data[i] + a.data[i + 1] + a.data[i + 2]) / (3 * a.scale)
    const skyGray = (a, i) => master ? gray(a, i) : [0, 1, 2].reduce((v, k) => v + (a.data[i + k] / 255) ** 2, 0) / 3
    const sceneSkips = () => g.ctx.getImageData(45, 20, 1, 1).data[3]
    const snaps = {}
    const snap = name => { if (takeShots) snaps[name] = p.canvas.toDataURL('image/png').split(',')[1] }
    pose(1930)
    const { azimuth } = g.bg.lightState(), keyX = .64 + .25 * azimuth
    const astron = new f.atmo.constructor(), { cssW: w, cssH: h } = g
    let clear = null, occluded = null
    for (let n = 0; n < 1750 && (!clear || !occluded); n++) {
      const tm = .2 + n * .22
      astron.update(d, g.cam, w, h, 42, 0, keyX, tm, .15, 0, tier)
      if (!clear && astron.key[0] > .982 && astron.occ < .24) clear = [tm, .15]
      astron.update(d, g.cam, w, h, 42, 0, keyX, tm, .995, 0, tier)
      if (!occluded && astron.key[0] < .025) occluded = [tm, .995]
    }
    if (!clear || !occluded) throw new Error(`No contrasting authored storm columns: ${JSON.stringify({ clear, occluded })}`)
    const keyFrame = (pair, label) => {
      [t, cloud] = pair; paint()
      if (!frames().refreshed) paint()
      const a = frames(), actor = g.renderer.probes.get(g.player)?.lunar
      snap(label)
      return { ...a, actor, castActors: f.casts.casters, cpuMoon: f.atmo.key[0], canvasSkyAlpha: sceneSkips() }
    }
    const clearFrame = keyFrame(clear, `${tier}-clear`), hiddenFrame = keyFrame(occluded, `${tier}-occluded`)

    // The same fixed local source steers posed fighters and destructible
    // props on Master, and Mobile resolves only the admitted two flash IDs.
    const fxEmit = g.fx.bridgeEmitters, hw = g.fx
    let handoff = null, selectedLights = null
    if (master) {
      g.props.props.push({ id: -23, kind: 'med', x: 2037, hp: 2, dead: false, respawn: 0, hitAt: -10, born: -1 })
      const packet = f.casts, prop = packet.prop, actor = packet.actor
      let body, crate
      packet.prop = function (x, w, h, slope, gain) { crate = { slope, gain }; return prop.call(this, x, w, h, slope, gain) }
      packet.actor = function (a, slope, gain, support) {
        if (a === g.player) body = { slope, gain }
        return actor.call(this, a, slope, gain, support)
      }
      const cast = () => ({ body, crate, vertices: packet.count })
      try {
        ;[t, cloud] = clear; paint(); const lunar = cast()
        ;[t, cloud] = occluded; paint(); const blocked = cast()
        hw.bridgeEmitters = function (f) { fxEmit.call(this, f); f.light(3, 2150, -99, 560, '#ffc983', 2.7, 7) }
        paint()
        handoff = { lunar, blocked, practical: cast(), moonVis: frames().moonVis }
        snap('master-practical')
      } finally {
        hw.bridgeEmitters = fxEmit; packet.prop = prop; packet.actor = actor; g.props.props.length = 0
      }
    } else {
      let admitted, skip = false
      hw.bridgeEmitters = function (f) {
        fxEmit.call(this, f)
        const x = 1930
        admitted = [f.light(0, x - 145, -95, 163, '#54637d', .44, 2), f.light(3, x - 128, -57, 123, '#ffc572', 2.7, 4),
          f.light(0, x + 151, -95, 168, '#63507e', .49, 2), f.light(3, x + 116, -65, 130, '#89d8ff', 2.5, 4),
          f.light(3, x, -72, 160, '#ff7272', 3.2, 4)]
        if (skip) f.mobileFlashIndices.fill(-1)
      }
      try {
        paint(); if (!frames().refreshed) paint()
        const on = read(p.scene), indices = [...f.mobileFlashIndices], uniforms = [p.base, p.resolve, p.emission].map(program =>
          [...gl.getUniform(program.handle, program.loc('uFlashIDs'))])
        skip = true; paint()
        const off = read(p.scene); let left = 0, right = 0
        for (let y = Math.floor(on.height * .274); y < on.height * .40; y++) for (let x = 0; x < on.width; x++) {
          const i = (y * on.width + x) * 4
          if (gray(on, i) - gray(off, i) > .02) { if (x < on.width / 2) left++; else right++ }
        }
        selectedLights = { admitted, indices, uniforms, left, right, impulses: f.impulseCount }
      } finally { hw.bridgeEmitters = fxEmit }
    }

    // Consecutive actual submits; hash/count cadence is taken from the live
    // presenter, not from a mock RAF. Lightning is injected on an odd frame.
    if (frames().frames % 2) paint()
    const cadence = []
    for (const [i, value] of [0, 0, 0, .84, .52, .52, 0, 0].entries()) {
      t += .020; g.cam.x += .28; flash = value
      paint(); const a = frames(), aCPU = f.atmo
      cadence.push({ i, flash: value, frame: a.frames, refresh: a.refreshes, didRefresh: a.refreshed, moon: a.moonVis, cpuMoon: aCPU.key[0], moonX: aCPU.moonX })
    }

    // Read the small linear radiance texture directly to measure locality,
    // not what the post/sector LUT or scenery happened to cover.
    flash = 0; paint(); if (!frames().refreshed) paint()
    const off = read(p.skyCache)
    flash = .88; paint(); const epicenter = frames().lightningEpicenter, on = read(p.skyCache)
    const storm = { near: 0, far: 0, global: 0, epicenter, nearCount: 0, farCount: 0 }
    for (let y = 0; y < on.height; y++) for (let x = 0; x < on.width; x++) {
      const dist = Math.abs((x + .5) / on.width - epicenter), i = (y * on.width + x) * 4
      const delta = Math.abs(skyGray(on, i) - skyGray(off, i))
      if (dist < .08) { storm.near += delta; storm.nearCount++ }
      if (dist > .46) { storm.far = Math.max(storm.far, delta); storm.farCount++ }
      storm.global = Math.max(storm.global, delta)
    }
    storm.near /= storm.nearCount
    // Snap before any diagnostic FBO draw, and in a tick where the default
    // framebuffer has just been presented by the real pipeline.
    paint(); snap(`${tier}-sheet-lightning`)

    // Compare the exact CPU/cloud atlas evaluation and the live shaders'
    // bilinear screen/ground samples in a separate small RGBA8 probe target.
    const probe = { fbo: gl.createFramebuffer(), width: 16, height: 16, color: gl.createTexture() }
    gl.bindFramebuffer(gl.FRAMEBUFFER, probe.fbo); gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, probe.color)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, probe.color, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('tiny sky probe incomplete')
    const drawProbe = (program, flag, code, bind) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, probe.fbo); gl.viewport(0, 0, 16, 16)
      gl.bindVertexArray(p.vao); gl.disable(gl.BLEND); gl.useProgram(program.handle)
      gl.uniform1i(program.loc(flag), code)
      try { bind(); gl.drawArrays(gl.TRIANGLES, 0, 3); return read(probe, 'byte').data }
      finally { gl.uniform1i(program.loc(flag), 0) }
    }
    const { cloud: cloudTex, lunar, horizon } = p.skyTextures
    const match = drawProbe(p.skyProgram, 'uSkyProbe', 1, () => {
      p.input(p.skyProgram, 'uCloudBasis', 0, cloudTex); p.input(p.skyProgram, 'uLunarBasis', 1, lunar); p.input(p.skyProgram, 'uHorizonBasis', 2, horizon)
    })
    const skyBind = program => () => {
      p.input(program, 'u_StratumA', 5, p.skyCache.color)
      gl.uniform2f(program.loc('uSkyView'), 1, 1)
    }
    const screen = drawProbe(p.base, 'uBaseProbe', 1, skyBind(p.base))
    const puddle = drawProbe(p.road, 'u_SacrProbe', 6, skyBind(p.road))
    const matchError = Math.max(Math.abs(match[0] / 255 - f.atmo.occ), Math.abs(match[1] / 255 - f.atmo.key[0]))
    let skyMaxError = 0
    for (let i = 0; i < screen.length; i++) skyMaxError = Math.max(skyMaxError, Math.abs(screen[i] - puddle[i]) / 255)
    const parity = { driverCloud: match[0] / 255, cpuCloud: f.atmo.occ, driverMoon: match[1] / 255, cpuMoon: f.atmo.key[0],
      maxCenterError: matchError, skyMaxError, litSamples: screen.filter((v, i) => i % 4 !== 3 && v > 2).length }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(probe.fbo); gl.deleteTexture(probe.color)

    const cat = [...g.route.between(0, 20000)].find(c => c.role === 'catwalk')
    const s = cat.platform, roofL = s.left, roofR = s.right + 23
    pose(roofR - 48, .052); cloud = .15; flash = 0
    paint(); if (!frames().refreshed) paint()
    snap(`${tier}-catwalk`)
    // Saturate K with actual posed enemy capsules before reading architecture.
    const bodyCount = master ? 12 : 30 // Mobile admits only two opaque limbs per enemy.
    for (let i = 0; i < bodyCount; i++) {
      g.debugSpawn(i % 2 ? 'heavy' : 'grunt', roofR - 145 + i * (master ? 13 : 6))
      g.enemies.at(-1).arriveOnRoute(-1)
    }
    paint()
    const crowd = f.sacr.receipt()
    const oldPacket = f.sacr.packet.u32.slice(), origWet = f.wet, oldCast = f.casts.count
    const target = p.scene
    const ground = (wet = .93, ink = false) => {
      f.wet = wet; f.casts.count = ink ? 1 : 0
      if (ink) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, p.castCoverage.fbo)
        gl.clearColor(.66, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
      }
      gl.bindVertexArray(p.vao); gl.disable(gl.BLEND)
      p.ground(f, w, h, target)
      return read(target)
    }
    const visit = (surface, fun) => {
      const c = f.cam, co = Math.cos(c.rot), si = Math.sin(c.rot)
      for (let y = 0; y < surface.height; y++) for (let x = 0; x < surface.width; x++) {
        const dx = ((x + .5) / surface.width - .5) * w / c.zoom, dy = (.5 - (y + .5) / surface.height) * h / c.zoom
        const wx = c.x + dx * co + dy * si, wy = c.y - dx * si + dy * co
        if (wy < -40 || wy > 45) continue
        const zone = wx > roofL + 80 && wx < roofR - 68 ? 'covered' : wx > roofR + 99 ? 'open' : null
        if (zone) fun(zone, (y * surface.width + x) * 4, wx, wy)
      }
    }
    let slabSlots = 0, shadow = null
    const sample = { covered: { pixels: 0, changed: 0, max: 0, mean: 0, wetWithoutSlab: 0 }, open: { pixels: 0, changed: 0, max: 0, mean: 0, wetWithoutSlab: 0 } }
    try {
      const wetReal = ground(), dry = ground(0)
      if (master) {
        const wetInk = ground(.93, true), dryInk = ground(0, true)
        shadow = { castActors: clearFrame.castActors, openDarkened: 0, coveredMax: 0, wetRadianceDeltaError: 0,
          maxOpenDarkening: 0, samples: 0, localReturnDelta: 0, localReturnPeak: 0 }
        visit(wetReal, (zone, i) => {
          shadow.samples++
          const diffuse = gray(dry, i) - gray(dryInk, i)
          if (zone === 'open' && diffuse > .002) shadow.openDarkened++
          if (zone === 'open') shadow.maxOpenDarkening = Math.max(shadow.maxOpenDarkening, diffuse)
          else shadow.coveredMax = Math.max(shadow.coveredMax, Math.abs(diffuse))
          for (let k = 0; k < 3; k++) {
            const a = wetReal.data[i + k] - dry.data[i + k], b = wetInk.data[i + k] - dryInk.data[i + k]
            shadow.wetRadianceDeltaError = Math.max(shadow.wetRadianceDeltaError, Math.abs(a - b))
          }
        })
        // At fixed wetness, remove only albedo and incident sky. What remains
        // is local/posed return and specular. An ink mask must not change it.
        const black = gl.createTexture(), base = p.baseTex, sky = p.skyCache.color, moon = f.atmo.key[0]
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, black)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        try {
          p.baseTex = p.skyCache.color = black; f.atmo.key[0] = 0
          const lit = ground(.93), occluded = ground(.93, true)
          visit(lit, (_zone, i) => {
            shadow.localReturnPeak = Math.max(shadow.localReturnPeak, gray(lit, i))
            for (let k = 0; k < 3; k++) shadow.localReturnDelta = Math.max(shadow.localReturnDelta, Math.abs(lit.data[i+k] - occluded.data[i+k]))
          })
        } finally { p.baseTex = base; p.skyCache.color = sky; f.atmo.key[0] = moon; gl.deleteTexture(black) }
      }
      // Only remove the reserved architecture entries. Wetness, diffuse
      // basis, portal data, footprint AO, and all fighter records are intact.
      const q = f.sacr.packet.u32, K = f.sacr.maxK
      for (let col = 0; col < 80; col++) {
        let first = 0, second = 0, kept = 0
        for (let k = 0; k < K; k++) {
          const id = oldPacket[col * 2 + (k >>> 2)] >>> ((k & 3) * 8) & 255
          if (!id) break
          const prim = 160 + (id - 1) * 4, meta = oldPacket[prim + 3]
          if ((oldPacket[prim + 2] & 0x8000) === 0 && meta >>> 26 === 63 && (meta >>> 21 & 31) === 0) { slabSlots++; continue }
          if (kept < 4) first |= id << (kept * 8); else second |= id << ((kept - 4) * 8)
          kept++
        }
        q[col * 2] = first >>> 0; q[col * 2 + 1] = second >>> 0
      }
      const wetNoSlab = ground()
      visit(wetReal, (zone, i) => {
        const r = sample[zone]
        const diff = Math.abs(gray(wetReal, i) - gray(wetNoSlab, i))
        r.pixels++; if (diff > (master ? .0005 : .5 / 255)) r.changed++
        r.max = Math.max(r.max, diff); r.mean += diff
        r.wetWithoutSlab = Math.max(r.wetWithoutSlab, gray(wetNoSlab, i) - gray(dry, i))
      })
      for (const r of Object.values(sample)) r.mean /= r.pixels
    } finally {
      f.wet = origWet; f.casts.count = oldCast; f.sacr.packet.u32.set(oldPacket)
    }
    g.enemies.length = 0
    const roof = [...g.route.between(0, 7200)].find(c => c.shelter?.kind === 'service').shelter
    pose(roof.terminal, .04); paint(); if (!frames().refreshed) paint()
    snap(`${tier}-service-bay`)
    const calmRoof = read(p.scene)
    flash = .88; paint()
    const flashRoof = read(p.scene)
    const service = { litRoofPixels: 0, shelteredSamples: 0, maxRoofDelta: 0, maxShelteredDelta: 0 }
    const c = f.cam, co = Math.cos(c.rot), si = Math.sin(c.rot)
    for (let iy = 0; iy < calmRoof.height; iy++) for (let ix = 0; ix < calmRoof.width; ix++) {
      const dx = ((ix + .5) / calmRoof.width - .5) * w / c.zoom, dy = (.5 - (iy + .5) / calmRoof.height) * h / c.zoom
      const x = c.x + dx * co + dy * si, y = c.y - dx * si + dy * co
      if (x < roof.left + 35 || x >= roof.right - 35) continue
      const i = (iy * calmRoof.width + ix) * 4, diff = Math.abs(gray(flashRoof, i) - gray(calmRoof, i))
      if (y >= -260 && y <= -222) {
        if (diff > .002) service.litRoofPixels++
        service.maxRoofDelta = Math.max(service.maxRoofDelta, diff)
      }
      if (y >= -16 && y <= 41) {
        service.shelteredSamples++
        service.maxShelteredDelta = Math.max(service.maxShelteredDelta, diff)
      }
    }
    const summary = g.resourceSnapshot(), final = summary.presentation, lock = g.renderConfig
    const adapter = gl.getExtension('WEBGL_debug_renderer_info')
    const timingExtension = !!gl.getExtension('EXT_disjoint_timer_query_webgl2')
    const renderer = gl.getParameter(adapter?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)
    g.applyMotionPreference(true); paint()
    const quiet = { flash: frames().flash, refreshed: frames().refreshed, time: f.weatherTime, scarves: f.sacr.scarves, landings: f.landingCount }
    g.applyMotionPreference(false)
    let beforeRepair
    p.present = () => { beforeRepair = sceneSkips(); return false }
    const sim = g.time
    g.paint(0, false)
    const repair = { alphaBefore: beforeRepair, alphaAfter: sceneSkips(), path: g.resourceSnapshot().presentation.path,
      sameTick: g.time === sim, lock: g.renderConfig }
    g.destroy()
    const end = g.resourceSnapshot()
    return { tier, renderer, timingExtension, view: [w, h], before, lock, clearFrame, hiddenFrame, cadence, storm, parity, shadow, service, handoff, selectedLights, quiet, repair,
      roofGeometry: { span: [roofL, roofR], slabSlots, bodyCount, crowd, sample }, final, stores: summary.surfaces, teardown: [end.surfaces, end.bytes], snaps }
  }, tier, !!shots)
  if (rawReport) await writeFile(rawReport, JSON.stringify({ ...report, snaps: undefined }, null, 2))
  const { clearFrame: clear, hiddenFrame: hidden, cadence, storm, parity, shadow, roofGeometry, snaps } = report
  if (shots) for (const [name, png] of Object.entries(snaps)) await writeFile(resolve(shots, `${name}.png`), Buffer.from(png, 'base64'))
  assert.deepEqual(clear.size, touch ? [128, 32] : [256, 64]); assert.equal(clear.format, touch ? 'RGBA8' : 'RGBA16F')
  assert.ok(clear.moonVis > .98 && hidden.moonVis < .028 && clear.actor > .50 && hidden.actor < .035, JSON.stringify({ clear, hidden }))
  assert.equal(clear.canvasSkyAlpha, 0, 'world input must leave the sky transparent')
  assert.deepEqual(cadence.map(x => x.didRefresh), touch ? [true, false, true, true, true, false, true, false] : Array(8).fill(true))
  assert.ok(cadence.every(x => x.moon === x.cpuMoon))
  assert.ok(storm.near > .012 && storm.farCount > 0 && storm.far === 0, JSON.stringify(storm))
  assert.ok(parity.maxCenterError < .01 && parity.skyMaxError <= 1 / 255 && parity.litSamples > 200, JSON.stringify(parity))
  assert.ok(roofGeometry.slabSlots > 8 && roofGeometry.crowd.primitives === 64 && roofGeometry.crowd.maxK === (touch ? 4 : 6), JSON.stringify(roofGeometry))
  assert.ok(roofGeometry.sample.covered.changed > 400 && roofGeometry.sample.covered.wetWithoutSlab > .012, JSON.stringify(roofGeometry))
  assert.ok(roofGeometry.sample.open.pixels > 1500 && roofGeometry.sample.open.changed === 0, JSON.stringify(roofGeometry))
  if (shadow) assert.ok(shadow.castActors > 0 && shadow.openDarkened > 400 && shadow.coveredMax < shadow.maxOpenDarkening * .20 &&
    shadow.localReturnDelta <= 1e-5 && shadow.localReturnPeak > .004, JSON.stringify(shadow))
  assert.ok(report.service.litRoofPixels > 50 && report.service.shelteredSamples > 500 && report.service.maxShelteredDelta <= .001, JSON.stringify(report.service))
  if (report.handoff) {
    const { lunar, blocked, practical } = report.handoff
    assert.ok(lunar.vertices > 80 && blocked.vertices === 0 && practical.vertices > 80, JSON.stringify(report.handoff))
    for (const name of ['body', 'crate']) assert.ok(lunar[name].slope > .65 && blocked[name].gain < .006 && practical[name].slope < -.12 && practical[name].gain > .25, JSON.stringify(report.handoff))
  }
  if (report.selectedLights) {
    const { admitted, indices, uniforms, left, right, impulses } = report.selectedLights
    assert.deepEqual(admitted, [true, true, true, true, false])
    assert.deepEqual(indices, [1, 3]); assert.deepEqual(uniforms, [[1, 3], [1, 3], [1, 3]])
    assert.ok(left >= 20 && right >= 20 && left + right < 1800 && impulses === 2, JSON.stringify(report.selectedLights))
  }
  assert.deepEqual(report.quiet, { flash: 0, refreshed: true, time: 0, scarves: 0, landings: 0 })
  assert.deepEqual(report.repair, { alphaBefore: 0, alphaAfter: 255, path: 'mobile-canvas', sameTick: true, lock: report.lock })
  assert.deepEqual(report.before, report.lock); assert.equal(report.lock.renderScale, 1.25); assert.deepEqual(report.teardown, [0, 0])
  delete report.snaps
  return report
})
