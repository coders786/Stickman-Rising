import { VECTOR_ATLAS_W, VECTOR_H } from '../graphics/bridge/LightVectorGrid'
import { encodeRGB9E5 } from '../graphics/sacr/SACRAtlas'
import { BRIDGE_PROGRAMS } from '../gpu/bridge-programs'
import { finishProgram, linkProgram, queueProgram } from '../gpu/program'
import { SACR_CURB_Z } from '../graphics/sacr/SACRMath'
import { allocateSACRBuffer, bindSACRBlock, uploadSACRFrame, uploadStratumB } from '../graphics/sacr/SACRGL'
import { SACR_MASTER_K, SACR_MOBILE_K } from '../graphics/sacr/SACRPacker'
import { PROBE_ATLAS_ORIGIN, PROBE_ATLAS_WIDTH, PROBE_SIZE, PROBE_WIDTH_METRES, PROBE_WORLD_X,
  MOBILE_PROBE_COUNT, SACR_PROBE_IDS, SACR_PROBES, PROBE_VECTOR_WORDS, PROBE_IRR, probeExpected, probeMips, probePacket, type ProbePixel } from './sacr-probes'

type ProbeFormat = 'RGBA16F' | 'RGBA8'
type ProbeResult = { tier: string; format: ProbeFormat; name: string; pass: boolean; maxError: number; worstPixel: number[];
  left: ProbePixel; right: ProbePixel; glError: number }
export type DriverResult = { ok: boolean; renderer: string; formats: Record<string, ProbeFormat>; linked: string[];
  offsets: Record<string, number[]>; mips: number[][]; probes: ProbeResult[]; errors: string[] }

const N = PROBE_SIZE
const round = (n: number) => Math.round(n * 1e4) / 1e4

/** A separately owned context; test-only uniforms and readPixels cannot
 * stall, pollute or steal the live presenter's context/UBO/atlas state. */
export function* driverProbeSteps(): Generator<void, DriverResult> {
  const result: DriverResult = { ok: false, renderer: '', formats: {}, linked: [], offsets: {}, mips: [], probes: [], errors: [] }
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(N, N)
  c.width = c.height = N
  const gl = c.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null
  if (!gl) { result.errors.push('WebGL2 not available in this browser'); return result }
  const programs = new Map<string, WebGLProgram>(), textures: WebGLTexture[] = []
  let ubo: WebGLBuffer | null = null, fbo: WebGLFramebuffer | null = null, vao: WebGLVertexArrayObject | null = null
  function glOK(stage: string) {
    const code = gl!.getError()
    if (code !== gl!.NO_ERROR) throw new Error(`${stage}: GL error 0x${code.toString(16)}`)
  }
  function tex(target: number, unit: number) {
    const t = gl!.createTexture()
    if (!t) throw new Error('Probe texture allocation')
    textures.push(t)
    gl!.activeTexture(gl!.TEXTURE0 + unit); gl!.bindTexture(target, t)
    gl!.texParameteri(target, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST)
    gl!.texParameteri(target, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST)
    return t
  }
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    result.renderer = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)
    const parallel = gl.getExtension('KHR_parallel_shader_compile')
    for (const [name, [vert, frag]] of Object.entries(BRIDGE_PROGRAMS)) {
      try {
        const p = parallel ? queueProgram(gl, vert, frag, name) : linkProgram(gl, vert, frag, name)
        programs.set(name, p)
        if (!parallel) result.linked.push(name)
      } catch (err) { result.errors.push(String(err)) }
      yield
    }
    if (parallel) {
      gl.flush() // submit queued links before asynchronous completion polls
      for (const [name, program] of programs) {
        while (!gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
          if (gl.isContextLost()) throw new Error('Diagnostic WebGL context lost')
          yield
        }
        try { finishProgram(gl, program, name); result.linked.push(name) }
        catch (err) { result.errors.push(String(err)) }
        yield
      }
    }
    glOK('compile/link')
    vao = gl.createVertexArray(); fbo = gl.createFramebuffer()
    if (!vao || !fbo) throw new Error('Probe VAO/FBO allocation')
    gl.bindVertexArray(vao); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, N, N)
    gl.disable(gl.BLEND); gl.disable(gl.DITHER); gl.disable(gl.SCISSOR_TEST)
    const color = tex(gl.TEXTURE_2D, 7)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0)
    const canFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
    // Use the real native formats: HDR for Master, normalized RGBA8 for
    // Mobile. If a device cannot render/read half float, still test the
    // Master evaluator in RGBA8 and report that distinction.
    const probeTarget = (float: boolean) => {
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, color)
      if (float && canFloat) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, N, 0, gl.RGBA, gl.HALF_FLOAT, null)
        if (gl.getError() === gl.NO_ERROR && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
          const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE)
          if (gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) === gl.RGBA && (type === gl.FLOAT || type === gl.HALF_FLOAT)) {
            return { format: 'RGBA16F' as const, type }
          }
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      glOK('RGBA8 probe allocation')
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Probe FBO incomplete')
      return { format: 'RGBA8' as const, type: gl.UNSIGNED_BYTE }
    }
    const mips = probeMips()
    const stratum = tex(gl.TEXTURE_2D, 4)
    uploadStratumB(gl, stratum, mips)
    result.mips = mips.map(m => [m.w, m.h])
    ubo = allocateSACRBuffer(gl)
    // Even if the probe branch bypasses material inputs, an ES3 program
    // still needs distinct units for different active sampler types.
    tex(gl.TEXTURE_2D, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]))
    tex(gl.TEXTURE_2D_ARRAY, 2)
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(8))
    tex(gl.TEXTURE_2D, 8)
    const vectors = new Uint8Array(VECTOR_ATLAS_W * VECTOR_H * 4)
    const [a, b] = PROBE_VECTOR_WORDS
    for (let i = 0; i < vectors.length; i += 4) {
      vectors[i] = a & 255; vectors[i + 1] = a >>> 8; vectors[i + 2] = b & 255; vectors[i + 3] = b >>> 8
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, VECTOR_ATLAS_W, VECTOR_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, vectors)
    tex(gl.TEXTURE_2D, 11)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB9_E5, 1, 1, 0, gl.RGB, gl.UNSIGNED_INT_5_9_9_9_REV, new Uint32Array([encodeRGB9E5(...PROBE_IRR)]))
    tex(gl.TEXTURE_2D, 12)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 64, 212, 0]))
    glOK('RGB9_E5 / packed light-vector upload')
    for (const [name, maxK] of [['masterRoad', SACR_MASTER_K], ['mobileRoad', SACR_MOBILE_K]] as const) {
      const p = programs.get(name)
      if (!p) continue
      try {
        const { format, type: readType } = probeTarget(maxK === SACR_MASTER_K)
        result.formats[name] = format
        result.offsets[name] = bindSACRBlock(gl, p)
        gl.useProgram(p)
        const loc = (key: string) => gl.getUniformLocation(p, key)
        gl.uniform1i(loc('u_StratumB'), 4); gl.uniform1i(loc('uMaterial'), 2)
        gl.uniform1f(loc('u_StratumReady'), 1)
        gl.uniform1i(loc('u_LightVectorGrid'), 8); gl.uniform1i(loc('uIrradiance'), 11); gl.uniform1i(loc('uEnvBasis'), 12)
        gl.uniform1f(loc('uEnvReady'), 1); gl.uniform2f(loc('uEnvWindow'), -20, 1 / 40)
        gl.uniform1i(loc('u_CasterCount'), 1); gl.uniform2i(loc('uFlashIDs'), -1, -1)
        gl.uniform2f(loc('u_SacrView'), PROBE_WIDTH_METRES * .5, PROBE_WIDTH_METRES)
        gl.uniform1f(loc('u_CamWorldX'), PROBE_WORLD_X); gl.uniform1f(loc('u_StratumOriginX'), PROBE_ATLAS_ORIGIN)
        gl.uniform1f(loc('u_StratumWidthMeters'), PROBE_ATLAS_WIDTH); gl.uniform1f(loc('u_CurbZ'), SACR_CURB_Z)
        const data = readType === gl.FLOAT ? new Float32Array(N * N * 4) : readType === gl.HALF_FLOAT ? new Uint16Array(N * N * 4) : new Uint8Array(N * N * 4)
        const value = (index: number) => data instanceof Uint8Array ? data[index] / 255 :
          data instanceof Uint16Array ? halfAt(data[index]) : data[index]
        const pixel = (x: number, y: number): ProbePixel => {
          const i = (y * N + x) * 4
          return [round(value(i)), round(value(i + 1)), round(value(i + 2)), round(value(i + 3))]
        }
        for (const [j, probeName] of SACR_PROBES.entries()) {
          if (maxK === SACR_MOBILE_K && j >= MOBILE_PROBE_COUNT) break
          const probe = SACR_PROBE_IDS[j], packet = probePacket(probe, maxK)
          gl.uniform1i(loc('u_SacrProbe'), probe)
          gl.uniform1i(loc('uBlockerCount'), +(probe === 8))
          uploadSACRFrame(gl, ubo, packet); glOK(`${name}/${probeName} UBO upload`)
          // A sentinel clear makes a skipped/lost draw fail the comparison.
          gl.clearColor(.99, .02, .66, .27); gl.clear(gl.COLOR_BUFFER_BIT)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          gl.readPixels(0, 0, N, N, gl.RGBA, readType, data)
          const glError = gl.getError()
          let maxError = 0, worstPixel = [0, 0, 0]
          const tolerance = format === 'RGBA16F' ? .007 : .009 // interpolation and 8/16-bit target rounding
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const expected = probeExpected(packet, mips, maxK, probe, (x + .5) / N, (y + .5) / N)
            for (let k = 0; k < 4; k++) {
              const d = Math.abs(value((y * N + x) * 4 + k) - expected[k])
              if (!Number.isFinite(d) || d > maxError) { maxError = Number.isFinite(d) ? d : Number.MAX_VALUE; worstPixel = [x, y, k] }
            }
          }
          const left = probe === 10 ? pixel(0, 10) : pixel(5, 3)
          const right = probe === 9 ? pixel(12, 11) : probe === 10 ? pixel(15, 10) : pixel(13, 3)
          result.probes.push({ tier: name, format, name: probeName, pass: glError === gl.NO_ERROR && !gl.isContextLost() && maxError <= tolerance,
            glError, maxError: round(maxError), worstPixel, left, right })
          yield
        }
      } catch (err) { result.errors.push(`${name}: ${String(err)}`) }
    }
    result.ok = result.linked.length === Object.keys(BRIDGE_PROGRAMS).length && !result.errors.length &&
      result.probes.length === SACR_PROBES.length + MOBILE_PROBE_COUNT && result.probes.every(v => v.pass)
  } catch (err) { result.errors.push(String(err)) }
  finally {
    gl.useProgram(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null)
    if (fbo) gl.deleteFramebuffer(fbo)
    if (vao) gl.deleteVertexArray(vao)
    if (ubo) gl.deleteBuffer(ubo)
    for (const t of textures) gl.deleteTexture(t)
    for (const p of programs.values()) gl.deleteProgram(p)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    c.width = c.height = 0
  }
  return result
}

// Synchronous entry retained for standalone callers. The UI uses sliced steps.
export function runDriverProbes(): DriverResult {
  const steps = driverProbeSteps()
  for (;;) { const next = steps.next(); if (next.done) return next.value }
}

// Local half readback is independent of the packet encoder and exercises
// the driver's half target even when FLOAT readPixels is unavailable.
function halfAt(word: number): number {
  const e = (word >>> 10) & 31, f = word & 1023
  return (word & 32768 ? -1 : 1) * (e === 31 ? f ? NaN : Infinity : e ? (1024 + f) * 2 ** (e - 25) : f * 2 ** -24)
}
