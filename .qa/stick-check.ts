/** STICK-LIMB METER — the actual "Alan Becker" defect.
 *
 * A stick figure reads stiff when its limbs are STRAIGHT LINES that pivot
 * at the root: the arm has no elbow bend, the leg has no knee. Measured as
 * the solved joint angle between the two bones: 0 = a rigid stick,
 * PI/2 = a proper hinge, PI = fully folded.
 */
import { MOVES } from '../src/game/combat/moveset'
import { sampleClip } from '../src/game/anim/animator'
import { makePose, CH } from '../src/game/anim/pose'
const N = 120
const CORE = ['l1','l2','l3','l4','l5','h1','h2','h3','retreat','dashSlash']
const D = 180 / Math.PI
console.log('move        elbowL  elbowR  kneeL   kneeR   |  min  |  straight%')
for (const id of process.argv.slice(2)) {
  const m = (MOVES as Record<string, any>)[id]; if (!m?.clip) continue
  const c = m.clip
  const acc = { elL: 0, elR: 0, knL: 0, knR: 0 }
  let minBend = 99, straight = 0, tot = 0
  for (let i = 0; i <= N; i++) {
    const p = makePose(); sampleClip(c, (i / N) * c.dur, p)
    // signed flexion -> the hinge angle (0 = straight)
    const elL = Math.abs(p[CH.elL]) * D, elR = Math.abs(p[CH.elR]) * D
    const knL = Math.abs(p[CH.kneeL]) * D, knR = Math.abs(p[CH.kneeR]) * D
    acc.elL += elL; acc.elR += elR; acc.knL += knL; acc.knR += knR
    for (const v of [elL, elR, knL, knR]) {
      if (v < minBend) minBend = v
      if (v < 15) straight++     // within 15deg of a rigid stick
      tot++
    }
  }
  console.log(
    id.padEnd(11),
    ...[acc.elL, acc.elR, acc.knL, acc.knR].map(v => (v / (N + 1)).toFixed(0).padStart(6) + '\u00b0'),
    ' |', minBend.toFixed(0).padStart(4) + '\u00b0',
    ' |', (100 * straight / tot).toFixed(0).padStart(6) + '%',
  )
}

/* ---- FROZEN-JOINT METER -------------------------------------------
 * The Alan Becker signature is not "bent wrong" — it is a limb that never
 * changes at all, so it pivots as one rigid bar. Measure each joint's
 * total travel across the clip; anything under 5deg is a frozen stick.
 */
console.log('\nFROZEN JOINTS (total travel across the clip, deg):')
console.log('move        hipL   kneeL   hipR   kneeR   shL    elL    shR    elR   frozen')
for (const id of (process.argv.slice(2).length ? process.argv.slice(2) : CORE)) {
  const m = (MOVES as Record<string, any>)[id]; if (!m?.clip) continue
  const c = m.clip
  const chans = [CH.hipL, CH.kneeL, CH.hipR, CH.kneeR, CH.shL, CH.elL, CH.shR, CH.elR]
  const names = ['hipL', 'kneeL', 'hipR', 'kneeR', 'shL', 'elL', 'shR', 'elR']
  const travel = chans.map(i => {
    let lo = Infinity, hi = -Infinity
    for (const f of c.frames) { const v = f.p[i]; if (v < lo) lo = v; if (v > hi) hi = v }
    return (hi - lo) * D
  })
  const frozen = names.filter((_, i) => travel[i] < 5)
  console.log(id.padEnd(11), ...travel.map(v => v.toFixed(0).padStart(6)), '  ' + (frozen.length ? frozen.join(',') : 'none'))
}
