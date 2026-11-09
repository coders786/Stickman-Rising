import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { scoreSubmissionSchema } from '../src/lib/scores'
import { getDb } from '../src/lib/db'
import { GET, POST } from '../src/app/api/scores/route'

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
