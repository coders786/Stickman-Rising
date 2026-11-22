import test from 'node:test'
import assert from 'node:assert/strict'
import { Camera, PLAY_ZOOM } from '../src/game/core/camera'
import { WaveDirector, WAVE_SPAWN_SEARCH_LIMIT } from '../src/game/world/waves'

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

test('procedural waves replay from a run seed and cap both queue size and placement retries', () => {
  const collect = (seed: number) => {
    const spawned: [string, number, number][] = []
    const waves = new WaveDirector({
      onWaveStart() {}, onWaveClear() {}, getPlayerX: () => 1300,
      spawnEnemy: (kind, x, scale) => spawned.push([kind, x, scale]),
    })
    waves.reset(seed)
    waves.update(2.2, 0)
    assert.ok(waves.enemiesRemaining <= 30)
    waves.update(10, 0)
    return spawned
  }
  assert.ok(WAVE_SPAWN_SEARCH_LIMIT <= 8)
  assert.deepEqual(collect(42), collect(42))
  assert.notDeepEqual(collect(42), collect(43))

  const huge = new WaveDirector({ onWaveStart() {}, onWaveClear() {}, spawnEnemy() {}, getPlayerX: () => 1300 })
  huge.wave = 10_000
  ;(huge as unknown as { phaseT: number }).phaseT = 0
  huge.update(0, 0)
  assert.ok(huge.enemiesRemaining <= 30, 'an extreme procedural wave must not build an unbounded spawn queue')
})

test('eight unlucky wave samples fall back outside the player safety buffer', () => {
  const xs: number[] = []
  const waves = new WaveDirector({ onWaveStart() {}, onWaveClear() {}, getPlayerX: () => 1270,
    spawnEnemy: (_kind, x) => xs.push(x) })
  ;(waves as unknown as { random: () => number }).random = () => .5
  waves.reset(42)
  waves.update(2.2, 0)
  waves.update(10, 0)
  assert.ok(xs.length > 0)
  assert.ok(xs.every(x => Math.abs(x - 1270) >= 240), 'no exhausted retry can spawn on the player')
})

test('a high jump stays in view, and neither its apex nor a cinematic leaks into a new run',()=>{
 const c=new Camera();c.setViewport(750,704);c.startOnRoad(1300);const ground=c.y
 for(let i=0;i<60;i++){c.focus(1300,-290,0,0);c.update(1/60)}
 assert.ok(c.y<ground-60);for(let i=0;i<150;i++){c.focus(1300,0,0,0);c.update(1/60)}
 assert.ok(Math.abs(c.y-ground)<.01)
 c.addTrauma(1);c.zoomPulse(.3);c.update(1/60);c.startOnRoad(1300)
 assert.deepEqual([c.y,c.zoom,c.offX,c.offY,c.rot],[ground,PLAY_ZOOM,0,0,0])
})
