import { BridgeEnvAtlas, ENV_H, ENV_W, LIGHT_H } from './EnvBasis'
import { BridgeStratum } from '../sacr/BridgeStratum'
import { SACRUniformBuffer } from '../sacr/SACRPacker'
import { encodeRGB9E5, type StratumMip } from '../sacr/SACRAtlas'
import type { BridgeRoute } from '../../game/stage/route'
import { packBake } from './BridgeLZ4'
import { LIGHT_LOD, WINDOW_BYTES, type BakeReply } from './BridgeBakeProtocol'

const EXP = Float32Array.from({ length: 32 }, (_, i) => 2 ** (i - 24) * .25)

/** Separate filtering in two receiver bands. The height grid and the
 * perspective road strip must never bleed through their atlas seam. */
export function prefilterIrradiance(base: Uint32Array<ArrayBuffer>): StratumMip[] {
  const chain: StratumMip[] = [{ w: ENV_W, h: ENV_H, data: base }]
  for (let l = 1; l <= LIGHT_LOD; l++) {
    const old = chain[l - 1], w = old.w >> 1, h = old.h >> 1, data = new Uint32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = y * 2 * old.w + x * 2
      let r = 0, g = 0, b = 0
      for (let i = 0; i < 4; i++) {
        const n = old.data[a + (i & 1) + (i >> 1) * old.w], s = EXP[n >>> 27]
        r += (n & 511) * s; g += (n >>> 9 & 511) * s; b += (n >>> 18 & 511) * s
      }
      data[y * w + x] = encodeRGB9E5(r, g, b)
    }
    if (LIGHT_H % (1 << l)) throw new Error('Irradiance mip crossed receiver band')
    chain.push({ w, h, data })
  }
  return chain
}

export class BridgeWindowBake {
  private readonly env = new BridgeEnvAtlas()
  private readonly curb = new BridgeStratum()
  private readonly packet = new SACRUniformBuffer()
  constructor(private readonly route: BridgeRoute) {}

  bake(id: number, left: number, right: number, archive = true): BakeReply & { type: 'window' } {
    const t = performance.now(), { env, curb, route, packet } = this
    env.update(route, left, right)
    curb.update(route, left, right, packet)
    const light = prefilterIrradiance(env.light)
    const payload = new Uint8Array(WINDOW_BYTES)
    let off = 0
    const put = (a: Uint8Array | Uint32Array) => { payload.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), off); off += a.byteLength }
    put(env.data); put(env.vectors)
    put(packet.u32.subarray(SACRUniformBuffer.OFF_ARCHPROFILE, SACRUniformBuffer.OFF_FOOTAO))
    for (const m of light) put(m.data)
    for (const m of curb.mips) put(m.data)
    const blob = archive ? packBake(payload.buffer) : { rawSize: WINDOW_BYTES, lz4: false, bytes: payload }
    return { type: 'window', id, seed: route.seed, origin: env.origin, width: env.width,
      curbOrigin: curb.originX, curbWidth: curb.widthMeters, blob, bakeMs: performance.now() - t }
  }
}
