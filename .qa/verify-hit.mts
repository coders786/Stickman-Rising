/** STICKMAN RISING — .qa/verify-hit.mts
 * HIT LIGHT PROOF: the same strike, in two places.
 * Renders the arena once, then blooms a hit inside the stairwell's spill and the
 * same hit out in the unlit middle of the deck, so the difference the light field
 * makes is visible instead of asserted.
 * Usage: node --import tsx .qa/verify-hit.mts
 */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

;(globalThis as any).document = { createElement: () => createCanvas(1, 1) }
;(globalThis as any).window = globalThis

const { CyberBackground } = await import('../src/game/world/background.ts')
const { FX } = await import('../src/game/fx/fx.ts')
const { LIGHT_HEX } = await import('../src/game/world/lightfield.ts')

const W = 1440, H = 900
const cam = { x: 1290, y: 0, zoom: 1, offX: 0, offY: 0, rot: 0 }
const bg = new CyberBackground('ultra')
bg.resize(W, H); bg.setRunSeed(0xa17e); bg.update(0.016)

const out = createCanvas(W, H)
const ctx = out.getContext('2d') as unknown as CanvasRenderingContext2D
bg.drawSky(ctx, cam as never)
ctx.save()
ctx.translate(W / 2, H / 2)
ctx.translate(-cam.x, -cam.y)
bg.drawArena(ctx)

const fx = new FX()
fx.setLightSampler((x: number, y: number) => {
  const s = bg.lightAt?.(x, y)
  if (!s || !s.best) return null
  const k = Math.min(1, Math.max(s.warm, s.cool, s.city, s.neon))
  if (k <= 0.12) return null
  return { color: LIGHT_HEX[s.best.kind], k }
})
// two identical strikes: one inside the door's spill, one out in the dark
fx.impact(1755, -80, 0.0, true, '#eafcff', '#9fe8ff')
fx.impact(1180, -80, 0.0, true, '#eafcff', '#9fe8ff')
fx.update(0.02)
fx.drawAdditive(ctx, 0.02)
ctx.restore()

writeFileSync('/tmp/hit.png', out.toBuffer('image/png'))
const crop = createCanvas(900, 420)
crop.getContext('2d').drawImage(out as never, W / 2 + (1180 - cam.x) - 380, 240, 900, 420, 0, 0, 900, 420)
writeFileSync('.qa/hit-proof.png', crop.toBuffer('image/png'))
console.log('wrote .qa/hit-proof.png')

// close-ups, 3× — one in the door's spill, one in the dark
const near = createCanvas(300, 240)
const ng = near.getContext('2d')
ng.imageSmoothingEnabled = false
ng.drawImage(out as never, W / 2 + (1755 - cam.x) - 100, 300, 200, 160, 0, 0, 300, 240)
writeFileSync('.qa/hit-near-door.png', near.toBuffer('image/png'))
const far = createCanvas(300, 240)
const fg = far.getContext('2d')
fg.imageSmoothingEnabled = false
fg.drawImage(out as never, W / 2 + (1180 - cam.x) - 100, 300, 200, 160, 0, 0, 300, 240)
writeFileSync('.qa/hit-in-dark.png', far.toBuffer('image/png'))
console.log('wrote close-ups')
