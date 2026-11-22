/** Same compiler/linker for live presentation and the opt-in driver test. */
export function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, label: string): WebGLProgram {
  const shaders: WebGLShader[] = []
  let handle: WebGLProgram | null = null, linked = false
  try {
    for (const [kind, src] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(kind)
      if (!shader) throw new Error(`${label}: shader allocation failed`)
      shaders.push(shader); gl.shaderSource(shader, src); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`${label} (${kind === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}): ${gl.getShaderInfoLog(shader)}`)
      }
    }
    handle = gl.createProgram()
    if (!handle) throw new Error(`${label}: program allocation failed`)
    for (const shader of shaders) gl.attachShader(handle, shader)
    gl.linkProgram(handle)
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(`${label} link: ${gl.getProgramInfoLog(handle)}`)
    linked = true
    return handle
  } finally {
    for (const shader of shaders) {
      if (handle && linked) gl.detachShader(handle, shader)
      gl.deleteShader(shader)
    }
    if (handle && !linked) gl.deleteProgram(handle)
  }
}

/** KHR_parallel_shader_compile: enqueue/link without asking for status yet.
 * Attached, delete-marked shaders are retained by GL until detached. */
export function queueProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, label: string): WebGLProgram {
  const p = gl.createProgram()
  if (!p) throw new Error(`${label}: program allocation failed`)
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const s = gl.createShader(kind)
      if (!s) throw new Error(`${label}: shader allocation failed`)
      try { gl.shaderSource(s, source); gl.compileShader(s); gl.attachShader(p, s) }
      finally { gl.deleteShader(s) }
    }
    gl.linkProgram(p)
    return p
  } catch (error) { gl.deleteProgram(p); throw error }
}

export function finishProgram(gl: WebGL2RenderingContext, handle: WebGLProgram, label: string): void {
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(`${label} link: ${gl.getProgramInfoLog(handle)}`)
  for (const shader of gl.getAttachedShaders(handle) ?? []) gl.detachShader(handle, shader)
}
