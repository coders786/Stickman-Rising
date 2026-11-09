/** One presentation clock for grip, saya opposition and progressive steel.
 * Equipment becomes armed only when the tip clears the mouth.
 */
export const DRAW_GRIP=.065
export const DRAW_CLEAR=.19
export const DRAW_RELEASE=.265
const smooth=(x:number)=>{const u=Math.max(0,Math.min(1,x));return u*u*u*(10+u*(-15+6*u))}
export function drawDetail(seconds:number){
 const extraction=smooth((seconds-DRAW_GRIP)/(DRAW_CLEAR-DRAW_GRIP))
 const turn=smooth((seconds-DRAW_CLEAR)/(DRAW_RELEASE-DRAW_CLEAR))
 return{extraction,retract:18*extraction*(1-turn),lift:(4*smooth(seconds/.045)+16*extraction)*(1-turn),grip:smooth((seconds-.025)/.04),contact:smooth(seconds/.045)*(1-smooth((seconds-DRAW_CLEAR)/(DRAW_RELEASE-DRAW_CLEAR))),
  turn,
  rightOpen:.36*(1-smooth((seconds-.025)/.04)),leftOpen:.25-.18*smooth(seconds/.05)}
}
