'use client'

import { useState } from 'react'
import { Trash2, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function Cleanup() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const router = useRouter()

  async function handleCleanup() {
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/cleanup', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      setConfirming(false)
      setConfirmText('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-white rounded-lg border border-red-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-red-100 bg-red-50">
        <h2 className="text-sm font-semibold text-red-800">Clean Slate (Destructive)</h2>
        <p className="text-xs text-red-700 mt-0.5">
          Wipes <strong>all attendance records</strong> and syncs employee Talexio IDs from the API.
          Employees, groups, and exclusions are preserved. Use this once to reset before
          setting up daily syncs.
        </p>
      </div>
      <div className="p-4 space-y-3">
        {!confirming ? (
          <button onClick={() => setConfirming(true)} disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-red-300 px-4 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50">
            <Trash2 size={14} /> Clean Slate
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-red-700 font-medium">
              This will permanently delete ALL attendance records. Type <code className="bg-red-100 px-1 rounded">RESET</code> to confirm:
            </p>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="Type RESET"
                className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400 font-mono"
              />
              <button onClick={handleCleanup} disabled={loading || confirmText !== 'RESET'}
                className="flex items-center gap-1 rounded-md bg-red-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                {loading ? <Loader2 size={12} className="animate-spin" /> : 'Confirm'}
              </button>
              <button onClick={() => { setConfirming(false); setConfirmText('') }}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-md bg-indigo-50 p-3 space-y-1">
            <p className="text-xs font-medium text-indigo-700"><CheckCircle2 size={12} className="inline mr-1" />Clean slate complete</p>
            <div className="text-[11px] text-indigo-700 space-y-0.5">
              <p>Attendance records deleted: <strong>{String((result as Record<string, unknown>).attendanceRecordsDeleted)}</strong></p>
              <p>Talexio employees fetched: <strong>{String((result as Record<string, unknown>).talexioEmployeeCount)}</strong></p>
              {(() => {
                const e = (result as Record<string, unknown>).employees as Record<string, unknown>
                return (
                  <>
                    <p>Local employees: {String(e.total)} · matched: {String(e.matched)} · IDs updated: {String(e.idUpdated)} · already correct: {String(e.alreadyCorrect)}</p>
                    {(e.unmatchedCount as number) > 0 && (
                      <div className="mt-1 p-1.5 rounded bg-amber-50 text-amber-800">
                        <p className="font-medium">{String(e.unmatchedCount)} unmatched (name mismatch):</p>
                        <p className="text-[10px]">{(e.unmatched as string[]).join(', ')}{(e.unmatchedCount as number) > 20 ? '...' : ''}</p>
                        <p className="text-[10px] mt-1">These won&apos;t receive new clockings until you fix their names or delete them.</p>
                      </div>
                    )}
                  </>
                )
              })()}
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
