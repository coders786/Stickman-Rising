/** Low grounded dash acting, timed by the force motor rather than render FPS.
 * 150° open silhouette is interpreted as 70° core pitch from upright.
 * Feet are not rotated with the torso: contact IK keeps support on the roof.
 */
const ease=(x:number)=>{const u=Math.max(0,Math.min(1,x));return Math.max(0,Math.min(1,u*u*u*(10+u*(-15+6*u))))}
export function groundedDashAct(age:number,duration:number,load:number,drive:number){
 const times=[0,load,load+drive*.42,load+drive*.9,Math.min(duration*.86,load+drive+.035),duration]
 const pitch=[.18,.42,1.22,1.22,.48,.16]
 const compression=[0,.25,1,1,.5,0]
 let i=0;while(i<4&&age>times[i+1])i++
 const u=ease((age-times[i])/Math.max(.0001,times[i+1]-times[i]))
 const lerp=(v:number[])=>v[i]+(v[i+1]-v[i])*u
 const weight=ease(age/.035)*ease((duration-age)/.055)
 return{pitch:lerp(pitch),compression:lerp(compression),weight,
  beat:age<load?'plant':age<load+drive*.42?'push':age<load+drive*.9?'drive':age<duration*.86?'catch':'rise'}
}
