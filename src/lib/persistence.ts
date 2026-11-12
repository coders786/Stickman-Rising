import { z } from 'zod'
import { SWORD_ORDER } from '@/game/combat/swords'
import { DEFAULT_SETTINGS, type GameSettings } from '@/game/core/types'

export const SAVE_KEY = 'sr_save_v1'
export const SETTINGS_KEY = 'sr_settings_v1'
export const NAME_KEY = 'sr_name_v1'
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).catch(0)
const saveSchema = z.object({
  totalKills: counter,
  best: counter,
  unlocked: z.array(z.enum(SWORD_ORDER)).catch(['katana']),
})
export type SaveData = z.infer<typeof saveSchema>
export function parseSave(raw: string | null): SaveData {
  try {
    const parsed = saveSchema.parse(JSON.parse(raw ?? '{}'))
    return { ...parsed, unlocked: [...new Set(['katana' as const, ...parsed.unlocked])] }
  } catch {
    return { totalKills: 0, best: 0, unlocked: ['katana'] }
  }
}
export function parseSettings(raw: string | null, coarse = false): GameSettings {
  const defaults: GameSettings = { ...DEFAULT_SETTINGS, quality: coarse ? 'medium' : 'high' }
  const unit = (fallback: number) => z.number().min(0).max(1).catch(fallback)
  const schema = z.object({
    quality: z.enum(['low', 'medium', 'high', 'ultra']).catch(defaults.quality),
    level: z.enum(['rooftop', 'zen-night']).catch(defaults.level),
    shake: z.boolean().catch(defaults.shake),
    shakeIntensity: z.number().min(0.2).max(1.5).catch(defaults.shakeIntensity),
    sfxVolume: unit(defaults.sfxVolume),
    musicVolume: unit(defaults.musicVolume),
    muted: z.boolean().catch(defaults.muted),
    showFps: z.boolean().catch(defaults.showFps),
    gore: z.enum(['energy', 'blood']).catch(defaults.gore),
  })
  try { return schema.parse(JSON.parse(raw ?? '{}')) } catch { return defaults }
}
export function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
export function writeStorage(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true } catch { return false }
}
