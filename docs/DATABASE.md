# Database & Prisma setup

The leaderboard is the only part of the app that touches a database. It is a
single SQLite file driven by Prisma through the `better-sqlite3` driver adapter.

```
src/lib/db.ts            getDb() singleton, resolves DATABASE_URL → absolute path
prisma/schema.prisma     models: User, Post, Score, ScoreRateLimit
src/app/api/scores      GET (top 15) / POST (validated, rate limited, idempotent)
src/lib/score-rate-limit durable, atomic counters in SQLite
```

## Normal setup (has network access)

```bash
npm install
npm run db:generate      # generates src/generated/prisma
npm run db:push          # creates the tables
npm run dev
```

`src/generated/` and `db/*.db` are gitignored — a fresh clone must generate and
push before the leaderboard works. The game itself does not need either.

## Setup without network access

Two things normally reach the internet. Both have local fallbacks, and the
default npm scripts now use them automatically.

### 1. `prisma generate`

`generate` downloads a schema-engine binary from `binaries.prisma.sh` on first
run. Prisma also ships that engine as WebAssembly inside its own CLI at
`node_modules/prisma/build/schema_engine_bg.wasm`. Pointing
`PRISMA_SCHEMA_ENGINE_BINARY` at that file makes generation complete offline.

`scripts/prisma-generate-offline.mjs` does this, and is what `npm run db:generate`
runs. It respects a real engine if one is already configured, so it is safe
everywhere. Use `npm run db:generate:online` to call the CLI directly.

```
✔ Generated Prisma Client (7.10.1) to ./src/generated/prisma
```

### 2. `prisma db push`

`db push` needs a real schema-engine *executable*: it tries to spawn the
engine, and the `.wasm` cannot be spawned (`EACCES`). With no engine binary
available, `scripts/prisma-push-local.mjs` applies the same DDL through
`better-sqlite3`, parsing the models out of `schema.prisma` (`npm run db:push:local`).

This is a dev/bootstrap fallback, **not** a replacement for Prisma Migrate. If
you have the engine, use `npm run db:push`.

### 3. `better-sqlite3` native build

`better-sqlite3` needs a compiled addon. Prebuilt binaries are normally fetched
during install; if the install ran with `--ignore-scripts` or the download host
is blocked, build it against the system Node headers:

```bash
cd node_modules/better-sqlite3
npx node-gyp rebuild --nodedir=/usr/local
```

Verify with `node -e "require('better-sqlite3')"`. Without the addon, both the
adapter and the `db:push:local` fallback fail — this is the one step with no
pure-JS escape hatch.

## Verifying

```bash
npx tsx --test tests/scores.test.ts     # 8/8: persistence, idempotency, rate limits, failure modes
curl -s localhost:3000/api/scores        # [] on a fresh database
curl -s -X POST localhost:3000/api/scores \
  -H 'Content-Type: application/json' \
  -d '{"name":"TEST","score":100,"wave":2,"maxCombo":3,"kills":4,"sword":"katana"}'
```

A `503` from either endpoint means `getDb()` threw — almost always a missing
generated client or an unbuilt `better-sqlite3` addon.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `file:db/custom.db` | SQLite path; may be relative or absolute |
| `SCORES_TRUSTED_IP_HEADER` | *(unset)* | Only set behind a proxy that overwrites this header. Unset ⇒ per-client limiting is off and only the global ceiling applies |
