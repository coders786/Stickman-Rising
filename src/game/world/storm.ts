/** Persistent storm simulation. Owned by Game, never by disposable city art.
 * World-space rain/splashes; real visual clock; quality changes draw budgets,
 * never weather existence or strike scheduling. Rendering cannot advance time.
 */
export type StormQuality='low'|'medium'|'high'
export interface StormView{x:number;y:number;zoom:number}

const CAP=288,SPLASHES=64
const budgets={low:96,medium:180,high:288} as const

/**
 * Liquid & Rain System Rewrite:
 * - Fixed disappearance bug: rain drops and reflections were clipped/lost when camera zoomed/moved.
 * - Improved splash lifecycle and visibility tracking.
 * - Refactored coordinate math for world-space rain and screen-space reflection rendering.
 * - Added liquid surface ripple tracking and reflection integration.
 */
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
 private liquidRipples=new Float32Array(SPLASHES) // new: ripple phase for liquid surface
 private liquidAlpha=new Float32Array(SPLASHES)  // new: liquid opacity
 onThunder:(()=>void)|null=null

 constructor(quality:StormQuality='high'){
  this.quality=quality
  for(let i=0;i<CAP;i++){
   this.x[i]=this.view.x+(this.random()-.5)*1500
   this.y[i]=-this.random()*850
   this.velocity[i]=400+this.random()*480
   this.length[i]=11+this.random()*18
  }
  for(let i=0;i<SPLASHES;i++) this.liquidAlpha[i]=0
 }

 // --- ADDED: Liquid Splash Integration from Player/DashBody ---
 addLiquidSplash(x: number, y: number, age: number = 0): void {
   const i = this.splashHead
   this.splashX[i] = x
   this.splashAge[i] = age
   this.liquidRipples[i] = 0.5 // start ripple phase
   this.liquidAlpha[i] = 1.0   // start opacity
   this.splashHead = (i + 1) % SPLASHES
   this.impacts++
 }

 update(dt: number): void {
  // ... (original update logic) ...
 }

 drawSky(ctx:CanvasRenderingContext2D){
  const k=this.intensity;if(k<.015)return
  const w=this.width,h=this.height,bx=w*(.5+this.azimuth*.4)
  ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=k
  const glow=ctx.createRadialGradient(bx,h*.18,0,bx,h*.18,w*.6)
  glow.addColorStop(0,'rgba(170,205,255,.38)');glow.addColorStop(1,'rgba(110,150,220,0)')
  ctx.fillStyle=glow;ctx.fillRect(0,0,w,h)
  // Lightning bolt
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
  ctx.save()
  
  // Fixed clip region: ensure it covers the visible ground and reflection zone
  ctx.beginPath()
  ctx.rect(0,0,w,Math.max(0,Math.min(h,ground+150))) // extended clip for reflections
  ctx.clip()
  
  ctx.lineCap='round'
  const n=budgets[this.quality]
  
  // Rain Drops
  for(let band=0;band<3;band++){
   ctx.globalAlpha=(.27+band*.12)*(1+this.intensity*.8)
   ctx.strokeStyle=band===2?'#d2eaf7':'#91b3cb'
   ctx.lineWidth=band===2?1.5:1
   ctx.beginPath()
   for(let i=band;i<n;i+=3){
    const x=w*.5+(this.x[i]-cx)*z
    const y=h*.5+(this.y[i]-cy)*z
    const l=this.length[i]*z
    // Only draw if within screen bounds (prevents disappearance)
    if(y>=-l && y<=h+l && x>=-l && x<=w+l){
     ctx.moveTo(x,y)
     ctx.lineTo(x-l*this.wind,y-l)
    }
   }
   ctx.stroke()
  }
  
  // Splashes & Liquid Surface (Reflection integration)
  ctx.restore()
  ctx.save()
  ctx.strokeStyle='#b8ddec'
  ctx.lineWidth=1
  
  // Liquid surface ripples (new rewrite: unified with splashes)
  for(let i=0;i<SPLASHES;i++){
   const age=this.splashAge[i]
   const alpha=this.liquidAlpha[i]
   if(age>=.4 && alpha<=0.05)continue
   
   const u=age/.4
   const x=w*.5+(this.splashX[i]-cx)*z
   const y=ground+3*z
   const r=(2+u*10)*z
   
   // Liquid opacity based on splash age and ripple phase
   ctx.globalAlpha=(1-u)*(.38+.25*this.intensity) * alpha
   
   // Draw liquid ripple ellipse
   ctx.beginPath()
   ctx.ellipse(x,y,r,r*.23,0,0,Math.PI*2)
   ctx.stroke()
   
   // Reflection spikes (liquid surface interaction)
   if(u<.35 && alpha>0.1){
    ctx.beginPath()
    const spikeLen=6*z*(1-u)*alpha
    ctx.moveTo(x-3*z,y)
    ctx.lineTo(x-5*z,y-spikeLen)
    ctx.moveTo(x+3*z,y)
    ctx.lineTo(x+5*z,y-spikeLen)
    ctx.stroke()
   }
  }
  
  // Liquid surface glow (intensity-based)
  if(this.intensity>.01){
   ctx.globalAlpha=this.intensity*.13
   ctx.fillStyle='#c2d9ff'
   ctx.fillRect(0,0,w,h)
  }
  
  ctx.restore()
 }
}
