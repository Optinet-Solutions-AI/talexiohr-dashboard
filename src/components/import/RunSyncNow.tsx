'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2, AlertTriangle, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function RunSyncNow() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleRun() {
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/attendance/daily-sync', { method: 'POST' })
      const data = await res.json()
      setResult(data)
      if (!res.ok) setError(data.error ?? 'Sync failed')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Run Daily Sync Now</h2>
        <p className="text-xs text-slate-600 mt-0.5">
          Manually triggers the daily cron — pulls yesterday&apos;s clockings + leave.
          Use this to test that the cron logic works without waiting for 23:00 UTC.
        </p>
      </div>
      <div className="p-4 space-y-3">
        <button onClick={handleRun} disabled={loading}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          Run Daily Sync Now
        </button>

        {result && (
          <div className={`rounded-md p-3 ${(result as Record<string, unknown>).ok ? 'bg-indigo-50' : 'bg-red-50'}`}>
            <p className={`text-xs font-medium ${(result as Record<string, unknown>).ok ? 'text-indigo-700' : 'text-red-700'}`}>
              {(result as Record<string, unknown>).ok ? <CheckCircle2 size={12} className="inline mr-1" /> : <AlertTriangle size={12} className="inline mr-1" />}
              {(result as Record<string, unknown>).ok ? 'Sync complete' : 'Sync failed'}
            </p>
            <pre className="text-[10px] text-slate-700 bg-white/50 rounded p-2 mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
        {error && !result && (
          <div className="rounded-md bg-red-50 p-3">
            <p className="text-xs text-red-600"><AlertTriangle size={12} className="inline mr-1" />{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
