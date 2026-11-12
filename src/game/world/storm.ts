/** Persistent storm simulation. Owned by Game, never by disposable city art.
 * World-space rain/splashes; real visual clock; quality changes draw budgets,
 * never weather existence or strike scheduling. Rendering cannot advance time.
 */
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
 private x=new Float32Array(CAP)
 private y=new Float32Array(CAP)
 private velocity=new Float32Array(CAP)
 private length=new Float32Array(CAP)
 private splashX=new Float32Array(SPLASHES)
 private splashAge=new Float32Array(SPLASHES).fill(9)
 private splashHead=0
 private impacts=0
 private bolt=new Float32Array(42)
 onThunder:(()=>void)|null=null
 constructor(quality:StormQuality='high'){
  this.quality=quality
  for(let i=0;i<CAP;i++){
   this.x[i]=this.view.x+(this.random()-.5)*1500
   this.y[i]=-this.random()*850
   this.velocity[i]=400+this.random()*480
   this.length[i]=11+this.random()*18
  }
 }
 private random(){this.seed^=this.seed<<13;this.seed^=this.seed>>>17;this.seed^=this.seed<<5;return(this.seed>>>0)/4294967296}
 setQuality(q:StormQuality){this.quality=q}
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
   this.onThunder?.()
  }
  const z=this.view.zoom,span=this.width/z+180,top=Math.min(-180,this.view.y-this.height/(2*z)-80)
  for(let i=0;i<SPLASHES;i++)this.splashAge[i]+=dt
  for(let i=0;i<CAP;i++){
   this.x[i]+=this.velocity[i]*this.wind*dt;this.y[i]+=this.velocity[i]*dt
   if(this.y[i]>=0){
    if(i<budgets[this.quality]){
     this.splashX[this.splashHead]=this.x[i];this.splashAge[this.splashHead]=0
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
  glow.addColorStop(0,'rgba(170,205,255,.38)');glow.addColorStop(1,'rgba(110,150,220,0)')
  ctx.fillStyle=glow;ctx.fillRect(0,0,w,h)
  // No pre-baked bolt offscreen above the skyline: normalized viewport path.
  if(this.strikeAge<.23){
   ctx.beginPath()
   for(let i=0;i<21;i++){const x=bx+this.bolt[i*2]*w,y=-10+this.bolt[i*2+1]*h*.7;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}
   ctx.lineJoin='round';ctx.strokeStyle='rgba(125,180,255,.35)';ctx.lineWidth=16;ctx.stroke()
   ctx.strokeStyle='#c8e8ff';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.stroke()
  }
  ctx.restore()
 }
 drawRain(ctx:CanvasRenderingContext2D){
  const {x:cx,y:cy,zoom:z}=this.view,w=this.width,h=this.height,ground=h*.5-cy*z
  ctx.save();ctx.beginPath();ctx.rect(0,0,w,Math.max(0,Math.min(h,ground)));ctx.clip()
  ctx.lineCap='round'
  // Three coherent world-space depth treatments. Low still draws every band.
  const n=budgets[this.quality]
  for(let band=0;band<3;band++){
   ctx.globalAlpha=(.27+band*.12)*(1+this.intensity*.8)
   ctx.strokeStyle=band===2?'#d2eaf7':'#91b3cb';ctx.lineWidth=band===2?1.5:1
   ctx.beginPath()
   for(let i=band;i<n;i+=3){
    const x=w*.5+(this.x[i]-cx)*z,y=h*.5+(this.y[i]-cy)*z,l=this.length[i]*z
    ctx.moveTo(x,y);ctx.lineTo(x-l*this.wind,y-l)
   }
   ctx.stroke()
  }
  ctx.restore()
  ctx.save();ctx.strokeStyle='#b8ddec';ctx.lineWidth=1
  for(let i=0;i<SPLASHES;i++){
   const age=this.splashAge[i];if(age>=.4)continue
   const u=age/.4,x=w*.5+(this.splashX[i]-cx)*z,y=ground+3*z,r=(2+u*10)*z
   ctx.globalAlpha=(1-u)*(.38+.25*this.intensity)
   ctx.beginPath();ctx.ellipse(x,y,r,r*.23,0,0,Math.PI*2);ctx.stroke()
   if(u<.35){ctx.beginPath();ctx.moveTo(x-3*z,y);ctx.lineTo(x-5*z,y-6*z*(1-u));ctx.moveTo(x+3*z,y);ctx.lineTo(x+5*z,y-6*z*(1-u));ctx.stroke()}
  }
  if(this.intensity>.01){ctx.globalAlpha=this.intensity*.13;ctx.fillStyle='#c2d9ff';ctx.fillRect(0,0,w,h)}
  ctx.restore()
 }
}
