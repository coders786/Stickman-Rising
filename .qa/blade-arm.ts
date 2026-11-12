/** While a sword is drawn, the blade belongs to the RIGHT ARM. A clip that
 * never moves shR/elR/wrR leaves the blade welded to a stale pose, so its
 * hitbox points wherever the last state left it. This flags those clips. */
import { ATTACKS } from '../src/game/combat/attacks'
import { CH } from '../src/game/anim/pose'
const arm = [CH.shR, CH.elR, CH.wrR]
console.log('attack        shR range   elR range   wrR range   verdict')
for (const id of Object.keys(ATTACKS)) {
  const d = (ATTACKS as any)[id]
  const fr = d.clip?.frames ?? []
  if (!fr.length) continue
  const rng = arm.map((c) => {
    let lo = 1e9, hi = -1e9
    for (const k of fr) { const v = k.p[c] ?? 0; lo = Math.min(lo, v); hi = Math.max(hi, v) }
    return hi - lo
  })
  const total = rng[0] + rng[1] + rng[2]
  const bad = total < 1e-6
  console.log(id.padEnd(13),
    rng.map((r) => r.toFixed(2).padStart(9)).join(' '),
    bad ? '  <- ARM NEVER POSED' : '')
}
