/** A separate charged-dash performance, not a retimed normal dash.
 * The planted set explodes into a low, almost horizontal drive, then the
 * front leg reaches and absorbs the skid. Recovery is authored separately. */
import {keyframe,makeClip} from './animator'

/** THE PLANTED CHARGE — the sprinter-in-the-blocks coil the dash button
 * holds while it stores the power dash.
 *
 * Physical language only: no channel of this stance implies stored magic.
 * The body PLANTS (feet widen, hips sink, spine coils forward), the blade
 * arms chamber back-level (the iai draw position the release explodes from),
 * and the whole set trembles under isometric load (the 55 Hz tension tremor
 * is added procedurally in player.ts — see updatePowerDashCharge).
 *
 * Choreography law: the t=.32 keyframe is EXACTLY POWER_DASH_CLIP's first
 * keyframe (root/legs/head/off-arm) so the release crossfade is pose-identical
 * — the coil hands the dash a seamless body. t=.42 is the LOCK beat: after
 * full charge the set settles one final unit deeper and stops, the "taut
 * steel" read that precedes the snap. The clip is non-looping: holding the
 * button longer rests on the lock pose (the character is STANDING — stamina
 * regenerates, see stamina.ts stillness rules).
 *
 * Name is deliberately OUTSIDE equipmentClip's adaptation whitelist: the
 * authored arms must survive for both stances (drawn = chambered steel;
 * sheathed = the same coil with the hand riding the saya). */
export const DASH_CHARGE_CLIP=makeClip('chargeCoil',[
 // entry: near-neutral standing arrest — blends clean out of idle/walk/run
 keyframe(0,{rootX:1.5,rootY:2.5,rootRot:.10,spine:.03,head:-.10,
   hipR:.45,kneeR:-.55,footR:.12,hipL:-.30,kneeL:-.42,footL:-.06,
   shR:.05,elR:-.85,wrR:-.55,shL:.30,elL:-.75,wrL:-.15,
   pelvisYaw:.10,chestYaw:-.10},'inOutSine'),
 // the plant: feet widen, weight starts to sink, blade chamber deepens
 keyframe(.14,{rootX:1.2,rootY:3.4,rootRot:.22,spine:.05,head:-.20,
   hipR:.55,kneeR:-.85,footR:.15,hipL:-.32,kneeL:-.55,footL:-.02,
   shR:-.02,elR:-1.00,wrR:-.65,shL:.35,elL:-1.0,wrL:-.15,
   pelvisYaw:.12,chestYaw:-.12},'inOutSine'),
 // FULL COIL — pose-identical to POWER_DASH_CLIP kf0 (seamless release);
 // blade chambered back-level, off arm reaching its dash position
 keyframe(.32,{rootX:1,rootY:4,rootRot:.35,head:-.32,
   hipL:-.35,kneeL:-.65,hipR:.62,kneeR:-1.1,footR:.15,footL:-.04,
   shR:.16,elR:-.75,wrR:-.62,shL:.4,elL:-1.2,
   pelvisYaw:.14,chestYaw:-.14},'inOutSine'),
 // LOCK beat: the set settles one final unit under the load and stops.
 keyframe(.42,{rootX:1,rootY:4.6,rootRot:.35,head:-.32,
   hipL:-.35,kneeL:-.65,hipR:.62,kneeR:-1.1,footR:.15,footL:-.04,
   shR:.16,elR:-.75,wrR:-.62,shL:.4,elL:-1.2,
   pelvisYaw:.14,chestYaw:-.14},'inOutSine'),
])
DASH_CHARGE_CLIP.interpolation='monotone'

/** THE DUAL CHAMBER — the second, deeper gather the HEAVY hold stacks on
 * the planted coil while the dash button stays held: THE POWER DASH SLASH
 * charge (dash hold + heavy hold = the blade loads). Physical language
 * only — the stance sinks one more grade under the added blade load, the
 * hips coil back, and the sword arm chambers the steel back-level along
 * the saya line (the full iai draw position the dual release detonates
 * from). No channel implies stored magic.
 *
 * Choreography law: the first keyframe is EXACTLY DASH_CHARGE_CLIP's LOCK
 * beat (t=.42), so the deepen crossfades off the resting coil
 * pose-identically. t=.22 is the TAUT LOCK — after the full dual charge
 * the set settles one final unit and stops (the drawn-steel read that
 * precedes the release). Non-looping: the hold rests on the chamber pose.
 * The name stays OUTSIDE equipmentClip's adaptation whitelist so the
 * authored arms survive for both stances. */
export const DUAL_CHARGE_CLIP=makeClip('dualChargeCoil',[
 // entry: the dash-charge LOCK beat, verbatim — seamless handoff
 keyframe(0,{rootX:1,rootY:4.6,rootRot:.35,head:-.32,
   hipL:-.35,kneeL:-.65,hipR:.62,kneeR:-1.1,footR:.15,footL:-.04,
   shR:.16,elR:-.75,wrR:-.62,shL:.4,elL:-1.2,
   pelvisYaw:.14,chestYaw:-.14},'inOutSine'),
 // the plant deepens under the added blade load — hips sink, coil tightens,
 // the sword arm starts pulling the steel back
 keyframe(.08,{rootX:1,rootY:5.2,rootRot:.41,head:-.38,
   hipL:-.38,kneeL:-.72,hipR:.64,kneeR:-1.2,footR:.16,footL:-.05,
   shR:.02,elR:-.88,wrR:-.66,shL:.32,elL:-1.08,wrL:-.2,
   pelvisYaw:.17,chestYaw:-.17},'inOutSine'),
 // THE BLADE CHAMBER: steel pulled back-level along the saya line, off
 // hand riding the saya mouth, eyes leveled down the travel line
 keyframe(.15,{rootX:1,rootY:5.6,rootRot:.46,head:-.42,
   hipL:-.38,kneeL:-.78,hipR:.66,kneeR:-1.3,footR:.16,footL:-.05,
   shR:-.22,elR:-1.02,wrR:-.72,shL:.22,elL:-.95,wrL:-.25,
   pelvisYaw:.2,chestYaw:-.2},'inOutSine'),
 // TAUT LOCK: the set settles one final unit and stops — drawn steel
 keyframe(.22,{rootX:1,rootY:5.8,rootRot:.46,head:-.42,
   hipL:-.38,kneeL:-.8,hipR:.66,kneeR:-1.32,footR:.16,footL:-.05,
   shR:-.24,elR:-1.04,wrR:-.73,shL:.22,elL:-.95,wrL:-.25,
   pelvisYaw:.2,chestYaw:-.2},'inOutSine'),
])
DUAL_CHARGE_CLIP.interpolation='monotone'

/** Blade-segment charge time the HEAVY hold adds on top of the dash charge
 * (POWER_DASH_CHARGE=.32). The dash coil locks at .42 (settle beat), then
 * the dual chamber loads for this long before RAIJIN ZAN is armed. */
export const POWER_DASH_SLASH_CHARGE=.22

export const POWER_DASH_CLIP=makeClip('powerDash',[
 keyframe(0,{rootX:1,rootY:4,rootRot:.35,head:-.32,hipL:-.35,kneeL:-.65,hipR:.62,kneeR:-1.1,shL:.4,elL:-1.2,shR:.16,elR:-.75},'inOutSine'),
 keyframe(.035,{rootX:3,rootY:4.5,rootRot:.64,head:-.60,hipL:-.56,kneeL:-.50,hipR:.75,kneeR:-1.24,shL:.68,elL:-1.12,shR:.35,elR:-.90},'inOutSine'),
 keyframe(.07,{rootX:5,rootY:5,rootRot:.92,head:-.75,hipL:-.78,kneeL:-.35,hipR:.85,kneeR:-1.38,shL:.75,elL:-1.15,shR:.45,elR:-.95},'inOutSine'),
 keyframe(.11,{rootX:7.5,rootY:4.5,rootRot:1.13,head:-.80,hipL:-.86,kneeL:-.34,hipR:.92,kneeR:-1.46,shL:.82,elL:-1.15,shR:.43,elR:-.92},'inOutSine'),
 keyframe(.16,{rootX:9,rootY:4,rootRot:1.30,head:-.85,hipL:-.92,kneeL:-.35,hipR:.95,kneeR:-1.5,shL:.85,elL:-1.15,shR:.45,elR:-.9},'inOutSine'),
 keyframe(.22,{rootX:8.6,rootY:4,rootRot:1.28,head:-.85,hipL:-.84,kneeL:-.46,hipR:.98,kneeR:-1.5,shL:.78,elL:-1.14,shR:.42,elR:-.90},'inOutSine'),
 keyframe(.27,{rootX:8,rootY:4,rootRot:1.25,head:-.85,hipL:-.72,kneeL:-.65,hipR:1.02,kneeR:-1.48,shL:.7,elL:-1.1,shR:.4,elR:-.9},'inOutSine'),
 keyframe(.30,{rootX:6.4,rootY:4.8,rootRot:.90,head:-.72,hipL:-.60,kneeL:-.80,hipR:1.02,kneeR:-1.44,shL:.45,elL:-1.12,shR:.34,elR:-.86},'inOutSine'),
 keyframe(.34,{rootX:4,rootY:6,rootRot:.45,head:-.42,hipL:-.50,kneeL:-1.02,hipR:1.02,kneeR:-1.35,shL:.15,elL:-1.15,shR:.15,elR:-.8},'inOutSine'),
 keyframe(.39,{rootX:2,rootY:6.6,rootRot:.18,head:-.16,hipL:-.58,kneeL:-.70,hipR:.94,kneeR:-1.32,shL:.42,elL:-1.10,shR:.30,elR:-.85},'inOutSine'),
 keyframe(.45,{rootX:0,rootY:7,rootRot:.04,head:-.04,hipL:-.65,kneeL:-.35,hipR:.88,kneeR:-1.28,shL:.65,elL:-1.05,shR:.35,elR:-.85},'inOutSine'),
])
POWER_DASH_CLIP.interpolation='monotone'

const smooth=(x:number)=>{const u=Math.max(0,Math.min(1,x));return u*u*(3-2*u)}
/** Compression rises before impact and remains low until recovery takes over. */
export function powerDashAct(progress:number){
 const t=Math.max(0,Math.min(1,progress))
 const drive=smooth((t-.04)/.2)*(1-smooth((t-.53)/.35))
 const catchW=smooth((t-.61)/.27)
 return {drive,catch:catchW,drop:.4+catchW*.6}
}
/** Low stabilization hold followed by a distinct, smooth rise. */
export function powerDashRecovery(progress:number){return 1-smooth((progress-.25)/.75)}

/** A short ballistic arc for visual center-of-mass lift, in world pixels.
 * Ground collision/motor stay on their existing plane; the lift is visual and
 * carried into the rig and blade, then returns to zero before the catch. */
export function powerDashLift(age:number):number{
 const t=age-.075,duration=.20,gravity=2400
 return t>0&&t<duration?.5*gravity*t*(duration-t):0
}
