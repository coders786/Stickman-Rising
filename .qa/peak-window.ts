/** THE SLYNYRD LAW, MEASURED: does a strike's hit window cover the frame its
 *  striking limb is actually farthest forward?
 *
 * `research/SPRITE-SHEETS.md` records the reference studio's seven beats and
 * the conclusion drawn from them: the limb is at maximum reach across HIT
 * *and* FOLLOW THRU, so a window placed on a single contact event is too
 * short by construction. This walks every unarmed clip, finds the beat where
 * the DEF'S OWN striking limb (strikeHand + strikeJoint) is farthest forward
 * in the projected rig, and reports any whose window does not contain it.
 *
 * Deliberately measures the authored limb, not max(both hands): a two-handed
 * or spinning clip can put the OFF hand furthest forward at a beat that has
 * nothing to do with the strike, which produced false positives when this
 * first used max(handR, handL).
 */
import { ATTACKS } from '../src/game/combat/attacks'
import { unarmedAttack } from '../src/game/combat/unarmed'
import { makePose } from '../src/game/anim/pose'
import { sampleClip } from '../src/game/anim/animator'
import { solveFighter3D, makeFighterGeom } from '../src/game/anim/rig3d'
import { PLAYER_SPEC } from '../src/game/anim/skeleton'

const SCALE = 1.32
type Bad = { id: string; win: [number, number]; peak: number; dur: number }
const bad: Bad[] = []
const seen = new Set<string>()

for (const base of Object.values(ATTACKS) as any[]) {
  const a: any = unarmedAttack(base)
  if (!a || seen.has(a.id)) continue
  seen.add(a.id)
  const c = a.clip
  const right = a.strikeHand === 'right'
  const joint = a.strikeJoint ?? 'hand'
  let peak = 0, peakT = 0
  const N = 240
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * c.dur
    const p = makePose(); sampleClip(c, t, p)
    const g = makeFighterGeom(); solveFighter3D(p, PLAYER_SPEC, g, PLAYER_SPEC.blade * 1.06, 1)
    const pt = joint === 'foot' ? (right ? g.ankleR : g.ankleL)
      : joint === 'elbow' ? (right ? g.elbR : g.elbL)
        : joint === 'knee' ? (right ? g.kneeR : g.kneeL)
          : joint === 'shoulder' ? (right ? g.shoulderR : g.shoulderL)
            : (right ? g.handR : g.handL)
    if (pt.x > peak) { peak = pt.x; peakT = t }
  }
  const inWin = peakT >= a.hit.start && peakT <= a.hit.end
  if (!inWin) bad.push({ id: a.id, win: [a.hit.start, a.hit.end], peak: peakT, dur: c.dur })
  console.log(
    a.id.padEnd(15), (a.strikeHand + '/' + joint).padEnd(13),
    'win', a.hit.start.toFixed(2) + '-' + a.hit.end.toFixed(2),
    'peak', peakT.toFixed(3), '(' + (peak * SCALE).toFixed(0) + 'px)',
    inWin ? '' : '  <-- PEAK OUTSIDE WINDOW')
}
console.log('\n' + bad.length + ' of ' + seen.size + ' peaks outside their window: ' + bad.map((b) => b.id).join(', '))
/* ------------------------------------------------------------------ */
/* IMPORTANT: a peak outside the window is NOT automatically a bug.     */
/* ------------------------------------------------------------------ */
// This was measured the hard way. Moving sakugaDragon / omegaPalm /
// srOmega onto their peak made all three stop connecting entirely (they
// connect today at aT 0.33 / 0.46 / 0.71, i.e. INSIDE their current
// windows and well before the peak). The reason is geometric: a body at
// the 34px standoff is already inside the fist's sphere long before the
// limb is at maximum extension, so the strike lands on the way THROUGH,
// and a window placed on the peak arrives after the target has been
// pushed away -- it opens on air.
//
// So this probe answers "is the window on the extension beat?", which is
// a useful review question, but the acceptance test is
// `.qa/unarmed-connect.ts` (does the joint reach the body at the frame
// damage is dealt). Do not retune a window from this file alone.
if (bad.length) {
  console.log('\nREVIEW (not a defect list -- verify with .qa/unarmed-connect.ts first):')
  for (const b of bad) {
    const open = Math.max(0, b.peak - 0.02)
    const hold = Math.min(b.dur * 0.92, b.peak + Math.max(0.06, (b.dur - b.peak) * 0.5))
    console.log('  ' + b.id.padEnd(16) + 'peak ' + b.peak.toFixed(3) + '  window ' +
      b.win[0].toFixed(2) + '-' + b.win[1].toFixed(2) + '  (a window on the peak would be ' +
      open.toFixed(2) + '-' + hold.toFixed(2) + ')')
  }
}
