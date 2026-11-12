/** Golden-pose harness for the animation layer refactor.
 *
 * Runs the real Player through a scripted suite of scenarios at a fixed
 * timestep and fingerprints every sampled pose. The fingerprint captured
 * BEFORE the layer refactor is the contract: the rewritten pipeline must
 * reproduce it within a tight tolerance, or the refactor changed behavior
 * and is not a refactor.
 *
 * Usage:
 *   npx tsx .qa/pose-golden.ts capture   > .qa/pose-golden.baseline.json
 *   npx tsx .qa/pose-golden.ts verify
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { Player } from '../src/game/entities/player'
import { Input } from '../src/game/core/input'
import { CH, CH_COUNT, type Pose } from '../src/game/anim/pose'

const HZ = 120
const DT = 1 / HZ
const FPS_SAMPLE = 15 // fingerprint 15 poses per simulated second
const BASELINE = '.qa/pose-golden.baseline.json'

type Act = readonly [key: string, down: boolean]
type Scenario = { name: string; script: ReadonlyArray<{ at: number; act?: Act; hold?: number }>; dur: number }

/** Scripted scenarios covering every pipeline branch that matters:
 * locomotion, both dash families, charge, the attack kinds, and the
 * draw/sheathe transition (which runs the contact IK). */
const SCENARIOS: Scenario[] = [
  { name: 'idle', dur: 1.5, script: [] },
  { name: 'walk', dur: 2.0, script: [{ at: 0, act: [['right', true]] }, { at: 1.0, act: [['right', false], ['left', true]] }] },
  { name: 'sprint', dur: 2.0, script: [{ at: 0, act: [['right', true]] }, { at: 0.25, act: [['dash', true]] }, { at: 0.28, act: [['dash', false]] }] },
  { name: 'dash', dur: 1.2, script: [{ at: 0.1, act: [['dash', true]] }, { at: 0.13, act: [['dash', false]] }] },
  { name: 'charge', dur: 2.0, script: [{ at: 0.1, act: [['dash', true]] }, { at: 0.9, act: [['dash', false]] }] },
  { name: 'light', dur: 1.5, script: [{ at: 0.2, act: [['light', true]] }, { at: 0.26, act: [['light', false]] }] },
  { name: 'heavy', dur: 1.8, script: [{ at: 0.2, act: [['heavy', true]] }, { at: 0.26, act: [['heavy', false]] }] },
  { name: 'light-chain', dur: 2.2, script: [
      { at: 0.1, act: [['light', true]] }, { at: 0.16, act: [['light', false]] },
      { at: 0.5, act: [['light', true]] }, { at: 0.56, act: [['light', false]] },
      { at: 0.95, act: [['light', true]] }, { at: 1.01, act: [['light', false]] },
    ] },
  { name: 'jump', dur: 1.6, script: [{ at: 0.2, act: [['up', true]] }, { at: 0.3, act: [['up', false]] }, { at: 0.9, act: [['down', true]] }, { at: 1.0, act: [['down', false]] }] },
  { name: 'draw', dur: 1.6, script: [{ at: 0.2, act: [['sheathe', true]] }, { at: 0.26, act: [['sheathe', false]] }] },
  { name: 'move-attack', dur: 2.0, script: [
      { at: 0, act: [['right', true]] },
      { at: 0.4, act: [['light', true]] }, { at: 0.46, act: [['light', false]] },
      { at: 0.9, act: [['heavy', true]] }, { at: 0.96, act: [['heavy', false]] },
    ] },
]

function makeWorld() {
  // Minimal stubs: the Player only needs these to exist during update().
  const noop = () => {}
  return {
    input: new Input(),
    enemies: [],
    time: 0,
    combo: { hits: 0 },
    addDamageText: noop, spawnEnemy: noop, enemiesNear: () => [], enemyStrikePlayer: noop,
    particles: { spawn: noop },
    camera: { shake: noop, x: 0, y: 0 },
    audio: { play: noop },
    solidAt: () => false,
    groundAt: () => 0,
  } as unknown as Parameters<Player['update']>[1]
}

/** Run one scenario, returning a fingerprint: a flat array of sampled
 * (channel value) numbers, so a diff is a single numeric comparison. */
function fingerprint(sc: Scenario): { samples: number; data: number[] } {
  const p = new Player()
  const w = makeWorld()
  p.reset(400)
  const data: number[] = []
  let samples = 0
  const total = Math.round(sc.dur * HZ)
  let si = 0
  for (let i = 0; i < total; i++) {
    const t = i * DT
    while (si < sc.script.length && sc.script[si].at <= t) {
      const s = sc.script[si++]
      if (s.act) w.input.setVirtual(s.act[0], s.act[1])
    }
    p.update(DT, w)
    // sample at FPS_SAMPLE
    if (i % Math.round(HZ / FPS_SAMPLE) === 0) {
      const pose = (p as unknown as { pose: Pose }).pose
      for (let c = 0; c < CH_COUNT; c++) data.push(Number(pose[c].toFixed(5)))
      data.push(Number(p.x.toFixed(3)), Number(p.y.toFixed(3)))
      samples++
    }
  }
  return { samples, data }
}

function capture() {
  const out: Record<string, { samples: number; data: number[] }> = {}
  for (const sc of SCENARIOS) out[sc.name] = fingerprint(sc)
  return out
}

function main() {
  const mode = process.argv[2] ?? 'verify'
  const now = capture()
  if (mode === 'capture') {
    mkdirSync('.qa', { recursive: true })
    writeFileSync(BASELINE, JSON.stringify(now))
    const chans = Object.values(now).reduce((n, r) => n + r.data.length, 0)
    console.log(`captured ${Object.keys(now).length} scenarios, ${chans} channel samples`)
    return
  }
  if (!existsSync(BASELINE)) {
    console.log('no baseline — run: npx tsx .qa/pose-golden.ts capture')
    process.exit(1)
  }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as typeof now
  let worst = 0
  let worstAt = ''
  let fails = 0
  for (const name of Object.keys(base)) {
    const a = base[name]
    const b = now[name]
    if (!b) { console.log(`✗ ${name}: missing`); fails++; continue }
    if (a.data.length !== b.data.length) {
      console.log(`✗ ${name}: length ${a.data.length} -> ${b.data.length}`); fails++; continue
    }
    let scenWorst = 0
    let scenAt = 0
    for (let i = 0; i < a.data.length; i++) {
      const d = Math.abs(a.data[i] - b.data[i])
      if (d > scenWorst) { scenWorst = d; scenAt = i }
    }
    if (scenWorst > worst) { worst = scenWorst; worstAt = `${name}[${scenAt}]` }
    const ok = scenWorst <= 1e-4
    if (!ok) fails++
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(12)} worst ${scenWorst.toExponential(2)}`)
  }
  console.log(`\nworst overall ${worst.toExponential(2)} at ${worstAt}`)
  console.log(fails ? `FAIL — ${fails} scenario(s) changed` : 'PASS — pipeline is behavior-preserving')
  process.exit(fails ? 1 : 0)
}

main()
