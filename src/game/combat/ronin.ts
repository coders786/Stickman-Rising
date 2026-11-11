/** STICKMAN RISING — THE SHADOW RONIN SET (attack definitions).
 *
 * The gameplay layer for the 7 sequences transcribed 1:1 in
 * combat/ronin-sakuga.ts (channel map + methodology: scripts/match-ronin.ts).
 * Armed (katana) and empty-hand variants share the SAME body choreography —
 * the dual-stance contract: sheathed, the sword arm becomes the visible
 * striking fist/heel and the hitbox rides that limb instead of the blade.
 *
 * BEAT PLACEMENT — everything derives from RONIN_META, the reference's own
 * authored data:
 *  · hit windows: [min(event) − 0.05, max(event) + 0.08] seconds
 *  · trails: ignition → follow-through of the strike arc
 *  · hitstop: the reference's per-frame slow-map peak (4×..5.5× playback
 *    dilation at impact) → house hitstop seconds: clamp(0.02 + peak·0.022,
 *    0.05, 0.14) — lands exactly in the house finisher band
 *  · slam impacts / draw flashes: the reference's ground + iai events
 *  · cancels: during the reference's damping phase (post-climax settle)
 *
 * No `traj`/`zArc` is declared on purpose: the sword-arc solver's fallback
 * profile DERIVES the 3D blade path from these clips' authored chamber/
 * contact keys (solveFighter3D at trail.start−0.1 vs mid-hit — including
 * the ported bladeYaw sweeps and bladeZ thrust travel), so the reference's
 * choreography drives the arc, the aim-lock and the overshoot physics.
 *
 * REACHABILITY (chain graph, additive — see player.ts pick edits):
 *  · srIai        forward+light after IAI DRAW / BACKSTEP CUT (draw family)
 *  · srOnslaught  the 6th light of the chain (l1→…→l5→X-SLASH finisher)
 *  · srOmega      the 4th heavy of the chain (h1→h2→h3→OMEGA FINISH)
 *  · srViper      forward+light after RENZOKU TSUKI (pressure succession)
 *  · srVortex     down+light after HASSO SWEEP (the spin finisher)
 *  · srCross      down+light after SLIP BODY ELBOW (crouch finisher)
 *  · srMeteor     air heavy after FALCON DIVE (the plunge alternative)
 */
import type { AttackDef, AttackKind, AttackHit } from './attacks'
import {
  RONIN_META, RONIN_Iai_CLIP, RONIN_Cross_CLIP, RONIN_Meteor_CLIP,
  RONIN_Vortex_CLIP, RONIN_Viper_CLIP, RONIN_Onslaught_CLIP, RONIN_Omega_CLIP,
} from './ronin-sakuga'
import type { Clip } from '../anim/animator'
import type { SfxName } from '../audio/audio'

/* ------------------------------------------------------------------ */
/* beat math (reference metadata → house windows)                      */
/* ------------------------------------------------------------------ */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** slow-map peak → hitstop seconds (reference 4×..5.5× → house 0.09..0.14) */
function hitstopOf(id: string): number {
  const slow = RONIN_META[id]?.slow ?? []
  const peak = slow.reduce((m, s) => Math.max(m, s.mult), 0)
  return clamp(0.02 + peak * 0.022, 0.05, 0.14)
}

/** [min(event) − 0.05, max(event) + 0.08] */
function hitWindowOf(id: string): { start: number; end: number } {
  const ev = RONIN_META[id]?.events ?? []
  const first = ev.reduce((m, e) => Math.min(m, e.t), 0.5)
  const last = ev.reduce((m, e) => Math.max(m, e.t), 0.5)
  return { start: first - 0.05, end: last + 0.08 }
}

/* ------------------------------------------------------------------ */
/* spec table                                                          */
/* ------------------------------------------------------------------ */

interface RoninSpec {
  id: string
  label: string
  kind: AttackKind
  requires: 'ground' | 'air'
  clip: Clip
  /** meta id in RONIN_META (beat source) */
  meta: string
  dmg: number
  kb: number
  kbY?: number
  launch?: number
  juggle?: number
  stagger?: number
  shake?: number
  heavy?: boolean
  breakGuard?: boolean
  aoe?: number
  multiHit?: number
  pad?: number
  corridor?: { back: number; front: number; y?: number }
  moveX?: number
  moveXAt?: number
  moveY?: number
  moveYAt?: number
  float?: number
  groundDrive?: { duration: number; acceleration: number }
  slamImpact?: { r: number; dmg: number; launch: number }
  grip?: number
  drawFlash?: boolean
  chain: string[]
  /** cancel point (reference damping phase) */
  cancel: number
  /** trail window override relative to events: [first−d, last+d] */
  trailBack?: number
  trailFwd?: number
  sfx?: SfxName
  /** empty-hand variant: striking limb + tuning */
  unarmed: { limb: 'left' | 'right'; joint: 'hand' | 'foot' | 'elbow' | 'knee' | 'shoulder'; dmgScale?: number }
}

const SPECS: RoninSpec[] = [
  {
    id: 'srIai', label: 'IAIJUTSU CROSS-DRAW', kind: 'light', requires: 'ground',
    clip: RONIN_Iai_CLIP, meta: 'iai',
    dmg: 12, kb: 150, stagger: 0.26, shake: 0.2, multiHit: 0,
    moveX: 140, moveXAt: 0.3, groundDrive: { duration: 0.07, acceleration: 2600 },
    grip: 0.3, drawFlash: true,
    chain: ['srOnslaught', 'srViper', 'l2', 'l3', 'launcher'],
    cancel: 0.66, trailBack: 0.13, trailFwd: 0.16,
    unarmed: { limb: 'right', joint: 'hand', dmgScale: 0.85 },
  },
  {
    id: 'srCross', label: 'TWIN MOMENTUM CRESCENT', kind: 'light', requires: 'ground',
    clip: RONIN_Cross_CLIP, meta: 'cross',
    dmg: 10, kb: 140, stagger: 0.24, shake: 0.18, multiHit: 0.34,
    moveX: 120, moveXAt: 0.16,
    chain: ['srOmega', 'l1', 'launcher'],
    cancel: 0.78, trailBack: 0.11, trailFwd: 0.16,
    unarmed: { limb: 'right', joint: 'hand', dmgScale: 0.9 },
  },
  {
    id: 'srMeteor', label: 'AVALANCHE METEOR DROP', kind: 'slam', requires: 'air',
    clip: RONIN_Meteor_CLIP, meta: 'meteor',
    dmg: 14, kb: 60, juggle: -200, stagger: 0.3, shake: 0.3,
    moveY: 900, moveYAt: 0.12, float: 0.85,
    slamImpact: { r: 150, dmg: 30, launch: -340 },
    chain: [],
    cancel: 0.8, trailBack: 0.08, trailFwd: 0.14,
    unarmed: { limb: 'right', joint: 'foot', dmgScale: 0.95 },
  },
  {
    id: 'srVortex', label: 'HELIX VORTEX CUTTER', kind: 'spin', requires: 'ground',
    clip: RONIN_Vortex_CLIP, meta: 'vortex',
    dmg: 16, kb: 170, kbY: -60, stagger: 0.38, shake: 0.24,
    moveX: 60, moveXAt: 0.15,
    chain: ['srCross', 'srOmega', 'l1'],
    cancel: 0.74, trailBack: 0.21, trailFwd: 0.18,
    unarmed: { limb: 'left', joint: 'hand', dmgScale: 0.9 },
  },
  {
    id: 'srViper', label: 'VIPER CROSS-PIERCE', kind: 'heavy', requires: 'ground',
    clip: RONIN_Viper_CLIP, meta: 'viper',
    dmg: 24, kb: 210, stagger: 0.45, shake: 0.28, heavy: true, pad: 8,
    corridor: { back: 110, front: 70 },
    moveX: 190, moveXAt: 0.26, groundDrive: { duration: 0.08, acceleration: 3200 },
    chain: ['srOmega', 'l1', 'launcher'],
    cancel: 0.62, trailBack: 0.13, trailFwd: 0.14, sfx: 'swingHeavy',
    unarmed: { limb: 'right', joint: 'hand', dmgScale: 0.85 },
  },
  {
    id: 'srOnslaught', label: 'ONSLAUGHT CHAIN X-SLASH', kind: 'finisher', requires: 'ground',
    clip: RONIN_Onslaught_CLIP, meta: 'onslaught',
    dmg: 26, kb: 260, stagger: 0.5, shake: 0.3, heavy: true, breakGuard: true, pad: 9,
    moveX: 150, moveXAt: 0.2,
    chain: ['srOmega', 'l1', 'l2', 'launcher'],
    cancel: 0.74, trailBack: 0.24, trailFwd: 0.18, sfx: 'swingHeavy',
    unarmed: { limb: 'left', joint: 'hand', dmgScale: 0.85 },
  },
  {
    id: 'srOmega', label: 'OMEGA HORIZON FLASH', kind: 'finisher', requires: 'ground',
    clip: RONIN_Omega_CLIP, meta: 'omega',
    dmg: 46, kb: 420, launch: -380, stagger: 0.6, shake: 0.55,
    heavy: true, breakGuard: true, aoe: 150, pad: 12,
    moveX: 240, moveXAt: 0.7, groundDrive: { duration: 0.1, acceleration: 3600 },
    grip: 1,
    chain: [],
    cancel: 1.0, trailBack: 0.13, trailFwd: 0.06, sfx: 'swingHeavy',
    unarmed: { limb: 'right', joint: 'hand', dmgScale: 0.9 },
  },
]

/* ------------------------------------------------------------------ */
/* build armed + unarmed defs                                          */
/* ------------------------------------------------------------------ */

function buildDef(s: RoninSpec, unarmed: boolean): AttackDef {
  const win = hitWindowOf(s.meta)
  const hit: AttackHit = {
    start: win.start,
    end: win.end,
    dmg: unarmed ? Math.round(s.dmg * (s.unarmed.dmgScale ?? 1)) : s.dmg,
    stagger: s.stagger ?? (s.heavy ? 0.4 : 0.2),
    kb: s.kb,
    kbY: s.kbY,
    launch: s.launch,
    juggle: s.juggle,
    hitstop: hitstopOf(s.meta),
    shake: s.shake ?? (s.heavy ? 0.15 : 0.07),
    heavy: !!s.heavy,
    aoe: s.aoe,
    multiHit: s.multiHit,
    breakGuard: s.breakGuard,
    pad: s.pad ?? (s.heavy ? 8 : 5),
    corridorBack: s.corridor?.back,
    corridorFront: s.corridor?.front,
    corridorY: s.corridor?.y,
  }
  const trail = {
    start: Math.max(0.02, win.start - (s.trailBack ?? 0.1)),
    end: win.end + (s.trailFwd ?? 0.12),
  }
  return {
    id: s.id,
    label: s.label,
    kind: s.kind,
    requires: s.requires,
    clip: s.clip,
    hit,
    trail,
    swingSfx: {
      t: Math.max(0.02, trail.start - 0.03),
      name: (s.sfx ?? (s.heavy ? 'swingHeavy' : 'swing')) as SfxName,
    },
    cancel: s.cancel,
    chain: s.chain,
    moveX: s.moveX,
    moveXAt: s.moveXAt,
    moveY: s.moveY,
    moveYAt: s.moveYAt,
    float: s.float,
    groundDrive: s.groundDrive,
    slamImpact: s.slamImpact,
    drawFlash: s.drawFlash,
    grip: unarmed ? 0 : s.grip,
    ...(unarmed ? { strikeHand: s.unarmed.limb, strikeJoint: s.unarmed.joint } : {}),
  }
}

/** The armed set — katana choreography (registered into ATTACKS). */
export const RONIN_ATTACKS: Record<string, AttackDef> = {}
for (const s of SPECS) RONIN_ATTACKS[s.id] = buildDef(s, false)

/** The empty-hand set — same choreography, fist/heel hitboxes (registered
 * into MOVES so the sheathed stance maps every sr id — the dual-stance
 * contract, "fists never draw steel"). */
export const RONIN_UNARMED: Record<string, AttackDef> = {}
for (const s of SPECS) RONIN_UNARMED[s.id] = buildDef(s, true)

export function getRoninAttack(id: string): AttackDef | undefined {
  return RONIN_ATTACKS[id] ?? RONIN_UNARMED[id]
}

/* ------------------------------------------------------------------ */
/* QA handle (console): force-start any sequence, e.g.
 *   __sr.player.startAttack(__srRonin.srOmega, __sr.worldRef)          */
/* ------------------------------------------------------------------ */
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>
  if (w.__srRonin === undefined) w.__srRonin = RONIN_ATTACKS
}
