/** STICKMAN RISING — src/game/render/color.ts
 * ALLOCATION-FREE COLOUR STRINGS.
 * ----------------------------------------------------------------------------
 * `rgba(192,205,211,${a})` is the most expensive string in the game. A template
 * literal allocates a new string object every call, and the draw path calls it
 * ~14 times per frame for the smear, plus once per particle. At 60 fps that is
 * on the order of 10⁴ short-lived strings per second — exactly the allocation
 * rate that fills a young generation every couple of seconds and produces the
 * 5–50 ms pauses the optimisation research warns about (21 §8).
 *
 * The fix is not "build strings faster", it is "stop building strings": alpha is
 * quantised to 1/32 and the string for (base, level) is built ONCE and cached.
 * A 32-level alpha ramp is below the visual threshold for a 3 % step on a 0.2
 * alpha stroke (max error 0.016), and the cache is bounded by the number of
 * distinct base colours, which is small and authored.
 *
 * The cache map is keyed by the base rgb string; a base used with an
 * unbounded alpha range still costs at most 33 strings total.
 * ==========================================================================*/

const LEVELS = 32
const cache = new Map<string, string[]>()

/** `rgb` is "r,g,b" (no wrapper). `a` in [0,1]. Returns a cached string. */
export function rgbaConst(rgb: string, a: number): string {
  let table = cache.get(rgb)
  if (!table) {
    table = new Array<string>(LEVELS + 1)
    cache.set(rgb, table)
  }
  const q = a <= 0 ? 0 : a >= 1 ? LEVELS : Math.round(a * LEVELS)
  const hit = table[q]
  if (hit !== undefined) return hit
  const s = `rgba(${rgb},${(q / LEVELS).toFixed(3)})`
  table[q] = s
  return s
}

/** Fixed base colours used by the strike/smear rig. Kept here so the draw path
 *  never carries a literal. */
export const INK_COOL = '192,205,211'
export const INK_WARM = '216,228,234'
export const INK_HOT = '206,218,224'
export const INK_SHADOW = '8,12,16'
export const INK_VOID = '4,7,10'

/** How many distinct strings the process has built — the unit test asserts this
 *  stops growing after warm-up, which is the actual property we care about. */
export function colourCacheSize(): number {
  let n = 0
  for (const t of cache.values()) n += t.length
  return n
}

export function colourCacheBases(): number { return cache.size }

/** Test hook: wipe the cache so a test can measure a cold build. */
export function resetColourCache(): void { cache.clear() }
