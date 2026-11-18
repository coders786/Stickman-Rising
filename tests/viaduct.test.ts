import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { ROAD, floorTOI, bodySide } from '../src/game/stage/road-section'
import { Viaduct } from '../src/game/stage/viaduct'
import { moodForSeed } from '../src/game/world/mood'
import { Player } from '../src/game/entities/player'
import { Enemy } from '../src/game/entities/enemy'
import { Input } from '../src/game/core/input'
import { FX } from '../src/game/fx/fx'
import type { WorldRef } from '../src/game/core/types'

test('a fast sweep lands on the rail, not the rear curb or the far side of a body', () => {
  assert.ok(ROAD.rear < ROAD.lane && ROAD.front > ROAD.lane)
  assert.equal(floorTOI(-12, 36), 0.25)
  assert.equal(floorTOI(0, -1), Infinity)
  assert.equal(bodySide(-70, 75, 0, 0, 0, 0, 30, 88), -30)
  assert.equal(bodySide(-70, 75, -120, -120, 0, 0, 30, 88), null)
})
test('each landed idle frame has a support sole on the lane; launches land once, on the crossing step', () => {
  const p = new Player(),
    input = new Input(),
    fx = new FX(),
    sounds: string[] = []
  const w = {
    time: 0,
    timeScale: 1,
    input,
    fx,
    arenaMinX: -500,
    arenaMaxX: 2000,
    enemies: [],
    audio: { play: (s: string) => sounds.push(s) },
    cam: { addTrauma: () => {} },
  } as unknown as WorldRef
  p.reset(100)
  for (let i = 0; i < 100; i++) {
    w.time += 1 / 60
    p.update(1 / 60, w)
    input.endFrame(1 / 60)
    const sole =
      p.hipY + (Math.max(p.geom.ankleL.y, p.geom.ankleR.y) + 3.4) * p.scale
    assert.ok(
      p.grounded && Math.abs(sole - ROAD.lane) < 1,
      `frame ${i}: support ${sole}`,
    )
  }
  const e = new Enemy('grunt', 400, 1)
  e.spawning = false
  e.state = 'launched'
  e.launched = true
  e.y = -12
  e.vy = 1100
  e.update(1 / 60, w)
  assert.equal(e.state, 'down')
  assert.equal(e.y, ROAD.lane)
  assert.equal(e.vy, 0)
  e.update(1 / 60, w)
  assert.equal(sounds.filter((s) => s === 'land').length, 1)
})
test('the lower district is opaque at every pixel below the skyline, even at tile joins and on tall views', () => {
  const make = (w: number, h: number) => {
    const c = createCanvas(w, h)
    return { c, g: c.getContext('2d') } as never
  }
  const render = (seed: number) => {
    const v = new Viaduct(seed, 0, 800, moodForSeed(seed), make),
      c = createCanvas(1100, 770),
      g = c.getContext('2d')
    v.drawDistrict(g as never, 1100, 770, 1023, 75)
    return g.getImageData(0, 75, 1100, 695).data
  }
  const a = render(2)
  for (let i = 3; i < a.length; i += 4) assert.equal(a[i], 255)
  assert.deepEqual(a, render(2))
  assert.notDeepEqual(a.slice(0, 1000), render(13).slice(0, 1000))
})

test('a tall camera never reintroduces rooftop fog at the lower-city texture join',()=>{
 const make=(w:number,h:number)=>{const c=createCanvas(w,h);return {c,g:c.getContext('2d')} as never}
 const v=new Viaduct(2,0,800,moodForSeed(2),make),g=createCanvas(1024,680).getContext('2d')
 v.drawDistrict(g as never,1024,680,0,42)
 // Robust to individual lit windows: a full-width shift in the blue channel
 // between strips means the atmospheric gradient restarted below the piers.
 function blue(y:number){const a=g.getImageData(0,y,1024,8).data;let sum=0;for(let i=2;i<a.length;i+=4)sum+=a[i];return sum/(1024*8)}
 assert.ok(Math.abs(blue(312)-blue(320))<2)
})
