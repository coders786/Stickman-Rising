/**
 * MOUNTAIN-GL runtime — the TypeScript host for mountain.html's own lightfield
 * (see ./html-gl.ts). Owns an offscreen WebGL2 canvas that the 2D pass blits
 * into the deck region each frame, so the 2D pipeline keeps its draw order
 * (sky → deck → structures → … → post) while the deck's material, light, and
 * shadow evaluate with the reference's own shaders.
 *
 * World↔deck mapping: the deck shader works in one-screen-width units, so a
 * world feature at W sits at wx = W / K where K = cssW / zoom (the view's
 * world-px width), and panX = camX / K − 0.5 carries the camera. The deck's
 * horizon (hy) is pinned to OUR contact line (lineY, world y = −ENV_BACK)
 * through camNY, so the planks meet the wall exactly where the 2D art puts it.
 *
 * Headless / no-WebGL environments get `null` from create() and the 2D
 * path remains authoritative (see renderer.ts).
 */
import { HtmlLightfield, type DeckFrame } from './html-gl'

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
  /** the contact line's world y (−ENV_BACK): where the wall meets the deck */
  lineY: number
  /** reflection plate height (line frame) */
  reflH: number
  lights: GLLights
  /** packed occluders: cx, cy, hw, hh per record (line frame) */
  occ: Float32Array
  occZ: Float32Array
  occN: number
  /** the live actors (the player + the enemies): x, hw, height per record */
  actors: Float32Array
  actorN: number
}

/**
 * The door: the baked house's lit doorway (the live amber slab) sits at
 * INN_X + 14 = 2114 — 1755 was the legacy city scene's stairwell and put
 * every door practical 345 px left of the art.
 */
const DOOR_X = 2114
const DOOR_L = 2092
const DOOR_R = 2136
/** The reference's moon slot, in screen fractions. */
const MOON_X = 0.58
const MOON_Y = 0.245

/* The mask's world rect (deck units): x wide enough for every pan/zoom the
 * camera reaches, y covering the casters' tops and the sample reach. */
const MX0 = -0.5
const MY0 = -0.05
const MWD = 5.0
const MHT = 0.55
/** Plane 1 carries the actors; its z sits just under the play line's depth
 *  (the feet's wz ≈ 0.275–0.36 across the zoom range). */
const ACTOR_Z = 0.25

/** The deck shader's perspective span (HY − VPY). */
const PERSP_SPAN = 0.74 - 0.34

/**
 * Paint one plane's occluder mask: the caster boxes stand on the ground line
 * (p.y = 0 of the world rect — near the mask's BOTTOM, because mask v runs
 * (wY0+wH−p.y)/wH) and reach upward in canvas = +p.y (toward the rect's far
 * edge), which is where the transport's samples (d·slope.y ≥ 0) live.
 * Convention: red = solid, green = soft foliage.
 */
function paintPlaneMask(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  K: number,
  boxes: Float32Array,
  n: number,
  soft: (i: number) => boolean,
  doorHole: boolean,
): void {
  const sx = w / MWD
  const sy = h / MHT
  // canvas row for p.y = 0: v = (MY0 + MHT − p.y)/MHT, canvas_y = v·h
  const groundY = ((MY0 + MHT) / MHT) * h
  g.clearRect(0, 0, w, h)
  const box = (wx: number, hw: number, height: number, isSoft: boolean): void => {
    const cx = (wx / K - MX0) * sx
    const halfW = (hw / K) * sx
    const hpx = (height / K) * sy
    if (isSoft) {
      g.fillStyle = 'rgba(0,255,0,0.72)'
      g.fillRect(cx - halfW, groundY - hpx, halfW * 2, hpx * 0.72)
      g.fillStyle = '#f00'
      g.fillRect(cx - halfW * 0.22, groundY - hpx * 0.4, halfW * 0.44, hpx * 0.4)
    } else {
      g.fillStyle = '#f00'
      g.fillRect(cx - halfW, groundY - hpx, halfW * 2, hpx)
    }
  }
  for (let i = 0; i < n; i++) box(boxes[i * 3], boxes[i * 3 + 1], boxes[i * 3 + 2], soft(i))
  if (doorHole) {
    // the reference destination-outs the doorway from the house mask, so the
    // moonlight passes through the opening
    const dl = (DOOR_L / K - MX0) * sx
    const dr = (DOOR_R / K - MX0) * sx
    const dTop = groundY - (80 / K) * sy
    g.globalCompositeOperation = 'destination-out'
    g.fillRect(dl, dTop, dr - dl, groundY - dTop + 1)
    g.globalCompositeOperation = 'source-over'
  }
}

/** The packed scene occluders (inn, sakura, rack, props) → the 3-per-record list. */
function staticBoxes(occ: Float32Array, occZ: Float32Array, occN: number): Float32Array {
  const out = new Float32Array(occN * 3)
  for (let i = 0; i < occN; i++) {
    out[i * 3] = occ[i * 4]
    out[i * 3 + 1] = occ[i * 4 + 2]
    out[i * 3 + 2] = occZ[i]
  }
  return out
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
    private readonly actorCanvas: HTMLCanvasElement,
    private readonly occCanvas: HTMLCanvasElement,
  ) {}
  private maskClock = 0

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
      const world: [number, number, number, number] = [MX0, MY0, MWD, MHT]
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = 2048
      maskCanvas.height = 384
      const actorCanvas = document.createElement('canvas')
      actorCanvas.width = 2048
      actorCanvas.height = 256
      // The reference's atlas pack (WORLD_ATLAS_W = 4096): plane 0 = statics,
      // plane 1 = the actors, planes 2–4 idle.
      lightfield.setWorldPlanes(
        [
          { rect: [0, 0, 2048, 384], world, z: 0 },
          { rect: [2048, 0, 2048, 256], world, z: ACTOR_Z },
          { rect: [2048, 256, 2048, 256], world, z: 0 },
          { rect: [0, 384, 2048, 256], world, z: 0 },
          { rect: [2048, 512, 2048, 256], world, z: 0 },
        ],
        0,
      )
      lightfield.uploadPlane(0, maskCanvas)
      lightfield.uploadPlane(1, actorCanvas)
      const occCanvas = document.createElement('canvas')
      occCanvas.width = 64
      occCanvas.height = 48
      return new MountainGL(
        canvas, gl, lightfield,
        null as unknown as WebGLProgram, {},
        { refl: null as unknown as WebGLTexture, wet: null as unknown as WebGLTexture },
        null as unknown as WebGLVertexArrayObject,
        maskCanvas, actorCanvas, occCanvas,
      )
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

    // One screen width in world px — every world↔deck conversion runs
    // through K, so the flood, the jamb and the mask track the art exactly.
    const K = f.cssW / f.zoom
    const panX = f.camX / K - 0.5
    // Our contact line's screen y — the deck's horizon must land on it.
    const contactY = 0.5 + ((f.lineY - f.camY) * f.zoom) / f.cssH
    const hy = Math.max(0.2, Math.min(0.95, contactY))
    // camNY shifts only the shader's hy (the moon's elevation is computed
    // below without it — that's a JS-side term, not the shader's).
    const camNY = (0.74 - hy) / 0.72

    // The reference's occluder clock (30 Hz): repaint both world masks from
    // the scene's occluders + the live actors; refresh the door's jamb.
    this.maskClock += 1
    if (this.maskClock % 2 === 1) {
      const mg = this.maskCanvas.getContext('2d')
      if (mg) {
        const boxes = staticBoxes(f.occ, f.occZ, f.occN)
        // the occ list orders: inn, sakura (soft crown), rack, props…
        paintPlaneMask(mg, this.maskCanvas.width, this.maskCanvas.height, K, boxes, f.occN, (i) => i === 1, true)
        lightfield.uploadPlane(0, this.maskCanvas)
      }
      const ag = this.actorCanvas.getContext('2d')
      if (ag) {
        const ab = new Float32Array(f.actorN * 3)
        ab.set(f.actors.subarray(0, f.actorN * 3))
        paintPlaneMask(ag, this.actorCanvas.width, this.actorCanvas.height, K, ab, f.actorN, () => false, false)
        lightfield.uploadPlane(1, this.actorCanvas)
      }
      const og = this.occCanvas.getContext('2d')
      if (og) {
        const s = this.occCanvas.width
        const openL = ((DOOR_L - f.camX) * f.zoom) / f.cssW + 0.5
        const openR = ((DOOR_R - f.camX) * f.zoom) / f.cssW + 0.5
        // solid wall everywhere; the doorway itself stays clear so the light
        // passes (sampleOcc's 1−r is the doorVis gate)
        og.fillStyle = '#f00'
        og.fillRect(0, 0, s, this.occCanvas.height)
        og.globalCompositeOperation = 'destination-out'
        og.fillRect(openL * s, 0, (openR - openL) * s, this.occCanvas.height)
        og.globalCompositeOperation = 'source-over'
        lightfield.setOccluder(og.canvas)
      }
    }

    const aspect = f.cssW / f.cssH
    const t = f.time
    // The reference's moon breath + the light geometry (mode 0).
    const breath = 1 + 0.008 * Math.sin(t * 0.45)
    const mx = 0.5 + (MOON_X - 0.5) * breath
    const my = 0.5 + (MOON_Y - 0.5) * breath
    const ax = mx - 0.5
    const ay = Math.max(0.14, (0.74 - my) * 1.1)
    const soft = 0.025
    const flicker = 0.95 + 0.05 * (Math.sin(t * 5.2) * 0.5 + Math.sin(t * 10.7) * 0.3 + Math.cos(t * 17.3) * 0.2)
    const rayIntensity = Math.min(1.4, Math.max(0.4, f.lights.keyI || 0.9))

    // The deck's far edge (matches the shader's wzEdge) + the per-plane bounds.
    const wzEdge = 1 - 1 / (1 + (0.985 - hy) / PERSP_SPAN)
    const bounds = new Float32Array(20)
    const planeZ = [0, ACTOR_Z, 0, 0, 0]
    for (let i = 0; i < 5; i++) {
      const z = planeZ[i]
      const d = Math.min(wzEdge - z, MHT / Math.max(0.035, ay - soft))
      const xmin = MX0 - Math.max(0, (ax + soft / aspect) * d)
      const xmax = MX0 + MWD - Math.min(0, (ax - soft / aspect) * d)
      bounds[i * 4] = xmin
      bounds[i * 4 + 1] = xmax
      bounds[i * 4 + 2] = z
      bounds[i * 4 + 3] = z + d
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
    let hy2 = ly + vy
    let hz = lz + vz
    len = Math.hypot(hx, hy2, hz)
    hx /= len; hy2 /= len; hz /= len
    const fres = 1 - Math.max(0, hy2 * vy + hz * vz)
    const specF = 0.04 + 0.96 * fres * fres * fres * fres * fres
    let rx = mx - 0.64
    let ry = 0.55
    let rz = -0.5
    len = Math.hypot(rx, ry, rz)
    rx /= len; ry /= len; rz /= len

    // The practicals sit at the art's door / street lamp, in deck units.
    const practicals = new Float32Array(16)
    practicals.set([DOOR_X / K, 0, 0.1, 0.34 * flicker], 0)
    practicals.set([830 / K, 0, 0.13, 0.8], 4)

    const frame: DeckFrame = {
      time: t,
      aspect,
      camNX: 0,
      camNY,
      moonX: mx,
      moonY: my,
      flicker,
      rayIntensity,
      panX,
      shadowPan: panX,
      shadowOriginCell: 0,
      doorCenter: DOOR_X / K - panX,
      doorWindow: [DOOR_L / K, DOOR_R / K],
      shadowLight: [ax, ay, soft],
      moonDir: [lx, ly, lz],
      halfVec: [hx, hy2, hz],
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
