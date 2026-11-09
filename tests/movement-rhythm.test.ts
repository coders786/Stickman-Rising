import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Animator,sampleClip } from '../src/game/anim/animator'
import { WALK_CLIP,RUN_CLIP,SPRINT_CLIP,DASH_LAUNCH_CLIP } from '../src/game/anim/clips'
import { GaitPlanner,PLAYER_GAIT } from '../src/game/anim/legik'
import { CH,makePose } from '../src/game/anim/pose'
import { applyJointLimits } from '../src/game/anim/limits'
import { DASH_VARIANTS } from '../src/game/combat/dash'
import {DashBody} from '../src/game/physics/dash-body'

test('one gait clock locks upper body to both footfalls at 30/60/120 Hz',()=>{
  for(const hz of [30,60,120])for(const [name,speed,clip] of [
    ['walk',105,WALK_CLIP],['run',350,RUN_CLIP],['sprint',480,SPRINT_CLIP],
  ] as const){
    const gait=new GaitPlanner(),anim=new Animator(),tune=PLAYER_GAIT[name]
    anim.play(clip,{blend:0,speed:1})
    for(let i=0;i<hz*4;i++){
      gait.update(speed*i/hz,speed,1,speed,tune,1/hz,true,3,true)
      anim.update(1/hz,gait.phase)
      assert.ok(Math.abs(anim.getTime()/clip.dur-gait.phase)<1e-8)
    }
    const stepsPerSecond=2*speed/tune.stride
    assert.ok(Math.abs(gait.footfalls/4-stepsPerSecond)<.55,`${name} footfall frequency`)
    if(name==='walk')assert.ok(stepsPerSecond<2.5)
    if(name==='run')assert.ok(stepsPerSecond>3 && stepsPerSecond<4.2)
    if(name==='sprint')assert.ok(stepsPerSecond>4 && stepsPerSecond<5)
  }
})
test('dash acceleration has a visible load, burst and slower catch',()=>{
  const cfg=DASH_VARIANTS.launch,a=cfg.anticipation!
  assert.ok(cfg.dur>=.29&&cfg.dur<=.32,'longer visible acting with a separate fast motor')
  assert.ok(cfg.dur*a>=.04&&cfg.dur*a<=.055,'readable 40–55 ms planted load')
  const body=new DashBody(cfg,0,0,1,0,true)
  body.step(cfg.dur*a,true);assert.ok(body.vx<1,'load has no instant burst')
  while(body.progress<.67)body.step(1/480,true)
  const peak=body.vx;assert.ok(peak>700)
  while(body.progress<1)body.step(1/480,true)
  assert.ok(body.vx<peak-150,'ground catch dissipates speed, without a hard exit cut')
  for(const variant of Object.values(DASH_VARIANTS)){
    const animator=new Animator()
    animator.play(variant.clip,{blend:0,speed:variant.clip.dur/variant.dur})
    animator.update(variant.dur)
    assert.ok(animator.progress()>.999,'all variants must reach their authored recovery')
  }
})
test('dash uses a temporary supported diagonal, not a running waist fold',()=>{
  const dash=sampleClip(DASH_LAUNCH_CLIP,.060,makePose())
  const sprint=sampleClip(SPRINT_CLIP,0,makePose())
  assert.ok(dash[CH.rootRot]>=.83 && dash[CH.rootRot]<=.85)
  assert.ok(dash[CH.spine]<.05)
  assert.ok(Math.abs(dash[CH.rootRot]+dash[CH.spine]+dash[CH.head])<.15)
  assert.ok(sprint[CH.rootRot]>.30 && sprint[CH.rootRot]<.52)
  assert.ok(dash[CH.rootRot]-sprint[CH.rootRot]>.25)
  for(let i=0;i<=120;i++){
    const p=sampleClip(DASH_LAUNCH_CLIP,DASH_LAUNCH_CLIP.dur*i/120,makePose())
    const limited=applyJointLimits(p.slice())
    for(let ch=0;ch<p.length;ch++)assert.ok(Math.abs(p[ch]-limited[ch])<1e-5,`dash channel ${ch}`)
    assert.ok(Math.abs(p[CH.armLz])<.1 && Math.abs(p[CH.armRz])<.1)
    assert.ok(p[CH.elL]<-.7 && p[CH.elR]<-.7,'both arms stay actively bent')
  }
})

test('weapon carry inertia cannot bend the locomotion or dash spine',async()=>{
  const {Player}=await import('../src/game/entities/player')
  const player=new Player()
  const probe=player as unknown as {
    state: string; pose: Float32Array; chainLag: number; chainLagVel: number;
    updateBladeDynamics(dt:number,w:{timeScale:number}):void
  }
  for(const state of ['move','dash']){
    probe.state=state;probe.chainLag=.15;probe.chainLagVel=1
    probe.pose.set(makePose({rootRot:.2,spine:.025,shR:.25,elR:-1.2,wrR:5}))
    const rot=probe.pose[CH.rootRot],spine=probe.pose[CH.spine]
    probe.updateBladeDynamics(1/60,{timeScale:1})
    assert.equal(probe.pose[CH.rootRot],rot)
    assert.equal(probe.pose[CH.spine],spine)
  }
})

test('dash afterimages render ronin surfaces instead of the removed capsule rig',async()=>{
  const {FX}=await import('../src/game/fx/fx')
  const {createCanvas}=await import('@napi-rs/canvas')
  const canvas=createCanvas(320,320),ctx=canvas.getContext('2d'),fx=new FX()
  let circles=0
  const arc=ctx.arc.bind(ctx)
  ctx.arc=(...args:Parameters<typeof ctx.arc>)=>{circles++;arc(...args)}
  const pose=sampleClip(DASH_LAUNCH_CLIP,.060,makePose())
  fx.shadowGhost(pose,140,150,1,1,'#67c3de',.3,2,.3)
  fx.drawSilhouettes(ctx as unknown as CanvasRenderingContext2D)
  assert.equal(circles,0,'old circular joint discs / round head must not return in dash trails')
  assert.equal(ctx.globalAlpha,1)
  assert.equal(ctx.globalCompositeOperation,'source-over')
  assert.ok(canvas.toBuffer('image/png').byteLength>1000)
})
