import { BRIDGE_GL_ATTRIBUTES, describeBridgeAdapter, type BridgeDevice } from './bridge-device'

let device: BridgeDevice = 'unknown'
try {
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2', BRIDGE_GL_ATTRIBUTES)
  if (gl) {
    device = describeBridgeAdapter(gl)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
} catch { /* Keep the normal guarded DOM path if workers cannot use WebGL. */ }
self.postMessage(device)
