/** STICKMAN RISING — the scoreboard store.
 *
 * ROOT-CAUSE NOTE: this module once imported a generated Prisma client — a
 * build-time artifact that nothing in the repo produced during install or
 * dev. The module graph failed to resolve and every route that touched the
 * database died with "Module not found: Can't resolve
 * '@/generated/prisma/client'", including a clean `next build`. Prisma has
 * since been removed entirely.
 *
 * The leaderboard needs exactly two tables. Node ships SQLite (`node:sqlite`,
 * synchronous, zero install, zero codegen), so the store is now self-
 * contained: the schema is created on first use, there is no generated
 * client to go stale, and no native module to rebuild per Node version.
 *
 * Table and column names are unchanged, so an existing `db/custom.db`
 * written by the old adapter keeps working.
 */
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/** What a client may submit (mirrors `scoreSubmissionSchema`). */
export interface ScoreInput {
  name: string
  score: number
  wave: number
  maxCombo: number
  kills: number
  sword: string
}

/** What comes back out — the submission plus its identity and timestamp. */
export interface ScoreRow extends ScoreInput {
  id: string
  createdAt: string
}

/** Result of an idempotent submission. `inserted: false` means the key was
 * already used and `row` is the ORIGINAL record. */
export interface UpsertResult {
  row: ScoreRow
  inserted: boolean
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS "Score" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "name"      TEXT NOT NULL,
  "score"     INTEGER NOT NULL,
  "wave"      INTEGER NOT NULL,
  "maxCombo"  INTEGER NOT NULL,
  "kills"     INTEGER NOT NULL,
  "sword"     TEXT NOT NULL,
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "Score_leaderboard_idx" ON "Score" ("score" DESC, "createdAt" ASC);
CREATE TABLE IF NOT EXISTS "ScoreRateLimit" (
  "key"       TEXT PRIMARY KEY NOT NULL,
  "count"     INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL
);
`

/** Resolve DATABASE_URL (file:…) to an absolute SQLite path. */
export function resolveDatabasePath(rawUrl = process.env.DATABASE_URL): string {
  const raw = rawUrl && rawUrl.length > 0 ? rawUrl : 'file:db/custom.db'
  if (!raw.startsWith('file:') || raw === 'file:') {
    throw new Error('DATABASE_URL must be a non-empty SQLite file URL')
  }
  const file = raw.slice(5)
  const abs = path.isAbsolute(file) ? file : path.resolve(/* turbopackIgnore: true */ process.cwd(), file)
  mkdirSync(/* turbopackIgnore: true */ path.dirname(abs), { recursive: true })
  return abs
}

/** Collision-resistant id: time-ordered prefix + randomness. */
function newId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

export interface ScoreStore {
  /** Leaderboard rows, best first (ties broken by who got there first). */
  topScores(limit?: number): ScoreRow[]
  /** One row by id, or null. */
  findScore(id: string): ScoreRow | null
  /** Insert a new submission under a server-generated id. */
  insertScore(input: ScoreInput): ScoreRow
  /** Idempotent create: a repeated key returns the ORIGINAL row instead of
   * inserting a duplicate. */
  upsertScore(id: string, input: ScoreInput): UpsertResult
  /** Drop expired rate-limit counters. */
  pruneRateLimit(nowSeconds: number): void
  /** Atomically count one hit against `key` in the current window and
   * return the new total. */
  bumpRateLimit(key: string, expiresAt: number, nowSeconds: number): number
  /** Raw SQL mutation, for diagnostics and tests. Never pass user input. */
  exec(sql: string): void
  /** Raw SQL read, for diagnostics and tests. Never pass user input. */
  query<T = Record<string, unknown>>(sql: string): T[]
  /** Close the handle (tests / graceful shutdown). */
  close(): void
}

/** Open (and migrate) a scoreboard at `filePath`. Exported for tests and
 * for callers that want an isolated store. */
export function createScoreStore(filePath: string): ScoreStore {
  const db = new DatabaseSync(filePath)
  // WAL keeps readers from blocking the request that writes a score;
  // `busy_timeout` makes concurrent workers wait instead of throwing.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA)

  const selectTop = db.prepare(
    `SELECT "id","name","score","wave","maxCombo","kills","sword","createdAt"
       FROM "Score" ORDER BY "score" DESC, "createdAt" ASC LIMIT ?`,
  )
  const selectOne = db.prepare(
    `SELECT "id","name","score","wave","maxCombo","kills","sword","createdAt"
       FROM "Score" WHERE "id" = ?`,
  )
  const insertOne = db.prepare(
    `INSERT INTO "Score" ("id","name","score","wave","maxCombo","kills","sword","createdAt")
     VALUES (?,?,?,?,?,?,?,?)`,
  )
  const pruneLimit = db.prepare('DELETE FROM "ScoreRateLimit" WHERE "expiresAt" <= ?')
  const bumpLimit = db.prepare(
    `INSERT INTO "ScoreRateLimit" ("key","count","expiresAt") VALUES (?, 1, ?)
     ON CONFLICT("key") DO UPDATE SET
       "count"     = CASE WHEN "expiresAt" <= ? THEN 1 ELSE "count" + 1 END,
       "expiresAt" = CASE WHEN "expiresAt" <= ? THEN ? ELSE "expiresAt" END
     RETURNING "count"`,
  )

  // node:sqlite returns null-prototype objects; hand out plain records.
  const shape = (row: unknown): ScoreRow => ({ ...(row as ScoreRow) })

  const store: ScoreStore = {
    topScores(limit = 15) {
      const take = Math.max(1, Math.min(100, Math.floor(limit)))
      return (selectTop.all(take) as unknown as ScoreRow[]).map(shape)
    },
    findScore(id) {
      const row = selectOne.get(id) as unknown as ScoreRow | undefined
      return row ? shape(row) : null
    },
    insertScore(input) {
      const row: ScoreRow = { id: newId(), ...input, createdAt: new Date().toISOString() }
      insertOne.run(row.id, row.name, row.score, row.wave, row.maxCombo, row.kills, row.sword, row.createdAt)
      return row
    },
    upsertScore(id, input) {
      const existing = store.findScore(id)
      if (existing) return { row: existing, inserted: false }
      const row: ScoreRow = { id, ...input, createdAt: new Date().toISOString() }
      insertOne.run(row.id, row.name, row.score, row.wave, row.maxCombo, row.kills, row.sword, row.createdAt)
      return { row, inserted: true }
    },
    pruneRateLimit(nowSeconds) {
      pruneLimit.run(nowSeconds)
    },
    bumpRateLimit(key, expiresAt, nowSeconds) {
      const row = bumpLimit.get(key, expiresAt, nowSeconds, nowSeconds, expiresAt) as { count: number | bigint } | undefined
      return Number(row?.count ?? 1)
    },
    exec(sql) {
      db.exec(sql)
    },
    query<T>(sql: string) {
      return db.prepare(sql).all() as unknown as T[]
    },
    close() {
      db.close()
    },
  }
  return store
}

const globalForDb = globalThis as unknown as { scoreStore?: ScoreStore }

/** Lazily open the shared store on first request, so configuration or driver
 * failures surface inside the handler (and are answered with a 503) instead
 * of at module-evaluation time during the build. */
export function getDb(): ScoreStore {
  return (globalForDb.scoreStore ??= createScoreStore(resolveDatabasePath()))
}

/** Close and forget the shared store (tests, graceful shutdown). */
export function closeDb(): void {
  globalForDb.scoreStore?.close()
  globalForDb.scoreStore = undefined
}
