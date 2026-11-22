/** Count warmed under-deck paint operations at an identical camera pose.
 * --baseline accepts the retired car layer. These counts are not frame time. */
import assert from 'node:assert/strict'
import { withBridge } from './bridge-browser.mjs'

const baseline = process.argv.includes('--baseline')
await withBridge(async ({page, open, button, phase, wait}) => {
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV:3, quality:'medium', adaptiveQuality:false, muted:true, shake:false,
  })))
  await open()
  await page.evaluate(() => {
    const g=window.__sr, request=g.requestRun.bind(g)
    g.requestRun=sword=>{const ok=request(sword);if(ok)g.pendingRun.seed=42;return ok}
  })
  await button('ENGAGE');await phase('playing')
  await wait(()=>performance.getEntriesByType('resource').some(e=>new URL(e.name).pathname==='/bridge/metro-street.webp'))
  const result=await page.evaluate(async () => {
    const g=window.__sr, scene=g.bg.scenery
    cancelAnimationFrame(g.raf)
    const w=984,h=610, cam={x:3088,y:-108,zoom:1.12,rot:0}
    const ctx=new OffscreenCanvas(w,h).getContext('2d')
    const count={}, keys=['drawImage','fillRect','createLinearGradient','beginPath','stroke','fill']
    let art=false
    for(const key of keys) {
      const run=ctx[key].bind(ctx)
      ctx[key]=(...args)=>{ count[key]++; if(key==='drawImage' && args[0] instanceof HTMLImageElement) art=true; return run(...args) }
    }
    const draw=t=>{ctx.clearRect(0,0,w,h);for(const key of keys)count[key]=0; scene.drawBelowCity(ctx,w,h,cam,t);return {...count}}
    for(let i=0;i<50&&!art;i++){ draw(10); await new Promise(requestAnimationFrame) }
    const a=draw(10), bytes=new Uint8Array(ctx.getImageData(0,0,w,h).data)
    ctx.clearRect(0,0,w,h)
    const b=draw(13), other=ctx.getImageData(0,0,w,h).data
    let changed=0
    for(let i=0;i<bytes.length;i+=4)changed+=+(bytes[i]!==other[i]||bytes[i+1]!==other[i+1]||bytes[i+2]!==other[i+2]||bytes[i+3]!==other[i+3])
    g.destroy()
    return {w,h,cam,art,a,b,changed,stores:g.resourceSnapshot().surfaces}
  })
  assert.ok(result.art, 'expected the warmed WebP, not the procedural contingency')
  assert.equal(result.stores,0)
  if(baseline) assert.ok(result.changed>0)
  else {
    assert.equal(result.changed,0,'only the camera should move the service court')
    assert.equal(result.a.createLinearGradient,0)
    assert.ok(result.a.drawImage<=3&&result.a.fillRect<=1,JSON.stringify(result.a))
  }
  return {baseline,...result}
})
