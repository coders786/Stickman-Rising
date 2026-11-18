import test from 'node:test'
import assert from 'node:assert/strict'
import { Camera, PLAY_ZOOM } from '../src/game/core/camera'
import { WaveDirector } from '../src/game/world/waves'

for(const [width,height] of [[750,704],[1000,520],[640,360]]) {
 test(`a grounded run keeps the same road through wave 2 (${width}×${height})`,()=>{
  const cam=new Camera();cam.setViewport(width,height);cam.startOnRoad(1300)
  const road=()=>height/2-cam.y*cam.zoom, initial=road()
  const waves=new WaveDirector({onWaveStart(){cam.addTrauma(.2)},onWaveClear(){},spawnEnemy(){},getPlayerX:()=>1300})
  for(let i=0;i<720;i++){
   waves.update(1/60,0);cam.focus(1300,0,0,0);cam.setZoom(PLAY_ZOOM);cam.update(1/60)
   assert.ok(Math.abs(road()-initial)<.01,`road moved at step ${i}`)
  }
  assert.ok(waves.wave>=2)
 })
}

test('a high jump stays in view, and neither its apex nor a cinematic leaks into a new run',()=>{
 const c=new Camera();c.setViewport(750,704);c.startOnRoad(1300);const ground=c.y
 for(let i=0;i<60;i++){c.focus(1300,-290,0,0);c.update(1/60)}
 assert.ok(c.y<ground-60);for(let i=0;i<150;i++){c.focus(1300,0,0,0);c.update(1/60)}
 assert.ok(Math.abs(c.y-ground)<.01)
 c.addTrauma(1);c.zoomPulse(.3);c.update(1/60);c.startOnRoad(1300)
 assert.deepEqual([c.y,c.zoom,c.offX,c.offY,c.rot],[ground,PLAY_ZOOM,0,0,0])
})
