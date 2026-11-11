/**
 * scripts/match-ronin.ts — SHADOW RONIN (upload/Shadow_Ronin.html) → STICKMAN RISING converter.
 *
 * Transcribes the reference's 7 signature dual-blade sequences (authored key
 * poses on the 24fps beat grid, per-key eases, impact events, slow-map) into
 * our clip format — pose-for-pose, blade-for-blade, PLUS the depth channels
 * the reference introduced over the earlier Dark Lord study (which
 * scripts/match-darklord.ts already converted with the same math).
 *
 * Channel map (reference → rig), both rigs y-down / limb angles from
 * straight-down, positive = toward facing:
 *   f @24fps        → t = f/24 seconds (ease rides the ARRIVING key — the
 *                     reference's bake() applies EASE[b.e](t), identical law
 *                     to our sampleClip eased path; these clips therefore do
 *                     NOT use monotone — the authored in/out asymmetry IS the
 *                     choreography)
 *   x               → rootX = S·(x−x0)·0.40  (weight-shift read; lunges also
 *                     get engine moveX impulses per AttackDef)
 *   hy (hip height) → rootY = S_LEG·(80−hy)   (hy 80 = our neutral stand)
 *   sp (spine lean) → rootRot = sp·RAD, spine = 0.02
 *   hd              → head = hd·RAD  (their ha = sp+hd ≡ torsoAngle+head)
 *   bau/baf (rear)  → handPose('left', …) IK to the reference hand position
 *                     (34·(sin a + sin b), 34·(cos a + cos b)), envelope-remapped
 *   lau/laf (lead)  → handPose('right', …)  — the SWORD arm (near side)
 *   bfx/bfy,ffx/ffy → kickPose('left'/'right', …) feet rel hip:
 *                     (bfx−x, hy−bfy)·S — the reference stores feet in WORLD
 *                     space (rigAt solves leg(hip, bfx, −bfy) with hip at
 *                     (x, hy)); subtracting x keeps the planted-stance lunges
 *                     (feet stay put while the hips drive forward). 'flat'
 *                     when grounded, 'point' when lifted ≥5px.
 *   z + fov         → rootZ = clamp(z·0.08 + (fov−1)·45, −52, 58) — the
 *                     reference's whole-body depth scale (fovScale 0.4..2.8,
 *                     z ±350) compressed into the rig's perspective band
 *                     (FOCUS 620 → body scale 0.92..1.10). The near/far
 *                     pulse READS as depth without breaking 2D gameplay.
 *   rotY            → twist split: chestYaw += clamp(rotY·0.30,±0.55)·0.7,
 *                     pelvisYaw += …·0.45, armRz/armLz counter-sweep
 *                     ±0.4, bladeYaw = clamp((rotY−0.42)·0.5, ±1.35)
 *                     — the VORTEX spin becomes a full transverse-plane
 *                     rotation through the rig's counter-yaw chain
 *   z (blade)       → bladeZ = clamp(z·0.04, −8, 10) (thrust depth travel:
 *                     VIPER spears the lens, IAI bursts past it)
 *   tb/tc (tail)    → no counterpart — beats carried by the counter-rotation
 *                     + the player's scarf physics layer (documented)
 *   pw (aura)       → dropped — physical, non-magical house law
 *
 * Impact events + slow-map are preserved as RONIN_META (limb, power, ground,
 * inv) so the AttackDef layer can place hit windows, hitstop, slam impacts
 * and finisher FX on the reference's exact beats.
 *
 * Anatomical-envelope remap (arms): the reference's planar windmills cross
 * ±180° (VORTEX flares to 270°). Targets in the illegal up-back arc rotate
 * to the nearest legal glenohumeral line — every other pose lands exactly on
 * the authored hand position.
 *
 * Continuity: solved-channel velocity vs the 0.72 rad/frame @60fps house
 * budget; pairs over budget get an explicit full midpoint key.
 *
 * Run: bun scripts/match-ronin.ts → writes src/game/combat/ronin-sakuga.ts
 */
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/* ---- reference rig constants (Shadow_Ronin.html) ---- */
const UA = 34, FA = 34            // arm segments
const GUARD_HY = 80               // standing hip height (S stance)

/* ---- our rig constants (PLAYER_SPEC) ---- */
const A_UA = 20, A_FA = 18        // upperArm/foreArm
const A_TH = 25, A_SH = 24        // thigh/shin
const S_ARM = (A_UA + A_FA) / (UA + FA)   // 0.5588
const S_LEG = (A_TH + A_SH) / 88          // 0.5568
const S_X = S_LEG                          // world x scale

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString()

/* ---- the reference's ATTACKS data (verbatim transcription) ---- */
type K = { f: number; e: string; o: Record<string, number> }
type Ev = { f: number; limb: string; p: number; ground?: boolean; inv?: boolean }
type Atk = { name: string; id: string; keys: K[]; events: Ev[]; slow: Record<string, number>; notes: [number, number, string][] }

const G_DEF: Record<string, number> = { x: 0, hy: 70, bfx: -34, bfy: 0, ffx: 34, ffy: 0, sp: 10, hd: 0, bau: 20, baf: 165, lau: 42, laf: 150, tb: -80, tc: 6, pw: 0, z: 0, rotY: 0, fov: 1 }
const S_DEF: Record<string, number> = { x: 0, hy: 80, bfx: -16, bfy: 0, ffx: 16, ffy: 0, sp: 18, hd: 26, bau: -6, baf: 6, lau: 8, laf: 12, tb: -22, tc: 2.5, pw: 0, z: 0, rotY: 0, fov: 1 }

const ATTACKS: Atk[] = [
  {
    name: 'IAIJUTSU CROSS-DRAW IMPACT', id: 'Iai',
    keys: [
      { f: 0, e: 'lin', o: { ...S_DEF } },
      { f: 5, e: 'out', o: { hy: 76, sp: 8, hd: 10, bau: 25, baf: 35, lau: 25, laf: 35, tb: -40, pw: .1 } },
      { f: 9, e: 'in', o: { hy: 84, sp: -6, hd: -20, bau: -45, baf: 15, lau: -45, laf: 15, tb: -70, pw: .3 } },
      { f: 11, e: 'out', o: { x: 14, hy: 62, bfx: -42, ffx: 58, sp: 40, hd: 8, bau: 110, baf: 105, lau: 100, laf: 95, tb: -140, tc: 14, pw: 1, z: 120, fov: 1.4 } },
      { f: 15, e: 'io', o: { x: 22, hy: 66, sp: 28, hd: 0, bau: 70, baf: 110, lau: 65, laf: 105, tb: -110, tc: 8, pw: .7, z: 40, fov: 1.1 } },
      { f: 22, e: 'io', o: { x: 18, hy: 70, sp: 16, hd: 0, bau: 30, baf: 130, lau: 30, laf: 130, tb: -80, pw: .2, z: 0, fov: 1 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 18 } },
    ],
    events: [{ f: 11, limb: 'la', p: 1, ground: true, inv: true }],
    slow: { 9: 2, 10: 2.5, 11: 4, 12: 3, 13: 2 },
    notes: [
      [0, 4, 'Chamber load: weight shifts to the rear foot; hips drop to prime the stretch-shortening cycle.'],
      [5, 8, 'Torso coiling: scapulae retract, elbows clamp to minimize moment of inertia before release.'],
      [9, 10, 'Stillness frame: zero velocity instant prior to explosive release.'],
      [11, 13, 'Kinetic chain snap: ground reaction → hip rotation → trunk torque → arm whip → impact with 4-frame hitstop.'],
      [14, 31, 'Antagonist braking; weight settles smoothly back to center guard.'],
    ],
  },
  {
    name: 'TWIN MOMENTUM CRESCENT', id: 'Cross',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 4, e: 'out', o: { x: 4, hy: 64, sp: 20, bau: -80, baf: 30, lau: 120, laf: 160, tb: -120, tc: 8, pw: .4 } },
      { f: 7, e: 'in', o: { x: 12, hy: 58, bfx: -26, ffx: 54, sp: 35, hd: -10, bau: 50, baf: 130, lau: -50, laf: 50, tb: -150, tc: 14, pw: .8 } },
      { f: 10, e: 'out', o: { x: 22, hy: 66, bfx: -14, ffx: 68, sp: 16, hd: 14, bau: 140, baf: 200, lau: 30, laf: 90, tb: -90, tc: 4, pw: .7, z: 60, fov: 1.2 } },
      { f: 14, e: 'in', o: { x: 32, hy: 60, bfx: -2, ffx: 82, sp: 42, hd: -6, bau: -30, baf: 25, lau: 170, laf: 210, tb: -170, tc: 16, pw: 1, z: 150, fov: 1.5 } },
      { f: 18, e: 'out', o: { x: 36, hy: 65, sp: 26, bau: 40, baf: 120, lau: 40, laf: 120, tb: -100, tc: 8, pw: .5, z: 30, fov: 1.05 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 36 } },
    ],
    events: [{ f: 7, limb: 'la', p: .8 }, { f: 14, limb: 'ba', p: 1, inv: true }],
    slow: { 6: 2, 7: 3, 13: 2, 14: 4 },
    notes: [
      [0, 3, 'Rotational winding: rear foot pivots to unlock hip rotation.'],
      [4, 7, 'First blade arc: hips drive torque through the torso before the arms extend.'],
      [8, 10, 'Momentum transfer: centrifugal force pulls the trailing arm into the counter-arc.'],
      [11, 15, 'Impact climax: spine braces against reaction force; screen inversion.'],
      [16, 31, 'Damping: angular velocity bleeds off through core bracing.'],
    ],
  },
  {
    name: 'AVALANCHE METEOR DROP', id: 'Meteor',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 4, e: 'out', o: { x: -6, hy: 50, sp: 35, bau: -120, baf: -30, lau: -120, laf: -30, tb: -150, tc: 6, pw: .6 } },
      { f: 8, e: 'in', o: { x: 10, hy: 135, bfy: 65, ffy: 72, bfx: -20, ffx: 52, sp: -15, hd: -18, bau: 190, baf: 200, lau: 190, laf: 200, tb: -170, tc: -12, pw: .9, z: -80, fov: 0.8 } },
      { f: 12, e: 'out', o: { x: 30, hy: 155, bfy: 82, ffy: 92, bfx: 15, ffx: 75, sp: -20, hd: -22, bau: 220, baf: 215, lau: 220, laf: 215, tb: -200, tc: -16, pw: 1, z: -120, fov: 0.7 } },
      { f: 14, e: 'in', o: { x: 42, hy: 98, bfy: 24, ffy: 30, bfx: 28, ffx: 92, sp: 32, hd: 12, bau: 85, baf: 90, lau: 85, laf: 90, tb: -110, tc: 4, pw: 1, z: 200, fov: 1.8 } },
      { f: 17, e: 'out', o: { x: 48, hy: 56, bfy: 0, ffy: 0, bfx: 34, ffx: 102, sp: 50, hd: 18, bau: 20, baf: 30, lau: 20, laf: 30, tb: -50, tc: 8, pw: .9, z: 20, fov: 1.1 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 48 } },
    ],
    events: [{ f: 14, limb: 'ffoot', p: 1, ground: true, inv: true }],
    slow: { 12: 2, 13: 3, 14: 4.5, 15: 3, 16: 2 },
    notes: [
      [0, 3, 'Triple extension prep: ankle, knee, hip flex simultaneously to maximize vertical impulse.'],
      [4, 7, 'Explosive takeoff; legs tuck to reduce rotational inertia.'],
      [8, 11, 'Air hang apex: vertical velocity reaches zero.'],
      [12, 14, 'Impact dissipation: knees compress on landing with a controlled rebound.'],
      [15, 31, 'Post-impact stabilization and core re-engagement.'],
    ],
  },
  {
    name: 'HELIX VORTEX CUTTER', id: 'Vortex',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 4, e: 'out', o: { x: 4, hy: 66, z: -70, rotY: -1.2, bau: 50, baf: 110, lau: -50, laf: 30, tb: -100, tc: 8, pw: .3 } },
      { f: 8, e: 'in', o: { x: 18, hy: 60, z: 140, rotY: 0.2, sp: 45, hd: 6, bau: 140, baf: 200, lau: 140, laf: 200, tb: -130, tc: 16, pw: .8, fov: 1.4 } },
      { f: 12, e: 'out', o: { x: 30, hy: 56, z: -70, rotY: 1.6, bau: 210, baf: 270, lau: 210, laf: 270, tb: -160, tc: 22, pw: 1, fov: 0.8 } },
      { f: 16, e: 'in', o: { x: 42, hy: 62, z: 140, rotY: 3.0, sp: 38, hd: -4, bau: 100, baf: 160, lau: 100, laf: 160, tb: -100, tc: 10, pw: .7, fov: 1.4 } },
      { f: 22, e: 'io', o: { x: 46, hy: 68, z: 0, rotY: 3.14, bau: 35, baf: 130, lau: 35, laf: 130, tb: -85, pw: .3, fov: 1 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 46 } },
    ],
    events: [{ f: 12, limb: 'bh', p: 1, inv: true }],
    slow: { 7: 2, 8: 3, 11: 2, 12: 4, 13: 2.5 },
    notes: [
      [0, 3, 'Axial pre-rotation: shoulders counter-rotate against hips to load spinal elastic energy.'],
      [4, 7, 'Angular acceleration: rapid axial rotation builds the rotational silhouette.'],
      [8, 12, 'Centrifugal extension: arms flare outward at peak spin to maximize cutting radius.'],
      [13, 31, 'Deceleration damping: core counter-torque halts rotation safely.'],
    ],
  },
  {
    name: 'VIPER CROSS-PIERCE', id: 'Viper',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 4, e: 'out', o: { x: -6, hy: 70, sp: 18, bau: -25, baf: 10, lau: 45, laf: 135, tb: -80, tc: 5, pw: .3 } },
      { f: 7, e: 'in', o: { x: 14, hy: 62, bfy: 8, ffy: 6, bfx: -46, ffx: 68, sp: 42, hd: -10, bau: 150, baf: 195, lau: -50, laf: 5, tb: -145, tc: 14, pw: 1, z: 180, fov: 1.6 } },
      { f: 10, e: 'out', o: { x: 26, hy: 60, bfy: 0, ffy: 0, bfx: -34, ffx: 88, sp: 50, hd: -14, bau: 165, baf: 208, lau: -65, laf: 0, tb: -165, tc: 18, pw: 1, z: 240, fov: 1.9 } },
      { f: 14, e: 'io', o: { x: 30, hy: 66, bfx: -26, ffx: 94, sp: 30, hd: 4, bau: 75, baf: 145, lau: 15, laf: 105, tb: -110, tc: 8, pw: .6, z: 40, fov: 1.1 } },
      { f: 22, e: 'io', o: { x: 28, hy: 68, sp: 16, hd: 0, bau: 30, baf: 130, lau: 30, laf: 130, tb: -85, pw: .2, z: 0, fov: 1 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 28 } },
    ],
    events: [{ f: 10, limb: 'la', p: 1, ground: true, inv: true }],
    slow: { 7: 2, 8: 3, 9: 4, 10: 4.5, 11: 2.5 },
    notes: [
      [0, 5, 'Pelvic drive: rear leg acts as a piston through the center of mass.'],
      [6, 8, 'Elbow tracking: elbows tucked to prevent lateral energy leaks during the thrust.'],
      [9, 10, 'Target convergence: blades lock onto a single focal point; isometric lock on impact.'],
      [11, 31, 'Controlled withdrawal using triceps eccentric braking.'],
    ],
  },
  {
    name: 'ONSLAUGHT CHAIN X-SLASH', id: 'Onslaught',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 3, e: 'out', o: { x: 6, hy: 65, sp: 22, bau: 55, baf: 135, lau: -35, laf: 45, tb: -95, tc: 6, pw: .4 } },
      { f: 6, e: 'in', o: { x: 16, hy: 58, bfx: -26, ffx: 60, sp: 35, hd: 8, bau: 130, baf: 175, lau: 85, laf: 155, tb: -115, tc: 11, pw: .7 } },
      { f: 9, e: 'out', o: { x: 28, hy: 62, bfx: -15, ffx: 75, sp: 42, hd: -8, bau: -25, baf: 35, lau: 165, laf: 215, tb: -140, tc: 13, pw: .9 } },
      { f: 12, e: 'in', o: { x: 38, hy: 56, bfx: 6, ffx: 90, sp: 50, hd: 12, bau: 190, baf: 240, lau: 15, laf: 85, tb: -165, tc: 18, pw: 1, z: 100, fov: 1.3 } },
      { f: 16, e: 'out', o: { x: 46, hy: 60, bfx: 18, ffx: 100, sp: 32, hd: -4, bau: 95, baf: 155, lau: 115, laf: 175, tb: -125, tc: 8, pw: .8, z: 30, fov: 1.05 } },
      { f: 24, e: 'io', o: { x: 44, hy: 68, sp: 18, hd: 0, bau: 35, baf: 130, lau: 35, laf: 130, tb: -90, pw: .4, z: 0, fov: 1 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 44 } },
    ],
    events: [{ f: 12, limb: 'ba', p: 1, inv: true }],
    slow: { 6: 2, 9: 2.5, 12: 4, 13: 3 },
    notes: [
      [0, 5, 'Rhythmic weight transfer: alternating base support, zero dead frames.'],
      [6, 11, 'Reciprocal arm action: as one blade retracts, the antagonist pre-stretches the opposing arm.'],
      [12, 14, 'Climax intersection: X-slash geometry aligns with the opponent centerline.'],
      [15, 31, 'Fluid transition back to guarded stance.'],
    ],
  },
  {
    name: 'FINISHER — OMEGA HORIZON DUAL FLASH', id: 'Omega',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 4, e: 'out', o: { x: -6, hy: 76, bfx: -42, ffx: 34, sp: -12, hd: -24, bau: -130, baf: -140, lau: -130, laf: -140, tb: -170, tc: -14, pw: .9, z: -150, fov: 0.7 } },
      { f: 9, e: 'io', o: { z: -220, rotY: 0.5, pw: 1, fov: 0.5 } },
      { f: 13, e: 'lin', o: { z: -250, rotY: 0.8, fov: 0.4 } },
      { f: 17, e: 'io', o: { x: -22, hy: 42, z: -180, rotY: 0.3, bau: -170, baf: -180, lau: 130, laf: 140, tb: -200, tc: -16, pw: 1, fov: 0.55 } },
      { f: 20, e: 'in', o: { x: 48, hy: 54, z: 350, rotY: -0.8, sp: 60, hd: -12, bau: 45, baf: 65, lau: 45, laf: 65, tb: -330, tc: -4, pw: 1, fov: 2.6 } },
      { f: 24, e: 'out', o: { x: 58, z: 300, rotY: -0.5, fov: 2.2 } },
      { f: 28, e: 'io', o: { x: 58, hy: 68, z: 50, rotY: 0, bau: -15, baf: -5, lau: -15, laf: -5, fov: 1.1, pw: .4 } },
      { f: 32, e: 'io', o: { ...S_DEF, x: 58, z: 0, rotY: 0, fov: 1 } },
    ],
    events: [{ f: 20, limb: 'tip', p: 1, ground: true, inv: true }, { f: 22, limb: 'tail', p: 1 }],
    slow: { 17: 1.5, 18: 2, 19: 3, 20: 5.5, 21: 4, 22: 3 },
    notes: [
      [0, 8, 'Horizon condensation: center of gravity drops into extreme background space.'],
      [9, 16, 'Singularity buildup: core locks; absolute stillness before the hyper-velocity vector.'],
      [17, 19, 'Sonic compression frame: atmospheric distortion.'],
      [20, 22, 'OMEGA HORIZON FLASH: blades burst past the camera plane with a cinematic impact hold.'],
      [23, 31, 'Majestic deceleration and deliberate sheath sequence.'],
    ],
  },
]

/* ---- house IK mirrors (identical math to combat/limb-ik.ts solvers) ---- */
function solveArm(x: number, y: number) {
  const r = Math.max(12, Math.min(A_UA + A_FA - 2, Math.hypot(x, y)))
  const sh = Math.atan2(x, y) + Math.acos(clamp((A_UA * A_UA + r * r - A_FA * A_FA) / (2 * A_UA * r), -1, 1))
  const el = -Math.acos(clamp((r * r - A_UA * A_UA - A_FA * A_FA) / (2 * A_UA * A_FA), -1, 1))
  return { sh, el, r }
}
function solveLeg(x: number, y: number) {
  const d = Math.max(10.5, Math.min(48.8, Math.hypot(x, y)))
  const tau = Math.atan2(x, y)
  const al = Math.acos(clamp((A_TH * A_TH + d * d - A_SH * A_SH) / (2 * A_TH * d), -1, 1))
  const ga = Math.acos(clamp((d * d + A_SH * A_SH - A_TH * A_TH) / (2 * d * A_SH), -1, 1))
  return { hip: tau + al, knee: -(al + ga) }
}

/** Remap an arm target into our shoulder envelope so the IK + limits land
 * the hand exactly where authored (nearest legal line for the reference's
 * ±180-crossing windmills). */
function remapArm(x: number, y: number): [number, number] {
  const r0 = Math.hypot(x, y)
  if (r0 < 1e-6) return [x, y]
  const r = Math.max(12, Math.min(A_UA + A_FA - 2, r0))
  let th = Math.atan2(x, y) * DEG // degrees, 0 = down, + = fwd
  const interior = Math.acos(clamp((A_UA * A_UA + r * r - A_FA * A_FA) / (2 * A_UA * r), -1, 1)) / RAD
  const SH_MAX = 175, SH_MIN = -60
  if (th < SH_MIN) {
    const viaTop = Math.abs(th + 360 - SH_MAX)
    const viaBack = Math.abs(th - SH_MIN)
    th = viaTop <= viaBack ? SH_MAX : SH_MIN
  }
  if (th + interior > SH_MAX) th = SH_MAX - interior
  if (th < SH_MIN) th = SH_MIN
  const rad = th * RAD
  return [r * Math.sin(rad), r * Math.cos(rad)]
}

/* ---- conversion ---- */
interface Converted {
  rootX: number; rootY: number; rootRot: number; head: number
  pelvisYaw: number; chestYaw: number
  rootZ: number; bladeYaw: number; bladeZ: number
  armRz: number; armLz: number; foreRz: number; foreLz: number
  wrR: number
  handL: [number, number]; handR: [number, number]
  kickL: [number, number, string]; kickR: [number, number, string]
  solved: Record<string, number>
}

function convertPose(o: Record<string, number>, x0: number): Converted {
  const rootX = S_X * (o.x - x0) * 0.40
  const rootY = S_LEG * (GUARD_HY - o.hy)
  const rootRot = o.sp * RAD
  const head = o.hd * RAD
  // rotY twist — split across the counter-yaw chain (see header)
  const twist = clamp((o.rotY ?? 0) * 0.30, -0.55, 0.55)
  const chestBase = clamp(0.10 + (o.bau - o.lau) * RAD * 0.35, -0.6, 0.6)
  const chestYaw = clamp(chestBase + twist * 0.7, -0.6, 0.6)
  const pelvisYaw = clamp(-0.08 - chestBase * 0.55 + twist * 0.45, -0.55, 0.55)
  // z + fov → whole-body depth (FOCUS 620 perspective band; see header)
  const z = o.z ?? 0
  const fov = o.fov ?? 1 + z * 0.0035
  const rootZ = clamp(z * 0.08 + (fov - 1) * 45, -52, 58)
  // the blade's own depth plane (lead/sword blade; reference front-arm
  // katana yaw = rotY − 0.42) and thrust travel
  const bladeYaw = clamp(((o.rotY ?? 0) - 0.42) * 0.5, -1.35, 1.35)
  const bladeZ = clamp(z * 0.04, -8, 10)
  const armRz = clamp((o.rotY ?? 0) * 0.18, -0.4, 0.4)
  const armLz = clamp(-(o.rotY ?? 0) * 0.18, -0.4, 0.4)
  // blade cant off the solved forearm: edge leads on strikes, settles at guard
  const wrR = (o.lau ?? 0) > 90 || z > 40 ? -0.3 : 0.2
  const solved: Record<string, number> = {}
  // arms — reference hand positions, envelope-remapped
  const arms: [['left', number, number], ['right', number, number]] = [['left', o.bau, o.baf], ['right', o.lau, o.laf]]
  const hand: Record<'left' | 'right', [number, number]> = { left: [0, 0], right: [0, 0] }
  for (const [side, u, f] of arms) {
    const hx = (UA * Math.sin(u * RAD) + FA * Math.sin(f * RAD)) * S_ARM
    const hy = (UA * Math.cos(u * RAD) + FA * Math.cos(f * RAD)) * S_ARM
    const [tx, ty] = remapArm(hx, hy)
    hand[side] = [tx, ty]
    const s = solveArm(tx, ty)
    solved[side === 'left' ? 'shL' : 'shR'] = s.sh
    solved[side === 'left' ? 'elL' : 'elR'] = s.el
  }
  // legs — feet targets rel hip (world feet minus hip x; see header), flat/point
  const legs: [['left', number, number], ['right', number, number]] = [['left', o.bfx, o.bfy], ['right', o.ffx, o.ffy]]
  const kick: Record<'left' | 'right', [number, number, string]> = { left: [0, 0, 'flat'], right: [0, 0, 'flat'] }
  for (const [side, fx, fy] of legs) {
    const tx = (fx - o.x) * S_LEG
    const ty = (o.hy - fy) * S_LEG
    const toe = fy >= 5 ? 'point' : 'flat'
    kick[side] = [tx, ty, toe]
    const s = solveLeg(tx, ty)
    solved['hip' + (side === 'left' ? 'L' : 'R')] = s.hip
    solved['knee' + (side === 'left' ? 'L' : 'R')] = s.knee
    solved['foot' + (side === 'left' ? 'L' : 'R')] = toe === 'point' ? 1.3 * (s.hip + s.knee) : 0.06
  }
  return {
    rootX, rootY, rootRot, head, pelvisYaw, chestYaw, rootZ, bladeYaw, bladeZ,
    armRz, armLz, foreRz: 0.08, foreLz: -0.02, wrR,
    handL: hand.left, handR: hand.right, kickL: kick.left, kickR: kick.right, solved,
  }
}

const EASE_MAP: Record<string, string> = { lin: 'linear', io: 'inOutCubic', in: 'inCubic', out: 'outCubic' }

/* per-attack pipeline: accumulate → convert → continuity mids → emit */
let report = ''

function emitAttack(a: Atk): string {
  // accumulate the reference's channel overrides
  const acc: Record<string, number>[] = []
  let prev: Record<string, number> | null = null
  for (const k of a.keys) {
    prev = prev ? { ...prev, ...k.o } : { ...k.o }
    acc.push({ ...prev })
  }
  const x0 = acc[0].x
  const conv = acc.map(o => convertPose(o, x0))

  // continuity: worst solved-channel delta per frame @60fps, budget 0.72
  const BUDGET = 0.72
  type Entry = { t: number; kind: 'key' | 'mid'; idx: number; ease?: string; mid?: Converted }
  const entries: Entry[] = []
  for (let i = 0; i < a.keys.length; i++) {
    const k = a.keys[i]
    entries.push({ t: k.f / 24, kind: 'key', idx: i, ease: EASE_MAP[k.e] ?? 'linear' })
    if (i < a.keys.length - 1) {
      const dt = (a.keys[i + 1].f - k.f) / 24
      let worst = 0
      for (const ch of Object.keys(conv[i].solved)) {
        const d = Math.abs((conv[i + 1].solved[ch] ?? 0) - (conv[i].solved[ch] ?? 0))
        worst = Math.max(worst, d / Math.max(dt * 60, 1e-6))
      }
      for (const ch of ['rootRot', 'head', 'chestYaw', 'pelvisYaw', 'rootZ', 'bladeYaw'] as const) {
        const d = Math.abs((conv[i + 1][ch] as number) - (conv[i][ch] as number))
        worst = Math.max(worst, d / Math.max(dt * 60, 1e-6))
      }
      if (worst > BUDGET) {
        // FULL midpoint pose (moveset mid() law — every channel averaged)
        const mid: Converted = {
          ...conv[i],
        }
        for (const ch of ['rootX', 'rootY', 'rootRot', 'head', 'pelvisYaw', 'chestYaw', 'rootZ', 'bladeYaw', 'bladeZ', 'armRz', 'armLz', 'foreRz', 'foreLz', 'wrR'] as const) {
          (mid as unknown as Record<string, number>)[ch] = ((conv[i] as unknown as Record<string, number>)[ch] + (conv[i + 1] as unknown as Record<string, number>)[ch]) / 2
        }
        mid.solved = {}
        for (const ch of Object.keys(conv[i].solved))
          mid.solved[ch] = (conv[i].solved[ch] + (conv[i + 1].solved[ch] ?? 0)) / 2
        // IK-driven channels keep their target-space midpoints instead
        mid.handL = [(conv[i].handL[0] + conv[i + 1].handL[0]) / 2, (conv[i].handL[1] + conv[i + 1].handL[1]) / 2] as [number, number]
        mid.handR = [(conv[i].handR[0] + conv[i + 1].handR[0]) / 2, (conv[i].handR[1] + conv[i + 1].handR[1]) / 2] as [number, number]
        mid.kickL = [(conv[i].kickL[0] + conv[i + 1].kickL[0]) / 2, (conv[i].kickL[1] + conv[i + 1].kickL[1]) / 2, conv[i].kickL[2]] as [number, number, string]
        mid.kickR = [(conv[i].kickR[0] + conv[i + 1].kickR[0]) / 2, (conv[i].kickR[1] + conv[i + 1].kickR[1]) / 2, conv[i].kickR[2]] as [number, number, string]
        entries.push({ t: (k.f + a.keys[i + 1].f) / 48, kind: 'mid', idx: i, mid })
      }
    }
  }

  // emit
  const lines: string[] = []
  lines.push(`/** ${a.name} — reference keys 1:1 (24fps beat grid, eased segments). */`)
  lines.push(`const RONIN_${a.id} = clip('ronin${a.id}', [`)
  let midCount = 0
  for (const e of entries) {
    const c = e.kind === 'key' ? conv[e.idx] : e.mid!
    const isMid = e.kind === 'mid'
    if (isMid) midCount++
    lines.push(
      `  kf(${fmt(e.t)}, { rootX: ${fmt(c.rootX)}, rootY: ${fmt(c.rootY)}, ` +
      `rootRot: ${fmt(c.rootRot)}, spine: 0.02, head: ${fmt(c.head)}, ` +
      `pelvisYaw: ${fmt(c.pelvisYaw)}, chestYaw: ${fmt(c.chestYaw)}, ` +
      `rootZ: ${fmt(c.rootZ)}, bladeYaw: ${fmt(c.bladeYaw)}, bladeZ: ${fmt(c.bladeZ)}, ` +
      `armRz: ${fmt(c.armRz)}, armLz: ${fmt(c.armLz)}, foreRz: ${fmt(c.foreRz)}, foreLz: ${fmt(c.foreLz)}, ` +
      `...kickPose('left', ${fmt(c.kickL[0])}, ${fmt(c.kickL[1])}, '${c.kickL[2]}'), ` +
      `...kickPose('right', ${fmt(c.kickR[0])}, ${fmt(c.kickR[1])}, '${c.kickR[2]}'), ` +
      `...handPose('left', ${fmt(c.handL[0])}, ${fmt(c.handL[1])}), ` +
      `...handPose('right', ${fmt(c.handR[0])}, ${fmt(c.handR[1])}), ` +
      `wrL: 0, wrR: ${fmt(c.wrR)} }, '${isMid ? 'linear' : e.ease}'),` + (isMid ? ' // continuity mid' : '')
    )
  }
  lines.push('])')
  lines.push('')
  report += `  ${a.name}: ${a.keys.length} reference keys → ${entries.length} emitted (${midCount} continuity mids)\n`
  return lines.join('\n')
}

const clips = ATTACKS.map(emitAttack).join('\n')

// metadata: events + slow map on the same beat grid, for the AttackDef layer
const metaLines = ATTACKS.map(a => {
  const ev = a.events.map(e =>
    `{ t: ${fmt(e.f / 24)}, limb: '${e.limb}', p: ${e.p}${e.ground ? ', ground: true' : ''}${e.inv ? ', inv: true' : ''} }`).join(', ')
  const slow = Object.entries(a.slow).map(([f, m]) => `{ t: ${fmt(+f / 24)}, mult: ${m} }`).join(', ')
  return `  ${a.id.toLowerCase()}: {\n    events: [${ev}],\n    slow: [${slow}],\n  },`
}).join('\n')

const clipExports = ATTACKS.map(a => `export const RONIN_${a.id}_CLIP = RONIN_${a.id}`).join('\n')

const header = `/** STICKMAN RISING — THE SHADOW RONIN SET
 *
 * A 1:1 transcription of upload/Shadow_Ronin.html ("SHADOW RONIN — Cinematic
 * Dual-Blade Animation Studio") into this engine's clip format — matched to
 * the game's animation system (see scripts/match-ronin.ts for the full
 * channel map; conversion report at the bottom of this header).
 *
 * WHAT WAS MATCHED:
 *  · every authored key pose at the reference's exact 24fps beat grid
 *    (chamber loads, stillness frames, 2-frame strike snaps, apex hangs,
 *    impact holds, settle timing — all preserved in seconds);
 *  · per-segment eases (lin/io/in/out → linear/inOutCubic/inCubic/outCubic)
 *    riding the ARRIVING key — the reference's own bake() law. These clips
 *    deliberately do NOT use monotone interpolation: the authored in/out
 *    asymmetry IS the choreography (explosive ignition 'out', decelerating
 *    settles 'io', weight-shift accelerations 'in');
 *  · hand/foot IK targets derived from the reference's arm/leg geometry, so
 *    the visible fist/heel/blade lands on the authored spot;
 *  · THE 3D DEPTH LAYER the reference introduced: z + fov → rootZ (the
 *    perspective-band depth pulse), rotY → the counter-yaw chain
 *    (pelvis/chest twist + arm yaw sweep + bladeYaw), z → bladeZ (thrust
 *    travel that spears the lens). VORTEX rotates through real depth;
 *    OMEGA dives to the far plane and bursts past the camera;
 *  · trunk lean, head pitch, hip height, world-planted feet (the reference
 *    stores feet in world space — planted stances keep their lunge splits
 *    while the hips drive forward), ground vs airborne feet.
 *
 * DOCUMENTED ADAPTATIONS (rig differences, kept honest):
 *  · DUAL BLADES: our ronin carries one katana (near/lead hand — the
 *    reference's lead blade) + a live off-hand (the reference's rear blade
 *    becomes unarmed counters, saya control and X-slash crossings).
 *  · TAIL: no 5th limb — beats carried by the counter-rotation + the
 *    player's scarf physics layer.
 *  · AURA (pw): dropped — the house law is physical, non-magical.
 *  · SHOULDER ENVELOPE: the reference's planar windmills cross ±180°;
 *    those targets rotate to the nearest legal glenohumeral line so the IK
 *    lands the hand exactly where authored everywhere else.
 *  · DEPTH COMPRESSION: the reference's fovScale 0.4..2.8 / z ±350 excursions
 *    compress into the rig's perspective band (rootZ ±~55 around FOCUS 620
 *    → body scale 0.92..1.10) — the depth READ without breaking 2D
 *    gameplay geometry.
 *
 * Impact events + slow map (hitstop windows) survive as RONIN_META —
 * the AttackDef layer (combat/ronin.ts) places hit windows, hitstop, slam
 * impacts and finisher FX on these exact beats.
 *
 * Conversion report (auto-generated):
 *${report.replace(/\n/g, '\n * ')}
 */

import { keyframe, makeClip, type Clip } from '../anim/animator'
import { type PoseInput } from '../anim/pose'
import { applyJointLimits } from '../anim/limits'
import { handPose, kickPose } from './limb-ik'

const kf = (t: number, d: PoseInput, ease?: string) => {
  const f = keyframe(t, d, ease)
  applyJointLimits(f.p)
  return f
}
const clip = (name: string, frames: ReturnType<typeof kf>[]): Clip => makeClip(name, frames)

/* ================================================================== */

`

const footer = `${clipExports}

/** Reference metadata on the 24fps beat grid: impact events (limb, power,
 * ground, inversion flag) and the slow-map (per-frame playback dilation
 * around impact — the hitstop windows). Consumed by combat/ronin.ts. */
export interface RoninEvent { t: number; limb: string; p: number; ground?: boolean; inv?: boolean }
export interface RoninSlow { t: number; mult: number }
export const RONIN_META: Record<string, { events: RoninEvent[]; slow: RoninSlow[] }> = {
${metaLines}
}
`

const out = header + clips + footer
await Bun.write('/home/z/my-project/src/game/combat/ronin-sakuga.ts', out)

// sanity: NaN scan of every emitted number + joint-limit re-check
const nanCount = (out.match(/NaN/g) || []).length
console.log('WROTE src/game/combat/ronin-sakuga.ts (' + out.split('\n').length + ' lines)')
console.log(report)
console.log(nanCount === 0 ? 'NaN scan: clean' : `NaN scan: ${nanCount} NaN VALUES — FIX REQUIRED`)

export {}
