import {createCanvas} from '@napi-rs/canvas'
import {writeFileSync} from 'node:fs'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import type {WorldRef} from '../src/game/core/types'
const c=createCanvas(1680,1490),ctx=c.getContext('2d')
ctx.fillStyle='#b9c7d2';ctx.fillRect(0,0,c.width,c.height)
ctx.fillStyle='#142234';ctx.font='bold 26px sans-serif';ctx.fillText('ACTUAL PLAYER / GRIP → EXTRACT → TIP CLEAR → TURN → GUARD',24,36)
const p=new Player(),input=new Input(),noop=()=>{}
const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx:new FX(),audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
const step=()=>{w.time+=1/240;p.update(1/240,w);input.endFrame(1/240)}
for(let i=0;i<120;i++)step()
const probe=p as unknown as {startDraw(w:WorldRef):void;drawSocket():{extraction:number}}
probe.startDraw(w)
const times=[0,.025,.05,.075,.10,.125,.15,.175,.19,.215,.245,.30]
let tick=0
for(let i=0;i<times.length;i++){
 while(tick<Math.round(times[i]*240)){step();tick++}
 const x=210+(i%4)*420,y=70+Math.floor(i/4)*465
 ctx.save();ctx.translate(x-p.x*2.7,y+375);ctx.scale(2.7,2.7)
 p.draw(ctx as unknown as CanvasRenderingContext2D,w.time)
 ctx.restore();ctx.fillStyle='#142234';ctx.font='20px sans-serif';ctx.fillText(`${Math.round(times[i]*1000)} ms / ${Math.round((times[i]>=.3?1:probe.drawSocket().extraction)*100)}% steel`,x-130,y+415)
}
writeFileSync('research/draw-micro-detail.png',c.toBuffer('image/png'))
