/** Isolated browser replay of the production Game. No browser dependency in the game bundle.
 * SR_BROWSER_TOOLS=/path/to/npm/tools SR_QA_URL=http://localhost:3000 \
 *   node .qa/slasher-replay.mjs --fixed --route=forward --fixture=crowd --scale=1.25
 * Tools: puppeteer-core, plus @sparticuz/chromium or SR_BROWSER_EXECUTABLE.
 * --master mounts the Ultra WebGL2 presenter; an unavailable HDR FBO fails the receipt.
 * --master-once presents the last fixed frame only (software-GPU stills, never timing).
 * --live-sky waits for shipped sky assets and requires a live Stratum A in the still.
 * --fixed locks the input/sim clock, not rAF sampling. Never report this as presented/device FPS.
 * --stages adds JS scope instrumentation; compare pacing with it off.
 * --shadow-metrics counts scene draw calls in grounding/prop-shadow scopes.
 * --optics-metrics counts fixture/optics blits and glint calls on the authored stages.
 * --shadow-raster isolates one dry crowd frame's shadow paint on a CPU canvas.
 * --shadow-props starts with two fully faded-in prop casters near the player.
 * --fixture=jump takes off just after warmup (use ~14 frames for an apex still).
 * --wet advances only the seeded background to settled drizzle before replay.
 * --at-x=830 frames the streetlight. --trace-state collects simulation state (not for timing).
 * --scene=route runs the continuous bridge. Bridge, Station and the old combined
 * lane are bundle-only controls.
 * --front-tick=... advances the new climate only, for matched phase captures.
 * --quiet and --deny-bank exercise the new environment's presentation fallbacks.
 * --roll=rad pins world roll; --live-waves leaves normal traffic (or the finite wave director) enabled.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const tools = createRequire(resolve(process.env.SR_BROWSER_TOOLS || '.cache/browser-tools', 'package.json'))
const puppeteer = tools('puppeteer-core')
const bundled = process.env.SR_BROWSER_EXECUTABLE ? null : tools('@sparticuz/chromium').default
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const flag = name => process.argv.includes(`--${name}`)
const source = process.env.SR_SOURCE
const config = {
  shadowRaster: flag('shadow-raster'), master: flag('master'), masterOnce: flag('master-once'), liveSky: flag('live-sky'),
  route: arg('route', 'forward'), tier: arg('tier', 'ultra'), fixture: arg('fixture', 'crowd'),
  scale: +arg('scale', '1'), width: +arg('width', '1000'), height: +arg('height', '560'),
  warmup: +arg('warmup', '48'), frames: +arg('frames', '240'),
  fixed: flag('fixed'), stages: flag('stages'), stall: flag('stall-test'), seed: +arg('seed', '42'), wet: flag('wet'),
  sky: arg('sky', 'cache'), emptyTeardown: flag('empty-teardown'),
  scene: arg('scene', source ? 'bridge' : 'route'), atX: arg('at-x', '') === '' ? null : Number(arg('at-x')),
  quiet: flag('quiet'), denyBank: flag('deny-bank'), frontTick: +arg('front-tick', '0'),
  roll: arg('roll', '') === '' ? null : +arg('roll', ''), liveWaves: flag('live-waves'),
  traceState: flag('trace-state'), shadowMetrics: flag('shadow-metrics'), shadowProps: flag('shadow-props'), opticsMetrics: flag('optics-metrics'),
}
assert.ok(!(config.shadowMetrics || config.opticsMetrics) || config.stages, 'draw metrics require --stages')
assert.ok(['forward', 'capture'].includes(config.route))
assert.ok(['idle', 'pan', 'crowd', 'jump', 'gate'].includes(config.fixture))
assert.ok(['cache', 'direct'].includes(config.sky))
assert.ok(['low', 'medium', 'high', 'ultra'].includes(config.tier))
assert.ok(config.scale > 0 && config.scale <= 2.25)
assert.ok([config.width, config.height, config.frames, config.warmup].every(n => Number.isSafeInteger(n) && n > 0))
assert.ok(config.frames <= 20000 && config.warmup <= 20000)
// An explicit fixed scale is a diagnostic crop, not a user preset.
const software = process.env.SR_SOFTWARE === '1'
const combined = config.scene === 'combined'
const continuous = config.scene === 'route'
assert.ok(config.atX === null || (Number.isFinite(config.atX) && config.atX >= 0 && config.atX <= (continuous ? 1e7 : 2560)))
assert.ok(['bridge', 'station', 'combined', 'route'].includes(config.scene))
assert.ok(continuous || source, 'diagnostic art replays need SR_SOURCE')
assert.ok(config.fixture !== 'gate' || continuous && config.atX === null, 'Gate fixture supplies its own continuous-route position')
assert.ok(!config.master || continuous && config.tier === 'ultra' && config.route === 'forward', 'Master is the Ultra forward route')
assert.ok(!config.wet || config.scene === 'bridge', '--wet is the legacy Bridge fixture')
assert.ok(!combined || !source || existsSync(resolve(source, 'game/stage/run-layout.ts')), 'combined mode requires the run composer')
assert.ok(Number.isSafeInteger(config.seed) && config.seed >= 0 && config.seed < 0xffffffff)
assert.ok(Number.isSafeInteger(config.frontTick) && config.frontTick >= 0 && config.frontTick <= 216000)
assert.ok(config.roll === null || (Number.isFinite(config.roll) && Math.abs(config.roll) <= .16))
assert.ok(combined || continuous || (!config.frontTick && !config.denyBank), 'front-specific flags need --scene=route or combined')
assert.ok(!config.denyBank || source, '--deny-bank uses the bundled ledger')
const pixelPath = arg('pixels', ''), statePath = arg('state-out', '')
assert.ok(!statePath || config.traceState, '--state-out requires --trace-state')
assert.ok(!config.masterOnce || config.master && config.fixed && pixelPath, '--master-once is for a fixed presented capture')
assert.ok(!config.liveSky || config.master && !source && pixelPath, '--live-sky requires a packaged Master capture')
assert.ok(!config.shadowRaster || (config.scene === 'station' && config.fixture === 'crowd' && config.fixed && !config.stages && !pixelPath),
  '--shadow-raster needs a fixed dry Station crowd replay, without --stages or --pixels')
const browser = await puppeteer.launch({
  executablePath: process.env.SR_BROWSER_EXECUTABLE || await bundled.executablePath(),
  args: [...(bundled?.args ?? []), ...(software ? ['--disable-gpu'] : [])],
  protocolTimeout: 120000,
})
try {
  let sourceDigest = null
  const p = await browser.newPage()
  const errors = []
  p.on('pageerror', e => errors.push(String(e)))
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()) })
  await p.setViewport({ width: config.width, height: config.height, deviceScaleFactor: 1 })
  if (source) {
    const entry = ['game/game.ts', 'game/render/ledger.ts'].map(file => JSON.stringify(resolve(source, file)))
    const controlArt = config.scene === 'station' ? 'STATION_ART' :
      (config.scene === 'bridge' || combined && existsSync(resolve(source, 'game/stage/route.ts'))) && existsSync(resolve(source, 'game/stage/run-layout.ts')) ? 'BRIDGE_ART' : null
    const art = controlArt ? `export { ${controlArt} as diagnosticArt } from ${JSON.stringify(resolve(source, 'game/world/art-grade.ts'))};` : ''
    const result = await build({
      stdin: { contents: `export { Game } from ${entry[0]}; export { gameLedger } from ${entry[1]}; ${art}`, resolveDir: process.cwd() },
      bundle: true, platform: 'browser', format: 'iife', globalName: 'replayBundle', write: false,
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    sourceDigest = createHash('sha256').update(result.outputFiles[0].text).digest('hex')
    await p.setContent('<!doctype html><html lang="en"><meta charset="UTF-8"><title>Slasher QA</title><body></body></html>')
    await p.addScriptTag({ content: result.outputFiles[0].text })
  } else {
    await p.goto(process.env.SR_QA_URL || 'http://localhost:3000/', { waitUntil: 'domcontentloaded' })
    await p.waitForFunction(() => window.__sr?.ctx, { timeout: 45000 })
  }
  const data = await p.evaluate(async cfg => {
    const original = window.__sr
    const bundle = window.replayBundle
    const Game = bundle?.Game || original.constructor
    original?.destroy()
    // Use fresh state (including storm and input history). Only the QA tab is
    // modified. Neither the random seed nor input clock leaks into the app.
    let randomState = 0x4e91d14
    const seeded = (job, first) => {
      const realRandom = Math.random
      Math.random = () => {
        if (first !== undefined) { const r = first; first = undefined; return r }
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
        return randomState / 4294967296
      }
      try { return job() } finally { Math.random = realRandom }
    }
    const g = seeded(() => new Game(bundle?.diagnosticArt, cfg.scene === 'combined' ? 'combined-run' : undefined))
    if (cfg.denyBank) {
      const admit = bundle.gameLedger.tryAcquire.bind(bundle.gameLedger)
      bundle.gameLedger.tryAcquire = (slot, w, h, tag, streaming) => tag === 'environment-optional-bank' ? null : admit(slot, w, h, tag, streaming)
    }
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'hidden' })
    const scene = document.createElement('canvas'), hud = document.createElement('canvas')
    const gpu = cfg.master ? document.createElement('canvas') : null
    const layers = gpu ? [scene, gpu, hud] : [scene, hud]
    for (const c of layers) Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
    host.append(...layers)
    document.body.append(host)
    if (cfg.master) g.allowDiagnosticMaster?.()
    g.mount(scene, hud, gpu)
    cancelAnimationFrame(g.raf)
    g.autoQuality = false
    g.qaMode = !cfg.liveWaves
    g.applySettings({ ...g.settings, quality: cfg.tier, adaptiveQuality: false, showFps: false, muted: true })
    g.renderer.setDesktopLighting(cfg.route === 'forward')
    if (g.setDiagnosticRenderScale) g.setDiagnosticRenderScale(cfg.scale)
    else { g.dprTarget = cfg.scale; g.resize() } // frozen pre-remediation sources
    if (cfg.roll !== null) {
      const update = g.updateCamera.bind(g)
      g.updateCamera = dt => { update(dt); g.cam.rot = cfg.roll }
    }
    // No real user gesture in this fixture. Skip audio synthesis so its random
    // draws can't change the selected seed or the repeatable encounter.
    g.audio.resume = () => {}
    g.audio.startMusic = () => {}
    const startup = []
    if (cfg.stages) {
      for (const name of ['setRunSeed', 'bakeScene', 'bakeSoftBand', 'buildNear', 'bakeRoadLighting', 'warm']) {
        const fn = g.bg[name]
        if (!fn) continue
        g.bg[name] = function (...args) {
          const t0 = performance.now()
          try { return fn.apply(this, args) } finally {
            startup.push({ name, ms: performance.now() - t0 })
          }
        }
      }
    }
    if (cfg.quiet) g.bg.setReducedMotion(true)
    const started = performance.now()
    seeded(() => g.startRun('katana'), (cfg.seed + .5) / 0xffffffff)
    const startMs = performance.now() - started
    if (cfg.frontTick) g.bg.advanceActiveTicks(cfg.frontTick, 1)
    if (cfg.atX !== null) {
      g.player.reset(cfg.atX)
      g.cam.startOnRoad(cfg.atX)
    }
    if (cfg.fixture === 'gate') {
      const gate = g.encounters.gate
      const x = gate.x - 232
      g.player.reset(x); g.cam.startOnRoad(x)
      g.encounters.gate.state = 'locked'
      seeded(() => g.debugSpawn('boss', gate.x - 92))
      const e = g.enemies.at(-1)
      e.arriveOnRoute(-1); e.state = 'windup'; e.stateT = 0; e.gate = gate.index
    }
    if (cfg.shadowProps) {
      // Same manufactured casters on every tier, outside the normal dash path.
      // The real PropField still owns casting, damage and culling.
      for (const [i, kind, dx] of [[0, 'med', -275], [1, 'steam', 337]]) {
        g.props.props.push({ id: -1 - i, kind, x: g.player.x + dx, hp: 2,
          dead: false, respawn: 0, hitAt: -10, born: -1 })
      }
    }
    if (cfg.scene === 'station' && (g.bg.hasWetSurface() || g.storm.rainScale > 0 || g.bg.plateStats())) {
      throw new Error('Station started with a wet or outdoor bake')
    }
    if (cfg.wet) {
      for (let i = 0; i < 2400; i++) {
        const wx = g.bg.weatherState()
        if (wx?.kind === 'drizzle' && wx.s === 1) break
        g.bg.update(.1)
      }
      const wx = g.bg.weatherState()
      if (wx?.kind !== 'drizzle' || wx.s !== 1 || g.storm.rainScale <= .1) {
        throw new Error(`No settled rain in wet fixture: ${JSON.stringify(wx)}`)
      }
    }
    const layout = () => [g.cssW, g.cssH, scene.width, scene.height, hud.width, hud.height,
      g.settings.quality, g.renderer.forward ? 'forward' : 'capture']
    const locked = layout()
    const expected = [cfg.width, cfg.height, Math.floor(cfg.width * cfg.scale), Math.floor(cfg.height * cfg.scale),
      cfg.width, cfg.height, cfg.tier, cfg.route]
    if (locked.some((value, i) => value !== expected[i])) {
      throw new Error(`Replay layout mismatch: got ${locked.join(' ')}; expected ${expected.join(' ')}`)
    }
    const run = g.bg.runLayout?.()
    if (cfg.scene === 'combined' && !run) throw new Error('not the procedural bridge')
    const receipt = () => ({ layout: layout(), seed: g.bg.getProfile()?.seed, weather: structuredClone(g.bg.weatherState()),
      bakes: g.bg.plateStats?.() ?? null, particleLevel: g.buildHudState().particleLevel, gore: g.settings.gore,
      ...(run && { composition: { version: run.version, shelters: run.shelters.map(({ kind, left, right }) => ({ kind, left, right })) } }),
      ...(g.route && { sector: g.buildHudState().route?.sector, cache: g.bg.routeCache() }),
      ...(g.bg.weatherWork && { skyBackend: g.bg.skyBackend?.(), weatherWork: { ...g.bg.weatherWork() } }) })
    const initial = receipt()
    if (initial.seed !== cfg.seed) throw new Error(`Unexpected seed: ${initial.seed}`)
    let directSkies = 0
    if (cfg.sky === 'direct') {
      g.bg.skyVault.draw = (ctx, _w, _h, _x, _y, _z, _t, _storm, _bolt, _quality, render) => {
        directSkies++
        render(ctx)
      }
    }
    // Diagnostic, not pacing: save the actual issued shadow calls from the last
    // dry-stage crowd frame. Repaint only those calls in a shallow CPU canvas.
    const frozen = cfg.shadowRaster ? [] : null
    if (frozen) {
      for (const [owner, name] of [[g.renderer, 'shade'], [g.props, 'drawShadows']]) {
        const method = owner[name]
        owner[name] = function (ctx, ...args) {
          if (frameIndex === cfg.warmup + cfg.frames) {
            const inputs = args.slice()
            if (name === 'shade') {
              const a = inputs[1]
              inputs[1] = { x: a.x, y: a.y, hipY: a.hipY, scale: a.scale, face: a.face, geom: structuredClone(a.geom) }
            }
            frozen.push([method, this, inputs])
          }
          return method.call(this, ctx, ...args)
        }
      }
    }
    const phases = Object.create(null)
    let measure = false, sceneSamples = 0
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    const scope = (owner, name, label = name) => {
      if (!owner?.[name]) return
      const method = owner[name]
      if (cfg.stages) {
        const row = phases[label] = { calls: 0, submitMs: 0 }
        owner[name] = function (...args) {
          if (!measure) return method.apply(this, args)
          const then = performance.now()
          try { return method.apply(this, args) } finally {
            row.calls++
            row.submitMs += performance.now() - then
          }
        }
      }
    }
    for (const [name, label] of [['drawSky', 'sky'], ['drawArena', 'deck'], ['drawReflections', 'mirror (includes forward glints)'], ['drawWeather', 'weather']]) scope(g.bg, name, label)
    scope(g.renderer, 'shade', 'actor grounding')
    scope(g.props, 'drawShadows', 'prop shadows')
    const shadowDraws = cfg.shadowMetrics ? {} : null
    const NativePath = window.Path2D
    if (shadowDraws) {
      let active = null
      const actorCounts = () => ({ calls: 0, contact: 0, key: 0, practical: 0, graded: 0, outlines: 0, inPractical: 0 })
      const actors = shadowDraws.actors = { hero: actorCounts(), enemies: actorCounts() }
      const props = shadowDraws.props = { calls: 0, blits: 0 }
      for (const [owner, name] of [[g.renderer, 'shade'], [g.props, 'drawShadows']]) {
        const fn = owner[name]
        owner[name] = function (...args) {
          if (!measure) return fn.apply(this, args)
          const row = active = name === 'shade' ? (args[2] === g.player ? actors.hero : actors.enemies) : props
          row.calls++
          try { return fn.apply(this, args) } finally {
            if (name === 'shade' && (g.renderer.probes.get(args[2])?.castW ?? 0) > .04) row.inPractical++
            active = null
          }
        }
      }
      window.Path2D = class extends NativePath {
        constructor(...args) { super(...args); if (active && active !== props) active.outlines++ }
      }
      for (const name of ['fill', 'fillRect', 'drawImage']) {
        g.ctx[name] = function (...args) {
          if (active === props && name === 'drawImage') props.blits++
          if (active && active !== props) {
            if (name === 'fillRect' || (name === 'fill' && args.length === 0)) active.contact++
            else if (name === 'fill') {
              // Authored stages don't fill mirror paths on the scene. The old
              // key/practical used solid separate inks; the new cast is graded.
              const kind = typeof this.fillStyle !== 'string' ? 'graded' : this.fillStyle === '#03060a' ? 'key' : 'practical'
              active[kind]++
            }
          }
          return CanvasRenderingContext2D.prototype[name].apply(this, args)
        }
      }
    }
    const optics = cfg.opticsMetrics ? {
      bodies: 0, scatter: 0, shafts: 0, pool: 0, airborneWash: 0, vignette: 0,
      actorStrip: 0, propStrip: 0, moonGlitter: 0, wetGlints: 0,
    } : null
    let countOptics = () => {}
    if (optics) {
      const bg = g.bg
      const fixtures = new Set([...bg.fixtures, ...Object.values(bg.shelters ?? {})].map(s => s.sprite))
      // Direct start (unlike the real preparation UI) warms props lazily.
      g.props.warm()
      const props = new Set(Object.values(g.props.sprites))
      // Same identities for the entire run; older trees still have separate
      // layers. Offscreen bake draws do not count as scene blits.
      const layers = new Map([
        [bg.lampHalo, 'scatter'], [bg.signHalo, 'scatter'], [bg.shaftWarm, 'shafts'], [bg.shaftCool, 'shafts'],
        [bg.deckAtlas, 'pool'], [bg.hazeSpr, 'airborneWash'], [bg.cityGlow, 'airborneWash'],
      ].filter(([canvas]) => canvas))
      countOptics = (source, args) => {
        if (fixtures.has(source)) optics.bodies++
        const label = layers.get(source)
        if (label) optics[label]++
        if (source === bg.vignette) optics.vignette++
        if (source === bg.waterRelay?.strip) optics.actorStrip++
        if (props.has(source) && args.length === 8 && args[1] > 0) optics.propStrip++
      }
      for (const [owner, name, count] of [[bg.street, 'drawWetGlints', 'wetGlints'], [bg.night, 'drawGlitter', 'moonGlitter']]) {
        if (!owner?.[name]) continue
        const method = owner[name]
        owner[name] = function (...args) {
          if (measure) optics[count]++
          return method.apply(this, args)
        }
      }
    }
    scope(g.bg.waterRelay, 'present', 'live water strip')
    scope(g.renderer.post, 'captureSquared', 'post sample')
    scope(g.fx, 'drawSilhouettes', 'dash echoes')
    scope(g.fx, 'drawAdditive', 'additive FX')
    scope(g.hud, 'draw', 'HUD')
    scope(g.storm, 'update', 'storm update')
    scope(g.bg, 'advanceActiveTicks', 'environment tick')
    scope(g, 'step', 'sim step')
    const events = [], trajectory = cfg.traceState ? [] : null
    const onEvent = g.on(event => events.push([tick, event]))
    const step = g.step.bind(g)
    let tick = 0, maxBodies = 0, attacks = 0, echoFrames = 0, cameraMinX = Infinity, cameraMaxX = -Infinity
    if (cfg.fixed) Object.defineProperty(g.input, 'now', { get: () => tick / 60 })
    function encounter() {
      for (const [i, offset] of [-370, -243, -161, -87, 80, 147, 240, 340, 408, 488].entries()) {
        const x = Math.max(0, Math.min(g.route ? Infinity : 2560, g.player.x + offset))
        g.debugSpawn(i % 3 === 0 ? 'heavy' : i % 3 === 1 ? 'grunt' : 'assassin', x)
        if (g.route) g.enemies.at(-1).arriveOnRoute(x > g.player.x ? -1 : 1)
      }
    }
    g.step = dt => {
      ++tick
      const { player, input } = g
      if (cfg.fixture === 'pan') {
        if (tick === 1) input.setVirtualAxis(1, 0)
        if (tick % 136 === 0) input.setVirtualAxis(tick % 272 === 0 ? 1 : -1, 0)
      } else if (cfg.fixture === 'jump') {
        if (tick === cfg.warmup + 1) input.setVirtual('jump', true)
        if (tick === cfg.warmup + 4) input.setVirtual('jump', false)
      } else if (cfg.fixture === 'crowd') {
        if (tick === cfg.warmup + 1 || (tick % 160 === 0 && g.enemies.length < 5 && !player.isDead)) encounter()
        const beat = (tick - 1) % 132
        if (beat === 15 && !player.swordDrawn) input.setVirtual('sheathe', true)
        if (beat === 16) input.setVirtual('sheathe', false)
        if (beat === 21 || beat === 111) input.setVirtual('light', true)
        if (beat === 22 || beat === 112) input.setVirtual('light', false)
        if (beat === 44) input.setVirtual('parry', true)
        if (beat === 46) input.setVirtual('parry', false)
        if (beat === 65) { input.setVirtualAxis(tick % 264 < 132 ? 1 : -1, 0); input.setVirtual('dash', true) }
        if (beat === 68) input.setVirtual('dash', false)
        if (beat === 75) input.setVirtualAxis(0, 0)
        if (beat === 88) input.setVirtual('heavy', true)
        if (beat === 96) input.setVirtual('heavy', false)
      }
      const hp = player.hp, score = g.stats.score, hits = g.combo.hits, kills = g.stats.kills
      step(dt)
      if (hp !== player.hp || score !== g.stats.score || hits !== g.combo.hits || kills !== g.stats.kills) {
        events.push([tick, player.hp, g.stats.score, g.combo.hits, g.stats.kills])
      }
      maxBodies = Math.max(maxBodies, g.enemies.length)
      if (trajectory) trajectory.push([
        tick, g.time, g.timeScale, g.hitstopT,
        player.x, player.y, player.vx, player.vy, player.state, player.stateT, player.face, player.hp, player.meter,
        g.stats.score, g.stats.kills, g.combo.hits, g.combo.timer,
        g.enemies.map(e => [e.kind, e.x, e.y, e.vx, e.vy, e.state, e.stateT, e.hp, e.dead, e.spawning]),
        g.props.props.map(p => [p.kind, p.x, p.hp, p.dead]),
        ...(cfg.liveWaves ? [[...(g.encounters ? [g.encounters.patrol, { ...g.encounters.gate }] :
          [g.waves.wave, g.waves.queue.map(q => [q.kind, q.x, q.at, q.waveScale])]),
          g.projectiles.list.map(p => [p.kind, p.x, p.y, p.vx, p.vy, p.friendly])]] : []),
      ])
    }
    // Pre-sized sample arrays. Visible long intervals are part of the record;
    // an actual visibility event invalidates this run instead of hiding a hitch.
    const intervals = new Float64Array(cfg.frames), submit = new Float64Array(cfg.frames)
    let gaps = 0, count = 0, last = 0, frameIndex = 0
    const onVisibility = () => { if (document.hidden) gaps++ }
    document.addEventListener('visibilitychange', onVisibility)
    // Pin the absolute epoch too: residual binary float error from a new
    // performance.now() origin can otherwise change a raw hitstop digest.
    const epoch = cfg.fixed ? 60_000 : performance.now()
    g.lastFrame = epoch
    const fieldPeak = { emitters: 0, impulses: 0, cover: 0, quads: 0, overflow: false }
    let report, gpuPixels
    if (cfg.liveSky) {
      // Start fetch and image decode without advancing the fixed run clock.
      const basis = fetch('/bridge/baked-v1/sky.bin.br').then(r => {
        if (!r.ok) throw new Error(`Sky basis ${r.status}`)
        return r.arrayBuffer()
      })
      await Promise.all([basis, ...['l1', 'l2'].map(name => {
        const image = new Image()
        image.src = `/bridge/${name}.webp`
        return image.decode()
      })])
      // Paint with the presenter denied; start the game's own loader and wait
      // for its parsed basis without advancing any gameplay or GL cadence.
      const finish = g.renderer.bridgeFinish, prepare = finish.prepare
      finish.prepare = () => null
      try {
        for (let i = 0; i < 60; i++) {
          g.paint(0, false)
          if (g.renderer.bridgeField?.atmo?.basis) break
          await new Promise(done => requestAnimationFrame(done))
        }
      } finally { finish.prepare = prepare }
      if (!g.renderer.bridgeField?.atmo?.basis) throw new Error('Game sky basis did not load')
    }
    if (cfg.masterOnce) {
      const finish = g.renderer.bridgeFinish, prepare = finish.prepare.bind(finish)
      finish.prepare = (requested, ...args) => prepare(frameIndex === cfg.warmup + cfg.frames ? requested : null, ...args)
    }
    try {
      if (cfg.stages) CanvasRenderingContext2D.prototype.drawImage = function (source, ...geometry) {
        if (measure) {
          if (source === scene) sceneSamples++
          if (cfg.opticsMetrics && this === g.ctx) countOptics(source, geometry)
        }
        return drawImage.call(this, source, ...geometry)
      }
      await new Promise((done, fail) => {
        function frame(timestamp) {
          try {
            ++frameIndex
            const elapsed = last ? timestamp - last : 0
            last = timestamp
            measure = frameIndex > cfg.warmup && elapsed > 0
            if (measure && cfg.stall && count === 8) {
              const until = performance.now() + 275
              while (performance.now() < until) { /* deliberate foreground stall */ }
            }
            const then = performance.now()
            seeded(() => g.frame(cfg.fixed ? epoch + frameIndex * (1000 / 60) : timestamp))
            const ms = performance.now() - then
            if (cfg.stages && g.renderer.bridgeField) {
              const f = g.renderer.bridgeField
              fieldPeak.emitters = Math.max(fieldPeak.emitters, f.count)
              fieldPeak.impulses = Math.max(fieldPeak.impulses, f.impulseCount)
              fieldPeak.cover = Math.max(fieldPeak.cover, f.roofs)
              fieldPeak.quads = Math.max(fieldPeak.quads, f.vertexCount / 6)
              fieldPeak.overflow ||= f.overflow
            }
            if (cfg.fixture === 'crowd' && g.player.state === 'attack') attacks++
            if (g.fx.afterimages.length) echoFrames++
            cameraMinX = Math.min(cameraMinX, g.cam.x)
            cameraMaxX = Math.max(cameraMaxX, g.cam.x)
            if (measure) { intervals[count] = elapsed; submit[count] = ms; ++count }
            if (count >= cfg.frames) {
              if (cfg.pixels && gpu && !gpu.hidden) gpuPixels = gpu.toDataURL()
              done()
            }
            else requestAnimationFrame(frame)
          } catch (err) { fail(err) }
        }
        requestAnimationFrame(frame)
      })
      if (cfg.master && cfg.pixels && !gpuPixels) throw new Error('Presented pixels missing: ' + JSON.stringify(g.resourceSnapshot?.().presentation))
      const shown = g.resourceSnapshot?.().presentation
      if (cfg.master && shown?.path !== 'master-webgl2') throw new Error('Master did not activate: ' + JSON.stringify(shown))
      if (cfg.liveSky && !shown?.gpu?.stratumA?.live) throw new Error('Still is missing live Stratum A: ' + JSON.stringify(shown))
      if (gaps) throw new Error(`Page hidden ${gaps} times during an A/B sample`)
      if (layout().some((v, i) => v !== locked[i])) throw new Error('Tier, optics route or backing size changed')
      if (cfg.fixture === 'crowd' && cfg.fixed && cfg.frames > 48 && maxBodies < 8) throw new Error('Crowd replay did not spawn threats')
      const stats = values => {
        const sorted = values.slice().sort()
        const percentile = q => sorted[Math.ceil(sorted.length * q) - 1]
        return { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) }
      }
      const ledger = g.resourceSnapshot?.()
      report = { initial, final: receipt(), startMs, bakeMs: g.bakeMs, clock: cfg.fixed ? 'fixed sim replay' : 'real-time sim',
        samples: count, rafMs: stats(intervals), submitMs: stats(submit), visibleStalls250ms: intervals.filter(ms => ms > 250).length,
        startup, phases, sceneSamples: cfg.stages ? sceneSamples : null, shadowDraws, optics, events, trajectory, tick, maxBodies, attackFrames: attacks, echoFrames,
        finalEchoSlots: g.fx.afterimages.length, panWorldPx: cameraMaxX - cameraMinX,
        view: { x: g.cam.x + g.cam.offX, y: g.cam.y + g.cam.offY, zoom: g.cam.zoom, rot: g.cam.rot },
        outputRgbaBytes: (scene.width * scene.height + hud.width * hud.height) * 4,
        player: { hp: g.player.hp, x: g.player.x, y: g.player.y, state: g.player.state },
        score: g.stats.score, simTime: g.time, droppedSimSeconds: g.overloadDropped,
        ledger: bundle?.gameLedger.stats() ?? ledger, presentation: ledger?.presentation, fieldPeak: cfg.stages ? fieldPeak : undefined,
        surfaceShape: (bundle?.gameLedger.list() ?? ledger?.entries)?.map(({ tag, w, h }) => `${tag}:${w}x${h}`).sort(),
        sky: { hits: g.bg.skyVault?.hits, rebuilds: g.bg.skyVault?.rebuilds, direct: directSkies,
          backing: g.bg.skyVault?.plate ? [g.bg.skyVault.plate.width, g.bg.skyVault.plate.height] : null },
        visibleEnemies: [g.renderer.cullDrawn, g.renderer.cullSkipped],
      }
      if (frozen) {
        if (frozen.length < 6) throw new Error('Insufficient frozen cast work')
        const crop = document.createElement('canvas')
        crop.width = scene.width; crop.height = Math.ceil(64 * cfg.scale)
        const pen = crop.getContext('2d', { alpha: false, willReadFrequently: true })
        const scale = cfg.scale * g.cam.zoom
        const repaint = () => {
          pen.setTransform(1, 0, 0, 1, 0, 0)
          pen.fillStyle = '#394752'
          pen.fillRect(0, 0, crop.width, crop.height)
          pen.setTransform(scale, 0, 0, scale, crop.width * .5 - (g.cam.x + g.cam.offX) * scale, 8 * cfg.scale)
          for (const [fn, owner, args] of frozen) fn.call(owner, pen, ...args)
          pen.getImageData(crop.width >> 1, crop.height >> 2, 1, 1)
        }
        const batch = 24, laps = new Float64Array(36)
        for (let i = -5; i < laps.length; i++) {
          const t = performance.now()
          for (let j = 0; j < batch; j++) repaint()
          if (i >= 0) laps[i] = (performance.now() - t) / batch
        }
        report.shadowRaster = { backdrop: [crop.width, crop.height], frozenCalls: frozen.length,
          batch, laps: laps.length, elapsedMsPerDraw: stats(laps) }
        crop.width = crop.height = 0
      }
      // Pixel capture is an opt-in run, after the measurement window ends.
      if (cfg.pixels) {
        const strip = g.bg.waterRelay?.strip
        report.pixels = [gpuPixels ?? scene.toDataURL(), hud.toDataURL()]
        if (strip?.width && strip.height) report.relayPixels = strip.toDataURL()
      }
      return report
    } finally {
      if (cfg.shadowMetrics) window.Path2D = NativePath
      if (cfg.stages) CanvasRenderingContext2D.prototype.drawImage = drawImage
      document.removeEventListener('visibilitychange', onVisibility)
      onEvent()
      g.destroy()
      host.remove()
      if (report) {
        report.retainedAfterDestroy = bundle?.gameLedger.list() ?? g.resourceSnapshot?.().entries
        report.releasedPresentation = g.resourceSnapshot?.().presentation ?? null
      }
    }
  }, { ...config, pixels: Boolean(pixelPath) })
  assert.deepEqual(errors, [], 'browser/game errors')
  if (config.stall) assert.ok(data.visibleStalls250ms, 'foreground stall was hidden from the timing report')
  if (config.emptyTeardown) assert.deepEqual(data.retainedAfterDestroy, [], 'game destroy retained tracked stores or snapshot is unavailable')
  if (pixelPath) {
    await mkdir(dirname(pixelPath), { recursive: true })
    data.pixelHashes = {}
    if (data.relayPixels) {
      data.pixelHashes.relay = createHash('sha256').update(Buffer.from(data.relayPixels.split(',')[1], 'base64')).digest('hex')
      delete data.relayPixels
    }
    for (const [i, label] of ['scene', 'hud'].entries()) {
      const png = Buffer.from(data.pixels[i].split(',')[1], 'base64')
      data.pixelHashes[label] = createHash('sha256').update(png).digest('hex')
      await writeFile(`${pixelPath}-${label}.png`, png)
    }
    delete data.pixels
  }
  const eventDigest = createHash('sha256').update(JSON.stringify(data.events)).digest('hex')
  const stateDigest = data.trajectory ? createHash('sha256').update(JSON.stringify(data.trajectory)).digest('hex') : null
  if (statePath) {
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, data.trajectory.map(row => JSON.stringify(row)).join('\n') + '\n')
  }
  delete data.trajectory
  console.log(JSON.stringify({ browser: await browser.version(), source: source || 'live app', sourceDigest, softwareRequested: software,
    config, captureOnly: Boolean(pixelPath), eventDigest, stateDigest, ...data }, null, 2))
} finally {
  await browser.close()
}
