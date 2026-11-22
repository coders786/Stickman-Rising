// Real prolonged preparation: hold the required deck plate, watch the
// real opaque cover, then let the actual decode/worker/submit path finish.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withBridge } from './bridge-browser.mjs'

const asset = '/bridge/deck-pier.webp', shots = process.env.SR_SHOTS
if(shots)await mkdir(shots,{recursive:true})
await withBridge(async ({page,open,button,phase,wait}) => {
  const blocked=[], art=[]
  let released=false
  await page.setRequestInterception(true)
  page.on('request',r=>{
    const path=new URL(r.url()).pathname
    if(path===asset&&!released){blocked.push(r);return}
    if(path.startsWith('/night-crossing/')||r.resourceType()==='media')art.push(path)
    return r.continue()
  })
  await open()
  await page.evaluate(()=>{
    const g=window.__sr,q=window.crossingQA={starts:[],trusted:false}
    q.read=()=>{
      const root=document.querySelector('.sr-ronin-reveal'), modal=root?.querySelector('.sr-interlude')
      const style=sel=>{const e=root?.querySelector(sel);return e&&getComputedStyle(e)}
      const focus=document.activeElement,r=focus.getBoundingClientRect()
      return {phase:g.phase,stage:g.pendingRun?.stage,time:g.time,input:g.input.enabled,music:!!g.audio.timer,
        frame:g.graphicsPresentation().frame,seed:g.pendingRun?.seed,status:modal?.querySelector('[role=status]')?.textContent,
        modal:!!modal,handOff:!!root?.hasAttribute('data-cut'),media:root?.querySelectorAll('img,image,video').length,
        focus:focus.matches('button') ? focus.textContent.trim() : focus.tagName,
        fit:r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
        ink:!!root?.querySelector('.sr-ronin-ink'),veil:style('.sr-ronin-veil')?.opacity}
    }
    window.addEventListener('click',e=>{
      if(e.target.closest('button')?.textContent.trim()!=='ENGAGE')return
      q.trusted=e.isTrusted&&navigator.userActivation.isActive;q.prior=q.read().frame;q.at=performance.now()
    },true)
    g.on(e=>{if(e.type==='phase'&&e.phase==='playing')q.starts.push(q.read())})
  })
  await button('ENGAGE')
  await wait(()=>window.crossingQA.read().stage==='background')
  assert.equal(blocked.length,1)
  const elapsed=ms=>wait(ms=>performance.now()-window.crossingQA.at>=ms,ms)
  const read=()=>page.evaluate(()=>window.crossingQA.read())
  await elapsed(950);const a=await read()
  await elapsed(1800);const hold=await read()
  assert.deepEqual([hold.phase,hold.stage,hold.time,hold.input,hold.music,hold.modal,hold.focus,hold.fit,hold.media],
    ['preparing','background',0,false,false,true,'CANCEL',true,0])
  for(const s of [a,hold])assert.deepEqual([s.ink,s.veil,s.handOff],[true,'1',false])
  assert.match(hold.status,/Assemble the bridge/)
  if(shots)await page.screenshot({path:join(shots,'bridge-deck-hold.png'),captureBeyondViewport:false})
  released=true;await Promise.all(blocked.map(r=>r.continue()))
  await phase('playing')
  const q=await page.evaluate(()=>({ ...window.crossingQA,
    asset:performance.getEntriesByName(new URL('/bridge/deck-pier.webp',location.href).href).at(-1)?.responseEnd,
    marks:performance.getEntriesByType('mark').filter(e=>e.name.startsWith('sr:run-')).map(e=>[e.name,e.startTime]),
  }))
  assert.ok(q.trusted&&q.starts.length===1&&q.asset)
  // A cold, trusted click can beat the attract renderer's first publish.
  // Preserve that null receipt too rather than assuming there was a title frame.
  assert.deepEqual(hold.frame,q.prior,'required load must retain the previous frame')
  const first=q.starts[0]
  assert.deepEqual([first.phase,first.frame.seed,first.frame.time,first.time,first.modal,first.input,first.music,first.handOff],
    ['playing',hold.seed,0,0,false,true,true,false])
  assert.ok(['canvas','webgl'].includes(first.frame.kind)&&first.frame.hud!=='off')
  const marks=Object.fromEntries(q.marks)
  assert.ok(q.asset<=marks['sr:run-backdrop-ready']&&marks['sr:run-backdrop-ready']<=marks['sr:run-submit'])
  assert.deepEqual(art,[])
  return {asset, first, hold, art, marks, submittedMs:marks['sr:run-submit']-q.at}
})
