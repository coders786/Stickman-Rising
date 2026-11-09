import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { scoreSubmissionSchema } from '../src/lib/scores'
import { getDb } from '../src/lib/db'
import { GET, POST } from '../src/app/api/scores/route'
import { checkScoreRateLimit, scoreClientKey, CLIENT_SCORE_LIMIT, GLOBAL_SCORE_LIMIT } from '../src/lib/score-rate-limit'

const directory = mkdtempSync(path.join(tmpdir(), 'sr-scores-'))
const previousUrl = process.env.DATABASE_URL
const valid = { name: ' PLAYER ', score: 100, wave: 2, maxCombo: 3, kills: 4, sword: 'katana' }
const request = (body: unknown) => new NextRequest('http://localhost/api/scores', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
before(async () => {
  process.env.DATABASE_URL = `file:${directory}/nested/scores.db`
  await getDb().$executeRawUnsafe(`CREATE TABLE Score (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL,
    wave INTEGER NOT NULL, maxCombo INTEGER NOT NULL, kills INTEGER NOT NULL,
    sword TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
})
after(async () => {
  await getDb().$disconnect()
  if (previousUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousUrl
  rmSync(directory, { recursive: true, force: true })
})
test('score validation rejects coercion, overflow, fractions and invalid swords', () => {
  for (const body of [null, [], {}, { ...valid, score: '10' }, { ...valid, score: -1 }, { ...valid, score: Infinity }, { ...valid, kills: 1.5 }, { ...valid, sword: 'invalid' }, { ...valid, name: 'bad\u0000name' }, { ...valid, name: 'x'.repeat(17) }]) {
    assert.equal(scoreSubmissionSchema.safeParse(body).success, false)
  }
  assert.equal(scoreSubmissionSchema.parse({ ...valid, name: '' }).name, 'ANON')
})
test('POST distinguishes invalid JSON, invalid scores, unsupported types and oversized bodies', async () => {
  for (const body of [null, [], {}, { ...valid, score: -1 }]) assert.equal((await POST(request(body))).status, 400)
  assert.equal((await POST(new NextRequest('http://localhost/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status, 400)
  assert.equal((await POST(new NextRequest('http://localhost/api/scores', { method: 'POST', body: '{}' }))).status, 415)
  assert.equal((await POST(request({ ...valid, name: 'x'.repeat(5000) }))).status, 413)
})
test('scores persist to SQLite and leaderboard is ordered and limited', async () => {
  await getDb().score.deleteMany()
  for (let i = 0; i < 17; i++) {
    const response = await POST(request({ ...valid, score: i }))
    assert.equal(response.status, 201)
    assert.equal((await response.json()).name, 'PLAYER')
  }
  const response = await GET()
  assert.equal(response.status, 200)
  const rows = await response.json()
  assert.equal(rows.length, 15)
  assert.equal(rows[0].score, 16)
  assert.equal(rows[14].score, 2)
})
test('retrying with the same idempotency key does not duplicate a score', async () => {
  const key = crypto.randomUUID()
  const send = () => POST(new NextRequest('http://localhost/api/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(valid),
  }))
  assert.equal((await send()).status, 201)
  assert.equal((await send()).status, 201)
  assert.equal(await getDb().score.count({ where: { id: key } }), 1)
})

test('an idempotency key cannot silently accept a different score payload', async () => {
  const key = crypto.randomUUID()
  const send = (body: unknown) => POST(new NextRequest('http://localhost/api/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
  }))
  assert.equal((await send(valid)).status, 201)
  assert.equal((await send({ ...valid, name: 'OTHER' })).status, 409)
  assert.equal((await send(valid)).status, 201)
})

test('rate limit is durable, atomic, and ignores untrusted client IP headers', async () => {
  const old = process.env.SCORES_TRUSTED_IP_HEADER
  delete process.env.SCORES_TRUSTED_IP_HEADER
  const headers = new Headers({ 'x-real-ip': '192.0.2.1' })
  assert.equal(scoreClientKey(headers), null)
  try {
    await getDb().$executeRawUnsafe('DELETE FROM ScoreRateLimit')
    const now = 1_800_000_000_000
    const results = await Promise.all(Array.from({ length: GLOBAL_SCORE_LIMIT + 5 }, () => checkScoreRateLimit(headers, now)))
    assert.equal(results.filter(x => x.allowed).length, GLOBAL_SCORE_LIMIT)
    assert.equal(results.filter(x => !x.allowed).length, 5)
    assert.equal((await checkScoreRateLimit(headers, now + 60_000)).allowed, true)
    process.env.SCORES_TRUSTED_IP_HEADER = 'x-real-ip'
    assert.ok(scoreClientKey(headers)?.startsWith('ip:'))
    assert.equal(scoreClientKey(new Headers({ 'x-real-ip': '192.0.2.1, 203.0.113.2' })), null)
    const later = now + 120_000
    for (let i = 0; i < CLIENT_SCORE_LIMIT; i++) assert.equal((await checkScoreRateLimit(headers, later)).allowed, true)
    assert.equal((await checkScoreRateLimit(headers, later)).allowed, false)
    assert.equal((await checkScoreRateLimit(new Headers({ 'x-real-ip': '192.0.2.2' }), later)).allowed, true)
    const stored = await getDb().$queryRawUnsafe<{ key: string }[]>('SELECT key FROM ScoreRateLimit')
    assert.ok(stored.every(row => !row.key.includes('192.0.2.')))
  } finally {
    if (old === undefined) delete process.env.SCORES_TRUSTED_IP_HEADER
    else process.env.SCORES_TRUSTED_IP_HEADER = old
    await getDb().$executeRawUnsafe('DELETE FROM ScoreRateLimit')
  }
})

test('POST returns 429 and Retry-After after the shared limit is reached', async () => {
  await getDb().$executeRawUnsafe('DELETE FROM ScoreRateLimit')
  const clock = mock.method(Date, 'now', () => 1_800_000_000_000)
  try {
    for (let i = 0; i < GLOBAL_SCORE_LIMIT; i++) await checkScoreRateLimit(new Headers())
    const response = await POST(request(valid))
    assert.equal(response.status, 429)
    assert.ok(Number(response.headers.get('retry-after')) > 0)
  } finally {
    clock.mock.restore()
    await getDb().$executeRawUnsafe('DELETE FROM ScoreRateLimit')
  }
})

test('database failures return 503 rather than empty successes or internal details', async () => {
  const log = mock.method(console, 'error', () => {})
  try {
    await getDb().$executeRawUnsafe('DROP TABLE Score')
    const response = await GET()
    assert.equal(response.status, 503)
    const body = JSON.stringify(await response.json())
    assert.equal(body.includes('Score'), false)
    assert.equal(body.includes(directory), false)
    assert.equal((await POST(request(valid))).status, 503)
  } finally { log.mock.restore() }
})
