import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SprintExposure,SPRINT_POSE_HZ} from '../src/game/anim/sprint-exposure'
import {makePose,CH} from '../src/game/anim/pose'
import {Animator} from '../src/game/anim/animator'
import {SPRINT_CLIP,IDLE_CLIP} from '../src/game/anim/clips'
import {ContextMotion,DEFAULT_CONTEXT} from '../src/game/anim/context-motion'
import {runningHandMotion,sprintHandArc} from '../src/game/anim/hand-kinematics'
const hands={leftOpen:.3,rightOpen:0,leftRoll:.05,rightRoll:0}
test('sprint exposure is exactly 10 Hz at 30/60/120 render updates per second',()=>{
 assert.equal(SPRINT_POSE_HZ,10)
 for(const hz of [30,60,120]){
  const e=new SprintExposure();let changes=0,last=-1
  for(let i=0;i<=hz;i++){
   const p=makePose({shL:i*.001,rootX:i,hipR:i*.002})
   e.apply(p,{...hands,leftOpen:i/hz},i/hz,1/hz,true)
   if(e.frame!==last){if(last>=0)changes++;last=e.frame}
   assert.equal(p[CH.rootX],i,'world/root translation is NOT exposed')
   assert.ok(Math.abs(p[CH.hipR]-i*.002)<1e-6,'gait/contact channels remain continuous')
   assert.ok(Math.abs(p[CH.shL]-e.frame*.1*hz*.001)<1e-6)
   assert.ok(Math.abs(e.hands.leftOpen-e.frame*.1)<1e-6)
  }
  assert.equal(changes,10,`${hz} Hz`)
 }
})
test('sprint holds interrupt immediately for dash, attack, landing or stop',()=>{
 const e=new SprintExposure(),p=makePose({shL:.9})
 e.apply(p,hands,.2,1/60,true)
 p[CH.shL]=-.4;e.apply(p,hands,.3,1/60,false)
 assert.ok(Math.abs(p[CH.shL]+.4)<1e-6);assert.equal(e.active,false)
 e.apply(p,hands,.4,1/60,true);assert.equal(e.frame,0);assert.ok(Math.abs(p[CH.shL]+.4)<1e-6)
})
test('new sprint arm silhouettes stay reachable, periodic and naturally opposed',()=>{
 let covariance=0
 for(let i=0;i<1000;i++){
  const a=sprintHandArc(i/1000),b=sprintHandArc(i/1000+.5)
  assert.ok(Math.hypot(a.x,a.y)<36);assert.ok(a.y>=16.999&&a.y<=30.001)
  covariance+=a.x*b.x/1000
 }
 assert.ok(covariance<-50)
 const a=sprintHandArc(-1e-5),b=sprintHandArc(1e-5)
 assert.ok(Math.abs(a.x-b.x)<.01&&Math.abs(a.y-b.y)<.01)
})
test('transition blends begin at the visible held pose, not an unseen arm position',()=>{
 const a=new Animator();a.play(SPRINT_CLIP,{blend:0});a.update(.1)
 const p=makePose({shL:-.4,elL:-1.2});a.adoptDisplayPose(p,[CH.shL,CH.elL])
 a.play(IDLE_CLIP,{blend:.15});a.update(.001)
 assert.ok(Math.abs(a.pose[CH.shL]+.4)<.001)
 assert.ok(Math.abs(a.pose[CH.elL]+1.2)<.001)
})

test('the unarmed near arm reaches its front rib-height pose instead of sticking to the weapon carry',()=>{
 const m=new ContextMotion(),c={...DEFAULT_CONTEXT,clip:'sprint',speed:480,forward:480,phase:.5}
 let p=makePose()
 for(let i=0;i<120;i++){p=sampleAtHalf();m.apply(p,c,1/120)}
 const x=20*Math.sin(p[CH.shR])+18*Math.sin(p[CH.shR]+p[CH.elR])
 const y=20*Math.cos(p[CH.shR])+18*Math.cos(p[CH.shR]+p[CH.elR])
 assert.ok(x>12&&y<21,`near wrist still trapped at hip: ${x}, ${y}`)
 function sampleAtHalf(){const a=new Animator();a.play(SPRINT_CLIP,{blend:0});a.update(0,.5);return a.pose.slice()}
})

test('composed sprint key hands match their phase, without double-filter quarter-stride lag',()=>{
 const m=new ContextMotion()
 for(let i=0;i<100;i++){
  const phase=i/100,c={...DEFAULT_CONTEXT,clip:'sprint',speed:480,forward:480,phase}
  const p=makePose();m.composeSprintArms(p,c)
  const h=runningHandMotion(phase,480)
  for(const [sh,el,hand] of [[CH.shL,CH.elL,h.left],[CH.shR,CH.elR,h.right]] as const){
   const x=20*Math.sin(p[sh])+18*Math.sin(p[sh]+p[el])
   const y=20*Math.cos(p[sh])+18*Math.cos(p[sh]+p[el])
   assert.ok(Math.abs(x-hand.x)<1e-4&&Math.abs(y-hand.y)<1e-4)
  }
  const armed=makePose();const sh=armed[CH.shR],el=armed[CH.elR]
  m.composeSprintArms(armed,{...c,swordDrawn:true})
  assert.equal(armed[CH.shR],sh);assert.equal(armed[CH.elR],el)
 }
})
