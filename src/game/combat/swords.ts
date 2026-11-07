/** STICKMAN RISING — sword definitions: six elemental blades + renderer. */

import { SkelGeom, PLAYER_SPEC } from '../anim/skeleton'
import { clamp01, rgba } from '../core/utils'

export type SwordId = 'katana' | 'inferno' | 'void' | 'thunder' | 'gravity' | 'phantom'

export interface SwordDef {
  id: SwordId
  name: string
  title: string
  desc: string
  colors: {
    blade: string
    core: string
    glow: string
    trail: string
    trail2: string
    accent: string
  }
  stats: { dmg: number; spd: number; range: number }
  unlockKills: number
  ability: { name: string; desc: string; cost: number }
  ult: { name: string; desc: string }
  trailWidth: number
}

export const SWORD_ORDER: SwordId[] = ['katana', 'inferno', 'thunder', 'void', 'gravity', 'phantom']

export const SWORDS: Record<SwordId, SwordDef> = {
  katana: {
    id: 'katana',
    name: 'ENERGY KATANA',
    title: 'HF MURASAMA PROTOTYPE',
    desc: 'High-frequency blade. Blistering attack speed, surgical precision cuts.',
    colors: {
      blade: '#bfefff',
      core: '#ffffff',
      glow: '#35f2ff',
      trail: '#35f2ff',
      trail2: '#0e6f8f',
      accent: '#8ff7ff',
    },
    stats: { dmg: 1, spd: 1.18, range: 1 },
    unlockKills: 0,
    ability: { name: 'BLADE STORM', desc: 'Rapid multi-dash slash storm through the horde.', cost: 35 },
    ult: { name: 'THOUSAND CUTS', desc: 'A screen-shattering storm of slashes.' },
    trailWidth: 1,
  },
  inferno: {
    id: 'inferno',
    name: 'INFERNO BLADE',
    title: 'MAGMA EDGE VX-9',
    desc: 'Superheated edge. Explosive impacts, burning trails, searing waves.',
    colors: {
      blade: '#ffb347',
      core: '#fff3d6',
      glow: '#ff6a1f',
      trail: '#ff7a29',
      trail2: '#8f2410',
      accent: '#ffd27a',
    },
    stats: { dmg: 1.22, spd: 0.96, range: 1.02 },
    unlockKills: 40,
    ability: { name: 'INFERNO WAVE', desc: 'A rolling firestorm races along the ground.', cost: 40 },
    ult: { name: 'SUPERNOVA', desc: 'Detonate the battlefield in a sea of flame.' },
    trailWidth: 1.25,
  },
  thunder: {
    id: 'thunder',
    name: 'THUNDER BLADE',
    title: 'ARC RONIN MK-III',
    desc: 'Chain lightning arcs between struck foes. Electrified dash attacks.',
    colors: {
      blade: '#ffe95e',
      core: '#ffffff',
      glow: '#ffd21f',
      trail: '#ffe95e',
      trail2: '#8f6a00',
      accent: '#fff8c9',
    },
    stats: { dmg: 1.1, spd: 1.08, range: 1 },
    unlockKills: 90,
    ability: { name: 'THUNDER RUSH', desc: 'Lightning-charged dash that chains between enemies.', cost: 38 },
    ult: { name: 'GIGAVOLT', desc: 'Call down a cascading thunderstorm.' },
    trailWidth: 0.9,
  },
  void: {
    id: 'void',
    name: 'VOID BLADE',
    title: 'NULL-EDGE REQUIEM',
    desc: 'Cuts through space itself. Short-range teleport slashes, spatial implosions.',
    colors: {
      blade: '#2a1548',
      core: '#c89aff',
      glow: '#a44dff',
      trail: '#b465ff',
      trail2: '#3a1060',
      accent: '#e3c8ff',
    },
    stats: { dmg: 1.18, spd: 1.02, range: 1.05 },
    unlockKills: 160,
    ability: { name: 'VOID STEP', desc: 'Teleport into the densest cluster and implode it.', cost: 42 },
    ult: { name: 'EVENT HORIZON', desc: 'Collapse local space around every enemy.' },
    trailWidth: 1.15,
  },
  gravity: {
    id: 'gravity',
    name: 'GRAVITY BLADE',
    title: 'SINGULARITY MAUL',
    desc: 'Crushing strikes. Launches foes skyward, suspends them, slams them down.',
    colors: {
      blade: '#9adfff',
      core: '#ffffff',
      glow: '#4fd8ff',
      trail: '#6fe0ff',
      trail2: '#0f5a73',
      accent: '#d8f6ff',
    },
    stats: { dmg: 1.35, spd: 0.86, range: 1.08 },
    unlockKills: 240,
    ability: { name: 'GRAVITY CRUSH', desc: 'Drag foes in, suspend them, crush them to the floor.', cost: 45 },
    ult: { name: 'MASS DRIVER', desc: 'Invert gravity across the entire arena.' },
    trailWidth: 1.5,
  },
  phantom: {
    id: 'phantom',
    name: 'PHANTOM BLADE',
    title: 'APPARITION Fang',
    desc: 'Delayed sword echoes and afterimage strikes. Ghost follow-up barrage.',
    colors: {
      blade: '#e8f4ff',
      core: '#ffffff',
      glow: '#cfe8ff',
      trail: '#dceeff',
      trail2: '#5a7a96',
      accent: '#ffffff',
    },
    stats: { dmg: 1.05, spd: 1.12, range: 1.04 },
    unlockKills: 350,
    ability: { name: 'PHANTOM BARRAGE', desc: 'Echo clones strike in delayed sequence.', cost: 36 },
    ult: { name: 'MIRAGE LEGION', desc: 'An army of echoes razes the arena.' },
    trailWidth: 1,
  },
}

/* ------------------------------------------------------------------ */
/* Sword rendering — drawn in the character's local space.             */
/* ------------------------------------------------------------------ */

export interface DrawSwordOpts {
  time: number
  charge: number // 0..1 charge glow
  alpha?: number
  swingGlow?: number // extra energy right after a swing
}

export function drawSword(
  ctx: CanvasRenderingContext2D,
  g: SkelGeom,
  sword: SwordDef,
  opts: DrawSwordOpts,
): void {
  const t = opts.time
  const charge = clamp01(opts.charge)
  const swing = clamp01(opts.swingGlow ?? 0)
  const hx = g.handR.x
  const hy = g.handR.y
  const a = g.bladeAngle
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  // REAL katana proportion: blade ≈ 43% of body height (PLAYER_SPEC.blade),
  // tsuka ≈ 30% of blade — the old 56-unit windmill is dead.
  const len = PLAYER_SPEC.blade * sword.stats.range
  const tsuka = len * 0.3
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01) return

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineCap = 'round'

  const glowW = 5 + charge * 4 + swing * 3.2

  // aura pass (additive)
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = rgba(sword.colors.glow, 0.16 + charge * 0.3 + swing * 0.25)
  ctx.lineWidth = glowW + 5
  bladePath(ctx, sword, hx, hy, dx, dy, len, t)
  ctx.stroke()

  ctx.strokeStyle = rgba(sword.colors.glow, 0.5 + charge * 0.35)
  ctx.lineWidth = glowW * 0.55
  bladePath(ctx, sword, hx, hy, dx, dy, len, t)
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'

  // ---- tsuka (handle): dark wrapped grip behind the hand ----
  ctx.strokeStyle = '#20293a'
  ctx.lineWidth = 4.8
  ctx.beginPath()
  ctx.moveTo(hx - dx * tsuka, hy - dy * tsuka)
  ctx.lineTo(hx + dx * 2, hy + dy * 2)
  ctx.stroke()
  // tsuka-ito cross wraps
  ctx.strokeStyle = rgba(sword.colors.accent, 0.75)
  ctx.lineWidth = 1.4
  for (let i = 1; i <= 3; i++) {
    const k = i / 3.6
    const wx = hx - dx * tsuka * k
    const wy = hy - dy * tsuka * k
    ctx.beginPath()
    ctx.moveTo(wx - dy * 2.6, wy + dx * 2.6)
    ctx.lineTo(wx + dy * 2.6, wy - dx * 2.6)
    ctx.stroke()
  }

  // ---- tsuba (guard): crisp oval at the hand — the dark notch between
  // tsuka and blade is what makes the katana silhouette read at zoom ----
  ctx.fillStyle = '#4a5d7d'
  ctx.beginPath()
  ctx.ellipse(hx + dx * 1.5, hy + dy * 1.5, 3.3, 6.9, a + Math.PI / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = rgba(sword.colors.accent, 0.95)
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.ellipse(hx + dx * 1.5, hy + dy * 1.5, 3.3, 6.9, a + Math.PI / 2, 0, Math.PI * 2)
  ctx.stroke()

  // core blade (starts past the guard — habaki notch)
  ctx.strokeStyle = sword.colors.blade
  ctx.lineWidth = 3.6 * sword.trailWidth
  bladePath(ctx, sword, hx + dx * 3.5, hy + dy * 3.5, dx, dy, len - 3.5, t)
  ctx.stroke()
  // habaki (blade collar): bright metallic band right past the tsuba —
  // reads at any zoom and separates grip from blade
  ctx.strokeStyle = rgba(sword.colors.core, 0.9)
  ctx.lineWidth = 3.8 * sword.trailWidth
  ctx.beginPath()
  ctx.moveTo(hx + dx * 3.5, hy + dy * 3.5)
  ctx.lineTo(hx + dx * 8.5, hy + dy * 8.5)
  ctx.stroke()
  // ha (cutting edge) highlight — offset toward the cutting side
  ctx.strokeStyle = rgba(sword.colors.core, 0.85)
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.moveTo(hx + dx * 6 - dy * 1.2, hy + dy * 6 + dx * 1.2)
  const midX = hx + dx * len * 0.62 - dy * 2.1
  const midY = hy + dy * len * 0.62 + dx * 2.1
  const tipX = hx + dx * (len - 2) - dy * 1.4
  const tipY = hy + dy * (len - 2) + dx * 1.4
  ctx.quadraticCurveTo(midX, midY, tipX, tipY)
  ctx.stroke()
  ctx.strokeStyle = sword.colors.core
  ctx.lineWidth = 1.4
  bladePath(ctx, sword, hx + dx * 3.5, hy + dy * 3.5, dx, dy, (len - 3.5) * 0.97, t)
  ctx.stroke()

  // kissaki (tip) glint
  const tipGx = hx + dx * len
  const tipGy = hy + dy * len
  ctx.globalCompositeOperation = 'lighter'
  const tw = 2.2 + Math.sin(t * 9) * 0.7 + charge * 3 + swing * 3.6
  ctx.fillStyle = rgba(sword.colors.core, 0.75 + swing * 0.25)
  ctx.beginPath()
  ctx.arc(tipGx, tipGy, tw, 0, Math.PI * 2)
  ctx.fill()
  if (charge > 0.05) {
    ctx.strokeStyle = rgba(sword.colors.glow, charge * 0.8)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(tipGx, tipGy, 7 + charge * 9 + Math.sin(t * 14) * 2, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
}

/** traces the blade path with per-sword character */
function bladePath(
  ctx: CanvasRenderingContext2D,
  sword: SwordDef,
  hx: number, hy: number,
  dx: number, dy: number,
  len: number,
  t: number,
): void {
  ctx.beginPath()
  switch (sword.id) {
    case 'katana': {
      // gentle curve
      const mx = hx + dx * len * 0.5 - dy * 3.2
      const my = hy + dy * len * 0.5 + dx * 3.2
      ctx.moveTo(hx, hy)
      ctx.quadraticCurveTo(mx, my, hx + dx * len, hy + dy * len)
      break
    }
    case 'thunder': {
      // jagged lightning edge
      ctx.moveTo(hx, hy)
      const j = 2.4 + Math.sin(t * 31) * 1.1
      ctx.lineTo(hx + dx * len * 0.33 - dy * j, hy + dy * len * 0.33 + dx * j)
      ctx.lineTo(hx + dx * len * 0.66 - dy * -j, hy + dy * len * 0.66 + dx * -j)
      ctx.lineTo(hx + dx * len, hy + dy * len)
      break
    }
    case 'inferno': {
      // flickering flame edge
      ctx.moveTo(hx, hy)
      const f = Math.sin(t * 17) * 2.2
      ctx.quadraticCurveTo(
        hx + dx * len * 0.45 - dy * f,
        hy + dy * len * 0.45 + dx * f,
        hx + dx * len,
        hy + dy * len,
      )
      break
    }
    case 'gravity': {
      // heavy straight edge
      ctx.moveTo(hx, hy)
      ctx.lineTo(hx + dx * len, hy + dy * len)
      break
    }
    case 'void': {
      ctx.moveTo(hx, hy)
      ctx.lineTo(hx + dx * len, hy + dy * len)
      break
    }
    case 'phantom': {
      // echo offset blade
      ctx.moveTo(hx - dy * 2, hy + dx * 2)
      ctx.lineTo(hx + dx * len - dy * 2, hy + dy * len + dx * 2)
      break
    }
  }
}
