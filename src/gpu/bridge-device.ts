export type BridgeDevice = 'hardware' | 'software' | 'unknown'

export const BRIDGE_GL_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
  preserveDrawingBuffer: false, powerPreference: 'high-performance',
}

export function describeBridgeAdapter(gl: WebGL2RenderingContext): BridgeDevice {
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
  if (typeof renderer !== 'string' || !renderer.trim()) return 'unknown'
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer) ? 'software' : 'hardware'
}
