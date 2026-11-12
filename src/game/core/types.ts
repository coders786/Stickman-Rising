/** STICKMAN RISING — shared core types */

export interface Vec2 {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Facing = 1 | -1

export type GamePhase = 'attract' | 'playing' | 'paused' | 'gameover'

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra'
export type LevelId = 'rooftop' | 'zen-night'

export interface RunStats {
  score: number
  kills: number
  maxCombo: number
  wave: number
  timeAlive: number
  bestRank: string
}

export interface GameSettings {
  quality: QualityLevel
  /** Stage choice is independent from rendering fidelity. */
  level: LevelId
  shake: boolean
  shakeIntensity: number
  sfxVolume: number
  musicVolume: number
  muted: boolean
  showFps: boolean
  gore: 'energy' | 'blood'
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high',
  level: 'zen-night',
  shake: true,
  shakeIntensity: 1,
  sfxVolume: 0.8,
  musicVolume: 0.55,
  muted: false,
  showFps: false,
  gore: 'energy',
}

/** Events the Game emits to the React layer (discrete, never per-frame). */
export type GameEvent =
  | { type: 'error' }
  | { type: 'gameover'; stats: RunStats }
  | { type: 'wave'; wave: number; boss: boolean }
  | { type: 'unlock'; swordId: string }
  | { type: 'rank'; rank: string }
  | { type: 'bossSpawn' }
  | { type: 'phase'; phase: GamePhase }

/** The slice of the world that combat entities are allowed to touch. */
export interface WorldRef {
  fx: import('../fx/fx').FX
  audio: import('../audio/audio').AudioEngine
  cam: import('./camera').Camera
  input: import('./input').Input
  enemies: import('../entities/enemy').Enemy[]
  projectiles: import('../entities/projectiles').ProjectilePool
  time: number
  timeScale: number
  arenaMinX: number
  arenaMaxX: number
  quality: QualityLevel
  gore: 'energy' | 'blood'
  /** live combo state (read-only): PAVE escalation reads the live hit count
   * so variation intensity tracks combat heat. Optional so lightweight test
   * worlds can omit it (players must read it defensively). */
  combo?: { hits: number }
  /** Resolve contact once; callers use the outcome rather than assuming a hit. */
  hitEnemy(enemyId: number, blade: { bx: number; by: number; tx: number; ty: number }, atk: import('../combat/attacks').AttackRuntimeInfo): import('../combat/hit-resolution').HitResolution
  /** Enemy attack / projectile is about to damage the player. Returns true if parried. */
  enemyStrikePlayer(dmg: number, dir: number, heavy: boolean, sourceX: number): boolean
  spawnProjectile(p: import('../entities/projectiles').ProjectileSpawn): void
  addHitstop(t: number, zoomPulse?: number): void
  addSlowmo(scale: number, t: number): void
  screenFlash(color: string, alpha: number, t: number): void
  onEnemyKilled(enemy: import('../entities/enemy').Enemy): void
}
