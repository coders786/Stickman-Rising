/** STICKMAN RISING — src/game/world/props.ts
 * PROCEDURAL, DESTRUCTIBLE, PURPOSEFUL STAGE PROPS
 * ----------------------------------------------------------------------------
 * Design laws (from the PCG / gamedesign research pass):
 *   · DRESSING, NOT A WIN MENU — the lane starts (near) empty and props arrive
 *     on a timer, one at a time, into bare stretches of deck ahead of the
 *     player. Weighted scarcity + a hard concurrent cap + no duplicate kinds
 *     means a prop is a found object, never a stocked solution menu; the two
 *     stage practicals (stairwell door, broken streetlight) stay clear.
 *   · instantly readable environmental interactivity (barrel / med crate /
 *     valve / shock box / smoke canister / supply crate) — each prop is a
 *     CHOICE, not decoration.
 *   · breaking one must DO something useful. Falling to ashes is not a reward:
 *       fuel     → AoE blast that really damages enemies through hitEnemy()
 *       med      → heals the player
 *       steam    → launches the player (mobility / juggle routing)
 *       shock    → chain-lightning stun on every nearby enemy
 *       smoke    → marks nearby enemies VULNERABLE (double damage) + stuns
 *       supply   → score + a live combo hit (multiplier)
 *   · sprites are made ONLY from code: one compact draw routine per template,
 *     no pixel art, no assets, no external image files.
 *   · reflections are the cheap hardware technique: a vertically FLIPPED
 *     copy of the sprite with a baked vertical alpha fade, composited INTO the
 *     same canvas. One drawImage per visible prop — no live mirror, no shader,
 *     no render target, no readback, zero per-frame gradients.
 *   · everything is culled to the camera frustum and all state is plain
 *     numbers: no allocations in update()/draw().
 * ==========================================================================*/

import type { WorldRef } from '../core/types'
import type { AttackRuntimeInfo } from '../combat/attacks'
import type { Player } from '../entities/player'
import { MOOD_PALETTES, type MoodPalette } from './mood'
import { rgbaConst } from '../render/color'
import { SurfaceGen } from '../render/ledger'
import { shadowDirection, shadowReach } from './light'
import { silhouetteMatrix } from '../render/shadows'

export type PropKind = 'fuel' | 'med' | 'steam' | 'shock' | 'smoke' | 'supply'

export interface PropHooks {
  /** restore player HP (game owns the HP/FX/text) */
  heal(n: number): void
  /** vertical impulse for the player */
  launch(vy: number): void
  /** add score */
  score(n: number): void
  /** feed the live combo multiplier */
  comboHit(): void
}

interface PropDef {
  label: string
  hint: string
  body: string
  accent: string
  glow: string
  hp: number
}

/** one compact table drives art, HP, color and the effect switch */
export const PROP_DEFS: Record<PropKind, PropDef> = {
  fuel:   { label: '!', hint: 'BLAST', body: '#3a1d18', accent: '#ff7a3c', glow: '255,124,60',  hp: 2 },
  med:    { label: '+', hint: 'HEAL', body: '#163029', accent: '#5cffb4', glow: '92,255,180',  hp: 2 },
  steam:  { label: '^', hint: 'LAUNCH', body: '#1b2833', accent: '#9fd8ff', glow: '159,216,255', hp: 2 },
  shock:  { label: 'Z', hint: 'STUN', body: '#1c2338', accent: '#a6d0ff', glow: '166,208,255', hp: 2 },
  smoke:  { label: '~', hint: 'EXPOSE', body: '#292038', accent: '#c39cff', glow: '195,156,255', hp: 2 },
  supply: { label: '$', hint: 'SCORE', body: '#332b19', accent: '#ffd670', glow: '255,214,112', hp: 2 },
}

const KINDS: readonly PropKind[] = ['fuel', 'med', 'steam', 'shock', 'smoke', 'supply']

/** composite sprite: prop body (above ground) + baked mirror (below ground) */
const PW = 76
const PH = 88
const PR = 38

export interface StageProp {
  id: number
  kind: PropKind
  x: number
  hp: number
  dead: boolean
  respawn: number
  hitAt: number
  /** field-clock time this prop appeared — drives the cheap 0.45s fade-in */
  born: number
}

/* --------------------- dressing scheduler (see header) ------------------- *
 * The lane is a place, not a shop: a slow trickle of single props into empty
 * deck, capped at 2 (3 after ~50s), weighted so heal/blast are uncommon and
 * score is rare, and never two of the same kind alive at once. */
const SPAWN_FIRST = [2.5, 4.0] as const      // first prop after the run starts
const SPAWN_GAP = [6.5, 11.0] as const       // one arrival per gap
const RESPAWN_GAP = [18, 30] as const        // a broken slot re-opens later
const CAP_EARLY = 2
const CAP_LATE = 3
const CAP_RAMP_AT = 50                       // seconds
const GAP_PROP = 240                         // min world gap between props
const GAP_PLAYER = 220                       // never spawn on top of the player
const X_MIN = 140, X_MAX = 2700
const DOOR_CLEAR = 170, LAMP_CLEAR = 110
const WEIGHT: Record<PropKind, number> = {
  fuel: 1.1, med: 1.0, steam: 1.0, shock: 0.9, smoke: 0.9, supply: 0.55,
}

type BladeSeg = { bx: number; by: number; tx: number; ty: number }

function rng32(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The sprites are permanent for the session (one per kind per palette), so they
 *  are PINNED: accounted in the ledger's bytes, never chosen by the LRU sweep. */
const propGen = new SurfaceGen('prop:')
/** Composites that exist for the duration of one bake — the flipped reflection
 *  strip, the shadow plate. These are `acquire`d unpinned and released the
 *  moment the sprite that needed them is finished. */
const scratchGen = new SurfaceGen('propscratch:')

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  return propGen.next(w, h, 'prop')
}

function scratch(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  return scratchGen.next(w, h, 'scratch')
}

/* ------------------------- code-generated sprites ------------------------ */

/** ONE template = one sprite. Common 3D bake (shadow face, moon rim, contact
 *  AO, emissive halo, label) + ~8 lines of kind-specific silhouette. */
/** The SILHOUETTE of a prop — the same art with every pixel turned black, alpha
 *  preserved. Cheap to derive at bake time (`source-in` over the finished
 *  sprite), and it is what lets a prop cast its actual outline instead of a
 *  generic blob. Stored beside the sprite; released with the same generation. */
function silhouetteOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = propGen.next(src.width, src.height, 'silhouette')
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  g.globalCompositeOperation = 'source-over'
  return c
}

function makeSprite(kind: PropKind, pal: MoodPalette): HTMLCanvasElement {
  // One generation of scratch per bake: the previous sprite's composites are
  // released before this one starts (they are pure intermediate results).
  scratchGen.begin();
  const d = PROP_DEFS[kind]
  const { c, g } = canvas(PW, PH + PR)
  const mid = PW * 0.5

  // ground contact + plinth (baked AO, world y=0 is the bottom of PH)
  g.fillStyle = 'rgba(0,0,0,0.42)'
  g.beginPath(); g.ellipse(mid, PH - 2, 27, 5, 0, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#080d12'
  g.fillRect(mid - 26, PH - 12, 52, 10)
  g.fillStyle = `rgba(${d.glow},0.5)`
  g.fillRect(mid - 26, PH - 12, 52, 1.4)

  // ISOLATION HALO — one big saturated pool of colour behind the object:
  // the single most attention-grabbing cue in the frame (peak shift).
  const hg = g.createRadialGradient(mid, PH - 44, 2, mid, PH - 44, 52)
  hg.addColorStop(0, `rgba(${d.glow},0.34)`)
  hg.addColorStop(0.55, `rgba(${pal.pop},0.13)`)
  hg.addColorStop(1, `rgba(${pal.pop},0)`)
  g.fillStyle = hg
  g.fillRect(0, PH - 96, PW, 98)
  // COMIC BURST — exaggerated rays (supernormal energy, teen register)
  g.strokeStyle = `rgba(${pal.pop2},0.22)`
  g.lineWidth = 2
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + 0.2
    const r0 = 30, r1 = 41 + (i % 2) * 7
    g.beginPath()
    g.moveTo(mid + Math.cos(a) * r0, PH - 44 + Math.sin(a) * r0)
    g.lineTo(mid + Math.cos(a) * r1, PH - 44 + Math.sin(a) * r1)
    g.stroke()
  }

  g.save()
  g.translate(mid, PH - 10)
  switch (kind) {
    case 'fuel': {                              // ribbed fuel drum + hazard band
      g.fillStyle = d.body
      g.fillRect(-21, -66, 42, 58)
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.fillRect(-21, -66, 7, 58)
      g.fillStyle = 'rgba(190,214,232,0.16)'   // moon rim
      g.fillRect(18, -66, 3, 58)
      g.fillStyle = '#11171c'
      g.fillRect(-22, -68, 44, 5)
      g.fillRect(-22, -12, 44, 4)
      g.fillStyle = d.accent
      for (let i = 0; i < 3; i++) g.fillRect(-21, -52 + i * 18, 42, 3)
      g.fillStyle = 'rgba(255,206,120,0.75)'
      g.font = 'bold 15px ui-monospace,monospace'
      g.fillText('!', -5, -30)
      break
    }
    case 'med': {                              // white field crate + green cross
      g.fillStyle = d.body
      g.fillRect(-24, -60, 48, 52)
      g.fillStyle = '#d8eae4'
      g.fillRect(-20, -56, 40, 44)
      g.fillStyle = 'rgba(0,0,0,0.22)'
      g.fillRect(-20, -56, 7, 44)
      g.fillStyle = d.accent
      g.fillRect(-5, -48, 10, 28)
      g.fillRect(-14, -39, 28, 10)
      g.strokeStyle = '#0d1a16'
      g.lineWidth = 2
      g.strokeRect(-24, -60, 48, 52)
      g.fillStyle = d.accent
      g.fillRect(-24, -60, 48, 2)
      break
    }
    case 'steam': {                            // pipe elbow + valve wheel
      g.fillStyle = d.body
      g.fillRect(-18, -30, 36, 22)
      g.fillStyle = '#0a1117'
      g.fillRect(-8, -70, 16, 46)
      g.fillStyle = 'rgba(160,198,226,0.2)'
      g.fillRect(5, -70, 3, 46)
      g.strokeStyle = d.accent
      g.lineWidth = 3
      g.beginPath(); g.arc(0, -66, 13, 0, Math.PI * 2); g.stroke()
      g.lineWidth = 2
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2
        g.beginPath(); g.moveTo(0, -66); g.lineTo(Math.cos(a) * 12, -66 + Math.sin(a) * 12); g.stroke()
      }
      g.fillStyle = `rgba(${d.glow},0.7)`
      g.beginPath(); g.arc(0, -66, 3.5, 0, Math.PI * 2); g.fill()
      break
    }
    case 'shock': {                            // capacitor cage + live bolt
      g.fillStyle = d.body
      g.fillRect(-22, -64, 44, 56)
      g.strokeStyle = 'rgba(150,192,232,0.45)'
      g.lineWidth = 2
      for (let i = 0; i < 4; i++) g.strokeRect(-20 + i * 2, -62 + i * 2, 40 - i * 4, 52 - i * 4)
      g.fillStyle = d.accent
      g.beginPath()
      g.moveTo(2, -58); g.lineTo(-9, -36); g.lineTo(0, -36)
      g.lineTo(-4, -14); g.lineTo(12, -40); g.lineTo(2, -40)
      g.closePath(); g.fill()
      g.fillStyle = `rgba(${d.glow},0.85)`
      g.fillRect(-22, -64, 44, 2)
      break
    }
    case 'smoke': {                            // perforated canister
      g.fillStyle = d.body
      g.beginPath(); g.moveTo(-18, -62); g.lineTo(18, -62); g.lineTo(21, -8); g.lineTo(-21, -8); g.closePath(); g.fill()
      g.fillStyle = '#0b0d14'
      g.fillRect(-20, -66, 40, 6)
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.fillRect(-18, -62, 6, 54)
      g.fillStyle = d.accent
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          g.fillStyle = `rgba(${d.glow},${(0.2 + ((i + j) % 3) * 0.18).toFixed(2)})`
          g.beginPath(); g.arc(-10 + j * 10, -52 + i * 14, 2.6, 0, Math.PI * 2); g.fill()
        }
      }
      g.fillStyle = d.accent
      g.fillRect(-20, -12, 40, 2)
      break
    }
    case 'supply': {                           // slatted supply crate + coin slot
      g.fillStyle = d.body
      g.fillRect(-24, -58, 48, 50)
      g.fillStyle = 'rgba(0,0,0,0.3)'
      for (let i = 1; i < 4; i++) g.fillRect(-24, -58 + i * 12, 48, 2)
      g.strokeStyle = '#6b5930'
      g.lineWidth = 2.5
      g.strokeRect(-24, -58, 48, 50)
      g.beginPath(); g.moveTo(-24, -58); g.lineTo(24, -8); g.stroke()
      g.fillStyle = d.accent
      g.fillRect(-8, -40, 16, 3)
      g.beginPath(); g.arc(0, -27, 8, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#3a2c12'
      g.font = 'bold 12px ui-monospace,monospace'
      g.fillText('$', -3.5, -23)
      break
    }
  }
  g.restore()

  // BOLD CONTOUR + STICKER TAG — light figure on dark ground (highest
  // preference in colour-combination research) plus a rotated accent chip
  // gives the prop a collectible/sticker quality without any asset art.
  g.strokeStyle = `rgba(${pal.pop},0.5)`
  g.lineWidth = 2
  g.beginPath(); g.ellipse(mid, PH - 2, 33, 7, 0, 0, Math.PI * 2); g.stroke()
  g.save()
  g.translate(mid + 22, PH - 80)
  g.rotate(0.22)
  g.fillStyle = '#05090e'
  g.fillRect(-9, -7, 18, 14)
  g.fillStyle = `rgba(${pal.pop2},0.9)`
  g.fillRect(-7, -5, 14, 10)
  g.fillStyle = '#05090e'
  g.beginPath(); g.arc(0, 0, 2.4, 0, Math.PI * 2); g.fill()
  g.restore()

  // baked directional 3D key over the whole body: lit upper-right, shadowed
  // lower-left — the same moon as the city bands, so props sit IN the scene
  const key = g.createLinearGradient(PW, 0, 0, PH)
  key.addColorStop(0, 'rgba(190,220,248,0.10)')
  key.addColorStop(0.55, 'rgba(0,0,0,0)')
  key.addColorStop(1, 'rgba(0,0,0,0.22)')
  g.fillStyle = key
  g.fillRect(0, 0, PW, PH)

  // PURPOSE PLATE — the player must know what breaking this prop DOES.
  // Baked text, one tiny plate, zero runtime text layout cost.
  g.textAlign = 'center'
  g.fillStyle = 'rgba(2,5,9,0.94)'
  g.fillRect(mid - 29, PH - 88, 58, 16)
  g.strokeStyle = `rgba(${pal.pop},0.75)`
  g.lineWidth = 1.2
  g.strokeRect(mid - 29, PH - 88, 58, 16)
  g.fillStyle = `rgba(${d.glow},0.85)`
  g.fillRect(mid - 27, PH - 86, 54, 1)
  g.font = 'bold 9px ui-monospace,monospace'
  g.fillStyle = d.accent
  g.fillText(d.hint, mid, PH - 77)
  g.textAlign = 'left'

  /* ---- CHEAP REFLECTION: flipped copy + baked vertical alpha fade ----
   * Built once per template into its own strip, then pasted below the body
   * in the SAME canvas. Runtime = one drawImage. */
  const body = scratch(PW, PH)
  body.g.drawImage(c, 0, 0, PW, PH, 0, 0, PW, PH)
  const refl = scratch(PW, PR)
  refl.g.save()
  refl.g.translate(0, PR)
  refl.g.scale(1, -1)
  refl.g.globalAlpha = 0.62
  refl.g.drawImage(body.c, 0, 0, PW, PH, 0, 0, PW, PR)
  refl.g.restore()
  refl.g.globalCompositeOperation = 'destination-in'
  const fade = refl.g.createLinearGradient(0, 0, 0, PR)
  fade.addColorStop(0, 'rgba(0,0,0,0.9)')
  fade.addColorStop(0.4, 'rgba(0,0,0,0.42)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')
  refl.g.fillStyle = fade
  refl.g.fillRect(0, 0, PW, PR)
  refl.g.globalCompositeOperation = 'source-atop'
  refl.g.fillStyle = 'rgba(26,52,72,0.4)'
  refl.g.fillRect(0, 0, PW, PR)
  // water ripples chop the mirror into wet-asphalt character (baked)
  refl.g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 6; i++) {
    refl.g.fillStyle = rgbaConst('0,0,0', 0.18 + i * 0.06)
    refl.g.fillRect((i * 13) % PW, 4 + i * 5.5, PW * 0.6, 1)
  }
  g.drawImage(refl.c, 0, PH)
  return c
}

/* ----------------------------- prop field ------------------------------- */

/** A synthetic heavy hit so a prop blast goes through the REAL combat
 *  resolver (block/guard/kill/score/combo all behave normally). */
const BLAST: AttackRuntimeInfo = {
  id: 'prop-fuel-blast', unarmed: false, dmg: 38, heavy: true, stagger: 0.6,
  kb: 300, kbY: 220, launch: 1, juggle: 0.4, hitstop: 0.05, shake: 0.35,
  aoe: 0, breakGuard: true, kind: 'heavy',
}

function segHitsBox(s: BladeSeg, x0: number, x1: number, y0: number, y1: number): boolean {
  // 9-point sweep along the live blade segment — cheap, exact enough for a
  // 76px prop, and uses the SAME segment the enemy hit test uses.
  for (let i = 0; i <= 8; i++) {
    const u = i / 8
    const x = s.bx + (s.tx - s.bx) * u
    const y = s.by + (s.ty - s.by) * u
    if (x >= x0 - 4 && x <= x1 + 4 && y >= y0 - 6 && y <= y1 + 6) return true
  }
  return false
}

export class PropField {
  readonly props: StageProp[] = []
  private sprites: Partial<Record<PropKind, HTMLCanvasElement>> = {}
  /** Baked outlines, one per sprite: the prop's TRUE shadow (ultra tier). */
  private masks: Partial<Record<PropKind, HTMLCanvasElement>> = {}
  private built = false
  private moodIdx = 0
  private clock = 0
  private seed = 0
  private nextId = 1
  private spawnClock = 0      // field time of the next arrival
  private spawnTick = 0       // hash counter — keeps arrivals deterministic
  /** PROFILE OVERRIDE (world/profile.ts): how many props the lane wants alive,
   *  0 = use the authored ramp. This is the "auto-placed on a timer" knob: a
   *  2-prop run is a spare, empty rooftop; five is a cluttered bazaar. */
  private densityCap = 0
  /** Multiplier on the arrival gap — jittery lanes breathe unevenly. */
  private timerJitter = 1
  /** Weight multiplier on the two CRATE kinds (supply / med). A run whose
   *  profile is crate-heavy stocks the roof with boxes; a run that is not
   *  leaves the exotic kinds (fuel, steam, shock, smoke) to carry the scene. */
  private crateBias = 1

  /** Adopt the run profile's prop axes. Called once per run; pure data, so it
   *  is safe in a headless test world. */
  setRunDensity(density: number, timerJitter = 1, crateBias = 0.5): void {
    this.densityCap = Math.max(1, Math.min(6, Math.round(density)))
    this.timerJitter = Math.max(0.5, Math.min(2, timerJitter))
    // profile crateBias is 0.3..0.85; map it to a weight multiplier 0.7..1.45
    // around the neutral 0.5 so the authored weighting is preserved at the
    // midpoint and only the RATIO between boxes and the exotic kinds moves.
    this.crateBias = Math.max(0.6, Math.min(1.6, 0.7 + (crateBias - 0.3) * 1.36))
    // Bring the first arrival forward/back so the density reads IMMEDIATELY:
    // a 5-prop run that waits the authored 3 s looks identical to a 2-prop run.
    const want = this.densityCap - 1
    if (want > 0) this.spawnClock = Math.min(this.spawnClock, 1.1 + want * 0.35)
  }

  /** Match the skyline's curated mood palette so the props and the city
   *  read as ONE designed frame. Re-bakes the six sprites once. */
  setMood(index: number): void {
    const i = ((index % MOOD_PALETTES.length) + MOOD_PALETTES.length) % MOOD_PALETTES.length
    if (i === this.moodIdx && this.built) return
    this.moodIdx = i
    this.built = false
    this.sprites = {}
    this.masks = {}
  }

  /** Deterministic hash → [0,1). Same seed always dresses the lane the same
   *  way, so a run is reproducible but never the last run's layout. */
  private hash(n: number): number {
    let x = (this.seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0
    x ^= x >>> 16
    x = Math.imul(x, 0x7feb352d)
    x ^= x >>> 15
    return (x >>> 0) / 4294967296
  }

  /** Start a run with an EMPTY lane (a place, not a shop). The first prop is
   *  scheduled for ~3s in, so the player reads the space before anything
   *  offers them an answer. Pure data — headless-test safe. */
  reset(seed: number = (Math.random() * 0xffffffff) >>> 0): void {
    this.seed = seed >>> 0
    this.clock = 0
    this.spawnTick = 0
    this.props.length = 0
    this.spawnClock = SPAWN_FIRST[0] + this.hash(0) * (SPAWN_FIRST[1] - SPAWN_FIRST[0])
  }

  private cap(): number {
    if (this.densityCap > 0) return this.densityCap
    return this.clock >= CAP_RAMP_AT ? CAP_LATE : CAP_EARLY
  }

  /** Per-kind weight, after the run's crate bias. */
  private weightOf(k: PropKind): number {
    return k === 'supply' || k === 'med' ? this.crateBias : 1
  }

  private aliveCount(): number {
    let n = 0
    for (const p of this.props) if (!p.dead) n++
    return n
  }

  /** Weighted kind, never a duplicate of a kind already standing. */
  private pickKind(): PropKind {
    const h = this.hash(++this.spawnTick * 2 + 1)
    let total = 0
    for (const k of KINDS) {
      let taken = false
      for (const p of this.props) if (!p.dead && p.kind === k) { taken = true; break }
      if (!taken) total += WEIGHT[k] * this.weightOf(k)
    }
    let r = h * total
    for (const k of KINDS) {
      let taken = false
      for (const p of this.props) if (!p.dead && p.kind === k) { taken = true; break }
      if (taken) continue
      r -= WEIGHT[k] * this.weightOf(k)
      if (r <= 0) return k
    }
    return 'med'
  }

  /** Gap-seeking placement: sample bare stretches of deck, prefer ahead of the
   *  player, always respect prop/practical/player clearance. Fills emptiness. */
  private pickX(px: number): number {
    let best = -1
    let bestScore = -1
    for (let i = 0; i < 20; i++) {
      const h = this.hash(++this.spawnTick * 7 + 3)
      const ahead = h < 0.72
      const span = 340 + this.hash(++this.spawnTick * 3) * 760
      let x = ahead ? px + span : px - span
      if (x < X_MIN) x = X_MIN + this.hash(++this.spawnTick * 5) * 160
      if (x > X_MAX) x = X_MAX - this.hash(++this.spawnTick * 5) * 160
      if (Math.abs(x - px) < GAP_PLAYER) continue
      if (Math.abs(x - 1755) < DOOR_CLEAR || Math.abs(x - 830) < LAMP_CLEAR) continue
      let nearest = 4000
      for (const p of this.props) {
        const d = Math.abs(p.x - x)
        if (d < nearest) nearest = d
      }
      const gapScore = Math.min(nearest, GAP_PROP * 2.5)
      const score = gapScore + (ahead ? 90 : 0) - Math.abs(x - px) * 0.02
      if (score > bestScore) { bestScore = score; best = x }
    }
    if (best < 0) best = Math.max(X_MIN, Math.min(X_MAX, px + 640))
    return best
  }

  /** One arrival: pick a purpose, find bare deck, fade it in. */
  private spawn(px: number): void {
    const kind = this.pickKind()
    this.props.push({
      id: this.nextId++, kind, x: this.pickX(px), hp: PROP_DEFS[kind].hp,
      dead: false, respawn: 0, hitAt: -10, born: this.clock,
    })
  }

  /** Ambient lifecycle + dash-through contact. No canvas work here. */
  update(dt: number, w: WorldRef, hooks: PropHooks, player: Player): void {
    // headless-safe: the prop system is a rendered/interactive feature, and
    // physics-only test worlds must never have HP/velocity injected mid-test.
    if (typeof document === 'undefined') return
    this.clock += dt
    const dashing = player.state === 'dash' && Math.abs(player.vx) > 520
    // timed trickle — one arrival at a time, only into an under-stocked lane
    if (this.clock >= this.spawnClock && this.aliveCount() < this.cap()) {
      this.spawn(player.x)
      const h = this.hash(++this.spawnTick * 11 + 9)
      this.spawnClock = this.clock + (SPAWN_GAP[0] + h * (SPAWN_GAP[1] - SPAWN_GAP[0])) * this.timerJitter
    }
    for (const p of this.props) {
      if (p.dead) {
        p.respawn -= dt
        if (p.respawn <= 0) {
          // the slot re-opens as a NEW weighted purpose at a NEW stretch of
          // deck — the lane keeps breathing instead of being restocked
          if (this.aliveCount() < this.cap()) {
            p.kind = this.pickKind()
            p.x = this.pickX(player.x)
            p.hp = PROP_DEFS[p.kind].hp
            p.dead = false
            p.hitAt = -10
            p.born = this.clock
          } else {
            p.respawn = 3
          }
        }
        continue
      }
      if (dashing && Math.abs(p.x - player.x) < 40 && this.clock - p.hitAt > 0.3) {
        p.hitAt = this.clock
        this.breakProp(p, 2, w, hooks)
      }
    }
  }

  /** Blade/aoe contact from the player's hit window — the same sweep that
   *  hits bodies also hits props. */
  strike(blade: BladeSeg, atk: AttackRuntimeInfo, px: number, w: WorldRef, hooks: PropHooks): void {
    if (typeof document === 'undefined') return
    const dmg = atk.heavy ? 2 : 1
    for (const p of this.props) {
      if (p.dead || this.clock - p.hitAt < 0.2) continue
      const near = Math.abs(p.x - px)
      const box = segHitsBox(blade, p.x - PW * 0.5, p.x + PW * 0.5, -PH + 8, -6)
      const aoe = atk.aoe > 0 && near < atk.aoe + PW * 0.5
      if (!box && !aoe) continue
      p.hitAt = this.clock
      this.breakProp(p, dmg, w, hooks)
    }
  }

  private breakProp(p: StageProp, dmg: number, w: WorldRef | null, hooks: PropHooks | null): void {
    p.hp -= dmg
    if (w) {
      w.fx.sparks(p.x, -46, -Math.PI / 2, 1, 8, PROP_DEFS[p.kind].accent, 320, 0.3)
      w.audio.play('hit', { pitch: 1.2, volume: 0.55 })
    }
    if (p.hp > 0) return
    p.dead = true
    p.respawn = RESPAWN_GAP[0] + (p.id % 5) * ((RESPAWN_GAP[1] - RESPAWN_GAP[0]) / 5)
    if (!w || !hooks) return

    const d = PROP_DEFS[p.kind]
    const blade: BladeSeg = { bx: p.x - 70, by: -44, tx: p.x + 70, ty: -44 }
    w.fx.shockwave(p.x, -6, 92, d.accent, 0.42, 4)
    w.fx.burst(p.x, -42, 12, d.accent, 300, 0.6, 'shard')
    w.fx.text(p.x, -104, d.label === '+' ? '+HP' : d.label === '$' ? '+SCORE' : 'BREAK!', d.accent, 13)
    w.addHitstop(0.05)

    switch (p.kind) {
      case 'fuel': {
        // USEFUL: a real AoE explosion routed through the combat resolver.
        w.audio.play('explosion', { volume: 0.8 })
        w.fx.shockwave(p.x, -4, 240, '#ffb15c', 0.6, 9)
        w.fx.groundCrack(p.x, -2, 120)
        w.screenFlash('#ff9a48', 0.18, 1.8)
        w.cam.addTrauma(0.42)
        for (const e of w.enemies) {
          if (e.dead || e.spawning) continue
          if (Math.abs(e.x - p.x) < 240 && e.y > -180) w.hitEnemy(e.id, blade, BLAST)
        }
        break
      }
      case 'med': {
        // USEFUL: restore HP mid-wave.
        hooks.heal(30)
        w.audio.play('heal')
        w.fx.burst(p.x, -46, 14, '#5cffb4', 220, 0.8, 'ember')
        w.screenFlash('#46ffb4', 0.1, 1.6)
        break
      }
      case 'steam': {
        // USEFUL: a geyser launch — mobility, juggle routing, escape.
        hooks.launch(-790)
        w.audio.play('fire', { pitch: 1.35, volume: 0.6 })
        w.fx.shockwave(p.x, -8, 110, '#b9e4ff', 0.5, 6)
        w.fx.burst(p.x, -20, 18, '#d8f2ff', 420, 0.7, 'smoke')
        for (const e of w.enemies) {
          if (e.dead || e.spawning || Math.abs(e.x - p.x) > 110) continue
          w.hitEnemy(e.id, blade, { ...BLAST, dmg: 14, id: 'prop-geyser' })
        }
        break
      }
      case 'shock': {
        // USEFUL: chain lightning stuns the whole pack.
        w.audio.play('lightning', { volume: 0.7 })
        w.screenFlash('#a6d0ff', 0.14, 1.5)
        w.fx.shockwave(p.x, -30, 320, '#a6d0ff', 0.42, 3)
        for (const e of w.enemies) {
          if (e.dead || e.spawning || Math.abs(e.x - p.x) > 320) continue
          e.state = 'stun'
          e.stunT = 2.1
          e.stateT = 0
          e.flashT = 1
          w.fx.lightningArc(p.x, -54, e.x, e.y - 44, '#cbe8ff')
        }
        break
      }
      case 'smoke': {
        // USEFUL: marks enemies VULNERABLE (double damage) and stuns them.
        w.audio.play('void', { volume: 0.5 })
        w.fx.shockwave(p.x, -14, 270, '#c39cff', 0.8, 7)
        w.fx.burst(p.x, -24, 20, '#c39cff', 150, 1.1, 'smoke')
        for (const e of w.enemies) {
          if (e.dead || e.spawning || Math.abs(e.x - p.x) > 270) continue
          e.state = 'stun'
          e.stunT = 2.6
          e.stateT = 0
          e.vulnerableT = 4.5
          e.flashT = 1
          w.fx.text(e.x, e.y - 96, 'EXPOSED', '#c39cff', 11)
        }
        break
      }
      case 'supply': {
        // USEFUL: score + a live combo hit (multiplier keeps climbing).
        hooks.score(1400)
        hooks.comboHit()
        w.audio.play('rankup')
        w.fx.burst(p.x, -44, 16, '#ffd670', 260, 0.75, 'spark')
        break
      }
    }
  }

  /** PROP SHADOWS — the prop's actual outline, laid flat on the deck and leaned
   *  away from the moon. One matrix blit + one soft pass per visible prop, ultra
   *  only (render/graphics.ts `shadows: 'cast+props'`).
   *
   *  Why this matters more than it looks: the deck is the largest surface in the
   *  frame, and a deck with nothing ON it reads as a backdrop. Real projected
   *  outlines crossing the roof tie the props, the moon and the fighters into one
   *  lit space — the same information a shadow map gives a 3D scene, bought for
   *  two blits per prop. */
  drawShadows(
    ctx: CanvasRenderingContext2D,
    moonX: number,
    elevation: number,
    zoom: number,
    frameW: number,
    viewL: number,
    viewR: number,
  ): void {
    if (!this.built) return
    const inv = 1 / Math.max(1, frameW)
    for (const p of this.props) {
      if (p.dead || p.x < viewL - PW || p.x > viewR + PW) continue
      const mask = this.masks[p.kind]
      if (!mask) continue
      const dir = shadowDirection(p.x, moonX)
      // Distance in FRAMES, same normalisation the fighter shadows use.
      const reach = shadowReach(elevation, Math.abs(p.x - moonX) * zoom * inv)
      const m = silhouetteMatrix(dir, reach)
      ctx.save()
      ctx.translate(p.x, 0)
      // The body plate sits on the deck; the mask is drawn upward from there and
      // the matrix lays it down.
      ctx.transform(m.a, m.b, m.c, m.d, 0, 0)
      ctx.globalAlpha = 0.30
      // 9-arg form: the BODY of the sprite only (the sprite canvas also carries
      // the baked reflection strip below the base — that must not be projected).
      ctx.drawImage(mask, 0, 0, PW, PH, -PW / 2, -PH, PW, PH)
      // Penumbra pass: 8 % larger, half the alpha. Two blits read as a soft edge.
      ctx.globalAlpha = 0.13
      ctx.drawImage(mask, 0, 0, PW, PH, -PW * 0.54, -PH * 1.04, PW * 1.08, PH * 1.08)
      ctx.restore()
    }
  }

  /** One drawImage per visible prop. Lazy, headless-safe sprite build. */
  draw(ctx: CanvasRenderingContext2D, viewL: number, viewR: number): void {
    if (!this.built) {
      this.built = true
      if (typeof document !== 'undefined') {
        // A new palette is a new generation of sprites: the old six are freed,
        // not left resident under keys nobody will ever read again.
        propGen.begin();
        for (const k of KINDS) {
          const spr = makeSprite(k, MOOD_PALETTES[this.moodIdx])
          this.sprites[k] = spr
          this.masks[k] = silhouetteOf(spr)
        }
      }
    }
    for (const p of this.props) {
      if (p.dead || p.x < viewL - PW || p.x > viewR + PW) continue
      const spr = this.sprites[p.kind]
      if (!spr) continue
      // 0.45s fade-in: one clamp + one multiply, no extra state or canvases
      const fade = Math.min(1, (this.clock - p.born) / 0.45)
      // body: opaque. mirror: the same canvas's flipped strip, drawn
      // additively so only its lit pixels show on the wet deck.
      if (fade < 1) ctx.globalAlpha = fade
      ctx.drawImage(spr, 0, 0, PW, PH, p.x - PW * 0.5, -PH, PW, PH)
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.72 * fade
      ctx.drawImage(spr, 0, PH, PW, PR, p.x - PW * 0.5, 0, PW, PR)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      if (p.hp < PROP_DEFS[p.kind].hp) {          // damage read: two cracks
        ctx.strokeStyle = 'rgba(8,12,16,0.85)'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(p.x - 10, -PH + 26)
        ctx.lineTo(p.x + 3, -PH + 44)
        ctx.lineTo(p.x - 5, -PH + 62)
        ctx.stroke()
      }
    }
  }
}
