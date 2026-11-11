/**
 * scripts/match-darklord.ts — THE DARK LORD SAKUGA STUDY → STICKMAN RISING converter.
 *
 * Transcribes the uploaded study's ATTACKS (authored key poses, 24 fps beat
 * grid, per-key eases, impact events) into our clip format (kf/makeClip,
 * handPose/legPose/kickPose IK authoring) — pose-for-pose matched.
 *
 * Channel map (study → rig), both rigs y-down / world-absolute limb angles:
 *   f @24fps        → t = f/24 seconds (ease rides the ARRIVING key, same law)
 *   x               → rootX = S·(x−x0)·0.40  (weight-shift read; lunges also
 *                     get engine moveX impulses per MoveSpec)
 *   hy (hip height) → rootY = S_LEG·(80−hy)   (hy 80 = our neutral stand)
 *   sp (spine lean) → rootRot = sp·RAD, spine = 0.02 (straight-torso match;
 *                     our waist bend stays a whisper so the line reads like
 *                     the study's single-segment torso)
 *   hd              → head = hd·RAD (their ha = sp+hd ≡ our torsoAngle+head)
 *   bau/baf (rear)  → handPose('left', …) IK to the study's hand position
 *   lau/laf (lead)  → handPose('right', …)  (34·(sin a+sin b), 34·(cos a+cos b))
 *   bfx/bfy,ffx/ffy → kickPose('left'/'right', …) feet rel hip: (x, hy−y),
 *                     'flat' on ground / 'point' when lifted ≥5px
 *   tb/tc (tail)    → no counterpart — choreography beats preserved through
 *                     counter-rotation + follow-through (documented adaptation)
 *   pw (aura)       → dropped (physical, non-magical house law)
 *   trunk "yaw"     → chestYaw = 0.10+(bau−lau)·RAD·0.35, pelvisYaw counters —
 *                     derived from their lead/rear arm asymmetry (lands exactly
 *                     in our CROSS/guard authored ranges)
 *
 * Anatomical-envelope remap (arms): their planar FK freely crosses ±180°
 * (windmills). Our glenohumeral envelope is [−60°, +175°]. Targets in the
 * illegal up-back arc are rotated to the NEAREST LEGAL line, then pulled so
 * the IK's predicted shoulder angle stays inside — every other pose lands
 * exactly on the study's authored hand position.
 *
 * Continuity: pairs whose SOLVED channel velocity exceeds the 0.72 rad/frame
 * @60fps house budget get an explicit FULL midpoint key (the moveset mid()
 * law — every channel averaged, no partial-pose snapping).
 *
 * Run: bun scripts/match-darklord.ts   → writes src/game/combat/sakuga.ts
 */
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/* ---- their rig constants ---- */
const UA = 34, FA = 34            // arm segments
const GUARD_HY = 80               // their standing hip height (S stance)

/* ---- our rig constants (PLAYER_SPEC) ---- */
const A_UA = 20, A_FA = 18        // upperArm/foreArm
const A_TH = 25, A_SH = 24        // thigh/shin
const S_ARM = (A_UA + A_FA) / (UA + FA)   // 0.5588
const S_LEG = (A_TH + A_SH) / 88          // 0.5568
const S_X = S_LEG                          // world x scale

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString()

/* ---- the study's ATTACKS data (verbatim key transcription) ---- */
type K = { f: number; e: string; o: Record<string, number> }
type Atk = { name: string; id: string; keys: K[] }

const G_DEF: Record<string, number> = { x: 0, hy: 70, bfx: -34, bfy: 0, ffx: 34, ffy: 0, sp: 10, hd: 0, bau: 20, baf: 165, lau: 42, laf: 150, tb: -80, tc: 6, pw: 0 }
const S_DEF: Record<string, number> = { x: 0, hy: 80, bfx: -16, bfy: 0, ffx: 16, ffy: 0, sp: 18, hd: 26, bau: -6, baf: 6, lau: 8, laf: 12, tb: -22, tc: 2.5, pw: 0 }

const ATTACKS: Atk[] = [
  {
    name: 'JAB — CROSS — SLIP', id: 'JABCROSS',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 3, e: 'out', o: { x: -4, hy: 66, sp: 14, lau: 38, laf: 162, bau: 26, baf: 162 } },
      { f: 5, e: 'out', o: { x: 2, ffy: 10, ffx: 42, lau: 50, laf: 140 } },
      { f: 7, e: 'in', o: { x: 10, ffy: 0, ffx: 50, lau: 88, laf: 92, sp: 16, hd: -3, tb: -96 } },
      { f: 8, e: 'out', o: { lau: 86, laf: 90, x: 11 } },
      { f: 10, e: 'io', o: { x: 8, hy: 63, sp: 6, hd: 2, lau: 48, laf: 150, bau: 26, baf: 170, tc: 6 } },
      { f: 13, e: 'in', o: { x: 24, hy: 66, bfx: -31, bfy: 5, ffx: 52, sp: 28, hd: 4, bau: 93, baf: 97, lau: 28, laf: 160, tc: 10 } },
      { f: 15, e: 'out', o: { x: 29, hy: 64, bfy: 0, sp: 31, bau: 86, baf: 90 } },
      { f: 19, e: 'io', o: { x: 22, hy: 60, bfx: -26, bfy: 8, sp: -6, hd: 8, bau: 30, baf: 160, lau: 46, laf: 150, tc: 6 } },
      { f: 24, e: 'io', o: { x: 16, hy: 66, bfx: -20, bfy: 0, ffx: 48, sp: 18, hd: -4, bau: 24, baf: 164, lau: 42, laf: 150 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 14 } },
    ],
  },
  {
    name: 'HAMMERFIST LEAP', id: 'HAMMER',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 4, e: 'out', o: { x: -8, hy: 52, sp: 30, bfx: -34, ffx: 30, bau: -35, baf: 15, lau: -25, laf: 20 } },
      { f: 6, e: 'io', o: { hy: 50, sp: 34 } },
      { f: 8, e: 'in', o: { x: 6, hy: 96, bfy: 14, ffy: 20, bfx: -22, ffx: 28, sp: 6, hd: -6, bau: 150, baf: 168, lau: 160, laf: 172 } },
      { f: 12, e: 'out', o: { x: 34, hy: 150, bfy: 78, ffy: 84, bfx: 20, ffx: 60, sp: -6, hd: -12, bau: 168, baf: 150, lau: 172, laf: 155 } },
      { f: 14, e: 'io', o: { x: 46, hy: 156, bfy: 84, ffy: 90, bfx: 30, ffx: 70, sp: -14, hd: -14, bau: 205, baf: 190, lau: 208, laf: 195 } },
      { f: 16, e: 'in', o: { x: 58, hy: 112, bfy: 48, ffy: 56, bfx: 36, ffx: 82, sp: 14, hd: 6, bau: 110, baf: 105, lau: 114, laf: 108 } },
      { f: 18, e: 'in', o: { x: 68, hy: 44, bfy: 0, ffy: 0, bfx: 36, ffx: 100, sp: 52, hd: 14, bau: 22, baf: 26, lau: 18, laf: 22 } },
      { f: 20, e: 'out', o: { x: 72, hy: 48, sp: 46, hd: 10, bau: 24, baf: 30, lau: 20, laf: 28 } },
      { f: 24, e: 'io', o: { x: 70, hy: 58, sp: 30, hd: 0, bau: 35, baf: 120, lau: 40, laf: 110, bfx: 36, ffx: 102 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 70 } },
    ],
  },
  {
    name: 'RISING DRAGON', id: 'DRAGON',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 5, e: 'out', o: { x: -6, hy: 48, sp: 24, bfx: -42, ffx: 30, lau: 10, laf: 2, bau: 60, baf: 135 } },
      { f: 7, e: 'out', o: { hy: 46, sp: 28, lau: -5, laf: -10 } },
      { f: 9, e: 'in', o: { x: 8, hy: 92, bfy: 14, ffy: 10, bfx: -22, ffx: 30, sp: -2, hd: -14, lau: 174, laf: 179, bau: -40, baf: -20 } },
      { f: 11, e: 'out', o: { x: 18, hy: 124, bfy: 50, ffy: 46, bfx: -4, ffx: 42, sp: 2, hd: -6, bau: -25, baf: 5, lau: 60, laf: 150 } },
      { f: 14, e: 'in', o: { x: 28, hy: 138, bfy: 64, ffy: 56, bfx: 6, ffx: 50, sp: 14, hd: 2, bau: 140, baf: 146, lau: 40, laf: 150 } },
      { f: 15, e: 'out', o: { x: 31, hy: 140, sp: 16, bau: 146, baf: 150, lau: 20, laf: 140 } },
      { f: 18, e: 'io', o: { x: 38, hy: 124, bfy: 44, ffy: 42, bfx: 14, ffx: 62, sp: 8, hd: 0, bau: 100, baf: 90, lau: -60, laf: -70 } },
      { f: 21, e: 'in', o: { x: 46, hy: 58, bfy: 0, ffy: 0, bfx: 16, ffx: 72, sp: 26, hd: 6, bau: 40, baf: 60, lau: 30, laf: 44 } },
      { f: 26, e: 'io', o: { x: 48, hy: 68, bfx: 14, ffx: 82, sp: 14, hd: 0, bau: 22, baf: 164, lau: 42, laf: 150 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 48 } },
    ],
  },
  {
    name: 'SCORPION TAIL STRIKE', id: 'SCORPION',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 4, e: 'out', o: { x: -10, hy: 56, sp: 24, bfx: -40, ffx: 24, bau: 60, baf: 130, lau: 70, laf: 120 } },
      { f: 8, e: 'io', o: { x: -14, hy: 52, sp: 30, hd: -14, bfx: -44, ffx: 22, bau: -50, baf: -30, lau: 60, laf: 110 } },
      { f: 11, e: 'out', o: { x: -15, hy: 49, sp: 32 } },
      { f: 13, e: 'in', o: { x: 8, ffy: 14, ffx: 50, bfx: -40, bfy: 3, hy: 52, sp: 35, hd: -16, lau: 85, laf: 95, bau: -65, baf: -50 } },
      { f: 14, e: 'in', o: { x: 20, ffy: 0, ffx: 68, bfx: -34, sp: 38, hd: -18, bau: -80, baf: -62, lau: 100, laf: 80 } },
      { f: 16, e: 'out', o: { x: 24, sp: 40 } },
      { f: 20, e: 'io', o: { x: 26, hy: 56, sp: 28, hd: -8, bau: -40, baf: -20, lau: 70, laf: 100, bfx: -30 } },
      { f: 25, e: 'io', o: { x: 30, hy: 64, sp: 18, hd: 0, bau: 30, baf: 150, lau: 50, laf: 140, bfx: -14, bfy: 6 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 34 } },
    ],
  },
  {
    name: 'BARRAGE — SIX-POINT FLURRY', id: 'BARRAGE',
    keys: [
      { f: 0, e: 'lin', o: { ...G_DEF } },
      { f: 2, e: 'out', o: { x: 4, ffy: 12, ffx: 40, hy: 66, sp: 14, lau: 50, laf: 145, bau: 26, baf: 166 } },
      { f: 4, e: 'in', o: { x: 8, ffy: 0, ffx: 46, lau: 89, laf: 93, sp: 18, hd: -3 } },
      { f: 6, e: 'out', o: { x: 10, bfy: 8, bfx: -22, lau: 50, laf: 150, bau: 26, baf: 168, sp: 12 } },
      { f: 8, e: 'in', o: { x: 16, bfy: 0, bfx: -18, bau: 92, baf: 98, lau: 34, laf: 160, sp: 26, hd: 3, hy: 64 } },
      { f: 10, e: 'out', o: { x: 18, ffy: 10, ffx: 54, bau: 28, baf: 166, lau: 30, laf: 195, sp: 12, hy: 66 } },
      { f: 12, e: 'in', o: { x: 24, ffy: 0, ffx: 58, lau: 95, laf: 140, bau: 30, baf: 168, sp: 30, hd: 6, hy: 62 } },
      { f: 14, e: 'out', o: { x: 28, bfy: 8, bfx: -4, lau: 50, laf: 160, bau: -22, baf: 8, sp: 14, hy: 56 } },
      { f: 16, e: 'in', o: { x: 32, bfy: 0, bfx: 0, hy: 72, sp: 12, hd: -8, bau: 152, baf: 166, lau: 40, laf: 150 } },
      { f: 18, e: 'out', o: { x: 36, ffy: 10, ffx: 66, bau: 30, baf: 150, lau: 158, laf: 198, hy: 66, sp: 14, hd: 2 } },
      { f: 20, e: 'in', o: { x: 40, ffy: 0, ffx: 72, lau: 100, laf: 68, bau: 28, baf: 160, sp: 36, hd: 8, hy: 60 } },
      { f: 22, e: 'out', o: { x: 42, bfy: 8, bfx: 10, ffy: 10, ffx: 80, lau: -30, laf: 30, bau: -40, baf: 20, sp: -6, hd: -6, hy: 54 } },
      { f: 26, e: 'in', o: { x: 56, bfy: 0, bfx: 22, ffy: 0, ffx: 90, hy: 58, sp: 38, hd: -4, bau: 92, baf: 96, lau: 98, laf: 94 } },
      { f: 28, e: 'out', o: { x: 58, sp: 42, bau: 86, baf: 90, lau: 92, laf: 90, hy: 56 } },
      { f: 32, e: 'io', o: { ...G_DEF, x: 56 } },
    ],
  },
  {
    name: "FINISHER — DARK LORD'S WRATH", id: 'WRATH',
    keys: [
      { f: 0, e: 'lin', o: { ...S_DEF } },
      { f: 4, e: 'out', o: { x: -6, hy: 76, bfx: -40, ffx: 34, sp: -8, hd: -20, bau: -100, baf: -106, lau: 100, laf: 106 } },
      { f: 7, e: 'io', o: { hd: -24, hy: 77, sp: -12 } },
      { f: 11, e: 'io', o: { hy: 77, sp: -16, hd: -26, bau: -172, baf: -178, lau: 172, laf: 178 } },
      { f: 14, e: 'lin', o: { hy: 76, sp: -20, hd: -30 } },
      { f: 18, e: 'io', o: { x: -14, hy: 52, sp: 30, hd: -10, bfx: -44, ffx: 22, bau: -138, baf: -150, lau: 96, laf: 100 } },
      { f: 19, e: 'in', o: { x: 22, hy: 60, bfy: 18, ffy: 12, bfx: -20, ffx: 44, sp: 26, hd: -6, bau: -20, baf: -10, lau: 20, laf: 30 } },
      { f: 20, e: 'in', o: { x: 52, hy: 58, bfy: 0, ffy: 0, bfx: 10, ffx: 86, sp: 46, hd: -4, bau: 92, baf: 95, lau: -60, laf: -50 } },
      { f: 22, e: 'out', o: { x: 58, sp: 50 } },
      { f: 26, e: 'io', o: { x: 58, hy: 70, sp: 20, hd: -12, bfy: 8, bfx: 26, ffx: 80, bau: -10, baf: -5, lau: 15, laf: 10 } },
      { f: 29, e: 'out', o: { hy: 78, sp: 12, hd: 10, bfy: 0, bfx: 36, ffx: 74, bau: -8, baf: 2, lau: 10, laf: 8 } },
      { f: 32, e: 'io', o: { ...S_DEF, x: 58 } },
    ],
  },
]

/* ---- house IK mirrors (identical math to moveset.ts solvers) ---- */
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
 * the hand exactly where authored (or the nearest legal line for the
 * study's ±180-crossing windmills). Returns [x, y, remapped]. */
function remapArm(x: number, y: number): [number, number, boolean] {
  const r0 = Math.hypot(x, y)
  if (r0 < 1e-6) return [x, y, false]
  const r = Math.max(12, Math.min(A_UA + A_FA - 2, r0))
  let th = Math.atan2(x, y) * DEG // degrees, 0 = down, + = fwd
  const interior = Math.acos(clamp((A_UA * A_UA + r * r - A_FA * A_FA) / (2 * A_UA * r), -1, 1)) / RAD
  const SH_MAX = 175, SH_MIN = -60
  let remapped = false
  // atan2(x, y) ∈ (−180°, 180°]: 0 = straight down, +90 = fwd-horizontal,
  // +90..+180 = up-FRONT (legal zone), −180..−60 = up-BACK (illegal zone).
  if (th < SH_MIN) {
    // illegal up-back arc: nearest legal endpoint of the envelope
    const viaTop = Math.abs(th + 360 - SH_MAX)
    const viaBack = Math.abs(th - SH_MIN)
    th = viaTop <= viaBack ? SH_MAX : SH_MIN
    remapped = true
  }
  // predicted solve: sh = θ + interior (house IK adds the interior angle)
  if (th + interior > SH_MAX) { th = SH_MAX - interior; remapped = true }
  if (th < SH_MIN) { th = SH_MIN; remapped = true }
  const rad = th * RAD
  return [r * Math.sin(rad), r * Math.cos(rad), remapped]
}

/* ---- conversion ---- */
interface Converted {
  rootX: number; rootY: number; rootRot: number; head: number
  pelvisYaw: number; chestYaw: number
  handL: [number, number]; handR: [number, number]
  kickL: [number, number, string]; kickR: [number, number, string]
  solved: Record<string, number>
}

function convertPose(o: Record<string, number>, x0: number): Converted {
  const rootX = S_X * (o.x - x0) * 0.40
  const rootY = S_LEG * (GUARD_HY - o.hy)
  const rootRot = o.sp * RAD
  const head = o.hd * RAD
  const chestYaw = clamp(0.10 + (o.bau - o.lau) * RAD * 0.35, -0.6, 0.6)
  const pelvisYaw = clamp(-0.08 - chestYaw * 0.55, -0.6, 0.6)
  const solved: Record<string, number> = {}
  // arms — study hand positions, envelope-remapped
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
  // legs — feet targets rel hip, flat/point
  const legs: [['left', number, number], ['right', number, number]] = [['left', o.bfx, o.bfy], ['right', o.ffx, o.ffy]]
  const kick: Record<'left' | 'right', [number, number, string]> = { left: [0, 0, 'flat'], right: [0, 0, 'flat'] }
  for (const [side, fx, fy] of legs) {
    const tx = fx * S_LEG
    const ty = (o.hy - fy) * S_LEG
    const toe = fy >= 5 ? 'point' : 'flat'
    kick[side] = [tx, ty, toe]
    const s = solveLeg(tx, ty)
    solved['hip' + (side === 'left' ? 'L' : 'R')] = s.hip
    solved['knee' + (side === 'left' ? 'L' : 'R')] = s.knee
    solved['foot' + (side === 'left' ? 'L' : 'R')] = toe === 'point' ? 1.3 * (s.hip + s.knee) : 0.06
  }
  return { rootX, rootY, rootRot, head, pelvisYaw, chestYaw, handL: hand.left, handR: hand.right, kickL: kick.left, kickR: kick.right, solved }
}

const EASE_MAP: Record<string, string> = { lin: 'linear', io: 'inOutCubic', in: 'inCubic', out: 'outCubic' }

/* per-attack pipeline: accumulate → convert → continuity mids → emit */
let report = ''

function emitAttack(a: Atk): string {
  // accumulate their channel overrides
  const acc: Record<string, number>[] = []
  let prev: Record<string, number> | null = null
  for (const k of a.keys) {
    // explicit merge — spreading a nullable accumulator trips TS2698
    const merged: Record<string, number> = {}
    if (prev) for (const key of Object.keys(prev)) merged[key] = prev[key]
    for (const key of Object.keys(k.o)) merged[key] = k.o[key]
    prev = merged
    acc.push({ ...merged })
  }
  const x0 = acc[0].x
  const conv = acc.map(o => convertPose(o, x0))

  // continuity: worst solved-channel delta per frame @60fps, budget 0.72
  const BUDGET = 0.72
  type Entry = { t: number; kind: 'key' | 'mid'; idx: number; ease?: string; mid?: Record<string, number> }
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
      // root channels too
      for (const ch of ['rootRot', 'head', 'chestYaw'] as const) {
        const d = Math.abs((conv[i + 1][ch] as number) - (conv[i][ch] as number))
        worst = Math.max(worst, d / Math.max(dt * 60, 1e-6))
      }
      if (worst > BUDGET) {
        // FULL midpoint pose (moveset mid() law — every channel averaged)
        const mid: Record<string, number> = {}
        for (const ch of ['rootX', 'rootY', 'rootRot', 'head', 'pelvisYaw', 'chestYaw'] as const)
          mid[ch] = ((conv[i][ch] as number) + (conv[i + 1][ch] as number)) / 2
        for (const ch of ['shL', 'elL', 'shR', 'elR', 'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR'])
          mid[ch] = (conv[i].solved[ch] + conv[i + 1].solved[ch]) / 2
        entries.push({ t: (k.f + a.keys[i + 1].f) / 48, kind: 'mid', idx: i, mid })
      }
    }
  }

  // emit
  const lines: string[] = []
  lines.push(`/** ${a.name} — study keys 1:1 (24fps beat grid). */`)
  lines.push(`const SAKUGA_${a.id} = clip('sakuga${a.id.charAt(0) + a.id.slice(1).toLowerCase()}', [`)
  let midCount = 0
  for (const e of entries) {
    if (e.kind === 'key') {
      const c = conv[e.idx]
      lines.push(
        `  kf(${fmt(e.t)}, { rootX: ${fmt(c.rootX)}, rootY: ${fmt(c.rootY)}, ` +
        `rootRot: ${fmt(c.rootRot)}, spine: 0.02, head: ${fmt(c.head)}, ` +
        `pelvisYaw: ${fmt(c.pelvisYaw)}, chestYaw: ${fmt(c.chestYaw)}, ` +
        `...kickPose('left', ${fmt(c.kickL[0])}, ${fmt(c.kickL[1])}, '${c.kickL[2]}'), ` +
        `...kickPose('right', ${fmt(c.kickR[0])}, ${fmt(c.kickR[1])}, '${c.kickR[2]}'), ` +
        `...handPose('left', ${fmt(c.handL[0])}, ${fmt(c.handL[1])}), ` +
        `...handPose('right', ${fmt(c.handR[0])}, ${fmt(c.handR[1])}), ` +
        `armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, '${e.ease}'),`
      )
    } else {
      const m = e.mid!
      lines.push(
        `  kf(${fmt(e.t)}, { rootX: ${fmt(m.rootX)}, rootY: ${fmt(m.rootY)}, ` +
        `rootRot: ${fmt(m.rootRot)}, spine: 0.02, head: ${fmt(m.head)}, ` +
        `pelvisYaw: ${fmt(m.pelvisYaw)}, chestYaw: ${fmt(m.chestYaw)}, ` +
        `shL: ${fmt(m.shL)}, elL: ${fmt(m.elL)}, shR: ${fmt(m.shR)}, elR: ${fmt(m.elR)}, ` +
        `hipL: ${fmt(m.hipL)}, kneeL: ${fmt(m.kneeL)}, footL: ${fmt(m.footL)}, ` +
        `hipR: ${fmt(m.hipR)}, kneeR: ${fmt(m.kneeR)}, footR: ${fmt(m.footR)}, ` +
        `armRz: 0.05, armLz: -0.05, foreRz: 0.10, foreLz: -0.02, wrL: 0, wrR: 0 }, 'linear'), // continuity mid`
      )
      midCount++
    }
  }
  lines.push('])')
  lines.push('')
  report += `  ${a.name}: ${a.keys.length} study keys → ${entries.length} emitted (${midCount} continuity mids)\n`
  return lines.join('\n')
}

const clips = ATTACKS.map(emitAttack).join('\n')

const header = `/** STICKMAN RISING — THE SAKUGA SET
 *
 * A 1:1 transcription of the uploaded "THE DARK LORD — Sakuga Study" into
 * this engine's clip format — matched to the game's animation system
 * (see scripts/match-darklord.ts for the full channel map; conversion
 * report at the bottom of this header).
 *
 * WHAT WAS MATCHED:
 *  · every authored key pose at the study's exact 24fps beat grid
 *    (anticipation lengths, 2-frame strike snaps, apex hangs, 3-frame
 *    holds, settle timing — all preserved in seconds);
 *  · per-segment eases (lin/io/in/out → linear/inOutCubic/inCubic/outCubic);
 *  · hand/foot IK targets derived from the study's arm/leg geometry, so
 *    the visible fist/heel lands on the study's authored spot;
 *  · trunk lean, head pitch, hip height, foot contacts, ground vs airborne
 *    feet (flat/point), and the lead/rear arm asymmetry → chest/pelvis
 *    counter-yaw (lands in our CROSS/guard authored ranges).
 *
 * DOCUMENTED ADAPTATIONS (rig differences, kept honest):
 *  · TAIL: our ronin has no 5th limb. The study's tail strikes become
 *    choreography beats carried by the body (SCORPION's whip unroll reads
 *    through the coiled spine + sweeping arm arc at the same frames;
 *    WRATH's tail-to-floor spike becomes the rear-foot stomp contact at
 *    the same beat).
 *  · AURA (pw): dropped — the house law is physical, non-magical.
 *  · SHOULDER ENVELOPE: the study's planar windmills cross ±180°; those
 *    targets rotate to the nearest legal glenohumeral line so the IK
 *    lands the hand exactly where authored everywhere else.
 *  · ELBOW POLE: our elbow channel is sign-locked to the negative
 *    flexion side (house anatomy law); the study's hand POSITIONS are
 *    matched through IK, so the fold reads in the game's own elbow style
 *    while fists/knuckles stay on the authored spot.
 *
 * Conversion report (auto-generated):
 *${report.replace(/\n/g, '\n * ')}
 */

import { keyframe, makeClip, type Clip } from '../anim/animator'
import { type PoseInput } from '../anim/pose'
import { applyJointLimits } from '../anim/limits'
import { handPose, kickPose } from './moveset'

const kf = (t: number, d: PoseInput, ease?: string) => {
  const f = keyframe(t, d, ease)
  applyJointLimits(f.p)
  return f
}
const clip = (name: string, frames: ReturnType<typeof kf>[]): Clip => {
  const c = makeClip(name, frames)
  c.interpolation = 'monotone'
  return c
}

/* ================================================================== */

`

const footer = `export const SAKUGA_JABCROSS_CLIP = SAKUGA_JABCROSS
export const SAKUGA_HAMMER_CLIP = SAKUGA_HAMMER
export const SAKUGA_DRAGON_CLIP = SAKUGA_DRAGON
export const SAKUGA_SCORPION_CLIP = SAKUGA_SCORPION
export const SAKUGA_BARRAGE_CLIP = SAKUGA_BARRAGE
export const SAKUGA_WRATH_CLIP = SAKUGA_WRATH
`

const out = header + clips + footer

// This converter runs under Bun (top-level await + Bun.write); declare just the
// surface it uses so the repo's TypeScript pass stays clean without Bun types.
declare const Bun: { write(path: string, contents: string): Promise<number> }

await Bun.write('/home/z/my-project/src/game/combat/sakuga.ts', out)
console.log('WROTE src/game/combat/sakuga.ts (' + out.split('\n').length + ' lines)')
console.log(report)

export {}
