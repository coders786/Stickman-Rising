/** Same-backend rain/road receiver pixels and storm receipt; no FPS claims. */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'

const source = process.env.SR_SOURCE || 'src'
const { StormEngine } = await import(pathToFileURL(resolve(source, 'game/world/storm.ts')).href)
const hash = createHash('sha256')
const strikes: { tick: number; azimuth: number }[] = []
const out = createCanvas(690, 410)
const ctx = out.getContext('2d')
let paintCalls = 0
const paint = ctx.stroke.bind(ctx)
ctx.stroke = () => { paintCalls++; paint() }
const storm = new StormEngine('ultra')
storm.resize(out.width, out.height)
storm.setSharpRain(true)
storm.applyProfile({ stormBias: 1.23, rain: .8, cadence: 1.1 })
const dryCalls: number[] = []
for (let tick = 0; tick < 3600; tick++) {
  storm.onThunder = () => strikes.push({ tick, azimuth: storm.azimuthValue })
  storm.setView({ x: 800 + tick * .39, y: -158 + 13 * Math.sin(tick * .02), zoom: 1.03 })
  storm.setQuality(tick < 300 || tick > 1100 ? 'ultra' : 'low')
  storm.setRainScale(tick < 120 ? 0 : tick < 660 ? .06 : .84)
  storm.update(1 / 60)
  if (tick === 90 || tick === 123 || tick === 310 || tick === 1411 || tick === 3260) {
    ctx.clearRect(0, 0, out.width, out.height)
    paintCalls = 0
    storm.drawRain(ctx, { x: 850, y: -160, color: '255,160,90', gain: .72 })
    ctx.save()
    ctx.translate(0, 240)
    ctx.translate(-600 - tick * .39, 0)
    storm.drawSplashes(ctx, 600 + tick * .39, 1290 + tick * .39, () => .8)
    ctx.restore()
    if (tick < 120) dryCalls.push(paintCalls)
    hash.update(ctx.getImageData(0, 0, out.width, out.height).data)
  }
}
console.log(JSON.stringify({ source, pixels: hash.digest('hex'), strikes, dryCalls, end: storm.snapshot }, null, 2))
