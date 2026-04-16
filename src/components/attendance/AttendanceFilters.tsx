'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'office',      label: 'Office' },
  { value: 'wfh',         label: 'WFH' },
  { value: 'remote',      label: 'Remote' },
  { value: 'no_clocking', label: 'No Clocking' },
  { value: 'vacation',    label: 'Leave' },
  { value: 'active',      label: 'Active' },
  { value: 'broken',      label: 'Broken' },
]

interface Props { employees: { id: string; full_name: string }[] }

export default function AttendanceFilters({ employees }: Props) {
  const router = useRouter()
  const params = useSearchParams()

  const update = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value); else next.delete(key)
    next.delete('page')
    router.push(`?${next.toString()}`)
  }, [params, router])

  const inputClass = 'rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-full sm:w-auto'

  return (
    <div className="flex flex-col sm:flex-row flex-wrap gap-2">
      <input type="date" defaultValue={params.get('from') ?? ''} onChange={e => update('from', e.target.value)} className={inputClass} />
      <input type="date" defaultValue={params.get('to') ?? ''} onChange={e => update('to', e.target.value)} className={inputClass} />
      <select defaultValue={params.get('employee') ?? ''} onChange={e => update('employee', e.target.value)} className={inputClass}>
        <option value="">All Employees</option>
        {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
      </select>
      <select defaultValue={params.get('status') ?? ''} onChange={e => update('status', e.target.value)} className={inputClass}>
        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </div>
  )
}
