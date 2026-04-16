'use client'

import { useState } from 'react'
import { Download, Loader2, CheckCircle2, AlertTriangle, Wifi, Key } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function TalexioPull() {
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [token, setToken] = useState('')
  const [step, setStep] = useState<'idle' | 'testing' | 'pulling' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<{ fetched: number; saved: number; employees: number; message?: string } | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleTest() {
    if (!token.trim()) { setError('Paste your Bearer token first'); setStep('error'); return }
    setStep('testing')
    setError('')
    setProgress('Testing connection...')
    try {
      const res = await fetch(`/api/import/test-talexio?date=${dateFrom}&token=${encodeURIComponent(token.trim())}`)
      const data = await res.json()

      if (data.hasErrors) {
        setError(`API error: ${data.errors?.[0]?.message || 'Unknown'}`)
        setStep('error')
        return
      }

      if (data.queryOk) {
        setProgress('')
        setStep('idle')
        alert(`Connection OK!\n\nTime logs for ${dateFrom}: ${data.totalCount}\nToken expires: ${data.tokenExpiry || 'unknown'}\n\nSample: ${data.sampleLogs.map((l: { employee?: { fullName: string } }) => l.employee?.fullName).join(', ') || '(no logs for this date)'}`)
      } else {
        setError(data.error || 'Query returned no data')
        setStep('error')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed')
      setStep('error')
    }
  }

  async function handlePull() {
    if (!token.trim()) { setError('Paste your Bearer token first'); setStep('error'); return }
    setStep('pulling')
    setError('')
    setResult(null)
    setProgress('Triggering export → Waiting for Talexio to process → Downloading...')
    try {
      const res = await fetch('/api/import/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo, token: token.trim() }),
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
        <p className="text-xs text-slate-500 mt-0.5">
          Paste your Bearer token from Talexio, pick a date range, and pull clockings directly. Token lasts ~2 hours.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {/* Token input */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
            <Key size={11} /> Bearer Token
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Paste token from DevTools → Network → Authorization header"
              className="flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono"
            />
          </div>
          <p className="text-[10px] text-slate-500">
            Login at <a href="https://roosterpartners.talexiohr.com/login" target="_blank" rel="noopener" className="text-indigo-600 hover:underline">roosterpartners.talexiohr.com</a> → Open DevTools (F12) → Network tab → Click any <code className="bg-slate-100 px-1 rounded">graphql</code> request → Copy the <code className="bg-slate-100 px-1 rounded">authorization</code> header value (without "Bearer " prefix)
          </p>
        </div>

        {/* Date pickers + buttons */}
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
          <button onClick={handlePull} disabled={step === 'pulling' || step === 'testing' || !token.trim()}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
            {step === 'pulling' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Pull Time Logs
          </button>
          <button onClick={handleTest} disabled={step === 'pulling' || step === 'testing' || !token.trim()}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
            {step === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
            Test
          </button>
        </div>

        {/* Progress */}
        {(step === 'pulling' || step === 'testing') && progress && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 size={13} className="animate-spin shrink-0" /> {progress}
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
              <span>{result.fetched} rows fetched</span>
              <span>{result.saved} records saved</span>
              <span>{result.employees} employees</span>
            </div>
          </div>
        )}

        {/* Error */}
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
