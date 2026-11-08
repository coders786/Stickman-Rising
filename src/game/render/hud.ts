/** STICKMAN RISING — canvas HUD: vital bars, combo counter with rank escalation,
 * wave banners, boss bar, execution prompts, damage vignette.
 */

import { clamp01, damp, fmt, rgba, TAU } from '../core/utils'

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
  executePrompt: { x: number; y: number } | null
  ultReady: boolean
  abilityReady: boolean
  fps: number
  showFps: boolean
  runTime: number
  attract: boolean
}

const RANKS: [number, string, string][] = [
  [80, 'SSS', '#ffffff'],
  [55, 'SS', '#ff2d95'],
  [35, 'S', '#ff2a4a'],
  [20, 'A', '#ff6a1f'],
  [10, 'B', '#ffb02e'],
  [5, 'C', '#58c470'],
  [1, 'D', '#9aa0a6'],
]

export function rankForHits(hits: number): { rank: string; color: string } {
  for (const [min, rank, color] of RANKS) {
    if (hits >= min) return { rank, color }
  }
  return { rank: '', color: '#9aa0a6' }
}

const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif'
const MONO = '"Consolas", "Menlo", monospace'

export class HUD {
  private hpDisplay = 100
  private comboPop = 0
  private rankFlash = 0
  private lastHits = 0
  private bannerShake = 0
  private lowHpPulse = 0

  /* VITALS CHROME CACHE: the static bar furniture (skewed panel backs,
  * segment ticks, borders, EN label, sword chip frame) is pre-rendered
  * once into an offscreen plate and blitted per frame. The live version
  * redrew ~15 skewed fillRects + 10 strokes + a fresh gradient EVERY
  * frame — 2-4.6ms/frame on software raster (second-largest cost after
  * the grain). Only the dynamic fills + text remain live. */
  private vitalsPlate: HTMLCanvasElement | null = null
  private vitalsKey = ''
  private hpGrad: CanvasGradient | null = null
  private hpGradW = 0
  /* low-HP red vignette: baked plate (see drawLowHpVignette) */
  private lowHpPlate: HTMLCanvasElement | null = null
  private lowHpW = 0
  private lowHpH = 0

  reset(): void {
    this.hpDisplay = 100
    this.comboPop = 0
    this.rankFlash = 0
    this.lastHits = 0
    this.vitalsPlate = null
    this.vitalsKey = ''
    this.lowHpPlate = null
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState, dt: number): void {
    if (s.attract) return

    this.hpDisplay = damp(this.hpDisplay, s.hp, 7, dt)
    if (s.combo.hits > this.lastHits) {
      this.comboPop = 1
      this.lastHits = s.combo.hits
    } else if (s.combo.hits === 0) {
      this.lastHits = 0
    }
    this.comboPop = Math.max(0, this.comboPop - dt * 6)
    this.rankFlash = Math.max(0, s.combo.rankUpT)
    this.lowHpPulse += dt

    this.drawVitals(ctx, w, s)
    this.drawScore(ctx, w, s)
    this.drawCombo(ctx, w, h, s)
    this.drawBossBar(ctx, w, s)
    this.drawBanner(ctx, w, s, dt)
    this.drawPrompts(ctx, s)
    this.drawHints(ctx, w, h, s)
    this.drawLowHpVignette(ctx, w, h, s)
    if (s.showFps) {
      ctx.save()
      ctx.font = `12px ${MONO}`
      ctx.fillStyle = 'rgba(180,200,210,0.8)'
      ctx.textAlign = 'right'
      ctx.fillText(`${Math.round(s.fps)} FPS`, w - 14, h - 14)
      ctx.restore()
    }
  }

  /* ------------------------------------------------------------------ */

  private drawVitals(ctx: CanvasRenderingContext2D, w: number, s: HudState): void {
    const x = 18
    const y = 18
    const hpW = Math.min(300, w * 0.34)

    const hpFrac = clamp01(s.hp / s.maxHp)
    const dispFrac = clamp01(this.hpDisplay / s.maxHp)
    const sy = y + 24 + 15 + (s.ultReady ? 34 : 18)

    // ---- static chrome: one cached blit (rebuilds on layout change) ----
    const key = `${Math.round(w)}|${Math.round(hpW)}|${s.ultReady ? 1 : 0}`
    if (!this.vitalsPlate || this.vitalsKey !== key) {
      const ey = y + 24
      const uy = ey + 15
      const enW = hpW * 0.72
      const ultW = hpW * 0.5
      const c = document.createElement('canvas')
      // plate covers the full left panel down to the sword chip + ability line
      c.width = Math.max(2, Math.ceil(Math.min(w, x + 210)))
      c.height = Math.max(2, Math.ceil(sy + 40))
      const g2 = c.getContext('2d')
      if (g2) {
        // HP bar back + ticks + border (skewed — the parallelogram style)
        g2.save()
        g2.transform(1, 0, -0.22, 1, 12, 0)
        g2.fillStyle = 'rgba(6,9,14,0.85)'
        g2.fillRect(x, y, hpW, 16)
        g2.strokeStyle = 'rgba(4,6,10,0.7)'
        g2.lineWidth = 2
        for (let i = 1; i < 10; i++) {
          const tx = x + (hpW / 10) * i
          g2.beginPath()
          g2.moveTo(tx, y)
          g2.lineTo(tx, y + 16)
          g2.stroke()
        }
        g2.strokeStyle = 'rgba(230,240,245,0.35)'
        g2.lineWidth = 1
        g2.strokeRect(x, y, hpW, 16)
        // Energy back + border + label
        g2.fillStyle = 'rgba(6,9,14,0.85)'
        g2.fillRect(x, ey, enW, 9)
        g2.strokeStyle = 'rgba(230,240,245,0.25)'
        g2.lineWidth = 1
        g2.strokeRect(x, ey, enW, 9)
        // Ult back
        g2.fillStyle = 'rgba(6,9,14,0.85)'
        g2.fillRect(x, uy, ultW, 6)
        g2.restore()
        // EN label
        g2.fillStyle = 'rgba(160,200,215,0.8)'
        g2.font = `9px ${MONO}`
        g2.fillText('EN', x + 4, ey + 7)
        // sword chip frame
        g2.fillStyle = 'rgba(6,9,14,0.8)'
        g2.fillRect(x, sy, 172, 22)
      }
      this.vitalsPlate = c
      this.vitalsKey = key
    }
    if (this.vitalsPlate) ctx.drawImage(this.vitalsPlate, 0, 0)

    // ---- dynamic fills (2 rects each, straight) ----
    ctx.save()
    ctx.transform(1, 0, -0.22, 1, 12, 0) // skew
    // trailing damage (white ghost)
    ctx.fillStyle = 'rgba(255,235,235,0.55)'
    ctx.fillRect(x, y, hpW * dispFrac, 16)
    // hp gradient fill (gradient object cached per width)
    if (!this.hpGrad || this.hpGradW !== hpW) {
      const g = ctx.createLinearGradient(x, y, x + hpW, y)
      g.addColorStop(0, '#ff2a4a')
      g.addColorStop(1, '#ff6a5e')
      this.hpGrad = g
      this.hpGradW = hpW
    }
    ctx.fillStyle = this.hpGrad
    ctx.fillRect(x, y, hpW * hpFrac, 16)
    // energy fill
    const ey = y + 24
    const enW = hpW * 0.72
    const enFrac = clamp01(s.energy / s.maxEnergy)
    ctx.fillStyle = s.abilityReady ? '#35f2ff' : 'rgba(53,242,255,0.45)'
    ctx.fillRect(x, ey, enW * enFrac, 9)
    // ult fill
    const uy = ey + 15
    const ultW = hpW * 0.5
    const ultFrac = clamp01(s.meter / 100)
    ctx.fillStyle = s.ultReady ? '#ff2d95' : 'rgba(255,45,149,0.5)'
    ctx.fillRect(x, uy, ultW * ultFrac, 6)
    ctx.restore()

    // ---- live text ----
    ctx.font = `10px ${MONO}`
    ctx.fillStyle = 'rgba(200,215,225,0.85)'
    ctx.textAlign = 'left'
    ctx.fillText(`HP ${Math.ceil(s.hp)}`, x + 8, y + 11)

    if (s.ultReady) {
      const pulse = 0.6 + 0.4 * Math.sin(this.lowHpPulse * 8)
      ctx.fillStyle = rgba('#ff2d95', pulse)
      ctx.font = `900 11px ${FONT}`
      ctx.fillText('BLADE MODE READY  [I]', x + 4, uy + 22)
    }

    // sword chip: color edge + name (chip bg lives on the plate)
    ctx.fillStyle = s.swordColor
    ctx.fillRect(x, sy, 4, 22)
    ctx.fillStyle = 'rgba(235,240,245,0.95)'
    ctx.font = `900 11px ${FONT}`
    ctx.fillText(s.swordName, x + 12, sy + 15)
    // ability status
    ctx.font = `9px ${MONO}`
    ctx.fillStyle = s.abilityReady ? rgba(s.swordColor, 0.95) : 'rgba(140,150,160,0.7)'
    ctx.fillText(
      s.abilityReady ? `[U] ${s.abilityName} — ${s.abilityCost} EN` : `${s.abilityName} — NEED ${s.abilityCost} EN`,
      x + 12,
      sy + 34,
    )
  }

  private drawScore(ctx: CanvasRenderingContext2D, w: number, s: HudState): void {
    const x = w - 18
    ctx.save()
    ctx.textAlign = 'right'
    ctx.font = `900 20px ${FONT}`
    ctx.fillStyle = 'rgba(240,245,250,0.95)'
    ctx.fillText(fmt(s.score), x, 30)
    ctx.font = `10px ${MONO}`
    ctx.fillStyle = 'rgba(170,185,195,0.85)'
    ctx.fillText(`WAVE ${s.wave}   HOSTILES ${s.enemiesLeft}   KILLS ${s.kills}`, x, 48)
    ctx.restore()
  }

  /* ------------------------------------------------------------------ */

  private drawCombo(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): void {
    const c = s.combo
    if (c.hits < 2) return
    const { rank, color } = rankForHits(c.hits)
    const cx = w - 108
    const cy = h * 0.34
    const pop = 1 + this.comboPop * 0.35

    ctx.save()
    ctx.textAlign = 'center'

    // hits number
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(pop, pop)
    ctx.font = `900 54px ${FONT}`
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillText(`${c.hits}`, 3, 3)
    ctx.fillStyle = '#f4f9fc'
    ctx.fillText(`${c.hits}`, 0, 0)
    ctx.restore()

    ctx.font = `900 12px ${FONT}`
    ctx.fillStyle = 'rgba(200,215,225,0.9)'
    ctx.fillText('HITS', cx, cy + 18)

    // multiplier
    if (c.mult > 1) {
      ctx.font = `900 18px ${FONT}`
      ctx.fillStyle = rgba(color, 0.95)
      ctx.fillText(`×${c.mult.toFixed(1)}`, cx, cy - 52)
    }

    // rank letter
    if (rank) {
      const rs = 1 + this.rankFlash * 0.5
      ctx.save()
      ctx.translate(cx - 76, cy - 8)
      ctx.rotate(-0.08)
      ctx.scale(rs, rs)
      ctx.font = `900 44px ${FONT}`
      // glow
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = rgba(color, 0.45)
      ctx.fillText(rank, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = color
      ctx.fillText(rank, 0, 0)
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 1
      ctx.strokeText(rank, 0, 0)
      ctx.restore()
      // rank-up flash ring
      if (this.rankFlash > 0) {
        const r = (1 - this.rankFlash) * 70 + 26
        ctx.strokeStyle = rgba(color, this.rankFlash * 0.8)
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(cx - 76, cy - 22, r, 0, TAU)
        ctx.stroke()
      }
    }

    // combo timer drain
    const tw = 120
    const frac = clamp01(c.timer / c.timerMax)
    ctx.fillStyle = 'rgba(6,9,14,0.7)'
    ctx.fillRect(cx - tw / 2, cy + 30, tw, 5)
    ctx.fillStyle = frac > 0.4 ? rgba(color, 0.9) : '#ff2a4a'
    ctx.fillRect(cx - tw / 2, cy + 30, tw * frac, 5)
    ctx.restore()
  }

  private drawBossBar(ctx: CanvasRenderingContext2D, w: number, s: HudState): void {
    const b = s.boss
    if (!b) return
    const bw = Math.min(560, w * 0.6)
    const bx = w / 2 - bw / 2
    const by = 20
    const frac = clamp01(b.hp / b.maxHp)
    ctx.save()
    ctx.fillStyle = 'rgba(4,6,10,0.85)'
    ctx.fillRect(bx - 8, by - 6, bw + 16, 26)
    // segments
    const g = ctx.createLinearGradient(bx, by, bx + bw, by)
    g.addColorStop(0, '#ff2a4a')
    g.addColorStop(1, '#ff7a5e')
    ctx.fillStyle = g
    ctx.fillRect(bx, by, bw * frac, 14)
    ctx.strokeStyle = 'rgba(4,6,10,0.9)'
    ctx.lineWidth = 2
    for (let i = 1; i < 5; i++) {
      const tx = bx + (bw / 5) * i
      ctx.beginPath()
      ctx.moveTo(tx, by)
      ctx.lineTo(tx, by + 14)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(230,240,245,0.4)'
    ctx.lineWidth = 1
    ctx.strokeRect(bx, by, bw, 14)
    ctx.font = `900 12px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(240,245,250,0.95)'
    ctx.fillText(b.name, w / 2, by + 26)
    ctx.restore()
  }

  private drawBanner(ctx: CanvasRenderingContext2D, w: number, s: HudState, dt: number): void {
    const b = s.banner
    if (!b) return
    this.bannerShake += dt * 40
    const t = b.t / b.dur
    const appear = clamp01(b.t / 0.25)
    const fade = 1 - clamp01((b.t - b.dur + 0.5) / 0.5)
    const a = appear * fade
    if (a <= 0) return
    const cy = h_centerY(w)
    const jx = Math.sin(this.bannerShake) * 1.5 * (1 - t)

    ctx.save()
    ctx.globalAlpha = a
    ctx.textAlign = 'center'
    ctx.translate(w / 2 + jx, cy)
    // title with chromatic glitch
    ctx.font = `900 44px ${FONT}`
    ctx.fillStyle = rgba(b.color, 0.35)
    ctx.fillText(b.title, -3, 0)
    ctx.fillStyle = rgba(b.color, 0.35)
    ctx.fillText(b.title, 3, 1)
    ctx.fillStyle = '#f4f9fc'
    ctx.fillText(b.title, 0, 0)
    if (b.sub) {
      ctx.font = `900 15px ${FONT}`
      ctx.fillStyle = 'rgba(210,225,235,0.9)'
      ctx.fillText(b.sub, 0, 28)
    }
    // underline slash
    ctx.strokeStyle = rgba(b.color, 0.9)
    ctx.lineWidth = 3
    ctx.beginPath()
    const lw = 150 * appear
    ctx.moveTo(-lw, 40)
    ctx.lineTo(lw, 36)
    ctx.stroke()
    ctx.restore()
  }

  private drawPrompts(ctx: CanvasRenderingContext2D, s: HudState): void {
    const p = s.executePrompt
    if (!p) return
    const pulse = 0.7 + 0.3 * Math.sin(this.lowHpPulse * 10)
    ctx.save()
    ctx.textAlign = 'center'
    ctx.font = `900 15px ${FONT}`
    ctx.fillStyle = rgba('#ff2a4a', pulse)
    ctx.strokeStyle = 'rgba(4,6,10,0.9)'
    ctx.lineWidth = 4
    ctx.strokeText('E — EXECUTE', p.x, p.y)
    ctx.fillText('E — EXECUTE', p.x, p.y)
    ctx.restore()
  }

  private drawHints(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): void {
    if (s.runTime > 14 || s.wave > 2) return
    const a = clamp01((14 - s.runTime) / 3) * 0.75
    ctx.save()
    ctx.globalAlpha = a
    ctx.textAlign = 'center'
    ctx.font = `10px ${MONO}`
    ctx.fillStyle = 'rgba(200,215,225,0.95)'
    ctx.fillText(
      'A/D MOVE   J LIGHT   K HEAVY   L DASH   SPACE JUMP   O PARRY   U ABILITY   E EXECUTE   1-6 SWORDS',
      w / 2,
      h - 16,
    )
    ctx.restore()
  }

  private drawLowHpVignette(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): void {
    const frac = s.hp / s.maxHp
    if (frac > 0.32) return
    const intensity = (0.32 - frac) / 0.32
    const pulse = 0.55 + 0.45 * Math.sin(this.lowHpPulse * 5)
    const a = intensity * pulse * 0.5
    // baked red-edge plate (rebuilt only on resize) — the live radial
    // gradient + full-screen fill cost ~10-15ms/frame on software raster,
    // exactly when the player is hurt and combat is hottest
    if (!this.lowHpPlate || this.lowHpW !== w || this.lowHpH !== h) {
      const c = document.createElement('canvas')
      c.width = Math.max(2, Math.floor(w))
      c.height = Math.max(2, Math.floor(h))
      const g = c.getContext('2d')
      if (g) {
        const rg = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.85)
        rg.addColorStop(0, 'rgba(200,10,40,0)')
        rg.addColorStop(1, 'rgba(200,14,40,1)')
        g.fillStyle = rg
        g.fillRect(0, 0, w, h)
      }
      this.lowHpPlate = c
      this.lowHpW = w
      this.lowHpH = h
    }
    if (!this.lowHpPlate) return
    ctx.save()
    ctx.globalAlpha = a
    ctx.drawImage(this.lowHpPlate, 0, 0, w, h)
    ctx.restore()
  }
}

function h_centerY(w: number): number {
  // banner sits at a pleasant height regardless of width
  void w
  return 120
}
