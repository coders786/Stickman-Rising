/** STICKMAN RISING — wave director: escalating horde composition, boss waves,
 * intermission banners, drop-pod spawn scheduling.
 */

import { EnemyKind } from '../entities/enemy'
import { FLAT_LANE } from '../stage/flat-lane'

export interface WaveCallbacks {
  spawnEnemy(kind: EnemyKind, x: number, waveScale: number): void
  onWaveStart(wave: number, boss: boolean): void
  onWaveClear(wave: number): void
  getPlayerX(): number
}

interface QueuedSpawn {
  kind: EnemyKind
  x: number
  at: number
  waveScale: number
}

const BOSS_INTERVAL = 5
const MAX_WAVE_ENEMIES = 30
export const WAVE_SPAWN_SEARCH_LIMIT = 8

export class WaveDirector {
  wave = 0
  phase: 'intermission' | 'active' = 'intermission'
  private phaseT = 2.2
  private queue: QueuedSpawn[] = []
  private time = 0
  private rngState = 0x51a2c9
  private cb: WaveCallbacks

  constructor(cb: WaveCallbacks) {
    this.cb = cb
  }

  reset(seed = 0x51a2c9): void {
    this.wave = 0
    this.phase = 'intermission'
    this.phaseT = 2.2
    this.queue.length = 0
    this.time = 0
    this.rngState = Number.isFinite(seed) ? seed >>> 0 : 0x51a2c9
    this.pendingClearCheck = 999
  }

  private random(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0
    let t = this.rngState
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  private randomInt(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1))
  }

  get enemiesRemaining(): number {
    return this.queue.length
  }

  update(dt: number, enemiesAlive: number): void {
    this.time += dt
    this.phaseT -= dt

    if (this.phase === 'intermission') {
      if (this.phaseT <= 0) {
        this.startWave()
      }
      return
    }

    // active: spawn from queue
    while (this.queue.length > 0 && this.queue[0].at <= this.time) {
      const q = this.queue.shift() as QueuedSpawn
      this.cb.spawnEnemy(q.kind, q.x, q.waveScale)
    }

    if (this.queue.length === 0 && enemiesAlive === 0 && this.phaseT <= -0.6) {
      // wave cleared
      this.cb.onWaveClear(this.wave)
      this.phase = 'intermission'
      this.phaseT = 3.4
    }
  }

  private startWave(): void {
    this.wave++
    this.phase = 'active'
    this.phaseT = 0
    this.time = 0
    const w = this.wave
    const boss = w % BOSS_INTERVAL === 0
    this.cb.onWaveStart(w, boss)

    const waveScale = 1 + (w - 1) * 0.13
    const list: EnemyKind[] = []
    const px = this.cb.getPlayerX()

    if (boss) {
      list.push('boss')
      const escorts = Math.min(MAX_WAVE_ENEMIES - 1, 2 + Math.floor(w / BOSS_INTERVAL))
      for (let i = 0; i < escorts; i++) list.push(i % 2 === 0 ? 'grunt' : 'gunner')
    } else if (w === 1) {
      for (let i = 0; i < 4; i++) list.push('grunt')
    } else if (w === 2) {
      for (let i = 0; i < 4; i++) list.push('grunt')
      list.push('assassin', 'assassin')
    } else if (w === 3) {
      for (let i = 0; i < 3; i++) list.push('grunt')
      list.push('assassin', 'assassin', 'gunner', 'drone')
    } else if (w === 4) {
      for (let i = 0; i < 3; i++) list.push('grunt')
      list.push('assassin', 'assassin', 'gunner', 'heavy', 'drone', 'drone')
    } else {
      // procedural mix
      let budget = 9 + w * 2.2
      const pool: [EnemyKind, number][] = [
        ['grunt', 2], ['assassin', 2.5], ['gunner', 3], ['drone', 2.5],
        ['shield', 4], ['heavy', 5.5],
      ]
      if (w >= 7) pool.push(['elite', 9])
      while (budget > 0 && list.length < MAX_WAVE_ENEMIES) {
        const [kind, cost] = pool[this.randomInt(0, pool.length - 1)]
        if (cost > budget && list.length > 3) break
        list.push(kind)
        budget -= cost
      }
    }

    // stagger spawn times, spread positions
    let t = boss ? 1.6 : 0.6
    for (const kind of list) {
      let x: number
      let tries = 0
      do {
        x = FLAT_LANE.waveLeft + this.random() * (FLAT_LANE.waveRight - FLAT_LANE.waveLeft)
        tries++
      } while (Math.abs(x - px) < 240 && tries < WAVE_SPAWN_SEARCH_LIMIT)
      // Keep the retry loop bounded without occasionally placing an enemy
      // inside the player's 240px buffer when every seeded sample is unlucky.
      if (Math.abs(x - px) < 240) {
        const left = FLAT_LANE.waveLeft, right = FLAT_LANE.waveRight
        x = Math.abs(px - left) >= Math.abs(px - right) ? left : right
      }
      this.queue.push({ kind, x, at: t, waveScale })
      t += kind === 'boss' ? 1.2 : .28 + this.random() * .32
    }
    this.phaseT = -0.6 // marker: active until cleared (checked via <= -0.6 after spawn)
    this.pendingClearCheck = t + 1.5
  }

  private pendingClearCheck = 999

  /** called by Game to know if wave-clear check should start */
  get clearCheckReady(): boolean {
    return this.phase === 'active' && this.time >= this.pendingClearCheck
  }

  /** wave label for HUD */
  get label(): string {
    return this.phase === 'intermission' && this.wave > 0
      ? `WAVE ${this.wave + 1} INCOMING`
      : `WAVE ${this.wave}`
  }
}
