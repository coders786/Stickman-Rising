/** Shared motion, atmosphere and reflection policies. */
/** UNIVERSAL SHUTTER SMEAR (the lens law): fast movers smear along -v —
 *  the punch-sheet fan language of the reference sheet. Discrete held-frame
 *  layers only (ABCD law): the held pose is ghosted, never interpolated. */
export function smearPlan(speed: number): { n: number; dist: number; a: number } {
  const s = Math.abs(Number.isFinite(speed) ? speed : 0);
  if (s < 300) return { n: 0, dist: 0, a: 0 };
  const k = Math.min(1, (s - 300) / 520);
  return { n: k > 0.5 ? 3 : 2, dist: 8 + k * 22, a: 0.13 + k * 0.14 };
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
  /** REFLECTION ATLAS PERIOD (seconds) — FALLBACK bound only (plan F07/F08).
   *  The old "<1.5 px at 20 Hz" claim was wrong: 2 600 px/s × 50 ms allows
   *  130 world px of travel between refreshes. Refreshes are now driven by
   *  the identity key (span/tier/camera/realloc/player/enemy roots+states,
   *  see render/reflection-key.ts); this period only bounds pose-internal
   *  limb motion the key cannot observe, until MCRI error gates (M4)
   *  replace it. The strip composite still runs every display frame so the
   *  water chop never loses a frame. */
  atlasHz: 1 / 20,
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
