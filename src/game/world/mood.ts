/** STICKMAN RISING — src/game/world/mood.ts
 * CURATED MOOD PALETTES (dual-register appeal)
 * ----------------------------------------------------------------------------
 * Research laws encoded here:
 *  · Schloss & Palmer (2011): preference is highest for SATURATED, LIGHT
 *    figures on a DESATURATED, DARK ground, with high hue contrast.
 *  · Wilms & Oberfeld / adolescent colour studies: saturated + bright raises
 *    arousal and valence; but youth wellbeing research warns that neon
 *    EVERYWHERE over-stimulates — so the pops are ~10% of the frame (60/30/10).
 *  · Split-toning / teal-orange film grade: cool shadows + warm highlights
 *    give instant visual hierarchy and read as "cinematic / premium" to adults.
 *  · Berlyne inverted-U: a calm, ordered field with moderate clustered detail
 *    and ONE novel hero per plane beats both flatness and noise.
 *
 * So each palette is: desaturated cool `shadow` (60%), warm `highlight` (30%),
 * two isolated saturated `pop` colours (10%). Chosen from the run seed so the
 * whole level has a coherent identity AND novelty on every run.
 * ==========================================================================*/

export interface MoodPalette {
  name: string
  /** rgb triplet — cool shadow / base field */
  shadow: string
  /** rgb triplet — warm highlight / skin-tone analogue */
  highlight: string
  /** rgb triplet — isolated saturated accent A (hero, teen pop) */
  pop: string
  /** rgb triplet — isolated saturated accent B (rhythm, contrast) */
  pop2: string
  /** rgb triplet — sky tint pulse */
  sky: string
}

export const MOOD_PALETTES: readonly MoodPalette[] = [
  { name: 'NEON NOIR',   shadow: '18,58,92',   highlight: '255,168,96',  pop: '255,45,149',  pop2: '41,230,210',  sky: '72,46,112' },
  { name: 'ACID RAIN',   shadow: '16,72,78',   highlight: '255,196,104', pop: '182,255,72',  pop2: '141,91,255',  sky: '28,78,92' },
  { name: 'EMBER CITY',  shadow: '20,56,96',   highlight: '255,154,70',  pop: '255,118,48',  pop2: '63,169,255',  sky: '78,40,96' },
  { name: 'ULTRAVIOLET', shadow: '38,40,104',  highlight: '255,178,120', pop: '255,64,180',  pop2: '120,226,255', sky: '58,42,124' },
]

/** Deterministic palette choice from a run seed (never negative). */
export function moodIndexForSeed(seed: number): number {
  // 32-bit avalanche mix — a plain shift/xor biased three of the four
  // palettes on small seeds, so runs almost never changed identity.
  let h = seed >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) % MOOD_PALETTES.length
}

export function moodForSeed(seed: number): MoodPalette {
  return MOOD_PALETTES[moodIndexForSeed(seed)]
}
