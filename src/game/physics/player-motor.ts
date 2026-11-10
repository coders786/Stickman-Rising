/** World units / simulation seconds. Effective mass is not an SI claim. */
export const PLAYER_MASS=70
/** Passive braking: never reverses or adds kinetic energy. */
export function brakeVelocity(v:number,deceleration:number,dt:number):number{
 const change=Math.max(0,deceleration)*Math.max(0,dt)
 return Math.sign(v)*Math.max(0,Math.abs(v)-change)
}
export function dragVelocity(v:number,rate:number,dt:number):number{
 return v*Math.exp(-Math.max(0,rate)*Math.max(0,dt))
}
/** Short authored drive, not an additive impulse per frame. Incoming forward
 * overspeed is retained; a finite motor brakes opposing momentum first. */
export function attackDriveVelocity(v:number,target:number,acceleration:number,dt:number):number{
 if(target===0)return v
 const direction=Math.sign(target),along=v*direction
 if(along>=Math.abs(target))return v
 return direction*Math.min(Math.abs(target),along+Math.max(0,acceleration)*Math.max(0,dt))
}
export interface LandingLoad{
 impulse:number
 energy:number
 absorptionTime:number
 /** Bounded visual load proxy, not pascals or damage. */
 pressure:number
 compression:number
}
export function landingLoad(normalSpeed:number,mass=PLAYER_MASS):LandingLoad{
 const speed=Math.max(0,normalSpeed),m=Math.max(0,mass)
 const absorptionTime=.08+.08*Math.min(1,speed/1650)
 const impulse=m*speed,energy=.5*m*speed*speed
 return{impulse,energy,absorptionTime,
  pressure:Math.min(1,impulse/absorptionTime/(PLAYER_MASS*1650/.16)),
  compression:Math.min(1,speed/700)}
}
