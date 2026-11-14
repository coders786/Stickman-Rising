/** Persistent storm simulation. Owned by Game, never by disposable city art.
 * World-space rain/splashes; real visual clock; quality changes draw budgets,
 * never weather existence or strike scheduling. Rendering cannot advance time.
 * WEATHER PHYSICS SYNC (universal look contract): splash geometry rides the
 * wind vector with per-impact variety (never a runway grid); rain is depth-
 * layered — thin/dark/slow far, large/translucent near.
 */
import { SPLASH } from '../render/look'
export type StormQuality='low'|'medium'|'high'|'ultra'
export interface StormView{x:number;y:number;zoom:number}
const CAP=288,SPLASHES=64
const budgets={low:96,medium:180,high:288,ultra:288} as const
export class StormEngine{
 private seed=0x7a32d19
 private t=0
 private nextStrike=.85
 private strikeAge=99
 private strikes=0
 private azimuth=0
 private width=1280
 private height=720
 private view:StormView={x:1300,y:-150,zoom:1}
 private quality:StormQuality
 /** per-scene rain visibility dial (1 = storm scene, <1 = light rain moods) */
 rainScale=1
 private x=new Float32Array(CAP)
 private y=new Float32Array(CAP)
 private velocity=new Float32Array(CAP)
 private length=new Float32Array(CAP)
 private splashX=new Float32Array(SPLASHES)
 private splashAge=new Float32Array(SPLASHES).fill(9)
 private splashSeed=new Float32Array(SPLASHES)
 private splashHead=0
 private impacts=0
 private bolt=new Float32Array(42)
 /** fork branches spawned with each strike: 3 forks × 2 points × [x,y] + dir */
 private forks=new Float32Array(3*2*2)
 onThunder:(()=>void)|null=null
 constructor(quality:StormQuality='high'){
  this.quality=quality
  for(let i=0;i<CAP;i++){
   const band=i%3
   this.x[i]=this.view.x+(this.random()-.5)*1500
   this.y[i]=-this.random()*850
   // depth layering: far drops thinner/slower, near drops faster/larger
   this.velocity[i]=band===0?300+this.random()*240:band===1?430+this.random()*320:520+this.random()*420
   this.length[i]=band===0?9+this.random()*11:band===1?12+this.random()*14:14+this.random()*20
  }
 }
 private random(){this.seed^=this.seed<<13;this.seed^=this.seed>>>17;this.seed^=this.seed<<5;return(this.seed>>>0)/4294967296}
 setQuality(q:StormQuality){this.quality=q}
 setRainScale(v:number){this.rainScale=Number.isFinite(v)?Math.max(0,Math.min(1,v)):1}
 resize(w:number,h:number){if(Number.isFinite(w)&&w>0)this.width=w;if(Number.isFinite(h)&&h>0)this.height=h}
 setView(v:StormView){
  if(Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.zoom)&&v.zoom>0)this.view={...v}
 }
 get wind(){return .38+.12*Math.sin(this.t*.7)}
 get intensity(){
  const a=this.strikeAge
  if(a<.055)return 1
  if(a<.115)return .045
  if(a<.19)return .8
  return a<1.1?.6*Math.exp(-(a-.19)*6):0
 }
 get azimuthValue(){return this.azimuth}
 get gust(){return .5+.25*Math.sin(this.t*.7)}
 get snapshot(){return{time:this.t,quality:this.quality,visibleDrops:budgets[this.quality],strikes:this.strikes,intensity:this.intensity,impacts:this.impacts,activeSplashes:this.splashAge.filter(a=>a<.4).length}}
 update(dt:number){
  if(!Number.isFinite(dt)||dt<=0)return
  // Bounded integration, but no dependency on combat slowmo/hitstop.
  let remaining=Math.min(dt,1)
  while(remaining>1e-8){const d=Math.min(remaining,1/60);this.step(d);remaining-=d}
 }
 private step(dt:number){
  this.t+=dt;this.strikeAge+=dt;this.nextStrike-=dt
  if(this.nextStrike<=0){
   this.strikeAge=0;this.nextStrike=4+this.random()*3;this.strikes++;this.azimuth=this.random()*1.6-.8
   for(let i=0;i<21;i++){this.bolt[i*2]=(this.random()-.5)*.12;this.bolt[i*2+1]=i/20}
   // fork branches peel off the main channel at random heights
   for(let f=0;f<3;f++){
    const j=3+((this.random()*15)|0)
    const fx=this.bolt[j*2],fy=this.bolt[j*2+1]
    const dir=this.random()<.5?-1:1
    const seg=.05+this.random()*.11
    this.forks[f*4]=fx;this.forks[f*4+1]=fy
    this.forks[f*4+2]=fx+dir*seg;this.forks[f*4+3]=fy+seg*.85
   }
   this.onThunder?.()
  }
  const z=this.view.zoom,span=this.width/z+180,top=Math.min(-180,this.view.y-this.height/(2*z)-80)
  for(let i=0;i<SPLASHES;i++)this.splashAge[i]+=dt
  for(let i=0;i<CAP;i++){
   this.x[i]+=this.velocity[i]*this.wind*dt;this.y[i]+=this.velocity[i]*dt
   if(this.y[i]>=0){
    if(i<budgets[this.quality]){
     this.splashX[this.splashHead]=this.x[i];this.splashAge[this.splashHead]=0
     this.splashSeed[this.splashHead]=this.random()
     this.splashHead=(this.splashHead+1)%SPLASHES;this.impacts++
    }
    this.y[i]=top-this.random()*180
   }
   if(Math.abs(this.x[i]-this.view.x)>span*.5){
    this.x[i]=this.view.x+(this.random()-.5)*span
    this.y[i]=top+this.random()*(-top)
   }
   // Camera climbs: fill newly exposed sky without waiting for old rain.
   if(this.y[i]>this.view.y+this.height/(2*z)+200&&top<-400)this.y[i]=top+this.random()*300
  }
 }
 drawSky(ctx:CanvasRenderingContext2D){
  const k=this.intensity;if(k<.015)return
  const w=this.width,h=this.height,bx=w*(.5+this.azimuth*.4)
  ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=k
  const glow=ctx.createRadialGradient(bx,h*.18,0,bx,h*.18,w*.6)
  glow.addColorStop(0,'rgba(180,212,255,.5)');glow.addColorStop(.35,'rgba(140,180,245,.18)');glow.addColorStop(1,'rgba(110,150,220,0)')
  ctx.fillStyle=glow;ctx.fillRect(0,0,w,h)
  // No pre-baked bolt offscreen above the skyline: normalized viewport path.
  if(this.strikeAge<.23){
   const px=(i:number)=>bx+this.bolt[i*2]*w
   const py=(i:number)=>-10+this.bolt[i*2+1]*h*.7
   const trace=()=>{ctx.beginPath();for(let i=0;i<21;i++){if(i===0)ctx.moveTo(px(i),py(i));else ctx.lineTo(px(i),py(i))}}
   ctx.lineJoin='round';ctx.lineCap='round'
   // atmospheric glow around the channel first (wide, translucent)
   trace();ctx.strokeStyle='rgba(125,180,255,.12)';ctx.lineWidth=38;ctx.stroke()
   trace();ctx.strokeStyle='rgba(125,180,255,.35)';ctx.lineWidth=16;ctx.stroke()
   // fork branches — thinner, dimmer, peeling off the main channel
   for(let f=0;f<3;f++){
    ctx.beginPath()
    ctx.moveTo(bx+this.forks[f*4]*w,-10+this.forks[f*4+1]*h*.7)
    ctx.lineTo(bx+this.forks[f*4+2]*w,-10+this.forks[f*4+3]*h*.7)
    ctx.strokeStyle='rgba(125,180,255,.22)';ctx.lineWidth=8;ctx.stroke()
    ctx.strokeStyle='rgba(200,232,255,.6)';ctx.lineWidth=2;ctx.stroke()
   }
   trace();ctx.strokeStyle='#c8e8ff';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.stroke()
  }
  ctx.restore()
 }
 drawRain(ctx:CanvasRenderingContext2D){
  const {x:cx,y:cy,zoom:z}=this.view,w=this.width,h=this.height,ground=h*.5-cy*z
  ctx.save();ctx.beginPath();ctx.rect(0,0,w,Math.max(0,Math.min(h,ground)));ctx.clip()
  ctx.lineCap='round'
  // Three coherent world-space depth treatments. Low still draws every band.
  // Each band is a WIDE DIM HALO plus a BRIGHT CORE — the core additive so
  // the bloom pass turns every streak into a lit filament.
  const n=budgets[this.quality]
  // DEPTH LAYERING (weather-physics sync): far rain thin/dark/dim, near rain
  // larger but MORE transparent so it never clutters the playable foreground.
  const hA=[.11,.15,.17],hC=['#22323f','#2c4152','#3a5062'],hW=[1.1,1.7,3.0]
  for(let band=0;band<3;band++){
   ctx.globalAlpha=(hA[band]+this.intensity*.1)*(1+band*.35)*this.rainScale
   ctx.strokeStyle=hC[band];ctx.lineWidth=hW[band]
   ctx.beginPath()
   for(let i=band;i<n;i+=3){
    const x=w*.5+(this.x[i]-cx)*z,y=h*.5+(this.y[i]-cy)*z,l=this.length[i]*z
    ctx.moveTo(x,y);ctx.lineTo(x-l*this.wind,y-l)
   }
   ctx.stroke()
  }
  ctx.globalCompositeOperation='lighter'
  const cA=[.24,.32,.3],cC=['#5c7d96','#7fa6c2','#a8c8dd'],cW=[.7,1.0,1.6]
  for(let band=0;band<3;band++){
   ctx.globalAlpha=(cA[band])*(1+this.intensity*.8)*this.rainScale
   ctx.strokeStyle=cC[band];ctx.lineWidth=cW[band]
   ctx.beginPath()
   for(let i=band;i<n;i+=3){
    const x=w*.5+(this.x[i]-cx)*z,y=h*.5+(this.y[i]-cy)*z,l=this.length[i]*z
    ctx.moveTo(x,y);ctx.lineTo(x-l*this.wind,y-l)
   }
   ctx.stroke()
  }
  ctx.globalCompositeOperation='source-over'
  ctx.restore()
  // SPLASHES — per-impact variety: seeded size/tilt/jitter, rings ride the
  // wind vector. Not every impact pops a ring, so the roof never reads as a
  // grid of identical runway lights.
  ctx.save();ctx.strokeStyle='#b8ddec';ctx.lineWidth=1
  const windTilt=this.wind*SPLASH.tiltGain
  for(let i=0;i<SPLASHES;i++){
   const age=this.splashAge[i];if(age>=.4)continue
   const sd=this.splashSeed[i]
   if(sd<.24)continue
   const u=age/.4,x=w*.5+(this.splashX[i]-cx)*z,y=ground+(3+(sd-.5)*8)*z
   const r=(2+u*10)*z*(.65+sd*.8)
   ctx.globalAlpha=(1-u)*(SPLASH.baseAlpha+.26*this.intensity)*(.65+sd*.7)
   const tilt=windTilt+(sd-.5)*.2
   ctx.beginPath();ctx.ellipse(x,y,r,r*SPLASH.squash,tilt,0,Math.PI*2);ctx.stroke()
   if(u<.35&&sd>.42){ // crown ticks lean with the wind vector
    const lean=windTilt*10*z
    ctx.beginPath();ctx.moveTo(x-3*z,y);ctx.lineTo(x-5*z+lean,y-6*z*(1-u));ctx.moveTo(x+3*z,y);ctx.lineTo(x+5*z+lean,y-6*z*(1-u));ctx.stroke()}
   // impact sparkle where the drop met the roof film
   if(u<.18){
    ctx.globalAlpha=(1-u/.18)*.42
    ctx.fillStyle='#cfe9f8'
    ctx.fillRect(x-1,y-1.2*z,2,2.4*z)
   }
  }
  if(this.intensity>.01){ctx.globalAlpha=this.intensity*.22;ctx.fillStyle='#cfe0ff';ctx.fillRect(0,0,w,h)}
  ctx.restore()
 }
}
