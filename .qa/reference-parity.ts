/**
 * REFERENCE PARITY — compares the reference studio's own baked motion against
 * ours in joint space, so "it is / is not fluid" has numbers on both sides.
 *
 *   npx tsx .qa/reference-parity.ts
 *
 * Three measurements, all scale-free:
 *   · peak/mean  — how concentrated the motion is (a smear scores ~2, a snap 6+)
 *   · still      — share of frames under 10 % of peak speed (the dwell that
 *                  makes a strike read; the reference's median is 58 %)
 *   · amplitude  — striking hand from the shoulder, in shoulder-to-hip
 *                  lengths (is the strike actually extended?)
 *
 * Gotcha that cost an hour: `solveFighter3D` hands back SHARED vectors. Copy
 * every joint to a plain {x,y} before storing a frame, or all frames alias to
 * the last solve and the whole table is fiction.
 */
import {existsSync, readFileSync} from 'node:fs'
import vm from 'node:vm'
import {sampleClip} from '../src/game/anim/animator'
import {solveFighter3D, makeFighterGeom} from '../src/game/anim/rig3d'
import {PLAYER_SPEC} from '../src/game/anim/skeleton'
import {ATTACKS} from '../src/game/combat/attacks'
import {unarmedAttack} from '../src/game/combat/unarmed'

const REF = process.env.REF_HTML ?? '/tmp/arena-coding-uploads/Shadow_Ronin.html'
if (!existsSync(REF)) {
  console.error(`reference studio not found at ${REF} — pass REF_HTML=<path to Shadow_Ronin.html>`)
  process.exit(2)
}
const html = readFileSync(REF, 'utf8').split('\n')
const frag = html.slice(105, 314).join('\n')
const ctx: Record<string, unknown> = {Float32Array, Uint8Array, Set, Object, Math, Array, console}
vm.createContext(ctx)
vm.runInContext(frag + ';globalThis.__out={B,N,NP,FR,I,WGT,ATTACKS,KEYF,sampleP,paramAt}', ctx)
const O = (ctx as {__out: Record<string, unknown>}).__out
const B = O.B as Float32Array
const NP = O.NP as number
const FR = O.FR as number
const N = O.N as number
const I = O.I as Record<string, number>
const refAttacks = O.ATTACKS as {name: string; keys: unknown[]; events?: unknown[]; slow?: Record<string, number>}[]

const UA = 34, FA = 34, TH = 44, SH_ = 44, TORSO = 58
const RAD = Math.PI / 180
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const wrap = (a: number) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a }
function paramAt(f: number, k: number) {
  if (f < 0) f = 0; if (f > N - 1) f = N - 1
  const i = Math.floor(f), t = f - i
  const p1 = B[i * NP + k]
  if (t < 1e-6) return p1
  const p0 = B[Math.max(i - 1, 0) * NP + k], p2 = B[Math.min(i + 1, N - 1) * NP + k], p3 = B[Math.min(i + 2, N - 1) * NP + k]
  const t2 = t * t, t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}
function arm(sh: number[], u: number, f: number) {
  const ua = clamp(u, -155, 155)
  let el = wrap(f - ua); el = clamp(el, -148, 148)
  const fa = (ua + el) * RAD, up = ua * RAD
  const e = [sh[0] + UA * Math.sin(up), sh[1] + UA * Math.cos(up)]
  const h = [e[0] + FA * Math.sin(fa), e[1] + FA * Math.cos(fa)]
  return [e, h]
}
function leg(hip: number[], tx: number, ty: number) {
  let vx = tx - hip[0], vy = ty - hip[1], d = Math.hypot(vx, vy)
  const maxReach = TH + SH_ - 2, minReach = 12
  if (d > maxReach) { vx *= maxReach / d; vy *= maxReach / d; d = maxReach }
  if (d < minReach) { const inv = 1 / (d || 1); vx *= minReach * inv; vy *= minReach * inv; d = minReach }
  const mxp = hip[0] + vx / 2, myp = hip[1] + vy / 2
  const h = Math.sqrt(Math.max(0, TH * TH - d * d / 4))
  const p1 = [-vy / d, vx / d], p2 = [vy / d, -vx / d]
  const score = (p: number[]) => p[0] * 0.85 + p[1] * -0.55
  const pp = score(p1) > score(p2) ? p1 : p2
  return {k: [mxp + pp[0] * h, myp + pp[1] * h], f: [hip[0] + vx, hip[1] + vy]}
}
function refJoints(ai: number, fi: number) {
  const gf = ai * FR + fi
  const q: number[] = []
  for (let k = 0; k < NP; k++) q.push(paramAt(gf, k))
  const hip = [q[I.x], -q[I.hy]]
  const sa = clamp(q[I.sp], -48, 58) * RAD
  const ux = Math.sin(sa), uy = -Math.cos(sa)
  const sh = [hip[0] + (TORSO - 4) * ux, hip[1] + (TORSO - 4) * uy]
  const neck = [hip[0] + TORSO * ux, hip[1] + TORSO * uy]
  const ha = (clamp(q[I.sp], -48, 58) + clamp(q[I.hd], -42, 42)) * RAD
  const head = [neck[0] + 15 * Math.sin(ha), neck[1] - 15 * Math.cos(ha)]
  const [, bh] = arm(sh, q[I.bau], q[I.baf])
  const [, lh] = arm(sh, q[I.lau], q[I.laf])
  const bl = leg(hip, q[I.bfx], -q[I.bfy])
  const fl = leg(hip, q[I.ffx], -q[I.ffy])
  const o = (a: number[]) => ({x: a[0], y: a[1]})
  return {hip: o(hip), sh: o(sh), head: o(head), bh: o(bh), lh: o(lh), bk: o(bl.k), bf: o(bl.f), fk: o(fl.k), ff: o(fl.f)}
}
const geom = makeFighterGeom()
function ourJoints(clip: ReturnType<typeof unarmedAttack>['clip'], t: number) {
  const pose = new Float32Array(28)
  sampleClip(clip, t, pose)
  const g = solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
  // COPY: the solver hands back shared vectors, and keeping references here
  // silently aliases every frame to the last solve.
  const c = (v: { x: number; y: number }) => ({ x: v.x, y: v.y })
  const sh = c(g.shoulderL)
  const sh2 = c(g.shoulderR)
  return {hip: c(g.hip), sh: {x: (sh.x + sh2.x) / 2, y: (sh.y + sh2.y) / 2},
    head: c(g.headC), bh: c(g.handR), lh: c(g.handL), bk: c(g.kneeR), bf: c(g.ankleR),
    fk: c(g.kneeL), ff: c(g.ankleL)}
}
type P = Record<string, {x: number; y: number}>
const KEYS = ['hip', 'sh', 'head', 'bh', 'lh', 'bk', 'bf', 'fk', 'ff'] as const

function profile(frames: P[], scale: number) {
  const d: number[] = []
  for (let i = 1; i < frames.length; i++) {
    let a = 0
    for (const k of KEYS) a += Math.hypot(frames[i][k].x - frames[i - 1][k].x, frames[i][k].y - frames[i - 1][k].y)
    d.push(a / scale)
  }
  const max = Math.max(...d), mean = d.reduce((s, v) => s + v, 0) / d.length
  const dwell = d.filter((v) => v < max * 0.1).length / d.length
  const active = d.filter((v) => v > max * 0.5).length / d.length
  const peakAt = d.indexOf(max) / d.length
  const h = Math.hypot(frames[0].sh.x - frames[0].hip.x, frames[0].sh.y - frames[0].hip.y)
  return {max: max / h, mean: mean / h, peakMean: max / mean, dwell, active, peakAt}
}
const f3 = (n: number) => n.toFixed(3)
const pct = (n: number) => (n * 100).toFixed(0) + '%'

// ── amplitude: how far the striking hand actually travels, in arm lengths ──
function reachOf(frames: P[]) {
  let best = 0
  for (const f of frames) {
    const arm = Math.hypot(f.sh.x - f.hip.x, f.sh.y - f.hip.y)
    const r = Math.max(Math.hypot(f.bh.x - f.sh.x, f.bh.y - f.sh.y), Math.hypot(f.lh.x - f.sh.x, f.lh.y - f.sh.y)) / arm
    if (r > best) best = r
  }
  return best
}
console.log('AMPLITUDE — striking hand from shoulder, in shoulder-to-hip lengths')
const refReach: number[] = []
for (let ai = 0; ai < refAttacks.length; ai++) {
  const frames: P[] = []
  for (let fi = 0; fi < FR; fi++) frames.push(refJoints(ai, fi) as unknown as P)
  refReach.push(reachOf(frames))
}
console.log('  reference  ' + refReach.map((v) => v.toFixed(2)).join('  '))
const ourReach: string[] = []
for (const id of ['l1', 'l3', 'viperPalm', 'avalancheElbow', 'cyclone', 'ironRoot', 'omegaPalm']) {
  const clip = unarmedAttack(ATTACKS[id]).clip
  const n = Math.round(clip.dur * 24) + 1
  const frames: P[] = []
  for (let i = 0; i < n; i++) frames.push(ourJoints(clip, Math.min(clip.dur, i / 24)) as unknown as P)
  let md = 0, mArm = 0
  for (const f of frames) {
    md = Math.max(md, Math.hypot(f.bh.x - f.sh.x, f.bh.y - f.sh.y), Math.hypot(f.lh.x - f.sh.x, f.lh.y - f.sh.y))
    mArm = Math.max(mArm, Math.hypot(f.sh.x - f.hip.x, f.sh.y - f.hip.y))
  }
  ourReach.push(id + ' ' + reachOf(frames).toFixed(2) + ` (hand${md.toFixed(1)}/arm${mArm.toFixed(1)})`)
}
console.log('  ours       ' + ourReach.join('  '))

console.log('\nREFERENCE (32 frames @24fps, its own bake + Catmull-Rom)')
const refRows: string[] = []
for (let ai = 0; ai < refAttacks.length; ai++) {
  const frames: P[] = []
  for (let fi = 0; fi < FR; fi++) frames.push(refJoints(ai, fi) as unknown as P)
  const A = refAttacks[ai]; const name = A.name
  const p = profile(frames, 1)
  const slowN = Object.keys(A.slow ?? {}).length
  refRows.push(`  ${(name.slice(0, 24) + ' k' + A.keys.length + ' s' + slowN).padEnd(31)} peak ${f3(p.max)}  mean ${f3(p.mean)}  peak/mean ${p.peakMean.toFixed(1)}  still ${pct(p.dwell)}  fast ${pct(p.active)}  peak@${pct(p.peakAt)}`)
}
console.log(refRows.join('\n'))

console.log('\nOURS (unarmed set, sampled on its own 24fps bake grid)')
const ours: string[] = []
for (const id of ['l1', 'l3', 'viperPalm', 'avalancheElbow', 'cyclone', 'ironRoot', 'omegaPalm']) {
  const m = unarmedAttack(ATTACKS[id])
  const clip = m.clip
  const n = Math.round(clip.dur * 24) + 1
  const frames: P[] = []
  for (let i = 0; i < n; i++) frames.push(ourJoints(clip, Math.min(clip.dur, i / 24)) as unknown as P)
  const p = profile(frames, 1)
  ours.push(`  ${(id + ' ' + clip.dur.toFixed(2) + 's/' + n + 'f').padEnd(27)} peak ${f3(p.max)}  mean ${f3(p.mean)}  peak/mean ${p.peakMean.toFixed(1)}  still ${pct(p.dwell)}  fast ${pct(p.active)}  peak@${pct(p.peakAt)}`)
}
console.log(ours.join('\n'))
