/** STICKMAN RISING — PAVE: Procedural Animation Variation Engine (spec §3).
 *
 * Research-baked additive variation layered on top of authored clips so no
 * two plays of an animation render identically:
 *
 * - Ken Perlin, "An Image Synthesizer" (SIGGRAPH 1985): smooth coherent
 *   noise for organic motion. We use seeded VALUE noise with cubic
 *   smoothing — at ±1–5° joint amplitudes the difference from gradient
 *   noise is imperceptible and it costs two hashes per sample.
 * - Disney's 12 principles (Thomas & Johnston, "The Illusion of Life",
 *   1981): "moving holds" (a held pose must keep micro-motion or it dies),
 *   secondary action (must support, not distract), exaggeration ("remain
 *   grounded in reality while presenting a wilder, more extreme action").
 * - David Rosen (Wolfire), GDC 2014 "Animation in Action Games":
 *   procedural layers + parameterization are how small teams get huge
 *   animation variety — vary the LAYERS, not the clips.
 *
 * Architecture: `applyPave` is a pure additive pass over a sampled pose,
 * after the animator/crossfade and before the skeleton solve. Every layer
 * is amplitude-bounded so pose continuity (QA check C) can never trip:
 * worst case ≈ 0.09 rad/frame at 4 Hz — far under the 2.5 rad snap limit.
 */

import type { Pose } from './pose'
import { CH_COUNT } from './pose'
import { clamp01 } from '../core/utils'

/* ------------------------------------------------------------------ */
/* Value noise — smooth, seeded, allocation-free                        */
/* ------------------------------------------------------------------ */

function hash1(seed: number, x: number): number {
  let h = Math.imul(x ^ seed, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** 1D value noise in −0.5..+0.5. Cubic-smoothed so it is C1-continuous:
 * no frame-to-frame jitter — the spec's "organic, never jittery" rule. */
function vnoise(seed: number, t: number): number {
  const i = Math.floor(t)
  const f = t - i
  const u = f * f * (3 - 2 * f)
  const a = hash1(seed, i)
  const b = hash1(seed, i + 1)
  return a + (b - a) * u - 0.5
}

/* ------------------------------------------------------------------ */
/* Per-channel organic noise tables (spec §3.2)                        */
/* ------------------------------------------------------------------ */

/** amplitude per channel: spine ±1°, distal joints up to ±5° (radians;
 * channels 0/1 are root translations in local units; channels 17–27 are
 * the 3D DEPTH set — rootZ sway, girdle yaw micro-twist, limb yaw wobble,
 * blade yaw/depth shimmer — all an order smaller than their sagittal
 * siblings so depth articulation reads as life, not noise). */
const AMP = new Float32Array([
  0.9, 0.55,          // rootX, rootY — slow sway (moving-hold life)
  0.015, 0.020, 0.036, // rootRot, spine, head
  0.050, 0.060, 0.045, // hipL, kneeL, footL
  0.050, 0.060, 0.045, // hipR, kneeR, footR
  0.050, 0.070, 0.088, // shL, elL, wrL
  0.050, 0.070, 0.088, // shR, elR, wrR
  /* ---- 3D depth channels (17–27) ---- */
  0.40,               // rootZ — slow depth sway (units)
  0.020, 0.030,       // pelvisYaw, chestYaw — girdle micro-counter-twist
  0.020, 0.020,       // hipLz, hipRz
  0.030, 0.030,       // armLz, armRz (gated with the arm set, c ≥ 11)
  0.020, 0.40,        // bladeYaw (rad), bladeZ (units) — blade shimmer
  0.035, 0.035,       // foreLz, foreRz — forearm pronation life
])

/** frequency per channel: 2–4 Hz for limbs (spec), 0.7 Hz root sway. */
const FREQ = new Float32Array([
  0.7, 0.5,
  2.0, 2.1, 2.6,
  2.2, 2.4, 3.0,
  2.2, 2.4, 3.0,
  2.2, 3.0, 3.6,
  2.2, 3.0, 3.6,
  /* ---- 3D depth channels — slower: depth drifts, it does not buzz ---- */
  0.5,
  1.5, 1.8,
  2.4, 2.4,
  2.8, 2.8,
  2.2, 2.0,
  3.0, 3.0,
])

/** per-channel noise seed scramble so no two joints move in phase. */
const CH_SEED = new Int32Array(CH_COUNT)
for (let c = 0; c < CH_COUNT; c++) CH_SEED[c] = Math.imul(c + 1, 0x9e3779b1) | 0

/* Data validation: the noise tables must cover EVERY pose channel. When the
 * pose grew from 17 to 28 channels (3D depth set), stale tables silently
 * read out-of-bounds → undefined → NaN on channels 17–27. This guard makes
 * that class of regression fail loudly at module load instead. */
if (AMP.length !== CH_COUNT || FREQ.length !== CH_COUNT) {
  throw new Error(`PAVE noise tables out of sync with pose channels (AMP=${AMP.length}, FREQ=${FREQ.length}, CH_COUNT=${CH_COUNT})`)
}

/* ------------------------------------------------------------------ */
/* Combo escalation (spec §3.3 — exact table)                           */
/* ------------------------------------------------------------------ */

export interface Escalation {
  tier: number
  /** attack-speed modifier: 1.00× → 1.30× */
  speed: number
  /** arc-width / exaggeration modifier: 1.00× → 1.70× */
  arc: number
  /** flair tier: gates kill flourishes */
  flair: number
  /** trail intensity: 1.00× → 4.00× */
  trail: number
}

const ESC_STEPS: [number, Escalation][] = [
  [3, { tier: 0, speed: 1.0, arc: 1.0, flair: 1.0, trail: 1.0 }],
  [7, { tier: 1, speed: 1.05, arc: 1.1, flair: 1.2, trail: 1.2 }],
  [15, { tier: 2, speed: 1.1, arc: 1.2, flair: 1.5, trail: 1.5 }],
  [30, { tier: 3, speed: 1.15, arc: 1.35, flair: 2.0, trail: 2.0 }],
  [50, { tier: 4, speed: 1.2, arc: 1.5, flair: 2.5, trail: 2.5 }],
  [100, { tier: 5, speed: 1.25, arc: 1.6, flair: 3.0, trail: 3.0 }],
  [Infinity, { tier: 6, speed: 1.3, arc: 1.7, flair: 4.0, trail: 4.0 }],
]

export function escalation(hits: number): Escalation {
  for (const [max, e] of ESC_STEPS) {
    if (hits <= max) return e
  }
  return ESC_STEPS[ESC_STEPS.length - 1][1]
}

/* ------------------------------------------------------------------ */
/* Sword body-language modifiers (spec §5 — per-blade character)        */
/* ------------------------------------------------------------------ */

interface SwordVoice {
  /** overall noise amplitude scale */
  amp: number
  /** frequency scale (slow = heavy, fast = twitchy) */
  freq: number
  /** constant electric tremor amplitude (thunder only) */
  tremor: number
  /** temporal phase offset — phantom's "ghost catching up" echo */
  echo: number
}

const SWORD_VOICE: Record<string, SwordVoice> = {
  katana: { amp: 0.8, freq: 1.15, tremor: 0, echo: 0 },     // economical, precise
  inferno: { amp: 1.25, freq: 0.95, tremor: 0, echo: 0 },   // wide, aggressive
  thunder: { amp: 1.0, freq: 1.6, tremor: 0.014, echo: 0 }, // staccato micro-tremor
  void: { amp: 0.3, freq: 0.8, tremor: 0, echo: 0 },        // eerie stillness
  gravity: { amp: 0.85, freq: 0.55, tremor: 0, echo: 0 },   // slow, massive
  phantom: { amp: 0.9, freq: 1.0, tremor: 0, echo: 0.22 },  // slightly delayed
}

/* ------------------------------------------------------------------ */
/* Context + state                                                      */
/* ------------------------------------------------------------------ */

export type JumpStyle = 'standard' | 'leap' | 'spin' | 'backflip'

export interface PaveContext {
  /** sim time (seconds) — noise input */
  time: number
  /** frame delta (for breath phase integration) */
  dt: number
  /** health 0..1 (posture collapse + near-death tremor) */
  hp: number
  /** live combo hit count (escalation) */
  comboHits: number
  /** |vx| / max run speed 0..1 */
  speedRatio: number
  /** true when off the ground */
  airborne: boolean
  /** seconds airborne (aerial pose evolution) */
  airborneT: number
  /** charge glow 0..1 (coiled tension) */
  chargeRatio: number
  /** seconds since last damage taken (flinch carryover) */
  sinceHitTaken: number
  /** sword id for body-language voice */
  sword: string
  /** 0..1 — arm-channel noise gate; <1 inside strike windows so the blade
   * stays crisp for hitboxes/trails (non-negotiable #5: trail follows blade) */
  armGate: number
  /** contextual idle breath rate (breaths/min — spec §4.3) */
  breathRate: number
  /** airborne silhouette variant */
  jumpStyle: JumpStyle
}

/** Per-entity mutable state (seed, breath phase, spin accumulator). */
export class PaveState {
  /** Unique per-entity noise seed.
   *
   * DETERMINISM: this used to be `Math.random()`, which made the whole
   * pose pipeline irreproducible — the same inputs produced a different
   * pose every run, so the animation could not be regression-tested and a
   * "did my change alter the animation?" question had no answer. The seed
   * now derives from an entity salt, so two entities still vary from each
   * other (the spec's per-entity uniqueness) while a single entity is
   * perfectly repeatable for a given salt.
   */
  seed: number
  /** Airborne spin accumulator etc. */
  constructor(salt = 0x5eed) {
    this.seed = (Math.imul(salt | 0, 2654435761) ^ 0x9e3779b9) >>> 0
    this.breathT = ((this.seed >>> 8) & 0xffff) / 0xffff * 6
  }
  /** reseed on combo/attack start → per-combo uniqueness (spec var #27) */
  reseed(time: number, x: number): void {
    this.seed = (Math.imul((time * 1000) | 0, 2654435761) ^ ((x * 131) | 0)) >>> 0
  }
  /** Breath phase. Derived from the seed above rather than randomised, for
   * the same determinism reason. */
  breathT: number
  /** accumulated airborne spin (radians) — never wrapped, damped to the
   * nearest full turn on landing so rendered pose stays continuous */
  spin = 0
  spinTarget = 0
  spinRate = 0
}

/* ------------------------------------------------------------------ */
/* The engine                                                           */
/* ------------------------------------------------------------------ */

/** Additive variation pass. Mutates `p` in place. */
export function applyPave(p: Pose, ctx: PaveContext, st: PaveState): void {
  const t = ctx.time
  const esc = escalation(ctx.comboHits)
  // exaggeration 1.0 → 1.4× (spec var #3); never shrinks below 1
  const ex = 1 + (esc.arc - 1) * 0.55
  const voice = SWORD_VOICE[ctx.sword] ?? SWORD_VOICE.katana
  // void blade: near-still when calm — "attacks begin from absolute stillness"
  const stillGate = ctx.sword === 'void' && ctx.speedRatio < 0.06 && ctx.chargeRatio <= 0
    ? 0.35 : 1
  const gate = voice.amp * stillGate
  const tf = t * voice.freq - voice.echo

  // ---- 1. per-channel organic noise ----
  for (let c = 0; c < CH_COUNT; c++) {
    const arm = c >= 11 ? ctx.armGate : 1
    const amp = AMP[c] * ex * gate * arm
    if (amp <= 0.0005) continue
    p[c] += vnoise(st.seed ^ CH_SEED[c], tf * FREQ[c]) * 2 * amp
  }

  // thunder's constant 8 Hz electric tremor (spec §5.4)
  if (voice.tremor > 0) {
    const tr = voice.tremor * (1 + ctx.chargeRatio * 2)
    p[2] += Math.sin(t * 50.3) * tr
    p[14] += Math.sin(t * 47.1 + 1.3) * tr
  }

  // ---- 2. health posture (spec var #1) ----
  const hurt = 1 - clamp01(ctx.hp)
  if (hurt > 0.02) {
    const h2 = hurt * hurt
    p[2] += h2 * 0.13 // collapsed forward up to ~7.5°
    p[3] += h2 * 0.09
    // tremor grows as hp → 0: ±5° at death's door (only when calm —
    // mid-combat it would fight the authored action)
    if (hurt > 0.55 && ctx.speedRatio < 0.35) {
      const tr = (hurt - 0.55) * 0.075
      p[2] += Math.sin(t * 19.7 + st.seed) * tr
      p[14] += Math.sin(t * 23.3) * tr * 0.8
    }
  }

  // ---- 3. breath (spec var #2 + §4.3 rates) ----
  st.breathT += (ctx.dt * ctx.breathRate) / 60
  const br = st.breathT * Math.PI * 2
  // exertion: recent sprinting / combat raises amplitude (no stamina bar —
  // derive from speed + combo heat)
  const exertion = clamp01(ctx.speedRatio * 0.8 + Math.min(ctx.comboHits, 20) * 0.015)
  const brAmp = 0.012 + exertion * 0.03
  p[3] += Math.sin(br) * brAmp
  p[1] += Math.sin(br) * brAmp * 5.5

  // ---- 4. airborne pose evolution (spec var #9) ----
  if (ctx.airborne) {
    const at = ctx.airborneT
    if (at < 0.3) {
      // compact tuck
      p[6] -= 0.09
      p[9] -= 0.09
      p[12] -= 0.06
      p[15] -= 0.06
    } else if (at < 1.0) {
      // extending
      p[6] += 0.045
      p[9] += 0.045
    } else {
      // spread for landing prep
      p[5] += 0.06
      p[8] -= 0.06
      p[11] -= 0.08
      p[14] -= 0.08
    }
    // jump-style silhouettes (spec §4.2 variants)
    if (ctx.jumpStyle === 'leap') {
      p[2] += 0.14          // stronger forward pitch
      p[5] -= 0.1           // split legs
      p[8] += 0.14
      p[14] += 0.1          // sword arm reaching
    } else if (ctx.jumpStyle === 'backflip') {
      // tucked rotation — hips curl (the spin itself is st.spin)
      p[6] -= 0.22
      p[9] -= 0.22
      p[3] += 0.1
    }
  }

  // ---- 5. flinch carryover (spec var #12: 0–1s after a hit) ----
  if (ctx.sinceHitTaken < 1) {
    const k = 1 - ctx.sinceHitTaken
    p[2] += vnoise(st.seed ^ 0x5bd1, t * 9) * 0.09 * k
    p[0] += vnoise(st.seed ^ 0x1b7f, t * 8) * 1.6 * k
  }

  // ---- 6. charge tension (spec var #23: coiled, compressed) ----
  if (ctx.chargeRatio > 0.03) {
    const cr = ctx.chargeRatio
    p[2] += vnoise(st.seed ^ 0x27d4, t * 11) * 0.05 * cr
    p[3] += 0.06 * cr
    p[6] -= 0.08 * cr
    p[9] -= 0.08 * cr
    p[1] += 1.8 * cr
  }

  // ---- 7. velocity arm-trail (spec var #5: arms lag the sprint) ----
  // Gated with the arm set: sprint locomotion keeps the full lag, while
  // precision action states (strikes, dashes) suppress it so authored
  // contact silhouettes are not smeared.
  if (ctx.speedRatio > 0.4) {
    const lag = (ctx.speedRatio - 0.4) * 0.7 * ctx.armGate
    p[11] -= lag * 0.12
    p[14] -= lag * 0.08
  }

  // ---- 8. airborne spin accumulator (acrobatic variants, spec §4.2) ----
  if (st.spin !== 0) {
    p[2] += st.spin
  }
}

/* ------------------------------------------------------------------ */
/* Spin helper — driven by the player (knows jump timing)               */
/* ------------------------------------------------------------------ */

/**
 * Advances the airborne spin toward `st.spinTarget` while airborne, and
 * unwinds it to the nearest full turn after landing (the residual unwind
 * reads as a natural settle-turn). `st.spin` is never reset abruptly, so
 * rendered pose continuity is preserved and the raw channel never snaps.
 */
export function updatePaveSpin(st: PaveState, dt: number, airborne: boolean): void {
  if (airborne) {
    if (st.spinTarget !== 0) {
      // accelerate toward the target rate, then track it
      st.spinRate += (st.spinTarget * 3.2 - st.spinRate) * (1 - Math.exp(-9 * dt))
      st.spin += st.spinRate * dt
      // cap at the target so we don't over-spin
      if (Math.sign(st.spinTarget) > 0 && st.spin > st.spinTarget) st.spin = st.spinTarget
      if (Math.sign(st.spinTarget) < 0 && st.spin < st.spinTarget) st.spin = st.spinTarget
    }
  } else if (st.spin !== 0) {
    // settle to the nearest full turn (visual identity) — continuous decay
    const tau = Math.PI * 2
    const target = Math.round(st.spin / tau) * tau
    st.spin += (target - st.spin) * (1 - Math.exp(-7 * dt))
    if (Math.abs(st.spin - target) < 0.0008) {
      st.spin = 0
      st.spinTarget = 0
      st.spinRate = 0
    }
  } else {
    st.spinTarget = 0
    st.spinRate = 0
  }
}
