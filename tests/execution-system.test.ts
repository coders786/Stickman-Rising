import test from 'node:test'
import assert from 'node:assert/strict'
import {crossedExecutionCuts,executionRoot,executionTimeline} from '../src/game/combat/execution'

test('execution has ten hierarchical cuts, acceleration, brake, and delayed separation',()=>{
  const t=executionTimeline('katana',.17)
  assert.equal(t.cuts.length,10)
  const gaps=t.cuts.slice(1).map((v,i)=>v-t.cuts[i])
  // Four consecutive accelerating links, then a deliberately larger final load.
  assert.ok(gaps[3]>gaps[4]&&gaps[4]>gaps[5]&&gaps[5]>gaps[6]&&gaps[6]>gaps[7])
  assert.ok(gaps[8]>gaps[7]*2)
  assert.ok(t.separateAt-t.finalCut>=.219)
  assert.ok(t.releaseAt>t.separateAt)
})

test('weapon mass changes cadence without changing authored cut count',()=>{
  const short=executionTimeline('short',.12)
  const katana=executionTimeline('katana',.12)
  const great=executionTimeline('greatblade',.12)
  assert.equal(short.cuts.length,great.cuts.length)
  assert.ok(short.finalCut<katana.finalCut)
  assert.ok(katana.finalCut<great.finalCut)
})

test('dropped frames never delete execution cuts',()=>{
  const timeline=executionTimeline('katana',.17)
  for(const fps of [120,60,30,20,12]){
    let step=0
    for(let time=0;time<=timeline.finalCut+.2;time+=1/fps){
      const crossed=crossedExecutionCuts(step,time,timeline)
      if(crossed.length)step=crossed[crossed.length-1]+1
    }
    assert.equal(step,10,`${fps} fps`)
  }
})

test('root stage remains bounded and crosses readable sides without teleporting',()=>{
  const timeline=executionTimeline('katana',.17)
  let previous=executionRoot(0,timeline,500,1)
  let min=previous,max=previous
  for(let i=1;i<=240;i++){
    const x=executionRoot(timeline.finalCut*i/240,timeline,500,1)
    assert.ok(Math.abs(x-previous)<4)
    min=Math.min(min,x);max=Math.max(max,x);previous=x
  }
  assert.ok(min<500&&max>500,'player must visibly pass to the opposite side')
  assert.ok(max-min>90)
  assert.ok(max-min<130)
})
