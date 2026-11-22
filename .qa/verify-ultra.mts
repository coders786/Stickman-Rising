/** STICKMAN RISING — .qa/verify-ultra.mts
 * THE ULTRA STACK, PROVEN ON PIXELS.
 * ----------------------------------------------------------------------------
 * `tests/ultra-stack.test.ts` proves the BUDGET: which tiers may run the post
 * pass, and how many blits it may issue. It cannot prove the pass changes the
 * picture, because there is no canvas in the test runner.
 *
 * So this script renders the real `CyberBackground` for an ultra frame through
 * `@napi-rs/canvas`, then runs the REAL `PostStack` over that frame with the
 * REAL ray sources (`bg.raySources`), and reports:
 *
 *   · the mean luminance before and after each pass (the pass must brighten,
 *     and must not blow the frame out),
 *   · the same numbers for the HIGH tier, which must not move at all,
 *   · how many taps the pass actually issued.
 *
 * Writes `.qa/post-ultra.png` — a two-up crop (before | after) around the door
 * practical, where the rays and the bloom both land.
 *
 * Usage: node --import tsx .qa/verify-ultra.mts
 */
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

;(globalThis as any).document = { createElement: () => createCanvas(1, 1) }
;(globalThis as any).window = globalThis
;(globalThis as any).devicePixelRatio = 1

const { CyberBackground } = await import('../src/game/world/background.ts')
const { PostStack } = await import('../src/game/render/post.ts')
const { featuresFor } = await import('../src/game/render/graphics.ts')

const W = 1440
const H = 900
const DOOR = 1755
const cam = { x: 1290, y: 0, zoom: 1, offX: 0, offY: 0, rot: 0 }

type Ctx = CanvasRenderingContext2D

function frame(tier: 'ultra' | 'high'): { out: ReturnType<typeof createCanvas>; ctx: Ctx; bg: InstanceType<typeof CyberBackground> } {
  const out = createCanvas(W, H)
  const ctx = out.getContext('2d') as unknown as Ctx
  const bg = new CyberBackground(tier)
  bg.resize(W, H)
  bg.setRunSeed(0xa17e)
  bg.update(0.016)
  bg.drawSky(ctx, cam as never)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)
  bg.drawArena(ctx)
  for (const fx of [DOOR, 1180, 830]) {
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
  return { out, ctx, bg }
}

/** Mean luminance of a rect, 0–255. */
function meanLum(out: ReturnType<typeof createCanvas>, x: number, y: number, w: number, h: number): number {
  const d = (out.getContext('2d') as unknown as Ctx).getImageData(x, y, w, h).data
  let sum = 0
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
  return sum / (d.length / 4)
}

/** Luminance percentiles, 0–255 — the honest test of a glow pass. A pass that
 *  lifts the mean is a haze; a pass that lifts p90 and leaves p10 alone is light. */
function lums(out: ReturnType<typeof createCanvas>): Uint32Array {
  const d = (out.getContext('2d') as unknown as Ctx).getImageData(0, 0, W, H).data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
    hist[Math.min(255, Math.max(0, v))]++
  }
  return hist
}
function pct(hist: Uint32Array, p: number): number {
  let total = 0
  for (let i = 0; i < 256; i++) total += hist[i]
  let acc = 0
  const target = total * p
  for (let i = 0; i < 256; i++) {
    acc += hist[i]
    if (acc >= target) return i
  }
  return 255
}
const p10 = (o: ReturnType<typeof createCanvas>) => pct(lums(o), 0.1)
const p50 = (o: ReturnType<typeof createCanvas>) => pct(lums(o), 0.5)
const p90 = (o: ReturnType<typeof createCanvas>) => pct(lums(o), 0.9)

const report: Record<string, unknown> = {}

// ---- ULTRA: the pass must MOVE the picture -------------------------------
{
  const { out, ctx, bg } = frame('ultra')
  const f = featuresFor('ultra')
  const before = meanLum(out, 0, 0, W, H)
  const beforeDoor = meanLum(out, W / 2 + (DOOR - cam.x) - 150, 250, 300, 420)
  const post = new PostStack()
  const sources = bg.raySources(W, H, cam)
  const beforeP = [p10(out), p50(out), p90(out)]
  // god rays first, then bloom — the order Renderer.draw uses
  post.compose(ctx, W, H, sources, 0.2, 0)
  const rayBlits = post.lastRayBlits
  const afterRays = meanLum(out, 0, 0, W, H)
  post.compose(ctx, W, H, [], 0, 1)
  const after = meanLum(out, 0, 0, W, H)
  const afterDoor = meanLum(out, W / 2 + (DOOR - cam.x) - 150, 250, 300, 420)
  const afterP = [p10(out), p50(out), p90(out)]
  writeFileSync('/tmp/ultra-post.png', out.toBuffer('image/png'))

  // two-up: before | after, cropped around the door
  const cropW = 420, cropH = 380
  const cx = W / 2 + (DOOR - cam.x) - cropW / 2
  const cy = 240
  const two = createCanvas(cropW * 2 + 8, cropH)
  const tg = two.getContext('2d') as unknown as Ctx
  tg.fillStyle = '#101318'
  tg.fillRect(0, 0, two.width, two.height)
  const { out: base } = frame('ultra')   // clean copy for the "before" pane
  tg.drawImage(base as never, cx, cy, cropW, cropH, 0, 0, cropW, cropH)
  tg.drawImage(out as never, cx, cy, cropW, cropH, cropW + 8, 0, cropW, cropH)
  writeFileSync('.qa/post-ultra.png', two.toBuffer('image/png'))

  report.ultra = {
    flags: { bloom: f.bloom, godRays: f.godRays, keyTop: f.keyTop },
    rays: sources.length,
    rayBlits,
    bloomBlits: post.lastBloomBlits,
    lumBefore: +before.toFixed(2),
    lumAfterRays: +afterRays.toFixed(2),
    lumAfter: +after.toFixed(2),
    lumDelta: +(after - before).toFixed(2),
    percentiles: { before: beforeP, after: afterP },
    doorBefore: +beforeDoor.toFixed(2),
    doorAfter: +afterDoor.toFixed(2),
    buffer: post.bufferSize(),
    summary: post.summary(),
  }
}

// ---- HIGH: the same call must be a no-op --------------------------------
{
  const { out, ctx, bg } = frame('high')
  const f = featuresFor('high')
  const before = meanLum(out, 0, 0, W, H)
  const post = new PostStack()
  if (f.godRays) post.compose(ctx, W, H, bg.raySources(W, H, cam), 0.9, 0)
  if (f.bloom) post.compose(ctx, W, H, [], 0, 1)
  const after = meanLum(out, 0, 0, W, H)
  report.high = { flags: { bloom: f.bloom, godRays: f.godRays }, lumBefore: +before.toFixed(2), lumAfter: +after.toFixed(2), summary: post.summary() }
}

console.log(JSON.stringify(report, null, 2))
