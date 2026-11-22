/** Opt-in overlay smoke test on software WebGL. Not a fidelity/performance test. */
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { base, withBridge, useCompactGL } from './bridge-browser.mjs'

await withBridge(async ({ page, open, button, phase, wait }) => {
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'ultra', adaptiveQuality: false, muted: true })))
  const url = new URL(base); url.searchParams.set('bridgeActorDebug', '1'); url.searchParams.set('traceGraphics', '1')
  await open(url); await useCompactGL(page)
  await page.evaluate(() => { window.__sr.allowDiagnosticMaster(); if (location.search.includes('mobileTest=1')) window.__sr.preferDiagnosticMobile() })
  await button('ENGAGE'); await phase('playing')
  await wait(() => (window.__sr.graphicsPresentation().gpu?.actorPrototype?.instances ?? 0) > 0)
  const info = await page.evaluate(() => {
    const g = window.__sr; cancelAnimationFrame(g.raf)
    g.paint(0, false)
    const pipe = g.renderer.bridgeFinish.pipe
    return { presentation: g.graphicsPresentation(), error: pipe.gl.getError(), trace: window.__SR_GRAPHICS_TRACE__.snapshot() }
  })
  assert.equal(info.error, 0); assert.ok(info.presentation.gpu.actorPrototype.instances > 0)
  assert.equal(info.presentation.gpu.actorPrototype.overflow, false)
  const gpu = info.presentation.gpu, counts = gpu.passDraws
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), gpu.frameDraws)
  assert.equal(counts.grade, 1); assert.equal(counts.debug, 1)
  assert.equal(gpu.canvasUploads.worldBytes, gpu.size[0] * gpu.size[1] * 4)
  assert.equal(gpu.canvasUploads.choreographyBytes, gpu.canvasUploads.worldBytes)
  for (const stage of ['bridgeBackdrop', 'bridgeWorld', 'bridgeGroundProps', 'bridgeEnemiesAndUnder',
    'bridgePlayerAndSmears', 'bridgeProjectilesAndMotes', 'bridgeForegroundAndEffects']) {
    assert.ok(info.trace.metrics[`paint.${stage}`]?.count > 0, `missing ${stage} samples`)
  }
  const canvas = await page.$('[data-render-layer=finish]')
  const on = await canvas.screenshot()
  await page.evaluate(() => {
    const g = window.__sr, pass = g.renderer.bridgeFinish.pipe.actorDebugPass
    pass.draw = () => false
    g.paint(0, false)
  })
  const off = await canvas.screenshot()
  const a = await sharp(on).removeAlpha().raw().toBuffer(), b = await sharp(off).removeAlpha().raw().toBuffer()
  let changed = 0
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 15) changed++
  assert.ok(changed > 5, `overlay should alter visible pixels, got ${changed}`)
  return { path: info.presentation.path, prototype: info.presentation.gpu.actorPrototype, changedPixels: changed, glError: info.error, passDraws: counts, canvasUploads: gpu.canvasUploads }
})
