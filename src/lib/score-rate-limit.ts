import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { getDb } from '@/lib/db'

const WINDOW_SECONDS = 60
// A global ceiling applies even without a trusted proxy or client address.
export const GLOBAL_SCORE_LIMIT = 120
export const CLIENT_SCORE_LIMIT = 20

/** Only trust a client IP header if the operator has explicitly configured a
 * proxy that overwrites that header and prevents direct access to this server. */
export function scoreClientKey(headers: Headers): string | null {
  const header = process.env.SCORES_TRUSTED_IP_HEADER?.trim().toLowerCase()
  if (!header || !/^[a-z0-9-]+$/.test(header)) return null
  const address = headers.get(header)?.trim()
  // Reject lists such as X-Forwarded-For: their trust depends on proxy topology.
  if (!address || !isIP(address)) return null
  return 'ip:' + createHash('sha256').update(address).digest('hex')
}

/** SQLite counters are shared across workers using the same database and
 * survive restarts. Each increment is atomic; expired entries are removed. */
export async function checkScoreRateLimit(headers: Headers, now = Date.now()): Promise<{ allowed: boolean; retryAfter: number }> {
  const db = getDb()
  const seconds = Math.floor(now / 1000)
  const expiresAt = (Math.floor(seconds / WINDOW_SECONDS) + 1) * WINDOW_SECONDS
  await db.$executeRaw`CREATE TABLE IF NOT EXISTS ScoreRateLimit (key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expiresAt INTEGER NOT NULL)`
  await db.$executeRaw`DELETE FROM ScoreRateLimit WHERE expiresAt <= ${seconds}`

  async function increment(key: string): Promise<number> {
    const rows = await db.$queryRaw<{ count: number | bigint }[]>`
      INSERT INTO ScoreRateLimit (key, count, expiresAt) VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN expiresAt <= ${seconds} THEN 1 ELSE count + 1 END,
        expiresAt = CASE WHEN expiresAt <= ${seconds} THEN ${expiresAt} ELSE expiresAt END
      RETURNING count`
    return Number(rows[0].count)
  }

  const retryAfter = Math.max(1, expiresAt - seconds)
  const global = await increment('global')
  if (global > GLOBAL_SCORE_LIMIT) return { allowed: false, retryAfter }
  const client = scoreClientKey(headers)
  const clientCount = client ? await increment(client) : 0
  return { allowed: clientCount <= CLIENT_SCORE_LIMIT, retryAfter }
}
