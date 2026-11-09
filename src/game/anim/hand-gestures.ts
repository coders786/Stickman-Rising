import {drawDetail} from './draw-detail'
/** Small purposeful finger/wrist actions. Arm IK still owns hand POSITION;
 * these gestures never move a weapon grip or a planted contact. */
import {runningHandMotion} from './hand-kinematics'

export interface HandGestures { leftOpen:number; rightOpen:number; leftRoll:number; rightRoll:number }
export function handGestures(clip:string,phase:number,swordHeld=true):HandGestures {
  const t=Math.max(0,Math.min(1,Number.isFinite(phase)?phase:0))
  const pulse=Math.sin(t*Math.PI),cycle=Math.sin(t*Math.PI*2)
  const h:HandGestures={leftOpen:.18,rightOpen:swordHeld?0:.12,leftRoll:0,rightRoll:0}
  if(/^unarmed/i.test(clip)){
    h.leftOpen=.06;h.rightOpen=.06;h.leftRoll=0;h.rightRoll=0
    if(/palm/i.test(clip)){h.rightOpen=.42*pulse+.06}
  } else if(/walk|run|sprint|combatStep|backpedal/i.test(clip)){
    const hands=runningHandMotion(t,/sprint/i.test(clip)?480:/run/i.test(clip)?350:100)
    h.leftOpen=hands.left.open;h.leftRoll=hands.left.roll
    h.rightOpen=swordHeld?0:hands.right.open;h.rightRoll=swordHeld?0:hands.right.roll
  } else if(/stop|brake|land/i.test(clip)){
    h.leftOpen=.18+.42*pulse;h.leftRoll=-.14*pulse
    h.rightOpen=swordHeld?0:.12+.15*pulse;h.rightRoll=swordHeld?0:.07*pulse
  } else if(/dash/i.test(clip)){
    // Gather on the load, softly release during flight, gather for catch.
    // Small wrist follow-through, not a rigid fist or a splayed jazz hand.
    h.leftOpen=.16+.16*pulse;h.leftRoll=-.08+.20*Math.sin((t-.08)*Math.PI)
    h.rightOpen=swordHeld?0:.12+.27*pulse;h.rightRoll=swordHeld?0:.12*Math.sin((t-.1)*Math.PI)
  } else if(/jump|leap|fall|air|vault/i.test(clip)){
    h.leftOpen=.45+.32*pulse;h.rightOpen=swordHeld?.05:.4+.3*pulse;h.leftRoll=.14*pulse
  } else if(/parry|charge|guard/i.test(clip)){
    h.leftOpen=.1+.2*pulse;h.leftRoll=.08*pulse
  } else if(/hurt|dead/i.test(clip)){
    h.leftOpen=.65;h.rightOpen=swordHeld?.05:.7;h.leftRoll=-.16*pulse
   } else if(/draw|sheathe/i.test(clip)){
    // The saya hand supports/retracts, rather than opening into a jazz hand.
    h.leftOpen=.14+.10*pulse;h.leftRoll=.035*cycle
    h.rightOpen=/^draw$/i.test(clip)?drawDetail(t*.3).rightOpen:0;h.rightRoll=0
    if(/^draw$/i.test(clip))h.leftOpen=drawDetail(t*.3).leftOpen
  } else if(/flourish/i.test(clip)){
    h.leftOpen=.18+.5*pulse;h.leftRoll=.16*cycle
  } else if(!/idle/i.test(clip)){
    // Attacks: off hand gathers before the cut and closes through impact.
    h.leftOpen=.12+.3*Math.max(0,1-t*2);h.leftRoll=.08*pulse
  } else {h.leftOpen=.2+.035*cycle;h.leftRoll=.025*cycle}
  return h
}
