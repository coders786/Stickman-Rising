/** Deterministic execution choreography. Kept pure so cadence/root staging can
 * be proven at multiple frame rates without constructing the canvas game. */
import { clamp01 } from '../core/utils'
import type { SwordForm } from './swords'

export interface ExecutionTimeline {
  cuts: readonly number[]
  finalCut: number
  separateAt: number
  releaseAt: number
}

export function executionTimeline(form:SwordForm,entry:number):ExecutionTimeline {
  const weight=form==='greatblade'?1.2:form==='nodachi'?1.1:form==='short'?.84:1
  const gaps=[.16,.12,.10,.085,.072,.062,.055,.05,.145]
  const cuts=[entry]
  for(const gap of gaps)cuts.push(cuts[cuts.length-1]+gap*weight)
  const finalCut=cuts[cuts.length-1]
  return {cuts,finalCut,separateAt:finalCut+.22,releaseAt:finalCut+.58}
}

/** Side-view projection of a shallow orbit around the victim. The smoothstep
 * envelope prevents a positional pop at entry while the sinusoid creates
 * readable side changes around the target. */
export function executionRoot(t:number,timeline:ExecutionTimeline,targetX:number,side:1|-1):number {
  const q=clamp01(t/Math.max(.01,timeline.finalCut))
  const ease=q*q*(3-2*q)
  // Cosine carries the projection from near side to far side. Two shallow
  // lobes imply depth/orbit in the side view without teleporting the root.
  const crossing=Math.cos(ease*Math.PI)*48
  const orbit=Math.sin(q*Math.PI*4)*14
  return targetX-side*crossing+orbit*side
}

/** Returns every newly crossed beat. This makes effects deterministic when a
 * dropped frame spans several short rapid-cut intervals. */
export function crossedExecutionCuts(previousStep:number,t:number,timeline:ExecutionTimeline):number[] {
  const crossed:number[]=[]
  for(let i=previousStep;i<timeline.cuts.length&&t>=timeline.cuts[i];i++)crossed.push(i)
  return crossed
}
