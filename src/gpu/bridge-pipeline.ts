import { BRIDGE_GL_ATTRIBUTES, describeBridgeAdapter } from './bridge-device'
import { packedSettled, warmPackedBridge } from './bridge-packed-assets'
import { DECK_PACK, gradePack } from '../graphics/bridge/BridgeAssetCodec'
import type { BakeWindow } from '../graphics/bridge/BridgeBakeProtocol'
import { BridgeTextureStream } from './bridge-stream'
import { WINDOW_BYTES } from '../graphics/bridge/BridgeBakeProtocol'
import { VECTOR_ATLAS_W, VECTOR_H } from '../graphics/bridge/LightVectorGrid'
import { StratumAClock } from '../graphics/bridge/BridgeAtmosphere'
import { GLASS_TILE_H, GLASS_TILE_W, SHOP_FRONT_LIMIT } from '../graphics/bridge/ShopGlassOptics'
import { SKY_CACHE_CEILING } from '../graphics/bridge/SkyOptics'
import { BLOCKER_LIMIT } from '../graphics/bridge/NoirGeometry'
import { ENV_W, ENV_H } from '../graphics/bridge/EnvBasis'
import { bridgeSkyBasis, type SkyBasis, CITY_MASK_H, CITY_MASK_W, CLOUD_ATLAS_H, CLOUD_W, HORIZON_H, HORIZON_SECTORS, HORIZON_W, MOON_EDGE, SKY_BASIS_BYTES } from '../graphics/bridge/SkyBasis'
import { MASTER_MOTE_SLOTS, MASTER_RAIN_SLOTS, RAIN_CELL, RAIN_GUST, RAIN_PLANES } from '../game/stage/bridge-weather-data'
import { BRIDGE_FACE_STRIDE, type BridgeFrame } from '../game/render/bridge-frame'
import { DECK_MASK_H, MATERIAL_COUNT, MATERIAL_TILE, PUDDLE_PITCH } from '../game/stage/bridge-material'
import { bridgePlate } from '../game/stage/bridge-webp'
import { ROAD } from '../game/stage/road-section'
import { finishPaint } from '../game/render/paint-slices'
import { MASTER_PIXEL_LIMIT, type BridgeGLTier } from '../graphics/sacr/BridgeBacking'
import { SACR_CURB_Z } from '../graphics/sacr/SACRMath'
import { SACR_MASTER_K, SACR_MOBILE_K, SACRUniformBuffer } from '../graphics/sacr/SACRPacker'
import { allocateSACRBuffer, bindSACRBlock, uploadSACRFrame } from '../graphics/sacr/SACRGL'
import { BLOOM_DIVISORS, BLOOM_TARGET_DIVISORS, bloomSize } from './bridge-bloom'
import { BRIDGE_PROGRAMS } from './bridge-programs'
import { deckTile, lookVolume, materialTiles, rippleTile } from './bridge-textures'
import { finishProgram, linkProgram, queueProgram } from './program'

const LOOK_SAMPLERS = ['uTransit', 'uMarket', 'uIndustrial', 'uBoss'] as const

/** R11F_G11F_B10F is core texture storage but color-buffer support is an
 * optional feature. Probe its actual renderability once, before allocating the
 * backing group; never mix packed and half-float bloom levels on fallback. */
function supportsPackedBloom(gl: WebGL2RenderingContext): boolean {
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer()
  if (!texture || !framebuffer) {
    if (texture) gl.deleteTexture(texture)
    if (framebuffer) gl.deleteFramebuffer(framebuffer)
    for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* drain creation failure */ }
    return false
  }
  let supported = false
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R11F_G11F_B10F, 1, 1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    supported = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null)
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture)
    // A failed optional format must not poison the real allocation check.
    for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* drain once at creation */ }
  }
  return supported
}

/** Failure to acquire a hardware context applies to both render tiers. */
export class BridgeContextUnavailable extends Error {}

type Program = { name: string; handle: WebGLProgram; units: Map<string, number>; loc: (key: string) => WebGLUniformLocation | null }
type Target = { fbo: WebGLFramebuffer; color: WebGLTexture; width: number; height: number; bytesPerPixel: number }
/** GPU leaf. Two sparse painter inputs (world coverage & transparent
 * choreography), one batched receiver mesh, one linear HDR allocation group.
 * No readPixels, no getImageData, no feedback from the presented canvas. */
export class BridgePipeline {
  private readonly programs: Program[] = []
  private readonly textures: WebGLTexture[] = []
  private readonly targets: Target[] = []
  private readonly bloomTargets: Target[] = []
  private base!: Program
  private receiver!: Program
  private emission!: Program
  private weather!: Program
  private filter!: Program
  private road!: Program
  private trail!: Program
  private resolve!: Program
  private ripple!: WebGLTexture
  private skyProgram!: Program
  private skyCache: Target | null = null
  private roadLightHalf: Target | null = null
  private readonly skyClock: StratumAClock
  private skyDirty = true
  private skyTextures: { cloud: WebGLTexture; lunar: WebGLTexture; horizon: WebGLTexture;
    far: WebGLTexture; mid: WebGLTexture; farBasis: WebGLTexture; midBasis: WebGLTexture } | null = null
  private skyJob: Partial<NonNullable<BridgePipeline['skyTextures']>> = {}
  private skyUpload = 0
  private cityBytes = 0
  get skyReady(): boolean { return !!this.skyTextures }
  private deckSource: ReturnType<typeof lookVolume> = 'local'
  private readonly lutSources: ReturnType<typeof lookVolume>[] = []
  private skyFrame: ReturnType<BridgeFrame['atmo']['receipt']> | null = null
  private transport!: BridgeTextureStream
  private ubo: WebGLBuffer | null = null
  private uboOffsets: number[] = []
  private grade!: Program
  private readonly compileStatus: number | undefined
  private initialized = false
  private linking: Generator<void> | null = null
  private initializing: Generator<string> | null = null
  private readonly setupMs: Record<string, number> = {}
  private baseTex!: WebGLTexture
  private actorTex!: WebGLTexture
  private shopTex: WebGLTexture | null = null
  private shopUpload = 0
  private shopUnavailable = false
  private material!: WebGLTexture
  private deck!: WebGLTexture
  private readonly looks: WebGLTexture[] = []
  private scene: Target | null = null
  private roadHalf: Target | null = null
  private meshVao: WebGLVertexArrayObject | null = null
  private vao: WebGLVertexArrayObject | null = null
  private mesh: WebGLBuffer | null = null
  private uploadBytes = 0
  private frameDraws = 0
  private rainInstances = 0
  private moteInstances = 0
  private w = 0
  private h = 0
  private resizeJob?: Generator<void>
  private checkDraw = false
  private openingFrame: { fbo: WebGLFramebuffer; fence: WebGLSync | null } | null = null
  private exercisedOpeningPrograms = false
  private readonly warmTriangle = new Float32Array(3 * BRIDGE_FACE_STRIDE)

  static create(canvas: HTMLCanvasElement, mode: BridgeGLTier, allowSoftware: boolean, adapterChecked = false): BridgePipeline {
    // A cleared or not-yet-composited drawing buffer must expose the last
    // full Canvas frame, not an opaque black quad. Our final pass writes alpha 1.
    const gl = canvas.getContext('webgl2', { ...BRIDGE_GL_ATTRIBUTES, failIfMajorPerformanceCaveat: !allowSoftware })
    if (!gl) throw new BridgeContextUnavailable('WebGL2 hardware path unavailable')
    // Avoid the multi-pass HDR path on software rasterizers. Test tooling
    // can force it for visual parity; there is no user-facing performance
    // switch or render-scale mutation. Masked adapters still use the caveat.
    if (!allowSoftware && !adapterChecked && describeBridgeAdapter(gl) === 'software') {
      throw new BridgeContextUnavailable('Software WebGL adapter; using Canvas fallback')
    }
    // EXT_float_blend is not needed for RGBA16F (only 32-bit float), but a
    // real renderable half-float FBO is required. No silent "HDR" in RGBA8.
    const floatColor = !!gl.getExtension('EXT_color_buffer_float')
    const packedBloom = mode === 'master' && floatColor && supportsPackedBloom(gl)
    if (mode === 'master' && !floatColor && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('RGBA16F color buffer unavailable')
    return new BridgePipeline(gl, canvas, mode, packedBloom)
  }

  private constructor(readonly gl: WebGL2RenderingContext, readonly canvas: HTMLCanvasElement, readonly mode: BridgeGLTier,
    private readonly packedBloom: boolean) {
    this.skyClock = new StratumAClock(mode)
    this.compileStatus = gl.getExtension('KHR_parallel_shader_compile')?.COMPLETION_STATUS_KHR
    this.linking = this.link()
  }

  private program(name: keyof typeof BRIDGE_PROGRAMS): Program {
    const gl = this.gl, [vertex, fragment] = BRIDGE_PROGRAMS[name]
    const program = this.compileStatus ? queueProgram(gl, vertex, fragment, name) : linkProgram(gl, vertex, fragment, name)
    const locations = new Map<string, WebGLUniformLocation | null>()
    const p = { name, handle: program, units: new Map<string, number>(), loc: (key: string) => {
      if (!locations.has(key)) locations.set(key, gl.getUniformLocation(program, key))
      return locations.get(key) ?? null
    } }
    this.programs.push(p)
    return p
  }

  private texture(target: number, track = true): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()
    if (!t) throw new Error('Bridge texture allocation failed')
    if (track) this.textures.push(t)
    gl.bindTexture(target, t)
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (target === gl.TEXTURE_3D || target === gl.TEXTURE_2D_ARRAY) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    return t
  }

  private *link(): Generator<void> {
    const gl = this.gl, master = this.mode === 'master'
    warmPackedBridge(master)
    this.base = this.program(master ? 'masterBase' : 'mobileBase'); yield
    this.emission = this.program(master ? 'masterActors' : 'mobileActors'); yield
    this.grade = this.program(master ? 'masterGrade' : 'mobileGrade'); yield
    this.road = this.program(master ? 'masterRoad' : 'mobileRoad'); yield
    this.skyProgram = this.program(master ? 'masterSky' : 'mobileSky'); yield
    if (master) {
      this.receiver = this.program('receiver'); yield
      this.weather = this.program('weather'); yield
      this.trail = this.program('trail'); yield
      this.filter = this.program('bloom'); yield
    } else { this.resolve = this.program('mobileResolve'); yield }
  }

  /** Bound link work per Canvas frame. Without the completion extension a
   * single link can still block, but never build all nine in one tick. */
  get assembled(): boolean { return this.initialized }

  ready(): boolean {
    if (this.initialized) return true
    const { gl, compileStatus } = this
    if (this.linking) {
      if (this.linking.next().done) this.linking = null
      return false
    }
    if (!this.initializing) {
      if (compileStatus) {
        if (this.programs.some(p => !gl.getProgramParameter(p.handle, compileStatus))) return false
        for (const p of this.programs) finishProgram(gl, p.handle, p.name)
      }
      this.initializing = this.initialize()
    }
    const at = performance.now(), next = this.initializing.next()
    if (!next.done) { this.setupMs[next.value] = performance.now() - at; return false }
    this.initialized = true; this.initializing = null
    return true
  }

  private *initialize(): Generator<string> {
    const gl = this.gl, master = this.mode === 'master'
    gl.activeTexture(gl.TEXTURE0)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    this.uboOffsets = bindSACRBlock(gl, this.road.handle)
    this.ubo = allocateSACRBuffer(gl)
    this.vao = gl.createVertexArray()
    if (!this.vao) throw new Error('Bridge VAO allocation failed')
    gl.bindVertexArray(this.vao)
    {
      this.meshVao = gl.createVertexArray(); this.mesh = gl.createBuffer()
      if (!this.meshVao || !this.mesh) throw new Error('Bridge mesh allocation failed')
      gl.bindVertexArray(this.meshVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh)
      // Receivers and trail vertices share the same position + vec3 stride.
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, BRIDGE_FACE_STRIDE * 4, 0)
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BRIDGE_FACE_STRIDE * 4, 8)
      gl.bindVertexArray(this.vao)
    }
    yield 'rig'
    if (master) {
      this.material = this.texture(gl.TEXTURE_2D_ARRAY); materialTiles(gl)
      yield 'materials'
      this.ripple = this.texture(gl.TEXTURE_2D); rippleTile(gl)
      yield 'ripple'
    }
    this.baseTex = this.texture(gl.TEXTURE_2D); this.actorTex = this.texture(gl.TEXTURE_2D)
    while (!packedSettled(DECK_PACK)) yield 'deck-source'
    this.deck = this.texture(gl.TEXTURE_2D); this.deckSource = yield* deckTile(gl)
    yield 'deck'
    while (!packedSettled(gradePack(master ? 32 : 16))) yield 'grade-source'
    for (let i = 0; i < 4; i++) {
      this.looks.push(this.texture(gl.TEXTURE_3D)); this.lutSources.push(lookVolume(gl, master ? 32 : 16, i))
      yield `look-${i}`
    }
    this.transport = new BridgeTextureStream(gl, () => this.texture(gl.TEXTURE_2D))
    yield 'transport-storage'
    gl.disable(gl.DITHER)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    const error = gl.getError()
    if (error !== gl.NO_ERROR) throw new Error(`Bridge texture initialization: WebGL ${error}`)
  }

  private releaseTexture(t: WebGLTexture): void {
    this.gl.deleteTexture(t)
    const i = this.textures.indexOf(t)
    if (i >= 0) this.textures.splice(i, 1)
  }

  private allocate(w: number, h: number, bloom = false): Target {
    const gl = this.gl
    const color = this.texture(gl.TEXTURE_2D, false), fbo = gl.createFramebuffer()
    if (!fbo) { gl.deleteTexture(color); throw new Error('Bridge FBO allocation failed') }
    const master = this.mode === 'master', packed = bloom && this.packedBloom
    const t = { fbo, color, width: w, height: h, bytesPerPixel: master && !packed ? 8 : 4 }
    if (packed) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R11F_G11F_B10F, w, h)
    else gl.texImage2D(gl.TEXTURE_2D, 0, master ? gl.RGBA16F : gl.RGBA8,
      w, h, 0, gl.RGBA, master ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo); gl.deleteTexture(color)
      throw new Error(`Bridge ${packed ? 'R11F_G11F_B10F' : master ? 'RGBA16F' : 'RGBA8'} FBO incomplete`)
    }
    this.targets.push(t)
    return t
  }

  private releaseTargets(): void {
    this.resizeJob = undefined
    this.discardOpeningFrame()
    for (const t of this.targets) { this.gl.deleteFramebuffer(t.fbo); this.gl.deleteTexture(t.color) }
    this.targets.length = this.bloomTargets.length = 0
    this.scene = this.roadHalf = this.skyCache = this.roadLightHalf = null
    this.skyClock.invalidate()
  }

  private planResize(w: number, h: number): void {
    if (this.w === w && this.h === h && (this.resizeJob || this.scene)) return
    const gl = this.gl, limit = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    if ((this.mode === 'master' && w * h > MASTER_PIXEL_LIMIT) || w > limit || h > limit) throw new RangeError('Bridge backing budget exceeded')
    this.releaseTargets()
    this.w = w; this.h = h
    this.resizeJob = this.buildTargets(w, h)
  }

  resize(w: number, h: number): void {
    this.planResize(w, h)
    if (this.resizeJob) { finishPaint(this.resizeJob); this.resizeJob = undefined }
  }

  advanceResize(w: number, h: number): boolean {
    this.planResize(w, h)
    if (this.resizeJob && !this.resizeJob.next().done) return false
    this.resizeJob = undefined
    return true
  }

  private *buildTargets(w: number, h: number): Generator<void> {
    const gl = this.gl
    for (const t of [this.baseTex, this.actorTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      yield
    }
    this.scene = this.allocate(w, h)
    yield
    const master = this.mode === 'master'
    // Spend the sky's texels on optical height in portrait. The resolved
    // lunar patch below is independent of this budget.
    this.skyCache = w >= h ? this.allocate(master ? 256 : 160, master ? 88 : 56)
      : this.allocate(master ? 160 : 96, master ? 144 : 96)
    yield
    if (this.mode === 'mobile') {
      const half = this.roadHalf = this.allocate(Math.ceil(w / 2), Math.ceil(h / 2))
      yield
      this.roadLightHalf = this.allocate(half.width, half.height)
      gl.bindFramebuffer(gl.FRAMEBUFFER, half.fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.roadLightHalf.color, 0)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Bridge mobile road MRT incomplete')
    }
    else for (const divisor of BLOOM_TARGET_DIVISORS) {
      const [width, height] = bloomSize(w, h, divisor)
      this.bloomTargets.push(this.allocate(width, height, true)); yield
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.checkDraw = true
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Bridge backing allocation failed')
  }

  private input(p: Program, key: string, unit: number, t: WebGLTexture, target = this.gl.TEXTURE_2D as number): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t)
    if (p.units.get(key) !== unit) { gl.uniform1i(p.loc(key), unit); p.units.set(key, unit) }
  }

  private field(p: Program, f: BridgeFrame, cssW: number, cssH: number): void {
    const gl = this.gl, { cam } = f, roll = cam.rot ?? 0
    gl.uniform2f(p.loc('uView'), cssW, cssH); gl.uniform4f(p.loc('uCam'), cam.y, cam.zoom, Math.cos(roll), Math.sin(roll))
    gl.uniform1i(p.loc('uCount'), f.count); gl.uniform1i(p.loc('uRoofs'), f.roofs)
    gl.uniform4fv(p.loc('uLights[0]'), f.source); gl.uniform4fv(p.loc('uEnergy[0]'), f.energy); gl.uniform4fv(p.loc('uShape[0]'), f.shape)
    gl.uniform4fv(p.loc('uCover[0]'), f.cover)
    gl.uniform4fv(p.loc('uDirectBounds'), f.directBounds); gl.uniform4fv(p.loc('uEmissionBounds'), f.emissionBounds)
    gl.uniform4fv(p.loc('uWeatherBounds'), f.weatherBounds)
    gl.uniform1i(p.loc('uBlockerCount'), f.blockerCount)
    if (this.mode === 'mobile') gl.uniform2iv(p.loc('uFlashIDs'), f.mobileFlashIndices)
    gl.uniform4f(p.loc('uWeather'), f.weatherTime, f.wet, f.fog, f.key)
    gl.uniform4f(p.loc('uMood'), f.keyX, f.thunder, f.texOrigin, f.puddleOrigin)
  }

  /** Decided before actor rims and casts are painted. A held Mobile frame
   * keeps the sky's moon position and visibility, not just its pixels. */
  beginSky(flash: number, seed: number, w: number, h: number, quiet: boolean): boolean {
    this.skyDirty = this.skyClock.advance(Math.fround(flash), seed, w, h, quiet)
    return this.skyDirty
  }

  private skyUniforms(p: Program, f: BridgeFrame): void {
    const gl = this.gl, a = f.atmo
    gl.uniform4fv(p.loc('uAtmo'), a.key); gl.uniform4fv(p.loc('uAir'), a.air)
    gl.uniform3fv(p.loc('uLunarShift'), a.lunarShift)
    gl.uniform3fv(p.loc('uHazeColor'), a.hazeColor); gl.uniform2f(p.loc('uStorm'), a.epicenter, a.stormFalloff)
    gl.uniform2f(p.loc('uSkyView'), 1, +f.liveSky)
  }

  private receiverLighting(p: Program, f: BridgeFrame): void {
    const gl = this.gl
    this.skyUniforms(p, f)
    gl.uniform3fv(p.loc('uStormDir'), f.atmo.stormDir)
    const w = this.transport.current(f.seed), g = this.transport.group
    gl.uniform1f(p.loc('uEnvReady'), +!!w)
    gl.uniform2f(p.loc('uEnvWindow'), (w?.origin ?? 0) - f.cam.x, 1 / (w?.width ?? 1))
    gl.uniform1i(p.loc('u_CasterCount'), f.sacr.casters)
    gl.uniform2f(p.loc('u_SacrView'), f.sacr.pOffsetMeters, f.sacr.viewWidthMeters)
    this.input(p, 'uEnvBasis', 7, g.env)
    this.input(p, 'uIrradiance', 14, g.light)
    this.input(p, 'u_LightVectorGrid', 8, g.grid)
  }

  private bindSkyBasis(p: Program, f: BridgeFrame, first: number): void {
    const t = this.skyTextures
    this.input(p, 'uCloudBasis', first, t?.cloud ?? this.deck)
    this.input(p, 'uLunarBasis', first + 1, t?.lunar ?? this.deck)
    this.input(p, 'uHorizonBasis', first + 2, t?.horizon ?? this.deck)
    const gl = this.gl, a = f.atmo
    gl.uniform4fv(p.loc('uCirrus'), a.highDeck); gl.uniform4fv(p.loc('uBank'), a.stormDeck); gl.uniform4fv(p.loc('uMist'), a.mistDeck)
    gl.uniform4fv(p.loc('uCloudPhase'), a.cloudPhase)
    gl.uniform4fv(p.loc('uLunar'), a.moon); gl.uniform3fv(p.loc('uLunarSun'), a.sun)
    gl.uniform2fv(p.loc('uStars'), a.stars); gl.uniform2fv(p.loc('uLunarTurn'), a.lunarTurn)
    gl.uniform1f(p.loc('uSkySector'), a.look); gl.uniform1f(p.loc('uPhaseEnergy'), a.phaseEnergy)
    const cache = this.skyCache!
    const rows = cache.height * a.air[0] / Math.max(a.air[0], SKY_CACHE_CEILING)
    const aa = first === 0 ? .48 / Math.min(cache.width * a.moon[2], rows * a.moon[3]) : .69 / a.radius
    gl.uniform1f(p.loc('uLunarAA'), Math.min(.24, Math.max(.018, aa)))
  }

  /** Admit one resource on a quiet upload tick. During ordinary streaming
   * the base has Canvas sky until the full authored basis is resident. */
  private advanceSkyAssets(d: SkyBasis | null, quiet: boolean): boolean {
    const gl = this.gl
    if (this.skyTextures || !d || !quiet || this.transport.uploaded) return false
    const far = bridgePlate('l1'), mid = bridgePlate('l2')
    if (!far || !mid) return false
    const t = this.texture(gl.TEXTURE_2D)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.skyUpload >= 5)
    const data = (w: number, h: number, pixels: Uint8Array<ArrayBuffer>, repeat = true) => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      if (repeat) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      return t
    }
    const plate = (img: HTMLImageElement) => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      return t
    }
    const job = this.skyJob
    switch (this.skyUpload++) {
      case 0: job.cloud = data(CLOUD_W, CLOUD_ATLAS_H, d.cloud); break
      case 1: job.lunar = data(MOON_EDGE, MOON_EDGE, d.lunar, false); break
      case 2: job.horizon = data(HORIZON_W, HORIZON_H * HORIZON_SECTORS, d.horizon); break
      case 3: job.farBasis = data(CITY_MASK_W, CITY_MASK_H[0], d.city[0]); break
      case 4: job.midBasis = data(CITY_MASK_W, CITY_MASK_H[1], d.city[1]); break
      case 5: job.far = plate(far); break
      case 6: job.mid = plate(mid); break
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    if (this.skyUpload === 7) {
      const error = gl.getError()
      if (error !== gl.NO_ERROR) throw new Error(`Bridge sky texture upload: WebGL ${error}`)
      this.skyTextures = job as NonNullable<BridgePipeline['skyTextures']>
      this.cityBytes = (far.naturalWidth * far.naturalHeight + mid.naturalWidth * mid.naturalHeight) * 4
    }
    return true
  }

  private paintStratumA(f: BridgeFrame): void {
    const a = f.atmo, target = this.skyCache, gl = this.gl
    if (!f.liveSky || !this.skyTextures || !target) return
    if (!this.skyDirty) return
    const p = this.skyProgram
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.viewport(0, 0, target.width, target.height)
    gl.useProgram(p.handle)
    this.skyUniforms(p, f); this.bindSkyBasis(p, f, 0)
    this.fullscreen()
    this.skyFrame = a.receipt()
  }

  private uploadGlazing(f: BridgeFrame): void {
    const gl = this.gl, field = f.glass
    this.shopUpload = 0
    if (!field || this.shopUnavailable) return
    gl.activeTexture(gl.TEXTURE15)
    if (!this.shopTex) {
      let t: WebGLTexture
      try { t = this.texture(gl.TEXTURE_2D) } catch { this.shopUnavailable = true; return }
      this.shopTex = t
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GLASS_TILE_W, GLASS_TILE_H * SHOP_FRONT_LIMIT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      if (!gl.isContextLost() && gl.getError() !== gl.NO_ERROR) {
        // This optional optics allocation must never reject an opening.
        this.releaseTexture(t); this.shopTex = null; this.shopUnavailable = true
        return
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.shopTex)
    // The first tile is v=0 with world Y down. Premultiply numeric linear
    // radiance by coverage before bilinear interpolation at pane edges.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, field.canvas)
    } finally {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    }
    this.uploadBytes += (this.shopUpload = field.canvas.width * field.canvas.height * 4)
  }

  private bindGlazing(p: Program, f: BridgeFrame): void {
    const gl = this.gl, field = this.shopUpload ? f.glass : null
    this.input(p, 'uShopRadiance', 15, (field && this.shopTex) || this.deck)
    gl.uniform1i(p.loc('uShopFronts'), field?.count ?? 0)
    if (!field) return
    gl.uniform4fv(p.loc('uShopBounds[0]'), field.bounds)
    gl.uniform1fv(p.loc('uShopDistance[0]'), field.distance)
  }

  private baseLayers(f: BridgeFrame): void {
    const gl = this.gl, p = this.base, t = this.skyTextures
    this.receiverLighting(p, f)
    this.input(p, 'u_StratumA', 5, this.skyCache!.color)
    this.input(p, 'uCityFar', 2, t?.far ?? this.deck); this.input(p, 'uCityMid', 3, t?.mid ?? this.deck)
    this.input(p, 'uFarBasis', 9, t?.farBasis ?? this.deck); this.input(p, 'uMidBasis', 10, t?.midBasis ?? this.deck)
    this.bindSkyBasis(p, f, 11)
    this.bindGlazing(p, f)
    gl.uniform4fv(p.loc('uFarBand'), f.atmo.cityFar); gl.uniform4fv(p.loc('uMidBand'), f.atmo.cityMid)
  }

  private fullscreen(): void { this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); this.frameDraws++ }

  private blur(src: Target, dst: Target, pass: number, wide = src, tight = src): void {
    const gl = this.gl, p = this.filter
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0, 0, dst.width, dst.height)
    this.input(p, 'uInput', 0, src.color)
    this.input(p, 'uWide', 1, wide.color)
    this.input(p, 'uTight', 2, tight.color)
    gl.uniform2f(p.loc('uTexel'), 1 / src.width, 1 / src.height)
    gl.uniform1i(p.loc('uPass'), pass); this.fullscreen()
  }

  private particles(f: BridgeFrame, w: number, h: number, near: boolean, warm = false): void {
    if (!warm && f.rain < .025 && (!near || !f.ventCount && !f.impulseCount)) return
    const gl = this.gl, p = this.weather
    gl.useProgram(p.handle); this.field(p, f, w, h)
    gl.uniform1ui(p.loc('uSeed'), f.seed >>> 0); gl.uniform1f(p.loc('uTime'), f.weatherTime)
    gl.uniform1f(p.loc('uRainTime'), f.rainTime)
    // Rebase the wave phases as well as positions on long-travel views.
    gl.uniform3f(p.loc('uWindPhase'), f.cam.x * RAIN_GUST.x % (2 * Math.PI), f.cam.x * RAIN_GUST.y % (2 * Math.PI), +f.quiet)
    if (f.rain >= .025) for (let depth = near ? 2 : 0; depth < (near ? 3 : 2); depth++) {
      if (f.quiet && depth > 0) break
      const offset = (1 - RAIN_PLANES[depth].parallax) * f.cam.x
      const first = Math.floor((f.view.left - offset - 220) / RAIN_CELL)
      const last = Math.ceil((f.view.right - offset + 220) / RAIN_CELL)
      const cells = Math.max(1, last - first + 1)
      const count = Math.min(MASTER_RAIN_SLOTS[depth], cells * (f.quiet ? 4 : 32))
      gl.uniform1i(p.loc('uKind'), depth); gl.uniform1ui(p.loc('uStartCell'), first >>> 0)
      gl.uniform1i(p.loc('uCells'), cells)
      gl.uniform3f(p.loc('uRain'), first * RAIN_CELL + offset - f.cam.x, f.rain, f.wind)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      this.rainInstances += count; this.frameDraws++
    }
    if (warm && f.rain < .025) {
      // First use of the weather program on the actual HDR target. A clipped
      // instance warms the driver without adding weather to the frozen run.
      gl.uniform1i(p.loc('uKind'), 0); gl.uniform1i(p.loc('uCells'), 1)
      gl.uniform3f(p.loc('uRain'), -1e5, 0, 0)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1); this.frameDraws++
    }
    if (near && !f.quiet && (f.ventCount || f.impulseCount)) {
      gl.uniform1i(p.loc('uKind'), 3); gl.uniform3f(p.loc('uRain'), 0, f.rain, f.wind)
      gl.uniform1i(p.loc('uVentCount'), f.ventCount); gl.uniform3fv(p.loc('uVents[0]'), f.vents)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, MASTER_MOTE_SLOTS)
      this.moteInstances = MASTER_MOTE_SLOTS; this.frameDraws++
    }
  }

  private scissorRoad(f: BridgeFrame, cssH: number, target: Target): void {
    const gl = this.gl, { cam } = f, r = cam.rot ?? 0
    const co = Math.cos(r), si = Math.sin(r)
    const dx = Math.abs(si) * (f.view.right - f.view.left) * .5
    const one = (z: number) => .5 - (z - cam.y) * co * cam.zoom / cssH
    const a = one(ROAD.rear), b = one(ROAD.front), pad = dx * cam.zoom / cssH
    const from = Math.max(0, Math.floor((Math.min(a, b) - pad) * target.height) - 3)
    const to = Math.min(target.height, Math.ceil((Math.max(a, b) + pad) * target.height) + 3)
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, Math.min(from, target.height), target.width, Math.max(0, to - from))
  }

  /** Pass 3, Bridge Ground & Reflections. Identical evaluator and UBO on
   * both tiers. Mobile lowers only its receiver buffer and evaluation K. */
  private ground(f: BridgeFrame, cssW: number, cssH: number, scene: Target): void {
    const gl = this.gl, p = this.road, atlas = this.transport.current(f.seed), half = this.roadHalf
    const target = half ?? scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.viewport(0, 0, target.width, target.height)
    this.scissorRoad(f, cssH, target)
    gl.useProgram(p.handle); this.field(p, f, cssW, cssH)
    this.input(p, 'uBase', 0, this.baseTex); this.input(p, 'uDeckMask', 3, this.deck)
    this.input(p, 'u_StratumB', 4, this.transport.group.curb); this.input(p, 'u_StratumA', 5, this.skyCache!.color)
    this.receiverLighting(p, f)
    if (this.mode === 'master') {
      this.input(p, 'uMaterial', 2, this.material, gl.TEXTURE_2D_ARRAY)
      this.input(p, 'uRipple', 6, this.ripple)
      gl.uniform1i(p.loc('uLandingCount'), f.landingCount); gl.uniform4fv(p.loc('uLandings[0]'), f.landings)
    }
    gl.uniform1i(p.loc('u_SacrProbe'), 0)
    gl.uniform1f(p.loc('u_CamWorldX'), f.sacr.camWorldX); gl.uniform1f(p.loc('u_StratumOriginX'), atlas?.curbOrigin ?? 0)
    gl.uniform1f(p.loc('u_StratumWidthMeters'), atlas?.curbWidth ?? 1); gl.uniform1f(p.loc('u_CurbZ'), SACR_CURB_Z)
    gl.uniform1f(p.loc('u_StratumReady'), +!!atlas)
    this.fullscreen(); gl.disable(gl.SCISSOR_TEST)
    if (half) {
      const q = this.resolve
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo); gl.viewport(0, 0, scene.width, scene.height)
      this.scissorRoad(f, cssH, scene)
      gl.useProgram(q.handle); this.field(q, f, cssW, cssH)
      this.input(q, 'uBase', 0, this.baseTex); this.input(q, 'uRoadHalf', 1, half.color); this.input(q, 'uDeckMask', 3, this.deck)
      this.receiverLighting(q, f)
      this.input(q, 'uRoadVisibility', 6, this.roadLightHalf!.color)
      this.fullscreen(); gl.disable(gl.SCISSOR_TEST)
    }
  }

  private triangles(verts: Float32Array, count: number): void {
    const gl = this.gl
    gl.bindVertexArray(this.meshVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh)
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW, 0, count * BRIDGE_FACE_STRIDE)
    gl.drawArrays(gl.TRIANGLES, 0, count); this.frameDraws++
    gl.bindVertexArray(this.vao)
  }

  present(back: HTMLCanvasElement, actors: HTMLCanvasElement, f: BridgeFrame, cssW: number, cssH: number, opening = false): boolean {
    return finishPaint(this.presentSteps(back, actors, f, cssW, cssH, opening, false))
  }

  *presentSteps(back: HTMLCanvasElement, actors: HTMLCanvasElement, f: BridgeFrame, cssW: number, cssH: number,
    opening: boolean, cold: boolean): Generator<void, boolean> {
    const gl = this.gl, scene = this.scene, master = this.mode === 'master'
    if (!scene || gl.isContextLost()) return false
    const exercise = opening && !this.exercisedOpeningPrograms
    if (!opening) this.sizeOutput()
    this.frameDraws = this.rainInstances = this.moteInstances = 0
    // One DOM upload per source; never reflect or read back the finished scene.
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.baseTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, back)
    if (cold) yield
    gl.bindTexture(gl.TEXTURE_2D, this.actorTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, actors)
    this.uploadBytes = this.w * this.h * 8
    if (cold) yield
    this.uploadGlazing(f)
    if (cold) yield
    gl.bindVertexArray(this.vao); gl.disable(gl.BLEND)
    if (!opening) this.transport.advance(f.streamWindow, f.seed, f.uploadQuiet)
    const packet = f.sacr.packet, active = this.transport.current(f.seed)
    if (active) packet.u32.set(active.architecture, SACRUniformBuffer.OFF_ARCHPROFILE)
    else packet.clearArchitecture()
    packet.f32.set(f.blockerData, SACRUniformBuffer.OFF_BLOCKERS)
    uploadSACRFrame(gl, this.ubo!, packet)
    if (!opening) this.advanceSkyAssets(f.atmo.basis, f.uploadQuiet)
    this.paintStratumA(f)
    if (cold) yield
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo); gl.viewport(0, 0, this.w, this.h)
    gl.useProgram(this.base.handle); this.input(this.base, 'uBase', 0, this.baseTex); this.field(this.base, f, cssW, cssH)
    this.baseLayers(f); this.fullscreen()
    if (cold) yield
    if (master && (f.vertexCount || exercise)) {
      const p = this.receiver
      gl.useProgram(p.handle); this.input(p, 'uBase', 0, this.baseTex)
      this.input(p, 'uMaterial', 2, this.material, gl.TEXTURE_2D_ARRAY); this.field(p, f, cssW, cssH)
      this.receiverLighting(p, f)
      // Master receiver meshes replace the base shading for steel surrounds
      // and facade faces. Use the same aperture field on those fragments,
      // not an unglazed copy or a second upload of the pane tile.
      this.bindGlazing(p, f)
      this.triangles(f.vertexCount ? f.faces : this.warmTriangle, f.vertexCount || 3)
    }
    if (cold) yield
    this.ground(f, cssW, cssH, scene)
    if (cold) yield
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (master) this.particles(f, cssW, cssH, false, exercise)
    gl.useProgram(this.emission.handle); this.input(this.emission, 'uActors', 1, this.actorTex); this.field(this.emission, f, cssW, cssH)
    this.fullscreen()
    if (master && (f.trailVertices || exercise)) {
      gl.useProgram(this.trail.handle); this.field(this.trail, f, cssW, cssH)
      gl.blendFunc(gl.ONE, gl.ONE); this.triangles(f.trailVertices ? f.trail : this.warmTriangle, f.trailVertices || 3)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }
    if (master) this.particles(f, cssW, cssH, true)
    gl.disable(gl.BLEND)
    if (cold) yield
    if (master) {
      const [tight, medium, wide, bloom] = this.bloomTargets
      gl.useProgram(this.filter.handle)
      this.blur(scene, tight, 0)
      if (cold) yield
      this.blur(tight, medium, 1)
      if (cold) yield
      this.blur(medium, wide, 1)
      if (cold) yield
      // One no-feedback composition of the sharp core and both soft skirts.
      this.blur(medium, bloom, 2, wide, tight)
      if (cold) yield
    }
    if (opening) this.bindOpeningTarget()
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.w, this.h)
    const p = this.grade
    gl.useProgram(p.handle); this.input(p, 'uScene', 0, scene.color)
    if (master) this.input(p, 'uBloom', 1, this.bloomTargets[3].color)
    this.input(p, 'uActors', 6, this.actorTex); gl.uniform4fv(p.loc('uInkBox'), f.inkBox)
    for (let i = 0; i < LOOK_SAMPLERS.length; i++) this.input(p, LOOK_SAMPLERS[i], i + 2, this.looks[i], gl.TEXTURE_3D)
    gl.uniform4f(p.loc('uLook'), f.look, f.bossTint, f.fog, f.exposure)
    gl.uniform2f(p.loc('uView'), cssW, cssH)
    const a = f.cam.rot ?? 0
    gl.uniform4f(p.loc('uCam'), f.cam.y, f.cam.zoom, Math.cos(a), Math.sin(a))
    gl.uniform1i(p.loc('uGradeRoofs'), f.roofs)
    gl.uniform4fv(p.loc('uGradeCover[0]'), f.cover)
    this.fullscreen()
    if (this.checkDraw || opening) {
      this.checkDraw = false
      const error = gl.getError()
      if (error !== gl.NO_ERROR && !gl.isContextLost()) throw new Error(`Bridge first ${this.mode} draw: WebGL ${error}`)
    }
    if (gl.isContextLost()) return false
    if (this.openingFrame && opening) {
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      if (!fence) throw new Error('Bridge opening fence unavailable')
      this.openingFrame.fence = fence
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.flush()
      this.exercisedOpeningPrograms = true
    }
    return true
  }

  /** The sparse base is dead after composition. Grade into its RGBA8 storage
   * instead of allocating another full-size texture or touching Results. */
  private bindOpeningTarget(): void {
    const gl = this.gl, fbo = gl.createFramebuffer()
    if (!fbo) throw new Error('Bridge opening FBO unavailable')
    this.openingFrame = { fbo, fence: null }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.baseTex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Bridge opening FBO incomplete')
  }

  get hasOpeningFrame(): boolean { return !!this.openingFrame }

  openingFrameReady(): boolean {
    const gl = this.gl, fence = this.openingFrame?.fence
    if (!fence || gl.isContextLost()) throw new Error('Bridge opening GPU frame unavailable')
    const status = gl.clientWaitSync(fence, 0, 0)
    if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return true
    if (status === gl.TIMEOUT_EXPIRED) return false
    throw new Error('Bridge opening GPU frame failed')
  }

  private sizeOutput(): void {
    if (this.canvas.width !== this.w) this.canvas.width = this.w
    if (this.canvas.height !== this.h) this.canvas.height = this.h
    if (this.gl.drawingBufferWidth !== this.w || this.gl.drawingBufferHeight !== this.h) throw new RangeError('Bridge drawing buffer unavailable at requested size')
  }

  publishOpeningFrame(): void {
    const gl = this.gl, frame = this.openingFrame
    if (!frame || gl.isContextLost()) throw new Error('Bridge opening GPU frame lost before publish')
    this.sizeOutput()
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, frame.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const error = gl.getError()
    if (error !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`Bridge opening publish: WebGL ${error}`)
    this.discardOpeningFrame()
  }

  discardOpeningFrame(): void {
    const frame = this.openingFrame
    if (!frame) return
    this.openingFrame = null
    this.gl.deleteSync(frame.fence); this.gl.deleteFramebuffer(frame.fbo)
  }

  retireRoute(): void {
    this.discardOpeningFrame()
    this.transport?.retire()
    this.skyClock.invalidate()
    this.skyFrame = null
  }

  /** Wait for resident opening optics, not just a decoded worker reply.
   * Denied sources keep the already-supported procedural path.
   * Run at most one asset upload per preparation tick. */
  openingAssetsReady(window: BakeWindow | null, seed: number, skySettled: boolean): boolean {
    if (this.hasOpeningFrame) return true
    if (window) this.transport.advance(window, seed, true)
    else this.transport.retire() // none covers the current opening view
    if (this.transport.uploaded || !skySettled) return false
    const basis = bridgeSkyBasis()
    if (this.advanceSkyAssets(basis, true)) return false
    return true
  }

  transportWindow(seed: number) { return this.transport?.current(seed) ?? null }

  receipt() {
    const master = this.mode === 'master'
    const targetBytes = this.targets.reduce((a, t) => a + t.width * t.height * t.bytesPerPixel, 0)
    const dataBytes = 4 * (master ? 32 : 16) ** 3 * 4 + SACRUniformBuffer.BYTE_LENGTH + 2 * WINDOW_BYTES + (this.skyTextures ? SKY_BASIS_BYTES + this.cityBytes : 0) + Math.ceil((PUDDLE_PITCH * DECK_MASK_H + (master ? MATERIAL_COUNT * MATERIAL_TILE ** 2 + 64 ** 2 / 2 : 0)) * 4 * 4 / 3)
    const shopBytes = this.shopTex ? GLASS_TILE_W * GLASS_TILE_H * SHOP_FRONT_LIMIT * 4 : 0
    return { programs: this.programs.map(p => p.name), size: [this.w, this.h], format: master ? 'RGBA16F' : 'RGBA8', hdrBytes: master ? targetBytes : 0, targetBytes, dataBytes: dataBytes + shopBytes,
      glazing: { bytes: shopBytes, uploadBytes: this.shopUpload },
      outputBytes: this.w * this.h * 4, sourceTextureBytes: this.w * this.h * 8, uploadBytes: this.uploadBytes,
      setupMs: { ...this.setupMs }, frameDraws: this.frameDraws, rainInstances: this.rainInstances, moteInstances: this.moteInstances,
      bloomLevels: master ? BLOOM_DIVISORS.length : 0, bloomUpPasses: 0,
      bloom: master ? { targets: this.bloomTargets.map(t => [t.width, t.height]), divisors: BLOOM_TARGET_DIVISORS,
        format: this.packedBloom ? 'R11F_G11F_B10F' : 'RGBA16F',
        bytes: this.bloomTargets.reduce((n, t) => n + t.width * t.height * t.bytesPerPixel, 0),
        passes: BLOOM_DIVISORS.length + 1, downPasses: BLOOM_DIVISORS.length, upPasses: 0, compositeTaps: 3 } : null,
      roadSize: this.roadHalf ? [this.roadHalf.width, this.roadHalf.height] : [this.w, this.h], maxK: master ? SACR_MASTER_K : SACR_MOBILE_K,
      uboBytes: SACRUniformBuffer.BYTE_LENGTH, uboOffsets: this.uboOffsets.slice(), stratumVersion: this.transport.receipt().active, transport: this.transport.receipt(),
      stratumA: this.skyCache && { size: [this.skyCache.width, this.skyCache.height], format: master ? 'RGBA16F' : 'RGBA8', opticalCeiling: SKY_CACHE_CEILING,
        frames: this.skyClock.frames, refreshes: this.skyClock.updates, refreshed: this.skyDirty, live: !!this.skyTextures, ...this.skyFrame },
      packedAssets: { city: this.skyTextures ? 'shared-webp' : 'canvas', deck: this.deckSource, lut: this.lutSources.every(s => s === this.lutSources[0]) ? this.lutSources[0] : 'mixed', lutVolumes: this.lutSources.slice() },
      environment: { format: 'RGBA8', irradiance: 'RGB9_E5', blockerLimit: BLOCKER_LIMIT, size: [ENV_W, ENV_H], version: this.transport.receipt().active, vectors: [VECTOR_ATLAS_W, VECTOR_H],
        skyBands: [[CITY_MASK_W, CITY_MASK_H[0]], [CITY_MASK_W, CITY_MASK_H[1]]],
        castCoverage: null, sourcePass: 'SACR v4 road', shadowLights: master ? 2 : 1 },
      sectorLut: master ? [1024, 32] : [256, 16] }
  }

  dispose(): void {
    const gl = this.gl
    this.releaseTargets()
    gl.disable(gl.SCISSOR_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null); gl.useProgram(null); gl.bindBuffer(gl.ARRAY_BUFFER, null)
    if (this.vao) gl.deleteVertexArray(this.vao)
    if (this.meshVao) gl.deleteVertexArray(this.meshVao)
    if (this.mesh) gl.deleteBuffer(this.mesh)
    if (this.ubo) gl.deleteBuffer(this.ubo)
    for (const t of this.textures) gl.deleteTexture(t)
    for (const p of this.programs) gl.deleteProgram(p.handle)
    this.textures.length = this.programs.length = this.looks.length = 0
    this.w = this.h = this.frameDraws = this.uploadBytes = 0
  }
}
