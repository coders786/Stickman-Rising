'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Game } from '@/game/game'
import { SWORDS, SWORD_ORDER, SwordId } from '@/game/combat/swords'
import { DEFAULT_SETTINGS, GameSettings, RunStats } from '@/game/core/types'
import { Input as GameInput, Action } from '@/game/core/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input as TextInput } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { fmt } from '@/game/core/utils'
import { Swords, Trophy, Play, Settings as SettingsIcon, BookOpen, ChevronRight, RotateCcw, Home as HomeIcon, Send, Pause } from 'lucide-react'

/* ------------------------------------------------------------------ */

type Screen = 'title' | 'arsenal' | 'howto' | 'scores' | 'settings' | 'playing' | 'paused' | 'gameover'

interface SaveData {
  totalKills: number
  best: number
  unlocked: SwordId[]
}

interface ScoreRow {
  id: string
  name: string
  score: number
  wave: number
  maxCombo: number
  kills: number
  sword: string
}

const SAVE_KEY = 'sr_save_v1'
const SETTINGS_KEY = 'sr_settings_v1'
const NAME_KEY = 'sr_name_v1'

function loadSave(): SaveData {
  if (typeof window === 'undefined') return { totalKills: 0, best: 0, unlocked: ['katana'] }
  try {
    const raw = window.localStorage.getItem(SAVE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SaveData
      if (!parsed.unlocked?.includes('katana')) parsed.unlocked.unshift('katana')
      return parsed
    }
  } catch { /* ignore */ }
  return { totalKills: 0, best: 0, unlocked: ['katana'] }
}

function loadSettings(): GameSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) }
  } catch { /* ignore */ }
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  return { ...DEFAULT_SETTINGS, quality: coarse ? 'medium' : 'high' }
}

/* ================================================================== */

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const saveRef = useRef<SaveData>({ totalKills: 0, best: 0, unlocked: ['katana'] })

  const [screen, setScreen] = useState<Screen>('title')
  const [settingsFrom, setSettingsFrom] = useState<Screen>('title')
  const [stats, setStats] = useState<RunStats | null>(null)
  /* persisted state starts from SSR-safe defaults; real values load in a
   * mount effect below so server HTML === first client render (no
   * hydration mismatch badge) */
  const [save, setSave] = useState<SaveData>({ totalKills: 0, best: 0, unlocked: ['katana'] })
  const [settings, setSettings] = useState<GameSettings>({ ...DEFAULT_SETTINGS })
  const [selectedSword, setSelectedSword] = useState<SwordId>('katana')
  const [scores, setScores] = useState<ScoreRow[]>([])
  const [name, setName] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [newUnlocks, setNewUnlocks] = useState<SwordId[]>([])
  const [touchMode, setTouchMode] = useState(false)
  const [gameInput, setGameInput] = useState<GameInput | null>(null)

  /* hydrate persisted values AFTER mount (SSR-safe pattern). Batched into a
   * rAF callback: asynchronous by design, so no cascading renders and no
   * flash of default content before the first paint. */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const s = loadSave()
      setSave(s)
      setSelectedSword(s.unlocked[s.unlocked.length - 1] ?? 'katana')
      setSettings(loadSettings())
      setTouchMode(window.matchMedia?.('(pointer: coarse)').matches ?? false)
      try {
        setName(window.localStorage.getItem(NAME_KEY) ?? '')
      } catch { /* ignore */ }
    })
    return () => cancelAnimationFrame(id)
  }, [])

  /* ---------------- game mount ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const game = new Game()
    gameRef.current = game
    game.applySettings(loadSettings())
    game.setUnlocked(loadSave().unlocked)
    const off = game.on((e) => {
      if (e.type === 'gameover') {
        setStats(e.stats)
        setScreen('gameover')
        setSubmitted(false)
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
        try {
          window.localStorage.setItem(SAVE_KEY, JSON.stringify(next))
        } catch { /* ignore */ }
        if (fresh.length) {
          setNewUnlocks(fresh)
          setSelectedSword(fresh[fresh.length - 1])
        }
      } else if (e.type === 'phase') {
        if (e.phase === 'paused') setScreen('paused')
        if (e.phase === 'playing') setScreen('playing')
      }
    })
    game.mount(canvas)
    setGameInput(game.input)

    const ro = new ResizeObserver(() => game.resize())
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => {
      ro.disconnect()
      off()
      game.destroy()
      gameRef.current = null
    }
  }, [])

  /* ---------------- settings persistence ---------------- */

  useEffect(() => {
    const game = gameRef.current
    if (!game) return
    game.applySettings(settings)
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch { /* ignore */ }
  }, [settings])

  useEffect(() => {
    gameRef.current?.setUnlocked(save.unlocked)
    saveRef.current = save
  }, [save.unlocked, save])

  /* ---------------- pause hotkey when game input disabled ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (screen === 'paused') {
          gameRef.current?.resume()
        } else if (screen === 'playing') {
          gameRef.current?.pause()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen])

  /* ---------------- actions ---------------- */

  const refreshScores = useCallback(async () => {
    try {
      const res = await fetch('/api/scores', { cache: 'no-store' })
      if (res.ok) setScores((await res.json()) as ScoreRow[])
    } catch { /* offline */ }
  }, [])

  useEffect(() => {
    if (screen !== 'scores') return
    let cancelled = false
    fetch('/api/scores', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled) setScores(rows as ScoreRow[])
      })
      .catch(() => { /* offline */ })
    return () => {
      cancelled = true
    }
  }, [screen])

  const startGame = useCallback((sword: SwordId) => {
    setNewUnlocks([])
    gameRef.current?.startRun(sword)
    setScreen('playing')
  }, [])

  const submitScore = useCallback(async () => {
    if (!stats || submitted) return
    const finalName = name.trim() || 'ANON'
    try {
      window.localStorage.setItem(NAME_KEY, finalName)
    } catch { /* ignore */ }
    setSubmitted(true)
    try {
      await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          score: Math.round(stats.score),
          wave: stats.wave,
          maxCombo: stats.maxCombo,
          kills: stats.kills,
          sword: selectedSword,
        }),
      })
      await refreshScores()
    } catch { /* offline */ }
  }, [stats, name, submitted, selectedSword, refreshScores])

  const menuBtn = 'h-12 px-8 font-black tracking-[0.25em] text-sm'

  /* ================================================================== */

  return (
    <div ref={wrapRef} className="relative w-screen h-[100dvh] overflow-hidden bg-black select-none">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-label="Stickman Rising game canvas" />

      {/* ------------ touch controls ------------ */}
      {screen === 'playing' && touchMode && gameInput && <TouchLayer input={gameInput} onPause={() => gameRef.current?.pause()} />}

      {/* ------------ TITLE ------------ */}
      {screen === 'title' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-black/60 via-black/25 to-black/70 px-4">
          <div className="animate-pulse text-[10px] font-bold tracking-[0.6em] text-red-400/90">DASH &amp; SLASH PROTOCOL</div>
          <h1 className="mt-2 text-center font-black leading-none tracking-tight text-white drop-shadow-[0_0_25px_rgba(255,42,74,0.35)]">
            <span className="block text-4xl sm:text-6xl">STICKMAN</span>
            <span className="block text-6xl sm:text-9xl text-red-500">RISING</span>
          </h1>
          <div className="mt-4 h-[3px] w-56 bg-gradient-to-r from-transparent via-red-500 to-transparent" />
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Button
              size="lg"
              className={`${menuBtn} bg-red-600 text-white hover:bg-red-500`}
              onClick={(e) => { e.currentTarget.blur(); startGame(selectedSword) }}
            >
              <Play className="mr-2 h-4 w-4" /> ENGAGE
            </Button>
            <Button size="lg" variant="outline" className={`${menuBtn} border-zinc-700 bg-black/50 text-zinc-200 hover:bg-zinc-900 hover:text-white`} onClick={(e) => { e.currentTarget.blur(); setScreen('arsenal') }}>
              <Swords className="mr-2 h-4 w-4" /> ARSENAL
            </Button>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" className="text-zinc-400 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen('howto') }}><BookOpen className="mr-2 h-4 w-4" /> HOW TO PLAY</Button>
            <Button variant="ghost" className="text-zinc-400 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen('scores') }}><Trophy className="mr-2 h-4 w-4" /> LEADERBOARD</Button>
            <Button variant="ghost" className="text-zinc-400 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setSettingsFrom('title'); setScreen('settings') }}><SettingsIcon className="mr-2 h-4 w-4" /> SETTINGS</Button>
          </div>
          <div className="mt-8 flex items-center gap-4 text-[11px] font-mono text-zinc-500">
            <span>BEST {fmt(save.best)}</span>
            <span className="h-3 w-px bg-zinc-800" />
            <span>TOTAL KILLS {fmt(save.totalKills)}</span>
            <span className="h-3 w-px bg-zinc-800" />
            <span className="text-red-400/80">{SWORDS[selectedSword].name}</span>
          </div>
        </div>
      )}

      {/* ------------ ARSENAL ------------ */}
      {screen === 'arsenal' && (
        <div className="absolute inset-0 flex flex-col bg-black/85 px-4 py-6 sm:px-10">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black tracking-widest text-white">ARSENAL</h2>
            <span className="text-[10px] font-mono text-zinc-500">TOTAL KILLS {fmt(save.totalKills)}</span>
          </div>
          <ScrollArea className="mt-4 min-h-0 flex-1">
            <div className="grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">
              {SWORD_ORDER.map((id) => {
                const sw = SWORDS[id]
                const unlocked = save.unlocked.includes(id)
                const selected = selectedSword === id
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!unlocked}
                    onClick={(e) => { e.currentTarget.blur(); if (unlocked) setSelectedSword(id) }}
                    className={`relative overflow-hidden rounded-lg border p-4 text-left transition-all ${selected ? 'border-red-500 bg-red-950/40' : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-600'} ${unlocked ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black tracking-wider" style={{ color: sw.colors.accent }}>{sw.name}</span>
                      {selected && <Badge className="bg-red-600 text-white">EQUIPPED</Badge>}
                    </div>
                    <div className="mt-0.5 text-[9px] font-mono tracking-[0.25em] text-zinc-500">{sw.title}</div>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-400">{sw.desc}</p>
                    <div className="mt-3 space-y-1.5">
                      <StatBar label="PWR" v={sw.stats.dmg / 1.4} color={sw.colors.accent} />
                      <StatBar label="SPD" v={sw.stats.spd / 1.25} color={sw.colors.accent} />
                      <StatBar label="RNG" v={(sw.stats.range - 0.9) / 0.2} color={sw.colors.accent} />
                    </div>
                    <div className="mt-3 text-[10px] font-mono leading-relaxed text-zinc-500">
                      <span style={{ color: sw.colors.glow }}>[U]</span> {sw.ability.name} — {sw.ability.desc}
                      <br />
                      <span style={{ color: sw.colors.glow }}>[I]</span> {sw.ult.name}
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
            <Button variant="outline" className="border-zinc-800 bg-black/60 text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen('title') }}>BACK</Button>
            <Button className="bg-red-600 px-10 font-black tracking-[0.25em] text-white hover:bg-red-500" onClick={(e) => { e.currentTarget.blur(); startGame(selectedSword) }}>
              ENGAGE <ChevronRight className="ml-1 h-4 w-4" />
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
                    <tr><td>A / D</td><td>Move</td></tr>
                    <tr><td>SPACE</td><td>Jump / double jump</td></tr>
                    <tr><td>J</td><td>Light attack (chain up to 5)</td></tr>
                    <tr><td>K</td><td>Heavy attack — hold to CHARGE</td></tr>
                    <tr><td>L / SHIFT</td><td>Dash (8 directions, cancels anything)</td></tr>
                    <tr><td>DASH + J / K</td><td>Dash slash / piercing fang</td></tr>
                    <tr><td>W + J</td><td>Launcher — sends foes skyward</td></tr>
                    <tr><td>S + J</td><td>Cyclone spin</td></tr>
                    <tr><td>AIR J / K</td><td>Air combos / dive / meteor slam</td></tr>
                    <tr><td>O</td><td>Parry — then J for a riposte</td></tr>
                    <tr><td>U</td><td>Sword ability (costs energy)</td></tr>
                    <tr><td>I</td><td>Ultimate when the blade meter is full</td></tr>
                    <tr><td>E</td><td>Execute staggered enemies — restores HP</td></tr>
                    <tr><td>1 - 6 / TAB</td><td>Switch blades</td></tr>
                    <tr><td>P / ESC</td><td>Pause</td></tr>
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-black tracking-[0.3em] text-red-400">FIELD MANUAL</h3>
                <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-zinc-400">
                  <li>Never stop moving. Dash through enemies — dash cancels every attack.</li>
                  <li>Light attacks chain: press J in rhythm for five escalating slashes.</li>
                  <li>Launch with W+J, then chase into the air with jump + air slashes for juggles.</li>
                  <li>Hold K to charge an Overload Slash — each blade charges differently.</li>
                  <li>A gold ! means an attack is coming. Parry with O right as it lands, then punish.</li>
                  <li>Gunners fire tracer rounds — a perfect parry reflects them back.</li>
                  <li>Shields block frontal hits. Break them with heavy or charged slashes.</li>
                  <li>Executions (E) on staggered foes restore health and energy. Stay aggressive.</li>
                  <li>Kills charge the blade meter. At full charge, unleash [I] and watch the arena burn.</li>
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
          <ScrollArea className="mt-4 min-h-0 flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-[10px] font-black tracking-[0.2em] text-zinc-500">
                  <th className="py-2">#</th>
                  <th>OPERATIVE</th>
                  <th>SCORE</th>
                  <th>WAVE</th>
                  <th>COMBO</th>
                  <th>KILLS</th>
                  <th>BLADE</th>
                </tr>
              </thead>
              <tbody className="[&_td]:py-2 [&_tr]:border-b [&_tr]:border-zinc-900">
                {scores.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center font-mono text-zinc-600">NO RECORDS YET — BE THE FIRST</td></tr>
                )}
                {scores.map((r, i) => (
                  <tr key={r.id} className={i === 0 ? 'text-amber-300' : 'text-zinc-300'}>
                    <td className="font-mono">{String(i + 1).padStart(2, '0')}</td>
                    <td className="font-black tracking-wider">{r.name}</td>
                    <td className="font-mono text-red-400">{fmt(r.score)}</td>
                    <td className="font-mono">{r.wave}</td>
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
        <div className="absolute inset-0 flex flex-col bg-black/85 px-6 py-6 sm:px-16">
          <div className="flex items-center gap-3">
            <SettingsIcon className="h-5 w-5 text-zinc-400" />
            <h2 className="text-2xl font-black tracking-widest text-white">SETTINGS</h2>
          </div>
          <ScrollArea className="mt-4 min-h-0 flex-1">
            <div className="max-w-xl space-y-6 pb-4">
              <div>
                <div className="mb-2 text-xs font-black tracking-[0.25em] text-zinc-500">VISUAL QUALITY</div>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as const).map((q) => (
                    <Button
                      key={q}
                      variant="outline"
                      className={`flex-1 font-black tracking-widest ${settings.quality === q ? 'border-red-500 bg-red-950/60 text-red-300' : 'border-zinc-800 bg-black/60 text-zinc-400'}`}
                      onClick={(e) => { e.currentTarget.blur(); setSettings((s) => ({ ...s, quality: q })) }}
                    >{q.toUpperCase()}</Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-black tracking-[0.25em] text-zinc-500">SCREEN SHAKE</div>
                  <div className="text-[10px] text-zinc-600">Impact trauma on the camera</div>
                </div>
                <div className="flex items-center gap-4">
                  <Slider className="w-36" value={[settings.shakeIntensity]} min={0.2} max={1.5} step={0.1} onValueChange={(v) => setSettings((s) => ({ ...s, shakeIntensity: v[0] ?? 1 }))} />
                  <Switch checked={settings.shake} onCheckedChange={(v) => setSettings((s) => ({ ...s, shake: v }))} />
                </div>
              </div>
              <Separator className="bg-zinc-900" />
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black tracking-[0.25em] text-zinc-500">SFX VOLUME</div>
                  <Slider className="w-44" value={[settings.sfxVolume]} min={0} max={1} step={0.05} onValueChange={(v) => setSettings((s) => ({ ...s, sfxVolume: v[0] ?? 0.8 }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black tracking-[0.25em] text-zinc-500">MUSIC VOLUME</div>
                  <Slider className="w-44" value={[settings.musicVolume]} min={0} max={1} step={0.05} onValueChange={(v) => setSettings((s) => ({ ...s, musicVolume: v[0] ?? 0.55 }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black tracking-[0.25em] text-zinc-500">MUTE ALL</div>
                  <Switch checked={settings.muted} onCheckedChange={(v) => setSettings((s) => ({ ...s, muted: v }))} />
                </div>
              </div>
              <Separator className="bg-zinc-900" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-black tracking-[0.25em] text-zinc-500">IMPACT STYLE</div>
                  <div className="text-[10px] text-zinc-600">Enemy death particles</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className={`font-black tracking-widest ${settings.gore === 'energy' ? 'border-cyan-500 bg-cyan-950/50 text-cyan-300' : 'border-zinc-800 bg-black/60 text-zinc-400'}`} onClick={(e) => { e.currentTarget.blur(); setSettings((s) => ({ ...s, gore: 'energy' })) }}>ENERGY</Button>
                  <Button variant="outline" className={`font-black tracking-widest ${settings.gore === 'blood' ? 'border-red-500 bg-red-950/50 text-red-300' : 'border-zinc-800 bg-black/60 text-zinc-400'}`} onClick={(e) => { e.currentTarget.blur(); setSettings((s) => ({ ...s, gore: 'blood' })) }}>BLOOD</Button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs font-black tracking-[0.25em] text-zinc-500">SHOW FPS</div>
                <Switch checked={settings.showFps} onCheckedChange={(v) => setSettings((s) => ({ ...s, showFps: v }))} />
              </div>
            </div>
          </ScrollArea>
          <Button variant="outline" className="mt-3 self-start border-zinc-800 bg-black/60 text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen(settingsFrom === 'paused' ? 'paused' : 'title') }}>BACK</Button>
        </div>
      )}

      {/* ------------ PAUSED ------------ */}
      {screen === 'paused' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 px-4">
          <div className="text-[10px] font-bold tracking-[0.6em] text-zinc-500">SYSTEM SUSPENDED</div>
          <h2 className="mt-1 text-5xl font-black tracking-widest text-white">PAUSED</h2>
          <div className="mt-8 flex flex-col gap-3">
            <Button size="lg" className="bg-red-600 px-16 font-black tracking-[0.25em] text-white hover:bg-red-500" onClick={(e) => { e.currentTarget.blur(); gameRef.current?.resume() }}>RESUME</Button>
            <Button size="lg" variant="outline" className="border-zinc-700 bg-black/60 font-black tracking-[0.25em] text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setSettingsFrom('paused'); setScreen('settings') }}>SETTINGS</Button>
            <Button size="lg" variant="outline" className="border-zinc-800 bg-black/60 font-black tracking-[0.25em] text-zinc-500 hover:text-red-400" onClick={(e) => { e.currentTarget.blur(); gameRef.current?.quitToMenu(); setScreen('title') }}>ABORT MISSION</Button>
          </div>
        </div>
      )}

      {/* ------------ GAME OVER ------------ */}
      {screen === 'gameover' && stats && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-black/85 via-red-950/30 to-black/90 px-4">
          <div className="text-[10px] font-bold tracking-[0.6em] text-red-400">CONNECTION LOST</div>
          <h2 className="mt-1 text-center text-5xl font-black tracking-widest text-red-500 drop-shadow-[0_0_20px_rgba(255,42,74,0.4)]">YOU HAVE FALLEN</h2>

          {newUnlocks.length > 0 && (
            <div className="mt-4 border border-amber-500/60 bg-amber-950/40 px-6 py-2 text-center">
              <div className="text-[10px] font-black tracking-[0.3em] text-amber-400">NEW BLADE UNLOCKED</div>
              <div className="text-sm font-black tracking-widest text-amber-200">{newUnlocks.map((id) => SWORDS[id].name).join(' / ')}</div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-x-10 gap-y-4 sm:grid-cols-6">
            <Stat label="SCORE" value={fmt(stats.score)} accent />
            <Stat label="WAVE" value={`${stats.wave}`} />
            <Stat label="MAX COMBO" value={`${stats.maxCombo}`} />
            <Stat label="KILLS" value={`${stats.kills}`} />
            <Stat label="TIME" value={`${Math.floor(stats.timeAlive / 60)}:${String(Math.floor(stats.timeAlive % 60)).padStart(2, '0')}`} />
            <Stat label="RANK" value={stats.bestRank} accent />
          </div>

          <div className="mt-8 flex items-center gap-3">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              placeholder="OPERATIVE NAME"
              className="h-11 w-48 border-zinc-700 bg-black/70 font-mono tracking-widest text-zinc-200 placeholder:text-zinc-600"
              maxLength={16}
            />
            <Button className="h-11 bg-red-600 font-black tracking-widest text-white hover:bg-red-500" disabled={submitted} onClick={(e) => { e.currentTarget.blur(); void submitScore() }}>
              <Send className="mr-2 h-4 w-4" /> {submitted ? 'SUBMITTED' : 'SUBMIT'}
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="bg-red-600 px-12 font-black tracking-[0.25em] text-white hover:bg-red-500" onClick={(e) => { e.currentTarget.blur(); startGame(selectedSword) }}>
              <RotateCcw className="mr-2 h-4 w-4" /> RETRY
            </Button>
            <Button size="lg" variant="outline" className="border-zinc-700 bg-black/60 font-black tracking-[0.25em] text-zinc-300 hover:text-white" onClick={(e) => { e.currentTarget.blur(); setScreen('arsenal') }}>
              <Swords className="mr-2 h-4 w-4" /> ARSENAL
            </Button>
            <Button size="lg" variant="outline" className="border-zinc-800 bg-black/60 font-black tracking-[0.25em] text-zinc-500 hover:text-white" onClick={(e) => { e.currentTarget.blur(); gameRef.current?.quitToMenu(); setScreen('title') }}>
              <HomeIcon className="mr-2 h-4 w-4" /> MENU
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================================================== */

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

function TouchLayer({ input, onPause }: { input: GameInput; onPause: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label="Pause"
        className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded border border-zinc-700 bg-black/60 text-zinc-300"
        onClick={(e) => { e.currentTarget.blur(); onPause() }}
      >
        <Pause className="h-5 w-5" />
      </button>
      <Joystick input={input} />
      <div className="absolute bottom-5 right-4 z-20 grid grid-cols-3 gap-2.5">
        <TouchBtn input={input} action="parry" label="PARRY" small />
        <TouchBtn input={input} action="ability" label="SPEC" small />
        <TouchBtn input={input} action="ult" label="ULT" small />
        <TouchBtn input={input} action="light" label="SLASH" />
        <TouchBtn input={input} action="heavy" label="HEAVY" />
        <TouchBtn input={input} action="dash" label="DASH" />
        <div />
        <TouchBtn input={input} action="jump" label="JUMP" />
        <TouchBtn input={input} action="execute" label="EXEC" small />
      </div>
    </>
  )
}

function TouchBtn({ input, action, label, small }: { input: GameInput; action: Action; label: string; small?: boolean }) {
  const cls = small
    ? 'h-14 w-14 text-[9px]'
    : 'h-[4.5rem] w-[4.5rem] text-[10px]'
  return (
    <button
      type="button"
      aria-label={label}
      className={`${cls} touch-none select-none rounded-full border border-zinc-600/80 bg-black/55 font-black tracking-widest text-zinc-200 backdrop-blur-sm active:border-red-500 active:bg-red-950/70 active:text-red-200`}
      onPointerDown={(e) => { e.preventDefault(); input.setVirtual(action, true) }}
      onPointerUp={() => input.setVirtual(action, false)}
      onPointerLeave={() => input.setVirtual(action, false)}
      onPointerCancel={() => input.setVirtual(action, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )
}

function Joystick({ input }: { input: GameInput }) {
  const ref = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
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
    setKnob({ x: dx * (rect.width / 2 - 22), y: dy * (rect.height / 2 - 22) })
  }

  const release = () => {
    activeId.current = null
    input.setVirtualAxis(0, 0)
    setKnob({ x: 0, y: 0 })
  }

  return (
    <div
      ref={ref}
      className="absolute bottom-6 left-5 z-20 h-32 w-32 touch-none rounded-full border border-zinc-700/70 bg-black/40 backdrop-blur-sm"
      onPointerDown={(e) => {
        e.preventDefault()
        activeId.current = e.pointerId
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        handle(e)
      }}
      onPointerMove={(e) => {
        if (activeId.current === e.pointerId) handle(e)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-500 bg-zinc-800/90"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  )
}
