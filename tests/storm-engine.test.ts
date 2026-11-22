import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCanvas} from '@napi-rs/canvas'
import {StormEngine} from '../src/game/world/storm'
import {CyberBackground} from '../src/game/world/background'
test('every quality retains rain and quality churn cannot postpone natural lightning',()=>{
 const s=new StormEngine('high');let thunder=0;s.onThunder=()=>thunder++
 for(let i=0;i<1200;i++){
  s.setQuality((['low','medium','high'] as const)[i%3]);s.update(1/120)
  assert.ok(s.snapshot.visibleDrops>=96)
 }
 assert.ok(s.snapshot.strikes>=2);assert.equal(thunder,s.snapshot.strikes)
 assert.ok(s.snapshot.impacts>100)
})
test('replacement city instances reuse storm clock, strike envelope and thunder binding',()=>{
 const s=new StormEngine();s.update(.9);const before=s.snapshot
 const cb=()=>{};s.onThunder=cb
 for(const q of ['low','medium','high'] as const){const bg=new CyberBackground(q,s);bg.resize(1920,1080);assert.equal(bg.storm,s);assert.equal(bg.lightningI(),before.intensity);assert.equal(bg.onThunder,cb)}
 assert.equal(s.snapshot.time,before.time)
})
test('render is side-effect free and rainy pixels exist even on low quality',()=>{
 const s=new StormEngine('low');s.resize(800,500);s.setView({x:1300,y:-150,zoom:1});s.update(.5)
 const c=createCanvas(800,500),ctx=c.getContext('2d'),before=s.snapshot
 s.drawRain(ctx as unknown as CanvasRenderingContext2D)
 const a=ctx.getImageData(0,0,800,500).data;let pixels=0
 for(let i=3;i<a.length;i+=4)if(a[i]>0)pixels++
 assert.ok(pixels>1000);assert.deepEqual(s.snapshot,before)
 // Invalid inputs do not poison simulation or viewport.
 s.resize(NaN,0);s.setView({x:NaN,y:0,zoom:0});s.update(NaN)
 assert.deepEqual(s.snapshot,before)
})
test('natural lightning reaches full intensity without a test-only trigger',()=>{
 // the bolt ART engine (StormEngine.drawSky) was removed in the 120 fps
 // strip — lightning now only drives intensity/azimuth for the flash tint
 const s=new StormEngine('low');s.resize(800,500);s.update(.88)
 assert.ok(s.intensity>.5)
})

test('lightning decays once and the rain pass cannot flash the whole frame',()=>{
 const s=new StormEngine('ultra');s.resize(800,500);s.update(.88)
 const g=createCanvas(800,500).getContext('2d');let flashes=0
 const fill=g.fillRect.bind(g);g.fillRect=(x,y,w,h)=>{if(x===0&&y===0&&w===800&&h===500)flashes++;fill(x,y,w,h)}
 let prev=s.intensity
 for(let i=0;i<30;i++){s.drawRain(g as unknown as CanvasRenderingContext2D);s.update(1/60);assert.ok(s.intensity<=prev);prev=s.intensity}
 assert.equal(flashes,0)
})

test('deck splashes scatter across the road instead of piling up on the fight rail',()=>{
 const s=new StormEngine('high');s.resize(800,500);s.setView({x:400,y:0,zoom:1})
 for(let i=0;i<90;i++)s.update(1/120)
 const g=createCanvas(800,140).getContext('2d');g.translate(0,70)
 s.drawSplashes(g as unknown as CanvasRenderingContext2D,100,700)
 const data=g.getImageData(0,0,800,140).data
 let rear=0,front=0
 for(let y=0;y<140;y++)for(let x=0;x<800;x++)if(data[(y*800+x)*4+3]){
  assert.ok(x>=100&&x<700&&y>=18&&y<122,'splash leaked outside the road')
  if(y<55)rear++
  if(y>85)front++
 }
 assert.ok(rear>20&&front>20,'both halves of the road should get impacts away from the rail')
})

test('sharp rain changes travel without adding drops or rescheduling lightning',()=>{
 const stock=new StormEngine('ultra'),sharp=new StormEngine('ultra');sharp.setSharpRain(true)
 for(let i=0;i<2400;i++){
  stock.update(1/120);sharp.update(1/120)
  assert.equal(sharp.snapshot.strikes,stock.snapshot.strikes)
  assert.equal(sharp.snapshot.intensity,stock.snapshot.intensity)
 }
 assert.ok(stock.snapshot.strikes>=3)
 assert.equal(sharp.snapshot.visibleDrops,stock.snapshot.visibleDrops)
 assert.ok(sharp.snapshot.impacts>stock.snapshot.impacts)
})

test('zero-alpha weather builds no paths, without stopping the front or thunder', () => {
 const dry = new StormEngine('ultra'), wet = new StormEngine('ultra')
 dry.setRainScale(0)
 dry.setSharpRain(true);wet.setSharpRain(true)
 const g = createCanvas(800,500).getContext('2d')
 const ctx = g as unknown as CanvasRenderingContext2D
 const noPath = g.beginPath.bind(g)
 let paths=0
 g.beginPath=()=>{paths++;noPath()}
 for(let i=0;i<180;i++){
  dry.update(1/60);wet.update(1/60)
  dry.drawRain(ctx,{x:1400,y:-110,color:'255,160,90',gain:1})
  dry.drawSplashes(ctx,800,1800,()=>.8)
 }
 assert.equal(paths,0)
 assert.deepEqual(dry.snapshot,wet.snapshot,'dry rendering changed simulation or thunder')
 dry.setRainScale(.06)
 dry.drawRain(ctx)
 assert.ok(paths>0,'real drizzle did not resume painting')
})
