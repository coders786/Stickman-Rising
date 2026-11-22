/** Canvas-only overlays in CSS pixels, on the final, unrotated HUD pass. */
import { clamp, clamp01, damp, fmt } from '../core/utils'
import { DASH_STAMINA_COST, POWER_DASH_STAMINA_COST } from '../combat/stamina'
import { styleColor } from '../combat/style'

interface ScreenPoint { x: number; y: number }
export interface SafeInsets { top: number; right: number; bottom: number; left: number }
export interface RouteTelemetry {
  metres: number; sector: number; biome: string; safe: string | null
  gate: { distance: number; eta: number | null; locked: boolean } | null
}

export interface HudComboState {
  hits: number
  mult: number
  rank: string
  timer: number
  timerMax: number
  rankUpT: number
  lastHitT: number
}

export interface HudState {
  hp: number
  maxHp: number
  energy: number
  maxEnergy: number
  stamina: number
  maxStamina: number
  dashCharge: number
  /** THE DUAL CHARGE blade-segment (RAIJIN ZAN): 0..1 while dash + heavy
   * are both held in the planted charge — the HUD's release prompt. */
  slashCharge: number
  /** stance feeding the dual-charge status line: drawn steel reads
   * RAIJIN ZAN; sheathed fists read the alternating fist/foot release. */
  swordDrawn: boolean
  /** next sheathed dual release (alternates per use): 'punch' | 'kick'. */
  fistStrike: 'punch' | 'kick'
  staminaCooldown: number
  meter: number
  swordName: string
  swordColor: string
  abilityName: string
  abilityCost: number
  combo: HudComboState
  wave: number
  enemiesLeft: number
  kills: number
  score: number
  boss: { hp: number; maxHp: number; name: string } | null
  banner: { title: string; sub: string; t: number; dur: number; color: string } | null
  executePrompt: ScreenPoint | null
  ultReady: boolean
  abilityReady: boolean
  shield?: number
  insets?: SafeInsets
  route?: RouteTelemetry
  terminal?: ScreenPoint & { progress: number; buff: string }
  buff?: { name: string; seconds: number }
  fps: number
  touch?: boolean
  showFps: boolean
  /** particle system level (0 OFF / 1 LOW / 2 FULL) — B toggles in-game */
  particleLevel: number
  runTime: number
  attract: boolean
}

export const HUD_PAD = 16
const GAP = 8
const MONO = '"Consolas", "Menlo", monospace'
const DISPLAY = '"Arial Black", "Segoe UI", Arial, sans-serif'
const INK = '#f1f6fa', DIM = '#acbdc9', MINT = '#9fe4c8', SKY = '#add8ec', WARM = '#f1c795', PINK = '#ffaacd'
export interface HudBox { x: number; y: number; w: number; h: number }

export function hudRegions(w: number, h: number, touch: boolean, shield = 0, inset?: SafeInsets) {
  const l = (inset?.left ?? 0) + HUD_PAD, r = w - (inset?.right ?? 0) - HUD_PAD
  const top = (inset?.top ?? 0) + HUD_PAD, bottom = h - (inset?.bottom ?? 0) - HUD_PAD
  const span = Math.max(48, r - l), small = span < 580
  const vitW = small ? Math.round(span * .37) : Math.min(264, Math.round(span * .33))
  const scoreW = small ? Math.max(81, Math.round(span * .25)) : Math.min(206, Math.round(span * .27))
  const centerW = Math.min(264, span - vitW - scoreW - GAP * 2)
  const stacked = centerW < 88
  const vitality: HudBox = { x: l, y: top, w: vitW, h: shield > 0 ? 157 : 134 }
  const score: HudBox = { x: r - scoreW, y: top + (touch ? 52 : 0), w: scoreW, h: 91 }
  const telemetry: HudBox = { x: stacked ? l : clamp(Math.round((l + r - centerW) / 2), l + vitW + GAP, r - scoreW - centerW - GAP),
    y: stacked ? Math.max(vitality.y + vitality.h, score.y + score.h) + GAP : top,
    w: stacked ? span : centerW, h: 110 }
  const fps: HudBox = { x: l, y: Math.min(bottom - 23, vitality.y + vitality.h + GAP + (stacked ? telemetry.h + GAP : 0)), w: 80, h: 23 }
  return { vitality, telemetry, score, fps, l, r, top, bottom, small, stack: stacked }
}

function plate(ctx: CanvasRenderingContext2D, { x, y, w, h }: HudBox, edge: string, fill = 'rgba(6,12,20,.93)'): void {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#a4c1d93c'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1)
  ctx.fillStyle = edge; ctx.fillRect(x + 1, y + 1, 16, 1.6)
}
function text(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, width: number,
  size: number, color: string, align: CanvasTextAlign = 'left', display = false): void {
  if (width <= 0) return
  ctx.font = `bold ${size}px ${display ? DISPLAY : MONO}`
  ctx.textAlign = align; ctx.fillStyle = color
  ctx.fillText(label, x, y, width)
}
function track(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: number, color: string): void {
  ctx.fillStyle = '#2a3b49'; ctx.fillRect(x, y, w, h)
  ctx.fillStyle = color; ctx.fillRect(x, y, w * clamp01(f), h)
}

const keyboardHint = (s: HudState, w: number) => !s.touch && s.runTime < 16 && w >= 720
const bannerAlpha = (b: HudState['banner']) => !b || b.t >= b.dur || b.title.startsWith('WAVE ') ? 0 :
  clamp01(b.t / .18) * clamp01((b.dur - b.t) / .35)

/** Keep this stamp in sync with the painter. Capture visual values, not
 * references to live game objects. Round the fast-moving text counters the
 * way they are drawn; keep animated geometry/fades exact. Reuse the slots
 * instead of allocating a snapshot/string on every display callback. */
class HudInkStamp {
  private readonly values: (number | string | boolean | null)[] = []
  private at = 0
  private same = false

  private mark(v: number | string | boolean | null): void {
    if (this.values[this.at] !== v) { this.values[this.at] = v; this.same = false }
    this.at++
  }

  update(s: HudState, w: number, delayedHp: number, scene: string): boolean {
    this.at = 0; this.same = true
    this.mark(s.attract)
    if (!s.attract) {
      // Layout and vitality.
      this.mark(!!s.touch)
      this.mark(s.insets?.left ?? 0); this.mark(s.insets?.top ?? 0)
      this.mark(s.insets?.right ?? 0); this.mark(s.insets?.bottom ?? 0)
      this.mark(s.hp); this.mark(s.maxHp); this.mark(delayedHp)
      this.mark(s.shield ?? 0)
      this.mark(s.stamina); this.mark(s.maxStamina); this.mark(s.staminaCooldown > 0)
      this.mark(s.dashCharge); this.mark(s.slashCharge)
      if (s.slashCharge >= .999) { this.mark(s.swordDrawn); this.mark(s.fistStrike) }
      this.mark(s.meter); this.mark(s.ultReady)
      this.mark(s.energy); this.mark(s.maxEnergy); this.mark(s.abilityReady)

      // Telemetry. Travel time, position and gate ETA can advance without
      // changing their displayed digits; don't invalidate from raw time.
      const t = s.route, gate = t?.gate
      this.mark(!!t)
      if (t) {
        this.mark(t.sector); this.mark(t.biome); this.mark(Math.floor(t.metres)); this.mark(t.safe)
      } else {
        this.mark(s.wave); this.mark(scene); this.mark(Math.round(s.runTime))
      }
      this.mark(!!gate?.locked)
      if (!t?.safe) {
        this.mark(s.enemiesLeft)
        if (!gate?.locked) {
          this.mark(!!gate)
          if (gate) {
            this.mark(Math.ceil(gate.distance))
            this.mark(gate.eta !== null && gate.eta < 100 ? Math.ceil(gate.eta) : null)
          } else this.mark(s.kills)
        }
      }

      // Score, stacked notices and world-anchored prompts.
      const c = s.combo, b = s.banner, boss = s.boss, buff = s.buff
      this.mark(Math.round(s.score)); this.mark(c.rank); this.mark(c.hits); this.mark(c.mult)
      this.mark(c.rankUpT > 0); this.mark(c.hits > 0 ? clamp01(c.timer / c.timerMax) : 0)
      this.mark(!!boss)
      if (boss) { this.mark(boss.name); this.mark(clamp01(boss.hp / boss.maxHp)) }
      this.mark(!!buff)
      if (buff) { this.mark(buff.name); this.mark(buff.seconds) }
      const alpha = bannerAlpha(b)
      this.mark(alpha)
      if (alpha && b) { this.mark(b.title); this.mark(b.sub); this.mark(b.color) }
      const exec = s.executePrompt, terminal = s.terminal
      this.mark(!!exec)
      if (exec) { this.mark(exec.x); this.mark(exec.y) }
      this.mark(!!terminal)
      if (terminal) {
        this.mark(terminal.x); this.mark(terminal.y); this.mark(clamp01(terminal.progress || 0)); this.mark(terminal.buff)
      }
      this.mark(keyboardHint(s, w))
      this.mark(s.showFps)
      if (s.showFps) this.mark(Math.round(s.fps))
    }
    if (this.values.length !== this.at) { this.values.length = this.at; this.same = false }
    return this.same
  }
}

export class HUD {
  private hpDisplay = 100
  private scene = 'Viaduct'
  private fpsInk: string | null = null
  private readonly ink = new HudInkStamp()
  private layer: CanvasRenderingContext2D | null = null
  private layerW = 0
  private layerH = 0
  private layerBW = 0
  private layerBH = 0

  get lastFpsDraw(): string | null { return this.fpsInk }
  invalidateLayer(): void { this.layer = null }
  reset(): void { this.hpDisplay = 100; this.fpsInk = null; this.invalidateLayer() }
  dispose(): void { this.reset() }
  setMoodLabel(name: string): void { this.scene = name }

  private advance(s: HudState, dt: number): void {
    if (!s.attract && this.hpDisplay !== s.hp) this.hpDisplay = damp(this.hpDisplay, s.hp, 7, dt)
  }

  /** The scene backing is repainted by its owner: inline HUD ink must be
   * applied on every submit, and must never clear the world. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState, dt: number): void {
    this.invalidateLayer()
    this.advance(s, dt)
    this.paint(ctx, w, h, s)
  }

  /** Independent layer only. A match does not clear, transform or rasterize.
   * Do not mark an incomplete paint reusable after an exception or loss. */
  drawLayer(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState, dt: number, deviceScale: number): boolean {
    if (ctx.isContextLost?.()) { this.invalidateLayer(); return false }
    const ratio = Math.min(2, deviceScale || 1), c = ctx.canvas
    const bw = Math.max(1, Math.round(w * ratio)), bh = Math.max(1, Math.round(h * ratio))
    this.advance(s, dt)
    const sameInk = this.ink.update(s, w, this.hpDisplay, this.scene)
    if (sameInk && this.layer === ctx && w === this.layerW && h === this.layerH &&
        bw === this.layerBW && bh === this.layerBH && c.width === bw && c.height === bh) return false

    this.invalidateLayer()
    if (c.width !== bw) c.width = bw
    if (c.height !== bh) c.height = bh
    ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0)
    ctx.clearRect(0, 0, w, h)
    this.paint(ctx, w, h, s)
    if (ctx.isContextLost?.()) return false
    this.layer = ctx; this.layerW = w; this.layerH = h; this.layerBW = bw; this.layerBH = bh
    return true
  }

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): void {
    this.fpsInk = null
    if (s.attract) return
    const r = hudRegions(w, h, !!s.touch, s.shield, s.insets)
    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.textBaseline = 'alphabetic'
    this.vitality(ctx, r.vitality, s)
    this.telemetry(ctx, r.telemetry, s)
    this.score(ctx, r.score, s)
    let noticeY = r.telemetry.y + r.telemetry.h + GAP
    if (s.boss) {
      const b = { ...r.telemetry, y: noticeY, h: 30 }
      plate(ctx, b, '#ff9380')
      text(ctx, s.boss.name, b.x + b.w * .5, b.y + 14, b.w - 12, 10, '#ffc4b5', 'center')
      track(ctx, b.x + 7, b.y + 20, b.w - 14, 4, s.boss.hp / s.boss.maxHp, '#ff8978')
      noticeY += b.h + GAP
    }
    if (s.buff) {
      const b = { ...r.telemetry, y: noticeY, h: r.small ? 34 : 24 }
      plate(ctx, b, WARM)
      text(ctx, s.buff.name, b.x + b.w / 2, b.y + 14, b.w - (r.small ? 12 : 50), 10, WARM, 'center')
      text(ctx, `${s.buff.seconds}s`, r.small ? b.x + b.w / 2 : b.x + b.w - 7, b.y + (r.small ? 27 : 15), 36, 10, INK, r.small ? 'center' : 'right')
      noticeY += b.h + GAP
    }
    const alpha = bannerAlpha(s.banner)
    if (alpha && s.banner) {
      const width = Math.min(300, r.r - r.l)
      const b = { x: Math.round((r.l + r.r - width) / 2), y: Math.max(r.score.y + r.score.h + GAP, noticeY), w: width, h: 41 }
      ctx.save(); ctx.globalAlpha = alpha
      plate(ctx, b, s.banner.color)
      text(ctx, s.banner.title, b.x + b.w / 2, b.y + 17, b.w - 18, 13, INK, 'center', true)
      text(ctx, s.banner.sub, b.x + b.w / 2, b.y + 32, b.w - 18, 10, DIM, 'center')
      ctx.restore()
    }
    const reserved = [r.vitality, r.telemetry, r.score]
    if (s.showFps) reserved.push(r.fps)
    if (s.executePrompt) this.prompt(ctx, s.executePrompt, s.touch ? 'TAP EXEC' : 'E  EXECUTE', r, reserved)
    if (s.terminal) this.prompt(ctx, s.terminal, s.touch ? 'TAP SERVICE' : 'HOLD E  1.5s', r, reserved,
      '+40 HP · +50 SHIELD · COST: FLOW', s.terminal.progress || 0, s.terminal.buff)
    if (keyboardHint(s, w)) {
      const box = { x: Math.round((w - 514) / 2), y: r.bottom - 24, w: 514, h: 24 }
      plate(ctx, box, '#538397', 'rgba(6,12,20,.83)')
      text(ctx, 'A/D MOVE   J/K STRIKE   L DASH   SPACE JUMP   O PARRY   R OVERDRIVE', w / 2, r.bottom - 8, box.w - 14, 11, DIM, 'center')
    }
    // FPS is always the last ink. No inherited alpha, effect transform,
    // compressed rank-width budget or viewport-bottom control conflict.
    if (s.showFps) {
      plate(ctx, r.fps, SKY, '#080e17')
      const label = `${Math.round(s.fps)} FPS`
      text(ctx, label, r.fps.x + r.fps.w / 2, r.fps.y + 16, r.fps.w - 10, 12, INK, 'center')
      this.fpsInk = label
    }
    ctx.restore()
  }

  private vitality(ctx: CanvasRenderingContext2D, b: HudBox, s: HudState): void {
    plate(ctx, b, '#ff91a6')
    const x = b.x + 8, w = b.w - 16, y = b.y
    const hp = clamp01(s.hp / s.maxHp), delayed = clamp01(this.hpDisplay / s.maxHp)
    const canDash = s.stamina >= DASH_STAMINA_COST, canPower = s.stamina >= POWER_DASH_STAMINA_COST
    text(ctx, 'VITALITY', x, y + 16, w - 31, 10, DIM)
    text(ctx, `${Math.ceil(s.hp)}`, x + w, y + 16, 42, 12, '#ffd7de', 'right')
    track(ctx, x, y + 22, w, 6, delayed, '#f2b8c0')
    ctx.fillStyle = '#ff667e'; ctx.fillRect(x, y + 22, hp * w, 6)
    const shield = s.shield ?? 0, d = shield > 0 ? 23 : 0
    if (shield > 0) {
      text(ctx, 'SHIELD', x, y + 43, w - 20, 10, SKY)
      text(ctx, `${Math.ceil(shield)}`, x + w, y + 43, 28, 11, SKY, 'right')
      track(ctx, x, y + 48, w, 3, shield / 50, '#7ccbfa')
    }
    text(ctx, 'STAMINA', x, y + 45 + d, w - 28, 10, DIM)
    text(ctx, `${Math.floor(s.stamina)}`, x + w, y + 45 + d, 36, 11, MINT, 'right')
    track(ctx, x, y + 50 + d, w, 6, s.stamina / s.maxStamina, canDash ? '#80dcae' : '#ff9d87')
    ctx.fillStyle = '#132a27'
    for (const threshold of [DASH_STAMINA_COST, POWER_DASH_STAMINA_COST])
      ctx.fillRect(x + w * clamp01(threshold / s.maxStamina), y + 50 + d, 1.7, 6)
    const charge = clamp01(s.dashCharge), slash = clamp01(s.slashCharge)
    const status = slash > 0 ? (slash >= .999 ? canPower ?
      (s.swordDrawn ? 'RELEASE: RAIJIN ZAN' : `RELEASE: ${s.fistStrike === 'kick' ? 'FUJIN KYAKU' : 'RAIJIN KEN'}`) : 'POWER LOW' : `CHAIN CHARGE ${Math.round(slash * 100)}%`)
      : charge > 0 ? (charge >= .999 ? canPower ? 'RELEASE: POWER' : 'RELEASE: DASH' : `CHARGING ${Math.round(charge * 100)}%`)
      : !canDash ? 'EXHAUSTED' : !canPower ? 'POWER LOW' : s.staminaCooldown > 0 ? 'RECOVERING' : 'POWER READY'
    text(ctx, status, x, y + 70 + d, w, 9, canDash ? MINT : '#ff9d87')
    if (charge || slash) track(ctx, x, y + 74 + d, w, 2, slash || charge, '#e8ffd2')
    text(ctx, 'OVERDRIVE', x, y + 91 + d, w * .64, 10, s.ultReady ? PINK : DIM)
    text(ctx, s.ultReady ? (s.touch ? 'READY' : 'R READY') : `${Math.floor(s.meter)}%`, x + w, y + 91 + d, w * .45, 10, PINK, 'right')
    track(ctx, x, y + 97 + d, w, 5, s.meter / 100, s.ultReady ? '#ffa5d3' : '#bb6696')
    text(ctx, s.touch ? 'SPEC' : 'U · SPEC', x, y + 120 + d, w * .55, 9, s.abilityReady ? SKY : DIM)
    text(ctx, `${Math.floor(s.energy)} EN`, x + w, y + 120 + d, w * .45, 9, SKY, 'right')
    track(ctx, x, y + 124 + d, w, 2, s.energy / s.maxEnergy, '#78bcd2')
  }

  private telemetry(ctx: CanvasRenderingContext2D, b: HudBox, s: HudState): void {
    const t = s.route, center = b.x + b.w * .5, w = b.w - 14, y = b.y
    plate(ctx, b, t?.safe ? WARM : SKY)
    text(ctx, t ? `SECTOR ${String(t.sector).padStart(2, '0')}` : `WAVE ${s.wave}`, center, y + 16, w, 10, SKY, 'center')
    text(ctx, t ? t.biome.toUpperCase() : this.scene.toUpperCase(), center, y + 32, w, 10, INK, 'center')
    text(ctx, t ? `${Math.floor(t.metres)} m` : `${Math.round(s.runTime)} s`, center, y + 57, w, 21, INK, 'center', true)
    text(ctx, t?.safe ?? `${s.enemiesLeft} ${s.enemiesLeft === 1 ? 'THREAT' : 'THREATS'}`, center, y + 77, w, 10,
      t?.safe ? WARM : s.enemiesLeft ? '#ffc3aa' : DIM, 'center')
    const gate = t?.gate
    const gateLabel = t?.safe ? 'FLOW HELD' : gate ? gate.locked ? 'GATE LOCKED' :
      `BOSS ${Math.ceil(gate.distance)}m${gate.eta !== null && gate.eta < 100 ? ` · ${Math.ceil(gate.eta)}s` : ''}` : `${s.kills} KILLS`
    text(ctx, gateLabel, center, y + 96, w, 10, gate?.locked ? '#ffa892' : t?.safe ? WARM : DIM, 'center')
  }

  private score(ctx: CanvasRenderingContext2D, b: HudBox, s: HudState): void {
    const c = s.combo, rank = c.rank || '—', color = styleColor(rank)
    plate(ctx, b, c.rankUpT > 0 ? color : '#778c9e')
    const x = b.x + b.w - 8, w = b.w - 16
    text(ctx, 'SCORE', x, b.y + 16, w, 10, DIM, 'right')
    text(ctx, fmt(s.score), x, b.y + 39, w, 20, INK, 'right', true)
    text(ctx, `STYLE ${rank}`, x, b.y + 57, w, 11, color, 'right')
    text(ctx, `${c.hits} H · ×${c.mult.toFixed(1)}`, x, b.y + 72, w, 10, DIM, 'right')
    track(ctx, b.x + 8, b.y + 79, w, 3, c.hits > 0 ? c.timer / c.timerMax : 0, color)
  }

  private prompt(ctx: CanvasRenderingContext2D, p: ScreenPoint, title: string, r: ReturnType<typeof hudRegions>, reserved: HudBox[],
    desc?: string, progress?: number, buff?: string): void {
    if (p.x < r.l - 8 || p.x > r.r + 8 || p.y < r.top + 12 || p.y > r.bottom) return
    const width = desc ? Math.min(251, r.r - r.l) : 112
    const b = { x: Math.round(clamp(p.x - width * .5, r.l, r.r - width)), y: Math.round(p.y) - (desc ? 62 : 32), w: width, h: desc ? 56 : 26 }
    if (b.y < r.top || reserved.some(q => q.x < b.x + b.w && q.x + q.w > b.x && q.y < b.y + b.h && q.y + q.h > b.y)) return
    const color = desc ? WARM : '#ffd0b1', x = b.x + b.w / 2
    plate(ctx, b, color, '#0b141e')
    text(ctx, title, x, b.y + 17, b.w - 12, 11, color, 'center')
    if (desc) {
      text(ctx, desc, x, b.y + 31, b.w - 12, 9, INK, 'center')
      if (buff) text(ctx, buff, x, b.y + 43, b.w - 12, 9, WARM, 'center')
      track(ctx, b.x + 7, b.y + 48, b.w - 14, 3, progress ?? 0, WARM)
    }
    const tip = clamp(p.x, b.x + 7, b.x + b.w - 7)
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(tip - 3, b.y + b.h); ctx.lineTo(tip + 3, b.y + b.h); ctx.lineTo(p.x, p.y); ctx.fill()
  }
}
