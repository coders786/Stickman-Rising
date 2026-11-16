/**
 * MOUNTAIN-GL runtime — the TypeScript host for mountain.html's own lightfield
 * (see ./html-gl.ts). Owns an offscreen WebGL2 canvas that the 2D pass blits
 * into the deck region each frame, so the 2D pipeline keeps its draw order
 * (sky → deck → structures → … → post) while the deck's material, light, and
 * shadow evaluate with the reference's own shaders.
 *
 * Headless / no-WebGL environments get `null` from create() and the 2D
 * path remains authoritative (see renderer.ts).
 */
import { HtmlLightfield, type DeckFrame } from './html-gl'
import { SCENE_CASTERS } from '../lighting'

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

/** The reference's door x in world px (the practical + the deck's doorVis). */
const DOOR_X = 1755
const DOOR_HALF = 150
/** The reference's moon slot, in screen fractions. */
const MOON_X = 0.58
const MOON_Y = 0.245

/**
 * The occluder mask the reference packs into plane 0: the scene's casters as
 * solid red masses on the ground line, the sakura's crown as the soft green
 * the transmission formula reads. Painted once — the scene is static.
 */
function buildWorldMask(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (!g) return c
  const worldX0 = -0.5
  const worldY0 = -0.03
  const worldW = 2.6
  const worldH = 0.39
  const sx = w / worldW
  const sy = h / worldH
  const groundY = ((0 - worldY0) / worldH) * h
  g.clearRect(0, 0, w, h)
  for (const [x, , topY, widthF] of SCENE_CASTERS) {
    const wx = x / 1920
    const cx = (wx - worldX0) * sx
    const halfW = ((widthF / 2) * sx)
    const height = ((Math.abs(topY) / 1920) * sy)
    if (widthF >= 0.21) {
      // The sakura's crown reads as the soft foliage class (the green .72).
      g.fillStyle = 'rgba(0,255,0,0.72)'
      g.fillRect(cx - halfW, groundY - height, halfW * 2, height * 0.72)
      g.fillStyle = '#f00'
      g.fillRect(cx - halfW * 0.22, groundY - height * 0.4, halfW * 0.44, height * 0.4)
    } else {
      g.fillStyle = '#f00'
      g.fillRect(cx - halfW, groundY - height, halfW * 2, height)
    }
  }
  // The inn's door opening: a hole the light passes through (the reference
  // cuts it out of the house mask with destination-out).
  const doorCx = ((DOOR_X / 1920 - worldX0) * sx)
  const doorW = ((DOOR_HALF * 2) / 1920) * sx
  const doorH = (0.095 / 0.39) * h
  g.globalCompositeOperation = 'destination-out'
  g.fillRect(doorCx - doorW / 2, groundY - doorH, doorW, doorH)
  g.globalCompositeOperation = 'source-over'
  return c
}

export class MountainGL {
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly lightfield: HtmlLightfield,
    private readonly prog: WebGLProgram,
    private readonly loc: Record<string, WebGLUniformLocation | null>,
    private readonly tex: { refl: WebGLTexture; wet: WebGLTexture },
    private readonly vao: WebGLVertexArrayObject,
    private readonly maskCanvas: HTMLCanvasElement,
    private readonly occCanvas: HTMLCanvasElement,
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

    // The reference's lightfield — any failure falls back to the 2D deck.
    let lightfield: HtmlLightfield
    try {
      lightfield = new HtmlLightfield(gl)
    } catch (e) {
      console.warn('[mountain-gl] lightfield unavailable:', e)
      return null
    }
    try {
      lightfield.ensureDummies()
      const maskCanvas = buildWorldMask(2048, 384)
      lightfield.setWorldPlanes(
        [
          { rect: [0, 0, 2048, 384], world: [-0.5, -0.03, 2.6, 0.39] },
          { rect: [2048, 0, 2048, 256], world: [-0.5, -0.03, 2.6, 0.39] },
          { rect: [2048, 256, 2048, 256], world: [-0.5, -0.03, 2.6, 0.39] },
          { rect: [0, 384, 2048, 256], world: [-0.5, -0.03, 2.6, 0.39] },
          { rect: [2048, 512, 2048, 256], world: [-0.5, -0.03, 2.6, 0.39] },
        ],
        0,
      )
      lightfield.uploadPlane(0, maskCanvas)
      const occCanvas = document.createElement('canvas')
      occCanvas.width = 64
      occCanvas.height = 48
      return new MountainGL(canvas, gl, lightfield, null as unknown as WebGLProgram, {}, { refl: null as unknown as WebGLTexture, wet: null as unknown as WebGLTexture }, null as unknown as WebGLVertexArrayObject, maskCanvas, occCanvas)
    } catch (e) {
      console.warn('[mountain-gl] mask setup failed:', e)
      return null
    }
  }

  get width(): number { return this.canvas.width }
  get height(): number { return this.canvas.height }

  resize(cssW: number, cssH: number, dpr: number): void {
    const bw = Math.max(1, Math.floor(cssW * dpr))
    const bh = Math.max(1, Math.floor(cssH * dpr))
    if (this.canvas.width !== bw) this.canvas.width = bw
    if (this.canvas.height !== bh) this.canvas.height = bh
  }

  /** upload the baked plates (the reflection column + the wet band) */
  upload(
    _deck: HTMLCanvasElement,
    refl: HTMLCanvasElement,
    wet: HTMLCanvasElement,
  ): void {
    const { gl, tex } = this
    if (!tex.refl || !tex.wet) return
    const put = (t: WebGLTexture, src: HTMLCanvasElement): void => {
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    }
    put(tex.refl, refl)
    put(tex.wet, wet)
  }

  render(f: GLFrame): void {
    const { gl, lightfield, canvas } = this
    if (canvas.width !== Math.floor(f.cssW * f.dpr) || canvas.height !== Math.floor(f.cssH * f.dpr)) {
      this.resize(f.cssW, f.cssH, f.dpr)
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.BLEND)

    // The reference's door occluder (the jamb visibility sampleOcc reads).
    const occ = this.occCanvas
    const og = occ.getContext('2d')
    if (og) {
      og.clearRect(0, 0, occ.width, occ.height)
      const doorScreen = ((DOOR_X - f.camX) / f.cssW) * occ.width
      og.fillStyle = '#f00'
      og.fillRect(doorScreen - 6, 0, 12, occ.height)
      lightfield.setOccluder(occ)
    }

    const aspect = f.cssW / f.cssH
    const panX = f.camX / f.cssW
    const t = f.time
    // The reference's moon breath + the light geometry (mode 0).
    const breath = 1 + 0.008 * Math.sin(t * 0.45)
    const mx = 0.5 + (MOON_X - 0.5) * breath
    const my = 0.5 + (MOON_Y - 0.5) * breath
    const camNX = 0
    const camNY = 0
    const ax = mx + camNX * 0.64 - 0.5
    const ay = Math.max(0.14, (0.74 - my - camNY * 0.64) * 1.1)
    const soft = 0.025
    const flicker = 0.95 + 0.05 * (Math.sin(t * 5.2) * 0.5 + Math.sin(t * 10.7) * 0.3 + Math.cos(t * 17.3) * 0.2)
    const rayIntensity = Math.min(1.4, Math.max(0.4, f.lights.keyI || 0.9))

    // The reference's per-plane shadow bounds.
    const bounds = new Float32Array(20)
    const worldY0 = -0.03
    const worldH = 0.39
    for (let i = 0; i < 5; i++) {
      const z = 0
      const d = Math.min(0.365 - z, worldH / Math.max(0.035, ay - soft))
      const xmin = -0.5 - 0 - Math.max(0, (ax + soft / aspect) * d)
      const xmax = -0.5 + 2.6 - Math.min(0, (ax - soft / aspect) * d)
      bounds[i * 4] = xmin
      bounds[i * 4 + 1] = xmax
      bounds[i * 4 + 2] = z
      bounds[i * 4 + 3] = z + d
      void worldY0
    }
    lightfield.setShadowBounds(bounds)

    // The reference's moon vectors (mode 0's spec + the reflection direction).
    let lx = ax * aspect
    let ly = ay
    let lz = -1
    let len = Math.hypot(lx, ly, lz)
    lx /= len; ly /= len; lz /= len
    const vl = Math.hypot(0.68, 0.88)
    const vy = 0.68 / vl
    const vz = 0.88 / vl
    let hx = lx
    let hy = ly + vy
    let hz = lz + vz
    len = Math.hypot(hx, hy, hz)
    hx /= len; hy /= len; hz /= len
    const fres = 1 - Math.max(0, hy * vy + hz * vz)
    const specF = 0.04 + 0.96 * fres * fres * fres * fres * fres
    let rx = mx + camNX * 0.64 - 0.64
    let ry = 0.55
    let rz = -0.5
    len = Math.hypot(rx, ry, rz)
    rx /= len; ry /= len; rz /= len

    const doorWx = DOOR_X / 1920
    const practicals = new Float32Array(16)
    practicals.set([doorWx, 0, 0.1, 0.34 * flicker], 0)
    practicals.set([830 / 1920, 0, 0.13, 0.8], 4)

    const frame: DeckFrame = {
      time: t,
      aspect,
      camNX,
      camNY,
      moonX: mx,
      moonY: my,
      flicker,
      rayIntensity,
      panX,
      shadowPan: panX,
      shadowOriginCell: 0,
      doorCenter: (DOOR_X - f.camX) / f.cssW,
      doorWindow: [(DOOR_X - DOOR_HALF) / 1920, (DOOR_X + DOOR_HALF) / 1920],
      shadowLight: [ax, ay, soft],
      moonDir: [lx, ly, lz],
      halfVec: [hx, hy, hz],
      specF,
      reflDir: [rx, ry, rz],
      practicals,
      ripples: new Float32Array(16),
      stones: new Float32Array(52),
      stoneSeeds: new Float32Array(13),
      waves: new Float32Array(12),
      shadowAABB: new Float32Array(12),
    }
    lightfield.drawDeck(frame, canvas.width, canvas.height)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  /** one-shot sanity readback: false if the deck pass produced nothing
   *  (the caller then falls back to the canvas deck path) */
  validate(cssH: number, dpr: number): boolean {
    const { gl, canvas } = this
    const x = Math.floor(canvas.width / 2)
    const y = Math.min(canvas.height - 2, Math.floor(canvas.height - 5 * dpr))
    const px = new Uint8Array(4)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    return px[3] > 8 && px[0] + px[1] + px[2] > 10
  }

  /** the offscreen canvas for the 2D pass to blit */
  get image(): HTMLCanvasElement { return this.canvas }

  destroy(): void {
    const { gl, tex, vao, prog } = this
    if (tex.refl) gl.deleteTexture(tex.refl)
    if (tex.wet) gl.deleteTexture(tex.wet)
    if (vao) gl.deleteVertexArray(vao)
    if (prog) gl.deleteProgram(prog)
    const lose = gl.getExtension('WEBGL_lose_context')
    lose?.loseContext()
  }
}
