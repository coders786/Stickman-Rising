import path from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@/generated/prisma/client'

/** Resolve DATABASE_URL (file:…) to an absolute SQLite path. */
function resolveSqliteUrl(): string {
  const raw = process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0
    ? process.env.DATABASE_URL
    : 'file:db/custom.db'
  const file = raw.replace(/^file:/, '')
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)
  return 'file:' + abs
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: resolveSqliteUrl() })
  return new PrismaClient({
    adapter,
    log: ['query', 'warn', 'error'],
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
