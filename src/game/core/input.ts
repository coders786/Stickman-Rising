/** STICKMAN RISING — input manager: keyboard + virtual touch, with combo buffering. */

export type Action =
  | 'left' | 'right' | 'up' | 'down'
  | 'light' | 'heavy' | 'dash' | 'jump'
  | 'parry' | 'ability' | 'ult' | 'execute'
  | 'pause' | 'cycleSword' | 'confirm'
  | 'sword1' | 'sword2' | 'sword3' | 'sword4' | 'sword5' | 'sword6'

const ACTIONS: Action[] = [
  'left', 'right', 'up', 'down', 'light', 'heavy', 'dash', 'jump',
  'parry', 'ability', 'ult', 'execute', 'pause', 'cycleSword', 'confirm',
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
  private pressedMap = new Map<Action, boolean>()
  private releasedMap = new Map<Action, boolean>()
  private pressTime = new Map<Action, number>() // seconds
  private consumedBuffer = new Map<Action, boolean>()
  private now = 0
  private attached = false

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
  }

  setEnabled(v: boolean): void {
    this.enabled = v
    if (!v) {
      this.downMap.clear()
      this.vDown.clear()
      this.vAxis.x = 0
      this.vAxis.y = 0
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const action = KEYMAP[e.code]
    if (!action) return
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault()
    if (e.repeat) return
    this.press(action)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    const action = KEYMAP[e.code]
    if (!action) return
    this.release(action)
  }

  private onBlur = (): void => {
    this.downMap.clear()
    this.vDown.clear()
    this.vAxis.x = 0
    this.vAxis.y = 0
  }

  private press(a: Action): void {
    if (this.downMap.get(a)) return
    this.downMap.set(a, true)
    this.pressedMap.set(a, true)
    this.pressTime.set(a, this.now)
    this.consumedBuffer.set(a, false)
  }

  private release(a: Action): void {
    if (!this.downMap.get(a)) return
    this.downMap.set(a, false)
    this.releasedMap.set(a, true)
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
    if (!this.enabled) return this.vAxis.x
    let x = this.vAxis.x
    if (this.down('left')) x -= 1
    if (this.down('right')) x += 1
    return Math.max(-1, Math.min(1, x))
  }

  axisY(): number {
    if (!this.enabled) return this.vAxis.y
    let y = this.vAxis.y
    if (this.down('up')) y -= 1
    if (this.down('down')) y += 1
    return Math.max(-1, Math.min(1, y))
  }

  /** Tick: advance clock, clear edge flags. Call once at end of frame. */
  endFrame(dt: number): void {
    this.now += dt
    for (const a of ACTIONS) {
      this.pressedMap.set(a, false)
      this.releasedMap.set(a, false)
    }
  }

  /* ---------- virtual (touch) API — called by React layer ---------- */

  setVirtualAxis(x: number, y: number): void {
    this.vAxis.x = Math.max(-1, Math.min(1, x))
    this.vAxis.y = Math.max(-1, Math.min(1, y))
  }

  setVirtual(a: Action, isDown: boolean): void {
    if (isDown) {
      if (this.vDown.get(a)) return
      this.vDown.set(a, true)
      this.pressedMap.set(a, true)
      this.pressTime.set(a, this.now)
      this.consumedBuffer.set(a, false)
    } else {
      if (!this.vDown.get(a)) return
      this.vDown.set(a, false)
      this.releasedMap.set(a, true)
    }
  }
}
