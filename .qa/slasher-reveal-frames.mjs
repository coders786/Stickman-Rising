// Unmodified compositor playback through the actual cut and into combat.
// --control uses the same fixture with the previous, longer choreography.
// --title-ready waits for the title presentation so navigation and the cut
// aren't competing for the first compositor frame.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { withBridge, touch, useCompactGL } from './bridge-browser.mjs'

const gl = process.argv.includes('--gl'), compact = process.argv.includes('--compact')
const control = process.argv.includes('--control'), titleReady = process.argv.includes('--title-ready')
const folder = process.env.SR_SHOTS || '.cache/night-crossing/playback'
await mkdir(folder, { recursive: true })

async function arenaCoverage(bytes) {
  const { data, info: { width, height } } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject:true })
  // The first exposed frame is a dark scene, not necessarily green at the
  // corners. Test the same broad world strips used by the opening QA instead.
  const strips = [[0,0,width,17], [0,40,12,height-90], [width-12,40,width,height-90], [0,height-12,width,height]]
  return strips.map(([left,top,right,bottom]) => {
    let count = 0
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const i = (y*width+x)*3
      count += +(Math.max(data[i],data[i+1],data[i+2]) > 8)
    }
    return count
  })
}

function cadence(times, from, to) {
  const window = times.filter(t => t >= from && t <= to)
  const gaps = window.slice(1).map((t, i) => t - window[i]).sort((a,b) => a-b)
  return { frames:window.length, firstMs:window[0] ?? null, medianGapMs:gaps[Math.floor(gaps.length / 2)] ?? null, maxGapMs:gaps.at(-1) ?? null }
}

await withBridge(async ({ page, open, button, phase, wait, frames }) => {
  await page.setViewport(touch ? { width:390, height:844, deviceScaleFactor:2, isMobile:true, hasTouch:true }
    : { width:gl?700:1000, height:gl?460:560, deviceScaleFactor:1 })
  await page.evaluateOnNewDocument(gl => {
    if (gl) localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV:3, quality:'ultra', muted:true, adaptiveQuality:false, shake:false }))
    window.crossingPlayback = { runs:[], tasks:[], anim:[] }
    const q = window.crossingPlayback
    new PerformanceObserver(list => q.tasks.push(...list.getEntries().map(e => ({ at:e.startTime, ms:e.duration }))))
      .observe({type:'longtask',buffered:true})
    document.addEventListener('animationstart', e => {
      if (e.target.closest('.sr-ronin-reveal')) q.anim.push([e.animationName, performance.now()])
    }, true)
    document.addEventListener('click', e => {
      const name = e.target.closest('button')?.textContent.trim()
      if (['ENGAGE', 'RETRY'].includes(name)) q.runs.push({ name, click:performance.now(), trusted:e.isTrusted && navigator.userActivation.isActive })
    }, true)
    for (const type of ['keydown','pointerdown']) document.addEventListener(type, e => {
      const r = q.runs.at(-1)
      if (r?.handoff && (e.code === 'Space' || e.target.closest?.('button')?.textContent.trim() === 'JUMP')) {
        r.jump = performance.now(); r.jumpTrusted = e.isTrusted
        const seeJump = () => {
          if (q.runs.at(-1) !== r) return
          if (window.__sr.player.y < -9) r.jumpSeen = performance.now()
          else requestAnimationFrame(seeJump)
        }
        requestAnimationFrame(seeJump)
      }
    }, true)
  }, gl)
  await open()
  if (titleReady) {
    await wait(() => window.__sr.graphicsPresentation().frame?.kind === 'title')
    await frames()
  }
  if (gl) await page.evaluate(() => { const g=window.__sr; g.allowDiagnosticMaster(); g.preferDiagnosticMobile() })
  if (compact) await useCompactGL(page)
  const origin = await page.evaluate(() => {
    const g = window.__sr, base = g.requestRun.bind(g), q=window.crossingPlayback
    g.requestRun = s => { const ok=base(s); if (ok) g.pendingRun.seed=42; return ok }
    g.on(e => {
      if (e.type === 'runRevealing') {
        const p = g.graphicsPresentation()
        q.runs.at(-1).opening = { id:p.frame?.id, input:g.input.enabled, time:g.time }
      }
      if (e.type !== 'phase' || e.phase !== 'playing') return
      const r = q.runs.at(-1), root = document.querySelector('.sr-ronin-reveal')
      const marks = name => performance.getEntriesByName(`sr:${name}`).at(-1)?.startTime
      const p = g.graphicsPresentation()
      Object.assign(r, { handoff:performance.now(), submit:marks('run-submit'), settled:marks('run-settled'), cut:marks('run-cut'),
        path:p.path, frame:p.frame, input:g.input.enabled, tick:g.time, dialog:!!root?.querySelector('[role=dialog]'), overlay:!!root })
      if (!root) r.clear = r.handoff
      else {
        const observer = new MutationObserver(() => { if (!root.isConnected) { r.clear = performance.now(); observer.disconnect() } })
        observer.observe(root.parentElement, { childList:true })
      }
    })
    return performance.timeOrigin
  })
  const client = await page.createCDPSession(), film = []
  client.on('Page.screencastFrame', ({ sessionId, metadata, data }) => {
    void client.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    if (metadata.timestamp) film.push({ at:metadata.timestamp*1000-origin, data })
  })
  // Screencast can miss compositor-only transforms (notably on a warm
  // Retry). The display trace is an independent witness of updated frames.
  await page.tracing.start({ path:process.env.SR_REVEAL_TRACE, categories:['cc','viz','blink.user_timing'] })
  await client.send('Page.startScreencast', { format:'jpeg', quality:93, maxWidth:860, maxHeight:800 })
  for (const name of ['ENGAGE','RETRY']) {
    await button(name); await phase('playing')
    await wait(() => !document.querySelector('.sr-ronin-reveal'))
    const exposed = Buffer.from(await page.screenshot({ captureBeyondViewport:false }))
    const bright = await arenaCoverage(exposed)
    assert.ok(bright[1] > 300 && bright[2] > 300, `${name}: no world pixels at first exposure ${JSON.stringify(bright)}`)
    const exposedPath = `${name.toLowerCase()}-first-exposed.png`
    await writeFile(join(folder, exposedPath), exposed)
    await page.evaluate(({ path, pixels }) => {
      window.crossingPlayback.runs.at(-1).firstArena = { path, pixels, at:performance.now() }
      window.crossingPlayback.runs.at(-1).clear ??= performance.now()
    }, { path:exposedPath, pixels:bright })
    if (touch) await button('JUMP'); else await page.keyboard.press('Space')
    await wait(() => window.__sr.player.y < -9)
    await page.evaluate(async () => {
      const r=window.crossingPlayback.runs.at(-1)
      r.jumped=performance.now()
      await new Promise(resolve => setTimeout(resolve,800))
      r.end=performance.now()
    })
    if (name === 'ENGAGE') { await page.evaluate(() => window.__sr.gameOver()); await phase('gameover') }
  }
  await client.send('Page.stopScreencast')
  const trace = JSON.parse(Buffer.from(await page.tracing.stop()).toString('utf8')).traceEvents
  const marks = name => trace.filter(e => e.name === `sr:${name}`).map(e => e.ts)
  const starts = marks(control ? 'run-settled' : 'run-cut'), ends = marks('playing')
  const swapped = trace.filter(e => e.name === 'Display::DrawAndSwap' && e.ph === 'X').map(e => e.ts).sort((a,b) => a-b)
  const { runs, tasks, anim } = await page.evaluate(() => window.crossingPlayback)
  for (const [i,r] of runs.entries()) {
    assert.ok(r.trusted && r.jumpTrusted && r.input && !r.dialog && r.tick === 0)
    assert.ok(r.click < r.submit && r.submit < r.settled && r.settled <= r.handoff && r.clear <= r.jumped)
    assert.deepEqual([r.frame.seed,r.frame.time,r.frame.hp,r.frame.hud], [42,0,100,'layer'])
    if (!control) {
      assert.ok(!r.overlay && r.cut >= r.settled && r.cut < r.handoff)
      assert.deepEqual(r.opening, { id:r.frame.id, input:false, time:0 })
    }
    r.clickToSubmit=r.submit-r.click
    r.clickToHandoff=r.handoff-r.click
    assert.ok(r.jumpSeen >= r.jump, 'observe real movement following trusted input')
    r.jumpMs=r.jumpSeen-r.jump
    r.anim=anim.filter(([, at]) => at >= r.click && at <= r.clear).map(([name,at]) => [name,at-r.click])
    r.playback=[]
    for (const sample of film.filter(f => f.at >= r.click && f.at <= r.end)) {
      const path=`${r.name.toLowerCase()}-${String(r.playback.length).padStart(3,'0')}.jpg`
      const bytes=Buffer.from(sample.data,'base64'), ms=sample.at-r.click
      await writeFile(join(folder,path),bytes)
      r.playback.push({path,ms})
    }
    assert.ok(r.playback.length >= 3 && r.firstArena,
      `${r.name}: insufficient screencast samples or no first-exposure capture (${r.playback.length} captured frames)`)
    const start = r.anim.find(([name]) => name === 'sr-cut-out')?.[1] ?? r.settled-r.click
    const times=r.playback.map(f=>f.ms), swapTimes=swapped.map(t=>t/1000)
    r.cutCadence=cadence(times,start,r.clear-r.click)
    // Screencast can lag or omit compositor-only updates. Count actual swaps
    // after the handoff from Chromium's trace, not the recording transport.
    r.foreground=cadence(swapTimes,ends[i]/1000,origin+r.end)
    r.maxLongTaskMs=Math.max(0,...tasks.filter(e=>e.at>=r.click && e.at<r.end).map(e=>e.ms))
    r.cutLongTaskMs=Math.max(0,...tasks.filter(e=>e.at>=r.click+start && e.at<r.handoff).map(e=>e.ms))
    assert.ok(r.foreground.frames>=3, 'record multiple foreground frames after the cut')
    if (!control) {
      r.cutSwaps=cadence(swapped.map(t=>(t-starts[i])/1000),0,(ends[i]-starts[i])/1000)
      assert.ok(r.cutSwaps.frames>=3, `compositor must draw intermediate shutter frames: ${JSON.stringify(r.cutSwaps)}`)
    }
  }
  return { gl, control, titleReady, viewport:page.viewport(), runs }
})
