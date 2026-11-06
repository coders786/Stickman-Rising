import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rows = await db.score.findMany({
      orderBy: { score: 'desc' },
      take: 15,
    })
    return NextResponse.json(rows)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const rawName = typeof body.name === 'string' ? body.name.trim().slice(0, 16) : ''
    const name = rawName.length > 0 ? rawName : 'ANON'
    const row = await db.score.create({
      data: {
        name,
        score: clampInt(body.score, 0, 100_000_000, 0),
        wave: clampInt(body.wave, 0, 9999, 0),
        maxCombo: clampInt(body.maxCombo, 0, 999_999, 0),
        kills: clampInt(body.kills, 0, 999_999, 0),
        sword: typeof body.sword === 'string' ? body.sword.slice(0, 24) : 'katana',
      },
    })
    return NextResponse.json(row, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
  }
}
