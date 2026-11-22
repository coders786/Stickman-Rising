import type { BakeWindow } from '../graphics/bridge/BridgeBakeProtocol'
import { LIGHT_LOD } from '../graphics/bridge/BridgeBakeProtocol'
import { ENV_H, ENV_W } from '../graphics/bridge/EnvBasis'
import { VECTOR_ATLAS_W, VECTOR_H } from '../graphics/bridge/LightVectorGrid'
import { STRATUM_H, STRATUM_MAX_LOD, STRATUM_W } from '../graphics/sacr/SACRAtlas'

const STREAM_LEVELS = 2 + (LIGHT_LOD + 1) + (STRATUM_MAX_LOD + 1)
interface Group { env: WebGLTexture; light: WebGLTexture; grid: WebGLTexture; curb: WebGLTexture }

/** One staged upload (one texture/mip) per quiet present. The shader sees
 * either the complete old group, or the complete new group with its own
 * origin and portal records — never a mismatched light/visibility pair. */
export class BridgeTextureStream {
  private readonly slots: readonly [Group, Group]
  private active = 0
  private staged: BakeWindow | null = null
  private step = 0
  private ready: BakeWindow | null = null
  private total = 0
  private deferred = 0
  private bytes = 0
  private uploadMs = 0
  private commits = 0
  get uploaded() { return this.bytes !== 0 }
  get group() { return this.slots[this.active] }
  current(seed: number) { return this.ready?.seed === seed ? this.ready : null }

  constructor(private readonly gl: WebGL2RenderingContext, texture: () => WebGLTexture) {
    const array = (levels: number, format: number, w: number, h: number, packed = false) => {
      const t = texture()
      gl.texStorage2D(gl.TEXTURE_2D, levels, format, w, h)
      if (packed) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      } else if (levels > 1) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      }
      return t
    }
    const group = () => ({ env: array(1, gl.RGBA8, ENV_W, ENV_H),
      light: array(LIGHT_LOD + 1, gl.RGB9_E5, ENV_W, ENV_H), grid: array(1, gl.RGBA8, VECTOR_ATLAS_W, VECTOR_H, true),
      curb: array(STRATUM_MAX_LOD + 1, gl.RGB9_E5, STRATUM_W, STRATUM_H) })
    this.slots = [group(), group()]
  }

  /** Retry retires run ownership even when the deterministic seed repeats.
   * Retain storage and program residency, not previous window addresses. */
  retire(): void { this.ready = this.staged = null; this.step = this.bytes = this.uploadMs = 0 }

  /** If the camera teleports, don't finish an obsolete group or use it at
   * the new location. The shaders' bounded atlas coordinates fail dark. */
  advance(w: BakeWindow | null, seed: number, safe: boolean): void {
    this.bytes = 0; this.uploadMs = 0
    if (this.staged && this.staged.seed !== seed) { this.staged = null; this.step = 0 }
    if (w && w !== this.ready && w !== this.staged) { this.staged = w; this.step = 0 }
    const staged = this.staged
    if (!staged) return
    if (!safe) { this.deferred++; return }
    const gl = this.gl, slot = this.slots[1 - this.active], t = performance.now()
    gl.activeTexture(gl.TEXTURE0); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    if (this.step < 2) {
      const shadow = this.step === 0
      gl.bindTexture(gl.TEXTURE_2D, shadow ? slot.env : slot.grid)
      const data = shadow ? staged.shadow : staged.vectors
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, shadow ? ENV_W : VECTOR_ATLAS_W, shadow ? ENV_H : VECTOR_H, gl.RGBA, gl.UNSIGNED_BYTE, data)
      this.bytes = data.byteLength
    } else {
      const i = this.step - 2, light = i <= LIGHT_LOD, level = light ? i : i - LIGHT_LOD - 1
      const m = (light ? staged.light : staged.curb)[level]
      gl.bindTexture(gl.TEXTURE_2D, light ? slot.light : slot.curb)
      gl.texSubImage2D(gl.TEXTURE_2D, level, 0, 0, m.w, m.h, gl.RGB, gl.UNSIGNED_INT_5_9_9_9_REV, m.data)
      this.bytes = m.data.byteLength
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    this.total++; this.uploadMs = performance.now() - t
    if (++this.step === STREAM_LEVELS) {
      const error = gl.getError()
      if (error !== gl.NO_ERROR) throw new Error(`Bridge streaming upload: WebGL ${error}`)
      this.ready = staged; this.active = 1 - this.active; this.staged = null; this.commits++
    }
  }

  receipt() { return { active: this.ready?.id ?? null, origin: this.ready?.origin ?? null, staging: this.staged?.id ?? null,
    stagingLevel: this.staged ? this.step : null, uploads: this.total, updates: this.commits, quietDeferrals: this.deferred,
    uploadThisFrame: Number(this.bytes > 0), uploadBytesThisFrame: this.bytes, uploadMs: this.uploadMs, levels: STREAM_LEVELS } }
}
