import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Vercel cron endpoint — pulls yesterday's clockings + leave from Talexio.
 *
 * Scheduled at 23:00 UTC daily = 1:00 AM CEST (summer) / 00:00 CET (winter)
 * which is 1 hour after the Malta day ends.
 *
 * "Yesterday" is computed in CET/CEST so we always pull the day that just ended
 * in Malta local time, regardless of when the cron fires in UTC.
 */
export async function GET(req: Request) {
  // Verify it's actually a Vercel cron (optional: check the user-agent or a CRON_SECRET)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Compute "yesterday" in Malta time (CET/CEST). Malta is UTC+1 winter / UTC+2 summer.
  // We get today's date in Europe/Malta timezone, then subtract 1 day.
  const nowMalta = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Malta' })
  const yesterday = new Date(nowMalta + 'T00:00:00')
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().slice(0, 10)

  try {
    // Internal POST to the pull endpoint (no Bearer token → uses env API token)
    const host = req.headers.get('host') ?? 'localhost:3000'
    const protocol = host.includes('localhost') ? 'http' : 'https'
    const pullUrl = `${protocol}://${host}/api/import/pull`

    const res = await fetch(pullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom: dateStr, dateTo: dateStr }),
    })
    const data = await res.json()

    return NextResponse.json({
      ok: res.ok,
      syncedDate: dateStr,
      result: data,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[daily-sync]', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Daily sync failed',
      syncedDate: dateStr,
    }, { status: 500 })
  }
}
