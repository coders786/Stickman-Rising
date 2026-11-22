import { GPU_ACTOR_CAPACITY, GPU_ACTOR_STRIDE, type GPUActorBatch } from '../game/render/gpu-actor-batch'

/** Diagnostic overlay only. The real Canvas remains present beneath it. */
export class BridgeActorPrototype {
  private vao: WebGLVertexArrayObject | null = null
  private buffer: WebGLBuffer | null = null
  private readonly view: WebGLUniformLocation | null
  private readonly cam: WebGLUniformLocation | null

  constructor(private readonly gl: WebGL2RenderingContext, private readonly program: WebGLProgram) {
    this.view = gl.getUniformLocation(program, 'uView')
    this.cam = gl.getUniformLocation(program, 'uCam')
    try {
      this.vao = gl.createVertexArray(); this.buffer = gl.createBuffer()
      if (!this.vao || !this.buffer) throw new Error('Bridge actor prototype allocation failed')
      gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
      gl.bufferData(gl.ARRAY_BUFFER, GPU_ACTOR_CAPACITY * GPU_ACTOR_STRIDE * 4, gl.DYNAMIC_DRAW)
      for (const [index, size, offset] of [[0, 4, 0], [1, 2, 16], [2, 4, 24]] as const) {
        gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, size, gl.FLOAT, false, GPU_ACTOR_STRIDE * 4, offset)
        gl.vertexAttribDivisor(index, 1)
      }
      gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null)
    } catch (error) { this.dispose(); throw error }
  }

  /** Return false for incomplete packets: never draw a truncated figure. */
  draw(batch: GPUActorBatch, w: number, h: number, y: number, zoom: number, roll: number): boolean {
    if (batch.overflow || !batch.count || !this.vao || !this.buffer) return false
    const gl = this.gl
    gl.useProgram(this.program); gl.uniform2f(this.view, w, h)
    gl.uniform4f(this.cam, y, zoom, Math.cos(roll), Math.sin(roll))
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.count * GPU_ACTOR_STRIDE)
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null)
    return true
  }

  dispose(): void {
    if (this.vao) this.gl.deleteVertexArray(this.vao)
    if (this.buffer) this.gl.deleteBuffer(this.buffer)
    this.vao = null; this.buffer = null
  }
}

export function actorPrototypeEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bridgeActorDebug') === '1'
}
