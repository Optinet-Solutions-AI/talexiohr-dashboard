'use client'

import { useState } from 'react'
import { Users, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function Dedupe() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const router = useRouter()

  async function handleDedupe() {
    setLoading(true); setError(''); setResult(null); setConfirming(false)
    try {
      const res = await fetch('/api/employees/dedupe', { method: 'POST' })
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
        <h2 className="text-sm font-semibold text-slate-800">Merge Duplicate Employees</h2>
        <p className="text-xs text-slate-600 mt-0.5">
          Finds employees with the same name, keeps the one with a Talexio ID, and reassigns all attendance records to it. Use this if CSV + API imports created duplicates.
        </p>
      </div>
      <div className="p-4 space-y-3">
        {!confirming ? (
          <button onClick={() => setConfirming(true)} disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">
            <Users size={14} /> Find & Merge Duplicates
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Merge duplicate employees?</span>
            <button onClick={handleDedupe} disabled={loading}
              className="flex items-center gap-1 rounded-md bg-red-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-red-700 disabled:opacity-50">
              {loading ? <Loader2 size={12} className="animate-spin" /> : 'Yes, merge'}
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        )}

        {result && (
          <div className="rounded-md bg-indigo-50 p-3">
            <p className="text-xs font-medium text-indigo-700"><CheckCircle2 size={12} className="inline mr-1" />Done</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-indigo-600 mt-1">
              <span>{String(result.merged)} duplicate groups merged</span>
              <span>{String(result.deleted)} employees deleted</span>
              <span>{String(result.recordsReassigned)} records reassigned</span>
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
