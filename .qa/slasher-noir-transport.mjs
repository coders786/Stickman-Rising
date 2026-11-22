/** Checks real uploaded transport and traces a live source across an authored
 * catwalk. No shaders or diagnostic mutations are routed to the run itself. */
import assert from 'node:assert/strict'
import { withBridge, touch, viewport } from './bridge-browser.mjs'

await withBridge(async ({ page, open, button, phase, wait }) => {
  if (!touch) await page.setViewport({ ...viewport, width: 736, height: 470 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('sr_settings_v1', JSON.stringify({
    qualityV: 3, quality: 'ultra', adaptiveQuality: false, showFps: false, muted: true,
  })))
  await open()
  await page.evaluate(() => {
    const g = window.__sr, request = g.requestRun.bind(g)
    g.allowDiagnosticMaster()
    g.requestRun = sword => { const ok = request(sword); if (ok) g.pendingRun.seed = 42; return ok }
  })
  await button('ENGAGE'); await phase('playing')
  await wait(() => window.__sr.resourceSnapshot().presentation.gpu?.stratumA?.live)
  const result = await page.evaluate(() => {
    const g = window.__sr
    cancelAnimationFrame(g.raf); g.enemies.length = 0; g.props.props.length = 0; g.fx.clear()
    const p = g.renderer.bridgeFinish.pipe, f = g.renderer.bridgeField, gl = p.gl
    const { cssW: w, cssH: h } = g
    const weather = { ...g.bg.weatherState(), key: .96, wet: 0, rain: 0, fog: .24, cloud: .23 }
    g.bg.weatherState = () => weather; g.bg.routeTime = () => 25.2; g.bg.lightningI = () => 0
    const pose = x => {
      g.player.reset(x - 62); g.cam.startOnRoad(x)
      Object.assign(g.cam, { x, y: -120, zoom: 1.04, rot: .037, offX: 0, offY: 0 })
      g.paint(0, false)
      if (p !== g.renderer.bridgeFinish.pipe) throw Error('Unexpected presentation fallback')
    }
    const bay = [...g.route.between(0, 16000)].find(c => c.shelter?.kind === 'service').shelter
    pose(bay.terminal)
    const upload = { maxError: 0, shadow: [], irradiance: [] }
    const compile = (kind, code) => {
      const s = gl.createShader(kind); gl.shaderSource(s, code); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram(), vert = compile(gl.VERTEX_SHADER, `#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`)
    const frag = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; precision highp int; precision highp sampler2D;
      uniform sampler2D uShadow,uLight;uniform ivec2 uXY;uniform int uKind;out vec4 color;
      void main(){color=uKind==0?texelFetch(uShadow,uXY,0):texelFetch(uLight,uXY,0);}`)
    gl.attachShader(prog, vert); gl.attachShader(prog, frag); gl.linkProgram(prog)
    gl.deleteShader(vert); gl.deleteShader(frag)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(prog))
    const tex = gl.createTexture(), fb = gl.createFramebuffer()
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('No readback target')
    gl.viewport(0, 0, 1, 1); gl.bindVertexArray(p.vao); gl.disable(gl.BLEND); gl.useProgram(prog)
    const loc = u => gl.getUniformLocation(prog, u), out = new Uint8Array(4)
    for (const [unit, key, texture] of [[0, 'uShadow', p.env], [1, 'uLight', p.irradiance]]) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(loc(key), unit)
    }
    for (const [worldX, row] of [[bay.terminal, 144], [bay.terminal, 31], [bay.right + 48, 153], [bay.left - 28, 107]]) {
      const col = Math.floor((worldX - f.env.origin) / f.env.width * 1024), at = row * 1024 + col
      gl.uniform2i(loc('uXY'), col, row)
      for (let kind = 0; kind < 2; kind++) {
        gl.uniform1i(loc('uKind'), kind); gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
        const word = f.env.light[at], s = 2 ** ((word >>> 27) - 24)
        const expected = kind ? [(word & 511), (word >>> 9 & 511), (word >>> 18 & 511)].map(v => Math.min(255, Math.round(v * s * 255))) : [...f.env.data.subarray(at * 4, at * 4 + 4)]
        const actual = [...out.slice(0, expected.length)]
        upload.maxError = Math.max(upload.maxError, ...actual.map((v, i) => Math.abs(v - expected[i])))
        ;(kind ? upload.irradiance : upload.shadow).push(actual)
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(null); gl.deleteProgram(prog); gl.deleteFramebuffer(fb); gl.deleteTexture(tex)
    const uploadError = gl.getError()

    const cat = [...g.route.between(0, 21000)].find(c => c.role === 'catwalk'), slab = cat.platform
    const sourceX = (slab.left + slab.right) * .5, camX = slab.right - 102
    pose(camX)
    f.wet = 0
    const target = p.scene, scale = p.mode === 'master' ? 1 : 255
    const pixel = (x, y) => {
      const cam = f.cam, dx = x - cam.x, dy = y - cam.y, cr = Math.cos(cam.rot), sr = Math.sin(cam.rot)
      const ix = Math.floor(target.width * (.5 + (dx * cr - dy * sr) * cam.zoom / w))
      const iy = Math.floor(target.height * (.5 - (dx * sr + dy * cr) * cam.zoom / h))
      if (ix < 0 || iy < 0 || ix >= target.width || iy >= target.height) throw Error('Offscreen transport sample')
      const q = scale === 1 ? new Float32Array(4) : new Uint8Array(4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
      gl.readPixels(ix, iy, 1, 1, gl.RGBA, scale === 1 ? gl.FLOAT : gl.UNSIGNED_BYTE, q)
      return (q[0] + q[1] + q[2]) / (3 * scale)
    }
    const draw = () => {
      gl.bindVertexArray(p.vao); gl.disable(gl.BLEND); p.ground(f, w, h, target)
      return [-8, 0, 8, 16, 24].reduce((v, y) => v + pixel(sourceX + 15, y), 0) / 5
    }
    const noImpulse = draw()
    const above = slab.y - 66, rayBlocked = !f.transmitted(sourceX + 15, 6, sourceX, above)
    const admitted = f.light(3, sourceX, above, 425, '#ffc387', 3.4, 4.5)
    const blocked = draw()
    const keep = f.blockers.filter(b => b.kind !== 'catwalk')
    f.blockerCount = keep.length
    for (const [i, b] of keep.entries()) f.blockerData.set([b.left - camX, b.top, b.right - camX, b.bottom], i * 4)
    const unblocked = draw(), traceError = gl.getError()
    return { tier: p.mode, renderer: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
      upload, uploadError, traceError, rayBlocked, admitted, noImpulse, blocked, unblocked,
      receipts: p.receipt(), config: g.renderConfig }
  })
  assert.equal(result.tier, touch ? 'mobile' : 'master')
  assert.deepEqual([result.uploadError, result.traceError], [0, 0])
  assert.ok(result.upload.maxError <= 1 && result.upload.shadow[0][0] === 0 && result.upload.shadow[0][3] === 0, JSON.stringify(result.upload))
  assert.ok(result.upload.irradiance[0][0] > result.upload.irradiance[0][1] && result.upload.irradiance[0][0] > 20)
  assert.ok(result.rayBlocked && result.admitted && Math.abs(result.blocked - result.noImpulse) < .003 && result.unblocked - result.blocked > .009 && result.unblocked > result.blocked * 1.5, JSON.stringify(result))
  return result
})
