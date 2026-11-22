/** Packaged v4 app, no Playwright. The tests hold real Worker replies and
 * read the active driver's textures, rather than substituting mock pixels. */
import assert from 'node:assert/strict'
import { touch, withBridge, viewport } from './bridge-browser.mjs'

const denied = process.argv.includes('--denied')
await withBridge(async ({ page, open, button, phase, wait }) => {
  if (!touch) await page.setViewport({ ...viewport, width: 736, height: 460 })
  await page.evaluateOnNewDocument(denied => {
    localStorage.setItem('sr_settings_v1', JSON.stringify({ qualityV: 3, quality: 'ultra', adaptiveQuality: false, showFps: true, muted: true }))
    if (!denied) return
    const Worker = window.Worker
    window.Worker = class extends Worker {
      constructor(url, options) {
        if (options?.name === 'bridge-bake' || options?.name === 'bridge-art') throw new DOMException('QA Worker denial', 'SecurityError')
        super(url, options)
      }
    }
  }, denied)
  const urls = []
  page.on('response', r => { if (/\/(?:turbopack-worker|bridge\/baked-v1)/.test(r.url())) urls.push([r.status(), new URL(r.url()).pathname]) })
  await open()
  await page.evaluate(({ touch, denied }) => {
    const g = window.__sr
    if (touch) g.preferDiagnosticMobile()
    if (!denied) g.allowDiagnosticMaster()
    const request = g.requestRun.bind(g)
    g.requestRun = sword => { const go = request(sword); if (go) g.pendingRun.seed = 42; return go }
    g.player.takeDamage = () => false
  }, { touch, denied })
  await button('ENGAGE'); await phase('playing')
  if (!denied) await wait(() => window.__sr.renderer.bridgeFinish.pipe?.transportWindow(42))
  const result = await page.evaluate(async ({ touch, denied }) => {
    const g = window.__sr, f = g.renderer.bridgeField, s = g.bg.bridgeStream(), cfg = () => g.renderConfig
    cancelAnimationFrame(g.raf); g.enemies.length = g.props.props.length = 0; g.fx.clear(); g.hitstopT = 0; g.streamQuiet = true
    const invariant = (c, label) => { if (!c) throw Error(label) }
    const sleep = (t = 15) => new Promise(done => setTimeout(done, t))
    const paint = () => g.paint(0, false)
    const renderReceipt = () => g.resourceSnapshot().presentation
    if (denied) {
      paint()
      const r = s.receipt(), presentation = renderReceipt()
      const pixels = g.ctx.getImageData(Math.round(g.canvas.width*.5), Math.round(g.canvas.height*.62), 12, 12).data
      invariant(r.error?.includes('QA Worker denial') && !r.worker && !r.plateWorker && !s.window, 'Denied workers did not fail closed')
      invariant(presentation.path === 'mobile-canvas' && pixels.some((v,i) => i%4!==3 && v > 12), 'Worker denial discarded Canvas scenery')
      return { denied, stream: r, rendered: true, presentation, config: cfg() }
    }
    const { cssW: w, cssH: h } = g, p = g.renderer.bridgeFinish.pipe, gl = p.gl, e = p.transport
    g.bg.routeTime = () => 17.9; g.bg.lightningI = () => 0
    g.bg.weatherState = () => ({ wet: 0, rain: 0, cloud: .21, key: 1, fog: .2, windX: 0 })
    const rig = x => {
      g.player.reset(x - 84); g.cam.startOnRoad(x)
      Object.assign(g.cam, { x, y: -121, zoom: 1.08, rot: .027, offX: 0, offY: 0 })
    }
    const rc = () => p.receipt().transport
    const spin = async (check, reason, repaint = true) => {
      const t = performance.now()
      while (!check()) {
        if (performance.now() - t > 32_000) throw Error(`${reason}: ${JSON.stringify([s.receipt(), rc()])}`)
        await sleep(); if (repaint) paint()
      }
    }
    const prior = p.transportWindow(42)
    const job = s.optics.worker, handler = job.onmessage, held = []
    invariant(job && handler, 'Packaged module worker not loaded')
    job.onmessage = v => held.push(v)
    const later = [...g.route.between(9200, 18_800)].find(c => c.shelter?.kind === 'service').shelter
    rig(later.terminal); paint()
    await spin(() => held.some(r => r.data.type === 'window'), 'Delayed worker did not return', false)
    // Old GPU origin/curb records remain active while a new reply is held.
    const delayed = { id: p.transportWindow(42)?.id, origin: rc().origin, upload: rc().uploadThisFrame, held: held.length }
    invariant(p.transportWindow(42) === prior && !rc().uploadThisFrame, 'Partial late window replaced the previous group')
    job.onmessage = handler
    for (const event of held) handler.call(job, event)
    const w2 = s.window
    invariant(w2?.id !== prior.id && w2?.architecture.some(Boolean), 'No new window/portal records')
    const begin = rc().uploads, rows = []
    g.hitstopT = .09; paint(); rows.push(['hitstop', rc().uploadThisFrame, rc().quietDeferrals])
    g.hitstopT = 0; g.player.enterParry(g.worldRef); paint(); rows.push(['parry', rc().uploadThisFrame, rc().quietDeferrals])
    invariant(g.player.state === 'parry' && rc().uploads === begin && rows.every(r => r[1] === 0), 'Admitted upload on hitstop/parry')
    g.player.state = 'idle'
    for (let i = 0; i < p.receipt().transport.levels; i++) {
      paint()
      const step = rc()
      rows.push(['quiet', step.uploadThisFrame, step.stagingLevel, step.active, step.origin])
      invariant(step.uploadThisFrame === 1, 'Texture budget exceeded or not progressed')
      invariant(p.transportWindow(42) === (i+1 === step.levels ? w2 : prior), 'Non-atomic texture/portal swap')
    }
    const words = f.sacr.packet.u32.subarray(416, 544)
    invariant(w2.architecture.every((v, i) => words[i] === v), 'Swapped texture did not swap portal words')
    const center = Math.floor((later.terminal - w2.origin) / w2.width * w2.light[0].w), row = 112
    const read = (() => {
      const compile = (type, src) => {
        const obj = gl.createShader(type); gl.shaderSource(obj, src); gl.compileShader(obj)
        invariant(gl.getShaderParameter(obj, gl.COMPILE_STATUS), gl.getShaderInfoLog(obj)); return obj
      }
      const vert = compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}')
      const frag = compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;uniform sampler2D tex;uniform ivec2 xy;uniform int level;out vec4 color;void main(){color=texelFetch(tex,xy,level);}')
      const program = gl.createProgram();gl.attachShader(program,vert);gl.attachShader(program,frag);gl.linkProgram(program)
      invariant(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program))
      const rt = gl.createTexture(), fb = gl.createFramebuffer()
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,rt);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,1,1)
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,rt,0)
      invariant(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Probe framebuffer incomplete')
      gl.viewport(0,0,1,1);gl.disable(gl.BLEND);gl.disable(gl.SCISSOR_TEST);gl.bindVertexArray(p.vao);gl.useProgram(program)
      const group = e.group, out = new Uint8Array(4), measure = (texture,x,y,level=0) => {
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture)
        gl.uniform1i(gl.getUniformLocation(program,'tex'),0);gl.uniform2i(gl.getUniformLocation(program,'xy'),x,y)
        gl.uniform1i(gl.getUniformLocation(program,'level'),level);gl.drawArrays(gl.TRIANGLES,0,3)
        gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);return [...out]
      }
      const x = Math.max(0, center), at=(row*w2.light[0].w+x)*4
      const shadow = measure(group.env,x,row), expectedShadow = [...w2.shadow.subarray(at,at+4)]
      const levels = w2.light.map((m,l) => {
        const rx=x>>l, ry=row>>l, bits=m.data[ry*m.w+rx], k=2**((bits>>>27)-24)
        return [measure(group.light,rx,ry,l).slice(0,3), [bits&511,bits>>>9&511,bits>>>18&511].map(v=>Math.min(255,Math.round(v*k*255)))]
      })
      const vg = (() => {
        const i = w2.vectors.findIndex((_,i,a) => i%4===0 && a[i+1]>20 && a[i+3]>10)
        invariant(i>=0,'No two-light cell in sampled GPU window')
        return [measure(group.grid, i/4%512, Math.floor(i/4/512)), [...w2.vectors.subarray(i,i+4)]]
      })()
      gl.useProgram(null); gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.deleteProgram(program);gl.deleteShader(vert);gl.deleteShader(frag)
      gl.deleteFramebuffer(fb);gl.deleteTexture(rt)
      const maxError=Math.max(...[[shadow,expectedShadow],vg,...levels].flatMap(([a,b])=>a.map((v,i)=>Math.abs(v-b[i]))))
      return {shadow, expectedShadow, grid:vg, levels, maxError, glError:gl.getError()}
    })()
    invariant(read.maxError <= 1 && read.glError === 0 && read.shadow[0] === 0 && read.levels[0][0][0] > 30, 'Uploaded texels or sheltered tungsten do not match the CPU words: '+JSON.stringify(read))
    // Confirm a real FX impact follows the same light packet, aperture and
    // decay used during play, with a cold road ROI on the opposite side.
    const cat = [...g.route.between(later.right+500,later.right+6400)].find(c => c.role === 'catwalk').platform
    const source = (cat.left+cat.right)*.5, sy = cat.y-12
    rig(source+34);paint()
    await spin(() => s.window && p.transportWindow(42)===s.window && source>s.window.origin && source<s.window.origin+s.window.width, 'Catwalk window did not commit')
    const target=p.scene, pixel=(x,y) => {
      const cam=f.cam,dx=x-cam.x,dy=y-cam.y,c=Math.cos(cam.rot),sn=Math.sin(cam.rot),float=p.mode==='master'
      const ix=Math.floor(target.width*(.5+(dx*c-dy*sn)*cam.zoom/w)),iy=Math.floor(target.height*(.5-(dx*sn+dy*c)*cam.zoom/h))
      invariant(ix>=0&&ix<target.width&&iy>=0&&iy<target.height,'Offscreen sample')
      const v=float?new Float32Array(4):new Uint8Array(4)
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);gl.readPixels(ix,iy,1,1,gl.RGBA,float?gl.FLOAT:gl.UNSIGNED_BYTE,v)
      return (.2126*v[0]+.7152*v[1]+.0722*v[2])/(float?1:255)
    }
    // Measure a patch of asphalt under the slab, not four texels along
    // one line. Static lighting and the surface grain can push some Mobile
    // samples to either side of an 8-bit rounding boundary.
    const roi=[-45,-41,-37,-33,-29,-25,-21].flatMap(y=>[-10,-6,-2,2,6,10,14,18].map(dx=>[source+dx,y]))
    const road = () => {
      gl.bindVertexArray(p.vao);gl.disable(gl.BLEND);p.ground(f,w,h,target)
      return roi.map(([x,y])=>pixel(x,y))
    }
    const baseline=road()
    g.fx.impact(source,sy,.2,true,'#ffc58b','#e7c3a4');g.fx.bridgeEmitters(f)
    const covered=road(), admitted=f.impulseCount, traced=roi.every(([x,y])=>!f.transmitted(x,y,source,sy))
    const keep=f.blockers.filter(b=>b.kind!=='catwalk')
    f.blockerCount=keep.length;f.blockerData.fill(0)
    for(const [i,b] of keep.entries()) f.blockerData.set([b.left-f.cam.x,b.top,b.right-f.cam.x,b.bottom],i*4)
    gl.bindBuffer(gl.UNIFORM_BUFFER,p.ubo);gl.bufferSubData(gl.UNIFORM_BUFFER,3072,f.blockerData)
    const exposed=road(), firstGain=f.impulseGain
    const mean=a=>a.reduce((v,x)=>v+x,0)/a.length
    const maxLeak=Math.max(...covered.map((x,i)=>Math.abs(x-baseline[i])))
    const master = p.mode === 'master'
    const changed=exposed.filter((x,i)=>x-covered[i]>(master?.0012:.0006)).length
    const [base,blocked,open]=[baseline,covered,exposed].map(mean)
    g.fx.update(.068,.068);paint();const decay=f.impulseGain
    g.fx.update(.076,.076);paint();const ended=f.impulseCount
    const fx={base,blocked,open,samples:roi.length,maxLeak,changed,admitted,traced,firstGain,decay,ended,glError:gl.getError()}
    // Require both a meaningful average lift and multiple texels above
    // the tier-specific threshold; no texel may leak in the blocked case.
    invariant(admitted===1&&traced&&maxLeak<.0002&&changed>=8&&open>blocked+.00035&&open>blocked*(master?1.12:1.07) && firstGain>decay && decay>.06 && ended===0, 'Actual hit emission was not occluded/short: '+JSON.stringify(fx))

    // A repeated seed is still a new route lifetime. Hold a real reply at
    // a different address while retiring the route, then deliver it late.
    const sameOld = p.transportWindow(42), beforeStale = s.receipt().stale
    held.length = 0; job.onmessage = event => held.push(event)
    s.requestWindow(24000, 25100, 24400)
    await spin(() => held.some(event => event.data.type === 'window'), 'No in-flight reply to retire', false)
    g.resetRoute(42); g.bg.setRunSeed(42)
    invariant(s === g.bg.bridgeStream() && job === s.optics.worker && !s.window && !p.transportWindow(42) && !rc().staging && !p.skyFrame, 'Same seed retained old addresses')
    job.onmessage = handler
    for (const event of held) handler.call(job, event)
    invariant(!s.window && s.receipt().stale > beforeStale, 'A retired same-seed reply was accepted')
    rig(306); paint()
    await spin(() => p.transportWindow(42), 'Same seed did not reacquire')
    const sameNew = p.transportWindow(42)
    invariant(sameNew.id !== sameOld.id && sameNew.origin < sameOld.origin - 1000, 'Repeated seed did not own its new view')
    const sameSeed = { previous: sameOld.id, active: sameNew.id, origin: sameNew.origin, stale: s.receipt().stale - beforeStale, keptWorker: job === s.optics.worker }

    // Changing seed must invalidate the worker and all resident optical
    // coordinates. The requested Master preset survives the transition.
    g.resetRoute(43);g.bg.setRunSeed(43);rig(306);paint()
    invariant(!p.transportWindow(43) && f.probeWindow===null, 'Previous run light/address reused')
    await spin(() => p.transportWindow(43), 'New seed did not commit')
    const seedSwap = { id: p.transportWindow(43).id, seed: p.transportWindow(43).seed, previousOrigin: w2.origin, origin: rc().origin, visualBand: g.route.chunk(0).visualBand }
    const reset = gl.getExtension('WEBGL_lose_context'), expected = touch ? 'mobile-webgl2' : 'master-webgl2'
    let recovery = null
    if (reset) {
      reset.loseContext(); await spin(() => !g.renderer.bridgeFinish.pipe, 'WebGL context loss not handled')
      paint();const loss=renderReceipt();invariant(loss.path==='mobile-canvas'&&cfg().renderScale>=1.25,'Context loss changed lock or left stale GL above Canvas')
      await sleep(100);reset.restoreContext()
      await spin(() => renderReceipt().path===expected && g.renderer.bridgeFinish.pipe?.transportWindow(43), 'WebGL restore did not rebuild the matching seed')
      recovery = { loss: loss.path, restored: renderReceipt().path, seed: g.renderer.bridgeFinish.pipe.transportWindow(43).seed }
    }
    return { denied, mode:renderReceipt().path, delayed, admission:rows, sameSeed, swap:seedSwap, read, fx, recovery, config:cfg(), final:renderReceipt() }
  }, { touch, denied })
  assert.equal(result.config.preset, 'ULTRA'); assert.equal(result.config.adaptiveEnabled, false); assert.ok(result.config.renderScale >= 1.25)
  if (!denied) {
    assert.equal(result.mode, touch ? 'mobile-webgl2' : 'master-webgl2')
    assert.ok(result.recovery && result.recovery.seed === 43)
    assert.ok(urls.some(([s, path]) => s === 200 && path.includes('turbopack-worker')))
  }
  return { ...result, requestedAssets: urls }
})
