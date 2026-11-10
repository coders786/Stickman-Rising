import test from 'node:test'
import assert from 'node:assert/strict'
import {createCanvas} from '@napi-rs/canvas'
import {HUD, type HudState} from '../src/game/render/hud'

const base:HudState={hp:100,maxHp:100,energy:100,maxEnergy:100,stamina:600,maxStamina:600,dashCharge:0,staminaCooldown:0,meter:100,swordName:'EMPTY HAND / SHEATHED',swordColor:'#0ff',abilityName:'STRIKE',abilityCost:20,combo:{hits:21,mult:2,rank:'A',timer:2,timerMax:4,rankUpT:0,lastHitT:0},wave:3,enemiesLeft:5,kills:12,score:123,boss:{hp:50,maxHp:100,name:'BOSS'},banner:null,executePrompt:null,ultReady:true,abilityReady:true,fps:60,showFps:false,runTime:30,attract:false}

test('HUD reserves separate resource, boss and score areas at common widths',()=>{
 for(const w of [320,390,640,800,1100]){
  const ctx=createCanvas(w,700).getContext('2d'),rects:number[][]=[],texts:{text:string,x:number,y:number,max?:number}[]=[]
  const fillRect=ctx.fillRect.bind(ctx),fillText=ctx.fillText.bind(ctx)
  ctx.fillRect=(x,y,width,height)=>{rects.push([x,y,width,height]);fillRect(x,y,width,height)}
  ctx.fillText=(text,x,y,maxWidth)=>{texts.push({text,x,y,max:maxWidth});if(maxWidth===undefined)fillText(text,x,y);else fillText(text,x,y,maxWidth)}
  new HUD().draw(ctx as unknown as CanvasRenderingContext2D,w,700,base,1/60)
  const panel=rects.find(r=>r[0]===12&&r[1]===12&&r[3]===154)!
  const boss=rects.find(r=>r[0]===12&&r[1]===175&&r[3]===26)!
  assert.ok(panel&&boss,`panels at ${w}`)
  assert.ok(boss[1]>=panel[1]+panel[3],`boss does not cover vitals at ${w}`)
  const score=texts.find(t=>t.text==='123')!
  assert.ok(score.x-(score.max??0)>=panel[0]+panel[2],`score clears resources at ${w}`)
  if(w<850)assert.ok(score.x<=w-64,`touch pause clearance at ${w}`)
  assert.ok(texts.some(t=>t.text==='POWER READY'))
  assert.ok(texts.some(t=>t.text==='READY [I]'))
 }
})

test('HUD distinguishes power charging, exhaustion and regeneration',()=>{
 const ctx=createCanvas(390,700).getContext('2d'),texts:string[]=[]
 const fillText=ctx.fillText.bind(ctx)
 ctx.fillText=(text,x,y,maxWidth)=>{texts.push(text);if(maxWidth===undefined)fillText(text,x,y);else fillText(text,x,y,maxWidth)}
 const hud=new HUD(),draw=(state:Partial<HudState>)=>hud.draw(ctx as unknown as CanvasRenderingContext2D,390,700,{...base,...state},1/60)
 draw({dashCharge:.5});draw({dashCharge:1});draw({stamina:20});draw({stamina:80});draw({stamina:300,staminaCooldown:.5})
 for(const label of ['CHARGING 50%','RELEASE: POWER','EXHAUSTED','POWER LOW','RECOVERING'])assert.ok(texts.includes(label),label)
})
