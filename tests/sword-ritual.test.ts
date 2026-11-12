import test from 'node:test'
import assert from 'node:assert/strict'
import {DRAW_CLIP,SHEATHE_CLIP} from '../src/game/anim/clips'
import {sampleClip} from '../src/game/anim/animator'
import {drawDetail,sheatheDetail,DRAW_CLEAR,SHEATHE_MEET,SHEATHE_SEAT} from '../src/game/anim/draw-detail'
import {CH,makePose} from '../src/game/anim/pose'

test('draw and noto provide at least six core poses plus breakdown drawings',()=>{
 assert.ok(DRAW_CLIP.frames.length>=12,`${DRAW_CLIP.frames.length} draw frames`)
 assert.ok(SHEATHE_CLIP.frames.length>=11,`${SHEATHE_CLIP.frames.length} noto frames`)
 for(const clip of [DRAW_CLIP,SHEATHE_CLIP]){
  for(let i=1;i<clip.frames.length;i++)assert.ok(clip.frames[i].t>clip.frames[i-1].t)
 }
})

test('draw progressively extracts before the equipment gate instead of popping',()=>{
 let previous=0
 for(let i=0;i<=24;i++){
  const d=drawDetail(DRAW_CLEAR*i/24)
  assert.ok(d.extraction>=previous-1e-8)
  previous=d.extraction
 }
 assert.ok(drawDetail(DRAW_CLEAR*.65).extraction>0)
 assert.ok(drawDetail(DRAW_CLEAR*.65).extraction<1)
 assert.equal(drawDetail(DRAW_CLEAR).extraction,1)
})

test('noto aligns first, then continuously inserts, then seats',()=>{
 assert.equal(sheatheDetail(SHEATHE_MEET-.01).insertion,0)
 let previous=0
 for(let i=0;i<=30;i++){
  const t=SHEATHE_MEET+(SHEATHE_SEAT-SHEATHE_MEET)*i/30
  const d=sheatheDetail(t)
  assert.ok(d.insertion>=previous-1e-8)
  assert.ok(d.visible>=0&&d.visible<=1)
  previous=d.insertion
 }
 assert.equal(sheatheDetail(SHEATHE_SEAT).insertion,1)
})

test('ritual breakdowns preserve planted legs and finite anatomical channels',()=>{
 for(const clip of [DRAW_CLIP,SHEATHE_CLIP]){
  for(let i=0;i<=120;i++){
   const p=sampleClip(clip,clip.dur*i/120,makePose())
   for(const value of p)assert.ok(Number.isFinite(value))
   assert.ok(p[CH.kneeR]<=.05&&p[CH.kneeL]<=.05)
   assert.ok(Math.abs(p[CH.rootY])<12)
  }
 }
})
