// Cancel an actual suspended draft, then resize mid-cut and reject the old
// animation callback. No changes to the engine's readiness thresholds.
import assert from 'node:assert/strict'
import { withBridge, touch } from './bridge-browser.mjs'

await withBridge(async ({ page, open, button, phase, wait }) => {
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV:3, quality:'high', muted:true, adaptiveQuality:false, shake:false,
  })))
  await open()
  await wait(() => window.__sr.graphicsPresentation().frame?.kind === 'title')
  await page.evaluate(() => {
    const g=window.__sr, request=g.requestRun.bind(g), paint=g.paint.bind(g), draw=g.renderer.drawSteps.bind(g.renderer)
    const q=window.draftQA={hold:false, starts:[], cuts:[], trusted:[]}
    q.state=()=>({
      frame:g.graphicsPresentation().frame, active:!!g.pendingRun, input:g.input.enabled,
      music:!!g.audio.timer, draft:g.paintDraft?.world.opening !== undefined, time:g.time,
      workHidden:g.paintDraft?.ctx.canvas.style.visibility==='hidden',
    })
    let seed=41
    g.requestRun=s=>{const ok=request(s);if(ok)g.pendingRun.seed=seed++;return ok}
    g.renderer.drawSteps=function*(...args) {
      const steps=draw(...args)
      if (q.hold && g.phase==='preparing') {
        // First render step really touches the hidden backing. Make the
        // cancellation point observable even if the fixture is very fast.
        const first=steps.next()
        if (first.done) return
        const at=performance.now()
        while(performance.now()-at<7){ /* fixture only */ }
        yield
      }
      yield* steps
    }
    g.paint=(...args)=>q.hold&&g.phase==='preparing'&&g.paintDraft ? false : paint(...args)
    g.on(e=>{
      if(e.type==='runRevealing')q.cuts.push({id:e.id,state:q.state()})
      if(e.type==='phase' && e.phase==='playing')q.starts.push(q.state())
    })
    document.addEventListener('click', e=>{
      const label=e.target.closest('button')?.textContent.trim()
      if(['ENGAGE','RETRY','CANCEL','MENU'].includes(label))q.trusted.push([label,e.isTrusted])
    },true)
  })
  const state=()=>page.evaluate(()=>window.draftQA.state())
  const hold=value=>page.evaluate(value=>{window.draftQA.hold=value},value)
  const draft=async()=>{
    await wait(()=>window.draftQA.state().workHidden)
    const s=await state()
    assert.ok(s.draft && s.workHidden && s.active && !s.input && !s.music)
    return s
  }
  const title=(await state()).frame
  await hold(true); await button('ENGAGE')
  const first=await draft()
  assert.deepEqual(first.frame,title)
  await button('CANCEL'); await phase('attract')
  const cancelled=await state()
  assert.ok(!cancelled.active && !cancelled.draft && !cancelled.input)
  assert.equal(cancelled.frame.kind, 'title')
  await hold(false); await button('ENGAGE'); await phase('playing')

  const results=await page.evaluate(()=>{const g=window.__sr;g.gameOver();return g.graphicsPresentation().frame})
  await hold(true); await button('RETRY')
  const beforeResize=await draft()
  const size=page.viewport()
  await page.setViewport({...size,width:size.width-20})
  await wait(width=>window.__sr.cssW===width, size.width-20)
  const afterResize=await draft()
  assert.deepEqual([beforeResize.frame,afterResize.frame],[results,results])
  if (touch) await button('CANCEL'); else await page.keyboard.press('Escape')
  await phase('gameover'); assert.deepEqual((await state()).frame,results)

  // Hold completion of exactly one real cut so that resizing can't race
  // the fixture. A completion for that retired id may not open combat.
  await page.evaluate(()=>{
    const g=window.__sr,q=window.draftQA,end=g.finishOpeningCut.bind(g)
    q.oldFinished=null
    g.finishOpeningCut=id=>{ if(q.oldFinished===null)q.oldFinished=id; if(q.oldFinished!==id)end(id) }
  })
  await hold(false); await button('RETRY')
  await wait(()=>window.draftQA.oldFinished !== null)
  const firstCut=await state()
  assert.ok(firstCut.active && !firstCut.input && firstCut.frame.seed===44 && firstCut.time===0)
  await page.setViewport(size)
  await wait(()=>window.__sr.pendingRun?.cut?.id > window.draftQA.oldFinished)
  await page.evaluate(()=>{
    const g=window.__sr, cut=g.pendingRun.cut
    // The stale callback uses the real API in the unit-facing engine;
    // compare state without pre-empting the new animation.
    const done=cut.done
    Object.getPrototypeOf(g).finishOpeningCut.call(g,window.draftQA.oldFinished)
    if (cut.done!==done) throw Error('Retired cut opened input')
  })
  await phase('playing')
  if (touch) await button('JUMP'); else await page.keyboard.press('Space')
  await wait(()=>window.__sr.player.y < -9)
  const final=await page.evaluate(()=>{
    const { starts,cuts,trusted }=window.draftQA
    const g=window.__sr;g.destroy()
    return { starts,cuts,trusted,stores:g.resourceSnapshot().surfaces }
  })
  assert.deepEqual(final.starts.map(s=>[s.frame.seed,s.frame.time,s.input,s.music]),[[42,0,true,true],[44,0,true,true]])
  assert.deepEqual(final.cuts.map(r=>r.state.frame.seed),[42,44,44])
  assert.equal(final.stores,0)
  assert.ok(final.trusted.every(([,trusted])=>trusted))
  return { first,cancelled,beforeResize,afterResize,firstCut,final }
})
