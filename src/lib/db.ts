import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@/generated/prisma/client'

/** Resolve DATABASE_URL (file:…) to an absolute SQLite path. */
function resolveSqliteUrl(): string {
  const raw = process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0
    ? process.env.DATABASE_URL
    : 'file:db/custom.db'
  if (!raw.startsWith('file:') || raw === 'file:') throw new Error('DATABASE_URL must be a non-empty SQLite file URL')
  const file = raw.slice(5)
  const abs = path.isAbsolute(file) ? file : path.resolve(/* turbopackIgnore: true */ process.cwd(), file)
  mkdirSync(/* turbopackIgnore: true */ path.dirname(abs), { recursive: true })
  return 'file:' + abs
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: resolveSqliteUrl() })
  return new PrismaClient({
    adapter,
    log: ['warn', 'error'],
  })
}

/** Initialize inside request handlers so configuration/driver failures are caught. */
export function getDb(): PrismaClient {
  return globalForPrisma.prisma ??= createPrismaClient()
}
