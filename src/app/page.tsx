'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Game } from '@/game/game'
import type { GraphicsDiagnostics } from '@/debug/GraphicsSelfTest'
import { SWORDS, SWORD_ORDER, SwordId, swordTier, upgradedSword } from '@/game/combat/swords'
import { DEFAULT_SETTINGS, GameSettings, RunStats, type QualityLevel } from '@/game/core/types'
import { classifyDevice, featuresFor, lockQualityPreset, QUALITY_NAMES, QUALITY_PRESETS, RENDERER_NAMES } from '@/game/render/graphics'
import type { Input as GameInput, Action } from '@/game/core/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input as TextInput } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { fmt } from '@/game/core/utils'
import { parseSave, parseSettings, readStorage, writeStorage, SAVE_KEY, SETTINGS_KEY, NAME_KEY, type SaveData } from '@/lib/persistence'
import type { ScoreRow } from '@/lib/scores'
import { markBoot } from '@/lib/boot-timing'
import type { RunPreparationStage } from '@/game/core/types'
import { BridgeInterlude } from './bridge-interlude'
import { Swords, Trophy, Play, Settings as SettingsIcon, BookOpen, ChevronRight, RotateCcw, Home as HomeIcon, Send, Pause } from 'lucide-react'

/* ------------------------------------------------------------------ */

type Screen = 'title' | 'arsenal' | 'howto' | 'scores' | 'settings' | 'preparing' | 'playing' | 'paused' | 'gameover'

/** Submission id without assuming a secure context.
 *
 * `crypto.randomUUID()` exists only on https/localhost. This app is routinely
 * opened over a LAN address (http://192.168.x.x:3000) from a phone, where the
 * call throws — and because it ran inside the ENGAGE click handler, the effect
 * was "the play button does nothing". Falling back to getRandomValues keeps the
 * idempotency key strong on every origin that can run the game at all. */
function submissionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* insecure context — fall through */ }
  const bytes = new Uint8Array(16)
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const SCREEN_LABEL: Record<Screen, string> = {
  title: 'Main menu',
  arsenal: 'Arsenal: choose a blade',
  howto: 'How to play',
  scores: 'Leaderboard',
  settings: 'Settings',
  preparing: 'Preparing the bridge',
  playing: 'Playing',
  paused: 'Paused',
  gameover: 'Run over: score summary',
}

const QUALITY_BLURB: Record<QualityLevel, string> = {
  low: 'Lightest preset. Simple contact shadows on Canvas.',
  medium: 'Native scale target. Adds fighter rim light and reflections on Canvas.',
  high: 'Sharper scale target. Adds projected shadows and finer reflections on Canvas.',
  ultra: 'Highest scale target. On supported hardware: softer HDR shadows, natural glow and detailed wet surfaces.',
}
/* ================================================================== */

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const workRef = useRef<HTMLCanvasElement>(null)
  const hudRef = useRef<HTMLCanvasElement>(null)
  const finishRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const engageRef = useRef<HTMLButtonElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const returnToRetry = useRef(false)
  const gameRef = useRef<Game | null>(null)
  const saveRef = useRef<SaveData>({ totalKills: 0, best: 0, unlocked: ['katana'] })
  const settingsRef = useRef<GameSettings>({ ...DEFAULT_SETTINGS })

  const [screen, setScreen] = useState<Screen>('title')
  const [interlude, setInterlude] = useState<{ stage: RunPreparationStage; retry: boolean; presented: boolean; cutId?: number } | null>(null)
  const [runUnavailable, setRunUnavailable] = useState(false)
  const [arsenalFrom, setArsenalFrom] = useState<'title' | 'gameover'>('title')
  const completeCut = useCallback((id: number) => gameRef.current?.finishOpeningCut(id), [])
  const [settingsFrom, setSettingsFrom] = useState<Screen>('title')
  const [stats, setStats] = useState<RunStats | null>(null)
  /* Which night this was: the profile label + seed of the sky the player just
     fought under. Shown on the results card because the identity line in-game
     only lives for 18 s — a player who wants to re-roll "that ribbed night"
     needs to still be able to read it when the run is over. */
  const [nightLabel, setNightLabel] = useState('')
  const [runSword, setRunSword] = useState<SwordId>('katana')
  const submissionKey = useRef<string | null>(null)
  /* persisted state starts from SSR-safe defaults; real values load in a
   * mount effect below so server HTML === first client render (no
   * hydration mismatch badge) */
  const [save, setSave] = useState<SaveData>({ totalKills: 0, best: 0, unlocked: ['katana'] })
  const [settings, setSettings] = useState<GameSettings>({ ...DEFAULT_SETTINGS })
  const graphicsOptIn = useRef(false)
  const [graphicsQA, setGraphicsQA] = useState<GraphicsDiagnostics | null>(null)
  const [activeScale, setActiveScale] = useState<number | null>(null)
  /* First-run suggestion only; every device offers all four presets. */
  const [deviceClass, setDeviceClass] = useState(() => classifyDevice({ width: 1280, height: 720, dpr: 1, finePointer: false, touch: true }))
  const [selectedSword, setSelectedSword] = useState<SwordId>('katana')
  const [loadout, setLoadout] = useState<SwordId[]>(['katana'])
  const [scores, setScores] = useState<ScoreRow[]>([])
  const [name, setName] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const runRef = useRef(0)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const [scoresLoading, setScoresLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [gameError, setGameError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const [newUnlocks, setNewUnlocks] = useState<SwordId[]>([])
  const [touchMode, setTouchMode] = useState(false)
  const [actions, setActions] = useState({ overdrive: false, service: false, execute: false })
  const [gameInput, setGameInput] = useState<GameInput | null>(null)
  const canEngage = hydrated && gameInput !== null && !gameError
  const titleMenu = screen === 'title' || screen === 'howto' || screen === 'scores' ||
    (screen === 'arsenal' && arsenalFrom === 'title') || (screen === 'settings' && settingsFrom === 'title')

  /* Boot preferences without rAF: a backgrounded or throttled iframe can
   * postpone animation indefinitely. React can still make the menu usable. */
  useEffect(() => {
    let disposed = false
    let removePointerListener: (() => void) | undefined
    let disposeGame: (() => void) | undefined
    const boot = async () => {
      if (disposed) return
      const mq = window.matchMedia?.('(pointer: coarse)')
      const coarse = mq?.matches ?? false
      const device = classifyDevice({
        width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1,
        finePointer: window.matchMedia?.('(pointer: fine)').matches ?? false,
        touch: (navigator.maxTouchPoints ?? 0) > 0,
      })
      const progress = parseSave(readStorage(SAVE_KEY))
      const savedPrefs = parseSettings(readStorage(SETTINGS_KEY), coarse, device.start)
      const verify = new URLSearchParams(window.location.search).get('verifyGraphics') === '1'
      graphicsOptIn.current = verify
      const preferences = verify ? { ...lockQualityPreset(savedPrefs, 'ultra'), showFps: true } : savedPrefs
      saveRef.current = progress
      settingsRef.current = preferences
      const latest = progress.unlocked[progress.unlocked.length - 1] ?? 'katana'
      setSave(progress)
      setSelectedSword(latest)
      setLoadout([latest])
      setSettings(preferences)
      setDeviceClass(device)
      setTouchMode(coarse)
      setName((readStorage(NAME_KEY) ?? '').slice(0, 16))
      setHydrated(true)
      if (mq) {
        const change = (event: MediaQueryListEvent) => setTouchMode(event.matches)
        mq.addEventListener?.('change', change)
        removePointerListener = () => mq.removeEventListener?.('change', change)
      }

      markBoot('engine-request')
      // The server-rendered menu doesn't depend on the engine or its art
      // modules arriving in the initial script group.
      const { Game } = await import('@/game/game')
      if (disposed) return
      markBoot('engine-module')
      const canvas = canvasRef.current
      if (!canvas) throw new Error('Missing arena canvas')
      const game = new Game()
      game.enableOpeningCut()
      let lastPhase = game.phase
      const off = game.on((e) => {
        if (e.type === 'error') {
          if (lastPhase === 'preparing') markBoot('run-failed')
          setGameError('The game encountered an unexpected error. Reload to try again; saved progress is retained.')
        } else if (e.type === 'runUnavailable') {
          setRunUnavailable(true)
        } else if (e.type === 'runStarted') {
          runRef.current += 1
          submissionKey.current = submissionId()
          setSubmitted(false)
          setSubmitError(null)
          setNewUnlocks([])
        } else if (e.type === 'gameover') {
          setRunSword(game.player.sword.id)
          setStats(e.stats)
          const night = game.runIdentity?.()
          setNightLabel(night ? `${night.label} · ${night.id}` : '')
          setScreen('gameover')
          setSubmitted(false)
          setSubmitError(null)
          // persist progress + unlocks
          const prev = saveRef.current
          const totalKills = prev.totalKills + e.stats.kills
          const best = Math.max(prev.best, e.stats.score)
          const unlocked = [...prev.unlocked]
          const fresh: SwordId[] = []
          for (const id of SWORD_ORDER) {
            if (!unlocked.includes(id) && totalKills >= SWORDS[id].unlockKills) {
              unlocked.push(id)
              fresh.push(id)
            }
          }
          const next = { totalKills, best, unlocked }
          saveRef.current = next
          setSave(next)
          setStorageError(!writeStorage(SAVE_KEY, JSON.stringify(next)))
          if (fresh.length) {
            setNewUnlocks(fresh)
            setSelectedSword(fresh[fresh.length - 1])
          }
        } else if (e.type === 'actions') {
          setActions({ overdrive: e.overdrive, service: e.service, execute: e.execute })
        } else if (e.type === 'quality') {
          setActiveScale(e.scale)
        } else if (e.type === 'runPreparing') {
          setInterlude(previous => previous && { ...previous, stage: e.stage, presented: e.presented, cutId: undefined })
        } else if (e.type === 'runRevealing') {
          setInterlude(previous => previous && { ...previous, cutId: e.id })
        } else if (e.type === 'phase') {
          const arrived = lastPhase === 'preparing' && e.phase === 'playing'
          if (lastPhase === 'preparing') {
            returnToRetry.current = e.phase === 'gameover'
            markBoot(arrived ? 'playing' : 'cancelled')
          }
          const next = e.phase === 'attract' ? 'title' : e.phase
          if (e.phase === 'preparing') {
            setInterlude({ stage: 'opening', retry: lastPhase === 'gameover', presented: false })
            setScreen(next)
          } else if (arrived) flushSync(() => {
            // Remove the matte and mount touch controls with the input unlock.
            setInterlude(null)
            setScreen(next)
          })
          else { setInterlude(null); setScreen(next) }
          lastPhase = e.phase
        }
      })
      let stopResize: (() => void) | undefined
      let stopGraphics: (() => void) | undefined
      disposeGame = () => {
        stopGraphics?.()
        stopResize?.()
        off()
        game.destroy()
        if (gameRef.current === game) gameRef.current = null
      }
      try {
        game.applySettings(settingsRef.current)
      } catch (error) {
        console.warn('Applying saved settings failed:', error)
      }
      game.setUnlocked(saveRef.current.unlocked, saveRef.current.totalKills)
      game.touchControls = mq?.matches ?? false
      if (verify && (coarse || new URLSearchParams(window.location.search).get('tier') === 'mobile')) game.preferDiagnosticMobile()
      game.mount(canvas, hudRef.current, finishRef.current, workRef.current)
      setActiveScale(game.renderConfig.renderScale)

      const resize = () => game.resize()
      if (wrapRef.current && typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(resize)
        observer.observe(wrapRef.current)
        stopResize = () => observer.disconnect()
      } else {
        window.addEventListener('resize', resize)
        stopResize = () => window.removeEventListener('resize', resize)
      }
      gameRef.current = game
      setGameInput(game.input)
      if (verify) void import('@/debug/GraphicsSelfTest').then(({ startGraphicsSelfTest }) => {
        if (!disposed) stopGraphics = startGraphicsSelfTest(game, setGraphicsQA)
      }).catch(error => {
        console.warn('Graphics self-test unavailable:', error)
        if (!disposed) setGraphicsQA({ version: 'SACR 4.0', status: 'fail' })
      })
    }
    // Asynchronous for React's initial commit but independent of painting.
    void Promise.resolve().then(boot).catch(error => {
      if (disposed) return
      disposeGame?.()
      disposeGame = undefined
      markBoot('engine-failed')
      console.error('Game startup failed', error)
      setGameError('The game could not start. Reload the preview to try again. Saved progress is retained.')
    })
    return () => {
      disposed = true
      removePointerListener?.()
      disposeGame?.()
    }
  }, [])

  useEffect(() => { if (hydrated) markBoot('menu') }, [hydrated])
  useEffect(() => { if (gameRef.current) gameRef.current.touchControls = touchMode }, [touchMode, gameInput])
  useEffect(() => {
    if (!canEngage) return
    markBoot('ready')
  }, [canEngage])

  useEffect(() => {
    // A disabled Engage can't autofocus at mount. Restore keyboard start
    // once it works, without taking focus from another menu button.
    if (canEngage && screen === 'title' && document.activeElement === document.body) {
      engageRef.current?.focus({ preventScroll: true })
    }
    if (canEngage && screen === 'gameover' && returnToRetry.current) {
      returnToRetry.current = false
      retryRef.current?.focus({ preventScroll: true })
    }
  }, [canEngage, screen])

  const applyFramePreferences = (next: GameSettings) => {
    // Do not wait for persistence or a governor tick to lock Ultra or toggle FPS.
    gameRef.current?.applySettings(next)
    settingsRef.current = next
    setSettings(next)
  }

  /* ---------------- settings persistence ---------------- */

  useEffect(() => {
    if (!hydrated) return
    const changed = settingsRef.current !== settings
    settingsRef.current = settings
    try {
      if (changed) gameRef.current?.applySettings(settings)
    } catch (settingsErr) {
      console.warn('Applying settings failed:', settingsErr)
    }
    // `qualityV` marks the record as post-migration: see parseSettings' note.
    if (!graphicsOptIn.current) setStorageError(!writeStorage(SETTINGS_KEY, JSON.stringify({ ...settings, qualityV: 3 })))
  }, [settings, hydrated])

  useEffect(() => {
    if (!hydrated) return
    gameRef.current?.setUnlocked(save.unlocked, save.totalKills)
    saveRef.current = save
  }, [hydrated, save])

  /* ---------------- pause hotkey when game input disabled ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.repeat || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return
      if (e.code !== 'Escape' && e.code !== 'KeyP') return
      // ESCAPE IS THE UNIVERSAL BACK, and P is the pause toggle. Before this,
      // Escape did nothing on four of the eight screens — and on a keyboard-only
      // playthrough Settings was a trap with no way out but the mouse.
      if (e.code === 'KeyP' && screen !== 'playing' && screen !== 'paused') return
      if (screen === 'paused') {
        if (e.code === 'Escape' || e.code === 'KeyP') gameRef.current?.resume()
      } else if (screen === 'preparing') {
        gameRef.current?.cancelRunPreparation()
      } else if (screen === 'settings') {
        setScreen(settingsFrom)
      } else if (screen === 'arsenal') {
        setScreen(arsenalFrom)
      } else if (screen === 'howto' || screen === 'scores') {
        setScreen('title')
      } else if (screen === 'gameover') {
        gameRef.current?.quitToMenu()
        setScreen('title')
      } else if (screen === 'playing' && e.code === 'KeyP') {
        gameRef.current?.pause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, settingsFrom, arsenalFrom])

  /* ---------------- actions ---------------- */

  const refreshScores = useCallback(async (signal?: AbortSignal) => {
    setScoresLoading(true)
    setScoreError(null)
    try {
      const res = await fetch('/api/scores', { cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]) })
      if (!res.ok) throw new Error('Leaderboard unavailable')
      const [{ scoreRowsSchema }, data] = await Promise.all([import('@/lib/scores'), res.json()])
      const rows = scoreRowsSchema.parse(data)
      if (!signal?.aborted) setScores(rows)
    } catch {
      if (!signal?.aborted) setScoreError('Unable to load the leaderboard. Please try again.')
    } finally {
      if (!signal?.aborted) setScoresLoading(false)
    }
  }, [])

  useEffect(() => {
    if (screen !== 'scores') return
    const controller = new AbortController()
    void refreshScores(controller.signal)
    return () => controller.abort()
  }, [screen, refreshScores])

  const startGame = useCallback((sword: SwordId) => {
    const game = gameRef.current
    if (!game || !canEngage) return
    const action = game.phase === 'gameover' ? 'retry' : 'engage'
    const clickedAt = performance.now()
    // Commit the opaque veil on the gesture while the engine queues asset
    // transfers. Neither the artwork nor its timers gate preparation.
    flushSync(() => {
      if (!game.requestRun(sword)) return
      markBoot(action, clickedAt)
      setRunUnavailable(false)
      game.setLoadout(loadout)
    })
  }, [canEngage, loadout])

  const submitScore = useCallback(async () => {
    if (!stats || submitted || submittingRef.current) return
    const run = runRef.current
    const finalName = name.trim().slice(0, 16) || 'ANON'
    setStorageError(!writeStorage(NAME_KEY, finalName))
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const response = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(submissionKey.current ? { 'Idempotency-Key': submissionKey.current } : {}) },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          name: finalName,
          score: Math.round(stats.score),
          wave: stats.wave,
          maxCombo: stats.maxCombo,
          kills: stats.kills,
          sword: runSword,
        }),
      })
      if (response.status === 409) throw new Error('This run was already submitted with different details. Retry with the original name.')
      if (response.status === 429) throw new Error('Too many score submissions. Please wait and try again.')
      if (!response.ok) throw new Error('Score was not confirmed. Check your connection and try again.')
      if (run === runRef.current) setSubmitted(true)
    } catch (error) {
      if (run === runRef.current) setSubmitError(error instanceof Error ? error.message : 'Score was not confirmed. Check your connection and try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [stats, name, submitted, runSword])

  const menuBtn = 'h-12 px-8 font-black tracking-[0.25em] text-sm'

  /* ================================================================== */

  return (
    <div ref={wrapRef} data-screen={screen} data-title-menu={titleMenu || undefined} className="sr-viewport relative w-screen h-[100dvh] overflow-hidden bg-black select-none">
      <canvas
        ref={canvasRef}
        data-render-layer="scene"
        className="absolute inset-0 block h-full w-full"
        aria-label="Stickman Rising game canvas"
        aria-describedby="canvas-controls"
      />
      <canvas ref={workRef} data-render-layer="scene-work" aria-hidden="true" className="pointer-events-none absolute inset-0 block h-full w-full" />
      <canvas ref={finishRef} data-render-layer="finish" hidden aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas ref={hudRef} data-render-layer="hud" style={{ visibility: screen === 'settings' ? 'hidden' : 'visible' }} aria-hidden="true" className="pointer-events-none absolute inset-0 block h-full w-full" />
      <div className="sr-bridge-recovery" role="status">Restoring the arena. Combat is on hold.</div>
      {/* Keyboard controls, readable by a screen reader and invisible on screen.
          A canvas game with an aria-label and nothing else is a black box. */}
      <p id="canvas-controls" className="sr-only">
        Arrow keys or A and D move. Space jumps. J light attack, K heavy attack, L dash,
        R Overdrive, U ability, E execute or hold at a service terminal, P or Escape pauses.
      </p>
      {/* Screen announcements: every menu is a mode change, and a mode change
          that a screen reader cannot see is a broken menu. */}
      <p className="sr-only" role="status" aria-live="polite">{SCREEN_LABEL[screen]}</p>

      {gameError && <div role="alert" className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-6 text-white"><p>{gameError}</p><Button onClick={() => window.location.reload()}>RELOAD</Button></div>}
      {storageError && <p role="status" className="absolute bottom-2 left-2 z-40 text-xs text-amber-300">Local storage is unavailable. Progress may not survive a reload.</p>}
      {runUnavailable && (screen === 'title' || screen === 'gameover') && <p role="alert"
        className="pointer-events-none absolute inset-x-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-40 mx-auto max-w-md border border-red-900 bg-black/95 px-4 py-2 text-center text-sm text-red-100">
        The arena didn’t finish loading. Try again to restart preparation.
      </p>}
      {/* ------------ touch controls ------------ */}
      {screen === 'playing' && touchMode && gameInput && <TouchLayer input={gameInput} actions={actions} onPause={() => gameRef.current?.pause()} />}

      {interlude && screen === 'preparing' && !gameError && (
        <BridgeInterlude {...interlude} cancel={() => gameRef.current?.cancelRunPreparation()} complete={completeCut} />
      )}

      {/* ------------ TITLE ------------ */}
      {screen === 'title' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center-safe overflow-y-auto py-4 bg-gradient-to-b from-black/60 via-black/25 to-black/70 px-4">
          <div className="animate-pulse text-[10px] font-bold tracking-[0.6em] text-red-400/90">DASH &amp; SLASH PROTOCOL</div>
          <h1 className="mt-2 text-center font-black leading-none tracking-tight text-white drop-shadow-[0_0_25px_rgba(255,42,74,0.35)]">
            <span className="block text-4xl sm:text-6xl">STICKMAN</span>
            <span className="block text-6xl sm:text-9xl text-red-500">RISING</span>
          </h1>
          <div className="mt-4 h-[3px] w-56 bg-gradient-to-r from-transparent via-red-500 to-transparent" />
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Button
              ref={engageRef}
              size="lg"
              className={`${menuBtn} bg-red-600 text-white hover:bg-red-500`}
              disabled={!canEngage}
              onClick={(e) => { e.currentTarget.blur(); startGame(selectedSword) }}
            >
              <Play className="mr-2 h-4 w-4" /> ENGAGE
            </Button>
            <Button size="lg" variant="outline" className={`${menuBtn} border-zinc-700 bg-black/50 text-zinc-200 hover:bg-zinc-900 hover:text-white`} onClick={(e) => { e.currentTarget.blur(); setArsenalFrom('title'); setScreen('arsenal') }}>
              <Swords className="mr-2 h-4 w-4" /> ARSENAL
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="ghost" className="text-zinc-400 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen('howto') }}><BookOpen className="mr-2 h-4 w-4" /> HOW TO PLAY</Button>
            <Button variant="ghost" className="text-zinc-400 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen('scores') }}><Trophy className="mr-2 h-4 w-4" /> LEADERBOARD</Button>
            <Button variant="ghost" className="text-zinc-400 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setSettingsFrom('title'); setScreen('settings') }}><SettingsIcon className="mr-2 h-4 w-4" /> SETTINGS</Button>
          </div>
          <p className="mt-4 text-center text-[10px] font-bold tracking-[0.23em] text-slate-300">ONE BRIDGE · A DIFFERENT NIGHT EACH RUN</p>
          <div className="mt-8 flex items-center gap-4 text-[11px] font-mono text-zinc-500">
            <span>BEST {fmt(save.best)}</span>
            <span className="h-3 w-px bg-zinc-800" />
            <span>TOTAL KILLS {fmt(save.totalKills)}</span>
            <span className="h-3 w-px bg-zinc-800" />
            <span className="text-red-400/80" aria-live="polite">{canEngage ? SWORDS[selectedSword].name : hydrated ? 'LOADING GAME CODE' : 'STARTING MENU'}</span>
          </div>
        </div>
      )}

      {/* ------------ ARSENAL ------------ */}
      {screen === 'arsenal' && (
        <div className="absolute inset-0 flex flex-col bg-black/85 px-4 py-6 sm:px-10">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black tracking-widest text-white">ARSENAL</h2>
            <span className="text-[10px] font-mono text-zinc-500">TOTAL KILLS {fmt(save.totalKills)} · LOADOUT {loadout.length}/3</span>
          </div>
          <ScrollArea className="mt-4 min-h-0 flex-1">
            <div className="grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">
              {SWORD_ORDER.map((id) => {
                const base = SWORDS[id]
                const tier = swordTier(id, save.totalKills)
                const sw = upgradedSword(id, tier)
                const unlocked = save.unlocked.includes(id)
                const selected = selectedSword === id
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!unlocked}
                    onClick={(e) => {
                      e.currentTarget.blur()
                      if (!unlocked) return
                      const isHeavenly = id === 'katana' && tier === 2
                      setSelectedSword(id)
                      setLoadout((current) => {
                        if (isHeavenly) return ['katana']
                        const withoutHeavenly = current.filter((s) => !(s === 'katana' && swordTier('katana', save.totalKills) === 2))
                        if (withoutHeavenly.includes(id)) return withoutHeavenly
                        return [...withoutHeavenly, id].slice(-3)
                      })
                    }}
                    className={`relative overflow-hidden rounded-lg border p-4 text-left transition-all ${selected ? 'border-red-500 bg-red-950/40' : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-600'} ${unlocked ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black tracking-wider" style={{ color: sw.colors.accent }}>{sw.name}</span>
                      <div className="flex gap-1">
                        {loadout.includes(id) && <Badge className="bg-zinc-700 text-white">LOADOUT {loadout.indexOf(id) + 1}</Badge>}
                        {selected && <Badge className="bg-red-600 text-white">PRIMARY</Badge>}
                      </div>
                    </div>
                    <div className="mt-0.5 text-[9px] font-mono tracking-[0.25em] text-zinc-500">TIER {tier + 1} · {sw.title}</div>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-400">{sw.desc}</p>
                    <div className="mt-2 flex gap-1" aria-label={`${sw.name} upgrade path`}>
                      {base.upgrades.map((upgrade, i) => {
                        const earned = save.totalKills >= upgrade.kills
                        return <span key={upgrade.name} className={`flex-1 rounded border px-1 py-1 text-center text-[8px] font-mono ${i === tier ? 'border-current bg-white/10' : earned ? 'border-zinc-700 text-zinc-400' : 'border-zinc-900 text-zinc-700'}`} title={upgrade.perk}>{earned ? upgrade.name : `${fmt(upgrade.kills)} KILLS`}</span>
                      })}
                    </div>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: sw.colors.glow }}>{base.upgrades[tier].style}</p>
                    <p className="mt-0.5 text-[9px] text-zinc-500">{base.upgrades[tier].perk}</p>
                    <div className="mt-3 space-y-1.5">
                      <StatBar label="PWR" v={sw.stats.dmg / 1.4} color={sw.colors.accent} />
                      <StatBar label="SPD" v={sw.stats.spd / 1.25} color={sw.colors.accent} />
                      <StatBar label="RNG" v={(sw.stats.range - 0.9) / 0.2} color={sw.colors.accent} />
                    </div>
                    <div className="mt-3 text-[10px] font-mono leading-relaxed text-zinc-500">
                      <span style={{ color: sw.colors.glow }}>[U]</span> {sw.ability.name} — {sw.ability.desc}
                      <br />
                      <span style={{ color: sw.colors.glow }}>[R]</span> {sw.ult.name}
                    </div>
                    {!unlocked && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
                        <span className="text-xs font-black tracking-widest text-zinc-300">LOCKED</span>
                        <span className="mt-1 text-[10px] font-mono text-zinc-500">REQUIRES {fmt(sw.unlockKills)} TOTAL KILLS</span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
          <div className="mt-3 flex justify-between">
            <Button variant="outline" className="border-zinc-800 bg-black/60 text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen(arsenalFrom) }}>BACK</Button>
            <Button disabled={!canEngage} className="bg-red-600 px-10 font-black tracking-[0.25em] text-white hover:bg-red-500" onClick={(e) => { e.currentTarget.blur(); startGame(selectedSword) }}>
              {arsenalFrom === 'gameover' ? 'RETRY' : 'ENGAGE'} <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ------------ HOW TO PLAY ------------ */}
      {screen === 'howto' && (
        <div className="absolute inset-0 flex flex-col bg-black/85 px-6 py-6 sm:px-16">
          <h2 className="text-2xl font-black tracking-widest text-white">HOW TO PLAY</h2>
          <ScrollArea className="mt-4 min-h-0 flex-1">
            <div className="grid grid-cols-1 gap-6 pb-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-black tracking-[0.3em] text-red-400">CONTROLS</h3>
                <table className="w-full text-xs">
                  <tbody className="[&_td]:py-1.5 [&_td:first-child]:w-32 [&_td:first-child]:font-mono [&_td:first-child]:text-red-300 [&_td:last-child]:text-zinc-400">
                    <tr><td>A / D</td><td>Move — normal run</td></tr>
                    <tr><td>A, A / D, D</td><td>Double-tap, hold second press: faster sprint</td></tr>
                    <tr><td>SPACE</td><td>Jump / double jump; hold down to drop through a catwalk</td></tr>
                    <tr><td>Q</td><td>Draw / sheathe — choose sword or empty-hand combat</td></tr>
                    <tr><td>J</td><td>Light chain — fists sheathed, cuts drawn</td></tr>
                    <tr><td>K</td><td>Heavy attack — hold to CHARGE</td></tr>
                    <tr><td>L / SHIFT</td><td>Tap and release to dash; hold until ready, then release for power dash</td></tr>
                    <tr><td>DASH + J / K</td><td>Dash palm sheathed / sword strike drawn</td></tr>
                    <tr><td>W + J</td><td>Launcher — sends foes skyward</td></tr>
                    <tr><td>S + J</td><td>Cyclone spin</td></tr>
                    <tr><td>AIR J / K</td><td>Air combos / dive / meteor slam</td></tr>
                    <tr><td>O</td><td>Parry — then J for a riposte</td></tr>
                    <tr><td>U</td><td>Focused palm sheathed / sword ability drawn (energy)</td></tr>
                    <tr><td>R</td><td>Overdrive: palm finisher / sword ultimate (full meter)</td></tr>
                    <tr><td>E</td><td>Execute an eligible foe; hold 1.5s at a service terminal</td></tr>
                    <tr><td>1 - 6 / TAB</td><td>Switch blades</td></tr>
                    <tr><td>P / ESC</td><td>Pause</td></tr>
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-black tracking-[0.3em] text-red-400">FIELD MANUAL</h3>
                <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-zinc-400">
                  <li>Keep moving along the Bridge. Dry shelter holds your Flow and stops enemies and incoming fire.</li>
                  <li>Strike during a dash. Your separate 600-point stamina pool costs 45 for a normal dash or 120 for a power dash; it recovers after a short delay. Below 120, a charged release becomes a normal dash.</li>
                  <li>Power dash commits to a low, less-steerable skid before rising. Attacks remain available through the dash and recovery.</li>
                  <li>Light attacks chain: press J in rhythm for five escalating slashes.</li>
                  <li>Launch with W+J, then chase into the air with jump + air slashes for juggles.</li>
                  <li>Hold K to charge an Overload Slash — each blade charges differently.</li>
                  <li>A gold ! means an attack is coming. Parry with O right as it lands, then punish.</li>
                  <li>Gunners fire tracer rounds — a perfect parry reflects them back.</li>
                  <li>Shields block frontal hits. Break them with heavy or charged slashes.</li>
                  <li>Service trades current Flow for +40 health, 50 shield and a 30-second buff. Tap SERVICE on touch.</li>
                  <li>Defeat the sector boss to unlock the gate ahead.</li>
                  <li>Executions (E) on staggered foes restore health and energy. Stay aggressive.</li>
                  <li>Hits and kills charge Overdrive. At full charge press [R] or tap the glowing Overdrive button.</li>
                </ul>
              </div>
            </div>
          </ScrollArea>
          <Button variant="outline" className="mt-3 self-start border-zinc-800 bg-black/60 text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen('title') }}>BACK</Button>
        </div>
      )}

      {/* ------------ LEADERBOARD ------------ */}
      {screen === 'scores' && (
        <div className="absolute inset-0 flex flex-col bg-black/85 px-6 py-6 sm:px-16">
          <div className="flex items-center gap-3">
            <Trophy className="h-5 w-5 text-amber-400" />
            <h2 className="text-2xl font-black tracking-widest text-white">LEADERBOARD</h2>
          </div>
          {scoresLoading && <p role="status" className="mt-3 text-zinc-400">Loading leaderboard…</p>}
          {scoreError && <div role="alert" className="mt-3 text-red-300">{scoreError} <Button variant="outline" disabled={scoresLoading} onClick={() => void refreshScores()}>RETRY</Button></div>}
          <ScrollArea className="mt-4 min-h-0 flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-[10px] font-black tracking-[0.2em] text-zinc-500">
                  <th className="py-2">#</th>
                  <th>OPERATIVE</th>
                  <th>SCORE</th>

                  <th>COMBO</th>
                  <th>KILLS</th>
                  <th>BLADE</th>
                </tr>
              </thead>
              <tbody className="[&_td]:py-2 [&_tr]:border-b [&_tr]:border-zinc-900">
                {scores.length === 0 && !scoresLoading && !scoreError && (
                  <tr><td colSpan={6} className="py-8 text-center font-mono text-zinc-600">NO RECORDS YET — BE THE FIRST</td></tr>
                )}
                {scores.map((r, i) => (
                  <tr key={r.id} className={i === 0 ? 'text-amber-300' : 'text-zinc-300'}>
                    <td className="font-mono">{String(i + 1).padStart(2, '0')}</td>
                    <td className="font-black tracking-wider">{r.name}</td>
                    <td className="font-mono text-red-400">{fmt(r.score)}</td>

                    <td className="font-mono">{r.maxCombo}</td>
                    <td className="font-mono">{r.kills}</td>
                    <td className="font-mono text-zinc-500">{r.sword.toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          <Button variant="outline" className="mt-3 self-start border-zinc-800 bg-black/60 text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen('title') }}>BACK</Button>
        </div>
      )}

      {/* ------------ SETTINGS ------------ */}
      {screen === 'settings' && (
        <section aria-labelledby="settings-title" className="sr-settings absolute inset-0 flex flex-col bg-[#080b10]/95">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-600/50 pb-3">
            <div className="flex items-center gap-3">
              <SettingsIcon aria-hidden="true" className="h-5 w-5 text-sky-300" />
              <h2 id="settings-title" className="text-xl font-black tracking-widest text-white sm:text-2xl">SETTINGS</h2>
            </div>
            <Button variant="outline" data-settings-back className="sr-settings-back h-11 shrink-0 border-slate-500 bg-slate-900 font-bold text-white"
              onClick={() => setScreen(settingsFrom === 'paused' ? 'paused' : 'title')}>BACK</Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4" tabIndex={0} aria-label="Game preferences">
            <div className="max-w-xl space-y-5 pb-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div id="quality-label" className="text-xs font-black tracking-widest text-slate-200">GRAPHICS PRESET</div>
                  <span role="status" className="font-mono text-[11px] text-sky-200">
                    {settings.adaptiveQuality ? 'Adaptive' : 'Locked'} · {(settings.adaptiveQuality ? activeScale ?? featuresFor(settings.quality).dprCap : featuresFor(settings.quality).dprCap).toFixed(2)}× target
                  </span>
                </div>
                <div role="group" aria-labelledby="quality-label" aria-describedby="quality-hint" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {QUALITY_PRESETS.map((q) => (
                    <Button key={q} variant="outline" aria-pressed={settings.quality === q}
                      className={`min-h-11 px-2 text-xs font-bold tracking-wide ${settings.quality === q ? 'border-sky-300 bg-sky-950 text-sky-100' : 'border-slate-600 bg-slate-900 text-slate-200'}`}
                      onClick={() => applyFramePreferences(lockQualityPreset(settingsRef.current, q))}>{QUALITY_NAMES[q]}</Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-200">{QUALITY_BLURB[settings.quality]}</p>
                <p id="quality-hint" className="mt-1 text-xs leading-relaxed text-slate-300">
                  Picking a preset locks the scale target. Adaptive resolution can lower it without changing the preset. Suggested for this device: {QUALITY_NAMES[deviceClass.start]}.
                </p>
                {settingsFrom === 'paused' && (() => {
                  const current = gameRef.current?.graphicsPresentation()
                  if (!current) return null
                  return <p data-active-renderer className="mt-2 text-xs text-slate-300" title={current.reason === 'active' ? undefined : current.reason}>
                    Last frame: {RENDERER_NAMES[current.path]} · {current.backingScale.toFixed(2)}× rendered
                  </p>
                })()}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <label htmlFor="adaptive-quality" className="text-xs font-black tracking-widest text-slate-200">ADAPTIVE RESOLUTION</label>
                  <Switch id="adaptive-quality" aria-label="Adaptive resolution" aria-describedby="quality-hint" checked={settings.adaptiveQuality}
                    onCheckedChange={adaptiveQuality => setSettings(s => ({ ...s, adaptiveQuality }))} />
                </div>
              </div>
              <Separator className="bg-slate-700/70" />
              <PreferenceSlider label="Screen shake" sliderLabel="Shake intensity" value={settings.shakeIntensity} min={.2} max={1.5} step={.1}
                change={shakeIntensity => setSettings(s => ({ ...s, shakeIntensity }))}>
                <Switch aria-label="Screen shake" checked={settings.shake} onCheckedChange={shake => setSettings(s => ({ ...s, shake }))} />
              </PreferenceSlider>
              <PreferenceSlider label="SFX volume" sliderLabel="Sound effects volume" value={settings.sfxVolume}
                change={sfxVolume => setSettings(s => ({ ...s, sfxVolume }))} />
              <PreferenceSlider label="Music volume" sliderLabel="Music volume" value={settings.musicVolume}
                change={musicVolume => setSettings(s => ({ ...s, musicVolume }))} />
              <div className="flex items-center justify-between">
                <div className="text-xs font-black tracking-widest text-slate-200">MUTE ALL</div>
                <Switch aria-label="Mute all" checked={settings.muted} onCheckedChange={muted => setSettings(s => ({ ...s, muted }))} />
              </div>
              <Separator className="bg-zinc-900" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-black tracking-[0.25em] text-slate-200">IMPACT STYLE</div>
                  <div className="text-[10px] text-slate-300">Enemy death particles</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className={`font-black tracking-widest ${settings.gore === 'energy' ? 'border-cyan-500 bg-cyan-950/50 text-cyan-300' : 'border-zinc-800 bg-black/60 text-zinc-400'}`} onClick={(e) => { e.currentTarget.blur(); setSettings((s) => ({ ...s, gore: 'energy' })) }}>ENERGY</Button>
                  <Button variant="outline" className={`font-black tracking-widest ${settings.gore === 'blood' ? 'border-red-500 bg-red-950/50 text-red-300' : 'border-zinc-800 bg-black/60 text-zinc-400'}`} onClick={(e) => { e.currentTarget.blur(); setSettings((s) => ({ ...s, gore: 'blood' })) }}>BLOOD</Button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs font-black tracking-[0.25em] text-slate-200">SHOW FPS</div>
                <Switch aria-label="Show FPS" checked={settings.showFps} onCheckedChange={showFps => applyFramePreferences({ ...settingsRef.current, showFps })} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ------------ PAUSED ------------ */}
      {screen === 'paused' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center-safe overflow-y-auto py-4 bg-black/70 px-4">
          <div className="text-[10px] font-bold tracking-[0.6em] text-zinc-500">SYSTEM SUSPENDED</div>
          <h2 className="mt-1 text-5xl font-black tracking-widest text-white">PAUSED</h2>
          <div className="mt-8 flex flex-col gap-3">
            <Button size="lg" className="bg-red-600 px-16 font-black tracking-[0.25em] text-white hover:bg-red-500" autoFocus onClick={(e) => { e.currentTarget.blur(); gameRef.current?.resume() }}>RESUME</Button>
            <Button size="lg" variant="outline" className="border-zinc-700 bg-black/60 font-black tracking-[0.25em] text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setSettingsFrom('paused'); setScreen('settings') }}>SETTINGS</Button>
            <Button size="lg" variant="outline" className="border-zinc-800 bg-black/60 font-black tracking-[0.25em] text-zinc-500 hover:text-red-400" onClick={(e) => { e.currentTarget.blur(); gameRef.current?.quitToMenu(); setScreen('title') }}>ABORT MISSION</Button>
          </div>
        </div>
      )}

      {/* ------------ GAME OVER ------------ */}
      {screen === 'gameover' && stats && (
        <div className="absolute inset-0 flex flex-col items-center justify-center-safe overflow-y-auto py-4 bg-gradient-to-b from-black/85 via-red-950/30 to-black/90 px-4">
          <div className="text-[10px] font-bold tracking-[0.6em] text-red-400">CONNECTION LOST</div>
          <h2 className="mt-1 text-center text-5xl font-black tracking-widest text-red-500 drop-shadow-[0_0_20px_rgba(255,42,74,0.4)]">YOU HAVE FALLEN</h2>

          {newUnlocks.length > 0 && (
            <div className="mt-4 border border-amber-500/60 bg-amber-950/40 px-6 py-2 text-center">
              <div className="text-[10px] font-black tracking-[0.3em] text-amber-400">NEW BLADE UNLOCKED</div>
              <div className="text-sm font-black tracking-widest text-amber-200">{newUnlocks.map((id) => SWORDS[id].name).join(' / ')}</div>
            </div>
          )}

          {nightLabel && (
            <div className="mt-4 text-center">
              <div className="text-[9px] font-black tracking-[0.4em] text-zinc-500">TONIGHT&apos;S RIG</div>
              <div className="mt-0.5 font-mono text-[11px] tracking-[0.2em] text-cyan-300/80">{nightLabel}</div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-x-10 gap-y-4 sm:grid-cols-6">
            <Stat label="SCORE" value={fmt(stats.score)} accent />
            <Stat label="DISTANCE" value={`${fmt(Math.floor(stats.distanceMetres ?? 0))} m`} />
            <Stat label="MAX COMBO" value={`${stats.maxCombo}`} />
            <Stat label="KILLS" value={`${stats.kills}`} />
            <Stat label="TIME" value={`${Math.floor(stats.timeAlive / 60)}:${String(Math.floor(stats.timeAlive % 60)).padStart(2, '0')}`} />
            <Stat label="RANK" value={stats.bestRank} accent />
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              placeholder="OPERATIVE NAME"
              className="h-11 w-48 border-zinc-700 bg-black/70 font-mono tracking-widest text-zinc-200 placeholder:text-zinc-600"
              maxLength={16}
            />
            <Button className="h-11 bg-red-600 font-black tracking-widest text-white hover:bg-red-500" disabled={submitted || submitting} onClick={(e) => { e.currentTarget.blur(); void submitScore() }}>
              <Send className="mr-2 h-4 w-4" /> {submitted ? 'SUBMITTED' : submitting ? 'SAVING…' : 'SUBMIT'}
            </Button>
          </div>

          {submitError && <p role="alert" className="mt-3 text-sm text-red-300">{submitError}</p>}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button ref={retryRef} size="lg" className="bg-red-600 px-12 font-black tracking-[0.25em] text-white hover:bg-red-500" autoFocus onClick={(e) => { e.currentTarget.blur(); startGame(selectedSword) }}>
              <RotateCcw className="mr-2 h-4 w-4" /> RETRY
            </Button>
            <Button size="lg" variant="outline" className="border-zinc-700 bg-black/60 font-black tracking-[0.25em] text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setArsenalFrom('gameover'); setScreen('arsenal') }}>
              <Swords className="mr-2 h-4 w-4" /> ARSENAL
            </Button>
            <Button size="lg" variant="outline" className="border-zinc-800 bg-black/60 font-black tracking-[0.25em] text-zinc-500 hover:text-white" onClick={(e) => { e.currentTarget.blur(); gameRef.current?.quitToMenu(); setScreen('title') }}>
              <HomeIcon className="mr-2 h-4 w-4" /> MENU
            </Button>
          </div>
        </div>
      )}
      {graphicsQA && screen !== 'settings' && (
        <details className="sr-graphics-diagnostics" data-graphics-diagnostics>
          <summary aria-live="polite">{graphicsQA.version} · {graphicsQA.status}</summary>
          <p>Graphics QA only. Ultra and Show FPS are set for this tab. Engage and keep the tab visible for 120 world frames. A pass checks rendering, not a 60 FPS target.</p>
          <pre>{JSON.stringify(graphicsQA, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

/* ================================================================== */

function PreferenceSlider({ label, sliderLabel, value, min = 0, max = 1, step = .05, change, children }: {
  label: string; sliderLabel: string; value: number; min?: number; max?: number; step?: number
  change: (value: number) => void; children?: React.ReactNode
}) {
  const percent = `${Math.round(value * 100)}%`
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2 text-xs font-bold text-slate-200">
          <span className="uppercase tracking-widest">{label}</span><span className="font-mono text-sky-200">{percent}</span>
        </div>
        <Slider className="sr-preference-slider h-8" aria-label={sliderLabel} aria-valuetext={percent}
          value={[value]} min={min} max={max} step={step} onValueChange={([next]) => change(next ?? value)} />
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-[9px] font-black tracking-[0.3em] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-black tracking-wider ${accent ? 'text-red-400' : 'text-zinc-200'}`}>{value}</div>
    </div>
  )
}

function StatBar({ label, v, color }: { label: string; v: number; color: string }) {
  const pct = Math.max(0.08, Math.min(1, v)) * 100
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-[9px] font-mono text-zinc-600">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-900">
        <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

/* ================================================================== */
/* touch controls                                                       */
/* ================================================================== */

function TouchLayer({ input, onPause, actions }: { input: GameInput; onPause: () => void;
  actions: { overdrive: boolean; service: boolean; execute: boolean } }) {
  return (
    <>
      <button
        type="button"
        aria-label="Pause"
        className="sr-pause absolute z-20 flex h-11 w-11 items-center justify-center rounded border border-zinc-700 bg-black/60 text-zinc-300"
        onClick={(e) => { e.currentTarget.blur(); onPause() }}
      >
        <Pause className="h-5 w-5" />
      </button>
      <Joystick input={input} />
      <div role="group" aria-label="Equipment" className="sr-touch-equipment absolute z-20 flex gap-1">
        <TouchBtn input={input} action="sheathe" label="DRAW" small compact />
        <TouchBtn input={input} action="cycleSword" label="SWORD" small compact />
      </div>
      {/* Keep three rows on the fight side; a fourth obscures feet and blade
          tips at the portrait combat zoom. Service shares the contextual row. */}
      <div className="sr-touch-actions absolute z-20 grid grid-cols-3 place-items-center gap-1 sm:gap-2.5">
        <TouchBtn input={input} action="parry" label="PARRY" small />
        <TouchBtn input={input} action="ability" label="SPEC" small />
        <TouchBtn input={input} action="ult" label="OVERDRIVE" name="Overdrive" small ready={actions.overdrive} />
        <TouchBtn input={input} action="light" label="SLASH" />
        <TouchBtn input={input} action="heavy" label="HEAVY" />
        <TouchBtn input={input} action="dash" label="DASH" />
        {actions.service ? <TouchBtn input={input} action="service" label="SERVICE" small ready /> : <div />}
        <TouchBtn input={input} action="jump" label="JUMP" />
        {actions.execute ? <TouchBtn input={input} action="execute" label="EXEC" small ready /> : <div />}
      </div>
    </>
  )
}

function TouchBtn({ input, action, label, name, small, ready, compact }: { input: GameInput; action: Action; label: string; name?: string; small?: boolean; ready?: boolean; compact?: boolean }) {
  const owner = useRef<number | null>(null)
  useEffect(() => () => { input.setVirtual(action,false) }, [action,input])
  const release = (e: React.PointerEvent) => {
    if (owner.current !== e.pointerId) return
    owner.current=null; input.setVirtual(action,false)
  }
  const cls = action === 'ult' ? 'text-[8px] tracking-tight' : small ? 'text-[9px]' : 'text-[10px]'
  const size = compact ? '44px' : small
    ? 'clamp(44px, min(11dvh, var(--sr-action-limit)), 56px)'
    : 'clamp(44px, min(13dvh, var(--sr-action-limit)), 72px)'
  return (
    <button
      type="button"
      aria-label={name ?? label}
      data-ready={ready || undefined}
      data-action={action}
      style={{ width: size, height: size }}
      className={`${cls} sr-touch-surface touch-none select-none rounded-full border font-black tracking-widest`}
      onPointerDown={(e) => {
        e.preventDefault()
        if (owner.current !== null) return
        e.currentTarget.setPointerCapture(e.pointerId)
        owner.current=e.pointerId; input.setVirtual(action,true)
      }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onClick={e => {
        // A pointer already owns its down/up. Keyboard or assistive activation
        // arrives as a separate zero-detail click.
        if (e.detail === 0 && owner.current === null) { input.setVirtual(action, true); input.setVirtual(action, false) }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )
}

function Joystick({ input }: { input: GameInput }) {
  const ref = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  useEffect(() => () => input.setVirtualAxis(0,0), [input])
  const activeId = useRef<number | null>(null)

  const handle = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let dx = (e.clientX - cx) / (rect.width / 2)
    let dy = (e.clientY - cy) / (rect.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    input.setVirtualAxis(dx, dy)
    if(knob.current) knob.current.style.translate = `${dx * (rect.width / 2 - 22)}px ${dy * (rect.height / 2 - 22)}px`
  }

  const release = () => {
    activeId.current = null
    input.setVirtualAxis(0, 0)
    if(knob.current) knob.current.style.translate = '0px 0px'
  }

  return (
    <div
      ref={ref}
      className="sr-joystick sr-touch-surface absolute z-20 touch-none rounded-full border"
      style={{ width: 'var(--sr-joystick-size)', height: 'var(--sr-joystick-size)' }}
      onPointerDown={(e) => {
        e.preventDefault()
        if (activeId.current !== null) return
        activeId.current = e.pointerId
        e.currentTarget.setPointerCapture?.(e.pointerId)
        handle(e)
      }}
      onPointerMove={(e) => {
        if (activeId.current === e.pointerId) handle(e)
      }}
      onPointerUp={(e) => { if (activeId.current === e.pointerId) release() }}
      onPointerCancel={(e) => { if (activeId.current === e.pointerId) release() }}
      onLostPointerCapture={(e) => { if (activeId.current === e.pointerId) release() }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-11 w-11 rounded-full border border-[#8796a1] bg-[#263645]"
        ref={knob} style={{ transform: 'translate(-50%, -50%)' }}
      />

    </div>
  )
}
