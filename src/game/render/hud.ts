/** STICKMAN RISING — canvas HUD: vital bars, combo counter with rank escalation,
 * wave banners, boss bar, execution prompts, damage vignette.
 */

import { clamp01, damp, fmt, rgba, TAU } from '../core/utils'
import {DASH_STAMINA_COST,POWER_DASH_STAMINA_COST} from '../combat/stamina'

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

  /* low-HP red vignette: baked plate (see drawLowHpVignette) */
  private lowHpPlate: HTMLCanvasElement | null = null
  private lowHpW = 0
  private lowHpH = 0

  reset(): void {
    this.hpDisplay = 100
    this.comboPop = 0
    this.rankFlash = 0
    this.lastHits = 0
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

  /** A single responsive panel keeps all resources aligned and legible. */
  private panelWidth(w:number):number{return Math.min(350,Math.max(150,w*.55),w-140)}

  private drawVitals(ctx: CanvasRenderingContext2D, w: number, s: HudState): void {
    const x=12,y=12,pw=this.panelWidth(w),pad=10,bx=x+pad,bw=pw-pad*2
    const stamina=clamp01(s.stamina/s.maxStamina),hp=clamp01(s.hp/s.maxHp)
    const energy=clamp01(s.energy/s.maxEnergy),ult=clamp01(s.meter/100)
    const canDash=s.stamina>=DASH_STAMINA_COST,canPower=s.stamina>=POWER_DASH_STAMINA_COST
    const charge=clamp01(s.dashCharge),slash=clamp01(s.slashCharge),compact=pw<215
    ctx.save()
    // One backing surface instead of separately clipped, overlapping plates.
    ctx.fillStyle='rgba(5,11,18,.88)';ctx.fillRect(x,y,pw,154)
    ctx.strokeStyle='rgba(170,213,221,.26)';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,pw-1,153)
    ctx.fillStyle=s.swordColor;ctx.fillRect(x,y,3,154)
    const text=(label:string,value:string,yy:number,color:string)=>{
      ctx.font=`bold 10px ${MONO}`;ctx.textAlign='left';ctx.fillStyle='rgba(218,230,235,.96)'
      ctx.fillText(label,bx,yy,bw*.53)
      ctx.textAlign='right';ctx.fillStyle=color;ctx.fillText(value,bx+bw,yy,bw*.47)
    }
    const bar=(yy:number,height:number,fraction:number,color:string)=>{
      ctx.fillStyle='rgba(37,50,55,.9)';ctx.fillRect(bx,yy,bw,height)
      ctx.fillStyle=color;ctx.fillRect(bx,yy,bw*fraction,height)
    }
    text('HEALTH',`${Math.ceil(s.hp)} / ${s.maxHp}`,y+16,'#ffc4c9')
    bar(y+21,8,clamp01(this.hpDisplay/s.maxHp),'#f5b5bd')
    bar(y+21,8,hp,'#ff5064')
    text('ENERGY',`${Math.floor(s.energy)} / ${s.maxEnergy}`,y+44,'#80e8ef')
    bar(y+49,6,energy,'#39dbe7')
    text('STAMINA',`${Math.floor(s.stamina)} / ${s.maxStamina}`,y+71,canDash?'#b8ffcf':'#ff9890')
    bar(y+76,13,stamina,canDash?'#60dd9a':'#fa8875')
    // Exact cost markers make the two launch limits visible on any pool size.
    ctx.strokeStyle='rgba(4,16,13,.9)';ctx.lineWidth=2
    for(const cost of [DASH_STAMINA_COST,POWER_DASH_STAMINA_COST]){
      const tx=bx+bw*clamp01(cost/s.maxStamina)
      ctx.beginPath();ctx.moveTo(tx,y+76);ctx.lineTo(tx,y+89);ctx.stroke()
    }
    ctx.font=`bold 9px ${MONO}`;ctx.textAlign='left'
    ctx.fillStyle=canDash?'rgba(207,236,222,.95)':'#ffaaa0'
    const status=slash>0?(
      s.swordDrawn
        ?(slash>=.999?(canPower?'RELEASE BOTH: RAIJIN ZAN':'BLADE LOCKED — STAMINA LOW'):`BLADE CHARGING ${Math.round(slash*100)}% — HOLD HEAVY`)
        :(slash>=.999?(canPower?`RELEASE BOTH: ${s.fistStrike==='kick'?'FUJIN KYAKU':'RAIJIN KEN'}`:'FISTS LOCKED — STAMINA LOW'):`FIST CHARGING ${Math.round(slash*100)}% — HOLD HEAVY`))
      :charge>0?(charge>=.999?(canPower?'RELEASE: POWER':'RELEASE: NORMAL'):`CHARGING ${Math.round(charge*100)}%`)
      :!canDash?'EXHAUSTED':!canPower?'POWER LOW':s.staminaCooldown>0?'RECOVERING':'POWER READY'
    ctx.fillText(status,bx,y+103,bw*.53)
    ctx.textAlign='right';ctx.fillStyle='rgba(187,211,200,.95)'
    ctx.fillText(compact?'45 / 120':'DASH 45  |  POWER 120',bx+bw,y+103,bw*.43)
    // Charge indicator is distinct from stamina: holding is not spending.
    // The dual (blade) segment draws on the same strip, one grade hotter —
    // drawn steel reads white.
    ctx.fillStyle='rgba(34,48,47,.95)';ctx.fillRect(bx,y+107,bw,3)
    if(slash>0){ctx.fillStyle=canPower?(slash>=.999?'#ffffff':'#d5ffe0'):'#f2bc69';ctx.fillRect(bx,y+107,bw*slash,3)}
    else if(charge>0){ctx.fillStyle=canPower?'#d5ff8c':'#f2bc69';ctx.fillRect(bx,y+107,bw*charge,3)}
    ctx.font=`bold 9px ${MONO}`;ctx.textAlign='left';ctx.fillStyle='rgba(207,218,228,.9)'
    ctx.fillText(compact?'ULT':'ULTIMATE',bx,y+123,bw*.35)
    ctx.textAlign='right';ctx.fillStyle=s.ultReady?'#ff80bd':'#cda0b8'
    ctx.fillText(s.ultReady?'READY [I]':`${Math.floor(s.meter)}%`,bx+bw,y+123,bw*.6)
    bar(y+127,4,ult,s.ultReady?'#ff5ab2':'#b73e7c')
    ctx.font=`bold 9px ${MONO}`;ctx.textAlign='left';ctx.fillStyle='rgba(188,214,220,.95)'
    const equip=compact?(s.swordName.includes('SHEATHED')?'EMPTY HAND':'SWORD DRAWN'):s.swordName
    ctx.fillText(equip,bx,y+145,bw*.53)
    ctx.textAlign='right';ctx.fillStyle=s.abilityReady?'#7fe5ed':'#82949d'
    ctx.fillText(s.abilityReady?'[U] READY':`[U] ${s.abilityCost} EN`,bx+bw,y+145,bw*.47)
    ctx.restore()
  }

  private drawScore(ctx: CanvasRenderingContext2D, w: number, s: HudState): void {
    // Reserve the upper-right 48px for the touch pause button on narrow screens.
    const compact=w<850,x=w-(compact?64:16),available=Math.max(45,x-(12+this.panelWidth(w)+8))
    ctx.save();ctx.textAlign='right';ctx.fillStyle='#f0f7fa';ctx.font=`900 ${compact?16:20}px ${FONT}`
    ctx.fillText(fmt(s.score),x,29,available)
    ctx.font=`10px ${MONO}`;ctx.fillStyle='rgba(200,219,225,.9)'
    if(compact){
      ctx.fillText(`WAVE ${s.wave}`,x,45,available)
      ctx.fillText(`${s.enemiesLeft} FOES`,x,59,available)
      ctx.fillText(`${s.kills} KILLS`,x,73,available)
    } else ctx.fillText(`WAVE ${s.wave}  HOSTILES ${s.enemiesLeft}  KILLS ${s.kills}`,x,48,available)
    ctx.restore()
  }

  private drawCombo(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): void {
    const c = s.combo
    if (c.hits < 2) return
    const { rank, color } = rankForHits(c.hits)
    if(w<850){
      ctx.save();ctx.textAlign='right';ctx.font=`bold 12px ${FONT}`;ctx.fillStyle=color
      const x=w-64,available=Math.max(45,x-(12+this.panelWidth(w)+8))
      ctx.fillText(`${rank} ${c.hits} HITS  ×${c.mult.toFixed(1)}`,x,100,available)
      ctx.restore();return
    }
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
    const bw=this.panelWidth(w)-16
    const bx = 20
    const by = 181
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
    ctx.fillText(b.name, bx+bw/2, by + 26,bw)
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
    if (s.runTime > 14 || s.wave > 2 || w < 650) return
    const a = clamp01((14 - s.runTime) / 3) * 0.75
    ctx.save()
    ctx.globalAlpha = a
    ctx.textAlign = 'center'
    ctx.font = `10px ${MONO}`
    ctx.fillStyle = 'rgba(200,215,225,0.95)'
    ctx.fillText(
      'A/D MOVE   J LIGHT   K HEAVY   L DASH   SPACE JUMP   O PARRY   U ABILITY   E EXECUTE   Q SHEATHE/DRAW   HOLD L+K, RELEASE BOTH: RAIJIN ZAN / SHEATHED RAIJIN KEN·FUJIN KYAKU   1-6 SWORDS',
      w / 2,
      h - 16,
      w-24,
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
  return w<850?240:120
}
