export type BridgeGLTier = 'master' | 'mobile'
export const MASTER_PIXEL_LIMIT = 3_400_000
export const MOBILE_SHORT_LIMIT = 1080
export const MOBILE_LONG_LIMIT = 1920

/** The locked scale is a preference/scene target. The Mobile WebGL2 path
 * admits at most 1920x1080 (1080x1920 portrait), irrespective of DPR. At big
 * viewports this hard cap can be below .85x; the receipt reports both. */
export function bridgeBacking(mode: BridgeGLTier | null, w: number, h: number, preferred: number) {
  const cap = mode === 'mobile' ? Math.min(MOBILE_LONG_LIMIT / Math.max(w, h), MOBILE_SHORT_LIMIT / Math.min(w, h)) : Infinity
  const scale = mode === 'mobile' ? Math.min(cap, Math.max(.85, Math.min(1, preferred))) :
    mode === 'master' ? Math.max(.75, Math.min(1.25, preferred)) : preferred
  return { scale, w: Math.max(1, Math.floor(w * scale)), h: Math.max(1, Math.floor(h * scale)) }
}
