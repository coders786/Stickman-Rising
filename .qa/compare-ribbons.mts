/** Edge walk: measure direct-light error specifically *inside* the penumbra.
 * Whole-frame RGB similarity mostly measures the unchanged skyline. This test
 * instead walks a receiver past opaque door wings at many sub-texel heights. */
import { performance } from 'node:perf_hooks'
import {
  RibbonField,
  newProbe,
  type Blocker,
} from '../src/game/lighting/ribbons'
import { makeStageLights } from '../src/game/world/lightfield'
const lamp = { ...makeStageLights(null, 17)[0], x: 0, gain: 1, flicker: 0 }
const blocks: Blocker[] = [
  { left: -84, right: -32, height: 160 },
  { left: 32, right: 84, height: 160 },
  { left: 114, right: 148, height: 55 },
  { left: 130, right: 163, height: 38 },
]
// Independent 32 x 24 stratified rays to the doorway rectangle. No call to the
// interval solver, its visibility routine or its attenuation function.
function reference(x: number, h: number) {
  let clear = 0
  const t = 18 / 80
  for (let j = 0; j < 24; j++)
    for (let i = 0; i < 32; i++) {
      const lx = 64 * ((i + 0.5) / 32 - 0.5),
        lh = -lamp.y + 52 * ((j + 0.5) / 24 - 0.5)
      const bx = x + (lx - x) * t,
        bh = h + (lh - h) * t
      if (
        !blocks.some(
          (b) => bx >= b.left && bx <= b.right && bh >= 0 && bh <= b.height,
        )
      )
        clear++
    }
  const v = clear / (32 * 24),
    u = Math.max(0, 1 - Math.hypot(x, (h + lamp.y) * 0.54, 48) / lamp.radius)
  const panel = Math.sqrt(80 / Math.hypot(80, Math.max(0,Math.abs(x)-32), Math.max(0, Math.abs(h+lamp.y)-26)))
  return { x, h, w: panel * v * u * u * (3 - 2 * u), edge: v > 0.02 && v < 0.98 }
}
const probes: ReturnType<typeof reference>[] = []
const t0 = performance.now()
for (let h = 2.3; h < 210; h += 5.7)
  for (let x = -209.1; x < 210; x += 2.65) probes.push(reference(x, h))
const refMs = performance.now() - t0
for (const step of [20, 10, 5]) {
  const start = performance.now(),
    f = new RibbonField([lamp], blocks, step),
    bakeMs = performance.now() - start
  const probe = newProbe(),
    errors: number[] = [],
    edge: number[] = []
  let leak = 0,
    checksum = 0
  for (const p of probes) {
    const v = f.sample(p.x, -p.h, probe).warm,
      e = Math.abs(v - p.w)
    errors.push(e)
    if (p.edge) edge.push(e)
    if (p.w === 0) leak = Math.max(leak, v)
  }
  const t1 = performance.now()
  for (let i = 0; i < 16; i++)
    for (const p of probes) checksum += f.sample(p.x, -p.h, probe).warm
  const lookupMs = (performance.now() - t1) / 16
  const p95 = (a: number[]) =>
    a.sort((a, b) => a - b)[Math.floor(0.95 * a.length)]
  console.log({
    spacing: step,
    probes: probes.length,
    edgeSamples: edge.length,
    meanAbs: +(errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(4),
    edgeP95: +p95(edge).toFixed(4),
    maxUmbraLeak: +leak.toFixed(4),
    transferBytes:
      f.ribbons[0].direct.byteLength + f.ribbons[0].returnRow.byteLength,
    refSweepMs: +refMs.toFixed(2),
    lookupSweepMs: +lookupMs.toFixed(2),
    coldBakeMs: +bakeMs.toFixed(2),
    checksum: Math.round(checksum),
  })
}
