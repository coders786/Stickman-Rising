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
 private cloudLit:HTMLCanvasElement|null=null
 private shaft:HTMLCanvasElement|null=null
 private petal:HTMLCanvasElement|null=null
  private quality:'low'|'medium'|'high'|'ultra'='high'
  setQuality(q:'low'|'medium'|'high'|'ultra'){this.quality=q}
 private petalGlow:HTMLCanvasElement|null=null
 private vignette:HTMLCanvasElement|null=null
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
 constructor(storm=new StormEngine('medium')){this.storm=storm;this.storm.setRainScale(.48);const r=noise(0x51a9c3);for(let i=0;i<70;i++){this.px[i]=r()*2200;this.py[i]=r()*720;this.pz[i]=r();this.pp[i]=r()*TAU}}
 resize(w:number,h:number){
  const nw=Math.max(1,w),nh=Math.max(1,h)
  // DPR governor steps pass the SAME css size: never invalidate the bakes
  // for a no-op resize (a re-bake stalls 100-500ms and resets the browser's
  // frame pacing to half-rate = the 30fps lock).
  if(nw===this.w&&nh===this.h&&this.built)return
  this.w=nw;this.h=nh;this.storm.resize(nw,nh);this.built=false}
 update(dt:number){const d=Math.min(.1,Math.max(0,dt));this.t+=d;for(let i=0;i<this.cloudX.length;i++){this.cloudX[i]+=d*(1.1+this.cloudZ[i]*1.7);if(this.cloudX[i]>this.w+620)this.cloudX[i]=-720}}
 lightningI(){return this.storm.intensity}
 lightningAz(){return this.storm.azimuthValue}

 private ensure(){if(this.built)return;this.built=true;this.buildSprites();this.buildStatic()}
 private buildSprites(){
  // MOON — distant celestial body: pale disc + mare mottling + soft halo
  {const {c,g}=canvas(360,360)
   // wide soft AUREOLE (Mie forward-scatter halo) — the moon's atmosphere glow
   let q=g.createRadialGradient(180,180,26,180,180,180);q.addColorStop(0,'rgba(214,236,244,.17)');q.addColorStop(.26,'rgba(158,196,214,.09)');q.addColorStop(.58,'rgba(120,162,184,.035)');q.addColorStop(1,'rgba(90,130,152,0)');g.fillStyle=q;g.fillRect(0,0,360,360)
   // tight bright ring hugging the limb
   q=g.createRadialGradient(180,180,58,180,180,84);q.addColorStop(0,'rgba(244,250,250,0)');q.addColorStop(.5,'rgba(244,250,250,.20)');q.addColorStop(1,'rgba(244,250,250,0)');g.fillStyle=q;g.fillRect(0,0,360,360)
   // faint CORONA RING at ~1.35R — diffraction ring around the disc
   q=g.createRadialGradient(180,180,84,180,180,106);q.addColorStop(0,'rgba(210,232,242,0)');q.addColorStop(.5,'rgba(210,232,242,.055)');q.addColorStop(1,'rgba(210,232,242,0)');g.fillStyle=q;g.fillRect(0,0,360,360)
   // the DISC — bright near-white (the scene's brightest object), soft limb
   q=g.createRadialGradient(166,162,8,180,180,68);q.addColorStop(0,'#f6faf8');q.addColorStop(.62,'#e8efec');q.addColorStop(.9,'#d4e0dd');q.addColorStop(1,'#b9c9c8');g.fillStyle=q;g.beginPath();g.arc(180,180,68,0,TAU);g.fill()
   // mare mottling — TONE, not dirt (very low contrast, cool)
   const r=noise(77);for(let i=0;i<16;i++){g.fillStyle=`rgba(122,152,166,${.02+r()*.038})`;g.beginPath();g.ellipse(150+r()*62,148+r()*66,4+r()*14,3+r()*9,r()*TAU,0,TAU);g.fill()}
   this.moon=c}
  {const {c,g}=canvas(1024,260),r=noise(912)
   // mist body: dense near the base (exp height-fog look), wisps lifting above
   for(let i=0;i<22;i++){const x=r()*1024,y=150+r()*95,rx=90+r()*170,ry=16+r()*34,q=g.createRadialGradient(x,y,0,x,y,rx);q.addColorStop(0,`rgba(158,186,196,${.09+r()*.11})`);q.addColorStop(1,'rgba(122,152,162,0)');g.save();g.scale(1,ry/rx);g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}
   for(let i=0;i<12;i++){const x=r()*1024,y=60+r()*90,rx=60+r()*120,ry=12+r()*22,q=g.createRadialGradient(x,y,0,x,y,rx);q.addColorStop(0,`rgba(140,170,182,${.05+r()*.06})`);q.addColorStop(1,'rgba(110,142,152,0)');g.save();g.scale(1,ry/rx);g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}
   // base line of haze so the bank's floor is solid, top is airy
   const base=g.createLinearGradient(0,110,0,258);base.addColorStop(0,'rgba(150,180,190,0)');base.addColorStop(.45,'rgba(150,180,190,.11)');base.addColorStop(.82,'rgba(150,180,190,.045)');base.addColorStop(1,'rgba(150,180,190,0)');g.fillStyle=base;g.fillRect(0,110,1024,150)
   this.fog=c}
  {const {c,g}=canvas(800,220),r=noise(318)
   // cumulus billows — each lobe is SHADED: dark body, moonlit top-right rim
   // (silver lining), darker underside. Reads as a rendered volume, not a blob.
   for(let i=0;i<15;i++){const x=45+r()*710,y=64+r()*82,rx=68+r()*125,ry=24+r()*38
    const q=g.createRadialGradient(x-rx*.3,y-ry*.62,2,x,y,rx);q.addColorStop(0,`rgba(96,118,134,${.26+r()*.1})`);q.addColorStop(.42,`rgba(30,44,60,${.36+r()*.16})`);q.addColorStop(1,'rgba(5,10,18,0)');g.save();g.scale(1,ry/rx);g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()
    // silver lining: thin bright arc on the moon-facing (upper-right) edge
    g.save();g.scale(1,ry/rx);const rim=g.createRadialGradient(x+rx*.34,y-ry*.9,rx*.42,x,y,rx);rim.addColorStop(0,'rgba(178,208,224,0)');rim.addColorStop(.72,`rgba(178,208,224,${.10+r()*.09})`);rim.addColorStop(1,'rgba(178,208,224,0)');g.fillStyle=rim;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}
   const under=g.createLinearGradient(0,105,0,210);under.addColorStop(0,'rgba(2,6,13,0)');under.addColorStop(.52,'rgba(2,5,12,.30)');under.addColorStop(1,'rgba(2,5,12,0)');g.fillStyle=under;g.fillRect(0,90,800,120)
   this.cloud=c}
  // LIT CLOUD variant — additive re-blit when moonlight spills through gaps
  {const {c,g}=canvas(800,220),r=noise(319)
   for(let i=0;i<15;i++){const x=45+r()*710,y=64+r()*82,rx=68+r()*125,ry=24+r()*38
    g.save();g.scale(1,ry/rx);const q=g.createRadialGradient(x+rx*.22,y-ry*.8,2,x,y,rx);q.addColorStop(0,`rgba(196,224,240,${.16+r()*.12})`);q.addColorStop(.6,'rgba(150,186,210,.05)');q.addColorStop(1,'rgba(130,168,196,0)');g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}
   this.cloudLit=c}
  {const {c,g}=canvas(720,720)
   // 9 soft wedges radiating from the top-center (the moon) toward the lower
   // left — painted ONCE and never animated (research: stable god rays; only
   // their alpha breathes with cloud cover). Wide-faint + narrow-bright pairs.
   const ox=360,oy=18
   const wedges=[[-42,7,.10],[-33,5,.13],[-25,9,.09],[-18,4,.14],[-9,7,.10],[-1,3,.12],[7,8,.08],[15,5,.10],[24,6,.07]]
   for(const [deg,wid,amp] of wedges){
    const a=(deg-90)*Math.PI/180  // -90 = straight down; negative = to the left
    for(const [w2,f] of [[wid*3.2,.35],[wid,1]] as const){
     const g2=g.createLinearGradient(ox,oy,ox+Math.cos(a)*660,oy+Math.sin(a)*660)
     g2.addColorStop(0,`rgba(196,224,236,${amp*f})`);g2.addColorStop(.55,`rgba(172,204,220,${amp*f*.45})`);g2.addColorStop(1,'rgba(150,184,202,0)')
     g.fillStyle=g2;g.beginPath();g.moveTo(ox,oy)
     const hw=w2*Math.PI/360
     g.arc(ox,oy,660,a-hw,a+hw);g.closePath();g.fill()
    }}
   this.shaft=c}
  {const {c,g}=canvas(20,16);g.fillStyle='#d9a8b8';g.beginPath();g.moveTo(2,8);g.quadraticCurveTo(8,0,18,5);g.quadraticCurveTo(10,15,2,8);g.fill();g.strokeStyle='rgba(240,214,222,.55)';g.lineWidth=.7;g.stroke();this.petal=c}
  {const {c,g}=canvas(64,64);const q=g.createRadialGradient(32,32,2,32,32,30);q.addColorStop(0,'rgba(255,200,216,.5)');q.addColorStop(.35,'rgba(240,170,196,.22)');q.addColorStop(1,'rgba(220,140,170,0)');g.fillStyle=q;g.fillRect(0,0,64,64);this.petalGlow=c}
  // MOON DIFFUSE POOL — the lit surface the long shadows read against
  {const {c,g}=canvas(512,128);const q=g.createRadialGradient(256,64,14,256,64,250);q.addColorStop(0,'rgba(196,222,244,.34)');q.addColorStop(.45,'rgba(162,194,224,.16)');q.addColorStop(1,'rgba(124,162,198,0)');g.fillStyle=q;g.fillRect(0,0,512,128);this.deckPool=c}
  // PRACTICAL WARM POOL — door / lantern bounce (inverse-ish falloff)
  {const {c,g}=canvas(256,256);const q=g.createRadialGradient(128,128,8,128,128,126);q.addColorStop(0,'rgba(255,178,112,.5)');q.addColorStop(.42,'rgba(232,132,74,.2)');q.addColorStop(1,'rgba(180,88,40,0)');g.fillStyle=q;g.fillRect(0,0,256,256);this.warmPool=c}
  // SPECULAR GLITTER LANE — broken horizontal sparkle for the wet mirror
  {const {c,g}=canvas(760,120),r=noise(5511);for(let i=0;i<42;i++){const x=r()*740+10,y=22+r()*76,ln=12+r()*60,a=.06+r()*.26;g.fillStyle=`rgba(198,222,238,${a})`;g.fillRect(x,y,ln,1.2+r()*1.6)}this.glitter=c}
 }
 private buildStatic(){
  const W=Math.min(1920,Math.ceil(this.w*1.25)),H=Math.min(1080,Math.ceil(this.h*1.25)),r=noise(0x2204)
  /** pre-downsample a 1.25x supersampled bake to exact screen size once —
   *  per-frame blits become 1:1 copies instead of bilinear resamples */
  const finalize=(src:HTMLCanvasElement)=>{const{c,g}=canvas(this.w,this.h);g.drawImage(src,0,0,this.w,this.h);return c}
  // ---------------- staticFar: sky + stars + atmospheric mountains --------
  {const {c,g}=canvas(W,H)
   // SKY — deep blue zenith into a bright teal horizon haze (the "sky eating
   // the world" band the ridges dissolve into). Purkinje blue-green cast.
   const sky=g.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#071022');sky.addColorStop(.34,'#0c1a2e');sky.addColorStop(.58,'#16303f');sky.addColorStop(.78,'#244451');sky.addColorStop(1,'#2c4a56');g.fillStyle=sky;g.fillRect(0,0,W,H)
   // MILKY WAY — a soft diagonal star-cloud band with faint mauve nebula
   // (upper-left, as in the target). STATIC: celestial structure never moves.
   const mw=g.createLinearGradient(W*.06,H*.02,W*.52,H*.42);mw.addColorStop(0,'rgba(120,132,178,0)');mw.addColorStop(.3,'rgba(126,138,186,.10)');mw.addColorStop(.52,'rgba(152,132,178,.09)');mw.addColorStop(.75,'rgba(120,132,178,.06)');mw.addColorStop(1,'rgba(110,124,170,0)');g.fillStyle=mw
   g.save();g.translate(W*.28,H*.2);g.rotate(-.42);g.fillRect(-W*.42,-H*.09,W*.84,H*.18);g.restore()
   const neb=noise(0x4d21);for(let i=0;i<26;i++){const x=neb()*W*.5,y=neb()*H*.34,rr=18+neb()*66;q2(x,y,rr)}
   function q2(x:number,y:number,rr:number){const q=g.createRadialGradient(x,y,0,x,y,rr);const tint=neb()<.55?'148,130,182':'120,148,190';q.addColorStop(0,`rgba(${tint},${.028+neb()*.05})`);q.addColorStop(1,`rgba(${tint},0)`);g.fillStyle=q;g.fillRect(x-rr,y-rr,rr*2,rr*2)}
   // STARS — dense small field + a few glow-stars (still; twinkle subset is live)
   for(let i=0;i<230;i++){const y=r()*H*.62,a=.12+r()*.62,s=r()<.06?2:1;const warm=r()<.22;g.fillStyle=warm?`rgba(226,214,196,${a})`:`rgba(205,224,232,${a})`;g.fillRect(r()*W,y,s,s)}
   for(let i=0;i<6;i++){const x=r()*W,y=r()*H*.5,rr=1.6+r()*1.8;const q=g.createRadialGradient(x,y,0,x,y,rr*3.4);q.addColorStop(0,'rgba(232,242,248,.8)');q.addColorStop(.3,'rgba(200,222,238,.28)');q.addColorStop(1,'rgba(180,206,226,0)');g.fillStyle=q;g.fillRect(x-rr*3.4,y-rr*3.4,rr*6.8,rr*6.8)}
   // HORIZON HAZE — the bright mist band (fog system component 1)
   const hz=g.createLinearGradient(0,H*.60,0,H*.80);hz.addColorStop(0,'rgba(84,124,140,0)');hz.addColorStop(.55,'rgba(96,138,152,.14)');hz.addColorStop(1,'rgba(110,152,164,.05)');g.fillStyle=hz;g.fillRect(0,H*.60,W,H*.22)
   // RIDGES — strong aerial perspective: far planes nearly dissolve into the
   // haze (65%-saturation rule), soft edges, mist pooling at the valley floor.
   const ridge=(base:number,amp:number,col:string,rim:string,step:number)=>{g.fillStyle=col;g.beginPath();g.moveTo(0,H);g.lineTo(0,base);const pts:[number,number][]=[];for(let x=0;x<=W+step;x+=step){const y=base-(.25+r()*.75)*amp;pts.push([x,y]);g.lineTo(x,y)}g.lineTo(W,H);g.fill();g.strokeStyle=rim;g.lineWidth=1.2;g.beginPath();pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke()}
   ridge(H*.635,H*.15,'#20323d','rgba(150,186,202,.10)',130)
   ridge(H*.705,H*.115,'#182b36','rgba(136,172,190,.09)',100)
   ridge(H*.775,H*.085,'#12222c','rgba(122,158,178,.08)',80)
   // valley mist: soft haze in front of the ridge bases (component 2, baked)
   for(let i=0;i<18;i++){const x=r()*W,y=H*(.74+r()*.12),rx=120+r()*220,ry=12+r()*20,q=g.createRadialGradient(x,y,0,x,y,rx);q.addColorStop(0,`rgba(132,168,182,${.05+r()*.07})`);q.addColorStop(1,'rgba(110,148,162,0)');g.save();g.scale(1,ry/rx);g.fillStyle=q;g.beginPath();g.arc(x,y*rx/ry,rx,0,TAU);g.fill();g.restore()}
   // distant sleeping city beyond the ridge gaps — sparse DIM windows only
   const city=noise(0x9e11)
   for(let cluster=0;cluster<4;cluster++){const cx0=W*(.12+cluster*.23)+city()*70,cy0=H*(.62+city()*.1),n=14+city()*12
    for(let i=0;i<n;i++){const x=cx0+city()*130,y=cy0-city()*46,w2=2+city()*2.4,h2=1.4+city()*2.2;const warm=city()<.62;g.fillStyle=warm?`rgba(255,206,150,${.08+city()*.2})`:`rgba(168,200,222,${.06+city()*.16})`;g.fillRect(x,y,w2,h2)}}
   this.staticFar=finalize(c)}
  // ---------------- staticMid: bamboo grove band (parallax) --------------
  {const {c,g}=canvas(W,H),r2=noise(0x77c1);const ground=H*.80
   g.fillStyle='#070f14';g.fillRect(0,ground-8,W,H-ground+8)
   const gx=[W*.08,W*.30,W*.62,W*.88];for(let i=0;i<16;i++){const x=gx[i%4]+(r2()-.5)*W*.13,h2=H*(.26+r2()*.26),w2=9+r2()*12,lean=(r2()-.5)*24
    g.strokeStyle='rgba(7,14,19,.94)';g.lineWidth=w2;g.beginPath();g.moveTo(x,ground);g.quadraticCurveTo(x+lean*.4,ground-h2*.55,x+lean,ground-h2);g.stroke()
    // node ticks + moonlit edge (moon sits upper-right)
    g.strokeStyle='rgba(122,158,180,.10)';g.lineWidth=1.1
    for(let k=1;k<5;k++){const u=k/5,xx=x+lean*u*u,yy=ground-h2*u;g.beginPath();g.moveTo(xx-w2*.55,yy);g.lineTo(xx+w2*.55,yy);g.stroke()}
    g.strokeStyle='rgba(140,176,196,.13)';g.lineWidth=1.3;g.beginPath();g.moveTo(x+w2*.42,ground);g.quadraticCurveTo(x+lean*.4+w2*.42,ground-h2*.55,x+lean+w2*.3,ground-h2);g.stroke()
    // leaf sprays near the top
    for(let k=0;k<7;k++){const u=.62+r2()*.38,xx=x+lean*u*u,yy=ground-h2*u,an=-.7-r2()*1.7,ln=14+r2()*26
     g.strokeStyle=`rgba(20,34,38,${.5+r2()*.4})`;g.lineWidth=1.8;g.beginPath();g.moveTo(xx,yy);g.lineTo(xx+Math.cos(an)*ln,yy+Math.sin(an)*ln);g.stroke()}}
   this.staticMid=c /* native: subpixel scroll needs the direct per-frame resample (pixel parity) */}
  // ---------------- staticDeck: the engawa boards (world-space) ----------
  {const {c,g}=canvas(ARENA_W,270)
   // A receding FLOOR: brighter moonlit base + steep diagonal board seams
   // (the target's deck is a floor plane seen from a low angle — planks run
   // toward the vanishing line, not a wall grid).
   const grad=g.createLinearGradient(0,0,0,270);grad.addColorStop(0,'#4c5c66');grad.addColorStop(.16,'#3a4852');grad.addColorStop(.55,'#232e36');grad.addColorStop(1,'#10161b');g.fillStyle=grad;g.fillRect(0,0,ARENA_W,270)
   const r3=noise(0x33b8)
   // ONE-POINT PERSPECTIVE FLOOR: board seams fan from a vanishing point
   // above the deck; cross-lines compress toward the horizon.
   const vpx=ARENA_W*.60,vpy=-430
   const vpt=-vpy/(236-vpy) // seam param from VP through the bottom edge to y=0
   for(let x=-260;x<ARENA_W+300;x+=74){
    g.strokeStyle='rgba(6,11,15,.5)';g.lineWidth=1.5;g.beginPath();g.moveTo(vpx+(x-vpx)*vpt,0);g.lineTo(x,236);g.stroke()
    g.strokeStyle='rgba(158,182,188,.06)';g.lineWidth=1;g.beginPath();g.moveTo(vpx+(x+2-vpx)*vpt,0);g.lineTo(x+2,236);g.stroke()}
   g.strokeStyle='rgba(6,11,15,.32)';g.lineWidth=1.1
   for(const yy of [236,178,133,99,73,53,38,27,19]){g.beginPath();g.moveTo(0,yy);g.lineTo(ARENA_W,yy);g.stroke()}
   // long board-direction grain streaks
   g.strokeStyle='rgba(170,192,196,.05)';g.lineWidth=.8
   for(let i=0;i<22;i++){const x=r3()*ARENA_W,y=r3()*240,ln=120+r3()*260;g.beginPath();g.moveTo(x,y);g.lineTo(x+ln*.24,y+ln);g.stroke()}
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
   // MATTE ISLANDS ONLY (dark, faint) — the old bright blobs read as dirt on
   // camera. The mirror stays mostly clean; roughness just breaks it slightly.
   for(let i=0;i<90;i++){const x=r5()*ARENA_W,y=r5()*150,rx=26+r5()*90,ry=6+r5()*14
    g.fillStyle=`rgba(12,18,22,${.015+r5()*.028})`;g.beginPath();g.ellipse(x,y,rx,ry,r5()*.6,0,TAU);g.fill()}
   for(let x=0;x<ARENA_W;x+=78){g.strokeStyle='rgba(8,13,16,.05)';g.lineWidth=1;g.beginPath();g.moveTo(x+10,0);g.lineTo(x+26,150);g.stroke()}
   this.wetPlate=c}
  // screen-space atmospheric grade — baked once per resize (was a full-screen
  // radial-gradient fillRect every frame)
  {const {c,g}=canvas(this.w,this.h)
   const v=g.createRadialGradient(this.w*.5,this.h*.5,Math.min(this.w,this.h)*.25,this.w*.5,this.h*.5,Math.max(this.w,this.h)*.72)
   v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,4,11,.32)')
   g.fillStyle=v;g.fillRect(0,0,this.w,this.h);this.vignette=c}
 }

 drawShaftMask(ctx:CanvasRenderingContext2D,cam:BgCam){
  this.ensure()
  const cx=Number.isFinite(cam.x)?cam.x:0
  const cy=Number.isFinite(cam.y)?cam.y:NOMINAL_Y
  const cz=Number.isFinite(cam.zoom)?cam.zoom:1
  // twin of drawSky's celestial anchor — the mask obeys the same parallax
  const mx=this.w*.72-cx*.018*cz,my=this.h*.15-(cy+170)*.035*cz
  // bright moon mass + wide halo = the god-ray source
  ctx.drawImage(this.moon!,mx-180,my-180,360,360)
  const halo=ctx.createRadialGradient(mx,my,20,mx,my,320)
  halo.addColorStop(0,'rgba(255,255,255,.85)');halo.addColorStop(.4,'rgba(255,255,255,.32)');halo.addColorStop(1,'rgba(255,255,255,0)')
  ctx.fillStyle=halo;ctx.fillRect(mx-330,my-330,660,660)
  // cloud banks occlude (dark) so shafts breathe as they drift across
  ctx.globalAlpha=.9
  for(let k=0,nC=this.quality==='low'?3:this.quality==='medium'?4:this.cloudX.length;k<nC;k++){const z=this.cloudZ[k],cw=520+z*330,ch=143+z*82,x=this.cloudX[k]-cx*(.008+.025*z)*cz,y=my-105+(z-.5)*88
   ctx.save();ctx.globalCompositeOperation='multiply';ctx.drawImage(this.cloud!,x,y,cw,ch);ctx.restore()}
  ctx.globalAlpha=1
  // ridge + garden canopy occlude the lower sky
  ctx.fillStyle='rgba(0,0,0,.85)'
  ctx.fillRect(0,this.h*.62,this.w,this.h*.38)
 }

 drawSky(ctx:CanvasRenderingContext2D,cam:BgCam){this.ensure();const w=this.w,h=this.h,t=this.t,hy=h*.5+(0-cam.y)*cam.zoom
  ctx.save();ctx.drawImage(this.staticFar!,0,0,w,h)
  // cached moon with a stable celestial parallax
  const mx=w*.72-cam.x*.018,my=h*.15-(cam.y+170)*.035
  ctx.drawImage(this.moon!,mx-180,my-180,360,360)
  // Depth-sorted cloud skybox. Scale, vertical parallax and differential
  // drift supply volume while remaining only five cached image blits/frame.
  let transmission=1
  const cloudDraws:{x:number,y:number,cw:number,ch:number,z:number,near:number}[]=[]
  for(let k=0,nC=this.quality==='low'?3:this.quality==='medium'?4:this.cloudX.length;k<nC;k++){const z=this.cloudZ[k],cw=520+z*330,ch=143+z*82,x=this.cloudX[k]-cam.x*(.008+.025*z),y=my-105+(z-.5)*88+Math.sin(t*.045+k*1.7)*13;const dx=Math.abs((x+cw*.5)-mx),dy=Math.abs((y+ch*.48)-my);if(dx<cw*.39&&dy<ch*.31){const core=(1-dx/(cw*.39))*(1-dy/(ch*.31));transmission*=1-core*(.64+.28*z)}ctx.globalAlpha=.22+.17*z;ctx.drawImage(this.cloud!,x,y,cw,ch)
   cloudDraws.push({x,y,cw,ch,z,near:clamp01(1-Math.abs((x+cw*.5)-mx)/(w*.55))})}
  // MOONLIGHT SPILL THROUGH THE CLOUDS: the moon-facing flanks of the near
  // banks re-blit LIT (silver lining) — the brightness tracks the gap over
  // the moon, so opening sky visibly floods light into the scene.
  ctx.globalCompositeOperation='lighter'
  for(const cd of cloudDraws){const a=cd.near*cd.near*(.08+.22*transmission)*(.4+.6*cd.z)
   if(a>.004){ctx.globalAlpha=a;ctx.drawImage(this.cloudLit!,cd.x,cd.y,cd.cw,cd.ch)}}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'
  // Slow attack/release prevents light popping as soft cloud edges cross.
  const target=.06+.94*transmission,rate=target<this.moonVisibility?.018:.006
  this.moonVisibility+=(target-this.moonVisibility)*rate*60
  this.moonX=mx;this.moonY=my;this.moonCover=1-this.moonVisibility
  ctx.globalAlpha=1
  // MOON SHAFTS — one painted fan, STILL (research: god rays are physically
  // stable; they breathe only as cloud cover modulates the source). The fan
  // radiates down-left from the moon toward the deck.
  ctx.globalCompositeOperation='screen'
  const breathe=1+.04*Math.sin(t*.31)
  ctx.globalAlpha=clamp01(this.moonVisibility*.48)*breathe
  ctx.drawImage(this.shaft!,mx-360,my-16,720,720)
  // GAP BEAM — spill surge: a wide gap over the moon doubles the fan
  if(this.moonVisibility>.5){ctx.globalAlpha=clamp01((this.moonVisibility-.5)*.85)*breathe;ctx.drawImage(this.shaft!,mx-360,my-16,720,720)}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'
  // THE STORM ABOVE THE GARDEN — forked bolt + sky glow, drawn over the
  // cloud deck but occluded by the foreground garden silhouette below
  this.storm.drawSky(ctx)
  // mid garden cache parallax
  const shift=-(cam.x*.075)%w;ctx.drawImage(this.staticMid!,shift,0,w,h);ctx.drawImage(this.staticMid!,shift+(shift>0?-w:w),0,w,h)
  // NIGHT BIRDS — rare, slow silhouettes crossing the moonlit sky (living
  // motion is real physics: slow drift + wing stroke; never decorative spins)
  {for(let k=0;k<2;k++){
    const bt=((t*.011+k*.53)%1),bx=-90+bt*(this.w+180),by=this.h*.15+Math.sin(bt*6+k*2.1)*34
    const flap=Math.sin(t*3.1+k*2.2)*.55
    ctx.strokeStyle='rgba(30,44,58,.34)';ctx.lineWidth=2.2;ctx.lineCap='round'
    ctx.beginPath();ctx.moveTo(bx-9,by-4*flap);ctx.quadraticCurveTo(bx-3,by+2,bx,by);ctx.quadraticCurveTo(bx+3,by+2,bx+9,by-4*flap);ctx.stroke()}}
  // FOG SYSTEM v2 (height fog + directional inscattering):
  // two mist banks hugging the valley/deck line, CREEPING (≤2px/s) with a
  // slow density breath — painted atmosphere, never sliding smoke.
  for(let band=0;band<2;band++){
   ctx.globalAlpha=(band?.08:.11)*this.moonVisibility
   const y=hy-150+band*92
   const off=((t*(band?1.0:-1.4)-cam.x*(band?.11:.06))%1024+1024)%1024
   const scale=band?1.1:1.35
   for(let x=off-1024;x<w;x+=1024)ctx.drawImage(this.fog!,x,y,1024*scale,260*scale)}
  ctx.globalAlpha=1
  // DIRECTIONAL INSCATTERING — the mist brightens toward the moon azimuth
  // (Mie forward-scatter): a soft additive glow sits over the banks near the
  // moon's side of the sky, fading across the frame.
  {const scatter=clamp01(this.moonVisibility)*.05
   if(scatter>.004){ctx.globalCompositeOperation='lighter'
    const sg=ctx.createRadialGradient(mx,hy-95,20,mx,hy-95,w*.62)
    sg.addColorStop(0,`rgba(150,192,212,${scatter})`);sg.addColorStop(.5,`rgba(120,164,190,${scatter*.4})`);sg.addColorStop(1,'rgba(100,146,176,0)')
    ctx.fillStyle=sg;ctx.fillRect(0,Math.max(0,hy-320),w,340)
    ctx.globalCompositeOperation='source-over'}}
  // (the old centered 'combat pocket' glow is gone — it was the veil.
  //  The light rig now lifts what the sources actually touch.)
  ctx.restore()}

 drawArena(ctx:CanvasRenderingContext2D){this.ensure();const t=this.t
  // world-space bakes: engawa boards + garden props (aligned to the
  // gameplay plane and the shared emitters)
  ctx.drawImage(this.staticDeck!,ARENA_X0,0)
  // CLOUD SHADOWS ON THE GROUND — the moon's light patches drift across the
  // deck as the sky moves (dynamic lighting on a 2D plane).
  {ctx.save();ctx.globalCompositeOperation='multiply';ctx.globalAlpha=.20
   for(let k=0,nC=this.quality==='low'?3:this.quality==='medium'?4:this.cloudX.length;k<nC;k++){const z=this.cloudZ[k]
    const x=((this.cloudX[k]*2.1+z*640+t*2.2)%(ARENA_W+2400))-1400
    ctx.drawImage(this.cloud!,x,-40,520+z*330,300)}
   ctx.restore()}
  ctx.drawImage(this.staticGarden!,ARENA_X0,-410)
  // moon-silver ripples over the pond
  ctx.save();ctx.translate(POND_X,POND_Y);ctx.fillStyle='rgba(6,16,22,.6)';ctx.beginPath();ctx.ellipse(0,38,185,54,-.04,0,TAU);ctx.fill()
  ctx.strokeStyle='rgba(168,196,204,.26)';ctx.lineWidth=1.2
  for(let i=0;i<7;i++){const rw=38+i*19+Math.sin(t*.8+i)*7;ctx.beginPath();ctx.ellipse(Math.sin(i*2.4)*42,35+i%2*8,rw,5+i*.45,0,0,TAU);ctx.stroke()}
  ctx.restore()
  // deck-edge ground mist (height fog at the play line) — creeping, not sliding
  ctx.globalAlpha=.085;const off=((t*1.6)%1024+1024)%1024;for(let x=ARENA_X0-1024+off;x<ARENA_X1;x+=1024)ctx.drawImage(this.fog!,x,-140,1280,230);ctx.globalAlpha=1}

 drawWetMask(ctx:CanvasRenderingContext2D){this.ensure();ctx.drawImage(this.wetPlate!,ARENA_X0,10,ARENA_W,150)}

 drawLightRig(ctx:CanvasRenderingContext2D,moonWorldX:number,_moonWorldY:number){this.ensure();const t=this.t,cov=this.moonCover,li=this.lightningI()
  const key=keyLightFromStorm(li,this.lightningAz())
  // MOON DIFFUSE POOL — the lit surface the long shadows read against.
  // LIVE brightness (eclipse kills it) + azimuth lean (lightning swings it).
  const poolA=(0.34+0.62*clamp01(key.i))*(1-0.92*cov)
  if(poolA>0.012){
   ctx.globalAlpha=poolA*.92
   // (the full-width deck pool is gone — the light map gives the deck its
   //  moon field with real falloff now)
   const lightOnRight=key.dirX<0
   const bx=lightOnRight?ARENA_X1:ARENA_X0,ex=lightOnRight?ARENA_X0:ARENA_X1
   const lean=ctx.createLinearGradient(bx,0,ex,0)
   lean.addColorStop(0,'rgba(178,206,236,0.1)');lean.addColorStop(.55,'rgba(178,206,236,0.03)');lean.addColorStop(1,'rgba(178,206,236,0)')
   ctx.globalCompositeOperation='lighter';ctx.globalAlpha=clamp01(key.i)*(1-0.92*cov)
   ctx.fillStyle=lean;ctx.fillRect(ARENA_X0,-16,ARENA_W,180)
   ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1
  }
  // MOONLIGHT PATH — the wet mirror catches the moon in a PERSPECTIVE
  // specular lane: narrow at the horizon under the moon, widening toward the
  // viewer, broken by high-frequency horizontal wave glints (water-physics
  // reflection policy). Classic semi-3D light path on a wet plane.
  ctx.globalCompositeOperation='lighter'
  const glintA=clamp01(key.i)*(1-cov)*0.52
  if(glintA>0.01){
   for(let i=0;i<16;i++){
    const u=i/15
    const y=-8+u*u*258
    const wpath=26+u*u*320
    const jitter=Math.sin(t*1.9+i*2.3)*18*(0.25+u)
    const cx2=moonWorldX+jitter
    ctx.globalAlpha=glintA*(0.20+0.62*u)*(0.74+0.26*Math.sin(t*1.7+i*1.1))
    ctx.fillRect(cx2-wpath/2,y,wpath,1.6+u*2.2)
   }
  }
  // DOOR PRACTICAL — warm bounce; practicals fire through cloud cover
  ctx.globalAlpha=0.24*(1-0.4*cov)*(0.92+0.08*Math.sin(t*11.3))
  ctx.drawImage(this.warmPool!,DOOR_X-330,-140,660,320)
  // STONE LANTERN practical
  ctx.globalAlpha=0.2*(1-0.4*cov)*(0.9+0.1*Math.sin(t*9.1+1.7))
  ctx.drawImage(this.warmPool!,LANTERN_X-270,-360,540,420)
  // WET-FLOOR PRACTICAL STREAKS — warm practicals stretch down the wet deck
  // toward the viewer (mirror law: 25-35% + high-frequency wave distortion)
  const streak=(sx:number,sw:number,base:number)=>{
   for(let k=0;k<7;k++){
    const yy=-18+k*40,u=k/6,wob=Math.sin(t*1.4+k*1.9)*7
    ctx.globalAlpha=base*(1-u)*(.72+.28*Math.sin(t*2.1+k*2.6))
    ctx.fillRect(sx+wob-sw*(.35+.65*u)*.5,yy,sw*(.35+.65*u),24)}}
  streak(DOOR_X-30,78,.30)
  streak(LANTERN_X,56,.24)
  // pond glint
  if(glintA>0.01){ctx.globalAlpha=glintA*0.85;ctx.drawImage(this.glitter!,POND_X-190,POND_Y+2,380,70)}
  // defocused warm bokeh droplets near the door practical
  ctx.globalAlpha=0.06*(1-0.5*cov)*(0.8+0.2*Math.sin(t*0.9))
  const bq=ctx.createRadialGradient(DOOR_X-190,-190,2,DOOR_X-190,-190,23);bq.addColorStop(0,'rgba(255,196,140,.9)');bq.addColorStop(.72,'rgba(255,170,110,.28)');bq.addColorStop(1,'rgba(255,160,100,0)')
  ctx.fillStyle=bq;ctx.fillRect(DOOR_X-216,-216,52,52)
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'
 }

 drawWeather(ctx:CanvasRenderingContext2D,cam:BgCam){this.ensure();this.storm.setView(cam);this.storm.drawRain(ctx);const w=this.w,h=this.h,t=this.t
  // GLOWING BLOSSOM PETALS — the target's signature: drifting sakura petals
  // with soft pink halos (two-pass: additive glow, then the petal body).
  // Pooled depth sprites, no allocations.
  ctx.globalCompositeOperation='lighter'
  for(let i=0,nP=this.quality==='low'?30:this.quality==='medium'?50:70;i<nP;i++){const z=this.pz[i],x=((this.px[i]+t*(9+17*z)+Math.sin(t*.7+this.pp[i])*22)%(w+120))-60,y=(this.py[i]+t*(7+13*z))%(h+80)-40;if(y>h*.82)continue;const gs=5+11*z;ctx.globalAlpha=.24+.5*z;ctx.drawImage(this.petalGlow!,x-gs,y-gs,gs*2,gs*2)}
  ctx.globalCompositeOperation='source-over'
  for(let i=0,nP=this.quality==='low'?30:this.quality==='medium'?50:70;i<nP;i++){const z=this.pz[i],x=((this.px[i]+t*(9+17*z)+Math.sin(t*.7+this.pp[i])*22)%(w+120))-60,y=(this.py[i]+t*(7+13*z))%(h+80)-40;if(y>h*.82)continue;ctx.save();ctx.globalAlpha=.42+.5*z;ctx.translate(x,y);ctx.rotate(t*(.35+z)+this.pp[i]);const s=3+7*z;ctx.drawImage(this.petal!,-s,-s*.55,s*2,s*1.1);ctx.restore()}
  // FOREGROUND PARALLAX SILHOUETTES — near-camera grass tufts + rocks frame
  // the bottom edge. Fastest parallax of any layer: the signature semi-3D cue.
  {const fs=(cam.x*1.35)%(w+360)
   ctx.fillStyle='rgba(5,10,14,.85)'
   for(let k=0;k<9;k++){
    const x=(((((k*167+(k%3)*53-fs)%(w+360))+(w+360))%(w+360))-180)
    if(k%3===2){const rw=32+((k*13)%26);ctx.beginPath();ctx.ellipse(x,h-10,rw,rw*.5,0,0,TAU);ctx.fill()}
    else{const hh=68+((k*37)%86)
     ctx.beginPath();ctx.moveTo(x-16,h)
     ctx.quadraticCurveTo(x-6,h-hh*1.25,x+1,h-hh)
     ctx.quadraticCurveTo(x+5,h-hh*.62,x+8,h-hh*.92)
     ctx.quadraticCurveTo(x+12,h-hh*.5,x+18,h);ctx.fill()}}}
  // restrained cool atmospheric grade (pre-baked per resize)
  ctx.drawImage(this.vignette!,0,0)}
}
