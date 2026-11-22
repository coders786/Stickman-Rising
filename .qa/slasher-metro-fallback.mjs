/** Deny the city cards over HTTP, then deny only the street's optional
 * raster. The actual game should present procedural geometry in both cases. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { withBridge } from './bridge-browser.mjs'

const shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })
const city = ['/bridge/l1.webp', '/bridge/l2.webp', '/bridge/metro-street.webp', '/bridge/deck-pier.webp', '/bridge/props-v2.webp']

await withBridge(async ({ page, open, button, phase }) => {
  const denied = new Set()
  await page.setRequestInterception(true)
  page.on('request', req => {
    const path = new URL(req.url()).pathname
    if (!city.includes(path)) return req.continue()
    denied.add(path); return req.respond({ status: 404 })
  })
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'medium', adaptiveQuality: false, muted: true,
  })))
  await open()
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    // A denied prop atlas must not marshal a single GPU readback to
    // reconstruct the body/label. Restrict the guard to prop warming.
    const warm = g.props.warm.bind(g.props), proto = CanvasRenderingContext2D.prototype
    g.props.warm = () => {
      const read = proto.getImageData
      proto.getImageData = () => { throw Error('Runtime prop atlas readback') }
      try { warm() } finally { proto.getImageData = read }
    }
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  })
  await button('ENGAGE'); await phase('playing')
  const result = await page.evaluate(() => {
    const g = window.__sr, street = g.bg.scenery
    cancelAnimationFrame(g.raf); g.qaMode = true; g.enemies.length = 0; g.fx.clear(); g.hitstopT = 0
    const x = g.route.chunk(1).left + 377
    g.player.reset(x); g.cam.startOnRoad(x)
    g.bg.routeTime = () => 14.2; g.bg.lightningI = () => 0
    const tags = () => g.resourceSnapshot().entries.map(e => e.tag)
    const coverage = () => {
      g.paint(0, false)
      const ctx = g.ctx
      const { width: w, height: h } = ctx.canvas, q = g.project(x, 82)
      const top = Math.round((q.y + 20) * h / g.cssH), rows = Math.min(h - top, 54)
      const data = ctx.getImageData(0, top, w, rows).data, colors = new Set()
      let opaque = 0, lights = 0
      for (let i = 0; i < data.length; i += 4) {
        opaque += +(data[i + 3] === 255)
        lights += +(data[i] > 85 && data[i + 1] > 95)
        colors.add((data[i] >> 2) << 12 | (data[i+1] >> 2) << 6 | (data[i+2] >> 2))
      }
      return { colors: colors.size, samples: data.length / 4, opaque, lights }
    }
    g.props.warm()
    const cached = { pixels: coverage(), stores: tags() }
    street.scope.release('under-city')
    const acquire = street.scope.tryAcquire.bind(street.scope)
    street.scope.tryAcquire = (key, ...args) => key === 'under-city' ? null : acquire(key, ...args)
    const direct = { pixels: coverage(), stores: tags() }
    // Strike the actual denied-atlas prop. A remote cull must retain the
    // same seeded shape and damaged health; a broken prop may not respawn.
    g.props.setRoute(g.route, 240, Infinity)
    const socket = () => g.props.props.find(p => p.id === 1), prop = socket()
    let hull
    g.props.bridgeCasters(0, 300, (x, w, h) => { if (x === prop.x) hull = [w, h] })
    const [width, height] = hull, attack = { heavy: false, aoe: 0 }, max = prop.hp
    const swing = y => g.worldRef.strikeProps({ bx: prop.x - width, tx: prop.x + width, by: y, ty: y }, attack, prop.x)
    swing(-height - 2); const miss = prop.hp
    swing(-height * .62); const hit = prop.hp
    g.props.setRoute(g.route, 6000, Infinity); const culled = !socket()
    g.props.setRoute(g.route, 240, Infinity)
    const restored = { hp: socket().hp, x: socket().x, variant: socket().variant }
    g.player.hp = 65; swing(-height * .62)
    g.props.setRoute(g.route, 6000, Infinity); g.props.setRoute(g.route, 240, Infinity)
    const damage = { kind: prop.kind, x: prop.x, variant: prop.variant, hull, max, miss, hit, culled, restored,
      heal: g.player.hp, gone: !socket() }
    return { cached, direct, damage, path: g.graphicsPresentation().path }
  })
  assert.deepEqual([...denied].sort(), [...city].sort())
  assert.equal(result.path, 'mobile-canvas')
  const d = result.damage
  assert.ok(d.kind === 'med' && d.max === 2 && d.miss === 2 && d.hit === 1 && d.culled && d.heal === 95 && d.gone, JSON.stringify(d))
  assert.deepEqual(d.restored, { hp: 1, x: d.x, variant: d.variant })
  assert.ok(result.cached.stores.includes('route-under-city'))
  assert.equal(result.cached.stores.filter(t => t === 'route-prop-atlas').length, 0)
  assert.ok(!result.direct.stores.includes('route-under-city'))
  for (const r of [result.cached, result.direct]) {
    assert.ok(r.pixels.colors > 12 && r.pixels.opaque === r.pixels.samples && r.pixels.lights > 3, JSON.stringify(r))
    assert.ok(r.stores.includes('bridge-city-aerial-perspective'))
  }
  if (shots) await page.screenshot({ path: resolve(shots, 'canvas-denied-city.png'), captureBeyondViewport: false })
  assert.equal(await page.evaluate(() => { const g = window.__sr; g.destroy(); return g.resourceSnapshot().surfaces }), 0)
  return { ...result, denied: [...denied] }
})
