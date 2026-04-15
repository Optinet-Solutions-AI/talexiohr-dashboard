'use client'

import { useRef, useState } from 'react'
import { Upload, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function CsvImport() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const router = useRouter()

  async function handleFile(file: File) {
    setState('loading')
    setMessage('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/attendance/import-csv', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      setState('success')
      setMessage(`Imported ${data.saved} records from ${data.parsed} rows`)
      router.refresh()
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={state === 'loading'}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {state === 'loading' ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Upload size={15} />
        )}
        Import CSV
      </button>

      {state === 'success' && (
        <span className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 size={13} /> {message}
        </span>
      )}
      {state === 'error' && (
        <span className="flex items-center gap-1 text-xs text-red-500">
          <XCircle size={13} /> {message}
        </span>
      )}
    </div>
  )
}
