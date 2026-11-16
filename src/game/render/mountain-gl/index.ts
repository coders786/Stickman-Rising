/**
 * MOUNTAIN-GL runtime — the TypeScript host for the ported reference
 * shaders (see ./shaders.ts). Owns an offscreen WebGL2 canvas that the
 * 2D pass blits into the deck region each frame, so the 2D pipeline keeps
 * its draw order (sky → deck → structures → … → post) while the deck's
 * light/shadow/water evaluate on the GPU.
 *
 * Headless / no-WebGL environments get `null` from create() and the 2D
 * path remains authoritative (see renderer.ts).
 */
import { DECK_VERT, DECK_FRAG } from './shaders'

export interface GLLights {
  door: { x: number; y: number; range: number; i: number; r: number; g: number; b: number }
  street: { x: number; y: number; range: number; i: number; r: number; g: number; b: number }
  keyDirX: number
  keyDirY: number
  keyDirZ: number
  keyI: number
  keyR: number
  keyG: number
  keyB: number
}

export interface GLFrame {
  cssW: number
  cssH: number
  dpr: number
  camX: number
  camY: number
  zoom: number
  rot: number
  time: number
  lineY: number
  /** reflection plate height (line frame) */
  reflH: number
  lights: GLLights
  /** packed occluders: cx, cy, hw, hh per record (line frame) */
  occ: Float32Array
  occZ: Float32Array
  occN: number
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[mountain-gl] shader compile failed:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export class MountainGL {
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly prog: WebGLProgram,
    private readonly loc: Record<string, WebGLUniformLocation | null>,
    private readonly tex: { deck: WebGLTexture; refl: WebGLTexture; wet: WebGLTexture },
    private readonly vao: WebGLVertexArrayObject,
  ) {}

  static create(cssW: number, cssH: number, dpr: number): MountainGL | null {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(cssW * dpr))
    canvas.height = Math.max(1, Math.floor(cssH * dpr))
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    if (!gl) return null

    const vs = compile(gl, gl.VERTEX_SHADER, DECK_VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, DECK_FRAG)
    if (!vs || !fs) return null
    const prog = gl.createProgram()
    if (!prog) return null
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[mountain-gl] link failed:', gl.getProgramInfoLog(prog))
      return null
    }
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    const loc: Record<string, WebGLUniformLocation | null> = {}
    for (const n of [
      'uRes', 'uCenter', 'uZoom', 'uCos', 'uSin', 'uCam', 'uLineY',
      'uDeck', 'uRefl', 'uWet', 'uDeckRect', 'uReflRect', 'uWetTop', 'uTime',
      'uDoor', 'uDoorCol', 'uStreet', 'uStreetCol',
      'uKeyDir', 'uKeyI', 'uKeyCol', 'uOccN', 'uOcc', 'uOccZ',
    ]) loc[n] = gl.getUniformLocation(prog, n)

    // fullscreen quad (device px)
    const vao = gl.createVertexArray()
    const vbo = gl.createBuffer()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    const mkTex = (): WebGLTexture => {
      const t = gl.createTexture() as WebGLTexture
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    return new MountainGL(canvas, gl, prog, loc, { deck: mkTex(), refl: mkTex(), wet: mkTex() }, vao)
  }

  get width(): number { return this.canvas.width }
  get height(): number { return this.canvas.height }

  resize(cssW: number, cssH: number, dpr: number): void {
    const bw = Math.max(1, Math.floor(cssW * dpr))
    const bh = Math.max(1, Math.floor(cssH * dpr))
    if (this.canvas.width !== bw) this.canvas.width = bw
    if (this.canvas.height !== bh) this.canvas.height = bh
  }

  /** upload the baked plates (call when the background re-bakes) */
  upload(
    deck: HTMLCanvasElement,
    refl: HTMLCanvasElement,
    wet: HTMLCanvasElement,
  ): void {
    const { gl, tex } = this
    const put = (t: WebGLTexture, src: HTMLCanvasElement): void => {
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    }
    put(tex.deck, deck)
    put(tex.refl, refl)
    put(tex.wet, wet)
  }

  render(f: GLFrame): void {
    const { gl, prog, loc, tex, vao, canvas } = this
    if (canvas.width !== Math.floor(f.cssW * f.dpr) || canvas.height !== Math.floor(f.cssH * f.dpr)) {
      this.resize(f.cssW, f.cssH, f.dpr)
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(prog)

    const cos = Math.cos(f.rot)
    const sin = Math.sin(f.rot)
    const zoom = f.zoom * f.dpr
    gl.uniform2f(loc.uRes!, canvas.width, canvas.height)
    gl.uniform2f(loc.uCenter!, (f.cssW * f.dpr) / 2, (f.cssH * f.dpr) / 2)
    gl.uniform1f(loc.uZoom!, zoom)
    gl.uniform1f(loc.uCos!, cos)
    gl.uniform1f(loc.uSin!, sin)
    gl.uniform2f(loc.uCam!, f.camX, f.camY)
    gl.uniform1f(loc.uLineY!, f.lineY)
    gl.uniform4f(loc.uDeckRect!, -150, 0, 2900, 380)
    gl.uniform1f(loc.uReflRect!, Math.max(1, f.reflH))
    gl.uniform1f(loc.uWetTop!, 8)
    gl.uniform1f(loc.uTime!, f.time)

    const d = f.lights.door
    gl.uniform4f(loc.uDoor!, d.x, d.y, d.range, d.i)
    gl.uniform3f(loc.uDoorCol!, d.r, d.g, d.b)
    const s = f.lights.street
    gl.uniform4f(loc.uStreet!, s.x, s.y, s.range, s.i)
    gl.uniform3f(loc.uStreetCol!, s.r, s.g, s.b)
    gl.uniform3f(loc.uKeyDir!, f.lights.keyDirX, f.lights.keyDirY, f.lights.keyDirZ)
    gl.uniform1f(loc.uKeyI!, f.lights.keyI)
    gl.uniform3f(loc.uKeyCol!, f.lights.keyR, f.lights.keyG, f.lights.keyB)
    gl.uniform1i(loc.uOccN!, Math.min(40, f.occN))
    gl.uniform4fv(loc.uOcc!, f.occ.subarray(0, 40 * 4))
    gl.uniform1fv(loc.uOccZ!, f.occZ.subarray(0, 40))

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex.deck)
    gl.uniform1i(loc.uDeck!, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, tex.refl)
    gl.uniform1i(loc.uRefl!, 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, tex.wet)
    gl.uniform1i(loc.uWet!, 2)

    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /** the offscreen canvas for the 2D pass to blit */
  get image(): HTMLCanvasElement { return this.canvas }

  destroy(): void {
    const { gl, prog, tex, vao } = this
    gl.deleteTexture(tex.deck)
    gl.deleteTexture(tex.refl)
    gl.deleteTexture(tex.wet)
    gl.deleteVertexArray(vao)
    gl.deleteProgram(prog)
    const lose = gl.getExtension('WEBGL_lose_context')
    lose?.loseContext()
  }
}


