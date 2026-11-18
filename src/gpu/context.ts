/** STICKMAN RISING — src/gpu/context.ts
 * THE BAKE CONTEXT: WebGL2, used ONCE per plate, never per frame.
 * ----------------------------------------------------------------------------
 * The architecture decision (D3/D7 in DECISIONS.md) is deliberately narrow: the
 * GPU is a *baker*, not a renderer. Shaders generate art at boot (moon, star
 * field, sky gradient, cloud atlas), `readPixels` hands the result back to
 * Canvas2D, and the 60/120 Hz frame path keeps doing what it already does well.
 * That buys the crisp procedural detail a shader is good at while keeping the
 * draw-call count, the frame loop and every existing test untouched.
 *
 * What this file is responsible for, and nothing else:
 *  · acquiring a context WITHOUT disturbing the game canvas (a separate,
 *    tiny canvas, dropped after bake);
 *  · compiling/linking with a real error message (a silent shader failure is
 *    the most expensive bug in this whole plan — it looks like "the art is
 *    bad", not like "the shader did not compile");
 *  · surviving context loss: `bake()` returns null on any failure, and every
 *    caller has a Canvas2D path, so a device that loses the context mid-bake
 *    gets the fallback rather than a black sky;
 *  · reporting honestly: `GPUCapabilities` is what the debug overlay and the
 *    bench print, and `source` on every bake says which path produced it.
 *
 * Deliberate omissions: no render loop, no persistent GL state, no textures
 * uploaded per frame, no `readPixels` outside a bake. 21 §12 explains why a
 * full WebGL2 port is rejected for this game (≈15 quads/frame; the bottleneck
 * is fill and JS, not draw calls).
 * ==========================================================================*/

export interface GPUCapabilities {
  available: boolean
  vendor: string
  renderer: string
  maxTexture: number
  /** Why it is unavailable, if it is — surfaced in the debug overlay. */
  reason: string
}

export const NO_GPU: GPUCapabilities = {
  available: false, vendor: '', renderer: '', maxTexture: 0, reason: 'no webgl2',
}

const VERT = `#version 300 es
precision highp float;
void main() {
  // Fullscreen triangle from gl_VertexID: no buffers, no attributes, no VAO.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export interface BakeResult {
  canvas: HTMLCanvasElement
  ms: number
  source: 'gpu'
}

/** A one-shot WebGL2 bake session. Construct, bake, `dispose()`. */
export class BakeContext {
  readonly caps: GPUCapabilities
  private gl: WebGL2RenderingContext | null = null
  private canvas: HTMLCanvasElement | null = null
  private lost = false
  private readonly onLost = (): void => { this.lost = true; this.gl = null }

  constructor() {
    if (typeof document === 'undefined') {
      this.caps = { ...NO_GPU, reason: 'no document' }
      return
    }
    const c = document.createElement('canvas')
    c.width = 4
    c.height = 4
    let gl: WebGL2RenderingContext | null = null
    try {
      gl = c.getContext('webgl2', {
        alpha: false, depth: false, stencil: false, antialias: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false,
        powerPreference: 'high-performance', desynchronized: true,
      }) as WebGL2RenderingContext | null
    } catch {
      gl = null
    }
    if (!gl) {
      this.caps = { ...NO_GPU, reason: 'webgl2 refused' }
      return
    }
    this.canvas = c
    this.gl = gl
    // Context loss during a bake is a real event on Android: register BEFORE
    // compiling so a driver kill can never leave us in a torn state.
    c.addEventListener('webglcontextlost', this.onLost as EventListener, false)

    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? '') : ''
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '') : String(gl.getParameter(gl.RENDERER) ?? '')
    this.caps = {
      available: true,
      vendor: vendor.slice(0, 96),
      renderer: renderer.slice(0, 96),
      maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) ?? 0),
      reason: '',
    }
  }

  get ok(): boolean { return this.gl !== null && !this.lost }

  /** Compile + link. Returns null and fills `error` on failure — never throws,
   *  because a bake failure must degrade, not crash a run. */
  private program(frag: string, error: { msg: string }): WebGLProgram | null {
    const gl = this.gl
    if (!gl) { error.msg = 'no gl'; return null }
    const mk = (type: number, src: string, tag: string): WebGLShader | null => {
      const sh = gl.createShader(type)
      if (!sh) { error.msg = `${tag}: createShader failed`; return null }
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) ?? '(no log)'
        error.msg = `${tag}: ${log.slice(0, 400)}`
        gl.deleteShader(sh)
        return null
      }
      return sh
    }
    const vs = mk(gl.VERTEX_SHADER, VERT, 'vertex')
    if (!vs) return null
    const fs = mk(gl.FRAGMENT_SHADER, frag, 'fragment')
    if (!fs) { gl.deleteShader(vs); return null }
    const prog = gl.createProgram()
    if (!prog) { error.msg = 'createProgram failed'; return null }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      error.msg = `link: ${(gl.getProgramInfoLog(prog) ?? '').slice(0, 400)}`
      gl.deleteProgram(prog)
      return null
    }
    return prog
  }

  /** Bake `frag` at w×h and return it as a canvas. `uniforms` is a flat list of
   *  [name, number] pairs; every uniform is a float, which is all the sky
   *  shaders need. Returns null on any failure with a reason in `out`. */
  bake(
    w: number,
    h: number,
    frag: string,
    uniforms: ReadonlyArray<readonly [string, number]>,
    out: { error?: string } = {},
  ): BakeResult | null {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const gl = this.gl
    if (!gl || this.lost) { out.error = 'context lost'; return null }
    const maxT = this.caps.maxTexture || 4096
    const W = Math.max(1, Math.min(maxT, Math.floor(w)))
    const H = Math.max(1, Math.min(maxT, Math.floor(h)))
    const err = { msg: '' }
    const prog = this.program(frag, err)
    if (!prog) { out.error = err.msg; return null }

    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      out.error = 'framebuffer incomplete'
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteProgram(prog)
      return null
    }

    gl.viewport(0, 0, W, H)
    gl.useProgram(prog)
    for (const [name, value] of uniforms) {
      const loc = gl.getUniformLocation(prog, name)
      if (loc) gl.uniform1f(loc, value)
    }
    const res = gl.getUniformLocation(prog, 'uRes')
    if (res) gl.uniform2f(res, W, H)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    const px = new Uint8Array(W * H * 4)
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const glErr = gl.getError()
    gl.deleteFramebuffer(fbo)
    gl.deleteTexture(tex)
    gl.deleteProgram(prog)
    if (glErr !== gl.NO_ERROR) { out.error = `gl error 0x${glErr.toString(16)}`; return null }

    // readPixels is bottom-up; ImageData is top-down. Flip once, in place.
    const flipped = new Uint8ClampedArray(W * H * 4)
    const stride = W * 4
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * stride
      flipped.set(px.subarray(src, src + stride), y * stride)
    }
    const img = new ImageData(flipped, W, H)
    const outCanvas = document.createElement('canvas')
    outCanvas.width = W
    outCanvas.height = H
    const g2 = outCanvas.getContext('2d')
    if (!g2) { out.error = 'no 2d for readback'; return null }
    g2.putImageData(img, 0, 0)
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    return { canvas: outCanvas, ms, source: 'gpu' }
  }

  dispose(): void {
    if (this.canvas) {
      try { this.canvas.removeEventListener('webglcontextlost', this.onLost as EventListener, false) } catch { /* noop */ }
    }
    const ext = this.gl?.getExtension('WEBGL_lose_context')
    // Ask the driver to drop it now: a bake context that lingers holds a
    // driver-thread connection, and on Android that is measurable battery.
    try { ext?.loseContext() } catch { /* noop */ }
    this.gl = null
    this.canvas = null
  }
}

/** Convenience: one bake, then dispose. Returns null when WebGL2 is missing,
 *  which every caller treats as "use the Canvas2D plate". */
export function bakeOnce(
  w: number,
  h: number,
  frag: string,
  uniforms: ReadonlyArray<readonly [string, number]>,
  out: { error?: string; caps?: GPUCapabilities } = {},
): BakeResult | null {
  const ctx = new BakeContext()
  out.caps = ctx.caps
  if (!ctx.ok) { out.error = ctx.caps.reason; return null }
  try {
    return ctx.bake(w, h, frag, uniforms, out)
  } finally {
    ctx.dispose()
  }
}
