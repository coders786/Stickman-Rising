import {test} from 'node:test'
import assert from 'node:assert/strict'
import {GaitPlanner,PLAYER_GAIT} from '../src/game/anim/legik'
import {WALK_CLIP,walkHandMotion} from '../src/game/anim/patrol-walk'
import {sampleClip} from '../src/game/anim/animator'
import {makePose,CH} from '../src/game/anim/pose'
import {equipmentClip} from '../src/game/anim/equipment-motion'
test('new patrol profile keeps stance anchors fixed and retains double support over long loops',()=>{
 for(const hz of [30,60,120])for(const speed of [40,70,100,145,190])for(const face of [-1,1] as const){
  const gait=new GaitPlanner();let x=0,prev=[0,0],planted=[false,false],lastPhase=0,double=0
  for(let i=0;i<hz*12;i++){
   x+=speed*face/hz;gait.update(x,speed*face,face,speed,PLAYER_GAIT.walk,1/hz,true,3,true)
   assert.ok(gait.footL.planted||gait.footR.planted,'walk never has aerial flight')
   if(gait.footL.planted&&gait.footR.planted)double++
   for(const [j,f] of [gait.footL,gait.footR].entries()){
    const phase=j===0?(gait.phase+.5)%1:gait.phase,old=j===0?(lastPhase+.5)%1:lastPhase
    if(i>hz&&planted[j]&&f.planted&&phase>old)assert.ok(Math.abs(f.x-prev[j])<1e-8,'stance anchor slides')
    if(i>hz)assert.ok(Math.abs(f.x-x)<38,'walk overstrides beyond support envelope')
    assert.ok(Number.isFinite(f.x)&&Number.isFinite(f.y)&&f.y<=-3)
    prev[j]=f.x;planted[j]=f.planted
   }
   lastPhase=gait.phase
  }
  assert.ok(double>hz,'must include actual double support, not a slow run')
 }
})
test('new bilateral walk closes hand, joint and equipment clocks at the loop seam',()=>{
 assert.equal(WALK_CLIP.frames.length,15)
 for(const drawn of [false,true]){
  const c=equipmentClip(WALK_CLIP,drawn),a=sampleClip(c,0,makePose()),b=sampleClip(c,c.dur,makePose())
  assert.deepEqual([...a],[...b])
  for(let i=0;i<200;i++){
   const p=sampleClip(c,c.dur*i/200,makePose())
   assert.ok(Math.abs(p[CH.pelvisYaw])<=.036)
   const h=walkHandMotion(i/200);assert.ok(Math.abs(h.left.x+h.right.x)<1e-8)
   assert.ok(Math.abs(h.left.y-h.right.y)<1.5)
  }
 }
})
test('ankle height and toe pitch do not pop at toe-off or the cycle seam',()=>{
 const gait=new GaitPlanner(),hz=2400;let previous:{y:number;pitch:number}[]=[]
 for(let i=0;i<hz*3;i++){
  gait.update(100*i/hz,100,1,100,PLAYER_GAIT.walk,1/hz,true,3,true)
  const feet=[gait.footL,gait.footR]
  if(i>hz)for(let j=0;j<2;j++){
   assert.ok(Math.abs(feet[j].y-previous[j].y)<.05,'toe-off ankle height jumps')
   assert.ok(Math.abs(feet[j].pitch-previous[j].pitch)<.02,'toe pitch jumps')
  }
  previous=feet.map(f=>({y:f.y,pitch:f.pitch}))
 }
})
