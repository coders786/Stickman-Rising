// Trusted controls and the actual submit transaction; no changes to art
// clocks. Exact poses and pixel coverage live in slasher-reveal-frames.mjs.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withBridge, touch, useCompactGL } from './bridge-browser.mjs'

const compact = process.argv.includes('--compact')
const reduced = process.argv.includes('--reduce'), gl = process.argv.includes('--gl')
const noAnimation = process.argv.includes('--no-animation'), short = process.argv.includes('--short')
const shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, { recursive: true })

await withBridge(async ({ page, open, wait, button, phase }) => {
  if (short) await page.setViewport({ width: 720, height: 360, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch })
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.evaluateOnNewDocument(gl => localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: gl ? 'ultra' : 'high', muted: true, adaptiveQuality: false })), gl)
  const requests = []
  page.on('request', r => {
    const path = new URL(r.url()).pathname
    if (/\/night-crossing\/|reel|ronin-reveal.*\.(?:png|webp|svg|gif|mp4)$/.test(path) || r.resourceType() === 'media') requests.push(path)
  })
  await open()
  if (compact) await useCompactGL(page)
  if (noAnimation) await page.addStyleTag({ content: '.sr-ronin-reveal, .sr-ronin-reveal * { animation: none !important; }' })
  await page.evaluate(gl => {
    const g = window.__sr, paint = g.paint.bind(g), request = g.requestRun.bind(g)
    if (gl) g.allowDiagnosticMaster()

    let seed = 41
    g.requestRun = s => { const ok = request(s); if (ok) g.pendingRun.seed = seed++; return ok }
    const q = window.revealQA = { hold: false, starts: [], clicks: [], prepares: [], holds: [] }
    g.paint = (...args) => {
      if (g.phase !== 'preparing') return paint(...args)
      if (q.hold) return false
      const at = performance.now(), result = paint(...args)
      if (gl && q.prepares.length < 24) q.prepares.push({ at, ms: performance.now() - at, result,
        tier: args[3]?.tier ?? null, staged: g.renderer.hasBridgeOpeningFrame, faults: g.presentationFaults })
      return result
    }
    q.scene = () => {
      const reveal = document.querySelector('.sr-ronin-reveal'), modal = reveal?.querySelector('.sr-interlude'), b = modal?.querySelector('button')
      const style = sel => { const el = reveal?.querySelector(sel); return el && getComputedStyle(el) }
      const rect = b?.getBoundingClientRect(), s = g.graphicsPresentation()
      return {
        at: performance.now(), pending: !!g.pendingRun, phase: g.phase, frame: s.frame, path: s.path, music: !!g.audio.timer, input: g.input.enabled, time: g.time,
        modal: !!modal, title: modal?.querySelector('h2')?.textContent, status: modal?.querySelector('[role=status]')?.textContent,
        focus: document.activeElement?.matches('button') ? document.activeElement.textContent?.trim() : document.activeElement?.tagName,
        box: rect && [rect.left, rect.top, rect.right, rect.bottom], screen: [innerWidth, innerHeight],
        display: reveal && getComputedStyle(reveal).display, hit: reveal && getComputedStyle(reveal).pointerEvents,
        handoff: !!reveal?.hasAttribute('data-cut'), media: reveal?.querySelectorAll('img,video,image,object,iframe').length,
        art: !!reveal?.querySelector('.sr-ronin-ink'), veil: style('.sr-ronin-veil')?.opacity,
        animation: style('.sr-ronin-card')?.animationName, touch: !!document.querySelector('.sr-touch-surface'),
      }
    }
    g.on(e => { if (e.type === 'phase' && e.phase === 'playing') q.starts.push(q.scene()) })
    window.addEventListener('click', e => {
      const b = e.target.closest('button')?.textContent.trim()
      if (['ENGAGE', 'RETRY', 'CANCEL'].includes(b)) q.clicks.push({ b, trusted: e.isTrusted && navigator.userActivation.isActive })
    }, true)
  }, gl)
  const read = () => page.evaluate(() => window.revealQA.scene())
  const played = () => phase('playing').catch(async error => {
    const state = await page.evaluate(() => ({ scene:window.revealQA.scene(), stages:window.revealQA.prepares,
      presentation:window.__sr.graphicsPresentation(), marks:performance.getEntriesByType('mark').filter(m => m.name.startsWith('sr:')).map(m => [m.name,m.startTime]) }))
    throw new Error(`${error.message}: ${JSON.stringify(state)}`)
  })
  const hold = value => page.evaluate(value => {
    const q = window.revealQA
    q.hold = value; q.holds.push([value, performance.now()])
  }, value)
  const img = name => shots && page.screenshot({ path: join(shots, name + '.png'), captureBeyondViewport: false })
  const jump = async () => {
    if (touch) await button('JUMP'); else await page.keyboard.press('Space')
    await wait(() => window.__sr.player.y < -9)
  }

  await hold(true); await button('ENGAGE'); await phase('preparing')
  await button('CANCEL'); await phase('attract')
  await wait(() => document.activeElement?.textContent.trim() === 'ENGAGE')
  assert.equal((await read()).pending, false)

  await button('ENGAGE'); await phase('preparing')
  await wait(() => window.__sr.pendingRun?.initialized && window.revealQA.scene().modal)
  const held = await read(), [l, t, r, b] = held.box
  assert.ok(held.modal && !held.input && !held.music && held.time === 0 && !held.touch)
  assert.equal(held.title, 'Night Crossing'); assert.equal(held.media, 0)
  assert.ok(l >= 0 && t >= 0 && r <= held.screen[0] && b <= held.screen[1] && b - t >= 44)
  assert.equal(held.focus, 'CANCEL')
  if (reduced || noAnimation) {
    assert.deepEqual([held.art, held.animation, held.veil], [true, 'none', '1'])
    await img(reduced ? 'reduced' : 'no-animation')
  }
  assert.equal(held.veil, '1')
  if (!reduced && !noAnimation) {
    await wait(() => document.querySelector('.sr-ronin-card')?.getAnimations().every(a => a.playState === 'finished'))
    await img('ink-card')
  }
  await hold(false); await played()
  const first = await page.evaluate(() => window.revealQA.starts[0])
  assert.ok(!first.handoff && first.input && first.music && !first.modal && !first.art)
  assert.deepEqual([first.frame.time, first.frame.hp, first.frame.seed, first.time], [0, 100, 42, 0])
  assert.equal(first.touch, touch)
  if (first.frame.kind !== (gl ? 'webgl' : 'canvas')) {
    const receipt = await page.evaluate(() => ({ presentation: window.__sr.graphicsPresentation(),
      prepares: window.revealQA.prepares, holds: window.revealQA.holds,
      marks: performance.getEntriesByType('mark').filter(m => m.name.startsWith('sr:')).map(m => [m.name, m.startTime]) }))
    assert.fail(`Unexpected opening path: ${JSON.stringify({ first: first.frame, ...receipt })}`)
  }
  await jump()
  await wait(() => !document.querySelector('.sr-ronin-reveal'))
  await img('playing')

  const results = await page.evaluate(() => { const g = window.__sr; g.gameOver(); return g.graphicsPresentation().frame })
  await hold(true); await button('RETRY'); await phase('preparing')
  await wait(() => window.__sr.pendingRun?.initialized)
  assert.match((await read()).status, /Re-entering arena/)
  if (touch) await button('CANCEL'); else await page.keyboard.press('Escape')
  await phase('gameover')
  await wait(() => document.activeElement?.textContent.trim() === 'RETRY')
  const cancelled = await read()
  assert.deepEqual(cancelled.frame, results)
  assert.ok(!cancelled.pending && !cancelled.music && !cancelled.input && !cancelled.modal)
  await hold(false); await button('RETRY')
  let cut = null
  if (!reduced && !noAnimation) {
    await wait(() => {
      const q = window.revealQA
      if (!q.scene().handoff) return false
      q.cut = q.scene()
      return true
    })
    cut = await page.evaluate(() => window.revealQA.cut)
    assert.ok(cut.handoff && cut.modal && !cut.input && !cut.music && cut.time === 0, JSON.stringify(cut))
  }
  await played()
  await jump()
  const final = await page.evaluate(() => {
    const g = window.__sr, q = window.revealQA
    g.destroy()
    return { starts: q.starts, clicks: q.clicks, prepares: q.prepares, holds: q.holds, stores: g.resourceSnapshot().surfaces }
  })
  assert.deepEqual(final.starts.map(s => [s.frame.seed, s.time, s.modal, s.input]), [[42, 0, false, true], [44, 0, false, true]])
  assert.ok(final.clicks.every(c => c.trusted)); assert.equal(final.stores, 0)
  assert.deepEqual(requests, [])
  return { viewport: page.viewport(), reduced, noAnimation, gl, short, requests, held, first, cancelled, cut, final }
})
