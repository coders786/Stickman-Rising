#!/usr/bin/env node
/**
 * OFFLINE PRISMA GENERATE
 * =======================
 * `prisma generate` normally downloads a schema-engine binary from
 * binaries.prisma.sh on first run. In a sandbox or CI runner with no outbound
 * access to that host, generation fails even though everything it needs is
 * already on disk: Prisma ships the schema engine as WebAssembly inside the
 * CLI (`prisma/build/schema_engine_bg.wasm`), and setting
 * PRISMA_SCHEMA_ENGINE_BINARY to it makes `generate` complete locally.
 *
 * This wrapper falls back to that bundled WASM. It is a no-op when a real
 * engine binary is configured or downloadable, so it is safe to always use:
 *
 *   npm run db:generate
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

function bundledWasmEngine() {
  // Resolve the installed prisma CLI, then read its sibling wasm engine.
  for (const candidate of ['prisma/build/schema_engine_bg.wasm', '../prisma/build/schema_engine_bg.wasm']) {
    try {
      const resolved = require.resolve(candidate)
      if (existsSync(resolved)) return resolved
    } catch {
      // not resolvable from here; try the next candidate
    }
  }
  try {
    const cliDir = path.dirname(require.resolve('prisma/build/index.js'))
    const wasm = path.join(cliDir, 'schema_engine_bg.wasm')
    if (existsSync(wasm)) return wasm
  } catch {
    // prisma CLI not installed
  }
  return null
}

const args = ['prisma', 'generate', ...process.argv.slice(2)]

// Respect an operator-provided engine binary.
if (!process.env.PRISMA_SCHEMA_ENGINE_BINARY) {
  const wasm = bundledWasmEngine()
  if (wasm) {
    process.env.PRISMA_SCHEMA_ENGINE_BINARY = wasm
    console.log(`[db:generate] using Prisma's bundled WASM schema engine: ${path.relative(process.cwd(), wasm)}`)
  } else {
    console.warn('[db:generate] no bundled WASM schema engine found; falling back to the downloaded engine')
  }
}

const result = spawnSync('npx', args, { stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)
