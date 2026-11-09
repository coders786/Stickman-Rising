import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { scoreSubmissionSchema } from '@/lib/scores'
import { checkScoreRateLimit } from '@/lib/score-rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const rows = await getDb().score.findMany({
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      take: 15,
    })
    return NextResponse.json(rows)
  } catch (error) {
    console.error('Failed to load leaderboard', error)
    return NextResponse.json({ error: 'Leaderboard is temporarily unavailable' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const limit = await checkScoreRateLimit(req.headers)
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many score submissions. Please try again later.' }, {
        status: 429, headers: { 'Retry-After': String(limit.retryAfter) },
      })
    }
  } catch (error) {
    console.error('Score rate limit unavailable', error)
    return NextResponse.json({ error: 'Score submissions are temporarily unavailable' }, { status: 503 })
  }
  const key = req.headers.get('idempotency-key')
  if (key !== null && !z.uuid().safeParse(key).success) {
    return NextResponse.json({ error: 'Invalid Idempotency-Key' }, { status: 400 })
  }
  const contentType = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 })
  }
  let body: unknown
  try {
    // Bound actual streamed bytes, not just the untrusted Content-Length header.
    const reader = req.body?.getReader()
    if (!reader) return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 })
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 4096) {
          await reader.cancel()
          return NextResponse.json({ error: 'Request body is too large' }, { status: 413 })
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const result = scoreSubmissionSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid score data', details: result.error.flatten().fieldErrors }, { status: 400 })
  }
  try {
    const row = key
      ? await getDb().score.upsert({ where: { id: key }, create: { id: key, ...result.data }, update: {} })
      : await getDb().score.create({ data: result.data })
    if (key && (Object.keys(result.data) as (keyof typeof result.data)[]).some(field => row[field] !== result.data[field])) {
      return NextResponse.json({ error: 'Idempotency-Key was already used with different score data' }, { status: 409 })
    }
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    console.error('Failed to save score', error)
    return NextResponse.json({ error: 'Score could not be saved. Please try again.' }, { status: 503 })
  }
}
