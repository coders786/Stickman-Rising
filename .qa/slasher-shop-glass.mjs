// Compare real composed frames with the receiver enabled/disabled. QA alone
// reads pixels. The renderer never samples a screen or an actor backing.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withBridge, touch, viewport } from './bridge-browser.mjs'

const canvas = process.argv.includes('--canvas'), optimized = process.argv.includes('--optimized') || touch
const denyCity = process.argv.includes('--deny-city'), denied = process.argv.includes('--deny-worker'), shots = process.env.SR_SHOTS
const baseline = process.argv.includes('--baseline'), bench=process.argv.includes('--bench'), opticsShots=process.argv.includes('--optics-shots')
const wetShot = process.argv.includes('--wet-shot'), path = canvas ? 'mobile-canvas' : optimized ? 'mobile-webgl2' : 'master-webgl2'
if (shots) await mkdir(shots,{recursive:true})
await withBridge(async ({page,open,button,phase,wait,frames}) => {
  if (!touch) await page.setViewport({...viewport,width:984,height:610})
  await page.evaluateOnNewDocument(({canvas,denied}) => {
    localStorage.setItem('sr_settings_v1',JSON.stringify({qualityV:3,quality:canvas?'high':'ultra',adaptiveQuality:false,muted:true,shake:false}))
    if (denied) {
      const WorkerClass=window.Worker
      window.Worker=new Proxy(WorkerClass,{construct(Worker,args){
        if(args[1]?.name?.startsWith('bridge-')) throw new DOMException('QA worker unavailable','SecurityError')
        return new Worker(...args)
      }})
    }
  },{canvas,denied})
  const obsolete = []
  page.on('request',r=>{ if (/\/survey-mirror\.|\/shop-return-v1\./.test(r.url())) obsolete.push(r.url()) })
  if (denyCity) {
    await page.setRequestInterception(true)
    page.on('request',r=>/\/bridge\/(l2|shop-return-v2)\.webp$/.test(r.url())?r.respond({status:404,body:'no bank art'}):r.continue())
  }
  await open()
  await page.evaluate(({canvas,optimized})=>{
    const g=window.__sr, request=g.requestRun.bind(g)
    if(!canvas)g.allowDiagnosticMaster()
    if(!canvas&&optimized)g.preferDiagnosticMobile()
    g.requestRun=sword=>{const ok=request(sword);if(ok)g.pendingRun.seed=42;return ok}
  },{canvas,optimized})
  await button('ENGAGE');await phase('playing')
  await wait(()=>window.__sr.time>.09)
  const actual=await page.evaluate(()=>window.__sr.graphicsPresentation())
  assert.equal(actual.path,path,actual.reason)
  if(shots)await wait(()=>!document.querySelector('.sr-ronin-reveal, .sr-crossing-online'))
  await page.evaluate(()=>{
    const g=window.__sr, r=g.renderer, {cam,player:p}=g, glass=r.glass, f=r.bridgeField
    cancelAnimationFrame(g.raf);g.qaMode=true;g.streamQuiet=true;g.enemies.length=0;g.fx.clear();g.hitstopT=0
    g.time=g.renderTime=8.75;g.bg.routeTime=()=>28;g.bg.routeDrift=()=>12;g.bg.lightningI=()=>0
    Object.assign(g.bg.routeWeather.clock.sample,{cloud:.34,fog:.21,rain:0,wet:0})
    const draw=glass.draw.bind(glass)
    let chunk, x
    const geometry = () => {
      const o=glass.openings.get(chunk)
      if(!o)throw Error('shop not in view')
      const front=o.front, panes = front.panes.map(p=>({...p,left:p.left+front.x,right:p.right+front.x}))
      return {area:o.area,panes,front}
    }
    const compare = (a,b) => {
      let count=0,sum=0,peak=0
      for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2,3].map(k=>Math.abs(a[i+k]-b[i+k])));count+=+(d>=2);sum+=d;peak=Math.max(peak,d)}
      return {count,sum,peak}
    }
    function composedProof(mode) {
      const {area,panes}=geometry(), pipe=r.bridgeFinish.pipe, out=pipe?.canvas??g.ctx.canvas, w=out.width, h=out.height
      const tx=new DOMMatrix().scale(w/g.cssW,h/g.cssH).translate(g.cssW*.5,g.cssH*.5)
        .rotate((cam.rot??0)*180/Math.PI).scale(cam.zoom).translate(-cam.x,-cam.y), inv=tx.inverse()
      const corners=[new DOMPoint(area.left,area.top),new DOMPoint(area.left,area.bottom),new DOMPoint(area.right,area.top),new DOMPoint(area.right,area.bottom)].map(p=>p.matrixTransform(tx))
      const left=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x)))-9),top=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y)))-9)
      const right=Math.min(w,Math.ceil(Math.max(...corners.map(p=>p.x)))+9),bottom=Math.min(h,Math.ceil(Math.max(...corners.map(p=>p.y)))+9)
      const bw=right-left,bh=bottom-top,stride=bw*4
      const pixels = show => {
        glass.draw=show?draw:()=>glass.reset()
        if(!g.paint(0,false))throw Error('no complete frame')
        if(!pipe)return g.ctx.getImageData(left,top,bw,bh).data
        const gl=pipe.gl, raw=new Uint8Array(bw*bh*4), flip=new Uint8Array(raw.length)
        gl.bindFramebuffer(gl.FRAMEBUFFER,null)
        gl.readPixels(left,h-bottom,bw,bh,gl.RGBA,gl.UNSIGNED_BYTE,raw)
        for(let y=0;y<bh;y++)flip.set(raw.subarray(y*stride,(y+1)*stride),(bh-1-y)*stride)
        return flip
      }
      let a,b
      // Do not stage a different worker window between the matched reads.
      g.streamQuiet=true
      try {a=pixels(false);b=pixels(true)} finally {glass.draw=draw;g.streamQuiet=true}
      let changed=0,leak=0,occluder=0,occluderWitness=0,dividers=0,peak=0,lightened=0,darkened=0,totalDelta=0,any=0
      const paneCounts=panes.map(()=>0), d=Math.max(Math.abs(inv.a),Math.abs(inv.d))*2.2,allPanes=panes.map(()=>0)
      for(let k=0;k<bw*bh;k++) {
        const i=k*4, px=left+k%bw+.5, py=top+(k/bw|0)+.5, {x,y}=new DOMPoint(px,py).matrixTransform(inv)
        const diff=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])))
        const index=panes.findIndex(r=>x>=r.left-d&&x<=r.right+d&&y>=r.top-d&&y<=r.bottom+d)
        if(index>=0&&diff>0)allPanes[index]++
        any+=+(diff>0)
        const p=chunk.platform
        if(mode==='catwalk'&&p&&x>p.right+5&&x<p.right+20&&y>p.y-10&&y<p.y+6&&index>=0){
          occluderWitness++;occluder+=+(diff>=3)
        }
        if(diff<3)continue
        peak=Math.max(diff,peak);totalDelta+=diff;changed++
        const luma = .2126*(b[i]-a[i])+.7152*(b[i+1]-a[i+1])+.0722*(b[i+2]-a[i+2]);lightened+=+(luma>3);darkened+=+(luma< -3)
        if(index<0){leak++;dividers+=+(x>area.left&&x<area.right&&y>area.top&&y<area.bottom)}else paneCounts[index]++
      }
      return {rect:[left,top,bw,bh],changed,leak,dividers,occluder,occluderWitness,peak,lightened,darkened,totalDelta,paneCounts,any,allPanes}
    }
    window.shopQA={
      place(index) {
        chunk=g.route.chunk(index);x=chunk.shelter?chunk.shelter.left+171:chunk.left+Math.floor((chunk.right-chunk.left)*.67)
        p.reset(x-94);cam.startOnRoad(x);cam.setShakeEnabled(false);cam.rot=cam.offX=cam.offY=0
        g.props.setRoute(g.route,x,Infinity);g.paint(0,false)
      },
      frame() {g.paint(0,false);return { glass:glass.receipt(), window:f.probeWindow?.id, path:g.graphicsPresentation().path }},
      weather(wet) {g.bg.routeWeather.clock.sample.wet=wet;g.paint(0,false)},
      shot(mode,roll=false) {
        if(roll){cam.rot=.02;g.paint(0,false)}
        const {area,panes,front}=geometry(), proof=composedProof(mode), s=g.graphicsPresentation()
        const upper=g.project(front.x+front.frame.left,front.frame.top), lower=g.project(front.x+front.frame.right,front.frame.bottom)
        const out={proof,kind:front.kind,active:s.frame,glazing:s.gpu?.glazing,sourceUploadBytes:s.gpu?.uploadBytes,glass:glass.receipt(),geometry:{area,panes},wet:f.wet,
          screen:{upper,lower,pose:g.project(p.x,-85)},camera:{x:cam.x,y:cam.y,zoom:cam.zoom,roll:cam.rot}}
        cam.rot=0
        return out
      },
      differences(gpu) {
        const {area}=geometry(), w=Math.ceil(area.right-area.left)+4, h=Math.ceil(area.bottom-area.top)+4
        const c=new OffscreenCanvas(w,h), ctx=c.getContext('2d',{willReadFrequently:true})
        const render=(hero)=>{
          ctx.resetTransform();ctx.fillStyle='#685f58';ctx.fillRect(0,0,w,h);ctx.translate(2-area.left,2-area.top)
          draw(ctx,f,g.route,gpu,hero)
          if(!gpu)return ctx.getImageData(0,0,w,h).data
          const tile=f.glass?.canvas
          if(!tile)throw Error('no projected coverage')
          return tile.getContext('2d').getImageData(0,0,tile.width,tile.height).data
        }
        const dry=render(), fcam=f.cam, originalWet=f.wet
        f.wet=.93;const wetOnly=compare(dry,render());f.wet=originalWet
        f.cam={...fcam,x:fcam.x+52};const pan=compare(dry,render());f.cam=fcam
        const transport=f.probeWindow, key=f.atmo.key[0], lightning=f.atmo.lightning
        let opened
        if(transport){
          const shadow=new Uint8Array(transport.shadow)
          for(let i=0;i<shadow.length;i+=4)shadow[i]=shadow[i+1]=255
          f.probeWindow={...transport,shadow};f.atmo.key[0]=.82
          const clear=render();f.probeWindow=transport;opened=compare(clear,render())
        }
        f.atmo.key[0]=key
        f.atmo.lightning=()=>.75;const storm=compare(dry,render());f.atmo.lightning=lightning
        const opening=glass.openings.get(chunk), sources=opening.sources
        // Switch the exact admitted finite practicals to zero, without
        // changing ambient incident radiance or repainting the room.
        const off=sources.map(l=>({...l,strength:0}))
        let lamps=compare(dry,dry), lampView=null
        for(const dy of [0,-93,-162]){
          f.cam={...fcam,y:fcam.y+dy}
          const lit=render();opening.sources=off
          let diff;try{diff=compare(lit,render())}finally{opening.sources=sources}
          if(diff.sum>lamps.sum){lamps=diff;lampView=f.cam.y}
        }
        f.cam=fcam
        const px=p.x, py=p.y
        p.x=(area.left+area.right)*.5+18;p.y=-49
        const hero=compare(dry,render(p))
        p.x=px;p.y=py
        return {wetOnly,pan,opened,storm,hero,lamps,lampView,seed:transport?.seed}
      },
      event(mode) {
        const opening=glass.openings.get(chunk), sources=opening.sources
        if(mode==='lamps-off')opening.sources=sources.map(l=>({...l,strength:0}))
        if(mode==='flash')glass.draw=(ctx,frame,route,gpu,hero)=>{
          const old=frame.atmo.lightning;frame.atmo.lightning=()=>.92
          try{draw(ctx,frame,route,gpu,hero)}finally{frame.atmo.lightning=old}
        }
        try{if(!g.paint(0,false))throw Error('No weather witness frame')}
        finally{opening.sources=sources;glass.draw=draw}
      },
      bench() {
        const gl=r.bridgeFinish.pipe?.gl, frames=[]
        try{
          for(let i=0;i<8;i++){
            const enabled=i%4===1||i%4===2
            glass.draw=enabled?draw:()=>glass.reset()
            const start=performance.now()
            if(!g.paint(0,false))throw Error('No benchmark frame')
            const submitted=performance.now();gl?.finish()
            frames.push({enabled,submitMs:submitted-start,drainedMs:performance.now()-start})
          }
        }finally{glass.draw=draw;g.paint(0,false)}
        return frames
      },
      slab() {
        // Serve the exact registered Master/Optimized base program with
        // constant radiances and controlled view angles, not a test shader.
        const pipe=r.bridgeFinish.pipe,{gl}=pipe, prog=pipe.base, textures=[]
        const width=9, uv=6500, distance=550
        function tex(unit,w,h,color) {
          const t=gl.createTexture();textures.push(t)
          gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t)
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST)
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,color&&new Uint8Array(color))
          return t
        }
        const room=[128,102,76,255], reflected=[66,99,132,255]
        tex(0,1,1,room);tex(15,1,1,reflected)
        const target=tex(4,width,1,null), buffer=gl.createFramebuffer()
        gl.bindTexture(gl.TEXTURE_2D,pipe.deck)
        gl.bindFramebuffer(gl.FRAMEBUFFER,buffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0)
        gl.viewport(0,0,width,1);gl.disable(gl.BLEND);gl.bindVertexArray(pipe.vao);gl.useProgram(prog.handle)
        gl.uniform1i(prog.loc('uBase'),0);gl.uniform2f(prog.loc('uView'),uv,1);gl.uniform4f(prog.loc('uCam'),-900,1,1,0);gl.uniform2f(prog.loc('uSkyView'),1,0)
        gl.uniform1i(prog.loc('uBaseProbe'),0);gl.uniform1i(prog.loc('uShopRadiance'),15);gl.uniform1i(prog.loc('uShopFronts'),1)
        gl.uniform4f(prog.loc('uShopBounds[0]'),-5000,-901,5000,-899);gl.uniform1f(prog.loc('uShopDistance[0]'),distance)
        gl.drawArrays(gl.TRIANGLES,0,3)
        const bytes=new Uint8Array(width*4);gl.readPixels(0,0,width,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes)
        const error=gl.getError()
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(buffer);textures.forEach(t=>gl.deleteTexture(t))
        return {error, bytes:[...bytes], width, uv, distance, room, reflected}
      }
    }
  })
  const samples={}
  for (const [index,name] of [[0,'metro'],[5,'market'],[12,'catwalk']]) {
    if (touch && name==='catwalk')continue
    await page.evaluate(index=>window.shopQA.place(index),index)
    if (!denied) {
      await wait(canvas=>{
        const g=window.__sr, stream=g.bg.bridgeStream(), v=g.renderer.bridgeField.view
        return [...g.route.between(v.left,v.right)].every(c=>stream.plate(c.index,canvas))
      },canvas)
      await wait(()=>{
        const g=window.__sr, w=g.bg.bridgeStream().window, v=g.renderer.bridgeField.view
        return w && w.seed===g.route.seed && w.origin<=v.left && w.origin+w.width>=v.right
      })
    }
    const verified = await page.evaluate(async ({denied,denyCity}) => {
      const g=window.__sr
      for (let i=0;i<72;i++) {
        const v=window.shopQA.frame(), w=g.bg.bridgeStream().window
        if ((denied || (v.window===w?.id && v.window!==undefined)) && (denyCity || v.glass.baked)) return v
        await new Promise(done=>requestAnimationFrame(done))
      }
      throw Error('storefront transport did not converge: '+JSON.stringify(g.graphicsPresentation()))
    },{denied,denyCity})
    assert.equal(verified.path,path)
    const sample = await page.evaluate(({name,canvas,baseline})=>({ ...window.shopQA.shot(name,name==='catwalk'), diff:baseline?null:window.shopQA.differences(!canvas) }),{name,canvas,baseline})
    if (shots) {
      await frames();await page.screenshot({path:join(shots,`${name}.png`),captureBeyondViewport:false})
      if(opticsShots && name==='market'){
        for(const mode of ['lamps-off','flash']) {
          await page.evaluate(mode=>window.shopQA.event(mode),mode)
          await frames();await page.screenshot({path:join(shots,`market-${mode}.png`),captureBeyondViewport:false})
        }
        await page.evaluate(()=>window.shopQA.event(null))
      }
      if(wetShot && name==='market'){
        await page.evaluate(()=>window.shopQA.weather(.84))
        await frames();await page.screenshot({path:join(shots,'market-wet.png'),captureBeyondViewport:false})
        await page.evaluate(()=>window.shopQA.weather(0))
      }
    }
    if(bench && name==='market')sample.bench=await page.evaluate(()=>window.shopQA.bench())
    samples[name]=sample
    if(baseline)continue
    if(process.env.SR_QA_TRACE)console.error(JSON.stringify({name,...sample}))
    assert.ok(sample.proof.changed > 500, JSON.stringify(sample))
    assert.equal(sample.proof.leak,0,JSON.stringify(sample.proof))
    assert.equal(sample.proof.occluder,0,'no reflection on the catwalk fascia')
    assert.ok(sample.proof.allPanes.filter(n=>n>50).length>=3,JSON.stringify(sample.proof))
    assert.equal(sample.active.kind,canvas?'canvas':'webgl')
    assert.equal(sample.glass.panes,4)
    if(!canvas)assert.equal(sample.glazing.uploadBytes,sample.glass.fieldBytes)
    if(name==='catwalk')assert.ok(sample.proof.occluderWitness>30 && sample.glass.solids>0,JSON.stringify(sample))
    assert.ok(denyCity?sample.glass.baked===0:sample.glass.baked>=1,JSON.stringify(sample.glass))
    assert.equal(sample.diff.wetOnly.sum,0,'wet road and a frozen atmosphere do not change the glass')
    assert.ok(sample.diff.pan.count>120 && sample.diff.storm.count>100,JSON.stringify(sample.diff))
    if(name==='metro')assert.ok(sample.diff.hero.count>30,JSON.stringify(sample.diff))
    if (!denied) {
      assert.ok(sample.glass.shadeTaps===5 && sample.diff.opened.count>200,JSON.stringify(sample.diff))
      assert.equal(sample.diff.seed,42)
    }
  }
  if(!baseline)assert.ok(Object.values(samples).some(s=>s.diff.lamps.count>30),'projected finite practicals must respond when switched off')
  let slab
  if(!canvas&&!baseline){
    slab=await page.evaluate(()=>window.shopQA.slab())
    assert.equal(slab.error,0)
    const undo=v=>((v/255+.055)/1.055)**2.4
    slab.reference=[]
    for(let i=0;i<slab.width;i++){
      const dx=((i+.5)/slab.width-.5)*slab.uv, angle=Math.atan2(dx,slab.distance), sin=Math.sin(angle)/1.52, ct=Math.sqrt(1-sin*sin), c=Math.cos(angle)
      const a=Math.exp(-4.2*.006/ct), rs=((c-1.52*ct)/(c+1.52*ct))**2, rp=((ct-1.52*c)/(ct+1.52*c))**2
      const per=[rs,rp].map(r=>{const t=(1-r)**2*a/(1-r*r*a*a);return [r+t*r*a,t]})
      const [r,t]=[0,1].map(k=>(per[0][k]+per[1][k])/2)
      const reference=slab.room.slice(0,3).map((v,k)=>Math.round(255*t*undo(v)+r*1.5*slab.reflected[k]))
      slab.reference.push({angle:angle*180/Math.PI,r,t,rgb:reference})
      for(let k=0;k<3;k++)assert.ok(Math.abs(slab.bytes[i*4+k]-reference[k])<=2,JSON.stringify(slab))
    }
  }
  if(!baseline)assert.deepEqual(obsolete,[])
  const stores=await page.evaluate(()=>{const g=window.__sr;g.destroy();return g.resourceSnapshot().surfaces})
  assert.equal(stores,0)
  return {path,canvas,optimized,baseline,denied,denyCity,viewport:page.viewport(),obsolete,stores,samples,slab}
})
