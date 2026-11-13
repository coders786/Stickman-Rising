import {StormEngine} from './storm'
import type {BgCam} from './background'

const TAU=Math.PI*2
const ARENA_X0=-150,ARENA_X1=2750
const clamp01=(v:number)=>Math.max(0,Math.min(1,v))
function canvas(w:number,h:number){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');if(!g)throw Error('2D canvas unavailable');return{c,g}}
function noise(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/** Ultra-only cinematic 2.5D garden. Expensive shapes are cached on resize;
 * each live frame is primarily image blits, six cloud/fog sprites and a
 * bounded petal pool. */
export class ZenNightBackground{
 readonly storm:StormEngine
 private w=1280;private h=720;private t=0;private built=false
 private staticFar:HTMLCanvasElement|null=null
 private staticMid:HTMLCanvasElement|null=null
 private moon:HTMLCanvasElement|null=null
 private fog:HTMLCanvasElement|null=null
 private cloud:HTMLCanvasElement|null=null
 private shaft:HTMLCanvasElement|null=null
 private petal:HTMLCanvasElement|null=null
 private px=new Float32Array(70);private py=new Float32Array(70);private pz=new Float32Array(70);private pp=new Float32Array(70)
  private moonVisibility=.9
  /** shared moon state for the render pass (BackgroundRenderer contract):
   *  disc center + eclipse coverage from the analytic cloud transmission */
  moonX=0
  moonY=0
  moonCover=0
 // Five depth-sorted cloud banks create a cheap 3D skybox. Their coverage is
 // solved analytically, so moonlight can be occluded without canvas readback.
 private cloudX=new Float32Array([-520,-80,410,880,1330])
 private cloudZ=new Float32Array([.18,.34,.52,.72,.9])
 get onThunder(){return this.storm.onThunder}set onThunder(v:(()=>void)|null){this.storm.onThunder=v}
 constructor(storm=new StormEngine('ultra')){this.storm=storm;const r=noise(0x51a9c3);for(let i=0;i<70;i++){this.px[i]=r()*2200;this.py[i]=r()*720;this.pz[i]=r();this.pp[i]=r()*TAU}}
 resize(w:number,h:number){this.w=Math.max(1,w);this.h=Math.max(1,h);this.storm.resize(w,h);this.built=false}
 update(dt:number){const d=Math.min(.1,Math.max(0,dt));this.t+=d;for(let i=0;i<this.cloudX.length;i++){this.cloudX[i]+=d*(3.2+this.cloudZ[i]*4.8);if(this.cloudX[i]>this.w+620)this.cloudX[i]=-720}}
 lightningI(){return this.storm.intensity}
 lightningAz(){return this.storm.azimuthValue}

 private ensure(){if(this.built)return;this.built=true;this.buildSprites();this.buildStatic()}
 private buildSprites(){
  {const {c,g}=canvas(360,360);let q=g.createRadialGradient(180,180,42,180,180,176);q.addColorStop(0,'rgba(190,207,207,.25)');q.addColorStop(.48,'rgba(112,143,151,.09)');q.addColorStop(1,'rgba(70,100,112,0)');g.fillStyle=q;g.fillRect(0,0,360,360);q=g.createRadialGradient(168,162,10,180,180,72);q.addColorStop(0,'#e1e1d6');q.addColorStop(.72,'#c2c8c3');q.addColorStop(1,'#818f91');g.fillStyle=q;g.beginPath();g.arc(180,180,72,0,TAU);g.fill();const r=noise(77);for(let i=0;i<22;i++){g.fillStyle=`rgba(54,68,70,${.025+r()*.07})`;g.beginPath();g.ellipse(145+r()*75,140+r()*80,3+r()*12,2+r()*7,r()*TAU,0,TAU);g.fill()}this.moon=c}
  {const {c,g}=canvas(1024,220),r=noise(912);for(let i=0;i<16;i++){const x=r()*1024,y=75+r()*95,rx=75+r()*145,ry=18+r()*40,q=g.createRadialGradient(x,y,0,x,y,rx);q.addColorStop(0,`rgba(147,169,171,${.07+r()*.09})`);q.addColorStop(1,'rgba(115,142,146,0)');g.save();g.scale(1,ry/rx);g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}this.fog=c}
  {const {c,g}=canvas(800,220),r=noise(318);for(let i=0;i<15;i++){const x=45+r()*710,y=64+r()*82,rx=68+r()*125,ry=24+r()*38,q=g.createRadialGradient(x,y-ry*.32,2,x,y,rx);q.addColorStop(0,`rgba(80,99,113,${.22+r()*.1})`);q.addColorStop(.48,`rgba(25,37,51,${.42+r()*.16})`);q.addColorStop(1,'rgba(3,7,14,0)');g.save();g.scale(1,ry/rx);g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}const under=g.createLinearGradient(0,105,0,210);under.addColorStop(0,'rgba(2,6,13,0)');under.addColorStop(.52,'rgba(2,5,12,.28)');under.addColorStop(1,'rgba(2,5,12,0)');g.fillStyle=under;g.fillRect(0,90,800,120);this.cloud=c}
  {const {c,g}=canvas(96,360);for(let y=0;y<360;y++){const u=y/360,half=5+u*38,a=.055*(1-u)*Math.sin(Math.PI*u);const q=g.createLinearGradient(48-half,y,48+half,y);q.addColorStop(0,'rgba(164,190,191,0)');q.addColorStop(.5,`rgba(164,190,191,${a})`);q.addColorStop(1,'rgba(164,190,191,0)');g.fillStyle=q;g.fillRect(48-half,y,half*2,1)}this.shaft=c}
  {const {c,g}=canvas(20,16);g.fillStyle='#b5a1aa';g.beginPath();g.moveTo(2,8);g.quadraticCurveTo(8,0,18,5);g.quadraticCurveTo(10,15,2,8);g.fill();g.strokeStyle='rgba(226,215,217,.45)';g.lineWidth=.7;g.stroke();this.petal=c}
 }
 private buildStatic(){
  const W=Math.min(1920,Math.ceil(this.w*1.25)),H=Math.min(1080,Math.ceil(this.h*1.25)),r=noise(0x2204)
  {const {c,g}=canvas(W,H);const sky=g.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#030610');sky.addColorStop(.43,'#09111d');sky.addColorStop(.74,'#14212a');sky.addColorStop(1,'#263136');g.fillStyle=sky;g.fillRect(0,0,W,H);g.fillStyle='rgba(205,221,222,.58)';for(let i=0;i<125;i++){const y=r()*H*.56,a=.12+r()*.58,s=r()<.08?1.8:1;g.globalAlpha=a;g.fillRect(r()*W,y,s,s)}g.globalAlpha=1
   // three mountain depth planes
   const mountain=(base:number,amp:number,col:string,step:number)=>{g.fillStyle=col;g.beginPath();g.moveTo(0,H);g.lineTo(0,base);for(let x=0;x<=W+step;x+=step)g.lineTo(x,base-(.25+r()*.75)*amp);g.lineTo(W,H);g.fill()}
   mountain(H*.66,H*.16,'#101923',120);mountain(H*.72,H*.13,'#0b141b',95);mountain(H*.78,H*.1,'#091116',75);this.staticFar=c}
  {const {c,g}=canvas(W,H);const ground=H*.79
   // TORII silhouette on the far left, composed as timber rather than bars.
   g.fillStyle='#080b0d';const tx=W*.055;g.fillRect(tx,ground-330,18,340);g.fillRect(tx+145,ground-330,18,340);g.fillRect(tx-24,ground-340,210,18);g.fillRect(tx-10,ground-305,180,11)
   g.fillStyle='rgba(92,105,105,.12)';g.fillRect(tx+3,ground-326,3,320);g.fillRect(tx+148,ground-326,3,320)
   // Cedar tea house with layered tile roof and warm doorway bounce.
   const sx=W*.16,sy=ground-154,sw=270;g.fillStyle='#101617';g.fillRect(sx,sy,sw,154)
   for(let x=sx+8;x<sx+sw;x+=15){g.strokeStyle='rgba(125,133,126,.13)';g.beginPath();g.moveTo(x,sy+4);g.lineTo(x,ground);g.stroke()}
   const door=g.createLinearGradient(sx+92,sy+45,sx+154,sy+45);door.addColorStop(0,'rgba(117,65,38,.2)');door.addColorStop(.5,'#e7b38a');door.addColorStop(1,'rgba(102,51,32,.2)');g.fillStyle=door;g.fillRect(sx+96,sy+44,58,110)
   const glow=g.createRadialGradient(sx+125,ground-52,2,sx+125,ground-52,120);glow.addColorStop(0,'rgba(255,190,137,.18)');glow.addColorStop(1,'rgba(255,160,100,0)');g.fillStyle=glow;g.fillRect(sx+5,sy-5,240,170)
   g.fillStyle='#080b0c';g.beginPath();g.moveTo(sx-38,sy+4);g.lineTo(sx+sw*.5,sy-62);g.lineTo(sx+sw+38,sy+4);g.closePath();g.fill()
   // Individual ceramic roof tiles: cached once, so detail is free per frame.
   g.strokeStyle='rgba(130,146,143,.24)';g.lineWidth=2;for(let row=0;row<5;row++)for(let col=0;col<15-row;col++){const x=sx-23+col*21+row*10,y=sy-5-row*10;g.beginPath();g.arc(x,y,13,Math.PI*.08,Math.PI*.92);g.stroke()}
   // Hero sakura: tapered trunk, recursively split limbs and bark highlights.
   const bx=W*.86,by=ground+10;g.lineCap='round'
   const branch=(x:number,y:number,x2:number,y2:number,w:number,depth:number)=>{g.strokeStyle=depth<2?'#07090a':'#0b0d0e';g.lineWidth=w;g.beginPath();g.moveTo(x,y);g.bezierCurveTo(x+(x2-x)*.28-w*.25,y+(y2-y)*.22,x+(x2-x)*.72+w*.18,y+(y2-y)*.7,x2,y2);g.stroke();g.strokeStyle='rgba(112,119,113,.18)';g.lineWidth=Math.max(1,w*.09);g.stroke();if(depth>0){branch(x2,y2,x2-(44+depth*23),y2-(44+depth*20),w*.61,depth-1);branch(x2,y2,x2+(53+depth*27),y2-(32+depth*24),w*.56,depth-1)}}
   branch(bx,by,bx-24,ground-210,46,3);branch(bx-22,ground-185,bx-120,ground-292,25,2);branch(bx-12,ground-245,bx+87,ground-335,22,2)
   // Thousands of blossoms are suggested by small clustered petals, never
   // the large translucent bokeh circles that made the old tree look flat.
   const blossom=noise(0x8341);for(let i=0;i<420;i++){const side=blossom()<.56?-1:1,cx=bx+side*(55+blossom()*255),cy=ground-265-blossom()*190+(Math.abs(cx-bx)*.16),rad=1.2+blossom()*3.6;g.fillStyle=`rgba(${183+(blossom()*43|0)},${143+(blossom()*38|0)},${163+(blossom()*37|0)},${.34+blossom()*.48})`;g.beginPath();for(let q=0;q<5;q++){const an=q*TAU/5,px=cx+Math.cos(an)*rad,py=cy+Math.sin(an)*rad*.7;g.moveTo(px+rad*.65,py);g.arc(px,py,rad*.65,0,TAU)}g.fill()}
   // Root flare anchors the tree to the deck.
   g.fillStyle='#080a0b';g.beginPath();g.moveTo(bx-30,ground);g.quadraticCurveTo(bx-85,ground+6,bx-125,ground+17);g.lineTo(bx+95,ground+17);g.quadraticCurveTo(bx+38,ground+2,bx+22,ground-8);g.fill()
   this.staticMid=c}
 }

 /** zen-night draws its own pre-softened beam shafts (zero runtime blur by
  *  design) — the generic god-ray pass gets an empty mask here. */
 drawShaftMask(_ctx:CanvasRenderingContext2D,_cam:BgCam){}
 /** zen-night's water is its own garden mirror — no shared roughness plate */
 drawWetMask(_ctx:CanvasRenderingContext2D){}
 /** zen-night's garden lights are its own system */
 drawLightRig(_ctx:CanvasRenderingContext2D,_moonWorldX:number){}
 drawSky(ctx:CanvasRenderingContext2D,cam:BgCam){this.ensure();const w=this.w,h=this.h,t=this.t,hy=h*.5+(0-cam.y)*cam.zoom
  ctx.save();ctx.drawImage(this.staticFar!,0,0,w,h)
  // cached moon with a stable celestial parallax
  const mx=w*.72-cam.x*.018,my=h*.18-(cam.y+170)*.035
  ctx.drawImage(this.moon!,mx-180,my-180,360,360)
  // Depth-sorted cloud skybox. Scale, vertical parallax and differential
  // drift supply volume while remaining only five cached image blits/frame.
  let transmission=1
  for(let k=0;k<this.cloudX.length;k++){const z=this.cloudZ[k],cw=520+z*330,ch=143+z*82,x=this.cloudX[k]-cam.x*(.008+.025*z),y=my-105+(z-.5)*88+Math.sin(t*.045+k*1.7)*13;const dx=Math.abs((x+cw*.5)-mx),dy=Math.abs((y+ch*.48)-my);if(dx<cw*.39&&dy<ch*.31){const core=(1-dx/(cw*.39))*(1-dy/(ch*.31));transmission*=1-core*(.64+.28*z)}ctx.globalAlpha=.38+.28*z;ctx.drawImage(this.cloud!,x,y,cw,ch)}
  // Slow attack/release prevents light popping as soft cloud edges cross.
  const target=.06+.94*transmission,rate=target<this.moonVisibility?.018:.006
  this.moonVisibility+=(target-this.moonVisibility)*rate*60
  this.moonX=mx;this.moonY=my;this.moonCover=1-this.moonVisibility
  ctx.globalAlpha=1
  // pre-softened shafts: no hard polygon edges and no runtime blur/filter
  ctx.globalCompositeOperation='screen';ctx.globalAlpha=this.moonVisibility;for(let i=0;i<3;i++){const x=mx-72+i*72;ctx.save();ctx.translate(x,my+46);ctx.rotate(-.18+i*.035);ctx.drawImage(this.shaft!,-48,0,96,Math.max(260,hy-my));ctx.restore()}ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'
  // THE STORM ABOVE THE GARDEN — forked bolt + sky glow, drawn over the
  // cloud deck but occluded by the foreground garden silhouette below
  this.storm.drawSky(ctx)
  // mid garden cache parallax
  const shift=-(cam.x*.075)%w;ctx.drawImage(this.staticMid!,shift,0,w,h);ctx.drawImage(this.staticMid!,shift+(shift>0?-w:w),0,w,h)
  // two wrapped fog depths
  for(let band=0;band<2;band++){ctx.globalAlpha=(band?.19:.13)*this.moonVisibility;const y=hy-135+band*80,off=((t*(band?7:-4)-cam.x*(band?.13:.07))%1024+1024)%1024;for(let x=off-1024;x<w;x+=1024)ctx.drawImage(this.fog!,x,y,1024,220)}ctx.globalAlpha=1
  // quiet combat pocket: lifts the value immediately behind silhouettes
  const pocket=ctx.createRadialGradient(w*.5,hy-75,20,w*.5,hy-75,285);pocket.addColorStop(0,'rgba(112,137,139,.115)');pocket.addColorStop(.55,'rgba(70,93,99,.045)');pocket.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=pocket;ctx.fillRect(0,Math.max(0,hy-390),w,390)
  ctx.restore()}

 drawArena(ctx:CanvasRenderingContext2D){this.ensure();const t=this.t
  // Rain-darkened wooden engawa: long boards, alternating grain and narrow
  // seams provide the perspective-rich level floor from the concept art.
  const grad=ctx.createLinearGradient(0,0,0,270);grad.addColorStop(0,'#354142');grad.addColorStop(.16,'#202a2b');grad.addColorStop(1,'#070b0d');ctx.fillStyle=grad;ctx.fillRect(ARENA_X0,0,ARENA_X1-ARENA_X0,270)
  for(let x=ARENA_X0;x<ARENA_X1;x+=74){ctx.fillStyle=((x/74|0)&1)?'rgba(106,125,124,.035)':'rgba(2,7,9,.04)';ctx.fillRect(x,1,73,190);ctx.strokeStyle='rgba(2,6,8,.42)';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+19,220);ctx.stroke();ctx.strokeStyle='rgba(154,170,166,.08)';ctx.lineWidth=.7;for(let q=0;q<3;q++){const yy=23+q*48+Math.sin(x*.07+q)*8;ctx.beginPath();ctx.moveTo(x+8,yy);ctx.bezierCurveTo(x+25,yy-5,x+43,yy+6,x+66,yy);ctx.stroke()}}
  // Cross-board joins and tiny rain beads break the procedural regularity.
  ctx.strokeStyle='rgba(5,9,11,.38)';for(let y=82;y<250;y+=83){ctx.beginPath();ctx.moveTo(ARENA_X0,y);ctx.lineTo(ARENA_X1,y);ctx.stroke()}
  ctx.globalCompositeOperation='screen';for(let i=0;i<13;i++){const y=3+i*3.5,w=18+i*8,a=.035*(1-i/15)*this.moonVisibility;ctx.fillStyle=`rgba(172,190,187,${a})`;ctx.fillRect(1750-w*.5+Math.sin(i*7.1)*20,y,w,1.2)}ctx.globalCompositeOperation='source-over'
  // Shallow irregular pond/puddle with animated moon-silver ripples.
  ctx.save();ctx.translate(2050,34);ctx.fillStyle='rgba(5,15,20,.62)';ctx.beginPath();ctx.ellipse(0,38,185,54,-.04,0,TAU);ctx.fill();ctx.strokeStyle='rgba(151,177,181,.22)';ctx.lineWidth=1.2;for(let i=0;i<7;i++){const rw=38+i*19+Math.sin(t*.8+i)*7;ctx.beginPath();ctx.ellipse(Math.sin(i*2.4)*42,35+i%2*8,rw,5+i*.45,0,0,TAU);ctx.stroke()}ctx.restore()
  // low world-space mist
  ctx.globalAlpha=.13;const off=((t*9)%1024+1024)%1024;for(let x=ARENA_X0-1024+off;x<ARENA_X1;x+=1024)ctx.drawImage(this.fog!,x,-85,1024,170);ctx.globalAlpha=1}

 drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam){this.ensure();this.storm.setView(cam);this.storm.drawRain(ctx);const w=this.w,h=this.h,t=this.t
  // pooled depth petals; one atlas sprite, no allocations
  for(let i=0;i<70;i++){const z=this.pz[i],x=((this.px[i]+t*(12+25*z)+Math.sin(t*.7+this.pp[i])*22-this.t*.0)%(w+120))-60,y=(this.py[i]+t*(9+18*z))%(h+80)-40;if(y>h*.82)continue;ctx.save();ctx.globalAlpha=.18+.5*z;ctx.translate(x,y);ctx.rotate(t*(.35+z)+this.pp[i]);const s=3+7*z;ctx.drawImage(this.petal!,-s,-s*.55,s*2,s*1.1);ctx.restore()}
  // restrained cool atmospheric grade
  const v=ctx.createRadialGradient(w*.5,h*.5,Math.min(w,h)*.25,w*.5,h*.5,Math.max(w,h)*.72);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,4,11,.32)');ctx.fillStyle=v;ctx.fillRect(0,0,w,h)}
}
