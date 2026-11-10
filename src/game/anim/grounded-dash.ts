/** Upright standard dash: planted push, gather and low split-stance catch.
 * The powered dash has a separate near-ground drive and timing.
 * Curves are shape-preserving, velocity-continuous at in-between keys, and
 * sampled in seconds so rendering rate does not change the authored motion.
 */
const ease=(x:number)=>{const u=Math.max(0,Math.min(1,x));return u*u*u*(10+u*(-15+6*u))}
// [normalized time, torso pitch, compression, rear reach, hip drop, catch]
const ACT=[
 [0,   .12,.15,.05,.15,0],
 [.08, .16,.35,.25,.20,0],
 [.20, .20,.50,.70,.28,0],
 [.35, .20,.55,.80,.34,.04],
 [.50, .16,.65,.45,.48,.20],
 [.64, .10,.80,.20,.75,.55],
 [.76, .04,1,  0,  1,  1],
 [1,   .04,1,  0,  1,  1],
] as const

type Channel=1|2|3|4|5
/** Monotone cubic Hermite slope: zero at direction changes, continuous where
 * the movement continues, bounded between keys (no joint overshoot). */
function tangent(d0:number,d1:number,h0:number,h1:number):number{
 if(d0*d1<=0)return 0
 const w0=2*h1+h0,w1=h1+2*h0
 return (w0+w1)/(w0/d0+w1/d1)
}
function sample(index:number,t:number,ch:Channel):number{
 const a=ACT[index],b=ACT[index+1],h=b[0]-a[0],u=Math.max(0,Math.min(1,(t-a[0])/h))
 const prev=index>0?ACT[index-1]:a,next=index+2<ACT.length?ACT[index+2]:b
 const hp=index>0?a[0]-prev[0]:h,hn=index+2<ACT.length?next[0]-b[0]:h
 const slope=(b[ch]-a[ch])/h
 const m0=tangent((a[ch]-prev[ch])/hp,slope,hp,h),m1=tangent(slope,(next[ch]-b[ch])/hn,h,hn)
 const u2=u*u,u3=u2*u
 return (2*u3-3*u2+1)*a[ch]+(u3-2*u2+u)*h*m0+(-2*u3+3*u2)*b[ch]+(u3-u2)*h*m1
}
export function groundedDashAct(age:number,duration:number,load:number,drive:number){
 const t=Math.max(0,Math.min(1,age/Math.max(.0001,duration)))
 let i=0;while(i<ACT.length-2&&t>ACT[i+1][0])i++
 return{pitch:sample(i,t,1),compression:sample(i,t,2),rearReach:sample(i,t,3),drop:sample(i,t,4),catch:sample(i,t,5),weight:ease(age/.035),
  beat:age<load?'plant':age<load+drive*.42?'push':age<load+drive*.9?'drive':t<.88?'catch':'rise'}
}
