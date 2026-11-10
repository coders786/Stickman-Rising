import {test} from 'node:test'
import assert from 'node:assert/strict'
import {IDLE_CLIP,DRAW_CLIP,SHEATHE_CLIP} from '../src/game/anim/clips'
import {sampleClip} from '../src/game/anim/animator'
import {CH,makePose} from '../src/game/anim/pose'
import {applyJointLimits} from '../src/game/anim/limits'
import {handGestures} from '../src/game/anim/hand-gestures'
test('six extra authored keys in each sword ritual preserve timing and gate beats',()=>{
 assert.equal(SHEATHE_CLIP.frames.length,11);assert.equal(DRAW_CLIP.frames.length,12)
 assert.equal(SHEATHE_CLIP.dur,.85);assert.equal(DRAW_CLIP.dur,.3)
 for(const [clip,times] of [[SHEATHE_CLIP,[.11,.30,.37,.50,.70,.78]],[DRAW_CLIP,[.035,.085,.12,.185,.245,.275]]] as const){
  for(const t of times)assert.ok(clip.frames.some(f=>f.t===t))
  for(let i=0;i<=500;i++){
   const p=sampleClip(clip,clip.dur*i/500,makePose()),safe=applyJointLimits(p.slice())
   for(let ch=0;ch<p.length;ch++)assert.ok(Math.abs(p[ch]-safe[ch])<1e-5,`${clip.name} ${ch}`)
   const h=handGestures(clip.name,i/500,true)
   if(clip===DRAW_CLIP&&i/500<.22)assert.ok(h.rightOpen>=0&&h.rightOpen<=.36)
   else assert.equal(h.rightOpen,0)
   assert.equal(h.rightRoll,0)
   assert.ok(h.leftOpen<=.251&&Math.abs(h.leftRoll)<=.036)
  }
 }
})
test('idle breathes with delayed hands while stance and loop seam remain stable',()=>{
 assert.equal(IDLE_CLIP.frames.length,7);assert.equal(IDLE_CLIP.loop,true)
 const first=sampleClip(IDLE_CLIP,0,makePose()),last=sampleClip(IDLE_CLIP,IDLE_CLIP.dur,makePose())
 assert.deepEqual([...first],[...last])
 let lo=Infinity,hi=-Infinity
 for(let i=0;i<=500;i++){
  const p=sampleClip(IDLE_CLIP,IDLE_CLIP.dur*i/500,makePose())
  lo=Math.min(lo,p[CH.rootY]);hi=Math.max(hi,p[CH.rootY])
  for(const ch of [CH.hipL,CH.hipR,CH.kneeL,CH.kneeR,CH.footL,CH.footR])assert.equal(p[ch],first[ch])
  assert.ok(Math.abs(p[CH.rootX]-2)<.3)
  assert.ok(Math.abs(p[CH.shL]-first[CH.shL])<.05)
  const safe=applyJointLimits(p.slice())
  for(let ch=0;ch<p.length;ch++)assert.ok(Math.abs(p[ch]-safe[ch])<1e-5)
 }
 assert.ok(hi-lo>.8&&hi-lo<1,'visible but restrained breathing')
})
test('quiet sheathed idle completes a breath before an automatic flourish',async()=>{
 const {Player}=await import('../src/game/entities/player')
 const {Input}=await import('../src/game/core/input')
 const p=new Player(),input=new Input(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,
  fx:new Proxy({},{get:()=>noop}),audio:{play:noop},cam:{addTrauma:noop}}
 for(let i=0;i<720;i++){
  w.time+=1/120;p.update(1/120,w as unknown as import('../src/game/core/types').WorldRef);input.endFrame(1/120)
  const animator=(p as unknown as {animator:import('../src/game/anim/animator').Animator}).animator
  assert.equal(animator.getClip()?.name,'idle')
 }
})
