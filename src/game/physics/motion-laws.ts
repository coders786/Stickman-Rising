/** Arcade world units, not SI calibration. Ground exchanges momentum with
 * the fighter; airborne ability thrust is a separate, explicit force source. */
export const SUPPORT_GRAVITY=2050
export const GROUND_GRIP=2.25
export function tractionAcceleration(requested:number,grip=GROUND_GRIP,normalAcceleration=SUPPORT_GRAVITY):number{
 const limit=Math.max(0,grip)*Math.max(0,normalAcceleration)
 return Math.max(-limit,Math.min(limit,requested))
}
/** Simplified frontal-area change for the dash's forward drive, in arcade
 * units. Lean modestly reduces, but never removes, still-air resistance. */
export function airDragCoefficient(lean:number):number {
 const posture=Math.max(0,Math.min(1,Number.isFinite(lean)?lean:0))
 return .0001*(1-.18*posture)
}
/** Exact scalar dv/dt=-k*v*|v|. Never reverses passive travel. */
export function quadraticDragVelocity(v:number,k:number,dt:number):number{
 return v/(1+Math.max(0,k)*Math.abs(v)*Math.max(0,dt))
}
/** Perfectly inelastic contact: remove only incoming normal velocity.
 * An already separating body keeps its momentum. inwardNormal is ±1. */
export function contactVelocity(v:number,inwardNormal:number):number{
 return v*inwardNormal<0?0:v
}
/** Unit-area cumulative finite thrust pulse; integral over [0,1] is one. */
export function impulseFraction(u:number):number{
 const t=Math.max(0,Math.min(1,u));return t*t*(3-2*t)
}
