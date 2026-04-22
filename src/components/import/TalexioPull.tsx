'use client'

import { useState } from 'react'
import { Download, Loader2, CheckCircle2, AlertTriangle, Wifi } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function TalexioPull() {
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [step, setStep] = useState<'idle' | 'testing' | 'pulling' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleTest() {
    setStep('testing')
    setError('')
    setProgress('Testing connection...')
    try {
      const res = await fetch(`/api/import/test-apitoken?date=${dateFrom}`)
      const data = await res.json()
      if (data.error) { setError(data.error); setStep('error'); return }
      setProgress('')
      setResult(data)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed')
      setStep('error')
    }
  }

  async function handlePull() {
    setStep('pulling')
    setError('')
    setResult(null)
    setProgress('Fetching clockings and leave from Talexio...')
    try {
      const res = await fetch('/api/import/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      setProgress('')
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
        <p className="text-xs text-slate-600 mt-0.5">
          Pick a date range (max 14 days) and pull clockings + leave directly from Talexio. Uses the persistent API token configured in environment variables.
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
          <button onClick={handlePull} disabled={step === 'pulling' || step === 'testing'}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
            {step === 'pulling' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Pull Time Logs
          </button>
          <button onClick={handleTest} disabled={step === 'pulling' || step === 'testing'}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
            {step === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
            Test
          </button>
        </div>

        {(step === 'pulling' || step === 'testing') && progress && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Loader2 size={13} className="animate-spin shrink-0" /> {progress}
          </div>
        )}

        {step === 'done' && result && (
          <div className="rounded-md bg-indigo-50 p-3 space-y-2">
            <p className="text-xs font-medium text-indigo-700">
              <CheckCircle2 size={12} className="inline mr-1" />
              {(result as Record<string, unknown>).ok ? 'Pull complete' : 'Response'}
            </p>
            <pre className="text-[10px] text-indigo-700 bg-indigo-100/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
              {JSON.stringify(result, null, 2)}
            </pre>
            <button onClick={() => { setStep('idle'); setResult(null) }} className="text-xs text-indigo-600 hover:underline">Dismiss</button>
          </div>
        )}

        {step === 'error' && (
          <div className="rounded-md bg-red-50 p-3 space-y-2">
            <p className="text-xs text-red-600">
              <AlertTriangle size={12} className="inline mr-1" /> {error}
            </p>
            <button onClick={() => { setStep('idle'); setError('') }} className="text-xs text-red-500 hover:text-red-700 underline">Dismiss</button>
          </div>
        )}
      </div>
    </div>
  )
}
