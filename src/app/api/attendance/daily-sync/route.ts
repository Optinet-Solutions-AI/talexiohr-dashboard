import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Daily sync endpoint. Called by:
 *   1. Vercel cron at 23:00 UTC (with Authorization: Bearer ${CRON_SECRET})
 *   2. Manual UI button on Import page (no auth required)
 *
 * Pulls yesterday's clockings + leave from Talexio for the Malta-local day
 * that just ended.
 */
export async function GET(req: Request) {
  return await runSync(req)
}

export async function POST(req: Request) {
  return await runSync(req)
}

async function runSync(req: Request) {
  const supabase = createAdminClient()
  const startedAt = new Date().toISOString()

  // CRON_SECRET check: only required when set in env. Vercel cron sends this
  // header automatically. Manual UI calls (no header) are always allowed.
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const isVercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
  if (isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    await supabase.from('sync_log').insert({
      sync_date: new Date().toISOString().slice(0, 10),
      source: 'cron', status: 'error', error: 'Unauthorized cron request',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Compute "yesterday" in Malta-local time
  const nowMalta = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Malta' })
  const yesterday = new Date(nowMalta + 'T00:00:00')
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().slice(0, 10)

  // Build the URL using VERCEL_URL (the actual deployment URL) when available,
  // otherwise fall back to host header.
  const vercelUrl = process.env.VERCEL_URL
  const host = vercelUrl ?? req.headers.get('host') ?? 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const pullUrl = `${protocol}://${host}/api/import/pull`

  try {
    const res = await fetch(pullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom: dateStr, dateTo: dateStr }),
    })
    const data = await res.json()

    // Log this run for visibility
    await supabase.from('sync_log').insert({
      sync_date: dateStr,
      source: isVercelCron ? 'cron' : 'manual',
      records: data?.clockings?.saved ?? 0,
      status: res.ok ? 'success' : 'error',
      error: res.ok ? null : (data?.error ?? 'unknown'),
    })

    return NextResponse.json({
      ok: res.ok,
      trigger: isVercelCron ? 'cron' : 'manual',
      pullUrl,
      syncedDate: dateStr,
      result: data,
      startedAt,
      finishedAt: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Daily sync failed'
    await supabase.from('sync_log').insert({
      sync_date: dateStr,
      source: isVercelCron ? 'cron' : 'manual',
      records: 0,
      status: 'error',
      error: message,
    })
    return NextResponse.json({
      error: message, syncedDate: dateStr, pullUrl,
    }, { status: 500 })
  }
}
