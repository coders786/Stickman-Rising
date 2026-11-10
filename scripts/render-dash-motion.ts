/** Offline animation review using the game's real rig and input/controller.
 * Run: node --import tsx scripts/render-dash-motion.ts [output-directory] [--fps=30|60]
 * Writes real-time animated GIFs, sampled contact sheets and pose telemetry.
 * GIFs center the player to make the body readable; motion/physics are real.
 */
import {createCanvas,loadImage} from '@napi-rs/canvas'
import sharp from 'sharp'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {Player} from '../src/game/entities/player'
import {Input} from '../src/game/core/input'
import {FX} from '../src/game/fx/fx'
import {CH} from '../src/game/anim/pose'
import type {WorldRef} from '../src/game/core/types'

const args=process.argv.slice(2),dir=args.find(arg=>!arg.startsWith('--'))
const fpsArg=args.find(arg=>arg.startsWith('--fps='))
const fps=Number(fpsArg?.slice(6)??30),bones=args.includes('--bones'),armed=args.includes('--armed')
if(fps!==30&&fps!==60)throw new Error('Use --fps=30 or --fps=60')
const output=resolve(dir??`.cache/dash-motion-${fps}`)
const width=420,height=250,dt=1/60,renderEvery=60/fps
mkdirSync(output,{recursive:true})
async function render(power:boolean){
 const p=new Player(),input=new Input(),noop=()=>{},fx=new FX()
 const w={time:0,timeScale:1,arenaMinX:-5000,arenaMaxX:5000,enemies:[],input,fx,audio:{play:noop},cam:{addTrauma:noop}} as unknown as WorldRef
 p.reset(400);p.swordDrawn=armed
 const step=()=>{w.time+=dt;p.update(dt,w);input.endFrame(dt);fx.update(dt)}
 for(let i=0;i<50;i++)step()
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d')
 const frames:Buffer[]=[],poses:{time:number,state:string;pitch:number;hip:number;feet:number[];velocity:number}[]=[]
 const ticks=power?84:54
 for(let i=0;i<ticks;i++){
  if(i===6){input.setVirtual('dash',true);if(!power)input.setVirtual('dash',false)}
  if(power&&i===30)input.setVirtual('dash',false)
  step()
  if((i+1)%renderEvery!==0)continue
  ctx.fillStyle='#dce4eb';ctx.fillRect(0,0,width,height)
  ctx.strokeStyle='#8798a5';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,210);ctx.lineTo(width,210);ctx.stroke()
  ctx.save();ctx.translate(width*.5-p.x*1.4,210);ctx.scale(1.4,1.4)
  p.draw(ctx as unknown as CanvasRenderingContext2D,w.time)
  if(bones){
   ctx.save();ctx.translate(p.x,p.hipY);ctx.scale(p.face*1.32,1.32)
   for(const [color,sh,el,wr] of [
    ['#24d6ed',p.geom.shoulderL,p.geom.elbL,p.geom.handL],
    ['#ffac30',p.geom.shoulderR,p.geom.elbR,p.geom.handR],
   ] as const){
    ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=.8
    ctx.beginPath();ctx.moveTo(sh.x,sh.y);ctx.lineTo(el.x,el.y);ctx.lineTo(wr.x,wr.y);ctx.stroke()
    for(const joint of [sh,el,wr]){ctx.beginPath();ctx.arc(joint.x,joint.y,1.35,0,Math.PI*2);ctx.fill()}
   }
   ctx.restore()
  }
  ctx.restore()
  ctx.fillStyle='#213547';ctx.font='14px sans-serif'
  ctx.fillText(`${power?'POWER':'STANDARD'}   ${((i+1)*dt).toFixed(2)}s   ${p.state}   ${fps} fps`,12,22)
  ctx.fillText(`pitch ${(p.pose[CH.rootRot]*180/Math.PI).toFixed(0)}°`,12,42)
  const raw=await sharp(canvas.toBuffer('image/png')).ensureAlpha().raw().toBuffer()
  frames.push(raw)
  poses.push({time:(i+1)*dt,state:p.state,pitch:p.pose[CH.rootRot],hip:p.hipY+1.32*p.geom.hip.y,
   feet:[p.hipY+1.32*p.geom.toeL.y,p.hipY+1.32*p.geom.toeR.y],velocity:p.vx})
 }
 const name=power?'power':'standard',pixels=Buffer.concat(frames)
 await sharp(pixels,{raw:{width,height:height*frames.length,channels:4,pageHeight:height}})
  .gif({delay:frames.map((_,i)=>10*(Math.round((i+1)*100/fps)-Math.round(i*100/fps))),loop:0,effort:4}).toFile(join(output,`${name}.gif`))
 // A contact sheet complements playback, making catch and transition poses
 // inspectable without requiring an external graphical editor.
 const cols=4,count=12,rows=Math.ceil(count/cols),sheet=createCanvas(width*cols,height*rows),sc=sheet.getContext('2d')
 for(let i=0;i<count;i++){
  const index=Math.round(i*(frames.length-1)/(count-1))
  const png=await sharp(frames[index],{raw:{width,height,channels:4}}).png().toBuffer()
  sc.drawImage(await loadImage(png),(i%cols)*width,Math.floor(i/cols)*height)
 }
 writeFileSync(join(output,`${name}-sheet.png`),sheet.toBuffer('image/png'))
 writeFileSync(join(output,`${name}-poses.json`),JSON.stringify(poses,null,2))
 console.log(`${name}: ${frames.length} frames at ${fps} fps -> ${output}`)
}
async function main(){await render(false);await render(true)}
main().catch(e=>{console.error(e);process.exitCode=1})
