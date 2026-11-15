/** STICKMAN RISING — reflection-atlas refresh identity (plan F07/M2).
 *
 * The wet-floor atlas key must cover EVERY input that changes the plate's
 * pixels: span clipping, quality tier, camera origin (the plate is drawn
 * world-anchored), actor membership, root position, facing and state.
 * The old `(span, quality)` key aliased a same-width camera pan and a
 * moved/spawned actor until the 20 Hz timer fired, and reallocation
 * compared `reflPW !== pw` AFTER assigning `reflPW = pw`, so a fresh empty
 * plate never qualified as dirty.
 *
 * Quantization is part of the contract: roots to 2 px (>>1) for the hero,
 * 4 px (>>2) for enemies. Sub-quantization error plus pose-internal limb
 * motion is bounded by the atlas period fallback (REFLECTION.atlasHz);
 * error-gated refresh (MCRI, plan M4) replaces this key when it lands.
 */

export interface ReflectionKeyActor {
  id: number
  x: number
  y: number
  face?: 1 | -1
  state?: string
}

export interface ReflectionKeyInput {
  /** clipped wet-floor span width in plate pixels */
  spanW: number
  /** quality tier code: 0 low · 1 medium · 2 high · 4 ultra */
  tier: number
  /** world x of the plate column 0 at draw time (camera origin) */
  viewLeft: number
  /** reallocation happened this frame (fresh, empty plate) */
  realloc: boolean
  player: ReflectionKeyActor
  /** culled, live, visible enemies only (same set the plate draws);
   *  `enemyFrom` skips the leading player entry of a retained pool */
  enemies: readonly ReflectionKeyActor[]
  enemyFrom?: number
}

export function reflectionRefreshKey(i: ReflectionKeyInput): string {
  let k = i.realloc
    ? `R${i.spanW}|${i.tier}|${i.viewLeft >> 1}`
    : `${i.spanW}|${i.tier}|${i.viewLeft >> 1}`
  const p = i.player
  k += `|P${p.x >> 1},${p.y >> 1},${p.face ?? 1},${p.state ?? ''}`
  const from = i.enemyFrom ?? 0
  for (let n = from; n < i.enemies.length; n++) {
    const e = i.enemies[n]
    k += `|E${e.id}:${e.x >> 2},${e.face ?? 1},${e.state ?? ''}`
  }
  return k
}
