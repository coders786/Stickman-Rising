/** Same punch pose at a sweep of armRz yaw values, close-up, so the
 * near-end-larger rule is judged by eye as well as by number. */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { makePose, CH } from '../src/game/anim/pose'
import { solveFighter3D, makeFighterGeom, drawFighter3D } from '../src/game/anim/rig3d'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
const YAWS=[-1.2,-0.8,-0.4,0,0.4,0.8,1.2,1.5]
const S=3.2, CW=Math.round(120*S), CHh=Math.round(150*S), PAD=22
const cv=createCanvas(CW*YAWS.length+PAD*2, CHh+PAD*2)
const c=cv.getContext('2d') as unknown as CanvasRenderingContext2D
c.fillStyle='#e9eef2'; c.fillRect(0,0,cv.width,cv.height)
const geom=makeFighterGeom()
YAWS.forEach((yaw,i)=>{
  const p=makePose(); p[CH.shR]=1.55; p[CH.elR]=-0.15; p[CH.armRz]=yaw
  solveFighter3D(p,PLAYER_SPEC,geom,PLAYER_SPEC.blade*1.06,1)
  const cx=PAD+i*CW+CW/2, cy=PAD+CHh*0.55
  c.save(); c.translate(cx,cy); c.scale(S,S)
  drawFighter3D(c as any, geom, PLAYER_STYLE, { hands:{leftOpen:.2,rightOpen:0,leftRoll:0,rightRoll:0} } as any)
  c.restore()
  c.fillStyle='#234'; c.font='13px monospace'
  c.fillText(`yaw ${yaw}`, PAD+i*CW+4, PAD+CHh+14)
})
writeFileSync('research/hand-depth-sweep.png', cv.toBuffer('image/png'))
console.log('wrote research/hand-depth-sweep.png')
