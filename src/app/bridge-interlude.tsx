import { useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { RunPreparationStage } from '@/game/core/types'
import { RoninCutArt } from './ronin-cut-art'

const STAGE: Record<RunPreparationStage, string> = {
  opening: 'Initialize run',
  renderer: 'Prepare renderer',
  background: 'Assemble the bridge',
  lighting: 'Set the lights',
  frame: 'Render the first frame',
  settling: 'Check frame pacing',
  surface: 'Restore the arena surface',
}

/** The matte stays opaque until the paced world and HUD are on screen.
 * Input opens only after the matte completes its compositor animation. */
export function BridgeInterlude({ retry, stage, presented, cutId, cancel, complete }: {
  retry: boolean; stage: RunPreparationStage; presented: boolean; cutId?: number;
  cancel: () => void; complete: (id: number) => void
}) {
  const matte = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = matte.current
    if (cutId === undefined || !element) return
    let active = true
    const done = () => { if (active) complete(cutId) }
    if (element.getAnimations) {
      // Includes the no-animation path and styles that disable animations
      // independently of the system motion preference. No readiness timer.
      Promise.all(element.getAnimations().map(animation => animation.finished)).then(done, done)
    } else if (getComputedStyle(element).animationName === 'none') done()
    return () => { active = false }
  }, [complete, cutId])

  return (
    <div className="sr-ronin-reveal" data-cut={cutId !== undefined || undefined}>
      <div className="sr-ronin-veil" aria-hidden="true" ref={matte}
        onAnimationEnd={event => { if (cutId !== undefined && event.animationName === 'sr-cut-out') complete(cutId) }} />
      <div className="sr-ronin-card" aria-hidden="true">
        <RoninCutArt />
        <div className="sr-ronin-caption"><i /> <span>Night Crossing</span> <i /></div>
      </div>
      <section className="sr-interlude" role="dialog" aria-modal="true" aria-labelledby="preparing-title"
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }}>
        <h2 id="preparing-title" className="sr-only">Night Crossing</h2>
        <div className="sr-interlude-controls">
          <div className="sr-interlude-state">
            <div className="sr-interlude-signal" data-stage={stage} aria-hidden="true"><i /><i /><i /><i /><i /></div>
            <p role="status"><strong>{retry ? 'Re-entering arena' : 'Loading arena'}</strong>{' '}<span>{cutId === undefined ? STAGE[stage] : 'Crossing'}</span></p>
          </div>
          <button type="button" className="sr-interlude-cancel" autoFocus onClick={cancel}>
            <ArrowLeft aria-hidden="true" size={13} /> {presented && retry ? 'MENU' : 'CANCEL'}
          </button>
        </div>
      </section>
    </div>
  )
}
