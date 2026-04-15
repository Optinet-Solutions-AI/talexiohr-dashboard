import { NextRequest, NextResponse } from 'next/server'
import { syncDateRange } from '@/lib/attendance/sync'
import { format, subDays } from 'date-fns'

// Called by Vercel cron daily at 23:59 CET (21:59 UTC in summer / 22:59 UTC in winter)
// Also callable manually: POST /api/attendance/sync  { "date": "2026-04-15" }
export async function POST(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const date = (body.date as string) ?? format(subDays(new Date(), 1), 'yyyy-MM-dd')

    const result = await syncDateRange(date, date)
    return NextResponse.json({ ok: true, date, ...result })
  } catch (err) {
    console.error('[attendance/sync]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    )
  }
}

// Allow GET for easy browser testing (still requires secret)
export async function GET(req: NextRequest) {
  return POST(req)
}
