'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

type FileType = 'clockings' | 'leave'

interface PreviewData {
  type: string
  totalRows: number
  uniqueRecords?: number
  approvedRows?: number
  skippedRows?: number
  dateRange: { from: string; to: string } | null
  employeeCount: number
  newRecords: number
  conflicts: number
  conflictDetails: { employee: string; date: string; existingStatus?: string; leaveType?: string }[]
  newDetails: { employee: string; date: string; leaveType?: string }[]
  vacationCount?: number
  sickCount?: number
}

interface ConfirmResult {
  ok: boolean
  saved: number
  updated?: number
  skipped: number
  employees: number
}

export default function ImportUpload({ type, title, description }: { type: FileType; title: string; description: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<'idle' | 'previewing' | 'preview' | 'confirming' | 'done' | 'error'>('idle')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [result, setResult] = useState<ConfirmResult | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'skip' | 'overwrite'>('skip')
  const router = useRouter()

  async function handleFile(f: File) {
    setFile(f)
    setStep('previewing')
    setError('')
    try {
      const form = new FormData()
      form.append('file', f)
      form.append('type', type)
      const res = await fetch('/api/import/preview', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPreview(data)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
      setStep('error')
    }
  }

  async function handleConfirm() {
    if (!file) return
    setStep('confirming')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('type', type)
      form.append('mode', mode)
      const res = await fetch('/api/import/confirm', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      setStep('done')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('error')
    }
  }

  function reset() {
    setFile(null); setStep('idle'); setPreview(null); setResult(null); setError(''); setMode('skip')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>

      <div className="p-4">
        {/* Idle: file picker */}
        {step === 'idle' && (
          <div>
            <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <button onClick={() => inputRef.current?.click()}
              className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-4 py-6 w-full text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors justify-center">
              <Upload size={18} />
              Choose CSV file
            </button>
          </div>
        )}

        {/* Previewing spinner */}
        {step === 'previewing' && (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Analyzing {file?.name}...
          </div>
        )}

        {/* Preview results */}
        {step === 'preview' && preview && (
          <div className="space-y-4">
            {/* File summary */}
            <div className="rounded-md bg-slate-50 p-3 space-y-1">
              <p className="text-xs font-medium text-slate-700">{file?.name}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>{preview.totalRows} rows parsed</span>
                {preview.uniqueRecords && <span>{preview.uniqueRecords} unique records</span>}
                {preview.approvedRows != null && <span>{preview.approvedRows} approved</span>}
                {preview.dateRange && <span>{preview.dateRange.from} → {preview.dateRange.to}</span>}
                <span>{preview.employeeCount} employees</span>
                {preview.vacationCount != null && <span>{preview.vacationCount} vacation, {preview.sickCount} sick</span>}
              </div>
            </div>

            {/* New records */}
            <div className="rounded-md bg-indigo-50 p-3">
              <p className="text-xs font-medium text-indigo-700">
                <CheckCircle2 size={12} className="inline mr-1" />
                {preview.newRecords} new records will be added
              </p>
              {preview.newDetails.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {preview.newDetails.map((r, i) => (
                        <tr key={i} className="border-b border-indigo-100 last:border-0">
                          <td className="py-1 text-indigo-700">{r.employee}</td>
                          <td className="py-1 text-indigo-600">{r.date}</td>
                          {r.leaveType && <td className="py-1 text-indigo-500">{r.leaveType}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.newRecords > 20 && <p className="text-[10px] text-indigo-400 mt-1">...and {preview.newRecords - 20} more</p>}
                </div>
              )}
            </div>

            {/* Conflicts */}
            {preview.conflicts > 0 && (
              <div className="rounded-md bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-700">
                  <AlertTriangle size={12} className="inline mr-1" />
                  {preview.conflicts} records already exist in the database
                </p>
                <div className="mt-2 max-h-40 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-amber-600">
                        <th className="text-left py-1 font-medium">Employee</th>
                        <th className="text-left py-1 font-medium">Date</th>
                        <th className="text-left py-1 font-medium">Current Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.conflictDetails.map((r, i) => (
                        <tr key={i} className="border-b border-amber-100 last:border-0">
                          <td className="py-1 text-amber-700">{r.employee}</td>
                          <td className="py-1 text-amber-600">{r.date}</td>
                          <td className="py-1 text-amber-500">{r.existingStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.conflicts > 50 && <p className="text-[10px] text-amber-400 mt-1">...and {preview.conflicts - 50} more</p>}
                </div>

                {/* Conflict resolution */}
                <div className="mt-3 flex gap-3">
                  <label className={`flex items-center gap-1.5 text-xs cursor-pointer rounded-md px-3 py-1.5 border ${mode === 'skip' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>
                    <input type="radio" name={`mode-${type}`} checked={mode === 'skip'} onChange={() => setMode('skip')} className="hidden" />
                    Skip existing
                  </label>
                  <label className={`flex items-center gap-1.5 text-xs cursor-pointer rounded-md px-3 py-1.5 border ${mode === 'overwrite' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}>
                    <input type="radio" name={`mode-${type}`} checked={mode === 'overwrite'} onChange={() => setMode('overwrite')} className="hidden" />
                    Overwrite existing
                  </label>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleConfirm}
                className="rounded-md bg-indigo-600 text-white px-4 py-2 text-xs font-medium hover:bg-indigo-700 transition-colors">
                Confirm Import
              </button>
              <button onClick={reset} className="rounded-md border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Confirming */}
        {step === 'confirming' && (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Importing...
          </div>
        )}

        {/* Done */}
        {step === 'done' && result && (
          <div className="space-y-3">
            <div className="rounded-md bg-indigo-50 p-3">
              <p className="text-xs font-medium text-indigo-700">
                <CheckCircle2 size={12} className="inline mr-1" /> Import complete
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-indigo-600 mt-1">
                <span>{result.saved} saved</span>
                {result.updated != null && result.updated > 0 && <span>{result.updated} updated</span>}
                {result.skipped > 0 && <span>{result.skipped} skipped</span>}
                <span>{result.employees} employees</span>
              </div>
            </div>
            <button onClick={reset} className="rounded-md border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">
              Import another file
            </button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="space-y-3">
            <div className="rounded-md bg-red-50 p-3">
              <p className="text-xs text-red-600">{error}</p>
            </div>
            <button onClick={reset} className="rounded-md border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
