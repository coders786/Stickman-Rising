/** Reproducible production-renderer fixture: still camera, no HUD or combat FX. */
import { createCanvas, Path2D } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
Object.assign(globalThis, {
  Path2D,
  window: globalThis,
  document: { createElement: () => createCanvas(1, 1) },
  devicePixelRatio: 1,
})
let rng = 0xa17e
Math.random = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 2 ** 32
const { CyberBackground } = await import('../src/game/world/background')
const { Renderer } = await import('../src/game/render/renderer')
const { Player } = await import('../src/game/entities/player')
const { Enemy } = await import('../src/game/entities/enemy')
const { solveFighter3D } = await import('../src/game/anim/rig3d')
const { PLAYER_SPEC } = await import('../src/game/anim/skeleton')
const { sampleClip } = await import('../src/game/anim/animator')
const { IDLE_CLIP } = await import('../src/game/anim/clips')
const W = 1000,
  H = 520,
  time = 0.24
const bg = new CyberBackground('ultra')
bg.resize(W, H)
bg.setRunSeed(0xa17e)
bg.update(time)
const renderer = new Renderer()
renderer.setQuality('ultra')
if(process.env.SR_DESKTOP_LIGHT) renderer.setDesktopLighting(true)
const player = new Player()
player.reset(1715)
sampleClip(IDLE_CLIP, time, player.pose)
solveFighter3D(player.pose, PLAYER_SPEC, player.geom, PLAYER_SPEC.blade)
const enemies = [new Enemy('grunt', 1800, 1), new Enemy('heavy', 1595, 1)]
for (const e of enemies) {
  e.spawning = false
  e.state = 'chase'
  e.update(1 / 60, { time, arenaMinX: 0, arenaMaxX: 3000 } as never)
}
enemies[1].y = -35
const noop = () => {}
const scene = {
  cam: { x: 1710, y: -64, zoom: 1.7, offX: 0, offY: 0, rot: 0 },
  bg,
  player,
  enemies,
  time,
  props: { draw: noop, drawShadows: noop },
  hud: { draw: noop },
  projectiles: { draw: noop },
  fx: {
    drawUnder: noop,
    drawSilhouettes: noop,
    drawAdditive: noop,
    drawImpactFrames: noop,
    drawImpactFocus: noop,
    drawFlash: noop,
  },
}
// Optional still at peak focus using the live impact renderer (no combat simulation).
if (process.env.SR_CAPTURE_BEAT) {
  const { FX } = await import('../src/game/fx/fx')
  const fx = new FX()
  fx.impactFrame(enemies[0].x, -54, '#efce9a', 'guardBreak')
  fx.update(0, 0.08)
  scene.fx.drawImpactFrames = fx.drawImpactFrames.bind(fx) as typeof noop
  scene.fx.drawImpactFocus = fx.drawImpactFocus.bind(fx) as typeof noop
}
// Long-running roof fixture: a single update only shows the initial cable pose.
if (process.env.SR_CAPTURE_RIG) {
  for (let i=0;i<240;i++) bg.update(1/60)
  Object.assign(scene.cam,{x:1900,y:-105,zoom:1})
}
if(process.env.SR_LIGHT_RIG){
  Object.assign(scene.cam,{x:1300,y:-80,zoom:.86})
  player.x=1715;enemies[0].x=900;enemies[1].x=1510;enemies[1].y=0
}
const out = createCanvas(W, H)
renderer.draw(out.getContext('2d') as never, scene as never, W, H, 1 / 60)
writeFileSync(process.argv[2] ?? '/tmp/fighters.png', out.toBuffer('image/png'))
// Optional comparison on the same CPU and raster backend; includes a readback
// to force completion. This is not browser frame pacing or a GPU benchmark.
if (process.env.SR_TIME_CAPTURE) {
  const g = out.getContext('2d'),
    timings: number[] = []
  for (let i = 0; i < 24; i++) {
    const start = performance.now()
    renderer.draw(g as never, scene as never, W, H, 1 / 60)
    g.getImageData(0, 0, W, H)
    if (i >= 4) timings.push(performance.now() - start)
  }
  timings.sort((a, b) => a - b)
  console.log(`20 warm native frames: median ${timings[10].toFixed(1)} ms, p95 ${timings[18].toFixed(1)} ms`)
}
