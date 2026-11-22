/** Production city/lighting proof. Use --touch for Optimized; --touch
 * --canvas with SR_SOFTWARE=1 for fallback. Frame probes are diagnostics
 * only: the committed scene never reads pixels to discover a light. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { touch, viewport, withBridge } from './bridge-browser.mjs'

const canvas = process.argv.includes('--canvas')
const kind = canvas ? 'canvas' : touch ? 'optimized' : 'hdr'
const expected = canvas ? 'mobile-canvas' : touch ? 'mobile-webgl2' : 'master-webgl2'
const shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })

await withBridge(async ({ page, open, button, phase, wait }) => {
  if (!touch) await page.setViewport({ ...viewport, width: 848, height: 520 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true, showFps: false,
  })))
  await open()
  await page.evaluate(({ canvas, touch }) => {
    const g = window.__sr, request = g.requestRun.bind(g)
    if (!canvas) g.allowDiagnosticMaster()
    if (touch) g.preferDiagnosticMobile()
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  }, { canvas, touch })
  await button('ENGAGE'); await phase('playing')
  await wait(expected => window.__sr.graphicsPresentation().path === expected, expected)
  const result = await page.evaluate(async ({ expected, save }) => {
    const g = window.__sr, f = g.renderer.bridgeField, pipe = g.renderer.bridgeFinish.pipe, gl = pipe?.gl
    const { player: p, cam } = g, weather = g.bg.routeWeather.clock.sample
    cancelAnimationFrame(g.raf); g.qaMode = true; g.enemies.length = 0; g.props.props.length = 0
    g.hitstopT = 0; g.fx.clear(); g.banner = null; g.streamQuiet = true
    Object.assign(weather, { fog: .22, cloud: .18, key: 1, wet: .82, rain: .31 })
    let clock = 30
    g.bg.routeTime = () => clock; g.bg.routeDrift = () => 16; g.bg.lightningI = () => 0
    const png = {}, render = () => {
      g.paint(0, false)
      if (g.graphicsPresentation().path !== expected) throw new Error(`Renderer left ${expected}`)
    }
    const shot = name => { if (save) png[name] = (pipe?.canvas ?? g.canvas).toDataURL('image/png').split(',')[1] }
    const pose = (x, cx = x, floor = 0) => {
      g.cam.startOnRoad(cx); p.reset(x)
      p.y = p.prevY = p.floorY = floor
    }
    const stage = async () => {
      const t = performance.now(), scale = g.dpr
      g.setDiagnosticRenderScale(pipe?.mode === 'master' ? 1 : pipe ? .85 : .65)
      do {
        render()
        const w = g.bg.bridgeStream().window
        if (w && cam.x > w.origin + 120 && cam.x < w.origin + w.width - 120 && (pipe ? pipe.transportWindow(42) === w : g.bg.bridgeStream().plate(g.route.at(cam.x).index, true))) break
        if (performance.now() - t > 55_000) throw Error(`Transport did not commit at ${cam.x}`)
        await new Promise(r => setTimeout(r, 16))
      } while (true)
      g.setDiagnosticRenderScale(scale); render()
    }

    // The same fixed road mark used on the pre-change portrait build.
    pose(2600); cam.setShakeEnabled(true)
    const boss = g.encounters.gate.x, gateX = boss - 238
    const tick = () => g.updateCamera(1/60)
    const roadX = x => g.project(x, 0).x
    const px = roadX(p.x)
    p.face = -1
    for (let i = 0; i < 90; i++) { cam.addTrauma(.29); tick() }
    const turn = roadX(p.x) - px
    const x0 = p.x
    let backward = 0
    for (let i = 0; i < 110; i++) {
      const old = cam.x
      p.x += 5; p.vx = 300; tick(); backward = Math.max(backward, old - cam.x)
    }
    const travel = cam.x - x0, moving = roadX(x0)
    p.vx = 0
    for (let i = 0; i < 120; i++) tick()
    const stopped = roadX(x0) - moving
    let reverse = 0
    for (let i = 0; i < 110; i++) {
      const previous = cam.x
      p.x -= 5; p.vx = -300; tick(); reverse = Math.max(reverse, cam.x - previous)
    }
    pose(gateX); tick(); g.encounters.gate.state = 'locked'
    g.debugSpawn('boss', boss - 92)
    const b = g.enemies.at(-1); b.arriveOnRoute(-1); b.gate = g.encounters.gate.index
    for (let i = 0; i < 90; i++) tick()
    const inFight = roadX(gateX), bossOnscreen = roadX(b.x)
    g.enemies.length = 0; g.encounters.openGate(g.encounters.gate.index)
    for (let i = 0; i < 120; i++) tick()
    const cleared = roadX(gateX) - inFight
    const motion = { turn, stopped, cleared, travel, backward, reverse, bossOnscreen, viewport: g.cssW }

    const pixels = (left, top, width, height) => {
      if (pipe) {
        const a = new Uint8Array(width * height * 4)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.readPixels(left, pipe.canvas.height - top - height, width, height, gl.RGBA, gl.UNSIGNED_BYTE, a)
        return a
      }
      return g.ctx.getImageData(left, top, width, height).data
    }
    const projectedPixel = (x, y) => {
      const out = pipe?.canvas ?? g.canvas, q = g.project(x, y)
      return [Math.round(q.x * out.width / g.cssW), Math.round(q.y * out.height / g.cssH)]
    }
    const patch = (x, y) => {
      const [xx, yy] = projectedPixel(x, y)
      return pixels(xx - 7, yy - 7, 15, 15)
    }
    // Seed 42 has an exposed guide and a sodium pole on opposite sides
    // of this mark in the second Metro chunk. The old entry mark only
    // receives the cool lobe. Cut one lobe without changing street lighting.
    pose(g.route.chunk(1).left + 869); await stage()
    const fixturesAt = f.receiveFixtures.bind(f)
    let cut = ''
    f.receiveFixtures = (x, y, depth, out) => {
      fixturesAt(x, y, depth, out)
      for (const lobe of out) if (cut === 'all' || cut === (lobe.r > lobe.b * 2 ? 'warm' : 'cool')) lobe.strength = 0
    }
    render()
    // Measure the silhouette envelope, not fixed-size squares centered on
    // joints. In Master, the weak cooler lobe mostly reaches the outer edge.
    const { headC, chest, hip, elbL, elbR, handL, handR, kneeL, kneeR, ankleL, ankleR } = p.geom
    const joints = [headC, chest, hip, elbL, elbR, handL, handR, kneeL, kneeR, ankleL, ankleR]
      .map(j => projectedPixel(p.x + p.face * p.scale * j.x, p.hipY + p.scale * j.y))
    const out = pipe?.canvas ?? g.canvas, margin = Math.ceil(18 * p.scale * cam.zoom * out.width / g.cssW)
    const xs = joints.map(j => j[0]), ys = joints.map(j => j[1])
    const left = Math.max(0, Math.min(...xs) - margin), top = Math.max(0, Math.min(...ys) - margin)
    const size = [Math.min(out.width, Math.max(...xs) + margin) - left, Math.min(out.height, Math.max(...ys) + margin) - top]
    const actorPixels = () => pixels(left, top, ...size)
    const both = actorPixels(), parts = g.renderer.probes.get(p).local
    const torso = parts[0].fixtures.map(l => ({...l})), litParts = parts.filter(part => part.fixtures.some(l => l.strength > .02)).length
    const fixtureDiff = (a, b) => {
      const rgb = [0, 0, 0]; let changed = 0
      for (let i = 0; i < a.length; i += 4) {
        let pixel = 0
        for (let k = 0; k < 3; k++) { const d = a[i+k] - b[i+k]; pixel += Math.abs(d); rgb[k] += d }
        changed += +(pixel >= 4)
      }
      return { rgb, changed }
    }
    cut = 'warm'; render(); const warm = fixtureDiff(both, actorPixels())
    cut = 'cool'; render(); const cool = fixtureDiff(both, actorPixels())
    cut = 'all'; render(); shot('fixtures-off')
    f.receiveFixtures = fixturesAt; render(); shot('fixtures-on')
    const fixtures = { x: p.x, torso, litParts, warm, cool, restored: fixtureDiff(both, actorPixels()), size, dynamic: f.impulseCount }

    const street = g.bg.scenery, rail = street.rail, main = g.route.chunk(1)
    pose(main.left + 377); await stage(); render(); shot('metro')
    const timeline = rail.schedule, start = cam.x
    const crosses = (e, x = cam.x) => timeline.crossingTime(e, x)
    const stock = []
    for (const k of [0, 1, 2, 3]) {
      const e = timeline.events.find(e => e.kind === k)
      clock = crosses(e) + 105 / e.speed
      render(); stock.push({ ...rail.last }); shot(k === 0 ? 'train' : `stock-${k}`)
    }
    const pass = stock[0], z = pass.scale
    let pair = null
    // Evaluate the meeting point of two independent world trajectories,
    // rather than hoping an arbitrary camera range shows both heads.
    for (let i = 1; i < timeline.events.length && !pair; i++) {
      const a = timeline.events[i - 1], b = timeline.events[i]
      if (b.at - a.at >= 1 || a.dir === b.dir) continue
      const da = crosses(a, 1000) - crosses(a, 0), db = crosses(b, 1000) - crosses(b, 0)
      const x = 1000 * (b.at - a.at) / (da - db)
      if (!(x > 0)) continue
      pose(x); clock = crosses(a, x) + .03; await stage(); render()
      if (rail.last.trains === 2 && rail.last.bodies >= 2) pair = { x, at: clock, directions: [a.dir, b.dir], ...rail.last }
    }
    if (pair) shot('double-pass')

    // One moving pass compared either side of an actual support seam.
    const e0 = timeline.events.find(e => e.kind === 0)
    const nativePerWorld = Math.abs(crosses(e0, start + 1) - crosses(e0, start)) * e0.speed
    const half = g.cssW / (2 * z), seam = (Math.round((start * nativePerWorld - half) / 426) * 426 + half) / nativePerWorld
    clock = crosses(e0, seam) + .27
    pose(seam - .125); render(); const before = { ...rail.last }
    pose(seam + .125); render(); const seamDelta = { x: Math.abs(before.leadX - rail.last.leadX), wake: Math.abs(before.wake - rail.last.wake), nativePerWorld,
      bodies: [before.bodies, rail.last.bodies] }
    pose(start)
    clock = crosses(e0) + 105 / e0.speed; render(); const activeTrains = rail.last.trains
    g.applyMotionPreference(true); render()
    const reduced = { trains: rail.last.trains, wake: rail.last.wake, activeTrains, flash: f.thunder }
    g.applyMotionPreference(false)

    const garden = [...g.route.between(10000, 18600)].find(c => c.role === 'catwalk' && c.visualBand === 2), support = garden.platform
    pose(support.right - 98, support.right + 5, support.y)
    clock = 30; await stage(); render(); shot('skywalk')
    const deckX = support.right - 19, deckY = support.y - 5, deckOff = patch(deckX, deckY)
    const origEmit = g.fx.bridgeEmitters.bind(g.fx)
    g.fx.bridgeEmitters = frame => frame.light(3, deckX - 14, support.y - 48, 138, '#61e3ff', 3.4, 3)
    render(); const deckOn = patch(deckX, deckY)
    const deck = { maxBlue: 0, changed: 0, slabCasts: !f.transmitted(deckX, support.y + 43, deckX - 14, support.y - 48) }
    for (let i = 2; i < deckOn.length; i += 4) {
      const d = deckOn[i] - deckOff[i]; deck.maxBlue = Math.max(deck.maxBlue, d); deck.changed += +(d > 3)
    }
    g.fx.bridgeEmitters = origEmit

    // Admit a source into the actual packet but draw no luminous core. A
    // change inside the same posed silhouette must come from its receiver.
    const c = [...g.route.between(6300, 10900)].find(c => !c.shelter && c.left > 5100)
    const x = c.left + 215, sourceX = x + 10, sourceY = -74
    pose(x); cam.setShakeEnabled(false)
    g.debugSpawn('grunt', x + 72)
    const e = g.enemies.at(-1); e.arriveOnRoute(-1); e.vx = 0; e.flashT = e.litT = 0
    e.state = 'stun'; e.stunT = 1
    e.update(0, { ...g.worldRef, time: clock, arenaMinX: -Infinity, arenaMaxX: Infinity, enemyTravel: undefined })
    e.state = 'idle'
    const prop = { id: 121, kind: 'shock', x: x - 74, hp: 2, hitAt: -5, dead: false, born: -20, respawn: 0 }
    g.props.props.push(prop)
    await stage()
    const addBlockers = f.gatherBlockers.bind(f), emit = g.fx.bridgeEmitters.bind(g.fx)
    let on = false, blocked = false
    g.fx.bridgeEmitters = frame => {
      emit(frame)
      if (on) frame.light(3, sourceX, sourceY, 226, '#ff6741', 3.5, 4, sourceX + 10, sourceY - 12)
    }
    f.gatherBlockers = (...args) => {
      addBlockers(...args)
      if (!blocked) return
      const block = { left: x + 34, right: x + 38, top: -226, bottom: 32, kind: 'jamb' }
      const k = f.blockerCount++ * 4
      f.blockers.push(block); f.blockerData.set([block.left - cam.x, block.top, block.right - cam.x, block.bottom], k)
    }
    const point = (a, joint) => [a.x + joint.x * a.scale * a.face, a.hipY + joint.y * a.scale]
    const areas = { player: point(p, p.geom.waist), enemy: point(e, e.geom.waist), prop: [prop.x, -52], road: [x + 16, 13] }
    const probes = () => Object.fromEntries(Object.entries(areas).map(([name, point]) => [name, patch(...point)]))
    const compare = (a, b) => Object.fromEntries(Object.keys(a).map(name => {
      let maxR = 0, changed = 0, r = 0, g = 0, blue = 0
      for (let i = 0; i < a[name].length; i += 4) {
        const dr = b[name][i] - a[name][i], dg = b[name][i+1] - a[name][i+1], db = b[name][i+2] - a[name][i+2]
        r += dr; g += dg; blue += db; maxR = Math.max(maxR, dr); changed += +(dr > 5)
      }
      return [name, { maxR, changed, rgbDelta: [r, g, blue] }]
    }))
    render(); const off = probes(); shot('receivers-off')
    on = true; render(); const lit = probes(); shot('receivers-on')
    const local = [p, e].map(a => g.renderer.probes.get(a).local.map(p => p.strength))
    blocked = true; render(); const shaded = probes()
    const blockedSource = g.renderer.probes.get(e).local[0].strength
    on = blocked = false; render(); const restored = probes()
    g.fx.bridgeEmitters = emit; f.gatherBlockers = addBlockers

    // A real active projectile drives the same packet, not a bespoke test path.
    g.projectiles.spawn({ kind: 'orb', x: sourceX, y: sourceY, vx: 0, vy: 0, dmg: 0, life: 1 })
    render(); const orb = { impulse: f.impulseCount, color: f.cssColor[f.mobileFlashIndices[0]], torso: g.renderer.probes.get(p).local[0].strength }
    shot('orb')
    // Production admission favors a confirmed impact. HDR retains the orb
    // in a separate slot; the cheap path must not light from it off-packet.
    g.fx.impact(sourceX + 9, sourceY - 9, .1, true, '#ff9e56', '#ffd5b3')
    render(); const i = f.mobileFlashIndices[0] * 4
    const priority = { hits: f.impulseCount, impactFirst: Math.abs(f.source[i] + f.cam.x - (sourceX + 9)) < .001,
      orbKept: f.cssColor.slice(0, f.count).includes('#35f2ff') }
    g.projectiles.clear(); g.fx.clear()
    g.fx.lightningCast({ enemies: [], minX: 0, maxX: Infinity }, sourceX - 45, sourceY - 9, 1, .08, { color: '#41f6ff', maxLen: 150 })
    const bolt = g.fx.lightning.bolts.find(bolt => bolt.active)
    const spanProof = () => {
      const spans = []
      for (let i = 0; i < f.count; i++) {
        if (f.cssColor[i] !== '#41f6ff') continue
        const k = i * 4
        spans.push([f.source[k] + f.cam.x, f.source[k + 1], f.shape[k] + f.cam.x, f.shape[k + 1]])
      }
      const match = span => bolt.legs.some(leg => {
        for (let i = 0; i + 3 < leg.length; i += 2) if (span.every((x, j) => Math.abs(x - leg[i + j]) < .001)) return true
        return false
      })
      return { count: spans.length, match: spans.every(match), first: spans[0] }
    }
    render(); const a = spanProof(); shot('restrike')
    g.fx.update(.069); render(); const b2 = spanProof()
    g.fx.update(.145); render(); const lightning = { first: a, restrike: b2, after: f.impulseCount }
    const glError = gl?.getError() ?? 0, path = g.graphicsPresentation().path
    const backing = [g.canvas.width, g.canvas.height]
    g.destroy()
    return { png, motion, pass, stock, pair, seamDelta, reduced, fixtures, deck, local, blockedSource, rendered: compare(off, lit), occluded: compare(off, shaded), reset: compare(off, restored),
      orb, priority, lightning, path, glError, css: [g.cssW, g.cssH], backing, teardown: g.resourceSnapshot().surfaces }
  }, { expected, save: !!shots })
  const { png, ...report } = result
  for (const [name, bytes] of Object.entries(png)) await writeFile(resolve(shots, `${kind}-${name}.png`), Buffer.from(bytes, 'base64'))
  if (process.env.SR_RAW_REPORT) await writeFile(process.env.SR_RAW_REPORT, JSON.stringify(report, null, 2))
  assert.equal(report.path, expected)
  const m = report.motion
  assert.deepEqual([m.turn, m.stopped, m.cleared, m.backward, m.reverse], [0, 0, 0, 0, 0])
  assert.ok(m.travel >= 450 && m.bossOnscreen > 32 && m.bossOnscreen < m.viewport - 14)
  assert.deepEqual(report.stock.map(s => s.kind), ['Airport express', 'Parcel freight', 'Night service', 'Metro local'])
  assert.ok(report.stock.every(s => s.trains === 1 && s.bodies > 0))
  assert.ok(report.pair?.trains === 2 && report.pair.directions[0] === -report.pair.directions[1], 'opposite-direction stock on both tracks')
  assert.ok(report.seamDelta.bodies.every(n => n > 0) && Math.abs(report.seamDelta.x / report.seamDelta.nativePerWorld - .25) < .001 && report.seamDelta.wake < .001, JSON.stringify(report.seamDelta))
  const quiet = report.reduced
  assert.ok(quiet.activeTrains > 0 && quiet.trains === 0 && quiet.wake === 0 && quiet.flash === 0)
  const lamps = report.fixtures, warm = lamps.torso.find(t => t.r > t.b * 3), cool = lamps.torso.find(t => t.b > t.r * 1.5)
  assert.ok(warm?.strength > .04 && cool?.strength > .04 && warm.dx > .1 && cool.dx < -.1 && lamps.litParts >= 5 && lamps.dynamic === 0, JSON.stringify(lamps))
  assert.ok(lamps.warm.changed > 12 && lamps.cool.changed > 12 && lamps.warm.rgb[0] > lamps.warm.rgb[2] + 24 && lamps.cool.rgb[2] > lamps.cool.rgb[0] + 24, JSON.stringify(lamps))
  assert.ok(lamps.restored.changed <= 2, `fixture restore changed a frozen pose: ${JSON.stringify(lamps.restored)}`)
  assert.ok(report.deck.slabCasts && report.deck.maxBlue > 5 && report.deck.changed >= 8, JSON.stringify(report.deck))
  for (const name of ['player', 'enemy', 'prop', 'road']) {
    const pixels = report.rendered[name]
    assert.ok(pixels.maxR >= 7 && pixels.changed >= 8 && pixels.rgbDelta[0] > pixels.rgbDelta[2], `${name}: ${JSON.stringify(pixels)}`)
    assert.ok(report.reset[name].maxR <= 1)
  }
  assert.ok(report.local.every(taps => new Set(taps).size >= 4), 'independent samples follow a solved rig')
  assert.equal(report.blockedSource, 0)
  assert.ok(report.occluded.enemy.maxR <= 1, JSON.stringify(report.occluded.enemy))
  assert.ok(report.occluded.player.changed >= 8)
  assert.equal(report.orb.color, '#35f2ff'); assert.ok(report.orb.impulse > 0 && report.orb.torso > .07)
  assert.deepEqual(report.priority, { hits: kind === 'hdr' ? 2 : 1, impactFirst: true, orbKept: kind === 'hdr' })
  const bolt = report.lightning
  assert.ok(bolt.first.count >= 1 && bolt.first.match && bolt.restrike.match && bolt.restrike.count >= 1 && bolt.after === 0)
  assert.notDeepEqual(bolt.first.first, bolt.restrike.first)
  assert.equal(report.glError, 0); assert.equal(report.teardown, 0)
  return report
})
