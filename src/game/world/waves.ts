/** STICKMAN RISING — wave director: escalating horde composition, boss waves,
 * intermission banners, drop-pod spawn scheduling.
 */

import { EnemyKind } from '../entities/enemy'
import { rand, randInt } from '../core/utils'

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
const ARENA_MIN = -80
const ARENA_MAX = 2620

export class WaveDirector {
  wave = 0
  phase: 'intermission' | 'active' = 'intermission'
  private phaseT = 2.2
  private queue: QueuedSpawn[] = []
  private time = 0
  private cb: WaveCallbacks

  constructor(cb: WaveCallbacks) {
    this.cb = cb
  }

  reset(): void {
    this.wave = 0
    this.phase = 'intermission'
    this.phaseT = 2.2
    this.queue.length = 0
    this.time = 0
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
      const escorts = 2 + Math.floor(w / BOSS_INTERVAL)
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
      while (budget > 0) {
        const [kind, cost] = pool[randInt(0, pool.length - 1)]
        if (cost > budget && list.length > 3) break
        list.push(kind)
        budget -= cost
      }
      // hard cap alive
      if (list.length > 30) list.length = 30
    }

    // stagger spawn times, spread positions
    let t = boss ? 1.6 : 0.6
    for (const kind of list) {
      let x: number
      let tries = 0
      do {
        x = rand(ARENA_MIN + 120, ARENA_MAX - 120)
        tries++
      } while (Math.abs(x - px) < 240 && tries < 8)
      this.queue.push({ kind, x, at: t, waveScale })
      t += kind === 'boss' ? 1.2 : rand(0.28, 0.6)
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
