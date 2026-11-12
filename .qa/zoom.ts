/** Render a narrow t-slice of a clip at high scale, for reading a single beat. */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { MOVES } from '../src/game/combat/moveset'
import { sampleClip } from '../src/game/anim/animator'
import { solveFighter3D, makeFighterGeom, drawFighter3D } from '../src/game/anim/rig3d'
import { makePose } from '../src/game/anim/pose'
import { PLAYER_SPEC, PLAYER_STYLE } from '../src/game/anim/skeleton'
import { handGestures } from '../src/game/anim/hand-gestures'
const [id, t0s, t1s, ns, scs] = process.argv.slice(2)
const t0=Number(t0s), t1=Number(t1s), N=Number(ns??6), S=Number(scs??5)
const clip=MOVES[id].clip!, geom=makeFighterGeom()
const CW=Math.round(110*S), CHh=Math.round(150*S), PAD=14
const cv=createCanvas(CW*N+PAD*2, CHh+PAD*2)
const c=cv.getContext('2d') as unknown as CanvasRenderingContext2D
c.fillStyle='#e9eef2'; c.fillRect(0,0,cv.width,cv.height)
for(let i=0;i<N;i++){
  const t=t0+(i/(N-1))*(t1-t0)
  const p=makePose(); sampleClip(clip,t,p)
  solveFighter3D(p,PLAYER_SPEC,geom,PLAYER_SPEC.blade*1.06,1)
  c.save(); c.translate(PAD+i*CW+CW/2, PAD+CHh*0.55); c.scale(S,S)
  drawFighter3D(c as any, geom, PLAYER_STYLE, { hands: handGestures('unarmed', t/clip.dur, false) } as any)
  c.restore()
  c.fillStyle='#234'; c.font='12px monospace'; c.fillText(t.toFixed(3), PAD+i*CW+4, PAD+CHh+12)
}
writeFileSync(`research/zoom-${id}.png`, cv.toBuffer('image/png'))
console.log('wrote', `research/zoom-${id}.png`)
