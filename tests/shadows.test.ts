import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { keyLightFromStorm,projectGroundPoint,drawCastShadow,type ShadowFigure } from '../src/game/render/lighting'
const ctx=()=>createCanvas(640,120).getContext('2d')
test('shadow pass 1: projection is finite, bounded, and continuous through bolt azimuth',()=>{
  for(const bad of [NaN,Infinity,-Infinity]){
    const light=keyLightFromStorm(bad,bad)
    assert.ok(Object.values(light).every(v=>typeof v==='string'||Number.isFinite(v)))
    assert.equal(projectGroundPoint(bad,0,light),null)
  }
  let previous=0
  for(let i=0;i<=200;i++){
    const q=projectGroundPoint(200,-100,keyLightFromStorm(1,-1+i/100))!
    assert.ok(Number.isFinite(q.x)&&Number.isFinite(q.y))
    if(i>0)assert.ok(Math.abs(q.x-previous)<3)
    previous=q.x
  }
})
test('shadow pass 1: malformed chains never emit invalid canvas geometry',()=>{
  const c=ctx(),light=keyLightFromStorm(1,1)
  const fig:ShadowFigure={chains:[[0,0,NaN,-100,40,-40,Infinity,0],[4]],head:{x:NaN,y:0,r:Infinity}}
  assert.doesNotThrow(()=>drawCastShadow(c as unknown as CanvasRenderingContext2D,fig,light))
  assert.equal(c.globalAlpha,1);assert.equal(c.globalCompositeOperation,'source-over')
})

test('shadow pass 2: duplicate/overlapping bones do not stack opacity',()=>{
  const a=ctx(),b=ctx(),light=keyLightFromStorm(0,0),chain=[180,-40,260,-10]
  drawCastShadow(a as unknown as CanvasRenderingContext2D,{chains:[chain],head:null},light,{alpha:.4})
  drawCastShadow(b as unknown as CanvasRenderingContext2D,{chains:[chain,chain,chain],head:null},light,{alpha:.4})
  assert.deepEqual(a.getImageData(0,0,640,120).data,b.getImageData(0,0,640,120).data)
})
test('shadow pass 2: airborne contact AO is suppressed and height is not applied twice',async()=>{
  const {shadowOpacity}=await import('../src/game/render/lighting')
  assert.ok(shadowOpacity(-200)<shadowOpacity(0)*.4)
  const a=ctx(),b=ctx(),light=keyLightFromStorm(1,1),fig={chains:[[180,-200,220,-140]],head:{x:220,y:-260,r:8}}
  drawCastShadow(a as unknown as CanvasRenderingContext2D,fig,light,{height:-200,contacts:[200,200]})
  drawCastShadow(b as unknown as CanvasRenderingContext2D,fig,light,{height:-200,contacts:[]})
  assert.deepEqual(a.getImageData(0,0,640,120).data,b.getImageData(0,0,640,120).data)
})

test('shadow pass 3: render budgets are bounded and context state is restored',()=>{
  const c=ctx();c.globalAlpha=.37;c.globalCompositeOperation='screen'
  for(const passes of [1,2,3,1000,Infinity,NaN]){
    drawCastShadow(c as unknown as CanvasRenderingContext2D,{chains:[[180,-100,230,0]],head:null},
      keyLightFromStorm(1,-1),{passes,contacts:[230,230,NaN]})
    assert.ok(Math.abs(c.globalAlpha-.37)<.01);assert.equal(c.globalCompositeOperation,'screen')
  }
})
test('shadow pass 3: extra soft passes do not create an opaque stacked center',()=>{
  const a=ctx(),b=ctx(),fig={chains:[[180,-40,280,-40]],head:null},light=keyLightFromStorm(0,0)
  drawCastShadow(a as unknown as CanvasRenderingContext2D,fig,light,{alpha:.45,passes:1})
  drawCastShadow(b as unknown as CanvasRenderingContext2D,fig,light,{alpha:.45,passes:3})
  const ap=a.getImageData(210,3,1,1).data[3],bp=b.getImageData(210,3,1,1).data[3]
  assert.ok(Math.abs(ap-bp)<5,`${ap} versus ${bp}`)
})
