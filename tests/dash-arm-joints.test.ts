import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import {FOCUS} from '../src/game/anim/rig3d'
import {PLAYER_SPEC} from '../src/game/anim/skeleton'
import {CH} from '../src/game/anim/pose'
import type {WorldRef} from '../src/game/core/types'

// Rig joints are perspective-projected in x/y, while z is retained. Undo
// projection before checking actual 3D segment lengths.
const dist=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>{
 const unproject=(p:typeof a)=>({x:p.x*(FOCUS-p.z)/FOCUS,y:p.y*(FOCUS-p.z)/FOCUS,z:p.z})
 const x=unproject(a),y=unproject(b)
 return Math.hypot(x.x-y.x,x.y-y.y,x.z-y.z)
}
test('dash arms stay proportionate, flexed and above the floor in every stance',()=>{
 for(const hz of [30,60,120])for(const direction of [-1,1])for(const drawn of [false,true])for(const power of [false,true]){
  const p=new Player(),input=new Input(),noop=()=>{}
  const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
  const step=()=>{w.time+=1/hz;p.update(1/hz,w);input.endFrame(1/hz)}
  p.reset(400);p.swordDrawn=drawn;p.face=direction as -1|1
  for(let i=0;i<hz/2;i++)step()
  if(power){input.setVirtualAxis(direction,0);input.setVirtual('dash',true);for(let i=0;i<Math.ceil(hz*.45);i++)step();input.setVirtual('dash',false);step()}
  else p.startDash(w,direction,0)
  let skimFrames=0,frames=0
  while(p.state==='dash'&&frames++<hz){
   step();const g=p.geom
   for(const [sh,el,hand,ch] of [[g.shoulderL,g.elbL,g.handL,CH.elL],[g.shoulderR,g.elbR,g.handR,CH.elR]] as const){
    assert.ok(Math.abs(dist(sh,el)-PLAYER_SPEC.upperArm)<.001,'upper arm length stays fixed')
    assert.ok(Math.abs(dist(el,hand)-PLAYER_SPEC.foreArm)<.001,'forearm length stays fixed')
    assert.ok(p.pose[ch]<=-.26+1e-5&&p.pose[ch]>=-2.62-1e-5,'elbow stays flexed')
    assert.ok(p.hipY+1.32*hand.y<-7,'hands remain above the ground')
   }
   if(power&&p.state==='dash'&&p.pose[CH.rootRot]>1.2){
    assert.ok(g.handL.x>g.shoulderL.x+10,'front hand leads the low drive')
    assert.ok(Math.hypot(g.handL.x-g.handR.x,g.handL.y-g.handR.y)>4,'hands remain separated')
    skimFrames++
   }
   if(drawn&&p.state==='dash')assert.ok(p.hipY+1.32*g.tip.y<2,'carried sword tip stays above floor')
  }
  if(power)assert.ok(skimFrames>=2)
 }
})
