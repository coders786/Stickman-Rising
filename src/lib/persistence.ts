import { SWORD_ORDER, type SwordId } from '@/game/combat/swords'
import { DEFAULT_SETTINGS, type GameSettings, type QualityLevel } from '@/game/core/types'

export const SAVE_KEY = 'sr_save_v1'
export const SETTINGS_KEY = 'sr_settings_v1'
export const NAME_KEY = 'sr_name_v1'

export interface SaveData { totalKills: number; best: number; unlocked: SwordId[] }

// Local records need only a few field checks. Keep the API schema library on
// the leaderboard path instead of downloading it to start the game.
function record(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* corrupt JSON */ }
  return {}
}

const swordIds = new Set<unknown>(SWORD_ORDER)
const counter = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0

export function parseSave(raw: string | null): SaveData {
  const { totalKills, best, unlocked } = record(raw)
  // Like the old schema, discard a malformed list rather than salvage an
  // arbitrary subset. A valid list retains its order after de-duplication.
  const legal = Array.isArray(unlocked) && unlocked.every((id): id is SwordId => swordIds.has(id)) ? unlocked : []
  return { totalKills: counter(totalKills), best: counter(best), unlocked: [...new Set<SwordId>(['katana', ...legal])] }
}

const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback
const range = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && value >= min && value <= max ? value : fallback

export function parseSettings(raw: string | null, coarse = false, detected?: QualityLevel): GameSettings {
  const saved = record(raw)
  const start = detected ?? (coarse ? 'medium' : DEFAULT_SETTINGS.quality)
  const q = saved.quality
  const validTier = q === 'low' || q === 'medium' || q === 'high' || q === 'ultra'
  let quality = validTier ? q : start
  // Legacy releases wrote 'low' even if the player didn't choose it. Keep
  // re-detecting those records, but never override a v2 saved tier ceiling.
  if (q === 'low' && saved.qualityV !== 2 && saved.qualityV !== 3 && detected) quality = detected
  return {
    quality,
    // Fresh detection has headroom to adapt. Do not migrate a saved lock
    // or mistake an older release's implicit adaptive-on value for a choice.
    adaptiveQuality: saved.qualityV === 3 ? saved.adaptiveQuality === true : !validTier && !!detected && start !== 'low',
    level: DEFAULT_SETTINGS.level, // Legacy save field; never chooses a route.
    shake: bool(saved.shake, DEFAULT_SETTINGS.shake),
    shakeIntensity: range(saved.shakeIntensity, 0.2, 1.5, DEFAULT_SETTINGS.shakeIntensity),
    sfxVolume: range(saved.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume),
    musicVolume: range(saved.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
    muted: bool(saved.muted, DEFAULT_SETTINGS.muted),
    showFps: bool(saved.showFps, DEFAULT_SETTINGS.showFps),
    gore: saved.gore === 'energy' || saved.gore === 'blood' ? saved.gore : DEFAULT_SETTINGS.gore,
  }
}

export function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
export function writeStorage(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true } catch { return false }
}
