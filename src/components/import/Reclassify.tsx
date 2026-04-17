'use client'

import { useState } from 'react'
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function Reclassify() {
  const [dateFrom, setDateFrom] = useState('2026-04-01')
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleReclassify() {
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/import/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Reclassify Existing Data</h2>
        <p className="text-xs text-slate-600 mt-0.5">
          Re-applies status logic to existing records using employee group. Malta Office employees not at office → WFH. Also generates "No Clocking" records for missing workdays.
        </p>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>
          <button onClick={handleReclassify} disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Reclassify
          </button>
        </div>

        {result && (
          <div className="rounded-md bg-indigo-50 p-3">
            <p className="text-xs font-medium text-indigo-700"><CheckCircle2 size={12} className="inline mr-1" />Done</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-indigo-600 mt-1">
              <span>{String(result.reclassified)} reclassified</span>
              <span>{String(result.unchanged)} unchanged</span>
              <span>{String(result.noClockingGenerated)} no-clocking generated</span>
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 p-3">
            <p className="text-xs text-red-600"><AlertTriangle size={12} className="inline mr-1" />{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
