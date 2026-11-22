/** Matched native pixel and allocation evidence, not a GPU memory or FPS benchmark.
 * SR_SOURCE=.cache/slasher-qa/control/src node --import tsx .qa/slasher-lifetimes.mts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCanvas, Path2D } from '@napi-rs/canvas'

Object.defineProperty(globalThis, 'document', { value: { createElement: () => createCanvas(1, 1) } })
Object.defineProperty(globalThis, 'Path2D', { value: Path2D })
const from = (name: string) => import(pathToFileURL(resolve(process.env.SR_SOURCE || 'src', name)).href)
const { CyberBackground } = await from('game/world/background.ts')
const { BRIDGE_ART } = await from('game/world/art-grade.ts')
const { gameLedger } = await from('game/render/ledger.ts')
const mib = (bytes: number) => +(bytes / (1024 ** 2)).toFixed(2)
let peak = 0
const acquire = gameLedger.acquire.bind(gameLedger)
gameLedger.acquire = (...args: unknown[]) => {
  const canvas = acquire(...args)
  peak = Math.max(peak, gameLedger.stats().bytes)
  return canvas
}

const snapshot = (name: string) => {
  const s = gameLedger.stats()
  return { name, surfaces: s.surfaces, mib: mib(s.bytes), peakMib: mib(peak) }
}
const bg = new CyberBackground('high', undefined, { ...BRIDGE_ART, clean: true })
const cam = { x: 1460, y: -148, zoom: 1.04 }
const g = createCanvas(1280, 720).getContext('2d')
bg.setRunSeed(42)
const bakeMs = bg.warm()
const rows = [snapshot('warm')]
const hashes: Record<string, string> = {}
function skyAndDeck(w: number, h: number, dx: number) {
  const out = createCanvas(Math.round(w * 1.25), Math.round(h * 1.25))
  const ctx = out.getContext('2d')
  const view = { ...cam, x: cam.x + dx }
  bg.resize(w, h)
  ctx.scale(out.width / w, out.height / h)
  bg.drawSky(ctx, view)
  ctx.translate(w / 2, h / 2)
  ctx.scale(view.zoom, view.zoom)
  ctx.translate(-view.x, -view.y)
  bg.drawArena(ctx, false, view)
  hashes[`${w}×${h}@${dx}`] = createHash('sha256').update(ctx.getImageData(0, 0, out.width, out.height).data).digest('hex')
}
for (const [w, h, dx] of [[640, 360, 0], [640, 360, 1173.5], [390, 844, -1286.25]]) skyAndDeck(w, h, dx)
// On the large output, isolate the viewport path before adding a second size.
bg.resize(1280, 720)
bg.drawSky(g, cam)
for (const [w, h] of [[1280, 720], [1360, 760], [1400, 780], [1280, 720]]) {
  bg.resize(w, h)
  bg.drawWeather(g, cam)
  rows.push(snapshot(`${w}×${h}`))
}
const corner = () => [...g.getImageData(0, 719, 1, 1).data]
g.clearRect(0, 0, 1280, 720)
bg.drawWeather(g, cam)
const first = corner()
bg.setRunSeed(43)
bg.warm()
g.clearRect(0, 0, 1280, 720)
bg.drawWeather(g, cam)
const retry = corner()
rows.push(snapshot('same-size retry'))
const entries = gameLedger.list()
const soak = []
if (process.argv.includes('--soak')) {
  const key = entries.find((entry: { tag: string }) => entry.tag === 'vignette')?.key
  const expectVignette = key ? [key] : []
  for (let seed = 44; seed < 64; seed++) {
    bg.setRunSeed(seed)
    bg.warm()
    g.clearRect(0, 0, 1280, 720)
    bg.drawWeather(g, cam)
    assert.equal(corner()[3] > 0, Boolean(key), `unexpected weather paint at seed ${seed}`)
    const ledger = gameLedger.list()
    assert.deepEqual(ledger.filter(e => e.tag === 'vignette').map(e => e.key), expectVignette)
    assert.ok(ledger.every(e => e.tag !== 'city-scratch'))
    soak.push(snapshot(`retry ${seed}`))
  }
  bg.dispose()
  assert.equal(gameLedger.stats().surfaces, 0)
}
console.log(JSON.stringify({ bakeMs, hashes, first, retry, rows, entries, soak }, null, 2))
