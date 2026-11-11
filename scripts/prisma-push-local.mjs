#!/usr/bin/env node
/**
 * OFFLINE PRISMA SCHEMA PUSH
 * ==========================
 * `prisma db push` needs a real schema-engine EXECUTABLE — it cannot run the
 * bundled WASM engine (the CLI tries to spawn the .wasm and gets EACCES).
 * When no engine binary is available (no network to binaries.prisma.sh, or a
 * sandbox without it), this applies the same DDL directly through the
 * project's own SQLite driver.
 *
 * Scope: this covers the models declared in prisma/schema.prisma. It is a
 * fallback for local/dev bootstrap, not a replacement for Prisma Migrate —
 * if you have the real engine, `npm run db:push` still uses it.
 *
 *   npm run db:push:local
 */
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const root = process.cwd()

/** Resolve DATABASE_URL (file:…) exactly as src/lib/db.ts does. */
function resolveSqlitePath() {
  const raw = process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0
    ? process.env.DATABASE_URL
    : 'file:db/custom.db'
  if (!raw.startsWith('file:') || raw === 'file:') {
    throw new Error('DATABASE_URL must be a non-empty SQLite file URL')
  }
  const file = raw.slice(5)
  return path.isAbsolute(file) ? file : path.resolve(root, file)
}

const schema = readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8')

/** Map the prisma scalar types this project uses onto SQLite. */
const SQL = { String: 'TEXT', Int: 'INTEGER', Boolean: 'BOOLEAN', DateTime: 'DATETIME', Float: 'REAL' }

const models = []
for (const block of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const [, name, body] = block
  const fields = []
  const uniques = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue
    const m = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/)
    if (!m) continue
    const [, field, type, isList, optional, attrs] = m
    // relations are not columns
    if (!SQL[type]) continue
    if (isList) continue
    let col = `"${field}" ${SQL[type]}`
    if (attrs.includes('@id')) {
      col += ' PRIMARY KEY NOT NULL'
    } else if (!optional) {
      col += ' NOT NULL'
    }
    if (attrs.includes('@unique')) uniques.push(field)
    const def = attrs.match(/@default\(([^)]*)\)/)
    if (def && def[1] === 'now()') col += ' DEFAULT CURRENT_TIMESTAMP'
    else if (def && def[1] === 'false') col += ' DEFAULT false'
    else if (def && def[1] === 'true') col += ' DEFAULT true'
    else if (def && /^-?\d+(\.\d+)?$/.test(def[1])) col += ` DEFAULT ${def[1]}`
    fields.push(col)
  }
  models.push({ name, fields, uniques })
}

const file = resolveSqlitePath()
mkdirSync(path.dirname(file), { recursive: true })
const db = new Database(file)
db.pragma('journal_mode = WAL')

for (const { name, fields, uniques } of models) {
  db.exec(`CREATE TABLE IF NOT EXISTS "${name}" (\n  ${fields.join(',\n  ')}\n)`)
  for (const field of uniques) {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "${name}_${field}_key" ON "${name}"("${field}")`)
  }
  console.log(`[db:push:local] "${name}" ready`)
}

// The leaderboard's hot path sorts by score then createdAt.
db.exec('CREATE INDEX IF NOT EXISTS "Score_score_createdAt_idx" ON "Score"("score" DESC, "createdAt" ASC)')

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
console.log(`[db:push:local] ${file}`)
console.log(`[db:push:local] tables: ${tables.map(t => t.name).join(', ')}`)
db.close()
