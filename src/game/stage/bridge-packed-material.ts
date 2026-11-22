import { DECK_MASK_H, PUDDLE_PITCH } from './bridge-material'
import type { PlaneLayout } from '../../graphics/bridge/BridgeAssetCodec'

export const DECK_PACK_TAG = 'BDK1'
export const DECK_PACK_LAYOUT = [[PUDDLE_PITCH, DECK_MASK_H, 1]] as const
export const gradePackTag = (n: 16 | 32) => `BL${n}`
export const gradePackLayout = (n: 16 | 32): PlaneLayout => Array.from({ length: 4 }, () => [n, n * n, 4])
