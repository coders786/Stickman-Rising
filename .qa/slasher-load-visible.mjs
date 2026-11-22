// Unmodified schedules: trusted Engage, Retry, Results → Menu → Engage.
// Assert the presentation and input transaction on the actual phase event.
import assert from 'node:assert/strict'
import { withBridge, touch } from './bridge-browser.mjs'

const gl=process.argv.includes('--gl'), short=process.argv.includes('--short'), reduced=process.argv.includes('--reduce')
const lean=process.argv.includes('--lean')
await withBridge(async ({page,open,button,phase,wait,frames})=>{
  if(short)await page.setViewport({width:720,height:360,deviceScaleFactor:1,isMobile:touch,hasTouch:touch})
  if(reduced)await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.evaluateOnNewDocument(({gl,lean})=>{
    localStorage.setItem('sr_settings_v1',JSON.stringify({qualityV:3,quality:gl?'ultra':lean?'low':'high',adaptiveQuality:false,muted:true}))
    if(lean){const Klass=window.Worker;window.Worker=new Proxy(Klass,{construct(Worker,args){
      if(args[1]?.name?.startsWith('bridge-'))throw new DOMException('QA worker unavailable','SecurityError')
      return new Worker(...args)
    }})}
  },{gl,lean})
  await open()
  await page.evaluate(gl=>{
    const g=window.__sr,q=window.visibleQA={trials:[],state:()=>{
      const reveal=document.querySelector('.sr-ronin-reveal'),view=document.querySelector('.sr-viewport')
      return {at:performance.now(),phase:g.phase,frame:g.graphicsPresentation().frame,time:g.time,tick:g.hordeTick,
        pending:!!g.pendingRun,input:g.input.enabled,music:!!g.audio.timer,
        overlay:!!reveal?.querySelector('.sr-interlude'),stage:reveal?.querySelector('.sr-interlude-signal')?.dataset.stage,
        art:reveal&&getComputedStyle(reveal).display!=='none',release:reveal?.hasAttribute('data-cut'),
        pass:reveal&&getComputedStyle(reveal).pointerEvents==='none',
        finish:[...view.querySelectorAll('[data-render-layer="finish"]')].some(n=>!n.hidden&&getComputedStyle(n).visibility==='visible')}
    }}
    if(gl)g.allowDiagnosticMaster()
    window.addEventListener('click',e=>{
      const name=e.target.closest('button')?.textContent.trim()
      if(['ENGAGE','RETRY'].includes(name))q.trials.push({name,trusted:e.isTrusted&&navigator.userActivation.isActive,before:q.state(),holds:[]})
    },true)
    const sample=()=>{
      const trial=q.trials.at(-1)
      if(trial&&!trial.first&&trial.holds.length<500){const s=q.state();if(s.overlay)trial.holds.push(s)}
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    g.on(e=>{if(e.type==='phase'&&e.phase==='playing')q.trials.at(-1).first=q.state()})
  },gl)
  const controls=[]
  for(const [i,label]of ['ENGAGE','RETRY','ENGAGE'].entries()){
    await button(label);await phase('playing')
    const beforeInput=await page.evaluate(()=>window.visibleQA.state())
    if(touch)await button('JUMP');else await page.keyboard.press('Space')
    await wait(()=>window.__sr.player.y< -9)
    controls.push({beforeInput, jump:await page.evaluate(()=>window.__sr.player.y)})
    if(i===2)break
    await page.evaluate(()=>{const g=window.__sr;g.player.hp=0;g.paint(0,false);g.gameOver()})
    await phase('gameover')
    if(i===1){
      await button('MENU');await phase('attract');await frames()
      assert.equal(await page.evaluate(()=>window.visibleQA.state().finish),false)
    }
  }
  await page.evaluate(()=>window.__sr.gameOver());await phase('gameover')
  await button('ARSENAL');await button('BACK')
  await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='RETRY'))
  assert.equal(await page.evaluate(()=>window.__sr.phase),'gameover')
  const trials=await page.evaluate(()=>window.visibleQA.trials)
  assert.equal(trials.length,3)
  const timing=trials.map(({name,trusted,before,holds,first},i)=>{
    assert.ok(trusted&&holds.length>0,JSON.stringify({name,trusted,holds:holds.length}))
    assert.ok(holds.every(s=>s.phase==='preparing'&&!s.input&&!s.music))
    const covered = holds.filter(s => !s.release && s.frame?.id !== before.frame?.id)
    assert.ok(covered.length > 0 && covered.every(s => s.frame.kind === first.frame.kind && s.frame.time === 0 && s.frame.hud !== 'off'))
    assert.deepEqual([first.phase,first.time,first.tick,first.pending,first.input,first.music,first.overlay,first.art],
      ['playing',0,0,false,true,true,false,null])
    assert.ok(holds.filter(s=>s.release).every(s=>s.time===0 && s.frame.id===first.frame.id))
    assert.equal(first.frame.kind,gl?'webgl':'canvas')
    assert.equal(first.frame.time,0)
    assert.ok(first.frame.hud!=='off'&&first.frame.hp===100&&first.frame.threats>0)
    return {name,ms:first.at-before.at,samples:holds.length,stages:[...new Set(holds.map(s=>s.stage))],first,control:controls[i]}
  })
  return {gl,short,reduced,lean,viewport:page.viewport(),timing}
})
