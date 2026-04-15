import { NextRequest, NextResponse } from 'next/server'
import { syncDateRange } from '@/lib/attendance/sync'
import { format, subDays, eachDayOfInterval, parseISO } from 'date-fns'

// POST /api/attendance/backfill
// Body: { "from": "2026-04-01", "to": "2026-04-14" }
// Syncs each day individually so errors on one day don't block others
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const from = (body.from as string) ?? '2026-04-01'
    const to   = (body.to   as string) ?? format(subDays(new Date(), 1), 'yyyy-MM-dd')

    const days = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) })
    const results: Record<string, unknown>[] = []

    for (const day of days) {
      const date = format(day, 'yyyy-MM-dd')
      try {
        const result = await syncDateRange(date, date)
        results.push({ date, ...result })
      } catch (err) {
        results.push({ date, error: err instanceof Error ? err.message : 'failed' })
      }
    }

    return NextResponse.json({ ok: true, days: days.length, results })
  } catch (err) {
    console.error('[attendance/backfill]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Backfill failed' },
      { status: 500 },
    )
  }
}
