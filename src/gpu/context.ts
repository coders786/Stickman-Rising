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

export const SKY_BAKE_VERT = `#version 300 es
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

type Uniforms = ReadonlyArray<readonly [string, number]>
interface BakeStatus { error?: string; caps?: GPUCapabilities }

// Idle between tests of the fence, not between synchronous readPixels calls.
// A context which never signals must still have a Canvas2D fallback.
function waitForReadback(gl: WebGL2RenderingContext, fence: WebGLSync, signal: AbortSignal, deadline: number): Promise<boolean> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>
    const finish = (ready: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      resolve(ready)
    }
    const cancel = () => finish(false)
    const poll = (): void => {
      if (performance.now() >= deadline) { finish(false); return }
      const status = gl.clientWaitSync(fence, 0, 0)
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) finish(performance.now() < deadline)
      else if (status === gl.TIMEOUT_EXPIRED) schedule()
      else finish(false)
    }
    const schedule = () => {
      timer = setTimeout(poll, Math.max(0, Math.min(16, deadline - performance.now())))
    }
    if (signal.aborted) { resolve(false); return }
    signal.addEventListener('abort', cancel, { once: true })
    schedule()
  })
}

/** The owner supplies the persistent 2D target; GL scratch stays here. */
export type BakeTarget = (width: number, height: number) => HTMLCanvasElement

export function makeBakeTarget(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** A one-shot WebGL2 bake session. Construct, bake, `dispose()`. */
export class BakeContext {
  readonly caps: GPUCapabilities
  private gl: WebGL2RenderingContext | null = null
  private canvas: HTMLCanvasElement | null = null
  private lost = false
  private readonly onLost = (): void => { this.lost = true; this.gl = null }

  constructor(interactive = false) {
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
        failIfMajorPerformanceCaveat: interactive,
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
    // Chromium can grant a SwiftShader context despite the caveat flag. Don't
    // dispatch a large software shader while the player is waiting. Unknown
    // renderers have the same short deadline, not an assumed device tier.
    if (interactive && /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i.test(renderer)) {
      this.caps = { ...NO_GPU, renderer: renderer.slice(0, 96), reason: 'software WebGL' }
      this.dispose()
      return
    }
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
    const vs = mk(gl.VERTEX_SHADER, SKY_BAKE_VERT, 'vertex')
    if (!vs) return null
    const fs = mk(gl.FRAGMENT_SHADER, frag, 'fragment')
    if (!fs) { gl.deleteShader(vs); return null }
    const prog = gl.createProgram()
    if (!prog) { gl.deleteShader(vs); gl.deleteShader(fs); error.msg = 'createProgram failed'; return null }
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

  /** Both readback paths submit the same shader into the same format. */
  private draw(w: number, h: number, frag: string, uniforms: Uniforms, out: BakeStatus, deadline = Infinity) {
    const gl = this.gl
    if (!gl || this.lost) { out.error = 'context lost'; return null }
    const maxT = this.caps.maxTexture || 4096
    const W = Math.max(1, Math.min(maxT, Math.floor(w)))
    const H = Math.max(1, Math.min(maxT, Math.floor(h)))
    const err = { msg: '' }
    const prog = this.program(frag, err)
    if (!prog) { out.error = err.msg; return null }

    const tex = gl.createTexture()
    const fbo = gl.createFramebuffer()
    const release = () => { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteProgram(prog) }
    if (!tex || !fbo) { out.error = 'no framebuffer backing'; release(); return null }
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      out.error = 'framebuffer incomplete'
      release()
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
    if (performance.now() >= deadline) {
      out.error = 'sky bake budget exceeded'
      release()
      return null
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return { gl, W, H, release }
  }

  /** Synchronous compatibility path for standalone captures and replays. */
  bake(w: number, h: number, frag: string, uniforms: Uniforms, out: BakeStatus = {}, target: BakeTarget = makeBakeTarget): BakeResult | null {
    const t0 = performance.now()
    const frame = this.draw(w, h, frag, uniforms, out)
    if (!frame) return null
    const { gl, W, H, release } = frame
    try {
      const px = new Uint8Array(W * H * 4)
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return this.finish(gl, W, H, px, t0, out, target)
    } finally {
      release()
    }
  }

  /** Queue a pixel-pack copy and yield while the shader/raster work completes.
   * Never replace a failed fence with the blocking read on the UI path. */
  async bakeDeferred(w: number, h: number, frag: string, uniforms: Uniforms, signal: AbortSignal, out: BakeStatus, target: BakeTarget, deadline = performance.now() + 15_000): Promise<BakeResult | null> {
    if (signal.aborted) return null
    const t0 = performance.now()
    if (t0 >= deadline) { out.error = 'sky bake budget exceeded'; return null }
    const frame = this.draw(w, h, frag, uniforms, out, deadline)
    if (!frame) return null
    const { gl, W, H, release } = frame
    let buffer: WebGLBuffer | null = null, fence: WebGLSync | null = null
    try {
      if (performance.now() >= deadline) { out.error = 'sky bake budget exceeded'; return null }
      buffer = gl.createBuffer()
      if (!buffer) { out.error = 'no pixel-pack buffer'; return null }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, W * H * 4, gl.STREAM_READ)
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0)
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      gl.flush()
      if (!fence || !await waitForReadback(gl, fence, signal, deadline) || signal.aborted || !this.ok) {
        out.error = signal.aborted ? 'cancelled' : performance.now() >= deadline
          ? 'sky bake budget exceeded' : 'GPU readback did not complete'
        return null
      }
      const px = new Uint8Array(W * H * 4)
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px)
      return this.finish(gl, W, H, px, t0, out, target)
    } finally {
      gl.deleteSync(fence)
      gl.deleteBuffer(buffer)
      release()
    }
  }

  private finish(gl: WebGL2RenderingContext, W: number, H: number, px: Uint8Array, t0: number, out: BakeStatus, target: BakeTarget): BakeResult | null {
    const glErr = gl.getError()
    if (glErr !== gl.NO_ERROR) { out.error = `gl error 0x${glErr.toString(16)}`; return null }

    // readPixels is bottom-up; ImageData is top-down.
    const flipped = new Uint8ClampedArray(W * H * 4)
    const stride = W * 4
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * stride
      flipped.set(px.subarray(src, src + stride), y * stride)
    }
    const img = new ImageData(flipped, W, H)
    const outCanvas = target(W, H)
    const g2 = outCanvas.getContext('2d')
    if (!g2) { out.error = 'no 2d for readback'; return null }
    g2.putImageData(img, 0, 0)
    return { canvas: outCanvas, ms: performance.now() - t0, source: 'gpu' }
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
  uniforms: Uniforms,
  out: BakeStatus = {},
  target?: BakeTarget,
): BakeResult | null {
  const ctx = new BakeContext()
  out.caps = ctx.caps
  try {
    if (!ctx.ok) { out.error = ctx.caps.reason; return null }
    return ctx.bake(w, h, frag, uniforms, out, target)
  } finally {
    ctx.dispose()
  }
}

/** A shared deadline opts into the interactive policy. It bounds polling,
 * not the duration of a browser/driver API call already on the stack. */
export async function bakeOnceDeferred(w: number, h: number, frag: string, uniforms: Uniforms, signal: AbortSignal, out: BakeStatus, target: BakeTarget, deadline?: number): Promise<BakeResult | null> {
  if (signal.aborted) return null
  if (deadline !== undefined && performance.now() >= deadline) { out.error = 'sky bake budget exceeded'; return null }
  const ctx = new BakeContext(deadline !== undefined)
  out.caps = ctx.caps
  try {
    if (!ctx.ok) { out.error = ctx.caps.reason; return null }
    return await ctx.bakeDeferred(w, h, frag, uniforms, signal, out, target, deadline)
  } finally {
    ctx.dispose()
  }
}
