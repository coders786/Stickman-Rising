import { ENV_H, ENV_W } from './EnvBasis'
import { VECTOR_ATLAS_W, VECTOR_H } from './LightVectorGrid'
import { unpackBake, type PackedBake } from './BridgeLZ4'
import { STRATUM_W, STRATUM_H, STRATUM_MAX_LOD, type StratumMip } from '../sacr/SACRAtlas'
import { SACRUniformBuffer } from '../sacr/SACRPacker'

export const LIGHT_LOD = 2
export const ARCH_WORDS = SACRUniformBuffer.OFF_FOOTAO - SACRUniformBuffer.OFF_ARCHPROFILE
export type BakeRequest = { seed: number; id: number } & ({ type: 'window'; left: number; right: number } | { type: 'plate'; index: number; lit: boolean })
export type BakeReply = { seed: number; id: number; bakeMs: number } & (
  { type: 'window'; origin: number; width: number; curbOrigin: number; curbWidth: number; blob: PackedBake }
  | { type: 'plate'; index: number; lit: boolean; bitmap: ImageBitmap }
  | { type: 'error'; error: string })
export type BakeWindow = { id: number; seed: number; origin: number; width: number; curbOrigin: number; curbWidth: number;
  shadow: Uint8Array<ArrayBuffer>; light: readonly StratumMip[]; vectors: Uint8Array<ArrayBuffer>; curb: readonly StratumMip[];
  architecture: Uint32Array<ArrayBuffer> }
export const ENV_BYTES = ENV_W * ENV_H * 4
const VECTOR_BYTES = VECTOR_ATLAS_W * VECTOR_H * 4
export const WINDOW_BYTES = ENV_BYTES + VECTOR_BYTES + ARCH_WORDS * 4 +
  [0, 1, 2].reduce((n, l) => n + 4 * (ENV_W >> l) * (ENV_H >> l), 0) +
  [0, 1, 2, 3].reduce((n, l) => n + 4 * (STRATUM_W >> l) * (STRATUM_H >> l), 0)

export function decodeWindow(msg: BakeReply & { type: 'window' }): BakeWindow {
  const { id, seed, origin, width, curbOrigin, curbWidth } = msg
  const raw = unpackBake(msg.blob, WINDOW_BYTES)
  let off = ENV_BYTES
  const vectors = new Uint8Array(raw, off, VECTOR_BYTES); off += VECTOR_BYTES
  const architecture = new Uint32Array(raw, off, ARCH_WORDS); off += ARCH_WORDS * 4
  const chain = (w: number, h: number, max: number) => {
    const mips: StratumMip[] = []
    for (let l = 0; l <= max; l++, w >>= 1, h >>= 1) {
      mips.push({ w, h, data: new Uint32Array(raw, off, w * h) }); off += w * h * 4
    }
    return mips
  }
  return { id, seed, origin, width, curbOrigin, curbWidth, shadow: new Uint8Array(raw, 0, ENV_BYTES), vectors, architecture,
    light: chain(ENV_W, ENV_H, LIGHT_LOD), curb: chain(STRATUM_W, STRATUM_H, STRATUM_MAX_LOD) }
}
