/** STICKMAN RISING — input manager: keyboard + virtual touch, with combo buffering. */

export type Action =
  | 'left' | 'right' | 'up' | 'down'
  | 'light' | 'heavy' | 'dash' | 'jump'
  | 'parry' | 'ability' | 'ult' | 'execute'
  | 'pause' | 'cycleSword' | 'confirm' | 'sheathe'
  | 'sword1' | 'sword2' | 'sword3' | 'sword4' | 'sword5' | 'sword6'

const ACTIONS: Action[] = [
  'left', 'right', 'up', 'down', 'light', 'heavy', 'dash', 'jump',
  'parry', 'ability', 'ult', 'execute', 'pause', 'cycleSword', 'confirm', 'sheathe',
  'sword1', 'sword2', 'sword3', 'sword4', 'sword5', 'sword6',
]

const KEYMAP: Record<string, Action> = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyJ: 'light', KeyZ: 'light',
  KeyK: 'heavy', KeyX: 'heavy',
  KeyL: 'dash', KeyC: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash',
  Space: 'jump',
  KeyO: 'parry', KeyF: 'parry',
  KeyU: 'ability',
  KeyI: 'ult',
  KeyE: 'execute',
  KeyQ: 'sheathe',
  KeyP: 'pause', Escape: 'pause',
  Tab: 'cycleSword',
  Enter: 'confirm',
  Digit1: 'sword1', Digit2: 'sword2', Digit3: 'sword3',
  Digit4: 'sword4', Digit5: 'sword5', Digit6: 'sword6',
}

const PREVENT_DEFAULT = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab',
])

export class Input {
  private downMap = new Map<Action, boolean>()
  // Several physical keys can map to one action (e.g. A and Left Arrow).
  private heldKeys = new Set<string>()
  private virtualDirection = 0
  private pressedMap = new Map<Action, boolean>()
  private releasedMap = new Map<Action, boolean>()
  private pressTime = new Map<Action, number>() // REAL seconds (performance.now)
  private consumedBuffer = new Map<Action, boolean>()
  private attached = false
  private tapDirection = 0
  private tapAt = -Infinity
  private sprintDir = 0
  /* RAW physical-key edges for the debug/editor tooling (inspect lab).
   * Deliberately OUTSIDE the Action map: editor keys (Comma/Period scrub,
   * brackets, Tab, Enter, M/R/E/K…) must never fire gameplay actions, and
   * gameplay keys keep their meaning untouched. Repeats are KEPT for the
   * raw set — holding Period scrubbing forward feels like a jog wheel. */
  private rawPresses = new Set<string>()
  private shiftDown = false
  /** Detect in EVENTS, not in update(): both taps may occur between frames. */
  private recordDirection(a:Action):void {
    if(a!=='left'&&a!=='right')return
    const dir=a==='right'?1:-1,t=this.now
    this.sprintDir=this.tapDirection===dir&&t-this.tapAt<=.28?dir:0
    this.tapDirection=dir;this.tapAt=t
  }
  sprintDirection():number {
    return this.enabled && this.sprintDir !== 0 && Math.sign(this.axisX()) === this.sprintDir
      && (this.down(this.sprintDir === 1 ? 'right' : 'left') || this.virtualDirection === this.sprintDir)
      ? this.sprintDir : 0
  }

  /** REAL-time clock in seconds (performance.now based) — immune to
   * frame-rate distortion (throttled rAF, synthetic compositor timestamps,
   * hitstop): input rhythm (double-tap windows, buffers, holds) must
   * measure real human timing, not simulation time. */
  private get now(): number {
    return performance.now() / 1000
  }

  /** virtual stick + buttons (touch layer in React) */
  private vAxis = { x: 0, y: 0 }
  private vDown = new Map<Action, boolean>()
  private enabled = true

  attach(): void {
    if (this.attached || typeof window === 'undefined') return
    this.attached = true
    window.addEventListener('keydown', this.onKeyDown, { passive: false })
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.reset()
  }

  setEnabled(v: boolean): void {
    this.enabled = v
    if (!v) this.reset()
  }

  private reset(): void {
    this.tapDirection=0;this.tapAt=-Infinity;this.sprintDir=0;this.virtualDirection=0
    this.rawPresses.clear()
    this.shiftDown = false
    this.heldKeys.clear()
    this.downMap.clear()
    this.pressedMap.clear()
    this.releasedMap.clear()
    this.pressTime.clear()
    this.consumedBuffer.clear()
    this.vDown.clear()
    this.vAxis = { x: 0, y: 0 }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    this.shiftDown = e.shiftKey
    this.rawPresses.add(e.code) // raw edges record repeats (scrub/bend jog)
    const action = KEYMAP[e.code]
    if (!action) return
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault()
    if (e.repeat || this.heldKeys.has(e.code)) return
    this.heldKeys.add(e.code)
    this.press(action)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.shiftDown = e.shiftKey
    const action = KEYMAP[e.code]
    if (!action || !this.heldKeys.delete(e.code)) return
    if (![...this.heldKeys].some(code => KEYMAP[code] === action)) this.release(action)
  }

  private onBlur = (): void => { this.reset() }

  private press(a: Action): void {
    if (this.downMap.get(a)) return
    this.downMap.set(a, true)
    this.pressedMap.set(a, true)
    this.recordDirection(a)
    this.pressTime.set(a, this.now)
    this.consumedBuffer.set(a, false)
  }

  private release(a: Action): void {
    if (!this.downMap.get(a)) return
    this.downMap.set(a, false)
    if((a==='right'&&this.sprintDir===1)||(a==='left'&&this.sprintDir===-1))this.sprintDir=0
    this.releasedMap.set(a, true)
  }

  /* ---------- raw editor API (edge per rendered frame) ---------- */

  /** True if this physical key had a keydown (incl. OS repeat) this frame.
   * Editor tooling only — never used by gameplay code. */
  rawPressed(code: string): boolean {
    return this.enabled && this.rawPresses.has(code)
  }

  /** Shift modifier state from the last key event. */
  get shiftHeld(): boolean {
    return this.shiftDown
  }

  /* ---------- per-frame API ---------- */

  down(a: Action): boolean {
    return this.enabled && (this.downMap.get(a) === true || this.vDown.get(a) === true)
  }

  pressed(a: Action): boolean {
    return this.enabled && this.pressedMap.get(a) === true
  }

  released(a: Action): boolean {
    return this.enabled && this.releasedMap.get(a) === true
  }

  /** How long action has been held (seconds). */
  holdTime(a: Action): number {
    if (!this.down(a)) return 0
    return this.now - (this.pressTime.get(a) ?? this.now)
  }

  /** Timestamp (input clock) of the last PRESS EVENT for this action, or
   * −1 if never pressed. Event-driven: updates on the keydown/virtual
   * press itself, so it detects rapid re-presses even when frames are
   * dropped or throttled (double-tap sprint detection). */
  pressStamp(a: Action): number {
    return this.pressTime.get(a) ?? -1
  }

  /** Combo buffering: was this pressed within `window` seconds and not yet consumed? */
  buffered(a: Action, window = 0.22): boolean {
    if (!this.enabled) return false
    if (this.consumedBuffer.get(a)) return false
    const t = this.pressTime.get(a)
    return t !== undefined && this.now - t <= window
  }

  /** Buffered + consume (call when the input is actually used). */
  takeBuffered(a: Action, window = 0.22): boolean {
    if (this.buffered(a, window)) {
      this.consumedBuffer.set(a, true)
      return true
    }
    return false
  }

  /** Horizontal axis: -1..1 (keyboard + virtual stick). */
  axisX(): number {
    if (!this.enabled) return 0
    let x = this.vAxis.x
    if (this.down('left')) x -= 1
    if (this.down('right')) x += 1
    return Math.max(-1, Math.min(1, x))
  }

  axisY(): number {
    if (!this.enabled) return 0
    let y = this.vAxis.y
    if (this.down('up')) y -= 1
    if (this.down('down')) y += 1
    return Math.max(-1, Math.min(1, y))
  }

  /** Tick: clear edge flags. Call once at end of frame. (The clock is
   * real-time via performance.now — no dt accumulation needed.) */
  endFrame(_dt: number): void {
    this.rawPresses.clear()
    for (const a of ACTIONS) {
      this.pressedMap.set(a, false)
      this.releasedMap.set(a, false)
    }
  }

  /* ---------- virtual (touch) API — called by React layer ---------- */

  setVirtualAxis(x: number, y: number): void {
    if (!this.enabled) return
    this.vAxis.x = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0
    this.vAxis.y = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0
    const direction = Math.abs(this.vAxis.x) >= 0.5 ? Math.sign(this.vAxis.x) : 0
    if (direction !== this.virtualDirection) {
      if (this.virtualDirection === this.sprintDir) this.sprintDir = 0
      this.virtualDirection = direction
      if (direction) this.recordDirection(direction === 1 ? 'right' : 'left')
    }
  }

  setVirtual(a: Action, isDown: boolean): void {
    if (!this.enabled) return
    if (isDown) {
      if (this.vDown.get(a)) return
      this.vDown.set(a, true)
      this.pressedMap.set(a, true)
      this.recordDirection(a)
      this.pressTime.set(a, this.now)
      this.consumedBuffer.set(a, false)
    } else {
      if (!this.vDown.get(a)) return
      this.vDown.set(a, false)
      if((a==='right'&&this.sprintDir===1)||(a==='left'&&this.sprintDir===-1))this.sprintDir=0
      this.releasedMap.set(a, true)
    }
  }
}
