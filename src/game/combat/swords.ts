/** STICKMAN RISING — sword definitions: six elemental blades + renderer. */

import { clamp, clamp01, rgba } from '../core/utils'

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
  /** 3D depth (−1..1): + = blade plane rotated TOWARD the camera →
   * procedural foreshortening (face opens up: wider silhouette, fatter
   * tsuba, huge kissaki flare). Thrusts (z≈0.85) read as spearing the lens. */
  z?: number
  /** hyper-scale multiplier on the whole weapon (active swing / dash) */
  lenScale?: number
}

/** Draws the weapon from EXPLICIT projected blade metrics (rig3d output):
 * the grip point, the PROJECTED blade angle (what the eye sees after 3D
 * yaw + perspective), the projected length, and the tip's normalized depth.
 * Visual blade == hitbox blade: both consume the same projection. */
export function drawSword(
  ctx: CanvasRenderingContext2D,
  sword: SwordDef,
  opts: DrawSwordOpts,
  hx: number, hy: number, // grip (projected, character-local)
  ang: number, // PROJECTED blade angle (rad)
  len: number, // PROJECTED blade length (local units, incl. lenScale)
  z: number, // tip depth −1..1 (+ = toward camera)
): void {
  const t = opts.time
  const charge = clamp01(opts.charge)
  const swing = clamp01(opts.swingGlow ?? 0)
  z = clamp(z, -1, 1) // + = toward camera
  const a = ang
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  // edge-side perpendicular: for a forward blade this points DOWN — the ha
  // (cutting edge) faces down-forward, correct for kiri-oroshi cuts.
  const ex = -dy
  const ey = dx
  // REAL long-katana proportion: blade = PLAYER_SPEC.blade (~50% of body
  // height), tsuka ≈ 30% of the blade, motohaba→kissaki taper with sori.
  const tsuka = len * 0.3
  // 2.8D FORESHORTENING: blade pitched toward the camera presents its FACE
  // — the silhouette fattens with z (up to ×1.85), the fittings swell, the
  // kissaki flares. Away from camera (z<0) it slims toward a needle.
  const zm = 1 + Math.max(0, z) * 0.85 + Math.min(0, z) * 0.35
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01) return

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineCap = 'round'

  const glowW = 5 + charge * 4 + swing * 3.2

  // ---- 0. tsuka (handle): wrapped grip BEHIND the hand, kashira pommel ----
  ctx.strokeStyle = '#1a2230'
  ctx.lineWidth = 5.0 * zm
  ctx.beginPath()
  ctx.moveTo(hx - dx * tsuka, hy - dy * tsuka)
  ctx.lineTo(hx + dx * 2.4, hy + dy * 2.4)
  ctx.stroke()
  // tsuka-ito diamond wraps — the classic katana grip read
  ctx.strokeStyle = rgba(sword.colors.accent, 0.8)
  ctx.lineWidth = 1.5 * zm
  for (let i = 1; i <= 4; i++) {
    const k = i / 4.8
    const wx = hx - dx * tsuka * k
    const wy = hy - dy * tsuka * k
    ctx.beginPath()
    ctx.moveTo(wx - ey * 2.8 * zm, wy + ex * 2.8 * zm)
    ctx.lineTo(wx + ey * 2.8 * zm, wy - ex * 2.8 * zm)
    ctx.stroke()
  }
  // kashira (pommel cap) — metal end disc
  ctx.fillStyle = '#3d4f6e'
  ctx.beginPath()
  ctx.ellipse(hx - dx * tsuka, hy - dy * tsuka, 2.0 * zm, 3.4 * zm, a + Math.PI / 2, 0, Math.PI * 2)
  ctx.fill()

  // ---- 1. aura pass (additive) behind the blade ----
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = rgba(sword.colors.glow, 0.16 + charge * 0.3 + swing * 0.25)
  ctx.lineWidth = glowW + 5
  strokeBlade(ctx, sword, hx, hy, dx, dy, ex, ey, len, t)
  ctx.stroke()
  ctx.strokeStyle = rgba(sword.colors.glow, 0.5 + charge * 0.35)
  ctx.lineWidth = glowW * 0.55
  strokeBlade(ctx, sword, hx, hy, dx, dy, ex, ey, len, t)
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'

  // ---- 2. tsuba (guard): crisp disc at the hand (swells with z — the
  // hand socket pitching toward the camera shows the guard's face) ----
  ctx.fillStyle = '#4a5d7d'
  ctx.beginPath()
  ctx.ellipse(hx + dx * 2.2, hy + dy * 2.2, 2.2 * zm, 5.6 * zm, a + Math.PI / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = rgba(sword.colors.accent, 0.95)
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.ellipse(hx + dx * 2.2, hy + dy * 2.2, 2.2 * zm, 5.6 * zm, a + Math.PI / 2, 0, Math.PI * 2)
  ctx.stroke()

  // ---- 3. the blade: filled polygon with sori + kissaki + habaki ----
  // base past the tsuba; motohaba (base width) → kissaki taper — the base
  // width rides the foreshortening multiplier zm (blade face → camera)
  const bx0 = hx + dx * 3.4
  const by0 = hy + dy * 3.4
  const bladeLen = len - 3.4
  const wBase = 2.1 * sword.trailWidth * zm
  // fill body
  ctx.beginPath()
  buildBladePolygon(ctx, sword, bx0, by0, dx, dy, ex, ey, bladeLen, wBase, t)
  ctx.fillStyle = rgba(sword.colors.blade, 0.96)
  ctx.fill()
  // spine (mune) hairline — separates the two faces
  ctx.strokeStyle = rgba(sword.colors.trail2, 0.9)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  const munePts = bladeSpine(bx0, by0, dx, dy, ex, ey, bladeLen, wBase)
  ctx.moveTo(munePts[0], munePts[1])
  ctx.quadraticCurveTo(munePts[2], munePts[3], munePts[4], munePts[5])
  ctx.stroke()
  // habaki (blade collar): bright metallic band right past the tsuba
  ctx.strokeStyle = rgba(sword.colors.core, 0.92)
  ctx.lineWidth = 3.4 * sword.trailWidth
  ctx.beginPath()
  ctx.moveTo(bx0 + ex * 0.4, by0 + ey * 0.4)
  ctx.lineTo(bx0 + dx * 5 - ex * 0.2, by0 + dy * 5 - ey * 0.2)
  ctx.stroke()
  // ha (cutting edge) highlight — the glowing sharp side
  ctx.strokeStyle = rgba(sword.colors.core, 0.9)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  const edgePts = bladeEdge(sword, bx0, by0, dx, dy, ex, ey, bladeLen, wBase, t)
  ctx.moveTo(edgePts[0], edgePts[1])
  ctx.quadraticCurveTo(edgePts[2], edgePts[3], edgePts[4], edgePts[5])
  ctx.stroke()

  // ---- 4. kissaki (tip) glint + charge halo ----
  const tipX = hx + dx * len
  const tipY = hy + dy * len
  ctx.globalCompositeOperation = 'lighter'
  // the tip flares with depth — a blade driving at the lens blooms
  const tw = (2.2 + Math.sin(t * 9) * 0.7 + charge * 3 + swing * 3.6) * (1 + Math.max(0, z) * 1.3)
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
  // ---- 5. CAMERA-PIERCE FLARE: when the thrust drives the blade deep
  // toward the lens (z > 0.55), bloom a hard halo + streak ring at the
  // kissaki — instant depth pop, the anime "spear at the screen" beat ----
  if (z > 0.55) {
    const pz = (z - 0.55) / 0.45
    const fr = 9 + pz * 15 + swing * 6
    ctx.strokeStyle = rgba(sword.colors.glow, 0.5 * pz)
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.arc(tipX, tipY, fr, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = rgba(sword.colors.core, 0.85 * pz)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(tipX, tipY, fr * 0.62, 0, Math.PI * 2)
    ctx.stroke()
    // radial pierce streaks
    ctx.strokeStyle = rgba(sword.colors.core, 0.4 * pz)
    ctx.lineWidth = 1
    for (let i = 0; i < 5; i++) {
      const sa = a + Math.PI + (i - 2) * 0.16
      ctx.beginPath()
      ctx.moveTo(tipX + Math.cos(sa) * fr * 1.15, tipY + Math.sin(sa) * fr * 1.15)
      ctx.lineTo(tipX + Math.cos(sa) * fr * 1.8, tipY + Math.sin(sa) * fr * 1.8)
      ctx.stroke()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
}

/** Builds the filled blade silhouette: ha (curved edge) → kissaki → mune. */
function buildBladePolygon(
  ctx: CanvasRenderingContext2D,
  sword: SwordDef,
  bx: number, by: number,
  dx: number, dy: number, ex: number, ey: number,
  len: number, wBase: number,
  t: number,
): void {
  // sori: the blade bows toward the cutting edge (~6% of length, peak at 60%)
  const sori = len * 0.06
  // per-sword edge character offset at parameter k (0..1)
  const jit = (k: number): number => {
    switch (sword.id) {
      case 'thunder':
        return Math.sin(k * 19 + t * 31) * 1.1
      case 'inferno':
        return Math.sin(k * 9 + t * 17) * 1.6
      case 'void':
        return Math.sin(k * 6 - t * 5) * 0.7
      case 'phantom':
        return 0
      default:
        return 0
    }
  }
  // ha (edge) curve — from the wide base to the kissaki
  const e0x = bx + ex * wBase
  const e0y = by + ey * wBase
  const midK = 0.62
  const emx = bx + dx * len * midK + ex * (sori + jit(midK) + wBase * 0.24)
  const emy = by + dy * len * midK + ey * (sori + jit(midK) + wBase * 0.24)
  const kx = bx + dx * len + ex * (sori * 1.15 + jit(1))
  const ky = by + dy * len + ey * (sori * 1.15 + jit(1))
  // mune (spine) curve — straighter, meets the kissaki
  const m0x = bx - ex * wBase * 0.86
  const m0y = by - ey * wBase * 0.86
  const mmx = bx + dx * len * 0.6 - ex * (wBase * 0.42 - sori * 0.25 - jit(0.6) * 0.5)
  const mmy = by + dy * len * 0.6 - ey * (wBase * 0.42 - sori * 0.25 - jit(0.6) * 0.5)
  ctx.moveTo(e0x, e0y)
  ctx.quadraticCurveTo(emx, emy, kx, ky)
  ctx.lineTo(kx - dx * 2.2, ky - dy * 2.2) // yokote line — the tip facet
  ctx.quadraticCurveTo(mmx, mmy, m0x, m0y)
  ctx.closePath()
}

/** Edge (ha) polyline for the highlight stroke. */
function bladeEdge(
  sword: SwordDef,
  bx: number, by: number,
  dx: number, dy: number, ex: number, ey: number,
  len: number, wBase: number,
  t: number,
): number[] {
  const sori = len * 0.06
  const jit = (k: number): number => {
    switch (sword.id) {
      case 'thunder': return Math.sin(k * 19 + t * 31) * 1.1
      case 'inferno': return Math.sin(k * 9 + t * 17) * 1.6
      case 'void': return Math.sin(k * 6 - t * 5) * 0.7
      default: return 0
    }
  }
  const midK = 0.62
  return [
    bx + ex * wBase,
    by + ey * wBase,
    bx + dx * len * midK + ex * (sori + jit(midK) + wBase * 0.24),
    by + dy * len * midK + ey * (sori + jit(midK) + wBase * 0.24),
    bx + dx * len + ex * (sori * 1.15 + jit(1)),
    by + dy * len + ey * (sori * 1.15 + jit(1)),
  ]
}

/** Spine (mune) polyline for the hairline stroke. */
function bladeSpine(
  bx: number, by: number,
  dx: number, dy: number, ex: number, ey: number,
  len: number, wBase: number,
): number[] {
  const sori = len * 0.06
  const mmx = bx + dx * len * 0.6 - ex * (wBase * 0.42 - sori * 0.25)
  const mmy = by + dy * len * 0.6 - ey * (wBase * 0.42 - sori * 0.25)
  return [
    bx - ex * wBase * 0.86,
    by - ey * wBase * 0.86,
    mmx,
    mmy,
    bx + dx * len + ex * sori,
    by + dy * len + ey * sori,
  ]
}

/** Aura stroke path (centerline of the blade with sori). */
function strokeBlade(
  ctx: CanvasRenderingContext2D,
  sword: SwordDef,
  hx: number, hy: number,
  dx: number, dy: number, ex: number, ey: number,
  len: number,
  t: number,
): void {
  const sori = len * 0.06 * 0.5
  const wobble = sword.id === 'thunder' ? Math.sin(t * 31) * 1.1 : sword.id === 'inferno' ? Math.sin(t * 17) * 1.4 : 0
  ctx.beginPath()
  ctx.moveTo(hx + dx * 3.4, hy + dy * 3.4)
  ctx.quadraticCurveTo(
    hx + dx * len * 0.62 + ex * (sori + wobble),
    hy + dy * len * 0.62 + ey * (sori + wobble),
    hx + dx * len,
    hy + dy * len,
  )
}
