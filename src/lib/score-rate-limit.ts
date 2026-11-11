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
 * survive restarts. Each increment is atomic (single upsert); expired
 * entries are pruned on the way through. */
export async function checkScoreRateLimit(headers: Headers, now = Date.now()): Promise<{ allowed: boolean; retryAfter: number }> {
  const db = getDb()
  const seconds = Math.floor(now / 1000)
  const expiresAt = (Math.floor(seconds / WINDOW_SECONDS) + 1) * WINDOW_SECONDS
  db.pruneRateLimit(seconds)

  const increment = (key: string): number => db.bumpRateLimit(key, expiresAt, seconds)

  const retryAfter = Math.max(1, expiresAt - seconds)
  const global = increment('global')
  if (global > GLOBAL_SCORE_LIMIT) return { allowed: false, retryAfter }
  const client = scoreClientKey(headers)
  const clientCount = client ? increment(client) : 0
  return { allowed: clientCount <= CLIENT_SCORE_LIMIT, retryAfter }
}
