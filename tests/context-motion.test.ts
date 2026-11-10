import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ContextMotion,DEFAULT_CONTEXT,selectMotionVariation,referenceHandArc,type MotionContext} from '../src/game/anim/context-motion'
import {makePose,CH} from '../src/game/anim/pose'
import {sampleClip} from '../src/game/anim/animator'
import {applyJointLimits} from '../src/game/anim/limits'
import {RUN_CLIP,IDLE_CLIP} from '../src/game/anim/clips'
const c=(x:Partial<MotionContext>={}):MotionContext=>({...DEFAULT_CONTEXT,...x})
const solve=(context:MotionContext,hz=120)=>{
 const m=new ContextMotion();let p=makePose()
 for(let i=0;i<hz;i++){p=sampleClip(context.speed>200?RUN_CLIP:IDLE_CLIP,.12,makePose());m.apply(p,context,1/hz);applyJointLimits(p)}
 return p
}
test('all animation families have deterministic condition-driven variations',()=>{
 const pairs:[Partial<MotionContext>,Partial<MotionContext>][]=[
  [{},{threat:.9,surrounded:true}],
  [{speed:100,forward:100},{speed:100,forward:100,threat:.4}],
  [{speed:350,forward:350},{speed:350,forward:350,acceleration:1500}],
  [{speed:480,forward:480},{speed:480,forward:480,swordDrawn:true}],
  [{speed:100,forward:100},{speed:100,forward:100,health:.2}],
  [{clip:'stop',entrySpeed:100},{clip:'stop',entrySpeed:480}],
  [{clip:'land',landingImpact:200},{clip:'land',landingImpact:1000}],
  [{grounded:false,vy:-500},{grounded:false,vy:600}],
  [{state:'dash'},{state:'dash',dashVariant:'retreat'}],
  [{state:'attack'},{state:'attack',counter:true}],
  [{state:'parry'},{state:'parry',surrounded:true}],
  [{state:'charge'},{state:'charge',threat:.9}],
  [{clip:'flourish'},{clip:'flourish',threat:.8}],
  [{state:'hurt'},{state:'hurt',grounded:false}],
  [{state:'dead'},{state:'dead',grounded:false}],
  [{state:'scripted'},{state:'scripted',surrounded:true}],
 ]
 for(const [a,b] of pairs){assert.notEqual(selectMotionVariation(c(a)),selectMotionVariation(c(b)));assert.equal(selectMotionVariation(c(a)),selectMotionVariation(c(a)))}
})
test('variations change actual arm/core poses, not only their labels',()=>{
 const normal=solve(c({speed:350,phase:.2,forward:350}))
 const drive=solve(c({speed:350,phase:.2,forward:350,acceleration:1600}))
 const wound=solve(c({speed:350,phase:.2,forward:350,health:.2}))
 const armed=solve(c({speed:350,phase:.2,forward:350,swordDrawn:true}))
 assert.ok(Math.abs(drive[CH.rootRot]-normal[CH.rootRot])>.015)
 assert.ok(Math.abs(wound[CH.elL]-normal[CH.elL])>.04)
 assert.ok(Math.abs(armed[CH.shR]-normal[CH.shR])>.04)
})
test('condition weights are stable at 30/60/120 Hz and preserve gait/blade contracts',()=>{
 const input=c({speed:350,phase:.25,forward:350,health:.2,threat:.8})
 const a=solve(input,30),b=solve(input,120)
 for(let ch=0;ch<a.length;ch++)assert.ok(Math.abs(a[ch]-b[ch])<.025,`channel ${ch}`)
 const m=new ContextMotion(),p=sampleClip(RUN_CLIP,.12,makePose()),before=p.slice()
 for(let i=0;i<200;i++){
  p.set(before);m.apply(p,input,1/120)
  assert.ok([...p].every(Number.isFinite))
  for(const ch of [CH.hipL,CH.hipR,CH.kneeL,CH.kneeR,CH.footL,CH.footR,CH.wrR,CH.bladeYaw,CH.bladeZ])assert.equal(p[ch],before[ch])
 }
})
test('a free-arm running transition cannot rewrite an armed attack endpoint',()=>{
 const m=new ContextMotion(),base=sampleClip(RUN_CLIP,.1,makePose())
 for(let i=0;i<120;i++){const p=base.slice();m.apply(p,c({speed:350,phase:.3}),1/120)}
 const p=base.slice();m.apply(p,c({state:'attack',swordDrawn:true,counter:true,phase:.4}),1/120)
 for(const ch of [CH.shR,CH.elR,CH.wrR,CH.bladeYaw,CH.bladeZ])assert.equal(p[ch],base[ch])
})

test('twelve-landmark reference hand cycle is bounded and C1 across the loop seam',()=>{
 for(let i=0;i<=1200;i++){
  const p=referenceHandArc(i/1200);assert.ok(p.x>=-14.0001&&p.x<=15.0001);assert.ok(p.y>=17.9999&&p.y<=30.0001)
 }
 const h=1e-4,a=referenceHandArc(-h),b=referenceHandArc(0),d=referenceHandArc(h)
 for(const ch of ['x','y'] as const){assert.ok(Math.abs(a[ch]-d[ch])<.01);assert.ok(Math.abs((b[ch]-a[ch])/h-(d[ch]-b[ch])/h)<.3)}
 assert.deepEqual(referenceHandArc(Number.NaN),referenceHandArc(0))
})
