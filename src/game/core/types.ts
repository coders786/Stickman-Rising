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

export type GamePhase = 'attract' | 'preparing' | 'playing' | 'paused' | 'gameover'

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra'
/** Legacy save slot. Procedural run art does not change saved progress. */
export type LevelId = 'rooftop'

export interface RunStats {
  score: number
  kills: number
  maxCombo: number
  /** Legacy leaderboard field; normal runs store the sector here. */
  wave: number
  distanceMetres?: number
  timeAlive: number
  bestRank: string
}

export interface GameSettings {
  quality: QualityLevel
  /** Scale scene resolution under measured load, without changing preset detail. */
  adaptiveQuality: boolean
  /** Kept in the settings schema for compatibility; not a preview selector. */
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
  // SSR/headless fallback; the browser loads its saved or detected preset.
  quality: 'low',
  adaptiveQuality: false,
  level: 'rooftop',
  shake: true,
  shakeIntensity: 1,
  sfxVolume: 0.8,
  musicVolume: 0.55,
  muted: false,
  showFps: false,
  gore: 'energy',
}

/** Events the Game emits to the React layer (discrete, never per-frame). */
export type RunPreparationStage = 'opening' | 'renderer' | 'background' | 'lighting' | 'frame' | 'settling' | 'surface'

export type GameEvent =
  | { type: 'runPreparing'; stage: RunPreparationStage; presented: boolean }
  | { type: 'runRevealing'; id: number }
  | { type: 'runUnavailable' }
  | { type: 'error' }
  | { type: 'runStarted' }
  | { type: 'gameover'; stats: RunStats }
  | { type: 'wave'; wave: number; boss: boolean }
  | { type: 'unlock'; swordId: string }
  | { type: 'rank'; rank: string }
  | { type: 'bossSpawn' }
  | { type: 'quality'; active: QualityLevel; scale: number }
  | { type: 'actions'; overdrive: boolean; service: boolean; execute: boolean }
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
  platformAt?(x: number): import('../stage/route').Platform | null
  enemyTravel?(from: number, to: number): number
  projectileBlocked?(from: number, to: number): boolean
  isSheltered?(x: number): boolean
  wetFootfall?(x: number, y: number, strength: number, vx: number, landing?: boolean): void
  bridgeWind?(x: number, simTime: number): number
  quality: QualityLevel
  gore: 'energy' | 'blood'
  /** live combo state (read-only): PAVE escalation reads the live hit count
   * so variation intensity tracks combat heat. Optional so lightweight test
   * worlds can omit it (players must read it defensively). */
  combo?: { hits: number }
  /** Resolve contact once; callers use the outcome rather than assuming a hit. */
  hitEnemy(enemyId: number, blade: { bx: number; by: number; tx: number; ty: number }, atk: import('../combat/attacks').AttackRuntimeInfo): import('../combat/hit-resolution').HitResolution
  /** OPTIONAL: the same blade sweep is also offered to destructible stage
   *  props. Optional so lightweight test worlds need no prop system. */
  strikeProps?: (blade: { bx: number; by: number; tx: number; ty: number }, atk: import('../combat/attacks').AttackRuntimeInfo, px: number) => void
  /** Enemy attack / projectile is about to damage the player. Returns true if parried. */
  enemyStrikePlayer(dmg: number, dir: number, heavy: boolean, sourceX: number): boolean
  spawnProjectile(p: import('../entities/projectiles').ProjectileSpawn): void
  addHitstop(t: number, zoomPulse?: number): void
  addSlowmo(scale: number, t: number): void
  screenFlash(color: string, alpha: number, t: number): void
  onEnemyKilled(enemy: import('../entities/enemy').Enemy): void
}
