import {StormEngine} from './storm'
import type {BgCam} from './background'
import {keyLightFromStorm} from '../render/lighting'

const TAU=Math.PI*2
const ARENA_X0=-150,ARENA_X1=2750
const ARENA_W=ARENA_X1-ARENA_X0
/** NOMINAL camera y — the sky/mask moon twins share this anchor */
const NOMINAL_Y=-170
const clamp01=(v:number)=>Math.max(0,Math.min(1,v))
function canvas(w:number,h:number){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');if(!g)throw Error('2D canvas unavailable');return{c,g}}
function noise(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/** world-space garden anchors — the tea-house door and the tall stone
 *  lantern sit exactly where the shared renderer emitters stand
 *  (DOOR_LIGHT 1755,-120 · STREET_LIGHT 830,-252) */
const DOOR_X=1755,LANTERN_X=830,POND_X=2050,POND_Y=34,SAKURA_X=2520,TORII_X=310

/**
 * MOONLIT ZEN — a Japanese garden terrace on a rooftop high above a
 * sleeping city, in light rain under a big moon.
 *
 * Layer contract (matches BackgroundRenderer):
 *  - staticFar : screen-space sky, stars, three atmospheric mountain planes
 *    with moonlit ridge rims, distant dim city windows (no-disco: sparse,
 *    dim, never neon)
 *  - staticMid : parallax bamboo grove silhouette band
 *  - staticDeck/staticGarden : WORLD-space bakes (the engawa boards and the
 *    tea house / torii / stone lantern / sakura / fence props align with the
 *    gameplay plane and the shared emitters)
 *  - live per frame: pond ripples, mist, the typed light rig (moon pool +
 *    glitter lane + practical warm pools), wet roughness plate, rain/petals
 *
 * Expensive shapes are cached on resize; each live frame is image blits,
 * a handful of gradients and a bounded petal pool.
 */
export class ZenNightBackground{
 readonly storm:StormEngine
 private w=1280;private h=720;private t=0;private built=false
 private staticFar:HTMLCanvasElement|null=null
 private staticMid:HTMLCanvasElement|null=null
 private staticDeck:HTMLCanvasElement|null=null
 private staticGarden:HTMLCanvasElement|null=null
 private wetPlate:HTMLCanvasElement|null=null
 private moon:HTMLCanvasElement|null=null
 private fog:HTMLCanvasElement|null=null
 private cloud:HTMLCanvasElement|null=null
 private shaft:HTMLCanvasElement|null=null
 private petal:HTMLCanvasElement|null=null
 private deckPool:HTMLCanvasElement|null=null
 private warmPool:HTMLCanvasElement|null=null
 private glitter:HTMLCanvasElement|null=null
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
  // MOON — distant celestial body: pale disc + mare mottling + soft halo
  {const {c,g}=canvas(360,360);let q=g.createRadialGradient(180,180,42,180,180,176);q.addColorStop(0,'rgba(190,207,207,.25)');q.addColorStop(.48,'rgba(112,143,151,.09)');q.addColorStop(1,'rgba(70,100,112,0)');g.fillStyle=q;g.fillRect(0,0,360,360);q=g.createRadialGradient(168,162,10,180,180,72);q.addColorStop(0,'#e1e1d6');q.addColorStop(.72,'#c2c8c3');q.addColorStop(1,'#818f91');g.fillStyle=q;g.beginPath();g.arc(180,180,72,0,TAU);g.fill();const r=noise(77);for(let i=0;i<22;i++){g.fillStyle=`rgba(54,68,70,${.025+r()*.07})`;g.beginPath();g.ellipse(145+r()*75,140+r()*80,3+r()*12,2+r()*7,r()*TAU,0,TAU);g.fill()}this.moon=c}
  {const {c,g}=canvas(1024,220),r=noise(912);for(let i=0;i<16;i++){const x=r()*1024,y=75+r()*95,rx=75+r()*145,ry=18+r()*40,q=g.createRadialGradient(x,y,0,x,y,rx);q.addColorStop(0,`rgba(147,169,171,${.07+r()*.09})`);q.addColorStop(1,'rgba(115,142,146,0)');g.save();g.scale(1,ry/rx);g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}this.fog=c}
  {const {c,g}=canvas(800,220),r=noise(318);for(let i=0;i<15;i++){const x=45+r()*710,y=64+r()*82,rx=68+r()*125,ry=24+r()*38,q=g.createRadialGradient(x,y-ry*.32,2,x,y,rx);q.addColorStop(0,`rgba(80,99,113,${.22+r()*.1})`);q.addColorStop(.48,`rgba(25,37,51,${.42+r()*.16})`);q.addColorStop(1,'rgba(3,7,14,0)');g.save();g.scale(1,ry/rx);g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}const under=g.createLinearGradient(0,105,0,210);under.addColorStop(0,'rgba(2,6,13,0)');under.addColorStop(.52,'rgba(2,5,12,.28)');under.addColorStop(1,'rgba(2,5,12,0)');g.fillStyle=under;g.fillRect(0,90,800,120);this.cloud=c}
  {const {c,g}=canvas(96,360);for(let y=0;y<360;y++){const u=y/360,half=5+u*38,a=.055*(1-u)*Math.sin(Math.PI*u);const q=g.createLinearGradient(48-half,y,48+half,y);q.addColorStop(0,'rgba(164,190,191,0)');q.addColorStop(.5,`rgba(164,190,191,${a})`);q.addColorStop(1,'rgba(164,190,191,0)');g.fillStyle=q;g.fillRect(48-half,y,half*2,1)}this.shaft=c}
  {const {c,g}=canvas(20,16);g.fillStyle='#b5a1aa';g.beginPath();g.moveTo(2,8);g.quadraticCurveTo(8,0,18,5);g.quadraticCurveTo(10,15,2,8);g.fill();g.strokeStyle='rgba(226,215,217,.45)';g.lineWidth=.7;g.stroke();this.petal=c}
  // MOON DIFFUSE POOL — the lit surface the long shadows read against
  {const {c,g}=canvas(512,128);const q=g.createRadialGradient(256,64,14,256,64,250);q.addColorStop(0,'rgba(178,206,232,.4)');q.addColorStop(.5,'rgba(150,182,212,.16)');q.addColorStop(1,'rgba(120,155,190,0)');g.fillStyle=q;g.fillRect(0,0,512,128);this.deckPool=c}
  // PRACTICAL WARM POOL — door / lantern bounce (inverse-ish falloff)
  {const {c,g}=canvas(256,256);const q=g.createRadialGradient(128,128,8,128,128,126);q.addColorStop(0,'rgba(255,178,112,.5)');q.addColorStop(.42,'rgba(232,132,74,.2)');q.addColorStop(1,'rgba(180,88,40,0)');g.fillStyle=q;g.fillRect(0,0,256,256);this.warmPool=c}
  // SPECULAR GLITTER LANE — broken horizontal sparkle for the wet mirror
  {const {c,g}=canvas(760,120),r=noise(5511);for(let i=0;i<42;i++){const x=r()*740+10,y=22+r()*76,ln=12+r()*60,a=.06+r()*.26;g.fillStyle=`rgba(198,222,238,${a})`;g.fillRect(x,y,ln,1.2+r()*1.6)}this.glitter=c}
 }
 private buildStatic(){
  const W=Math.min(1920,Math.ceil(this.w*1.25)),H=Math.min(1080,Math.ceil(this.h*1.25)),r=noise(0x2204)
  // ---------------- staticFar: sky + stars + atmospheric mountains --------
  {const {c,g}=canvas(W,H);const sky=g.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#04070f');sky.addColorStop(.46,'#0a1421');sky.addColorStop(.74,'#17242e');sky.addColorStop(1,'#243139');g.fillStyle=sky;g.fillRect(0,0,W,H)
   for(let i=0;i<150;i++){const y=r()*H*.5,a=.1+r()*.5,s=r()<.08?1.8:1;g.fillStyle=`rgba(205,221,222,${a})`;g.fillRect(r()*W,y,s,s)}
   // three mountain planes — atmospheric perspective: FAR LIGHTER (haze),
   // each ridge carries a thin moonlit rim on its sky edge
   const ridge=(base:number,amp:number,col:string,rim:string,step:number)=>{g.fillStyle=col;g.beginPath();g.moveTo(0,H);g.lineTo(0,base);const pts:[number,number][]=[];for(let x=0;x<=W+step;x+=step){const y=base-(.25+r()*.75)*amp;pts.push([x,y]);g.lineTo(x,y)}g.lineTo(W,H);g.fill();g.strokeStyle=rim;g.lineWidth=1.6;g.beginPath();pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke()}
   ridge(H*.60,H*.17,'#1d2b37','rgba(146,182,202,.16)',130)
   ridge(H*.68,H*.13,'#131f29','rgba(126,162,184,.12)',100)
   ridge(H*.76,H*.10,'#0c161e','rgba(110,146,168,.09)',80)
   // distant sleeping city beyond the ridge gaps — sparse DIM windows only
   const city=noise(0x9e11)
   for(let cluster=0;cluster<4;cluster++){const cx0=W*(.12+cluster*.23)+city()*70,cy0=H*(.62+city()*.1),n=14+city()*12
    for(let i=0;i<n;i++){const x=cx0+city()*130,y=cy0-city()*46,w2=2+city()*2.4,h2=1.4+city()*2.2;const warm=city()<.62;g.fillStyle=warm?`rgba(255,206,150,${.08+city()*.2})`:`rgba(168,200,222,${.06+city()*.16})`;g.fillRect(x,y,w2,h2)}}
   this.staticFar=c}
  // ---------------- staticMid: bamboo grove band (parallax) --------------
  {const {c,g}=canvas(W,H),r2=noise(0x77c1);const ground=H*.80
   g.fillStyle='#081116';g.fillRect(0,ground-8,W,H-ground+8)
   for(let i=0;i<26;i++){const x=r2()*W,h2=H*(.34+r2()*.3),w2=5+r2()*9,lean=(r2()-.5)*36
    g.strokeStyle='#0a1418';g.lineWidth=w2;g.beginPath();g.moveTo(x,ground);g.quadraticCurveTo(x+lean*.4,ground-h2*.55,x+lean,ground-h2);g.stroke()
    // node ticks + moonlit edge (moon sits upper-right)
    g.strokeStyle='rgba(122,158,180,.10)';g.lineWidth=1.1
    for(let k=1;k<5;k++){const u=k/5,xx=x+lean*u*u,yy=ground-h2*u;g.beginPath();g.moveTo(xx-w2*.55,yy);g.lineTo(xx+w2*.55,yy);g.stroke()}
    g.strokeStyle='rgba(140,176,196,.13)';g.lineWidth=1.3;g.beginPath();g.moveTo(x+w2*.42,ground);g.quadraticCurveTo(x+lean*.4+w2*.42,ground-h2*.55,x+lean+w2*.3,ground-h2);g.stroke()
    // leaf sprays near the top
    for(let k=0;k<7;k++){const u=.62+r2()*.38,xx=x+lean*u*u,yy=ground-h2*u,an=-.7-r2()*1.7,ln=14+r2()*26
     g.strokeStyle=`rgba(20,34,38,${.5+r2()*.4})`;g.lineWidth=1.8;g.beginPath();g.moveTo(xx,yy);g.lineTo(xx+Math.cos(an)*ln,yy+Math.sin(an)*ln);g.stroke()}}
   this.staticMid=c}
  // ---------------- staticDeck: the engawa boards (world-space) ----------
  {const {c,g}=canvas(ARENA_W,270)
   const grad=g.createLinearGradient(0,0,0,270);grad.addColorStop(0,'#374347');grad.addColorStop(.18,'#242e31');grad.addColorStop(1,'#0a1013');g.fillStyle=grad;g.fillRect(0,0,ARENA_W,270)
   const r3=noise(0x33b8)
   for(let x=0;x<ARENA_W;x+=74){const i=x/74|0
    g.fillStyle=(i&1)?'rgba(128,150,148,.05)':'rgba(4,10,12,.05)';g.fillRect(x,1,73,196)
    g.strokeStyle='rgba(4,9,12,.5)';g.lineWidth=1.4;g.beginPath();g.moveTo(x,0);g.lineTo(x+19,232);g.stroke()
    g.strokeStyle='rgba(168,188,182,.1)';g.lineWidth=.7
    for(let q=0;q<3;q++){const yy=24+q*46+Math.sin(x*.07+q)*8;g.beginPath();g.moveTo(x+8,yy);g.bezierCurveTo(x+25,yy-5,x+43,yy+6,x+66,yy);g.stroke()}}
   for(let y=82;y<250;y+=83){g.strokeStyle='rgba(5,10,13,.42)';g.beginPath();g.moveTo(0,y);g.lineTo(ARENA_W,y);g.stroke()}
   // moonlit wet sheen along the board direction (baked; live pool adds on top)
   g.globalCompositeOperation='screen'
   for(let i=0;i<26;i++){const x=r3()*ARENA_W,y=6+r3()*210,ln=90+r3()*260;g.fillStyle=`rgba(148,182,204,${.03+r3()*.075})`;g.fillRect(x,y,ln,1.1+r3()*2.4)}
   g.globalCompositeOperation='source-over'
   // stone foundation lip at the back edge
   const lip=g.createLinearGradient(0,0,0,26);lip.addColorStop(0,'#1a2327');lip.addColorStop(1,'#0d1417');g.fillStyle=lip;g.fillRect(0,0,ARENA_W,26)
   this.staticDeck=c}
  // ------------- staticGarden: world-space props above the deck ----------
  {const TOP=410;const {c,g}=canvas(ARENA_W,TOP+270);const Y=(wy:number)=>wy+TOP  // world y -> bake y
   const r4=noise(0x51d0)
   const moonRim=(x:number,y:number,w2:number,h2:number,a:number)=>{const q=g.createLinearGradient(x+w2,y,x+w2*.2,y);q.addColorStop(0,`rgba(150,186,208,${a})`);q.addColorStop(1,'rgba(150,186,208,0)');g.fillStyle=q;g.fillRect(x,y,w2,h2)}
   // --- bamboo fence (yotsume-gaki) runs between the props, behind the deck
   const fenceRuns:[number,number][]=[[450,LANTERN_X-120],[LANTERN_X+120,DOOR_X-330],[DOOR_X+330,POND_X-260],[POND_X+260,SAKURA_X-260]]
   for(const [x0,x1] of fenceRuns){if(x1-x0<60)continue
    g.fillStyle='#0b1114'
    for(let x=x0;x<=x1;x+=46){g.fillRect(x-3,Y(-92),6,92);g.fillStyle='rgba(128,158,172,.07)';g.fillRect(x+1,Y(-90),1.4,88);g.fillStyle='#0b1114'}
    g.fillRect(x0-4,Y(-84),x1-x0+8,7);g.fillRect(x0-4,Y(-46),x1-x0+8,7)}
   // --- torii gate (world 310): pillars + curved kasagi + nuki
   {const px0=TORII_X-70,px1=TORII_X+70
    g.fillStyle='#0c1114'
    g.fillRect(px0-13,Y(-228),26,228);g.fillRect(px1-13,Y(-228),26,228)
    g.beginPath();g.moveTo(px0-72,Y(-252));g.quadraticCurveTo(TORII_X,Y(-262),px1+72,Y(-252));g.lineTo(px1+72,Y(-234));g.quadraticCurveTo(TORII_X,Y(-244),px0-72,Y(-234));g.closePath();g.fill()
    g.fillRect(px0-22,Y(-170),(px1-px0)+44,15)
    moonRim(px1-13,Y(-228),13,228,.2);moonRim(TORII_X,Y(-262),72,12,.16)}
   // --- tall stone lantern (world 830): the STREET_LIGHT practical
   {const x=LANTERN_X
    g.fillStyle='#10171a'
    g.fillRect(x-48,Y(-26),96,26);g.fillRect(x-22,Y(-150),44,126)  // base + column
    g.fillRect(x-33,Y(-232),66,82)                                  // light box
    // glowing core window
    const core=g.createRadialGradient(x,Y(-192),4,x,Y(-192),60);core.addColorStop(0,'rgba(255,216,160,.85)');core.addColorStop(.55,'rgba(255,176,104,.32)');core.addColorStop(1,'rgba(255,150,80,0)');g.fillStyle=core;g.fillRect(x-70,Y(-262),140,140)
    g.fillStyle='#0d1215';g.fillRect(x-15,Y(-214),30,44)   // window frame plate
    g.fillStyle='rgba(255,208,150,.9)';g.fillRect(x-11,Y(-210),22,36)
    // curved cap + finial
    g.beginPath();g.moveTo(x-58,Y(-232));g.quadraticCurveTo(x,Y(-262),x+58,Y(-232));g.lineTo(x+40,Y(-222));g.lineTo(x-40,Y(-222));g.closePath();g.fill()
    g.fillRect(x-6,Y(-282),12,22);g.beginPath();g.arc(x,Y(-284),7,0,TAU);g.fill()
    moonRim(x+22,Y(-232),12,82,.18)}
   // --- tea house (world 1590..1920), shoji door at DOOR_X
   {const x0=1590,x1=1920,base=Y(-26),top=Y(-176)
    g.fillStyle='#12181c';g.fillRect(x0,top,x1-x0,base-top)          // timber body
    g.fillStyle='#0e1418';g.fillRect(x0-10,base-26,(x1-x0)+20,26)   // stone foundation
    for(const px2 of [x0+12,x0+132,x0+248,x1-14]){g.fillStyle='#0c1114';g.fillRect(px2,top,12,base-top)}
    // shoji door — the bright warm practical at DOOR_X
    const dW=68,dX=DOOR_X-dW/2
    const door=g.createLinearGradient(dX,top+12,dX,base);door.addColorStop(0,'#ffd9a5');door.addColorStop(.55,'#eeb077');door.addColorStop(1,'#c98048');g.fillStyle=door;g.fillRect(dX,top+12,dW,base-top-12)
    g.strokeStyle='rgba(60,32,16,.55)';g.lineWidth=2
    for(let i=1;i<4;i++){g.beginPath();g.moveTo(dX+i*dW/4,top+12);g.lineTo(dX+i*dW/4,base);g.stroke()}
    for(let i=1;i<5;i++){g.beginPath();g.moveTo(dX,top+12+i*(base-top-12)/5);g.lineTo(dX+dW,top+12+i*(base-top-12)/5);g.stroke()}
    const glow=g.createRadialGradient(DOOR_X,top+40,6,DOOR_X,top+40,180);glow.addColorStop(0,'rgba(255,186,124,.34)');glow.addColorStop(1,'rgba(255,150,88,0)');g.fillStyle=glow;g.fillRect(DOOR_X-190,top-90,380,320)
    // side shoji windows (dim)
    for(const wx of [x0+52,x0+196]){g.fillStyle='rgba(122,82,44,.32)';g.fillRect(wx,top+34,52,72);g.strokeStyle='rgba(40,22,12,.5)';g.lineWidth=1.6;g.strokeRect(wx,top+34,52,72)}
    // layered tile roof with upturned eaves
    g.fillStyle='#090d10'
    g.beginPath();g.moveTo(x0-64,top+8);g.quadraticCurveTo(x0-40,top-40,(x0+x1)/2,top-72);g.quadraticCurveTo(x1+40,top-40,x1+64,top+8);g.quadraticCurveTo((x0+x1)/2,top-26,x0-64,top+8);g.closePath();g.fill()
    g.beginPath();g.moveTo(x0-24,top-52);g.quadraticCurveTo((x0+x1)/2,top-118,x1+24,top-52);g.quadraticCurveTo((x0+x1)/2,top-84,x0-24,top-52);g.closePath();g.fill()
    g.strokeStyle='rgba(132,158,158,.16)';g.lineWidth=2
    for(let i=0;i<12;i++){const u=i/11,xx=(x0-56)+u*((x1+56)-(x0-56));g.beginPath();g.moveTo(xx,top+2);g.quadraticCurveTo(xx+6,top-22-u*8,xx+12,top-36+Math.abs(u-.5)*30);g.stroke()}
    moonRim(x1-6,top-72,10,80,.16)
    // porch chōchin lantern (warm red-ochre)
    const lx=x0+46
    g.strokeStyle='#0a0e11';g.lineWidth=3;g.beginPath();g.moveTo(lx,top-2);g.lineTo(lx,top+18);g.stroke()
    const cho=g.createRadialGradient(lx,top+42,3,lx,top+42,34);cho.addColorStop(0,'rgba(255,150,90,.9)');cho.addColorStop(.6,'rgba(178,58,36,.8)');cho.addColorStop(1,'rgba(120,32,20,0)');g.fillStyle=cho;g.beginPath();g.ellipse(lx,top+42,17,25,0,0,TAU);g.fill()}
   // --- pond stone edging (world 2050)
   {g.strokeStyle='#131b1f';g.lineWidth=13;g.beginPath();g.ellipse(POND_X,POND_Y+38,192,58,-.04,0,TAU);g.stroke()
    g.strokeStyle='rgba(140,170,182,.12)';g.lineWidth=2;g.beginPath();g.ellipse(POND_X,POND_Y+31,188,54,-.04,Math.PI*1.05,Math.PI*1.95);g.stroke()}
   // --- sakura (world 2520): tapered S-curve limbs + moonlit blossoms
   {const bx=SAKURA_X
    g.fillStyle='#0a0d10'
    g.beginPath();g.moveTo(bx-26,Y(4));g.quadraticCurveTo(bx-10,Y(-110),bx-22,Y(-212));g.lineTo(bx+10,Y(-214));g.quadraticCurveTo(bx+22,Y(-108),bx+30,Y(4));g.closePath();g.fill()
    const limb=(x:number,y:number,x2:number,y2:number,w2:number,depth:number)=>{
     const cx1=x+(x2-x)*.28-w2*.3,cy1=y+(y2-y)*.2,cx2=x+(x2-x)*.74+w2*.22,cy2=y+(y2-y)*.72
     g.strokeStyle='#090c0f';g.lineWidth=w2;g.beginPath();g.moveTo(x,y);g.bezierCurveTo(cx1,cy1,cx2,cy2,x2,y2);g.stroke()
     g.strokeStyle='rgba(126,152,152,.13)';g.lineWidth=Math.max(1,w2*.12);g.beginPath();g.moveTo(x+w2*.24,y);g.bezierCurveTo(cx1+w2*.24,cy1,cx2+w2*.24,cy2,x2+w2*.16,y2);g.stroke()
     if(depth>0){limb(x2,y2,x2-(52+depth*26),y2-(56+depth*24),w2*.58,depth-1);limb(x2,y2,x2+(58+depth*30),y2-(40+depth*26),w2*.54,depth-1)}}
    limb(bx-8,Y(-206),bx-30,Y(-300),22,2)
    limb(bx+4,Y(-196),bx+88,Y(-282),20,2)
    limb(bx-2,Y(-176),bx-118,Y(-240),17,1)
    // blossoms: small clustered petals; moon-side (upper-right) carries a
    // cool highlight so the canopy reads as lit form, not flat pink paint
    const b=noise(0x8341)
    for(let i=0;i<520;i++){const side=b()<.52?-1:1,cx=bx+side*(40+b()*240),cy=Y(-262)-b()*150+(Math.abs(cx-bx)*.14),rad=1.2+b()*3.4
     g.fillStyle=`rgba(${183+(b()*43|0)},${143+(b()*38|0)},${163+(b()*37|0)},${.3+b()*.45})`
     g.beginPath();for(let q=0;q<5;q++){const an=q*TAU/5,px2=cx+Math.cos(an)*rad,py2=cy+Math.sin(an)*rad*.7;g.moveTo(px2+rad*.65,py2);g.arc(px2,py2,rad*.65,0,TAU)}g.fill()
     if(b()<.3){g.fillStyle=`rgba(205,222,238,${.16+b()*.2})`;g.beginPath();g.arc(cx+rad*.8,cy-rad*.7,rad*.55,0,TAU);g.fill()}}}
   this.staticGarden=c}
  // wet-deck roughness plate (matte islands + seams chop the mirror)
  {const {c,g}=canvas(ARENA_W,150),r5=noise(0x4ab2)
   for(let i=0;i<130;i++){const x=r5()*ARENA_W,y=r5()*150,rx=20+r5()*90,ry=5+r5()*16
    g.fillStyle=`rgba(${r5()<.5?'10,16,20':'150,175,182'},${.03+r5()*.07})`;g.beginPath();g.ellipse(x,y,rx,ry,r5()*.6,0,TAU);g.fill()}
   for(let x=0;x<ARENA_W;x+=74){g.strokeStyle='rgba(8,13,16,.16)';g.lineWidth=1.2;g.beginPath();g.moveTo(x,0);g.lineTo(x+16,150);g.stroke()}
   this.wetPlate=c}
 }

 drawShaftMask(ctx:CanvasRenderingContext2D,cam:BgCam){
  this.ensure()
  const cx=Number.isFinite(cam.x)?cam.x:0
  const cy=Number.isFinite(cam.y)?cam.y:NOMINAL_Y
  const cz=Number.isFinite(cam.zoom)?cam.zoom:1
  // twin of drawSky's celestial anchor — the mask obeys the same parallax
  const mx=this.w*.72-cx*.018*cz,my=this.h*.18-(cy+170)*.035*cz
  // bright moon mass + wide halo = the god-ray source
  ctx.drawImage(this.moon!,mx-180,my-180,360,360)
  const halo=ctx.createRadialGradient(mx,my,20,mx,my,320)
  halo.addColorStop(0,'rgba(255,255,255,.85)');halo.addColorStop(.4,'rgba(255,255,255,.32)');halo.addColorStop(1,'rgba(255,255,255,0)')
  ctx.fillStyle=halo;ctx.fillRect(mx-330,my-330,660,660)
  // cloud banks occlude (dark) so shafts breathe as they drift across
  ctx.globalAlpha=.9
  for(let k=0;k<this.cloudX.length;k++){const z=this.cloudZ[k],cw=520+z*330,ch=143+z*82,x=this.cloudX[k]-cx*(.008+.025*z)*cz,y=my-105+(z-.5)*88
   ctx.save();ctx.globalCompositeOperation='multiply';ctx.drawImage(this.cloud!,x,y,cw,ch);ctx.restore()}
  ctx.globalAlpha=1
  // ridge + garden canopy occlude the lower sky
  ctx.fillStyle='rgba(0,0,0,.85)'
  ctx.fillRect(0,this.h*.62,this.w,this.h*.38)
 }

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
  // world-space bakes: engawa boards + garden props (aligned to the
  // gameplay plane and the shared emitters)
  ctx.drawImage(this.staticDeck!,ARENA_X0,0)
  ctx.drawImage(this.staticGarden!,ARENA_X0,-410)
  // moon-silver ripples over the pond
  ctx.save();ctx.translate(POND_X,POND_Y);ctx.fillStyle='rgba(6,16,22,.6)';ctx.beginPath();ctx.ellipse(0,38,185,54,-.04,0,TAU);ctx.fill()
  ctx.strokeStyle='rgba(168,196,204,.26)';ctx.lineWidth=1.2
  for(let i=0;i<7;i++){const rw=38+i*19+Math.sin(t*.8+i)*7;ctx.beginPath();ctx.ellipse(Math.sin(i*2.4)*42,35+i%2*8,rw,5+i*.45,0,0,TAU);ctx.stroke()}
  ctx.restore()
  // low world-space mist
  ctx.globalAlpha=.12;const off=((t*9)%1024+1024)%1024;for(let x=ARENA_X0-1024+off;x<ARENA_X1;x+=1024)ctx.drawImage(this.fog!,x,-85,1024,170);ctx.globalAlpha=1}

 drawWetMask(ctx:CanvasRenderingContext2D){this.ensure();ctx.drawImage(this.wetPlate!,ARENA_X0,10,ARENA_W,150)}

 drawLightRig(ctx:CanvasRenderingContext2D,moonWorldX:number,_moonWorldY:number){this.ensure();const t=this.t,cov=this.moonCover,li=this.lightningI()
  const key=keyLightFromStorm(li,this.lightningAz())
  // MOON DIFFUSE POOL — the lit surface the long shadows read against.
  // LIVE brightness (eclipse kills it) + azimuth lean (lightning swings it).
  const poolA=(0.34+0.62*clamp01(key.i))*(1-0.92*cov)
  if(poolA>0.012){
   ctx.globalAlpha=poolA*.92
   ctx.drawImage(this.deckPool!,ARENA_X0,-16,ARENA_W,180)
   const lightOnRight=key.dirX<0
   const bx=lightOnRight?ARENA_X1:ARENA_X0,ex=lightOnRight?ARENA_X0:ARENA_X1
   const lean=ctx.createLinearGradient(bx,0,ex,0)
   lean.addColorStop(0,'rgba(178,206,236,0.1)');lean.addColorStop(.55,'rgba(178,206,236,0.03)');lean.addColorStop(1,'rgba(178,206,236,0)')
   ctx.globalCompositeOperation='lighter';ctx.globalAlpha=clamp01(key.i)*(1-0.92*cov)
   ctx.fillStyle=lean;ctx.fillRect(ARENA_X0,-16,ARENA_W,180)
   ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1
  }
  // SPECULAR GLITTER LANE — the wet mirror catches the moon in a broken lane
  ctx.globalCompositeOperation='lighter'
  const glintA=clamp01(key.i)*(1-cov)*0.5
  if(glintA>0.01){
   ctx.globalAlpha=glintA*(0.72+0.28*Math.sin(t*1.7))
   const lx=Math.max(ARENA_X0,Math.min(ARENA_X1-760,moonWorldX-380))
   ctx.drawImage(this.glitter!,lx,-4,760,124)
  }
  // DOOR PRACTICAL — warm bounce; practicals fire through cloud cover
  ctx.globalAlpha=0.24*(1-0.4*cov)*(0.92+0.08*Math.sin(t*11.3))
  ctx.drawImage(this.warmPool!,DOOR_X-330,-140,660,320)
  // STONE LANTERN practical
  ctx.globalAlpha=0.2*(1-0.4*cov)*(0.9+0.1*Math.sin(t*9.1+1.7))
  ctx.drawImage(this.warmPool!,LANTERN_X-270,-360,540,420)
  // pond glint
  if(glintA>0.01){ctx.globalAlpha=glintA*0.85;ctx.drawImage(this.glitter!,POND_X-190,POND_Y+2,380,70)}
  // defocused warm bokeh droplets near the door practical
  ctx.globalAlpha=0.06*(1-0.5*cov)*(0.8+0.2*Math.sin(t*0.9))
  const bq=ctx.createRadialGradient(DOOR_X-190,-190,2,DOOR_X-190,-190,23);bq.addColorStop(0,'rgba(255,196,140,.9)');bq.addColorStop(.72,'rgba(255,170,110,.28)');bq.addColorStop(1,'rgba(255,160,100,0)')
  ctx.fillStyle=bq;ctx.fillRect(DOOR_X-216,-216,52,52)
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'
 }

 drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam){this.ensure();this.storm.setView(cam);this.storm.drawRain(ctx);const w=this.w,h=this.h,t=this.t
  // pooled depth petals; one atlas sprite, no allocations
  for(let i=0;i<70;i++){const z=this.pz[i],x=((this.px[i]+t*(12+25*z)+Math.sin(t*.7+this.pp[i])*22)%(w+120))-60,y=(this.py[i]+t*(9+18*z))%(h+80)-40;if(y>h*.82)continue;ctx.save();ctx.globalAlpha=.18+.5*z;ctx.translate(x,y);ctx.rotate(t*(.35+z)+this.pp[i]);const s=3+7*z;ctx.drawImage(this.petal!,-s,-s*.55,s*2,s*1.1);ctx.restore()}
  // restrained cool atmospheric grade
  const v=ctx.createRadialGradient(w*.5,h*.5,Math.min(w,h)*.25,w*.5,h*.5,Math.max(w,h)*.72);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,4,11,.32)');ctx.fillStyle=v;ctx.fillRect(0,0,w,h)}
}
