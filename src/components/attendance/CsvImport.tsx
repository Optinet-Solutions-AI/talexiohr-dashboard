'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function CsvImport() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const router = useRouter()

  async function handleFile(file: File) {
    setState('loading'); setMessage('')
    try {
      const form = new FormData(); form.append('file', file)
      const res = await fetch('/api/attendance/import-csv', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      setState('success'); setMessage(`${data.saved} records imported`)
      router.refresh()
    } catch (err) {
      setState('error'); setMessage(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={state === 'loading'}
        className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        {state === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        Import CSV
      </button>
      {state === 'success' && <span className="text-[11px] text-slate-500">{message}</span>}
      {state === 'error' && <span className="text-[11px] text-slate-500">{message}</span>}
    </div>
  )
}
