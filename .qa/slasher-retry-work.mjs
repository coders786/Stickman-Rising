// Reproduce head-of-line blocking on Retry: neither old worker answers.
// New same-seed artwork still has to submit from the real Canvas path.
import assert from 'node:assert/strict'
import { withBridge } from './bridge-browser.mjs'

const control = process.argv.includes('--control')
await withBridge(async ({ page, open, button, phase, wait }) => {
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'high', adaptiveQuality: false, muted: true,
  })))
  await open()
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
    const q = window.retryWorkQA = { starts: [], held: [], stopped: [] }
    g.on(e => {
      if (e.type !== 'phase' || e.phase !== 'playing') return
      const state = g.graphicsPresentation(), stream = g.bg.bridgeStream()
      q.starts.push({ path: state.path, frame: state.frame, stream: stream.receipt(), time: g.time,
        input: g.input.enabled, music: !!g.audio.timer, overlay: !!document.querySelector('.sr-interlude') })
      queueMicrotask(() => cancelAnimationFrame(g.raf))
    })
  })
  await button('ENGAGE'); await phase('playing')
  await wait(() => { const s = window.__sr.bg.bridgeStream().receipt(); return !s.rasterPending && !s.opticsPending })
  await page.evaluate(() => {
    const g = window.__sr, s = g.bg.bridgeStream(), q = window.retryWorkQA
    for (const key of ['optics', 'raster']) {
      const worker = s[key].worker, terminate = worker.terminate.bind(worker)
      worker.postMessage = message => { q.held.push({ lane: key, ...message }) }
      worker.terminate = () => { q.stopped.push(key); terminate() }
    }
    // Simulate a worker stalled while serving a moving camera, before the
    // old run goes to Results. Do not resume or release these jobs.
    s.requestWindow(9900, 10500, 10200)
    s.planPlates(9, [8, 9], true)
    if (!s.receipt().opticsPending || !s.receipt().rasterPending) throw Error('Missing stalled lane witness')
    g.gameOver(); g.raf = requestAnimationFrame(g.loop)
  })
  await button('RETRY'); await phase('playing')
  const result = await page.evaluate(() => {
    const q = window.retryWorkQA, g = window.__sr
    const mark = s => performance.getEntriesByName('sr:' + s).at(-1)?.startTime ?? null
    const marks = { retry: mark('retry'), fallback: mark('run-fallback'), submit: mark('run-submit') }
    const before = { ...q, stopped: q.stopped.slice(), marks, retryMs: marks.submit - marks.retry }
    g.destroy()
    return { ...before, after: g.resourceSnapshot(), stream: g.bg.bridgeStream()?.receipt() ?? null }
  })
  assert.deepEqual(result.held.map(r => [r.lane, r.type, r.seed]), [['optics','window',42], ['raster','plate',42]])
  assert.equal(result.starts.length, 2)
  const [first, retry] = result.starts
  assert.equal(first.frame.kind, 'canvas')
  assert.deepEqual([retry.path, retry.frame.seed, retry.frame.time, retry.frame.hud, retry.frame.hp, retry.time, retry.input, retry.music, retry.overlay],
    ['mobile-canvas', 42, 0, 'layer', 100, 0, true, true, false])
  if (control) {
    assert.ok(result.marks.fallback - result.marks.retry >= 7150)
    assert.equal(retry.frame.kind, 'canvas')
    assert.equal(retry.stream.plates, 0, 'only the provisional scene can be published after the timeout')
    assert.equal(retry.stream.windows, first.stream.windows, 'no current optical window made it through')
    assert.deepEqual(result.stopped, []) // This snapshot precedes teardown.
  } else {
    assert.equal(result.marks.fallback, null)
    assert.equal(retry.frame.kind, 'canvas')
    assert.deepEqual(result.stopped, ['optics', 'raster'])
    assert.ok(retry.stream.retiredJobs >= 2 && retry.stream.plates > 0 && retry.stream.windows >= 2)
  }
  assert.equal(result.after.surfaces, 0)
  return result
})
