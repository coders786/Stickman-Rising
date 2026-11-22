/** Production title, Field Nodachi and 91 m checks. Launch with SR_SOFTWARE=1
 * for the Canvas plate publication probe. --control collects the Ultra stills
 * without imposing the new title/plate invariants on them. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { touch, viewport, withBridge } from './bridge-browser.mjs'

const control = process.argv.includes('--control'), shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })
await withBridge(async ({ page, open, button, phase, wait, frames }) => {
  if (!touch) await page.setViewport({ ...viewport, width: 1106, height: 722 })
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'medium', adaptiveQuality: false, muted: true }))
    localStorage.setItem('sr_save_v1', JSON.stringify({ totalKills: 195, best: 0, unlocked: ['katana', 'nodachi'] }))
    window.bridgeImagePaths = new Set()
    new PerformanceObserver(list => list.getEntries().forEach(e => window.bridgeImagePaths.add(new URL(e.name).pathname)))
      .observe({ type: 'resource', buffered: true })
  })
  await open()
  await wait(control => window.__sr.bg.built && (control || window.__sr.attractAssets === 7), control)
  await frames()
  if (shots) await page.screenshot({ path: resolve(shots, 'title.png'), captureBeyondViewport: false })
  const title = await page.evaluate(() => {
    const g = window.__sr, w = g.canvas.width, h = g.canvas.height, start = Math.round(h * .60)
    const horizon = g.bg.canvasAtmosphere.skyHeight * h / g.cssH
    const pixels = g.ctx.getImageData(0, start, w, h - start).data
    let prev = null, jump = 0, jumpY = 0, horizonJump = 0, horizonRows = 0, row = 0, opaque = 0
    for (let y = 0; y < h - start; y++) {
      let sum = 0
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        sum += (pixels[i] + pixels[i+1] + pixels[i+2]) / 3; opaque += +(pixels[i+3] === 255)
      }
      row = sum / w
      if (prev !== null) {
        const delta = Math.abs(row - prev)
        if (delta > jump) { jump = delta; jumpY = start + y }
        if (Math.abs(start + y - horizon) < 4) { horizonJump = Math.max(horizonJump, delta); horizonRows++ }
      }
      prev = row
    }
    const request = g.requestRun.bind(g)
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
    return { horizon, horizonJump: horizonRows ? horizonJump : null, horizonRows, maxRowJump: jump, maxRowJumpY: jumpY,
      bottom: row, opaque: opaque / (w * (h - start)), worldWorker: g.bg.bridgeStream().running }
  })
  await button('ENGAGE'); await phase('playing')
  const { png, ...report } = await page.evaluate(async ({ save, control }) => {
    const g = window.__sr, { player: p, cam } = g, a = g.renderer.bridgeField, stream = g.bg.bridgeStream()
    cancelAnimationFrame(g.raf); g.qaMode = true; g.enemies.length = 0; g.fx.clear(); g.banner = null
    g.bg.routeTime = () => 30; g.bg.routeDrift = () => 16; g.bg.lightningI = () => 0
    Object.assign(g.bg.routeWeather.clock.sample, { fog: .28, cloud: .18, key: 1, wet: .9, rain: .27 })
    const png = {}, shot = name => { if (save) png[name] = g.canvas.toDataURL('image/png').split(',')[1] }
    const draw = () => { g.paint(0, false); if (g.graphicsPresentation().path !== 'mobile-canvas') throw Error('Expected Canvas fallback') }
    const waitFor = async test => {
      const start = performance.now()
      do {
        draw()
        if (test()) return
        if (performance.now() - start > 24_000) throw Error('Visible plate timeout')
        await new Promise(r => setTimeout(r, 15))
      } while (true)
    }
    p.reset(1150); cam.startOnRoad(p.x)
    await waitFor(() => stream.plate(0, true) && stream.plate(1, true))
    const seam = () => {
      const { width, height } = g.canvas, b = g.project(1152, 18)
      const x = Math.round(b.x * width / g.cssW), y = Math.round(b.y * height / g.cssH)
      const data = g.ctx.getImageData(x - 5, y, 10, 12).data
      let left = 0, right = 0
      for (let j = 0; j < 12; j++) for (let i = 0; i < 10; i++) {
        const k = (j * 10 + i) * 4, n = (data[k] + data[k + 1] + data[k + 2]) / (3 * 60)
        if (i < 5) left += n; else right += n
      }
      return { left, right, delta: Math.abs(left - right) }
    }
    const committed = seam(); shot('field-nodachi-91m')
    const realPlate = stream.plate.bind(stream)
    stream.plate = (index, lit) => index === 1 && lit ? null : realPlate(index, lit)
    draw(); const neighborMissing = seam()
    stream.plate = realPlate
    const head = () => g.project(p.x + p.face * p.scale * p.geom.headC.x, p.hipY + p.scale * (p.geom.headC.y - 9))
    const poses = []
    for (let jump = 0; jump < 2; jump++) {
      p.doJump(g.worldRef)
      for (let i = 0; i < 24; i++) { g.time += 1 / 120; p.update(1 / 120, g.worldRef); g.updateCamera(1 / 120) }
      draw()
      poses.push({ head: head(), sole: g.project(p.x, p.y), position: [p.x, p.y, p.floorY], rail: { ...g.bg.scenery.rail.last } })
      shot(jump ? 'field-nodachi-high-leap' : 'field-nodachi-leap')
    }
    const sword = [p.sword.id, p.sword.name]
    const variants = []
    if (!control) for (let seed = 40; seed <= 43; seed++) {
      g.resetRoute(seed); g.bg.setRunSeed(seed)
      p.reset(1700); cam.startOnRoad(1700)
      Object.assign(g.bg.routeWeather.clock.sample, { fog: .25, cloud: .0, key: 1, wet: .72, rain: 0 })
      draw(); const r = a.atmo.receipt()
      variants.push({ seed, ...r }); shot(r.moonVariant.split(' ')[0].toLowerCase())
    }
    const assets = [...window.bridgeImagePaths].filter(p => p.startsWith('/bridge/'))
    const ownsProps = g.resourceSnapshot().entries.filter(e => e.tag === 'route-prop-atlas').length
    return { css: [g.cssW, g.cssH], committed, neighborMissing, poses, sword, variants, ownsProps, assets, png }
  }, { save: !!shots, control })
  const end = await page.evaluate(() => { const g = window.__sr; g.destroy(); return g.resourceSnapshot().surfaces })
  assert.equal(end, 0)
  assert.deepEqual(report.sword, ['nodachi', 'FIELD NODACHI'])
  assert.ok(report.poses.every(p => p.position[2] === 0 && p.position[1] < -90))
  if (!control) {
    // Skyline silhouettes can contribute a small row-to-row change above
    // the horizon. Check the actual sky/floor join more tightly, and still
    // catch a full-width band anywhere in the lower frame (old jump ~32).
    assert.ok(title.opaque === 1 && title.horizonRows > 0 && title.horizonJump < 2.5 && title.maxRowJump < 4 &&
      title.bottom > 0 && title.bottom < 18 && title.worldWorker === false, JSON.stringify(title))
    assert.ok(report.neighborMissing.delta < 6 && report.committed.delta < 6, JSON.stringify(report))
    assert.ok(report.poses.every(p => p.rail.bearings > 0 && p.rail.footingY > p.rail.railY + 100 && p.head.y >= (touch ? 158 : 125) && p.sole.y < report.css[1] - 44))
    assert.deepEqual(report.variants.map(v => v.moonVariant), ['Porcelain full', 'Copper half', 'Silver gibbous', 'Ash crescent'])
    assert.equal(report.ownsProps, 0)
    assert.ok(report.assets.includes('/bridge/props-v2.webp') && report.assets.includes('/bridge/baked-v1/sky.bin.br'))
  }
  if (shots) for (const [name, b64] of Object.entries(png)) await writeFile(resolve(shots, `${name}.png`), Buffer.from(b64, 'base64'))
  return { title, ...report, teardown: end }
})
