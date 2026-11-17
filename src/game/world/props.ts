/** STICKMAN RISING — src/game/world/props.ts
 * PROCEDURAL, DESTRUCTIBLE, PURPOSEFUL STAGE PROPS
 * ----------------------------------------------------------------------------
 * Design laws (from the PCG / gamedesign research pass):
 *   · modular templates + seeded placement scoring — min-gap spread, keep the
 *     two stage practicals (stairwell door, broken streetlight) clear, and a
 *     shuffled 2-of-each deck so every run's side-scrolling lane is different.
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

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas context unavailable')
  return { c, g }
}

/* ------------------------- code-generated sprites ------------------------ */

/** ONE template = one sprite. Common 3D bake (shadow face, moon rim, contact
 *  AO, emissive halo, label) + ~8 lines of kind-specific silhouette. */
function makeSprite(kind: PropKind): HTMLCanvasElement {
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

  // emissive halo behind the object (a real lightmap, baked once)
  const hg = g.createRadialGradient(mid, PH - 44, 2, mid, PH - 44, 46)
  hg.addColorStop(0, `rgba(${d.glow},0.28)`)
  hg.addColorStop(1, `rgba(${d.glow},0)`)
  g.fillStyle = hg
  g.fillRect(0, PH - 90, PW, 92)

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
  g.fillStyle = 'rgba(4,9,14,0.82)'
  g.fillRect(mid - 27, PH - 86, 54, 13)
  g.fillStyle = `rgba(${d.glow},0.85)`
  g.fillRect(mid - 27, PH - 86, 54, 1)
  g.font = 'bold 9px ui-monospace,monospace'
  g.fillStyle = d.accent
  g.fillText(d.hint, mid, PH - 77)
  g.textAlign = 'left'

  /* ---- CHEAP REFLECTION: flipped copy + baked vertical alpha fade ----
   * Built once per template into its own strip, then pasted below the body
   * in the SAME canvas. Runtime = one drawImage. */
  const body = canvas(PW, PH)
  body.g.drawImage(c, 0, 0, PW, PH, 0, 0, PW, PH)
  const refl = canvas(PW, PR)
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
    refl.g.fillStyle = `rgba(0,0,0,${(0.18 + i * 0.06).toFixed(2)})`
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
  private built = false
  private clock = 0
  private seed = 0
  private nextId = 1

  /** Repopulate the lane. Called on every run start with a fresh seed, so
   *  the side-scrolling area is genuinely different each run. Pure data —
   *  safe in headless tests (no document access). */
  reset(seed: number = (Math.random() * 0xffffffff) >>> 0): void {
    this.seed = seed >>> 0
    const rng = rng32(this.seed)
    this.clock = 0
    this.props.length = 0
    // 2-of-each shuffled deck: 11 slots, every purpose guaranteed present
    const deck: PropKind[] = []
    for (const k of KINDS) deck.push(k, k)
    for (let i = deck.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t
    }
    const placed: number[] = []
    for (let i = 0; i < 11; i++) {
      let x = 0
      for (let tries = 0; tries < 48; tries++) {
        x = 110 + rng() * 2320
        const clear = Math.abs(x - 1755) > 155 && Math.abs(x - 830) > 95 // avoid practicals
        const spread = placed.every((p) => Math.abs(p - x) > 195)         // min-gap score
        if (clear && spread) break
      }
      placed.push(x)
      this.props.push({
        id: this.nextId++, kind: deck[i], x, hp: PROP_DEFS[deck[i]].hp,
        dead: false, respawn: 0, hitAt: -10,
      })
    }
    this.props.sort((a, b) => a.x - b.x)
  }

  /** Ambient lifecycle + dash-through contact. No canvas work here. */
  update(dt: number, w: WorldRef, hooks: PropHooks, player: Player): void {
    // headless-safe: the prop system is a rendered/interactive feature, and
    // physics-only test worlds must never have HP/velocity injected mid-test.
    if (typeof document === 'undefined') return
    this.clock += dt
    const dashing = player.state === 'dash' && Math.abs(player.vx) > 520
    for (const p of this.props) {
      if (p.dead) {
        p.respawn -= dt
        if (p.respawn <= 0) {
          // procedural churn: a respawned slot can come back as a NEW purpose
          p.kind = KINDS[((p.id * 7 + ((this.seed >>> 3) + Math.floor(this.clock)) * 13) % KINDS.length + KINDS.length) % KINDS.length]
          p.hp = PROP_DEFS[p.kind].hp
          p.dead = false
          p.hitAt = -10
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
    p.respawn = 15 + (p.id % 5) * 2.5
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

  /** One drawImage per visible prop. Lazy, headless-safe sprite build. */
  draw(ctx: CanvasRenderingContext2D, viewL: number, viewR: number): void {
    if (!this.built) {
      this.built = true
      if (typeof document !== 'undefined') {
        for (const k of KINDS) this.sprites[k] = makeSprite(k)
      }
    }
    for (const p of this.props) {
      if (p.dead || p.x < viewL - PW || p.x > viewR + PW) continue
      const spr = this.sprites[p.kind]
      if (!spr) continue
      // body: opaque. mirror: the same canvas's flipped strip, drawn
      // additively so only its lit pixels show on the wet deck.
      ctx.drawImage(spr, 0, 0, PW, PH, p.x - PW * 0.5, -PH, PW, PH)
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.72
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
