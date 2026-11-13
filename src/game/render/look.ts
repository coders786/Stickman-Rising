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
  /** LIGHT WRAP — a wide soft key-side halo: light bleeds around the thin
   *  limbs (translucency read), the volume cue that separates 3D form from
   *  a flat sticker */
  wrapDX: number
  wrapDY: number
  wrapA: number
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
/** Allocation-free: one mutable plan object reused every read (callers read
 *  the fields immediately; the frame has a single key). */
const rimPlanObj: RimPlan = {
  keyDX: 0, keyDY: -0.72, keyColor: '#a5d2f2', keyA: 0.9,
  wrapDX: 0, wrapDY: -1.35, wrapA: 0.16,
  bounceCyanDX: 0, bounceCyanDY: 0.5,
  bounceMagentaDX: 0, bounceMagentaDY: 0.78, bounceA: 0.24,
}
export function rimPlan(): RimPlan {
  const towardLight = -keyDirX // shadows fall dirX ⇒ light sits opposite
  const r = rimPlanObj
  r.keyDX = towardLight * 1.18
  r.keyA = 0.62 + 0.38 * keyI + 0.12 * keyHard
  r.wrapDX = towardLight * 2.1
  r.wrapA = 0.1 + 0.08 * keyI
  r.bounceCyanDX = -towardLight * 1.02
  r.bounceMagentaDX = -towardLight * 1.28
  r.bounceA = 0.24 + 0.1 * keyI
  return r
}

/* ================= SCENE EMITTERS (light transport) =================
 * Scenes register their practical lights; characters pick up colored fill
 * from whatever shines on them — warm from the stairwell door, cyan from
 * signage — automatically, in every scene. */
export interface EmitterLight {
  x: number
  y: number
  range: number
  intensity: number
  color: string
}
let emitters: EmitterLight[] = []
export function setSceneEmitters(list: EmitterLight[]): void {
  emitters = list
}
export interface SideFill {
  color: string
  a: number
  /** +1 = emitter stands to the right of the subject */
  dx: number
}
const NO_FILL: SideFill = { color: '', a: 0, dx: 1 }
/** colored bounce fill from the nearest practical light (UE inverse-square
 *  falloff): the character's shadow side catches the warm door, the neon
 *  side catches signage. Returns zero fill when nothing reaches. */
/** UNIVERSAL SHUTTER SMEAR (the lens law): fast movers smear along -v —
 *  the punch-sheet fan language of the reference sheet. Discrete held-frame
 *  layers only (ABCD law): the held pose is ghosted, never interpolated. */
export function smearPlan(speed: number): { n: number; dist: number; a: number } {
  const s = Math.abs(Number.isFinite(speed) ? speed : 0);
  if (s < 300) return { n: 0, dist: 0, a: 0 };
  const k = Math.min(1, (s - 300) / 520);
  return { n: k > 0.5 ? 3 : 2, dist: 8 + k * 22, a: 0.13 + k * 0.14 };
}

export function emitterFill(x: number, y: number): SideFill {
  const fs = emitterFills(x, y)
  return fs.length ? fs[0] : NO_FILL
}
/** TOP-2 practicals at a point (dominant first). Real multi-light: standing
 *  between two sources lights BOTH sides of the silhouette — one tap per
 *  source, each falling on the side that faces it. */
export function emitterFills(x: number, y: number): SideFill[] {
  const scored: { v: number; col: string; ex: number }[] = []
  for (const l of emitters) {
    const ddx = x - l.x, ddy = y - l.y
    const r = Math.max(1, l.range)
    const v = l.intensity / (1 + (ddx * ddx + ddy * ddy) / (r * r))
    if (v >= 0.05) scored.push({ v, col: l.color, ex: l.x })
  }
  scored.sort((a, b) => b.v - a.v)
  return scored.slice(0, 2).map((s) => ({
    color: s.col,
    a: Math.min(0.4, s.v * 0.48),
    dx: s.ex >= x ? 1 : -1,
  }))
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
