import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {Player} from '../src/game/entities/player'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
const c=createCanvas(1900,1000),ctx=c.getContext('2d');ctx.fillStyle='#c6d0d9';ctx.fillRect(0,0,1900,1000)
ctx.fillStyle='#142234';ctx.font='bold 25px sans-serif';ctx.fillText('ATHLETIC NULL-BLACK FIGHTER / ACTUAL WALK + CONTACT IK',25,36)
const records:{drawn:boolean;hip:number;feet:number[]}[]=[]
for(let row=0;row<2;row++){
 const p=new Player(),noop=()=>{}
 const w={time:0,timeScale:1,arenaMinX:-50000,arenaMaxX:50000,enemies:[],fx:new FX(),audio:{play:noop},cam:{addTrauma:noop},input:{axisX:()=>.28,axisY:()=>0,pressed:()=>false,down:()=>false,buffered:()=>false,takeBuffered:()=>false,pressStamp:()=>-1}} as unknown as WorldRef
 p.reset(400);p.swordDrawn=row===1
 const step=()=>{w.time+=1/120;p.update(1/120,w)}
 for(let i=0;i<240;i++)step()
 for(let col=0;col<6;col++){
  for(let i=0;i<18;i++)step()
  const x=160+col*310,y=435+row*470
  ctx.save();ctx.translate(x-p.x*2.7,y);ctx.scale(2.7,2.7);p.draw(ctx as unknown as CanvasRenderingContext2D,w.time);ctx.restore()
  ctx.fillStyle='#142234';ctx.font='17px sans-serif';ctx.fillText(`${row?'DRAWN':'FREE'} / ${Math.round(p.vx)} px/s`,x-100,y+27)
  records.push({drawn:row===1,hip:p.hipY+1.32*p.geom.hip.y,feet:[p.hipY+1.32*p.geom.ankleL.y,p.hipY+1.32*p.geom.ankleR.y]})
 }
}
const prefix=process.argv[2]??'athlete-walk'
writeFileSync(`research/${prefix}.png`,c.toBuffer('image/png'))
writeFileSync(`research/${prefix}-poses.json`,JSON.stringify(records,null,2))
