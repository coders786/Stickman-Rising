// Matched real frames for the Python before/after audit. Only QA fixes pose,
// exposure, and time, and reads isolated backings; production never captures itself.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withBridge, touch, viewport } from './bridge-browser.mjs'

const dir = process.env.SR_SHOTS
const canvas = process.argv.includes('--canvas'), optimize = touch || process.argv.includes('--optimized')
const verify = process.argv.includes('--verify')
if (!dir) throw Error('Set SR_SHOTS to a capture directory')
await mkdir(dir,{recursive:true})
await withBridge(async ({page,open,button,phase,wait,frames})=>{
  await page.setViewport({...viewport,...(touch ? {width:412,height:780} : {width:960,height:640}),deviceScaleFactor:1})
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1',JSON.stringify({qualityV:3,quality:'ultra',adaptiveQuality:false,muted:true,shake:false})))
  await open()
  await page.evaluate(({canvas,optimize})=>{
    const g=window.__sr, req=g.requestRun.bind(g)
    g.setDiagnosticRenderScale(1)
    if(!canvas)g.allowDiagnosticMaster()
    if(optimize)g.preferDiagnosticMobile()
    g.requestRun = s => { const ok=req(s); if(ok)g.pendingRun.seed=42; return ok }
    g.on(e=>{if(e.type==='phase'&&e.phase==='playing')queueMicrotask(()=>cancelAnimationFrame(g.raf))})
  },{canvas,optimize})
  await button('ENGAGE'); await phase('playing')
  await wait(()=>!document.querySelector('.sr-ronin-reveal'))
  const expected = canvas ? 'mobile-canvas' : optimize ? 'mobile-webgl2' : 'master-webgl2'
  const metro = await page.evaluate(async expected=>{
    const g=window.__sr, p=g.player, c=g.cam, r=g.renderer, f=r.bridgeField, weather=g.bg.routeWeather.clock.sample
    g.qaMode=true;g.enemies.length=g.props.props.length=0;g.fx.clear();g.projectiles.clear();g.banner=null;g.hitstopT=0;g.streamQuiet=true
    if (g.pickups) g.pickups.draw=()=>{}
    const metro=g.route.chunk(0).shelter, hero=metro.right+67
    p.reset(hero);p.swordDrawn=true
    g.stats.distanceMetres=(hero-240)/10
    const start={x:innerWidth<innerHeight?metro.right-23:metro.left+305,y:-106,zoom:innerWidth<innerHeight?1.10:1.24,rot:0,offX:0,offY:0}
    c.startOnRoad(start.x);Object.assign(c,start)
    g.time=g.renderTime=3;g.bg.syncCutaway(hero,0,1)
    let clock=3, drift=0
    g.bg.routeTime=()=>clock;g.bg.routeDrift=()=>drift;g.bg.lightningI=()=>0
    Object.assign(weather,{cloud:.44,fog:.22,key:.92,rain:0,wet:.40})
    const paint=()=>{
      if(!g.paint(0,false)||g.graphicsPresentation().path!==expected)throw Error(JSON.stringify(g.graphicsPresentation()))
    }
    for(let i=0;i<45;i++){
      paint()
      const w=g.bg.bridgeStream().window, probe=f.probeWindow
      if (w && probe===w && f.view.left>=w.origin && f.view.right<=w.origin+w.width)break
      if (i===44)throw Error('No committed window at matched camera')
      await new Promise(resolve=>setTimeout(resolve,25))
    }
    const material=(name)=>{
      if(name==='pan')Object.assign(c,{x:start.x+253,y:start.y-109,zoom:start.zoom+.12,rot:.053,offX:7,offY:12})
      else Object.assign(c,start)
      // Hold advection and weather to isolate intrinsic baked evolution.
      clock=name==='later'?49:3;drift=0
      paint(); if(expected==='mobile-webgl2')paint()
      const size=[g.cssW,g.cssH], a=f.atmo, s=g.bg.scenery.sky, pipe=r.bridgeFinish.pipe
      const isolated=document.createElement('canvas')
      let ctx, cache=null
      if(pipe?.skyReady){
        const gl=pipe.gl, target=pipe.skyCache, {width,height}=target, master=expected==='master-webgl2'
        const depth=master ? new Float32Array(width*height*4):new Uint8Array(width*height*4)
        gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo)
        gl.readPixels(0,0,width,height,gl.RGBA,master?gl.FLOAT:gl.UNSIGNED_BYTE,depth)
        gl.bindFramebuffer(gl.FRAMEBUFFER,null)
        if(gl.getError()!==gl.NO_ERROR)throw Error('could not capture sky radiance')
        const rows=Math.round(height*a.air[0]/Math.max(a.air[0],pipe.receipt().stratumA.opticalCeiling))
        isolated.width=width;isolated.height=rows;ctx=isolated.getContext('2d')
        const im=ctx.createImageData(width,rows)
        for(let y=0;y<rows;y++)for(let x=0;x<width;x++){
          const i=(y*width+x)*4,j=((rows-y-1)*width+x)*4
          for(let k=0;k<3;k++){
            const v=(master?depth[j+k]:(depth[j+k]/255)**2)*1.06
            const l=v*(2.51*v+.03)/(v*(2.43*v+.59)+.14)
            im.data[i+k]=Math.round(255*(l<=.0031308?12.92*l:1.055*l**(1/2.4)-.055))
          }
          im.data[i+3]=255
        }
        ctx.putImageData(im,0,0);cache=[width,rows]
      }else{
        [isolated.width,isolated.height]=size
        ctx=isolated.getContext('2d',{willReadFrequently:true});s.draw(ctx,a,...size,true)
      }
      return { png:isolated.toDataURL().split(',')[1], atmo:a.receipt(), cache, cloud:[...a.highDeck,...a.stormDeck], phase:a.cloudPhase ? [...a.cloudPhase] : null }
    }
    const draw=p.draw, glazing=r.glass.draw
    const project = joint => g.project(p.x+p.face*p.scale*joint.x,p.hipY+p.scale*joint.y)
    const actor = () => Object.fromEntries(['headC','neckTop','chest','hip','kneeL','kneeR','ankleL','ankleR','handL','handR','grip','tip']
      .map(k=>[k,project(p.geom[k])]))
    const pre={ frame:g.graphicsPresentation().frame, camera:start, actor:actor(),
      glass:g.graphicsPresentation().glass,
      panes:[...r.glass.openings.values()].flatMap(o=>o.front.panes.map(k=>{
        const a=g.project(o.front.x+k.left,k.top),b=g.project(o.front.x+k.right,k.bottom)
        return {left:a.x,top:a.y,right:b.x,bottom:b.y}
      })),
      region:{left:g.project(metro.left+23,-240).x,top:g.project(metro.left+23,-229).y,right:g.project(metro.left+322,-68).x,bottom:g.project(metro.left+322,-68).y} }
    window.pureBridgeQA={ material, paint, actor(on){p.draw=on?draw:()=>{};paint()}, glass(on){r.glass.draw=on?glazing:()=>{};paint()},
      attack(){
        p.reset(hero);p.swordDrawn=true
        const dt=1/120, input=g.input, w=g.worldRef
        input.setVirtual('light',true)
        for(let i=0;i<22;i++){
          w.time=3+i*dt
          p.update(dt,w);if(!i) input.setVirtual('light',false);input.endFrame(dt)
        }
        if(!p.action?.def?.id)throw Error('No strike pose')
        g.fx.clear()
        Object.assign(c,{...start,x:hero-20,y:innerWidth<innerHeight?-218:-193,zoom:innerWidth<innerHeight?1.12:1.14,rot:0})
        paint()
        return {actor:actor(), id:p.action.def.id, time:p.animator.getTime(), x:p.x, frame:g.graphicsPresentation().frame}
      }
    }
    return pre
  },expected)
  const shot=async name=>{await frames();await page.screenshot({path:join(dir,`${name}.png`),captureBeyondViewport:false})}
  await shot('metro')
  await page.evaluate(()=>window.pureBridgeQA.actor(false));await shot('metro-no-player')
  await page.evaluate(()=>{window.pureBridgeQA.actor(true);window.pureBridgeQA.glass(false)});await shot('metro-no-glass')
  await page.evaluate(()=>window.pureBridgeQA.glass(true))
  const sky={}
  for(const name of ['fixed','pan','later']){
    const {png,...state}=await page.evaluate(n=>window.pureBridgeQA.material(n),name)
    await writeFile(join(dir,`sky-${name}.png`),Buffer.from(png,'base64'));sky[name]=state
  }
  await page.evaluate(()=>window.pureBridgeQA.material('fixed'))
  const strike = await page.evaluate(()=>window.pureBridgeQA.attack())
  await shot('strike')
  await page.evaluate(()=>window.pureBridgeQA.actor(false));await shot('strike-no-player')
  if(verify){
    assert.deepEqual(sky.fixed.cloud,sky.pan.cloud,'camera translation/zoom must not move either optical cloud deck')
    assert.deepEqual(sky.fixed.atmo.moonCss,sky.pan.atmo.moonCss)
    assert.notDeepEqual(sky.fixed.phase,sky.later.phase,'baked weather phases must evolve on the run clock')
    assert.equal(sky.fixed.atmo.parallax,0)
    assert.ok(metro.glass.baked >= 1,'admit a baked specular environment')
  }
  return {path:expected, viewport:page.viewport(), receipt:{metro,strike},sky}
})
