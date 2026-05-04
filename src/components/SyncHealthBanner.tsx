import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTokenStatus } from '@/lib/talexio/token-store'

/**
 * Server-rendered banner that surfaces Talexio sync health to the user. Shown
 * across every dashboard page so token expiry doesn't go unnoticed.
 *
 * Triggers when:
 *   • Token is missing, expired, or expires in <24h
 *   • Last cron-triggered sync_log entry was an error
 */
export default async function SyncHealthBanner() {
  const supabase = createAdminClient()

  const [tokenStatus, lastCron] = await Promise.all([
    getTokenStatus(),
    supabase.from('sync_log')
      .select('sync_date, status, error, source, created_at')
      .eq('source', 'cron')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const tokenExpiringSoon =
    tokenStatus.state === 'valid' &&
    tokenStatus.minutesRemaining != null &&
    tokenStatus.minutesRemaining < 60 * 24

  const cronFailed = lastCron.data?.status === 'error'

  const issues: { kind: string; message: string }[] = []

  if (tokenStatus.state === 'missing') {
    issues.push({ kind: 'token', message: 'Talexio token is not configured. The daily sync cannot run.' })
  } else if (tokenStatus.state === 'expired') {
    issues.push({ kind: 'token', message: 'Talexio token has expired. Paste a fresh one to resume daily syncs.' })
  } else if (tokenExpiringSoon) {
    const hours = Math.max(0, Math.floor((tokenStatus.minutesRemaining ?? 0) / 60))
    issues.push({ kind: 'token-soon', message: `Talexio token expires in ${hours}h. Replace it before the next cron run.` })
  }

  if (cronFailed && lastCron.data) {
    const when = new Date(lastCron.data.created_at).toLocaleString()
    issues.push({ kind: 'cron', message: `Last automated sync (${when}) failed: ${lastCron.data.error ?? 'unknown error'}` })
  }

  if (issues.length === 0) return null

  const isWarning = issues.every(i => i.kind === 'token-soon')

  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 ${isWarning ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-300'}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${isWarning ? 'text-amber-600' : 'text-red-600'}`} />
        <div className="flex-1 space-y-1">
          <p className={`text-sm font-medium ${isWarning ? 'text-amber-900' : 'text-red-900'}`}>
            Talexio sync needs attention
          </p>
          <ul className={`text-xs space-y-0.5 ${isWarning ? 'text-amber-800' : 'text-red-800'}`}>
            {issues.map((issue, i) => <li key={i}>• {issue.message}</li>)}
          </ul>
          <Link href="/dashboard/import"
            className={`inline-block mt-1 text-xs font-medium underline ${isWarning ? 'text-amber-900 hover:text-amber-700' : 'text-red-900 hover:text-red-700'}`}>
            Open Import page →
          </Link>
        </div>
      </div>
    </div>
  )
}
