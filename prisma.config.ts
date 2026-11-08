import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'prisma/config'

/**
 * Minimal .env loader (no external dependency).
 * Prisma 7 no longer auto-loads .env — we do it here for the CLI.
 */
function loadEnvFile(file: string) {
  try {
    const txt = fs.readFileSync(file, 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/)
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2]
      }
    }
  } catch {
    // .env is optional
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env'))

/** Resolve the SQLite file to an absolute path (works for local dev + fresh clones). */
function resolveSqliteUrl(raw: string | undefined): string {
  const url = raw && raw.length > 0 ? raw : 'file:db/custom.db'
  const file = url.replace(/^file:/, '')
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)
  return 'file:' + abs
}

const databaseUrl = resolveSqliteUrl(process.env.DATABASE_URL)

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: databaseUrl,
  },
})
