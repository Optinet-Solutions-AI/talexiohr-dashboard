'use client'

import { useState } from 'react'
import { Download, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function TalexioPull() {
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [step, setStep] = useState<'idle' | 'testing' | 'pulling' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ fetched: number; saved: number; employees: number; message?: string } | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleTest() {
    setStep('testing')
    setError('')
    try {
      const res = await fetch(`/api/import/test-talexio?date=${dateFrom}`)
      const data = await res.json()
      if (data.hasErrors || data.rawError) {
        setError(`API error: ${data.errors?.[0]?.message || data.rawError || 'Unknown error'}`)
        setStep('error')
      } else if (data.hasData) {
        setError('')
        setStep('idle')
        alert(`API is working. Found ${data.totalCount} time log(s) for ${dateFrom}.\n\nSample: ${data.sampleLogs.map((l: { employee?: { fullName: string } }) => l.employee?.fullName).join(', ') || '(none)'}`)
      } else {
        setError('API returned no data and no error — check your credentials')
        setStep('error')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed')
      setStep('error')
    }
  }

  async function handlePull() {
    setStep('pulling')
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/import/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      setStep('done')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pull failed')
      setStep('error')
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Pull from Talexio API</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Select a date range (CET/CEST) and pull time logs directly from Talexio. Existing records for the same employee+date will be overwritten.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Date pickers */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          <button
            onClick={handlePull}
            disabled={step === 'pulling' || step === 'testing'}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {step === 'pulling' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Pull Time Logs
          </button>

          <button
            onClick={handleTest}
            disabled={step === 'pulling' || step === 'testing'}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {step === 'testing' ? <Loader2 size={13} className="animate-spin" /> : null}
            Test Connection
          </button>
        </div>

        {/* Pulling */}
        {step === 'pulling' && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Pulling from Talexio for {dateFrom}{dateFrom !== dateTo ? ` → ${dateTo}` : ''}...
          </div>
        )}

        {/* Done */}
        {step === 'done' && result && (
          <div className="rounded-md bg-indigo-50 p-3">
            <p className="text-xs font-medium text-indigo-700">
              <CheckCircle2 size={12} className="inline mr-1" />
              {result.message || 'Pull complete'}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-indigo-600 mt-1">
              <span>{result.fetched} logs fetched</span>
              <span>{result.saved} records saved</span>
              <span>{result.employees} employees</span>
            </div>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="rounded-md bg-red-50 p-3">
            <p className="text-xs text-red-600">
              <AlertTriangle size={12} className="inline mr-1" />
              {error}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
