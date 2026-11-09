import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
const c=createCanvas(1920,940),ctx=c.getContext('2d');ctx.fillStyle='#c6d0d9';ctx.fillRect(0,0,1920,940);ctx.fillStyle='#142234';ctx.font='bold 24px sans-serif';ctx.fillText('HOLD + RELEASE / LOAD → PUSH OFF → HORIZONTAL FLIGHT → LAND',20,35)
const p=new Player(),input=new Input(),noop=()=>{},w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
const step=()=>{w.time+=1/240;p.update(1/240,w);input.endFrame(1/240)};p.reset(400);for(let i=0;i<120;i++)step();input.setVirtual('dash',true)
const times=[0,.1,.3,.55,.6,.65,.7,.75,.8,.9,1,1.2];const records:{t:number;pitch:number;hip:number;y:number;feet:number[];openAngle:number}[]=[];let tick=0
for(let i=0;i<times.length;i++){
 while(tick<Math.round(times[i]*240)){if(tick===144)input.setVirtual('dash',false);step();tick++}
 const x=160+i%6*320,y=420+Math.floor(i/6)*450
 ctx.strokeStyle='#8d9ba8';ctx.beginPath();ctx.moveTo(x-150,y);ctx.lineTo(x+150,y);ctx.stroke()
 ctx.save();ctx.translate(x-p.x*2.3,y);ctx.scale(2.3,2.3);p.draw(ctx as unknown as CanvasRenderingContext2D,w.time);ctx.restore()
 ctx.fillStyle='#142234';ctx.font='17px sans-serif';ctx.fillText(`${Math.round(times[i]*1000)}ms / ${(p.pose[2]*180/Math.PI).toFixed(0)}°`,x-75,y+25)
 const g=p.geom,rear=g.ankleL.x<g.ankleR.x?g.ankleL:g.ankleR
 const ax=g.chest.x-g.hip.x,ay=g.chest.y-g.hip.y,bx=rear.x-g.hip.x,by=rear.y-g.hip.y
 const openAngle=Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(Math.hypot(ax,ay)*Math.hypot(bx,by)))))*180/Math.PI
 records.push({t:times[i],pitch:p.pose[2],hip:p.hipY,y:p.y,openAngle,feet:[p.hipY+1.32*p.geom.toeL.y,p.hipY+1.32*p.geom.toeR.y]})
}
writeFileSync('research/release-leap-dash.png',c.toBuffer('image/png'));writeFileSync('research/release-leap-dash-poses.json',JSON.stringify(records,null,2));console.log(records)
