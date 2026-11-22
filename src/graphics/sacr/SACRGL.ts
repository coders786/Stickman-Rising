import { SACR_UBO_BINDING, SACRUniformBuffer } from './SACRPacker'
import { STRATUM_H, STRATUM_MAX_LOD, STRATUM_W, type StratumMip } from './SACRAtlas'

const layout = [
  ['u_ColBins[0]', 0], ['u_PrimPool[0]', 640], ['u_ArchProfile[0]', 1664], ['u_FootAO[0]', 2176], ['u_ShadowBins[0]', 2432], ['u_DynamicBlockers[0]', 3072], ['u_Supports[0]', 3456],
] as const

/** Fail closed on driver layout drift. Query once when linking, not per frame. */
export function bindSACRBlock(gl: WebGL2RenderingContext, program: WebGLProgram): number[] {
  const block = gl.getUniformBlockIndex(program, 'SACR_v40_UBO')
  if (block === gl.INVALID_INDEX || gl.getActiveUniformBlockParameter(program, block, gl.UNIFORM_BLOCK_DATA_SIZE) !== SACRUniformBuffer.BYTE_LENGTH) {
    throw new Error('SACR std140 block is not 3584 bytes')
  }
  const names = layout.map(([name]) => name)
  let indices = gl.getUniformIndices(program, names)
  if (indices?.some(n => n === gl.INVALID_INDEX)) indices = gl.getUniformIndices(program, names.map(n => `SACR_v40_UBO.${n}`))
  if (!indices || indices.some(n => n === gl.INVALID_INDEX)) throw new Error('SACR std140 member missing')
  const offsets = Array.from(gl.getActiveUniforms(program, indices, gl.UNIFORM_OFFSET) ?? []) as number[]
  const strides = Array.from(gl.getActiveUniforms(program, indices, gl.UNIFORM_ARRAY_STRIDE) ?? []) as number[]
  if (layout.some(([, bytes], i) => offsets[i] !== bytes || strides[i] !== 16)) throw new Error(`SACR std140 offsets/strides: ${offsets}/${strides}`)
  gl.uniformBlockBinding(program, block, SACR_UBO_BINDING)
  return offsets
}

export function allocateSACRBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('SACR uniform buffer allocation failed')
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer)
  gl.bufferData(gl.UNIFORM_BUFFER, SACRUniformBuffer.BYTE_LENGTH, gl.DYNAMIC_DRAW)
  return buffer
}

export function uploadSACRFrame(gl: WebGL2RenderingContext, buffer: WebGLBuffer, frame: SACRUniformBuffer): void {
  gl.bindBufferBase(gl.UNIFORM_BUFFER, SACR_UBO_BINDING, buffer)
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer)
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, frame.u32)
}

/** The mip chain is explicitly limited to the four validated CPU levels. */
export function uploadStratumB(gl: WebGL2RenderingContext, tex: WebGLTexture, mips: readonly StratumMip[], replace = false): void {
  if (mips.length !== STRATUM_MAX_LOD + 1 || mips.some((m, l) => m.w !== STRATUM_W >> l || m.h !== STRATUM_H >> l || m.data.length !== m.w * m.h)) {
    throw new RangeError('Incomplete Stratum B mip chain')
  }
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean
  const premul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, STRATUM_MAX_LOD)
    for (let i = 0; i <= STRATUM_MAX_LOD; i++) {
      const { w, h, data } = mips[i]
      if (replace) gl.texSubImage2D(gl.TEXTURE_2D, i, 0, 0, w, h, gl.RGB, gl.UNSIGNED_INT_5_9_9_9_REV, data)
      else gl.texImage2D(gl.TEXTURE_2D, i, gl.RGB9_E5, w, h, 0, gl.RGB, gl.UNSIGNED_INT_5_9_9_9_REV, data)
    }
  } finally {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul)
  }
  const error = gl.getError()
  if (error !== gl.NO_ERROR) throw new Error(`SACR Stratum B upload: WebGL ${error}`)
}
