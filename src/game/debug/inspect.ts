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
 *  · EDIT view     — the POSE EDITOR workstation: full sim freeze,
 *                    frame-scrub of the live clip, per-channel bend with
 *                    ROM-safe limits, mirror, 0.25× preview, keyframe()
 *                    export and a named-pose PRESET LIBRARY persisted in
 *                    localStorage (`window.__srPoseLib`). Keyboard-only,
 *                    canvas-drawn, zero DOM.
 *  · QA harness    — `window.__srQA.run()`: scripted input sequences
 *                    (walk→run→sprint→combat→backpedal→attacks) with
 *                    anatomy invariants, NaN scan, foot-lock check, loco
 *                    transition log, and combo verification. Result lands
 *                    on `window.__qaResult`.
 */

import { Game } from '../game'
import { Player, LocoMode } from '../entities/player'
import { makePose, Pose, CH, CH_COUNT, ChannelKey, NEUTRAL } from '../anim/pose'
import { PLAYER_SPEC, SkelGeom, PLAYER_STYLE } from '../anim/skeleton'
import { makeFighterGeom, solveFighter3D, drawFighter3D, type FighterGeom } from '../anim/rig3d'
import { sampleClip } from '../anim/animator'
import type { Animator, Clip } from '../anim/animator'
import { applyJointLimits } from '../anim/limits'
import {
  WALK_CLIP, RUN_CLIP, SPRINT_CLIP, COMBAT_STEP_CLIP, COMBAT_IDLE_CLIP,
  BACKPEDAL_CLIP, IDLE_CLIP, JUMP_CLIP,
  DASH_LAUNCH_CLIP, DASH_CARRY_CLIP, DASH_HUNT_CLIP, DASH_PIERCE_CLIP,
  DASH_RETREAT_CLIP, DASH_CARVE_CLIP,
} from '../anim/clips'

const PSCALE = 2.4 // solo-view zoom

/* ------------------------------------------------------------------ */
/* pose editor constants                                               */
/* ------------------------------------------------------------------ */

/** Editor channel order: root → spine → legs → arms → depth → blade.
 * Tab walks this list; it matches the authoring mental model top-down. */
const CHANNEL_KEYS: ChannelKey[] = [
  'rootX', 'rootY', 'rootRot', 'spine', 'head',
  'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR',
  'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR',
  'rootZ', 'pelvisYaw', 'chestYaw', 'hipLz', 'hipRz', 'armLz', 'armRz',
  'bladeYaw', 'bladeZ', 'foreLz', 'foreRz',
]

/** Mirror semantics follow clips.ts `mirrorLegs`: bilateral limb channels
 * swap PLAIN (a forward left leg becomes a forward right leg), while the
 * yaw/depth channels negate (mirroring flips which side leads in depth). */
const MIRROR_SWAP: Array<[ChannelKey, ChannelKey]> = [
  ['hipL', 'hipR'], ['kneeL', 'kneeR'], ['footL', 'footR'],
  ['shL', 'shR'], ['elL', 'elR'], ['wrL', 'wrR'],
]
const MIRROR_SWAP_NEG: Array<[ChannelKey, ChannelKey]> = [
  ['hipLz', 'hipRz'], ['armLz', 'armRz'], ['foreLz', 'foreRz'],
]
const MIRROR_NEGATE: ChannelKey[] = ['pelvisYaw', 'chestYaw', 'bladeYaw']

const EDIT_FRAME = 1 / 60 // one authored frame

/* ------------------------------------------------------------------ */
/* pose preset library                                                 */
/* ------------------------------------------------------------------ */

interface PoseLibEntry {
  name: string
  clip: string
  t: number
  /** full 28-channel pose snapshot (index = CH channel index) */
  ch: number[]
  at: string
}

const POSE_LIB_KEY = 'sr.poseLib.v1'

/** Named-pose store for the editor. In-memory + localStorage persistence
 * so authored poses survive reloads; exposed as `window.__srPoseLib`. */
export class PoseLibrary {
  private entries: PoseLibEntry[] = []

  constructor() {
    this.restore()
  }

  private restore(): void {
    try {
      const raw = window.localStorage.getItem(POSE_LIB_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      this.entries = parsed.filter(
        (e): e is PoseLibEntry =>
          typeof (e as PoseLibEntry)?.name === 'string' && Array.isArray((e as PoseLibEntry)?.ch),
      )
    } catch {
      // corrupted/unavailable storage → start empty; the library still works in memory
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(POSE_LIB_KEY, JSON.stringify(this.entries))
    } catch {
      // private mode / quota — session-only library is still usable
    }
  }

  list(): string[] {
    return this.entries.map((e) => e.name)
  }

  all(): readonly PoseLibEntry[] {
    return this.entries
  }

  get(i: number): PoseLibEntry | undefined {
    return this.entries[i]
  }

  find(name: string): PoseLibEntry | undefined {
    return this.entries.find((e) => e.name === name)
  }

  save(name: string, clip: string, t: number, pose: Pose): PoseLibEntry {
    const entry: PoseLibEntry = {
      name, clip, t,
      ch: Array.from(pose.slice(0, CH_COUNT)),
      at: new Date().toISOString(),
    }
    const i = this.entries.findIndex((e) => e.name === name)
    if (i >= 0) this.entries[i] = entry
    else this.entries.push(entry)
    this.persist()
    return entry
  }

  delete(name: string): boolean {
    const i = this.entries.findIndex((e) => e.name === name)
    if (i < 0) return false
    this.entries.splice(i, 1)
    this.persist()
    return true
  }
}

/* ------------------------------------------------------------------ */
/* the panel                                                           */
/* ------------------------------------------------------------------ */

export type InspectMode = 'off' | 'solo' | 'sheet' | 'edit'

export class Inspect {
  mode: InspectMode = 'off'
  showBones = true
  showLabels = true
  showFeet = true

  private scratchPose: Pose = makePose()
  private scratchGeom: FighterGeom = makeFighterGeom()

  /* ---- pose editor state (mode 'edit') ---- */
  /** named-pose store, shared with window.__srPoseLib */
  readonly poseLib = new PoseLibrary()
  private editClip: Clip | null = null
  private editTime = 0
  /** authored channel overrides: CH index → ABSOLUTE angle (radians).
   * Rendered pose = clip sample, then overrides, then ROM limits. */
  private overrides = new Map<number, number>()
  private channelIdx = 5 // start on hipL — the most-often-fixed channel
  private previewing = false
  private previewT = 0
  private editInit = false
  /** true once automation/keys explicitly set the editor clock — the
   * freeze-init then never overwrites it with the live animator time. */
  private editClockOwned = false
  /** scrub request made before the clip resolved — applied on first tick */
  private pendingScrub: number | null = null
  private editBase: Pose = makePose()
  private editPose: Pose = makePose()
  private editGeom: FighterGeom = makeFighterGeom()
  private lastExport = ''

  setMode(m: InspectMode): void {
    if (m !== 'edit') {
      this.editInit = false
      this.pendingScrub = null
    }
    if (m === 'edit') this.previewing = false
    this.mode = m
  }

  /** numbered view helper for automation: 0 off · 1 solo · 2 sheet · 3 edit */
  setView(v: InspectMode | number): void {
    const order: InspectMode[] = ['off', 'solo', 'sheet', 'edit']
    this.setMode(typeof v === 'number' ? (order[v] ?? 'off') : v)
  }

  cycleView(): void {
    const order: InspectMode[] = ['off', 'solo', 'sheet', 'edit']
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length])
  }

  toggleBones(): void {
    this.showBones = !this.showBones
  }

  /* ---------------------------------------------------------------- */
  /* POSE EDITOR (mode 'edit') — the authoring workstation             */
  /* ---------------------------------------------------------------- */

  /** Per-frame editor tick, called by Game BEFORE render while frozen:
   * consumes editor keys, advances the 0.25× preview and re-solves the
   * authored pose. The live sim stays untouched (zero gameplay mutation). */
  editorFrame(game: Game, dtRaw: number): void {
    if (this.mode !== 'edit') return
    const priv = game.player as unknown as Record<string, unknown>
    const anim = priv.animator as Animator | undefined
    this.editClip = anim?.getClip() ?? null
    this.editBladeLen = PLAYER_SPEC.blade * game.player.sword.stats.range * 1.06
    if (!this.editInit) {
      this.editInit = true
      this.previewing = false
      // freeze exactly the live moment: scrub starts at the animator's clock
      // (unless an explicit scrub/preset already claimed the editor clock)
      if (!this.editClockOwned) {
        this.editTime = Math.max(0, Math.min(anim?.getTime() ?? 0, this.editClip?.dur ?? 0))
      }
    }
    if (!this.editClip) return
    // a scrub issued before the clip resolved lands now
    if (this.pendingScrub !== null) {
      this.editTime = Math.max(0, Math.min(this.pendingScrub, Math.max(this.editClip.dur, 0)))
      this.pendingScrub = null
    }
    this.editHandleKeys(game)
    const dur = Math.max(this.editClip.dur, 1e-6)
    if (this.previewing) {
      this.previewT += dtRaw * 0.25
      if (this.editClip.loop) this.previewT %= dur
      else if (this.previewT >= dur) {
        this.previewT = dur
        this.previewing = false
        this.editTime = dur
      }
    } else {
      this.editTime = Math.max(0, Math.min(this.editTime, dur))
    }
    this.resolveEditPose()
  }

  private editBladeLen = PLAYER_SPEC.blade

  /** clip sample → authored overrides → ROM limits → 3D solve. */
  private resolveEditPose(): void {
    if (!this.editClip) return
    const t = this.previewing ? this.previewT : this.editTime
    sampleClip(this.editClip, t, this.editBase)
    this.editPose.set(this.editBase)
    for (const [ch, v] of this.overrides) this.editPose[ch] = v
    applyJointLimits(this.editPose)
    solveFighter3D(this.editPose, PLAYER_SPEC, this.editGeom, this.editBladeLen)
  }

  private editHandleKeys(game: Game): void {
    const inp = game.input
    const sh = inp.shiftHeld
    if (inp.rawPressed('Comma')) this.scrubBy(-(sh ? 5 : 1))
    if (inp.rawPressed('Period')) this.scrubBy(sh ? 5 : 1)
    if (inp.rawPressed('Enter')) this.togglePreview()
    if (inp.rawPressed('Tab')) this.selectChannel(this.channelIdx + (sh ? -1 : 1))
    if (inp.rawPressed('BracketLeft')) this.nudge(-(sh ? 0.01 : 0.05))
    if (inp.rawPressed('BracketRight')) this.nudge(sh ? 0.01 : 0.05)
    if (inp.rawPressed('KeyM')) this.mirror()
    if (inp.rawPressed('KeyR')) this.resetOverrides()
    if (inp.rawPressed('KeyE')) this.exportPose()
    if (inp.rawPressed('KeyK')) this.savePreset()
    if (inp.rawPressed('Delete') || inp.rawPressed('Backspace')) this.clearChannelOverride()
    if (inp.rawPressed('Escape') || inp.rawPressed('KeyP')) this.setMode('off')
    for (let d = 1; d <= 9; d++) {
      if (inp.rawPressed(`Digit${d}`)) this.loadPreset(d - 1)
    }
  }

  /* ---- editor automation API (window.__srInspect / __sr.inspect) ---- */

  /** Scrub by `frames` authored frames (60fps). Stops preview. */
  scrubBy(frames: number): void {
    this.scrubTo((this.previewing ? this.previewT : this.editTime) + frames * EDIT_FRAME)
  }

  /** Scrub to absolute clip time (seconds), clamped to [0, dur].
   * An explicit scrub takes ownership of the editor clock (no later
   * re-init from the live animator time — automation-safe). */
  scrubTo(t: number): void {
    this.previewing = false
    this.editClockOwned = true
    this.pendingScrub = t
    if (!this.editClip) return
    this.editTime = Math.max(0, Math.min(t, Math.max(this.editClip.dur, 0)))
    this.pendingScrub = null
  }

  /** Toggle 0.25× in-editor playback of the frozen clip (overrides stay
   * applied so you can watch a bend move through the arc). Starting a
   * preview parked at the end of a non-loop clip replays from the top. */
  togglePreview(): void {
    if (this.previewing) {
      this.previewing = false
      this.editTime = this.previewT
    } else {
      this.previewT = this.editTime
      if (this.editClip && !this.editClip.loop && this.previewT >= this.editClip.dur) this.previewT = 0
      this.previewing = true
    }
  }

  /** Select a channel by index or name ('elR', 'bladeYaw', …). */
  selectChannel(i: number | string): void {
    const idx = typeof i === 'number' ? i : CHANNEL_KEYS.indexOf(i as ChannelKey)
    if (idx >= 0 && idx < CHANNEL_KEYS.length) this.channelIdx = idx
  }

  /** Bend the selected channel by `delta` radians from its visible value.
   * ROM limits apply afterwards, so bends can never break the rig. */
  nudge(delta: number): void {
    const ch = CH[CHANNEL_KEYS[this.channelIdx]]
    this.overrides.set(ch, this.editPose[ch] + delta)
    this.resolveEditPose()
  }

  /** Clear the selected channel's authored override. */
  clearChannelOverride(): void {
    this.overrides.delete(CH[CHANNEL_KEYS[this.channelIdx]])
    this.resolveEditPose()
  }

  /** Mirror authored offsets L↔R (clips.ts semantics: bilateral swaps stay
   * plain, yaw/depth channels negate). With no overrides yet, mirrors the
   * whole visible pose so M is always a visible, useful act. */
  mirror(): void {
    const src = new Map(this.overrides)
    if (src.size === 0) {
      for (const k of CHANNEL_KEYS) src.set(CH[k], this.editPose[CH[k]])
    }
    const out = new Map<number, number>()
    for (const [ch, v] of src) out.set(ch, v)
    for (const [a, b] of MIRROR_SWAP) {
      const va = src.get(CH[a]); const vb = src.get(CH[b])
      if (va !== undefined) out.set(CH[b], va)
      if (vb !== undefined) out.set(CH[a], vb)
    }
    for (const [a, b] of MIRROR_SWAP_NEG) {
      const va = src.get(CH[a]); const vb = src.get(CH[b])
      if (va !== undefined) out.set(CH[b], -va)
      if (vb !== undefined) out.set(CH[a], -vb)
    }
    for (const k of MIRROR_NEGATE) {
      const v = src.get(CH[k])
      if (v !== undefined) out.set(CH[k], -v)
    }
    this.overrides = out
    this.resolveEditPose()
  }

  resetOverrides(): void {
    this.overrides.clear()
    this.resolveEditPose()
  }

  /** Export the authored pose as a clips.ts `keyframe()` literal: only the
   * channels that DIFFER from the guard (NEUTRAL) are emitted — makePose
   * guard-merging reproduces the pose exactly from the partial literal.
   * Lands on the console + `window.__srPoseExport` (+ `__srPoseExports`). */
  exportPose(): string {
    const pairs: string[] = []
    for (const k of CHANNEL_KEYS) {
      const ch = CH[k]
      const v = this.editPose[ch]
      if (Math.abs(v - NEUTRAL[ch]) > 0.005) pairs.push(`${k}: ${Number(v.toFixed(3))}`)
    }
    const t = this.previewing ? this.previewT : this.editTime
    const lit = `keyframe(${t.toFixed(3)}, { ${pairs.join(', ')} })`
    this.lastExport = lit
    console.log(`[pose export] ${lit}`)
    const w = window as unknown as Record<string, unknown>
    w.__srPoseExport = lit
    const hist = (w.__srPoseExports as string[] | undefined) ?? []
    hist.push(lit)
    w.__srPoseExports = hist
    return lit
  }

  /** Save the visible pose. Nameless → auto `clip@time` (deduped -2, -3…). */
  savePreset(name?: string): string {
    const t = this.previewing ? this.previewT : this.editTime
    const base = `${this.editClip?.name ?? 'pose'}@${t.toFixed(2)}`
    let nm = name ?? base
    if (!name) {
      let n = 2
      while (this.poseLib.find(nm)) nm = `${base}-${n++}`
    }
    this.poseLib.save(nm, this.editClip?.name ?? '', t, this.editPose)
    console.log(`[poseLib] saved "${nm}" (${this.poseLib.list().length} poses)`)
    return nm
  }

  /** Recall a preset by name or list index → becomes the authored pose. */
  loadPreset(key: string | number): boolean {
    const e = typeof key === 'number' ? this.poseLib.get(key) : this.poseLib.find(key)
    if (!e) return false
    this.overrides.clear()
    for (let c = 0; c < Math.min(e.ch.length, CH_COUNT); c++) this.overrides.set(c, e.ch[c])
    this.scrubTo(e.t)
    this.resolveEditPose()
    console.log(`[poseLib] loaded "${e.name}"`)
    return true
  }

  listPresets(): string[] {
    return this.poseLib.list()
  }

  /** automation readout for tests/scripts */
  get editorInfo(): {
    clip: string | null; t: number; channel: string; channelIndex: number
    overrides: number; previewing: boolean; lastExport: string
  } {
    return {
      clip: this.editClip?.name ?? null,
      t: this.previewing ? this.previewT : this.editTime,
      channel: CHANNEL_KEYS[this.channelIdx],
      channelIndex: this.channelIdx,
      overrides: this.overrides.size,
      previewing: this.previewing,
      lastExport: this.lastExport,
    }
  }

  /* ---- editor rendering ---- */

  private drawEditor(ctx: CanvasRenderingContext2D, game: Game): void {
    const dpr = window.devicePixelRatio || 1
    const w = ctx.canvas.width / dpr
    const h = ctx.canvas.height / dpr
    const p = game.player
    const Z = PSCALE / 1.32
    const cx = w * 0.24
    const groundY = h * 0.78
    const hipScreenY = groundY + p.hipY * Z
    const now = performance.now() / 1000

    // diagnostic panel behind the figure (contrast for the black body)
    ctx.save()
    ctx.fillStyle = '#dfe7ee'
    ctx.beginPath()
    ctx.roundRect(cx - 240, groundY - 322, 480, 340, 14)
    ctx.fill()
    ctx.strokeStyle = 'rgba(40,70,100,0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.font = '700 12px ui-monospace, monospace'
    ctx.fillStyle = '#12354e'
    ctx.textBaseline = 'top'
    ctx.fillText('POSE EDITOR — sim frozen', cx - 224, groundY - 306)
    ctx.restore()

    if (this.editClip) {
      // authored figure: local geom → screen at PSCALE
      ctx.save()
      ctx.translate(cx, hipScreenY)
      ctx.scale(p.face * PSCALE, PSCALE)
      drawFighter3D(ctx, this.editGeom, PLAYER_STYLE, { time: now })
      this.drawSkeleton(ctx, this.editGeom)
      // blade segment (grip → kissaki) so bladeYaw/bladeZ bends read
      ctx.strokeStyle = 'rgba(255,96,64,0.9)'
      ctx.lineWidth = 1.6 / PSCALE
      ctx.beginPath()
      ctx.moveTo(this.editGeom.grip.x, this.editGeom.grip.y)
      ctx.lineTo(this.editGeom.tip.x, this.editGeom.tip.y)
      ctx.stroke()
      ctx.restore()
      // ground line
      ctx.save()
      ctx.strokeStyle = 'rgba(30,90,140,0.65)'
      ctx.lineWidth = 2
      ctx.setLineDash([7, 5])
      ctx.beginPath()
      ctx.moveTo(cx - 230, groundY)
      ctx.lineTo(cx + 230, groundY)
      ctx.stroke()
      ctx.restore()
      // selected-joint pulsing pivot + live radian chip (screen space)
      const anchor = this.channelAnchor(this.channelIdx)
      const sx = cx + p.face * PSCALE * anchor.x
      const sy = hipScreenY + PSCALE * anchor.y
      const k = CHANNEL_KEYS[this.channelIdx]
      const chip = `${k} ${this.editPose[CH[k]].toFixed(3)}${this.overrides.has(CH[k]) ? ' *' : ''}`
      ctx.save()
      ctx.strokeStyle = '#ff2f63'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(sx, sy, 5.5 + Math.sin(now * 6) * 1.8, 0, Math.PI * 2)
      ctx.stroke()
      ctx.font = '700 11px ui-monospace, monospace'
      const cw = ctx.measureText(chip).width
      ctx.fillStyle = 'rgba(18,53,78,0.92)'
      ctx.beginPath()
      ctx.roundRect(sx + 12, sy - 26, cw + 12, 18, 4)
      ctx.fill()
      ctx.fillStyle = '#8ff3ff'
      ctx.fillText(chip, sx + 18, sy - 22)
      ctx.restore()
    }

    // channel list (right column) — Tab walks, [ ] bends, * = authored.
    // Sits over the DARK world: translucent dark backing + light text.
    ctx.save()
    ctx.font = '600 10.5px ui-monospace, monospace'
    ctx.textBaseline = 'top'
    const lx = w - 158
    ctx.fillStyle = 'rgba(6,14,22,0.72)'
    ctx.beginPath()
    ctx.roundRect(lx - 12, 38, 166, 446, 8)
    ctx.fill()
    ctx.fillStyle = '#8ff3ff'
    ctx.fillText('CHANNELS (Tab, [ ] bend)', lx, 44)
    let ly = 60
    for (let i = 0; i < CHANNEL_KEYS.length; i++) {
      const k = CHANNEL_KEYS[i]
      const sel = i === this.channelIdx
      const ovr = this.overrides.has(CH[k])
      if (sel) {
        ctx.fillStyle = 'rgba(255,47,99,0.28)'
        ctx.fillRect(lx - 8, ly - 2, 156, 14)
      }
      ctx.fillStyle = sel ? '#ff5c82' : ovr ? '#ffd24a' : 'rgba(205,230,242,0.82)'
      ctx.fillText(`${sel ? '>' : ' '}${k}${ovr ? '*' : ''}`, lx, ly)
      ctx.fillStyle = sel ? '#ff5c82' : 'rgba(160,215,235,0.66)'
      ctx.fillText(this.editPose[CH[k]].toFixed(3), lx + 92, ly)
      ly += 15
    }
    ctx.restore()

    // timeline: track + REAL keyframe ticks + playhead (light text on dark world)
    const tx0 = 24
    const tx1 = w - 200
    const ty = h - 58
    ctx.save()
    ctx.font = '700 11px ui-monospace, monospace'
    ctx.fillStyle = '#9fe8ff'
    ctx.fillText(this.editClip ? `CLIP ${this.editClip.name}` : '— no clip (ENGAGE first)', tx0, ty - 30)
    if (this.editClip && this.editClip.dur > 0) {
      const dur = this.editClip.dur
      const t = this.previewing ? this.previewT : this.editTime
      ctx.strokeStyle = 'rgba(18,53,78,0.5)'
      ctx.lineWidth = 4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(tx0, ty)
      ctx.lineTo(tx1, ty)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,210,74,0.95)'
      ctx.lineWidth = 1.5
      for (const f of this.editClip.frames) {
        const x = tx0 + (f.t / dur) * (tx1 - tx0)
        ctx.beginPath()
        ctx.moveTo(x, ty - 7)
        ctx.lineTo(x, ty + 7)
        ctx.stroke()
      }
      const px = tx0 + (t / dur) * (tx1 - tx0)
      ctx.strokeStyle = this.previewing ? '#0a9d4b' : '#ff2f63'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px, ty - 12)
      ctx.lineTo(px, ty + 12)
      ctx.stroke()
      ctx.font = '600 10.5px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(200,235,248,0.88)'
      ctx.fillText(
        `t ${t.toFixed(3)}s  f${Math.round(t * 60)}  dur ${dur.toFixed(2)}s`
        + `  keys ${this.editClip.frames.length}  ovr ${this.overrides.size}`
        + `${this.previewing ? '  PREVIEW 0.25x' : ''}`,
        tx0, ty + 16,
      )
    }
    ctx.restore()

    // key legend (light text over the game's dark bottom bar)
    ctx.save()
    ctx.font = '600 10px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(185,225,240,0.82)'
    ctx.fillText(
      'F9 views | ,/. scrub 1f (Shift 5f) | Enter preview 0.25x | Tab channel (Shift back) | [ ] bend 0.05 (Shift 0.01)',
      24, h - 22,
    )
    ctx.fillText(
      'Del clear channel | M mirror L/R | R reset | E export keyframe() | K save preset | 1-9 load preset | Esc exit',
      24, h - 10,
    )
    ctx.restore()
  }

  /** joint pivot that visually owns a channel (local geom space) */
  private channelAnchor(idx: number): { x: number; y: number } {
    const g = this.editGeom
    switch (CHANNEL_KEYS[idx]) {
      case 'spine': return g.waist
      case 'head': return g.headC
      case 'chestYaw': return g.chest
      case 'hipL': case 'hipLz': return g.hipPtL
      case 'kneeL': return g.kneeL
      case 'footL': return g.ankleL
      case 'hipR': case 'hipRz': return g.hipPtR
      case 'kneeR': return g.kneeR
      case 'footR': return g.ankleR
      case 'shL': case 'armLz': return g.shoulderL
      case 'elL': return g.elbL
      case 'wrL': case 'foreLz': return g.handL
      case 'shR': case 'armRz': return g.shoulderR
      case 'elR': return g.elbR
      case 'wrR': case 'foreRz': return g.handR
      case 'bladeYaw': case 'bladeZ': return g.grip
      default: return g.hip
    }
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
    } else if (this.mode === 'edit') {
      this.drawEditor(ctx, game)
    }

    // state readout (uses public player surface + bracket access for privates)
    const dark = this.mode === 'sheet' // light backdrop → dark text
    const priv = p as unknown as Record<string, unknown>
    const lines = [
      `INSPECT: ${this.mode}${this.showBones ? ' +bones' : ''}`,
      `state=${p.state}  loco=${p.loco}  locoT=${Number(priv.locoT ?? 0).toFixed(2)}s`,
      `dash=${p.dashVariant}${p.dashHandoff ? ' (handoff)' : ''}  cd=${Number(priv.dashCd ?? 0).toFixed(2)}`,
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
    drawFighter3D(ctx, p.geom, PLAYER_STYLE, { time })
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
      ['COMBAT STEP', COMBAT_STEP_CLIP],
      ['COMBAT-IDLE (rooted guard)', COMBAT_IDLE_CLIP],
      ['BACKPEDAL', BACKPEDAL_CLIP],
      ['IDLE', IDLE_CLIP],
      ['JUMP', JUMP_CLIP],
      ['DASH LAUNCH (iai)', DASH_LAUNCH_CLIP],
      ['DASH CARRY (momentum)', DASH_CARRY_CLIP],
      ['DASH HUNT (gap-close)', DASH_HUNT_CLIP],
      ['DASH PIERCE (lunge)', DASH_PIERCE_CLIP],
      ['DASH RETREAT (guard)', DASH_RETREAT_CLIP],
      ['DASH CARVE (breakaway)', DASH_CARVE_CLIP],
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
        const g = solveFighter3D(this.scratchPose, PLAYER_SPEC, this.scratchGeom, PLAYER_SPEC.blade)
        // normalize: lowest foot contact sits ON this cell's ground line
        const lowContact = Math.max(g.ankleL.y, g.ankleR.y, g.toeL.y, g.toeR.y)
        const cx = group * (w / groupsPerRow) + cellW * (c + 0.5)
        const groundY = baseY - 14
        ctx.save()
        ctx.translate(cx, groundY - (lowContact + 2.4) * S)
        ctx.scale(S, S)
        drawFighter3D(ctx, g, PLAYER_STYLE, { time: t })
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
    for (const a of ['left', 'right', 'up', 'down', 'light', 'heavy', 'dash', 'jump', 'parry', 'ability', 'ult', 'execute', 'sheathe'] as const) {
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

    // ---- 5b. THE CONDITIONED DASH SYSTEM ----
    // One movement, nine authored animations: the variant must follow the
    // CONDITIONS at the input instant (momentum, threat geometry, chain).
    // (a) LAUNCH: stationary + no threat → the iai explosion
    {
      game.enemies.length = 0
      p.reset(400)
      input.setVirtualAxis(0, 0)
      await sleep(500)
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
      await sleep(250) // dash (0.17s) + exit bleed
      const dx = p.x - x0
      input.setVirtualAxis(0, 0)
      await sleep(400)
      checks.push({
        name: 'dash: stationary forward → LAUNCH (iai)',
        pass: midVariant === 'launch' && midState === 'dash' && dx > 90,
        detail: `variant=${midVariant} state=${midState} dx=${dx.toFixed(0)}`,
      })
      checks.push({
        name: 'dash: momentum handoff (no dead stop)',
        pass: tailVx > 300 && p.dashHandoff,
        detail: `vx@exit=${tailVx.toFixed(0)} handoff=${p.dashHandoff}`,
      })
    }
    // (b) CARRY: dash initiated from a run → the momentum-matched carry
    // (no re-coil from standing — the run feeds the dash)
    {
      game.enemies.length = 0
      input.setVirtualAxis(0, 0)
      await sleep(650) // chain window + recharge fully expired
      input.setVirtualAxis(1, 0)
      await sleep(1000) // build to full run speed (350)
      const runVx = Math.abs(p.vx)
      input.setVirtual('dash', true)
      await sleep(50)
      const carryVariant = p.dashVariant
      input.setVirtual('dash', false)
      input.setVirtualAxis(0, 0)
      await sleep(400)
      checks.push({
        name: 'dash: from a run → CARRY (momentum-matched)',
        pass: carryVariant === 'carry' && runVx > 300,
        detail: `variant=${carryVariant} runVx=${runVx.toFixed(0)}`,
      })
    }
    // (c) HUNT: enemy in the gap-close band ahead (240–640) → the hungry
    // lunge with locked gaze
    {
      game.enemies.length = 0
      input.setVirtualAxis(0, 0)
      await sleep(500)
      const { Enemy: EnemyCtor } = await import('../entities/enemy')
      const foe = new EnemyCtor('grunt', p.x + 320, 1)
      foe.spawning = false
      foe.state = 'stun'
      foe.stunT = 999
      game.enemies.push(foe)
      await sleep(400) // scanEnemies settles the proximity read
      input.setVirtualAxis(1, 0)
      input.setVirtual('dash', true)
      await sleep(50)
      const huntVariant = p.dashVariant
      input.setVirtual('dash', false)
      await sleep(300)
      input.setVirtualAxis(0, 0)
      await sleep(400)
      checks.push({
        name: 'dash: enemy at gap-close range → HUNT',
        pass: huntVariant === 'hunt',
        detail: `variant=${huntVariant}`,
      })
      // (d) PIERCE: the hunt carried us INTO the pocket (<170 ahead) →
      // the next forward dash pierces THROUGH the body
      foe.x = p.x + 140
      await sleep(150)
      input.setVirtualAxis(1, 0)
      input.setVirtual('dash', true)
      await sleep(50)
      const pierceVariant = p.dashVariant
      input.setVirtual('dash', false)
      await sleep(300)
      input.setVirtualAxis(0, 0)
      await sleep(400)
      checks.push({
        name: 'dash: enemy inside the pocket → PIERCE (pass-through)',
        pass: pierceVariant === 'pierce',
        detail: `variant=${pierceVariant}`,
      })
      // (e) RETREAT: backdash keeps the guard on the threat — face HOLDS
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
          name: 'dash: backdash → RETREAT with guard held',
          pass: backVariant === 'retreat' && dx < -60 && faceAfter === faceBefore,
          detail: `variant=${backVariant} dx=${dx.toFixed(0)} face ${faceBefore}→${faceAfter}`,
        })
      }
    }
    // (f) CHAIN: the second dash within the chain window mirrors the
    // stride, without a separate recharge penalty
    {
      game.enemies.length = 0
      input.setVirtualAxis(0, 0)
      await sleep(650)
      input.setVirtualAxis(1, 0)
      input.setVirtual('dash', true)
      await sleep(50)
      input.setVirtual('dash', false)
      await sleep(280) // first dash ends (consec → 1), chain window open
      input.setVirtual('dash', true)
      await sleep(50)
      const chainVariant = p.dashVariant // second dash → mirrored stride
      input.setVirtual('dash', false)
      await sleep(150)
      input.setVirtualAxis(0, 0)
      await sleep(500)
      checks.push({
        name: 'dash: chain mirrors stride',
        pass: chainVariant === 'chain',
        detail: `variant=${chainVariant}`,
      })
    }
    // (g) CARVE: surrounded pocket converts the retreat into the
    // depth-carve breakaway
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
        name: 'dash: surrounded retreat becomes CARVE',
        pass: escVariant === 'carve',
        detail: `variant=${escVariant}`,
      })
    }
    // (h) THE IDLE FIX: standing still with a threat engaged is the ROOTED
    // combat idle — planted feet, weight shifts; NEVER the stepping shuffle
    {
      input.setVirtualAxis(0, 0)
      await sleep(1100) // settle + dwell hysteresis
      const idleMode = p.loco
      const idleClip = (p as unknown as { animator: { getClip(): { name: string } | null } })
        .animator.getClip()?.name
      checks.push({
        name: 'idle: rooted combat guard while stationary near threat',
        pass: idleMode === 'combatIdle' && idleClip === 'combatIdle',
        detail: `loco=${idleMode} clip=${idleClip}`,
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

    // ---- 9. THE JUMP OVERHAUL: height + conditioned variants ----
    // (a) standing jump: hands-only vertical — apex must clear ~2.2× hip
    // height (the old −840 hop peaked ≈ −123; the new −950 ≈ −155)
    {
      let peakY = 0
      input.setVirtual('jump', true)
      await sleep(50)
      input.setVirtual('jump', false)
      for (let i = 0; i < 40; i++) {
        await sleep(16)
        peakY = Math.min(peakY, p.y)
        if (p.grounded && i > 10) break
      }
      checks.push({
        name: 'jump: standing apex clears 2.2× hip height',
        pass: peakY < -140,
        detail: `peakY=${peakY.toFixed(0)} (expect < -140)`,
      })
      // (b) double jump: press again MID-AIR — the air redirect stacks a
      // second rise on top of the first
      {
        let peak2 = 0
        input.setVirtual('jump', true)
        await sleep(60)
        input.setVirtual('jump', false)
        await sleep(240) // rise partway (~apex of the first jump)
        input.setVirtual('jump', true)
        await sleep(60)
        input.setVirtual('jump', false)
        for (let i = 0; i < 40; i++) {
          await sleep(16)
          peak2 = Math.min(peak2, p.y)
          if (p.grounded && i > 10) break
        }
        await sleep(400) // land + settle
        checks.push({
          name: 'jump: air jump stacks a second rise',
          pass: peak2 < -170,
          detail: `peak2=${peak2.toFixed(0)} (expect < -170)`,
        })
      }
      // (c) running leap: momentum converts — the leap clip + carry-over
      {
        input.setVirtualAxis(1, 0)
        await sleep(1000) // build to full run
        const runVx = Math.abs(p.vx)
        input.setVirtual('jump', true)
        await sleep(50)
        input.setVirtual('jump', false)
        const leapClip = (p as unknown as { animator: { getClip(): { name: string } | null } })
          .animator.getClip()?.name
        await sleep(500)
        input.setVirtualAxis(0, 0)
        await sleep(300)
        checks.push({
          name: 'jump: run converts into the LEAP (conditioned)',
          pass: runVx > 300 && leapClip === 'jumpLeap',
          detail: `runVx=${runVx.toFixed(0)} clip=${leapClip}`,
        })
      }
    }

    // ---- 10. THE SWORD HOME: sheathe / draw system ----
    // (a) manual sheathe (Q) → steel home after the ritual
    {
      input.setVirtual('sheathe', true)
      await sleep(60)
      input.setVirtual('sheathe', false)
      await sleep(1000) // ritual (0.85s) completes
      const sheathed = !p.swordDrawn
      // (b) manual draw (Q again) → steel back out
      input.setVirtual('sheathe', true)
      await sleep(60)
      input.setVirtual('sheathe', false)
      await sleep(500) // draw (0.3s) completes
      const drawnBack = p.swordDrawn
      // (c) iai snap-draw: sheathe, then LIGHT → blade out instantly + attack
      input.setVirtual('sheathe', true)
      await sleep(60)
      input.setVirtual('sheathe', false)
      await sleep(1000)
      input.setVirtual('light', true)
      await sleep(80)
      input.setVirtual('light', false)
      const snapDrawn = p.swordDrawn
      const attacking = p.state === 'attack'
      await sleep(600)
      checks.push({
        name: 'sheathe: manual sheathe → steel home',
        pass: sheathed,
        detail: `swordDrawn after ritual=${!sheathed}`,
      })
      checks.push({
        name: 'sheathe: manual draw → steel out',
        pass: drawnBack,
        detail: `swordDrawn=${drawnBack}`,
      })
      checks.push({
        name: 'sheathe: light input → iai snap-draw + attack',
        pass: snapDrawn && attacking,
        detail: `drawn=${snapDrawn} state=${attacking ? 'attack' : 'other'}`,
      })
    }

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
