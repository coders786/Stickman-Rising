/** STICKMAN RISING — scripts/bench-render.mjs
 * THE NUMBER, NOT THE VIBE.
 * ----------------------------------------------------------------------------
 * Every claim in docs/master/12 and 21 is falsifiable by this script. It runs
 * in Node (no DOM), so it measures the parts that are pure logic — profile
 * generation, the resolution governor, the motion library — plus a static audit of
 * the render code that no unit test can see (canvas creation sites, Math.random
 * inside deterministic modules).
 *
 * What it deliberately does NOT do: claim to measure frame time. Frame time is
 * measured on a phone, by frameLog.ts, in the live game. A Node microbenchmark
 * that printed "60 fps" would be a lie with a decimal point.
 *
 * Usage:  node --import tsx scripts/bench-render.mjs [--json] [--n=20000]
 * Exit:   0 within budget, 1 if a budget is breached.
 */
import { makeProfile, profileDistance } from '../src/game/world/profile.ts'
import { SpringChain } from '../src/game/anim/natural.ts'
import { RenderScaleControl } from '../src/game/render/render-scale.ts'
import { CanvasLedger, bytesFor } from '../src/game/render/ledger.ts'
import { rgbaConst, colourCacheSize, resetColourCache } from '../src/game/render/color.ts'
import { FrameLog } from '../src/game/render/frameLog.ts'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const JSON_OUT = args.includes('--json')
const N = Number((args.find((a) => a.startsWith('--n=')) ?? '--n=20000').split('=')[1])

const now = () => Number(process.hrtime.bigint()) / 1e6
const rows = []
let breaches = 0

function row(name, value, unit, budget, note = '') {
  const ok = budget == null ? true : value <= budget
  if (!ok) breaches++
  rows.push({ name, value, unit, budget, ok, note })
}

/* ------------------------- 1. profile generation ------------------------- */
{
  const t0 = now()
  const seeds = new Array(N)
  for (let i = 0; i < N; i++) seeds[i] = (i * 2654435761) >>> 0
  let acc = 0
  let hist = []
  for (const s of seeds) {
    const p = makeProfile(s, hist)
    hist = [s, ...hist].slice(0, 3)
    acc += p.moon.phase
  }
  const ms = now() - t0
  row('profile.makeProfile', (ms / N) * 1000, 'µs/seed', 60,
    `${N} seeds, history-aware; mean phase ${(acc / N).toFixed(3)}`)
}

/* --------------------------- 2. novelty spread --------------------------- */
{
  // The metric that matters: how different is a run from the one before it?
  let min = Infinity
  let sum = 0
  const n = Math.min(N, 5000)
  let prev = null
  for (let i = 0; i < n; i++) {
    const p = makeProfile((i * 7919 + 3) >>> 0, prev ? [prev.seed] : [])
    if (prev) {
      const d = profileDistance(p, prev)
      if (d < min) min = d
      sum += d
    }
    prev = p
  }
  row('profile.novelty.min', min, 'distance', null, 'floor 0.11 in profile.ts')
  row('profile.novelty.mean', sum / Math.max(1, n - 1), 'distance', null, 'bigger is more distinct')
}

/* ---------------------------- 3. render scale ----------------------------- */
{
  const l = new RenderScaleControl('high', true)
  const t0 = now()
  for (let i = 0; i < 200_000; i++) l.frame(9 + (i % 7))
  const ms = now() - t0
  row('renderScale.frame', (ms / 200_000) * 1000, 'µs/frame', 1.0, `resolved scale ${l.value}`)
}

/* --------------------------- 4. spring chains --------------------------- */
{
  const chains = []
  for (let i = 0; i < 5; i++) {
    const c = new SpringChain({ points: 19, link: 6.4 })
    c.reset(0, 0, 0, 1)
    chains.push(c)
  }
  const frames = 20_000
  const t0 = now()
  for (let f = 0; f < frames; f++) {
    for (const c of chains) c.step(1 / 60)
  }
  const ms = now() - t0
  const per = (ms / frames) * 1000
  row('motion.5chains(19pts)', per, 'µs/frame', 100,
    'budget from 20 §8: ≤0.10 ms CPU for all secondary motion')
}

/* ----------------------------- 5. the ledger ---------------------------- */
{
  const made = []
  const factory = (w, h) => {
    const rec = { w, h }
    made.push(rec)
    return { get width() { return rec.w }, set width(v) { rec.w = v }, get height() { return rec.h }, set height(v) { rec.h = v }, getContext: () => null }
  }
  const l = new CanvasLedger(factory, { maxSurfaces: 40, maxBytes: 40 * 1024 * 1024 })
  const t0 = now()
  for (let i = 0; i < 200_000; i++) l.acquire('k' + (i % 60), 256, 256)
  const ms = now() - t0
  const st = l.stats()
  row('ledger.acquire(hit)', (ms / 200_000) * 1000, 'µs/call', 5, `${st.surfaces} live, ${(st.bytes / 1048576).toFixed(1)} MB, ${l.evicted} evicted`)
  row('ledger.resident', st.bytes / 1048576, 'MB', 48, 'cap from DEFAULT_CAPS')
}

/* --------------------------- 6. colour strings -------------------------- */
{
  resetColourCache()
  const t0 = now()
  const iterations = 500_000
  for (let i = 0; i < iterations; i++) rgbaConst('192,205,211', (i % 32) / 32)
  const ms = now() - t0
  const built = colourCacheSize()
  row('color.rgbaConst', (ms / iterations) * 1000, 'µs/call', 2, `${built} strings built (bounded by 33/base)`)
  // The property: the cache stops growing. 500k calls must not make 500k strings.
  row('color.stringsBuilt', built, 'strings', 66, 'two bases x 33 levels')
}

/* --------------------------- 7. the frame log --------------------------- */
{
  const f = new FrameLog(600)
  const t0 = now()
  for (let i = 0; i < 1_000_000; i++) f.sample(9)
  const ms = now() - t0
  row('frameLog.sample', (ms / 1_000_000) * 1000, 'µs/frame', 0.5, 'ring write only')
}

/* ------------------------- 8. static render audit ----------------------- */
{
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p, out)
      else if (name.endsWith('.ts')) out.push(p)
    }
    return out
  }
  const files = walk('src/game')
  const canvasSites = []
  const randomSites = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (line.includes("createElement('canvas')")) {
        const allowed = f.endsWith('render/ledger.ts') || f.endsWith('render/bhst.ts')
        if (!allowed) canvasSites.push(`${f}:${i + 1}`)
      }
      if (/Math\.random\(\)/.test(line) && !f.includes('/debug/') && !line.trim().startsWith('//')) {
        randomSites.push(`${f}:${i + 1}`)
      }
    })
  }
  row('audit.canvasSitesOutsideLedger', canvasSites.length, 'sites', null,
    canvasSites.slice(0, 4).join(' ') || 'none')
  row('audit.MathRandomInGameCode', randomSites.length, 'sites', null,
    randomSites.slice(0, 4).join(' ') || 'none')
  // A soft gate: the ledger owns canvas creation. This is reported, not failed,
  // until the migration in T1.6 lands — the count is the progress bar.
  for (const r of rows.slice(-2)) r.note += r.value === 0 ? ' ✓' : ' (migration open)'
}

/* ------------------------------- report -------------------------------- */
if (JSON_OUT) {
  console.log(JSON.stringify({ rows, breaches, node: process.version }, null, 2))
} else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log('\nSTICKMAN RISING — render/plan bench (Node, pure logic + static audit)\n')
  console.log(pad('metric', 34) + pad('value', 14) + pad('unit', 12) + pad('budget', 9) + 'note')
  console.log('-'.repeat(110))
  for (const r of rows) {
    const v = typeof r.value === 'number' ? r.value.toFixed(4) : String(r.value)
    console.log(
      pad(r.name, 34) + pad(v, 14) + pad(r.unit, 12) +
      pad(r.budget == null ? '—' : String(r.budget), 9) +
      (r.ok ? '' : 'BREACH ') + r.note,
    )
  }
  console.log('-'.repeat(110))
  console.log(breaches === 0 ? 'within budget' : `${breaches} budget breach(es)`)
  console.log('NOTE: frame time is NOT measured here by design — see frameLog.ts in the live game.\n')
}
process.exit(breaches === 0 ? 0 : 1)
