/** UNIVERSAL LOOK CONTRACT — one rulebook every scene inherits.
 *
 * The graphics rules live HERE, not per scene: any level that sets its key
 * light each frame gets, for free and consistent everywhere:
 *   • DIRECTIONAL rim lighting derived FROM the key (never a uniform outline)
 *   • neon bounce on the lower edges (cyan/magenta, keyed to the bounce side)
 *   • reflection policy (broken-up, never a dry mirror)
 *   • splash geometry tied to the wind vector
 *   • depth-fog values for aerial perspective
 *
 * Scenes only describe their lights and geometry; the look follows the rules.
 */

export interface SceneKey {
  /** horizontal shadow/rake direction (−X = shadows fall left, light right) */
  dirX: number
  /** 0 = soft ambient … 1 = hard directional */
  hard: number
  /** key intensity 0..1 */
  i: number
}

let keyDirX = -0.85
let keyHard = 0.12
let keyI = 0.62

/** the renderer calls this once per frame with the live key light */
export function setSceneKey(k: SceneKey): void {
  if (Number.isFinite(k.dirX)) keyDirX = Math.max(-1, Math.min(1, k.dirX))
  if (Number.isFinite(k.hard)) keyHard = Math.max(0, Math.min(1, k.hard))
  if (Number.isFinite(k.i)) keyI = Math.max(0, Math.min(1, k.i))
}

export interface RimPlan {
  /** cool moon-side rim: offset toward the light, carved edges only */
  keyDX: number
  keyDY: number
  keyColor: string
  keyA: number
  /** warm-cool bounce on the lower edges that face the neon city */
  bounceCyanDX: number
  bounceCyanDY: number
  bounceMagentaDX: number
  bounceMagentaDY: number
  bounceA: number
}

/** rim geometry DERIVED FROM THE KEY — if the key moves, the rim follows.
 *  Light falls from upper-right (moon): the rim only appears on edges that
 *  face it; the opposite lower edges pick up faint sign bounce. */
export function rimPlan(): RimPlan {
  const towardLight = -keyDirX // shadows fall dirX ⇒ light sits opposite
  return {
    keyDX: towardLight * 1.18,
    keyDY: -0.72,
    keyColor: '#a5d2f2',
    keyA: 0.62 + 0.38 * keyI + 0.12 * keyHard,
    bounceCyanDX: -towardLight * 1.02,
    bounceCyanDY: 0.5,
    bounceMagentaDX: -towardLight * 1.28,
    bounceMagentaDY: 0.78,
    bounceA: 0.24 + 0.1 * keyI,
  }
}

/** REFLECTION POLICY — wet concrete, not polished glass: broken-up, low
 *  opacity, wave-distorted. Universal constants for every scene. */
export const REFLECTION = {
  /** base mirror opacity (spec: 25–35%) */
  opacity: 0.25,
  /** strobe lift on the black mirror */
  strobeGain: 0.22,
  /** high-frequency horizontal wave distortion of the mirror */
  waveAmp: 2.6,
  waveFreq: 3.1,
  waveAmp2: 1.15,
  waveFreq2: 7.3,
  /** slices the mirror is broken into */
  strips: 8,
  /** reflection zone depth below the foot line (world px) */
  depth: 150,
}

/** SPLASH POLICY — geometry tied to the rain's wind vector; spawn variety
 *  comes from the storm engine's rng, not a grid. */
export const SPLASH = {
  /** crown tilt along the wind (radians at wind=1) */
  tiltGain: 0.42,
  /** ring aspect (squash) */
  squash: 0.23,
  baseAlpha: 0.4,
}

/** DEPTH-FOG POLICY (aerial perspective) — far planes lift toward the sky
 *  color and dissolve at the top; never a hard neon edge at infinity. */
export const FOG = {
  farLift: 'rgba(42,64,92,0.22)',
  midLift: 'rgba(36,56,80,0.12)',
  nearLift: 'rgba(30,48,70,0.05)',
  /** top dissolve band height over far/mid planes */
  topFadeH: 120,
}
