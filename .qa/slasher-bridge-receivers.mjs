/** Real catwalk / cargo tops, road beneath and dry jamb. Matched poses,
 * only the direct/static and sole terms ablated, readback in QA only. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { touch, viewport, withBridge } from './bridge-browser.mjs'

const canvas = process.argv.includes('--canvas'), opt = touch || process.argv.includes('--optimized')
// A bright lunar phase gives a measurable road witness on 8-bit Canvas,
// without forcing a synthetic light or changing the played route.
const seed = canvas ? 52 : 48
const mode = canvas ? 'mobile-canvas' : opt ? 'mobile-webgl2' : 'master-webgl2', shots = process.env.SR_SHOTS
if (shots) await mkdir(shots, {recursive:true})
await withBridge(async ({page,open,wait,button,phase}) => {
  if (!touch) await page.setViewport({...viewport,width:868,height:552})
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV:3,quality:'ultra',adaptiveQuality:false,muted:true })))
  await open()
  await page.evaluate(({canvas,opt,seed}) => {
    const g=window.__sr, request=g.requestRun.bind(g)
    if(!canvas)g.allowDiagnosticMaster()
    if(opt)g.preferDiagnosticMobile()
    g.requestRun=sword=>{const ok=request(sword);if(ok)g.pendingRun.seed=seed;return ok}
  },{canvas,opt,seed})
  await button('ENGAGE'); await phase('playing'); await wait(mode=>window.__sr.graphicsPresentation().path===mode,mode)
  const { png,...r }=await page.evaluate(async ({mode,touch,save,seed})=>{
    const g=window.__sr,{cam,renderer:r}=g,f=r.bridgeField,b=f.sacr,pipe=r.bridgeFinish.pipe,gl=pipe?.gl,hdr=pipe?.mode==='master'
    cancelAnimationFrame(g.raf);g.qaMode=true;g.streamQuiet=true;g.enemies.length=g.props.props.length=0
    g.fx.clear();g.projectiles.clear();g.banner=null;g.hitstopT=0
    g.time=g.renderTime=8.75;g.bg.routeTime=()=>28;g.bg.routeDrift=()=>12;g.bg.lightningI=()=>0
    const weather=g.bg.routeWeather.clock.sample;Object.assign(weather,{wet:0,rain:0,fog:.20,cloud:.12,key:1})
    if(g.pickups) g.pickups.draw=()=>{}
    const p=g.player=new g.player.constructor(), png={}
    const pose=(x,y,focus=x)=>{
      p.reset(x);p.floorY=p.y=y
      cam.startOnRoad(focus);Object.assign(cam,{x:focus,y:-103,zoom:touch?1.19:1.38,rot:0,offX:0,offY:0});g.bg.syncCutaway(x,y,1)
    }
    const paint=()=>{
      g.paint(0,false)
      if(g.graphicsPresentation().path!==mode)throw Error('Wrong renderer: '+JSON.stringify(g.graphicsPresentation()))
    }
    const sync=async()=>{
      g.streamQuiet=true
      const end=performance.now()+50_000
      for(;;){
        paint()
        const s=g.bg.bridgeStream(), w=f.probeWindow; const cs=[...g.route.between(f.view.left,f.view.right)]
        if(w&&f.view.left>=w.origin&&f.view.right<=w.origin+w.width&&(!pipe||pipe.transportWindow(seed)===s.window&&pipe.receipt().stratumA.live)&&cs.every(c=>s.plate(c.index,!pipe))) {g.streamQuiet=false;return}
        if(performance.now()>end)throw Error('No fully baked receiver: '+JSON.stringify(g.graphicsPresentation()))
        await new Promise(r=>setTimeout(r,16))
      }
    }
    g.setDiagnosticRenderScale(1.25)
    const seal=b.seal.bind(b), routeCast=r.routeCast.bind(r), shade=r.shade.bind(r)
    const shot=(name,direct=true,sole=true)=>{
      if(pipe)b.seal=()=>{seal();if(!direct)b.casters=0;if(!sole)b.packet.u32.fill(0,544,608)}
      else {
        r.routeCast=direct?routeCast:()=>({gain:0,slope:0})
        r.shade=(...args)=>{if(!sole)args[10]=true;return shade(...args)}
      }
      paint()
      const target=pipe?.canvas??g.canvas,w=target.width,h=target.height
      if(save&&name)png[name]=target.toDataURL().split(',')[1]
      let data
      if(!pipe)data=g.ctx.getImageData(0,0,w,h).data
      else {
        data=hdr?new Float32Array(w*h*4):new Uint8Array(w*h*4)
        gl.bindFramebuffer(gl.FRAMEBUFFER,pipe.scene.fbo);gl.readPixels(0,0,w,h,gl.RGBA,hdr?gl.FLOAT:gl.UNSIGNED_BYTE,data);gl.bindFramebuffer(gl.FRAMEBUFFER,null)
      }
      return {w,h,data}
    }
    const meter=(a,c,where)=>{
      const grey=(d,i)=>(d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722)/(hdr?1:255)
      const {w,h}=a, zones={}
      for(let j=0;j<h;j++){
        const wy=cam.y+((j+.5)/h-.5)*g.cssH/cam.zoom, row=(gl?h-1-j:j)*w
        for(let i=0;i<w;i++){
          const wx=cam.x+((i+.5)/w-.5)*g.cssW/cam.zoom, k=(row+i)*4
          const gain=grey(c.data,k)-grey(a.data,k)
          if(gain<.0012)continue
          const zone=where(wx,wy), n=zones[zone]??={n:0, sum:0, max:0, minX:wx, maxX:wx, minY:wy, maxY:wy}
          n.n++;n.sum+=gain;n.max=Math.max(n.max,gain)
          n.minX=Math.min(n.minX,wx);n.maxX=Math.max(n.maxX,wx);n.minY=Math.min(n.minY,wy);n.maxY=Math.max(n.maxY,wy)
        }
      }
      return zones
    }
    const chunks=[...g.route.between(0,24_000)], stacks=[]
    for(const role of ['catwalk','cargo']){
      const c=chunks.find(c=>c.role===role), deck=c.platform,
        x=deck.left+(deck.right-deck.left)*.39, dx=role==='catwalk'?23:21, dy=role==='catwalk'?-14:-12
      pose(x,deck.y,x+48);await sync()
      // Separate the receiver's flat top from both the facade and empty
      // space at the leading/return edges. Allow 1.75 world px for AA.
      const classify=(x,y)=>{
        if(y>=-52.9&&y<=52.9)return 'road'
        const v=(y-deck.y)/dy, l=deck.left+v*dx,r=deck.right+v*dx
        if(v>=0&&v<=1&&x>=l&&x<r)return 'top'
        if(v>=-.18&&v<=1.18&&x>=l-2.8&&x<r+2.8)return 'edgeAA'
        if(y>deck.y&&y<deck.y+20&&x>deck.left&&x<deck.right+dx)return 'fascia'
        return 'other'
      }
      const at=()=>[p.x,p.y,p.floorY,p.hipY,p.geom.toeL.x,p.geom.toeR.x,g.time]
      const before=at(), all=shot(`${role}-grounded`), contact=shot(null,false), off=shot(null,false,false)
      const cast=meter(all,contact,classify), soles=meter(contact,off,classify), same=before.every((v,i)=>v===at()[i]), b2=f.probeWindow.id
      pose(deck.right-3,deck.y,deck.right-24)
      await sync()
      const edgeAll=shot(`${role}-lip`), lip=shot(null,false), unseated=shot(null,false,false)
      const edge=meter(lip,unseated,classify), edgeCast=meter(edgeAll,lip,classify)
      // Raise the same rig above the slab. The cast must move to the
      // exposed part of the asphalt independently of the planted sole.
      pose(x,deck.y,x+125); p.y-=28; await sync()
      const lifted=shot(null), liftedOff=shot(null,false)
      const airCast=meter(lifted,liftedOff,classify)
      stacks.push({role,cast,soles,edge,edgeCast,airCast,same,x,window:b2})
    }
    const s=g.route.chunk(0).shelter;pose(s.left+159,0,s.left+99);await sync()
    const region=(x,y)=>y>=-51&&y<=51?x>=s.left+.85&&x<s.right-.85?'dry':'open':'other'
    const under=shot('dry-eave'), underOff=shot(null,false), lit=meter(under,underOff,region)
    weather.key=0
    const noMoon=shot(null), noMoonOff=shot(null,false), dry=meter(noMoon,noMoonOff,region)
    // The same local source lights the exterior and the near jamb, not the
    // road behind it. The field's clip is independent of wetness and contact.
    const source=g.fx.bridgeEmitters
    g.fx.bridgeEmitters=frame=>frame.light(3,s.left-45,-58,205,'#65ceff',2.7,10,s.left-45,-58,0,0)
    const pulse=shot('eave-blocked-impact',false,false), sourceID=f.mobileFlashIndices[0]
    const receiver={r:0,g:0,b:0,strength:0,dx:0,dy:0,dz:0,strike:0,strikeX:0,strikeY:0}
    const blocked=f.receive(s.left+38,-26,45,receiver,sourceID).strength
    const outside=f.receive(s.left-55,-26,45,receiver,sourceID).strength
    g.fx.bridgeEmitters=source
    const dark=shot('eave-impact-off',false,false)
    const eave={lit,dry,wetness:g.bg.surfaceWetness(p.x),blocked,outside,impact:meter(dark,pulse,(x,y)=>y>=-49&&y<=47&&x>s.left-118&&x<s.left+100?(x>=s.left+25?'inside':x>=s.left+21?'edgeAA':'litApproach'):'other')}
    // Use the authored service-bay tungsten for a positive dry direct-light
    // witness. The concourse pose above can sit in bounce alone.
    const service=chunks.find(c=>c.shelter?.kind==='service').shelter
    pose(service.left+120,0);weather.key=0;weather.wet=.78;await sync()
    const dryRegion=(x,y)=>y>=-51&&y<=51&&x>=service.left+24&&x<service.right-24?'interior':'other'
    const serviceOn=shot('dry-service-cast'), serviceOff=shot(null,false)
    const serviceCast={x:p.x,moon:weather.key,wetness:g.bg.surfaceWetness(p.x),exposedWetness:g.bg.surfaceWetness(service.left-48),loss:meter(serviceOn,serviceOff,dryRegion)}
    b.seal=seal; r.routeCast=routeCast;r.shade=shade
    const receipt={mode,seed,stacks,eave,serviceCast,glError:gl?.getError()??0}
    g.destroy();return {...receipt,stores:g.resourceSnapshot().surfaces,png}
  },{mode,touch,save:!!shots,seed})
  if(process.env.SR_RAW_REPORT)await writeFile(process.env.SR_RAW_REPORT,JSON.stringify(r,null,2)+'\n')
  if(shots)for(const [name,b64] of Object.entries(png))await writeFile(resolve(shots,`${name}.png`),Buffer.from(b64,'base64'))
  for(const p of r.stacks){
    assert.ok(p.same&&p.cast.top?.n>10&&p.soles.top?.n>16&&(p.cast.road?.n??0)+(p.edgeCast.road?.n??0)+(p.airCast.road?.n??0)>10,JSON.stringify(r))
    for(const q of [p.cast,p.soles,p.edge,p.edgeCast,p.airCast]) {
      assert.equal(q.fascia?.n??0,0,JSON.stringify(r))
      // Isolated one-code-value native tessellation/float noise isn't
      // a patch on an invalid receiver. Keep a separate strict fascia test.
      assert.ok((q.other?.sum??0)<.075&&(q.other?.max??0)<.018,JSON.stringify(r))
    }
    assert.equal(p.soles.road?.n??0,0,JSON.stringify(r));assert.equal(p.edge.road?.n??0,0,JSON.stringify(r))
  }
  assert.equal(r.eave.wetness,0);assert.equal(r.eave.blocked,0);assert.ok(r.eave.outside>0)
  // The moon is not an eligible direct light under either shelter.
  assert.ok(Math.abs((r.eave.lit.dry?.sum??0)-(r.eave.dry.dry?.sum??0))<.01,JSON.stringify(r.eave))
  const service=r.serviceCast
  assert.ok(service.loss.interior?.n>20&&service.wetness===0&&service.exposedWetness>.3,JSON.stringify(service))
  assert.ok(r.eave.impact.litApproach?.n>32&&!(r.eave.impact.inside?.n>0),JSON.stringify(r.eave))
  assert.ok((r.eave.impact.edgeAA?.max??0)<r.eave.impact.litApproach.max,JSON.stringify(r.eave))
  assert.deepEqual([r.glError,r.stores],[0,0]);return r
})
