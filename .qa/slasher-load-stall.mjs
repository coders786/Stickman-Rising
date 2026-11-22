// Permanent non-readiness must never cause an incomplete opening. Drive the
// watchdog's active-time clock explicitly after verifying the real hold.
import assert from 'node:assert/strict'
import { withBridge, useCompactGL } from './bridge-browser.mjs'

const compact=process.argv.includes('--compact')
const fence = process.argv.includes('--fence'), surface = process.argv.includes('--surface')
await withBridge(async ({page,open,button,phase,wait,frames}) => {
  const held = []
  let release = false, requests = 0
  if (!fence && !surface) {
    await page.setRequestInterception(true)
    page.on('request',r=>{
      if (new URL(r.url()).pathname==='/bridge/deck-pier.webp') {
        requests++
        if (!release) { held.push(r); return }
      }
      void r.continue()
    })
  }
  await page.setViewport({width:690,height:458,deviceScaleFactor:1})
  await page.evaluateOnNewDocument(fence=>{
    localStorage.setItem('sr_settings_v1',JSON.stringify({qualityV:3,quality:fence?'ultra':'high',muted:true,adaptiveQuality:false}))
    const q=window.stallQA={fenceHold:fence,starts:[],unavailable:0,errors:0}
    if(fence){
      const proto=WebGL2RenderingContext.prototype, old=proto.clientWaitSync
      proto.clientWaitSync=function(...args){return q.fenceHold && window.__sr?.phase==='preparing'?this.TIMEOUT_EXPIRED:old.apply(this,args)}
    }
  },fence)
  await open()
  if (compact) await useCompactGL(page)
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.evaluate(({fence,surface})=>{
    const g=window.__sr, request=g.requestRun.bind(g), q=window.stallQA
    if(fence) { g.allowDiagnosticMaster(); g.preferDiagnosticMobile(); g.setDiagnosticRenderScale(1) }

    if(surface){const work=g.coverage.work;g.coverage.work=()=>({isContextLost:()=>true});q.restore=()=>{g.coverage.work=work}}
    g.requestRun=sword=>{const ok=request(sword); if(ok)g.pendingRun.seed=42;return ok}
    q.state=()=>({phase:g.phase,stage:g.pendingRun?.stage,time:g.time,overlay:!!document.querySelector('.sr-interlude'),
      handoff:!!document.querySelector('[data-cut]'),frame:g.graphicsPresentation().frame,staged:g.graphicsPresentation().staged,input:g.input.enabled})
    g.on(e=>{
      if(e.type==='phase' && e.phase==='playing')q.starts.push({...q.state(),path:g.graphicsPresentation().path, music:!!g.audio.timer})
      if(e.type==='runUnavailable')q.unavailable++
      if(e.type==='error')q.errors++
    })
  },{fence,surface})
  await button('ENGAGE')
  await wait(stage=>window.__sr.pendingRun?.initialized && window.__sr.pendingRun.stage===stage &&
    (stage!=='frame' || window.__sr.graphicsPresentation().staged), fence?'frame':surface?'surface':'background')
  const state = () => page.evaluate(()=>window.stallQA.state())
  const before = await state()
  assert.ok(before.overlay && !before.handoff && before.time===0 && !before.input && before.frame?.kind!=='canvas')
  if(!fence && !surface)assert.equal(held.length,1)
  const active = ms => page.evaluate(ms=>{window.__sr.pendingRun.activeMs=ms},ms)
  await active(8_000); await frames()
  const pastOldBudget=await state()
  assert.deepEqual(pastOldBudget,before,'elapsed time may not publish fallback')
  await active(26_000); await phase('attract')
  await wait(()=>document.querySelector('[role=alert]')?.textContent.includes('Try again'))
  const failed=await page.evaluate(()=>{
    const q=window.stallQA
    return {...q.state(),pending:!!window.__sr.pendingRun,unavailable:q.unavailable,starts:q.starts.length,errors:q.errors}
  })
  assert.deepEqual([failed.pending,failed.overlay,failed.handoff,failed.input,failed.staged,failed.unavailable,failed.starts,failed.errors],
    [false,false,false,false,false,1,0,0])
  release = true
  await Promise.allSettled(held.map(r=>r.continue()))
  await page.evaluate(()=>{window.stallQA.fenceHold=false;window.stallQA.restore?.()})
  await button('ENGAGE'); await phase('playing'); await wait(()=>window.__sr.time>.04)
  const after=await page.evaluate(()=>{
    const g=window.__sr,q=window.stallQA
    const marks=performance.getEntriesByType('mark').filter(m=>m.name.startsWith('sr:')).map(m=>[m.name,m.startTime])
    const retry=q.starts[0]
    g.destroy()
    return {marks,retry,errors:q.errors,surfaces:g.resourceSnapshot().surfaces}
  })
  const s=after.retry
  assert.deepEqual([s.frame.seed,s.frame.time,s.frame.hud,s.frame.hp,s.overlay,s.input,s.music,after.errors,after.surfaces],
    [42,0,'layer',100,false,true,true,0,0])
  assert.equal(s.path,fence?'mobile-webgl2':'mobile-canvas')
  if(!fence && !surface)assert.ok(requests>=2,'the timed-out image is requested again')
  return {fence,surface,requests,before,pastOldBudget,failed,after}
})
