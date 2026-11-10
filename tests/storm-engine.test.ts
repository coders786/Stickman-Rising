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
test('natural lightning draws a viewport bolt and does not require a test-only trigger',()=>{
 const s=new StormEngine('low');s.resize(800,500);s.update(.88)
 assert.ok(s.intensity>.5)
 const c=createCanvas(800,500),ctx=c.getContext('2d');s.drawSky(ctx as unknown as CanvasRenderingContext2D)
 assert.ok(ctx.getImageData(0,0,800,500).data.some(v=>v>0))
})
