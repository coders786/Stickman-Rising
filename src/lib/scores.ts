import { z } from 'zod'
import { SWORD_ORDER } from '@/game/combat/swords'

const integer = (max: number) => z.number().int().min(0).max(max)
export const scoreSubmissionSchema = z.object({
  name: z.string().trim().max(16).regex(/^[^\x00-\x1f\x7f]*$/).transform(v => v || 'ANON').default('ANON'),
  score: integer(100_000_000),
  wave: integer(9999),
  maxCombo: integer(999_999),
  kills: integer(999_999),
  sword: z.enum(SWORD_ORDER),
})
export const scoreRowsSchema = z.array(scoreSubmissionSchema.extend({ id: z.string() })).max(15)
export type ScoreRow = z.infer<typeof scoreRowsSchema>[number]
