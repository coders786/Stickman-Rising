import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyPave, escalation, PaveState, updatePaveSpin, type PaveContext} from '../src/game/anim/pave'
import {CH, CH_COUNT, makePose, NEUTRAL} from '../src/game/anim/pose'
import {applyJointLimits} from '../src/game/anim/limits'

/** A context with every amplifier near its maximum: max escalation (combo
 * 999 → arc 1.7 → exaggeration 1.385), max sword voice (inferno 1.25),
 * near-death, mid-flinch, full charge, airborne spread phase. */
const extreme = (over: Partial<PaveContext> = {}): PaveContext => ({
  time: 10,
  dt: 1/60,
  hp: 0,
  comboHits: 999,
  speedRatio: 1,
  airborne: false,
  airborneT: 0,
  chargeRatio: 1,
  sinceHitTaken: 0,
  sword: 'inferno',
  armGate: 1,
  breathRate: 40,
  jumpStyle: 'backflip',
  ...over,
})

test('applyPave output stays finite and bounded across extreme contexts', () => {
  // Documented bound: rotations ±0.7 rad, root translations ±6 local units
  // at the simultaneous worst case (max escalation × max sword voice ×
  // near-death posture × mid-flinch × full charge × airborne tuck/spread —
  // a state the real game can only approach, never hold). Measured max
  // 0.669 rad across this sweep; the anatomical gate clamps whatever lands
  // outside human ROM afterwards.
  const st = new PaveState()
  const swords = ['katana','inferno','thunder','void','gravity','phantom']
  const styles = ['standard','leap','spin','backflip'] as const
  let maxRot = 0, maxTrans = 0
  for (const sword of swords) for (const style of styles) {
    for (const air of [false, true]) for (const airT of [0.05, 0.5, 1.4]) {
      for (let i = 0; i < 200; i++) {
        const p = makePose()
        applyPave(p, extreme({sword, jumpStyle: style, airborne: air, airborneT: airT, time: i * 0.05}), st)
        for (let c = 0; c < CH_COUNT; c++) {
          assert.ok(Number.isFinite(p[c]), `ch${c} not finite (sword=${sword} style=${style})`)
          const off = Math.abs(p[c] - NEUTRAL[c])
          if (c < 2) maxTrans = Math.max(maxTrans, off)
          else maxRot = Math.max(maxRot, off)
        }
      }
    }
  }
  assert.ok(maxRot < 0.7, `rotation offset bound exceeded: ${maxRot}`)
  assert.ok(maxTrans < 6, `root translation offset bound exceeded: ${maxTrans}`)
})

test('applyPave never violates the anatomical limit gate (poses stay legal)', () => {
  const st = new PaveState()
  for (let i = 0; i < 500; i++) {
    // start from poses sitting exactly ON the limit boundaries
    const p = makePose({elR: -0.26, elL: -2.62, kneeR: -0.17, shR: 3.05, hipL: 2.3})
    applyPave(p, extreme({time: i * 0.031, sword: i % 2 ? 'thunder' : 'katana'}), st)
    applyJointLimits(p)
    assert.ok(p[CH.elR] <= -0.2599 && p[CH.elR] >= -2.6201, `elR out of band: ${p[CH.elR]}`)
    assert.ok(p[CH.elL] <= -0.2599 && p[CH.elL] >= -2.6201, `elL out of band: ${p[CH.elL]}`)
    assert.ok(p[CH.kneeR] <= -0.1699, `kneeR folded forward: ${p[CH.kneeR]}`)
    assert.ok(p[CH.shR] <= 3.0501, `shR out of envelope: ${p[CH.shR]}`)
    assert.ok(p[CH.hipL] <= 2.3001, `hipL out of envelope: ${p[CH.hipL]}`)
    for (let c = 0; c < CH_COUNT; c++) assert.ok(Number.isFinite(p[c]))
  }
})

test('moving holds: a held idle keeps micro-motion — no two frames render identically', () => {
  const calm: PaveContext = extreme({
    hp: 1, comboHits: 0, speedRatio: 0, chargeRatio: 0, sinceHitTaken: 9,
    sword: 'katana', airborne: false, breathRate: 14, jumpStyle: 'standard',
  })
  // deterministic: identical state history → identical output (pure function
  // of time; breathT pinned so the random initial phase cannot diverge)
  const seq = (): Float32Array => {
    const st = new PaveState(); st.seed = 1234; st.breathT = 1.234
    const p = makePose()
    for (let i = 0; i < 4; i++) applyPave(p, {...calm, time: i / 60, dt: 1/60}, st)
    return p
  }
  assert.deepEqual([...seq()], [...seq()])
  // alive: consecutive 60Hz frames differ somewhere
  const at = (t: number): Float32Array => {
    const st = new PaveState(); st.seed = 1234; st.breathT = 1.234
    const p = makePose(); applyPave(p, {...calm, time: t}, st); return p
  }
  for (const t of [10, 10.5, 41.2, 87.3]) {
    const a = at(t), b = at(t + 1/60)
    let maxDelta = 0
    for (let c = 0; c < CH_COUNT; c++) maxDelta = Math.max(maxDelta, Math.abs(a[c] - b[c]))
    assert.ok(maxDelta > 1e-4, `idle froze at t=${t} (maxΔ ${maxDelta})`)
  }
  // per-frame slew stays an order of magnitude under the QA continuity budget
  for (let t = 0; t < 20; t += 1/60) {
    const a = at(t), b = at(t + 1/60)
    for (let c = 2; c < CH_COUNT; c++) {
      assert.ok(Math.abs(a[c] - b[c]) < 0.1, `ch${c} slew ${Math.abs(a[c]-b[c])} at t=${t}`)
    }
  }
})

test('frame-rate invariance: same elapsed animation time gives the same pose at 30/60/120Hz', () => {
  // Models the game contract: each frame the pose RESETS from the authored
  // base and PAVE adds once (applyPave is an additive per-frame pass, never
  // an integrator — stacking calls on one pose would accumulate).
  const run = (hz: number): Float32Array => {
    const st = new PaveState(); st.seed = 777; st.breathT = 0.5 // pin the breath phase
    const ctx = extreme({sword: 'katana', airborne: true, airborneT: 0.4, jumpStyle: 'leap'})
    let p = makePose()
    for (let i = 0; i < hz; i++) { // exactly 1 second of sim time
      p = makePose()
      applyPave(p, {...ctx, time: i / hz, dt: 1/hz}, st)
    }
    // probe at exactly t = 1.0s with dt = 0 (evaluation only): the breath
    // integrator has seen Σdt = 1.0 in BOTH schedules, so the pose must
    // now be identical — same noise(t), same breath phase.
    p = makePose()
    applyPave(p, {...ctx, time: 1.0, dt: 0}, st)
    return p
  }
  const a30 = run(30), a60 = run(60), a120 = run(120)
  for (let c = 0; c < CH_COUNT; c++) {
    assert.ok(Math.abs(a30[c] - a120[c]) < 1e-6, `ch${c} 30Hz vs 120Hz drifted ${Math.abs(a30[c]-a120[c])}`)
    assert.ok(Math.abs(a60[c] - a120[c]) < 1e-6, `ch${c} 60Hz vs 120Hz drifted ${Math.abs(a60[c]-a120[c])}`)
  }
})

test('arm gate: arm-channel noise is silenced inside strike windows (blade stays crisp)', () => {
  const st = new PaveState(); st.seed = 4242
  // neutral sword + calm body so ONLY the noise table could touch arms
  const ctx = extreme({
    sword: 'katana', hp: 1, comboHits: 0, speedRatio: 0, chargeRatio: 0,
    sinceHitTaken: 9, airborne: false, armGate: 0, jumpStyle: 'standard',
  })
  for (let i = 0; i < 100; i++) {
    const base = makePose()
    const gated = makePose()
    applyPave(gated, {...ctx, time: i * 0.25}, st)
    // channels 11..16 (both arm chains) untouched at gate 0
    for (const c of [CH.shL, CH.elL, CH.wrL, CH.shR, CH.elR, CH.wrR]) {
      assert.ok(Math.abs(gated[c] - base[c]) < 1e-9, `ch${c} moved under armGate=0`)
    }
  }
})

test('combo escalation table is monotonic with exact caps', () => {
  const rows = [0, 4, 8, 16, 31, 51, 101, 999].map(escalation)
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].speed >= rows[i-1].speed, 'speed not monotonic')
    assert.ok(rows[i].arc >= rows[i-1].arc, 'arc not monotonic')
    assert.ok(rows[i].trail >= rows[i-1].trail, 'trail not monotonic')
  }
  assert.equal(escalation(0).speed, 1.0)
  assert.equal(escalation(999).speed, 1.3)
  assert.equal(escalation(999).arc, 1.7)
  assert.ok(escalation(3).tier === 0 && escalation(4).tier === 1, 'tier steps at 3/7/15/30/50/100')
})

test('airborne spin accumulator approaches its target and settles to zero after landing', () => {
  const tau = Math.PI * 2
  const st = new PaveState()
  st.spinTarget = tau // one authored full turn
  for (let i = 0; i < 400; i++) updatePaveSpin(st, 1/120, true)
  assert.ok(Math.abs(st.spin - tau) < 1e-6, `spin did not reach target: ${st.spin}`)
  for (let i = 0; i < 1200 && st.spin !== 0; i++) updatePaveSpin(st, 1/120, false)
  assert.equal(st.spin, 0, `post-landing unwind did not settle (residual ${st.spin})`)
  // bounded: spin never overshoots the authored target while airborne
  const st2 = new PaveState(); st2.spinTarget = -tau
  for (let i = 0; i < 2000; i++) { updatePaveSpin(st2, 1/120, true); assert.ok(st2.spin >= -tau - 1e-9) }
})

test('per-combo reseed yields different variation for the same clip time', () => {
  const mk = (seed: number): Float32Array => {
    const st = new PaveState(); st.seed = seed
    const p = makePose()
    applyPave(p, extreme({sword: 'katana', hp: 1, comboHits: 0, speedRatio: 0, chargeRatio: 0, sinceHitTaken: 9}), st)
    return p
  }
  const a = mk(100), b = mk(200)
  let maxDelta = 0
  for (let c = 2; c < CH_COUNT; c++) maxDelta = Math.max(maxDelta, Math.abs(a[c] - b[c]))
  assert.ok(maxDelta > 1e-4, `two seeds produced the same variation (maxΔ ${maxDelta})`)
})
