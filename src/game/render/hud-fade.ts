/** Death-state HUD retirement.
 *
 *  The results card is a page-level overlay; the in-game HUD is a separate
 *  canvas that keeps its last ink because the world is intentionally frozen
 *  once the run ends (see Game.frame). Left alone, the score/sector panels
 *  stay legible behind the "YOU HAVE FALLEN" buttons — the exact complaint
 *  that the death screen looks unfinished.
 *
 *  This is a *mode change*, not a slow frame: the ink is retired with one
 *  compositor transition (no per-frame repaint, no timer in the game loop)
 *  and restored the instant a new run takes the input. Reduced motion keeps
 *  the same end state with a 0 ms transition.
 */
export const HUD_DEATH_FADE_MS = 200

/** A canvas element's style is all this module needs, so it can be tested
 *  without a DOM and cannot accidentally touch the drawing surface. */
export interface InkStyle {
  opacity: string
  transition: string
}

export function hudDeathOpacity(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 1
  if (elapsedMs >= HUD_DEATH_FADE_MS) return 0
  return 1 - elapsedMs / HUD_DEATH_FADE_MS
}

/** Retire the HUD ink. Returns the opacity actually requested. */
export function retireHudInk(style: InkStyle, reducedMotion = false): number {
  style.transition = reducedMotion ? 'none' : `opacity ${HUD_DEATH_FADE_MS}ms linear`
  style.opacity = '0'
  return 0
}

/** Restore full ink for the next run. The transition is cleared first so a
 *  retry never inherits the death fade. */
export function restoreHudInk(style: InkStyle): number {
  style.transition = 'none'
  style.opacity = '1'
  return 1
}
