/** STICKMAN RISING — sword definitions: six elemental blades + renderer. */

import { SkelGeom } from '../anim/skeleton'
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
  const len = 56 * sword.stats.range
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01) return

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineCap = 'round'

  const glowW = 5.5 + charge * 4 + swing * 3.5

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

  // handle + guard
  ctx.strokeStyle = '#10151c'
  ctx.lineWidth = 4.4
  ctx.beginPath()
  ctx.moveTo(hx - dx * 9, hy - dy * 9)
  ctx.lineTo(hx, hy)
  ctx.stroke()
  ctx.strokeStyle = rgba(sword.colors.accent, 0.9)
  ctx.lineWidth = 2.4
  const gx = hx - dx * 2
  const gy = hy - dy * 2
  ctx.beginPath()
  ctx.moveTo(gx - dy * 5.5, gy + dx * 5.5)
  ctx.lineTo(gx + dy * 5.5, gy - dx * 5.5)
  ctx.stroke()

  // core blade
  ctx.strokeStyle = sword.colors.blade
  ctx.lineWidth = 3.4 * sword.trailWidth
  bladePath(ctx, sword, hx, hy, dx, dy, len, t)
  ctx.stroke()
  ctx.strokeStyle = sword.colors.core
  ctx.lineWidth = 1.5
  bladePath(ctx, sword, hx, hy, dx, dy, len * 0.97, t)
  ctx.stroke()

  // tip glint
  const tipX = hx + dx * len
  const tipY = hy + dy * len
  ctx.globalCompositeOperation = 'lighter'
  const tw = 2.5 + Math.sin(t * 9) * 0.8 + charge * 3 + swing * 4
  ctx.fillStyle = rgba(sword.colors.core, 0.75 + swing * 0.25)
  ctx.beginPath()
  ctx.arc(tipX, tipY, tw, 0, Math.PI * 2)
  ctx.fill()
  if (charge > 0.05) {
    ctx.strokeStyle = rgba(sword.colors.glow, charge * 0.8)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(tipX, tipY, 7 + charge * 9 + Math.sin(t * 14) * 2, 0, Math.PI * 2)
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
