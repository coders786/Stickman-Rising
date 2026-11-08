/** STICKMAN RISING — animation inspection lab + QA harness (spec §12).
 *
 * A dedicated diagnostic environment rendered ON TOP of the game:
 *  · SOLO view     — the live character, zoomed, skeleton overlay with
 *                    joint pivots + anatomical labels + foot-contact
 *                    markers + ground line + animation state readout
 *  · SHEET view    — 8-frame contact sheets of every locomotion cycle
 *                    (walk / run / sprint / combat / backpedal / idle)
 *                    side by side for reference comparison, each frame
 *                    solved through the REAL skeleton — inspect the
 *                    actual rendered poses, not code-level assertions
 *  · QA harness    — `window.__srQA.run()`: scripted input sequences
 *                    (walk→run→sprint→combat→backpedal→attacks) with
 *                    anatomy invariants, NaN scan, foot-lock check, loco
 *                    transition log, and combo verification. Result lands
 *                    on `window.__qaResult`.
 */

import { Game } from '../game'
import { Player, LocoMode } from '../entities/player'
import { makePose, Pose } from '../anim/pose'
import { makeSkelGeom, solveSkeleton, PLAYER_SPEC, SkelGeom, drawStick, PLAYER_STYLE } from '../anim/skeleton'
import { sampleClip } from '../anim/animator'
import {
  WALK_CLIP, RUN_CLIP, SPRINT_CLIP, COMBAT_STEP_CLIP, BACKPEDAL_CLIP, IDLE_CLIP,
} from '../anim/clips'

const PSCALE = 2.4 // solo-view zoom

/* ------------------------------------------------------------------ */
/* the panel                                                           */
/* ------------------------------------------------------------------ */

export type InspectMode = 'off' | 'solo' | 'sheet'

export class Inspect {
  mode: InspectMode = 'off'
  showBones = true
  showLabels = true
  showFeet = true

  private scratchPose: Pose = makePose()
  private scratchGeom: SkelGeom = makeSkelGeom()

  setMode(m: InspectMode): void {
    this.mode = m
  }

  toggleBones(): void {
    this.showBones = !this.showBones
  }

  /** bottom-left HUD readout (always on while mode != off) */
  draw(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    if (this.mode === 'off') return
    const p = game.player
    ctx.save()
    ctx.font = '600 12px ui-monospace, monospace'
    ctx.textBaseline = 'top'

    if (this.mode === 'solo') {
      this.drawSolo(ctx, game, time)
    } else if (this.mode === 'sheet') {
      this.drawSheets(ctx)
    }

    // state readout (uses public player surface + bracket access for privates)
    const dark = this.mode === 'sheet' // light backdrop → dark text
    const priv = p as unknown as Record<string, unknown>
    const lines = [
      `INSPECT: ${this.mode}${this.showBones ? ' +bones' : ''}`,
      `state=${p.state}  loco=${p.loco}  locoT=${Number(priv.locoT ?? 0).toFixed(2)}s`,
      `dash=${p.dashVariant}${p.dashHandoff ? ' (handoff)' : ''}  cd=${Number(priv.dashCd ?? 0).toFixed(2)}  rec=${Number(priv.dashRecharge ?? 0).toFixed(2)}`,
      `vx=${p.vx.toFixed(0)}  vy=${p.vy.toFixed(0)}  grounded=${p.grounded}  face=${p.face}`,
      `enemyW=${p.enemyNearW.toFixed(2)}  threat=${p.hasThreat ? 'yes' : 'no'}  surrounded=${Boolean(priv.surrounded)}`,
      `postAtk=${Number(priv.postAttackT ?? 0).toFixed(2)}  turn=${Number(priv.turnT ?? 0).toFixed(2)}`,
      `footLock=${Number(priv.footLock ?? 0).toFixed(1)}  hipY=${p.hipY.toFixed(1)}`,
    ]
    let y = 10
    for (const ln of lines) {
      ctx.fillStyle = dark ? 'rgba(240,246,250,0.85)' : 'rgba(2,8,14,0.72)'
      const wdt = ctx.measureText(ln).width
      ctx.fillRect(8, y - 2, wdt + 10, 15)
      ctx.fillStyle = dark ? '#12354e' : '#8ff3ff'
      ctx.fillText(ln, 13, y)
      y += 17
    }
    ctx.restore()
  }

  /** big live character + skeleton overlay, centered-left — drawn on a
   * light diagnostic panel so the black silhouette reads at full contrast */
  private drawSolo(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const p = game.player
    const dpr = window.devicePixelRatio || 1
    const Z = PSCALE / 1.32 // zoom factor over the in-game world scale
    const cx = (ctx.canvas.width / dpr) * 0.26
    const groundY = (ctx.canvas.height / dpr) * 0.82
    const hipScreenY = groundY + p.hipY * Z
    // light diagnostic panel behind the figure (contrast for the black body)
    ctx.save()
    ctx.fillStyle = '#dfe7ee'
    ctx.beginPath()
    ctx.roundRect(cx - 250, groundY - 330, 500, 348, 14)
    ctx.fill()
    ctx.strokeStyle = 'rgba(40,70,100,0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
    // body: local geom → screen at PSCALE
    ctx.save()
    ctx.translate(cx, hipScreenY)
    ctx.scale(p.face * PSCALE, PSCALE)
    drawStick(ctx, p.geom, PLAYER_STYLE, { time })
    this.drawSkeleton(ctx, p.geom)
    ctx.restore()
    // ground line + foot contact markers at their true screen positions
    ctx.save()
    ctx.strokeStyle = 'rgba(30,90,140,0.65)'
    ctx.lineWidth = 2
    ctx.setLineDash([7, 5])
    ctx.beginPath()
    ctx.moveTo(cx - 240, groundY)
    ctx.lineTo(cx + 240, groundY)
    ctx.stroke()
    ctx.setLineDash([])
    if (this.showFeet) {
      const ptScreen = (j: { x: number; y: number }) => ({
        x: cx + p.face * PSCALE * j.x,
        y: hipScreenY + PSCALE * j.y,
      })
      const rA = ptScreen(p.geom.ankleR)
      const lA = ptScreen(p.geom.ankleL)
      // planted = lowest foot within reach of the ground line
      const rPlanted = p.grounded && p.geom.ankleR.y >= p.geom.ankleL.y
      const lPlanted = p.grounded && p.geom.ankleL.y > p.geom.ankleR.y
      this.drawFootMarker(ctx, rA.x, rA.y, rPlanted)
      this.drawFootMarker(ctx, lA.x, lA.y, lPlanted)
    }
    ctx.restore()
  }

  private drawFootMarker(ctx: CanvasRenderingContext2D, x: number, y: number, planted: boolean): void {
    ctx.fillStyle = planted ? '#51ff8e' : 'rgba(255,170,60,0.8)'
    ctx.beginPath()
    ctx.arc(x, y, 4.5, 0, Math.PI * 2)
    ctx.fill()
  }

  /** bones + joints + labels on any solved geom (local space) */
  private drawSkeleton(ctx: CanvasRenderingContext2D, g: SkelGeom): void {
    if (!this.showBones) return
    ctx.save()
    ctx.strokeStyle = 'rgba(65,246,255,0.55)'
    ctx.lineWidth = 1.1
    const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    seg(g.hip, g.waist); seg(g.waist, g.chest); seg(g.chest, g.neckTop); seg(g.neckTop, g.headC)
    seg(g.hipPtR, g.kneeR); seg(g.kneeR, g.ankleR); seg(g.ankleR, g.toeR)
    seg(g.hipPtL, g.kneeL); seg(g.kneeL, g.ankleL); seg(g.ankleL, g.toeL)
    seg(g.shoulderR, g.elbR); seg(g.elbR, g.handR)
    seg(g.shoulderL, g.elbL); seg(g.elbL, g.handL)
    // shoulder girdle line (the anatomy fix, visualized)
    ctx.strokeStyle = 'rgba(255,120,180,0.8)'
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(g.shoulderL.x, g.shoulderL.y)
    ctx.lineTo(g.neckTop.x, g.neckTop.y)
    ctx.lineTo(g.shoulderR.x, g.shoulderR.y)
    ctx.stroke()
    // joints
    ctx.fillStyle = '#ffd24a'
    const joints = [
      g.hip, g.hipPtR, g.hipPtL, g.waist, g.chest, g.neckTop, g.headC,
      g.shoulderR, g.shoulderL, g.elbR, g.elbL, g.handR, g.handL,
      g.kneeR, g.kneeL, g.ankleR, g.ankleL,
    ]
    for (const j of joints) {
      ctx.beginPath()
      ctx.arc(j.x, j.y, 1.7, 0, Math.PI * 2)
      ctx.fill()
    }
    // THE proof joints: shoulders in pink
    ctx.fillStyle = '#ff6fb5'
    for (const j of [g.shoulderR, g.shoulderL]) {
      ctx.beginPath()
      ctx.arc(j.x, j.y, 3.0, 0, Math.PI * 2)
      ctx.fill()
    }
    if (this.showLabels) {
      ctx.fillStyle = 'rgba(160,240,255,0.95)'
      ctx.font = '600 4.2px ui-monospace, monospace'
      const lbl = (j: { x: number; y: number }, s: string) => ctx.fillText(s, j.x + 2.4, j.y - 2.4)
      lbl(g.headC, 'skull')
      lbl(g.neckTop, 'neckTop')
      lbl(g.shoulderR, 'SHOULDER-R')
      lbl(g.shoulderL, 'shoulder-l')
      lbl(g.chest, 'chest')
      lbl(g.waist, 'waist')
      lbl(g.hip, 'pelvis')
      lbl(g.kneeR, 'kneeR')
      lbl(g.ankleR, 'ankleR')
      lbl(g.elbR, 'elbR')
      lbl(g.handR, 'handR')
    }
    ctx.restore()
  }

  /** contact sheets: every locomotion cycle, 8 frames each, real solve —
   * light diagnostic background, per-cell ground lines + foot-contact
   * markers (green = support, orange = swing), 2 clip-groups per band */
  private drawSheets(ctx: CanvasRenderingContext2D): void {
    const rows: Array<[string, typeof WALK_CLIP]> = [
      ['WALK', WALK_CLIP],
      ['RUN', RUN_CLIP],
      ['SPRINT', SPRINT_CLIP],
      ['COMBAT', COMBAT_STEP_CLIP],
      ['BACKPEDAL', BACKPEDAL_CLIP],
      ['IDLE', IDLE_CLIP],
    ]
    const dpr = window.devicePixelRatio || 1
    const w = ctx.canvas.width / dpr
    const h = ctx.canvas.height / dpr
    const cols = 8
    const groupsPerRow = 2
    const bands = Math.ceil(rows.length / groupsPerRow) // 3 bands
    const cellW = w / (cols * groupsPerRow)
    const rowH = h / (bands + 0.25)
    // figure scale: fit character height inside a band minus label space
    const S = Math.min(1.0, (rowH - 34) / 138)
    ctx.save()
    // light diagnostic backdrop — black silhouette at full contrast
    ctx.fillStyle = '#e9eef3'
    ctx.fillRect(0, 0, w, h)
    ctx.font = '700 12px ui-monospace, monospace'
    for (let r = 0; r < rows.length; r++) {
      const band = Math.floor(r / groupsPerRow)
      const group = r % groupsPerRow
      const [label, clip] = rows[r]
      const baseY = rowH * (band + 1)
      const labelX = group * (w / groupsPerRow) + 10
      ctx.fillStyle = '#1a3a52'
      ctx.fillText(`${label} · ${clip.dur.toFixed(2)}s cycle`, labelX, baseY - rowH + 16)
      for (let c = 0; c < cols; c++) {
        const t = (clip.dur * c) / cols
        sampleClip(clip, t, this.scratchPose)
        const g = solveSkeleton(this.scratchPose, PLAYER_SPEC, this.scratchGeom)
        // normalize: lowest foot contact sits ON this cell's ground line
        const lowContact = Math.max(g.ankleL.y, g.ankleR.y, g.toeL.y, g.toeR.y)
        const cx = group * (w / groupsPerRow) + cellW * (c + 0.5)
        const groundY = baseY - 14
        ctx.save()
        ctx.translate(cx, groundY - (lowContact + 2.4) * S)
        ctx.scale(S, S)
        drawStick(ctx, g, PLAYER_STYLE, { time: t, simple: true })
        ctx.restore()
        // per-cell ground line
        ctx.strokeStyle = 'rgba(40,80,110,0.45)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx - cellW * 0.42, groundY)
        ctx.lineTo(cx + cellW * 0.42, groundY)
        ctx.stroke()
        // foot-contact markers: green = support (near ground), orange = swing
        const hipY = groundY - (lowContact + 2.4) * S
        const markFoot = (j: { x: number; y: number }) => {
          const airborne = (lowContact - j.y) > 4 // clearly lifted vs support
          ctx.fillStyle = airborne ? 'rgba(255,140,30,0.9)' : '#18c25a'
          ctx.beginPath()
          ctx.arc(cx + j.x * S, hipY + j.y * S, 3, 0, Math.PI * 2)
          ctx.fill()
        }
        markFoot(g.ankleR)
        markFoot(g.ankleL)
        // frame tick
        ctx.fillStyle = 'rgba(30,70,100,0.55)'
        ctx.font = '600 9px ui-monospace, monospace'
        ctx.fillText(`f${c}`, cx - 5, baseY - 3)
      }
    }
    ctx.restore()
  }
}

/* ------------------------------------------------------------------ */
/* QA harness                                                          */
/* ------------------------------------------------------------------ */

interface QaCheck {
  name: string
  pass: boolean
  detail: string
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Scripted end-to-end verification. Parks the report on
 * window.__qaResult. Drive from the browser console / agent-browser. */
export async function runQA(game: Game): Promise<void> {
  const checks: QaCheck[] = []
  const log: string[] = []
  const p = game.player
  const input = game.input

  const samplePose = () => {
    let bad = 0
    for (let i = 0; i < 17; i++) if (!Number.isFinite(p.pose[i])) bad++
    return bad
  }

  try {
    // ---- setup: controlled empty arena (waves suppressed, player alive) ----
    game.qaMode = true
    game.phase = 'playing'
    game.enemies.length = 0
    game.waves.reset()
    // release every virtual input left held by prior console driving —
    // stale held buttons contaminate the whole scripted sequence
    input.setVirtualAxis(0, 0)
    for (const a of ['left', 'right', 'up', 'down', 'light', 'heavy', 'dash', 'jump', 'parry', 'ability', 'ult', 'execute'] as const) {
      input.setVirtual(a, false)
    }
    p.reset(400)
    input.setEnabled(true)
    log.push('setup ok')

    // ---- 1. anatomy invariants (the arms-from-the-neck fix) ----
    {
      const g = p.geom
      const spec = PLAYER_SPEC
      const armLen = Math.hypot(g.elbR.x - g.shoulderR.x, g.elbR.y - g.shoulderR.y)
      // local y grows DOWN: shoulder below neck-top means shoulderR.y GREATER
      const shoulderBelowNeck = g.shoulderR.y > g.neckTop.y + 1.5
      const armFromShoulder = Math.abs(armLen - spec.upperArm) < 0.6
      // neck column rises above chest: neckTop.y LESS (more negative) than chest
      const neckVisible = g.neckTop.y < g.chest.y - 2.5
      checks.push({
        name: 'anatomy: shoulder joints below neck top',
        pass: shoulderBelowNeck,
        detail: `shoulderR.y=${g.shoulderR.y.toFixed(1)} neckTop.y=${g.neckTop.y.toFixed(1)}`,
      })
      checks.push({
        name: 'anatomy: arm chains FROM shoulder (len=upperArm)',
        pass: armFromShoulder,
        detail: `len=${armLen.toFixed(2)} spec=${spec.upperArm}`,
      })
      checks.push({
        name: 'anatomy: neck column visible above chest',
        pass: neckVisible,
        detail: `neckTop.y=${g.neckTop.y.toFixed(1)} chest.y=${g.chest.y.toFixed(1)}`,
      })
    }

    // ---- 2. walk → run escalation (Condition A, analog speed mapping) ----
    input.setVirtualAxis(0.55, 0)
    await sleep(700)
    const earlyMode = p.loco
    const earlyVx = Math.abs(p.vx)
    input.setVirtualAxis(1, 0)
    await sleep(1500)
    const fullMode = p.loco
    input.setVirtualAxis(0, 0)
    await sleep(500)
    checks.push({
      name: 'locomotion: WALK at partial input',
      pass: earlyMode === 'walk' && earlyVx > 60 && earlyVx < 210,
      detail: `mode@0.7s=${earlyMode} vx=${earlyVx.toFixed(0)}`,
    })
    checks.push({
      name: 'locomotion: RUN at full input',
      pass: fullMode === 'run',
      detail: `mode@2.2s=${fullMode}`,
    })

    // ---- 3. sprint latch via double-tap (button events → press stamps) ----
    input.setVirtual('right', true)
    await sleep(120)
    input.setVirtual('right', false)
    await sleep(60)
    input.setVirtual('right', true)
    await sleep(900)
    const sprintMode = p.loco
    const sprintVx = Math.abs(p.vx)
    input.setVirtual('right', false)
    await sleep(400)
    checks.push({
      name: 'locomotion: sprint after double-tap',
      pass: sprintMode === 'sprint' && sprintVx > 380,
      detail: `loco=${sprintMode} vx=${sprintVx.toFixed(0)}`,
    })

    // ---- 4. combat mode when enemy near (Condition B) ----
    const { Enemy } = await import('../entities/enemy')
    const foe = new Enemy('grunt', p.x + 240, 1)
    foe.spawning = false
    foe.state = 'stun' // stun STATE + huge timer = truly frozen (stunT alone
    foe.stunT = 999   // does nothing from 'enter' — the foe chased & hit us)
    game.enemies.push(foe)
    input.setVirtualAxis(0.5, 0)
    await sleep(800)
    const combatMode = p.loco
    const enemyW = p.enemyNearW
    checks.push({
      name: 'context: combat locomotion near enemy',
      pass: combatMode === 'combat' && enemyW > 0.5,
      detail: `loco=${combatMode} enemyW=${enemyW.toFixed(2)}`,
    })

    // ---- 5. backpedal away from threat (facing HOLDS toward the enemy) ----
    input.setVirtualAxis(-0.5, 0) // partial retreat: stays under the escape speed
    await sleep(600)
    const backMode = p.loco
    const backFace = p.face
    input.setVirtualAxis(0, 0)
    await sleep(300)
    checks.push({
      name: 'context: backpedal retreating vs threat',
      pass: backMode === 'backpedal' && backFace === 1,
      detail: `loco=${backMode} face=${backFace}`,
    })

    // ---- 5b. THE DASH SYSTEM (six situational variants) ----
    // (a) forward dash: variant + displacement + momentum handoff
    {
      const x0 = p.x
      input.setVirtualAxis(1, 0) // HOLD the direction → handoff at exit
      input.setVirtual('dash', true)
      await sleep(50)
      const midVariant = p.dashVariant
      const midState = p.state
      input.setVirtual('dash', false)
      // poll for the exit frame — sample the handed-off velocity exactly at
      // the dash→move transition (before locomotion friction bleeds it)
      let tailVx = 0
      for (let i = 0; i < 30; i++) {
        await sleep(16)
        if (p.state === 'move') { tailVx = Math.abs(p.vx); break }
      }
      await sleep(250) // dash (0.16s) + exit bleed
      const dx = p.x - x0
      input.setVirtualAxis(0, 0)
      await sleep(400)
      checks.push({
        name: 'dash: forward variant lunges',
        pass: midVariant === 'forward' && midState === 'dash' && dx > 90,
        detail: `variant=${midVariant} state=${midState} dx=${dx.toFixed(0)}`,
      })
      checks.push({
        name: 'dash: momentum handoff (no dead stop)',
        pass: tailVx > 300 && p.dashHandoff,
        detail: `vx@exit=${tailVx.toFixed(0)} handoff=${p.dashHandoff}`,
      })
    }
    // (b) backdash: variant + FACE HOLDS toward the threat (guard retreat)
    {
      const x0 = p.x
      const faceBefore = p.face
      input.setVirtualAxis(-1, 0)
      input.setVirtual('dash', true)
      await sleep(50)
      const backVariant = p.dashVariant
      input.setVirtual('dash', false)
      await sleep(250)
      const dx = p.x - x0
      const faceAfter = p.face
      input.setVirtualAxis(0, 0)
      await sleep(400)
      checks.push({
        name: 'dash: backdash evades with guard held',
        pass: backVariant === 'back' && dx < -60 && faceAfter === faceBefore,
        detail: `variant=${backVariant} dx=${dx.toFixed(0)} face ${faceBefore}→${faceAfter}`,
      })
    }
    // (c) chained second dash mirrors the stride + recharge gates spam
    {
      input.setVirtualAxis(1, 0)
      input.setVirtual('dash', true)
      await sleep(50)
      input.setVirtual('dash', false)
      await sleep(280) // first dash ends (consec → 1)
      input.setVirtual('dash', true)
      await sleep(50)
      const chainVariant = p.dashVariant // second dash → mirrored stride
      input.setVirtual('dash', false)
      await sleep(150)
      // second dash fired consec=2 → recharge window must be active
      const privP = p as unknown as { dashRecharge: number }
      const recharging = privP.dashRecharge > 0
      input.setVirtualAxis(0, 0)
      await sleep(500)
      checks.push({
        name: 'dash: chain mirrors stride, recharge gates',
        pass: chainVariant === 'forward2' && recharging,
        detail: `variant=${chainVariant} recharge=${recharging}`,
      })
    }
    // (d) escape variant: surrounded pocket converts the retreat into the carve
    {
      const { Enemy: EnemyCtor } = await import('../entities/enemy')
      // fresh SYMMETRIC formation around the CURRENT position (the earlier
      // tests moved the player — stale foe placement breaks the pocket read)
      game.enemies.length = 0
      const foeA = new EnemyCtor('grunt', p.x + 220, 1)
      const foeB = new EnemyCtor('grunt', p.x - 220, 1)
      for (const f of [foeA, foeB]) { f.spawning = false; f.state = 'stun'; f.stunT = 999 }
      game.enemies.push(foeA, foeB)
      await sleep(500) // scanEnemies hysteresis: surrounded flag settles
      input.setVirtualAxis(-1, 0)
      input.setVirtual('dash', true)
      await sleep(50)
      const escVariant = p.dashVariant
      input.setVirtual('dash', false)
      input.setVirtualAxis(0, 0)
      await sleep(350)
      // restore a fresh target in strike range for section 6
      game.enemies.length = 0
      const foe6 = new EnemyCtor('grunt', p.x + 150, 1)
      foe6.spawning = false
      foe6.state = 'stun'
      foe6.stunT = 999
      game.enemies.push(foe6)
      await sleep(300)
      checks.push({
        name: 'dash: surrounded retreat becomes escape carve',
        pass: escVariant === 'escape',
        detail: `variant=${escVariant}`,
      })
    }

    // ---- 6. combat attacks land (the golden path) ----
    const comboBefore = (game as unknown as { combo?: { hits: number } }).combo?.hits ?? 0
    for (let i = 0; i < 6; i++) {
      input.setVirtual('light', true)
      await sleep(60)
      input.setVirtual('light', false)
      await sleep(320)
    }
    await sleep(700)
    const comboAfter = (game as unknown as { combo?: { hits: number } }).combo?.hits ?? 0
    checks.push({
      name: 'combat: light attacks connect',
      pass: comboAfter > comboBefore,
      detail: `hits ${comboBefore}→${comboAfter}`,
    })

    // ---- 7. NaN scan through everything ----
    const badCh = samplePose()
    checks.push({
      name: 'stability: no NaN pose channels',
      pass: badCh === 0,
      detail: `bad=${badCh}`,
    })

    // ---- 8. foot lock when grounded idle (settled: no enemies, no input) ----
    game.enemies.length = 0
    input.setVirtualAxis(0, 0)
    await sleep(1200) // let every blend/spring settle into guard idle
    const priv = p as unknown as Record<string, number>
    // grounded ⇒ y=0 ⇒ hipY = −footLock EXACTLY (the lock IS the hip height)
    const lockErr = Math.abs(p.hipY + (priv.footLock ?? 0))
    // anatomical hip-height band: deep crouch 48 … full extension 78 world px
    const lockBand = (priv.footLock ?? 0) > 48 && (priv.footLock ?? 0) < 78
    checks.push({
      name: 'grounding: footLock is the hip height (y=0)',
      pass: p.grounded && p.y === 0 && lockErr < 1.5 && lockBand,
      detail: `hipY=${p.hipY.toFixed(1)} footLock=${(priv.footLock ?? 0).toFixed(1)} err=${lockErr.toFixed(2)}`,
    })

    // ---- cleanup: restore the real game ----
    game.qaMode = false
    game.enemies.length = 0
    input.setVirtualAxis(0, 0)
    p.reset(400)
    log.push(`loco log: early=${earlyMode} full=${fullMode} sprint=${sprintMode} combat=${combatMode} back=${backMode}`)
  } catch (err) {
    checks.push({ name: 'harness', pass: false, detail: String(err) })
  } finally {
    game.qaMode = false
  }

  const fails = checks.filter((c) => !c.pass)
  const report = {
    pass: fails.length === 0,
    total: checks.length,
    failed: fails.length,
    checks,
    log,
    at: new Date().toISOString(),
  }
  ;(window as unknown as Record<string, unknown>).__qaResult = report
}

export type { LocoMode, Player }
