/** STICKMAN RISING — .qa/verify-lighting.mts
 * HEADLESS STAGE PROOF.
 * ----------------------------------------------------------------------------
 * `npm run gate` proves the light field, the city records and the roof props are
 * mathematically right. It cannot prove they COMPOSE — that the pool lands under
 * the source, or that the roof props sit on the deck line. Use
 * capture-fighters.mts for the full actor/material/shadow pipeline.
 *
 * So this script renders the real `CyberBackground` through `@napi-rs/canvas`
 * (a native canvas, not a stub), with the same transform `Renderer.draw` applies
 * before its world pass, and writes PNGs to /tmp:
 *
 *   /tmp/stage-<tier>-<mode>.png   the whole frame
 *   /tmp/door-<tier>-<mode>.png    a crop around the stairwell door
 *
 * Modes exist to answer "which pass is that?" without editing the engine:
 *   MODE=all (default) · MODE=nofig (no reference figures) · MODE=nopool (no pools)
 *
 * Usage: node --import tsx .qa/verify-lighting.mts
 */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

;(globalThis as any).document = { createElement: () => createCanvas(1, 1) }
;(globalThis as any).window = globalThis
;(globalThis as any).devicePixelRatio = 1

const { CyberBackground } = await import('../src/game/world/background.ts')

const W = 1440
const H = 900
const MODE = process.env.MODE ?? 'all'
const DOOR = 1755
const LAMP = 830
/** World → screen, exactly as the renderer's world transform does it. */
const sx = (x: number, camX: number): number => W / 2 + (x - camX)

for (const tier of ['ultra', 'high', 'medium', 'low'] as const) {
  const out = createCanvas(W, H)
  const ctx = out.getContext('2d') as unknown as CanvasRenderingContext2D
  const bg = new CyberBackground(tier)
  bg.resize(W, H)
  bg.setRunSeed(0xa17e)
  bg.update(0.016)
  // [FULL] a view that holds both practicals, so the composition can be judged
  const cam = { x: 1290, y: 0, zoom: 1, offX: 0, offY: 0, rot: 0 }
  bg.drawSky(ctx, cam as never)
  if (MODE === 'nopool') (bg as unknown as { drawLightPools: () => void }).drawLightPools = () => {}
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)
  bg.drawArena(ctx)
  for (const fx of MODE === 'nofig' ? [] : [DOOR, 1180, LAMP]) {
    ctx.strokeStyle = '#cfe4f6'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(fx, -84, 11, 0, Math.PI * 2)
    ctx.moveTo(fx, -73); ctx.lineTo(fx, -30)
    ctx.moveTo(fx, -60); ctx.lineTo(fx - 27, -40)
    ctx.moveTo(fx, -60); ctx.lineTo(fx + 27, -40)
    ctx.moveTo(fx, -30); ctx.lineTo(fx - 17, 0)
    ctx.moveTo(fx, -30); ctx.lineTo(fx + 17, 0)
    ctx.stroke()
  }
  ctx.restore()
  writeFileSync(`/tmp/stage-${tier}-${MODE}.png`, out.toBuffer('image/png'))
  const crop = createCanvas(440, 360)
  const cg = crop.getContext('2d') as unknown as CanvasRenderingContext2D
  cg.drawImage(out as never, sx(DOOR, cam.x) - 220, 250, 440, 360, 0, 0, 440, 360)
  writeFileSync(`/tmp/door-${tier}-${MODE}.png`, crop.toBuffer('image/png'))
  const anyBg = bg as unknown as {
    lights: { id: string; kind: string; x: number; radius: number }[]
    roof: { props: { kind: string }[] }
  }
  if (tier === 'ultra') {
    console.log(JSON.stringify({
      tier,
      mode: MODE,
      lights: anyBg.lights.map((l) => `${l.kind}@${Math.round(l.x)}`),
      roofProps: anyBg.roof.props.length,
      sampleAtDoor: bg.lightAt?.(DOOR, 0).bestW.toFixed(2),
      sampleAtLamp: bg.lightAt?.(LAMP, 0).cool.toFixed(2),
    }))
  }
}
