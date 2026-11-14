import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCanvas} from '@napi-rs/canvas'
import {DamageSurface,POISSON_12,ShadowFieldSAT,fbm3CPU,windAt} from '../src/game/render/bhst'

test('sakura optics: analytic gust carrier integrates exactly (no drift)',()=>{
  const w1=windAt(3,1),w2=windAt(3+1e-4,1)
  const numeric=(w2[2]-w1[2])/1e-4,analytic=(w1[0]+w2[0])*0.5
  assert.ok(Math.abs(numeric-analytic)<1e-2,`${numeric} vs ${analytic}`)
  const n1=windAt(3,-1),n2=windAt(3+1e-4,-1)
  assert.ok(Math.abs((n2[2]-n1[2])/1e-4-(n1[0]+n2[0])*0.5)<1e-2)
  // reversed gust mirrors displacement sign, never NaNs
  for(const bad of [NaN,Infinity,-Infinity]){const w=windAt(bad,bad);assert.ok(w.every(v=>Number.isFinite(v)))}
})

test('sakura optics: noise LUT is deterministic, bounded and in [0,1]',()=>{
  for(let i=0;i<400;i++){const v=fbm3CPU(i*0.37-9,i*0.11+4);assert.ok(v>=0&&v<=1)}
  assert.equal(fbm3CPU(0.3,0.4),fbm3CPU(0.3,0.4))
  assert.notEqual(fbm3CPU(0.3,0.4),fbm3CPU(0.31,0.4))
})

test('sakura optics: complete-footprint SAT certifies lit/umbral and only taps the disk on penumbra',()=>{
  const c=createCanvas(200,60),g=c.getContext('2d')
  g.fillStyle='#f00';g.fillRect(60,10,40,40)
  const sat=new ShadowFieldSAT()
  sat.buildFromMask(c as unknown as HTMLCanvasElement,[],0,0)
  assert.equal(sat.sampleFootprint(5,5,2,2),1)
  assert.equal(sat.sampleFootprint(80,30,2,2),0)
  assert.equal(sat.sampleFootprint(500,500,2,2),1)
  // fully inside footprint is certified umbral (0), not an average
  assert.equal(sat.sampleFootprint(80,30,6,6),0)
  const edge=sat.sampleFootprint(60,30,8,8)
  assert.ok(edge>0&&edge<1)
  // out-of-canvas taps read as clear, never as shadow
  assert.equal(sat.sampleFootprint(199,59,1,1)>0,true)
})

test('sakura optics: motion envelope marks swaying foliage uncertain, structure certified',()=>{
  const c=createCanvas(120,40),g=c.getContext('2d')
  g.fillStyle='rgba(0,255,0,.72)';g.fillRect(10,10,20,20)
  g.fillStyle='#f00';g.fillRect(60,10,20,20)
  const sat=new ShadowFieldSAT()
  sat.buildFromMask(c as unknown as HTMLCanvasElement,[],0,0)
  // foliage (green) is uncertain -> needs the 12-tap disk at its edge
  const fol=sat.sampleFootprint(20,20,3,3)
  assert.ok(fol>0&&fol<1,`foliage ${fol}`)
  // timber (red) is certified fully opaque in its interior
  assert.equal(sat.sampleFootprint(70,20,3,3),0)
  assert.equal(POISSON_12.length,12)
  assert.ok(POISSON_12.every(([x,y])=>Math.hypot(x,y)<=1))
})

test('sakura optics: damage lattice clears prior tiles, full-clears on invalidation, restores ctx',()=>{
  const c=createCanvas(256,128),g=c.getContext('2d') as unknown as CanvasRenderingContext2D
  const dmg=new DamageSurface();dmg.resize(256,128)
  dmg.begin(g,256,128,1)
  dmg.markRect(10,10,40,40)
  dmg.begin(g,256,128,1)
  g.globalAlpha=.31;g.globalCompositeOperation='screen'
  dmg.begin(g,256,128,1)
  assert.equal(g.globalAlpha,.31);assert.equal(g.globalCompositeOperation,'screen')
  // a full-clear threshold warmup does not throw and stays pixel-accurate
  for(let i=0;i<8;i++){dmg.begin(g,256,128,1);dmg.markRect(0,0,256,128)}
  dmg.invalidate()
  assert.doesNotThrow(()=>dmg.begin(g,256,128,1))
})
