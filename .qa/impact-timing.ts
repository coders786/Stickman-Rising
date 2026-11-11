/** IMPACT TIMING AUDIT — does the hit land on the fastest frame?
 *
 * The reference studio's law: an impact EVENT sits on the frame where the
 * striking limb is travelling fastest (`events:[{f:12,…}]` on the key whose
 * ease is `in`). If the hitbox opens while the limb is still slow — or after
 * it has already stopped — the hit reads as disconnected no matter how good
 * the pose is: nothing in the picture corresponds to the damage.
 *
 * This audit solves every empty-hand clip through the production rig at
 * 120 Hz, tracks the striking joint's world speed, and reports:
 *
 *   peak@   the frame of maximum limb speed
 *   offset  how far the authored hit window opens from that frame
 *   ratio   limb speed when the window opens / peak speed   (want ≥ 0.80)
 *
 * Run: node --import tsx .qa/impact-timing.ts [--all]
 */
import { MOVES } from '../src/game/combat/moveset'
import { sampleClip } from '../src/game/anim/animator'
import { makePose } from '../src/game/anim/pose'
import { solveFighter3D, makeFighterGeom } from '../src/game/anim/rig3d'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'

const geom = makeFighterGeom()
const ONLY_NEW = !process.argv.includes('--all')
const NEW_SET = new Set(['viperPalm', 'avalancheElbow', 'cyclone', 'ironRoot', 'omegaPalm'])

interface Row { id: string; contact: number; peakAt: number; offsetMs: number; peak: number; ratio: number; verdict: string }

function jointOf(def: typeof MOVES[string]) {
  const j = def.strikeJoint ?? 'hand'
  const left = def.strikeHand === 'left'
  return (g: ReturnType<typeof solveFighter3D>): { x: number; y: number } =>
    j === 'foot' ? (left ? g.ankleL : g.ankleR)
      : j === 'knee' ? (left ? g.kneeL : g.kneeR)
        : j === 'elbow' ? (left ? g.elbL : g.elbR)
          : (left ? g.handL : g.handR)
}

/** The limb is "extended" (the strike itself) when it is far from its root.
 * Retracting to the guard travels fast too — without this filter the recovery
 * looks like the fastest frame and an auto-retime would put the hitbox on the
 * way back. */
function rootOf(def: typeof MOVES[string]) {
  const left = def.strikeHand === 'left'
  const leg = (def.strikeJoint ?? 'hand') === 'foot' || def.strikeJoint === 'knee'
  return (g: ReturnType<typeof solveFighter3D>): { x: number; y: number } =>
    leg ? (left ? g.hipPtL : g.hipPtR) : (left ? g.shoulderL : g.shoulderR)
}

interface Sample { t: number; v: number; ext: number }

function samples(id: string): { list: Sample[]; peak: number; peakAt: number; maxExt: number } {
  const def = MOVES[id]
  const pick = jointOf(def)
  const root = rootOf(def)
  const pose = makePose()
  const dt = 1 / 120
  const list: Sample[] = []
  let prev: { x: number; y: number } | null = null
  let peak = 0
  let peakAt = 0
  let maxExt = 0
  for (let t = 0; t <= def.clip.dur + 1e-9; t += dt) {
    sampleClip(def.clip, Math.min(t, def.clip.dur), pose)
    const g = solveFighter3D(pose, PLAYER_SPEC, geom, PLAYER_SPEC.blade)
    const p = pick(g)
    const r = root(g)
    const ext = Math.hypot(p.x - r.x, p.y - r.y)
    if (ext > maxExt) maxExt = ext
    if (prev) {
      const v = Math.hypot(p.x - prev.x, p.y - prev.y) / dt
      list.push({ t, v, ext })
      if (v > peak) { peak = v; peakAt = t }
    }
    prev = { x: p.x, y: p.y }
  }
  return { list, peak, peakAt, maxExt }
}

function audit(id: string): Row {
  const def = MOVES[id]
  const { list, peak, maxExt } = samples(id)
  const extFloor = maxExt * 0.6
  let best = 0
  let bestAt = def.hit.start
  for (const s of list) {
    if (s.ext < extFloor) continue
    if (s.v > best) { best = s.v; bestAt = s.t }
  }
  // What matters gameplay-wise is whether the open window COVERS the fast
  // frame, not whether it happens to open on the exact 8 ms sample: the
  // engine tests the window every 60 Hz tick.
  let atContact = 0
  for (const s of list) if (s.t >= def.hit.start - 1e-6 && s.t <= def.hit.end + 1e-6 && s.v > atContact) atContact = s.v
  const ratio = peak > 0 ? atContact / peak : 1
  const verdict = ratio >= 0.8 && Math.abs(bestAt - def.hit.start) <= 0.034 ? 'OK'
    : ratio >= 0.6 ? 'LATE/EARLY' : 'DISCONNECTED'
  return { id, contact: def.hit.start, peakAt: bestAt, offsetMs: (bestAt - def.hit.start) * 1000, peak: best, ratio, verdict }
}

const ids = Object.keys(MOVES).filter((id) => !ONLY_NEW || NEW_SET.has(id))
if (process.argv.includes('--json')) {
  const out: Record<string, { start: number; end: number; ratio: number }> = {}
  for (const id of ids) {
    const def = MOVES[id]
    if (def.hit.multiHit) continue // multi-contact: the window spans many beats
    const r = audit(id)
    if (r.ratio >= 0.85 && Math.abs(r.offsetMs) <= 20) continue
    const len = def.hit.end - def.hit.start
    out[id] = { start: Math.round(r.peakAt * 1000) / 1000, end: Math.round((r.peakAt + len) * 1000) / 1000, ratio: r.ratio }
  }
  console.log(JSON.stringify(out, null, 1))
  process.exit(0)
}
const rows = ids.map(audit).sort((a, b) => a.ratio - b.ratio)

console.log('EMPTY-HAND IMPACT TIMING  (ratio = limb speed when the hitbox opens / peak speed)')
console.log('id'.padEnd(16), 'contact'.padStart(8), 'peak@'.padStart(7), 'offset'.padStart(8), 'peak u/s'.padStart(9), 'ratio'.padStart(7), '  verdict')
for (const r of rows) {
  console.log(
    r.id.padEnd(16),
    r.contact.toFixed(3).padStart(8),
    r.peakAt.toFixed(2).padStart(7),
    (r.offsetMs.toFixed(0) + 'ms').padStart(8),
    r.peak.toFixed(0).padStart(9),
    r.ratio.toFixed(2).padStart(7),
    '  ' + r.verdict,
  )
}
const bad = rows.filter((r) => r.verdict !== 'OK').length
console.log(`\n${rows.length - bad}/${rows.length} connected · ${bad} need retiming`)
process.exitCode = bad === 0 ? 0 : 1
