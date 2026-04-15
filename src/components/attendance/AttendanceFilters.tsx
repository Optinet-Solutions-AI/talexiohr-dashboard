'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { Search, Filter } from 'lucide-react'

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'office',      label: 'Office' },
  { value: 'wfh',         label: 'WFH' },
  { value: 'remote',      label: 'Remote' },
  { value: 'no_clocking', label: 'No Clocking' },
  { value: 'vacation',    label: 'Vacation' },
  { value: 'active',      label: 'Active' },
  { value: 'broken',      label: 'Broken' },
]

interface Props {
  employees: { id: string; full_name: string }[]
}

export default function AttendanceFilters({ employees }: Props) {
  const router = useRouter()
  const params = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (value) {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      // Reset to page 1 on filter change
      next.delete('page')
      router.push(`?${next.toString()}`)
    },
    [params, router],
  )

  return (
    <div className="flex flex-wrap gap-3">
      {/* Date From */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">From</label>
        <input
          type="date"
          defaultValue={params.get('from') ?? '2026-04-01'}
          onChange={e => update('from', e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Date To */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">To</label>
        <input
          type="date"
          defaultValue={params.get('to') ?? new Date().toISOString().split('T')[0]}
          onChange={e => update('to', e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Employee */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">Employee</label>
        <select
          defaultValue={params.get('employee') ?? ''}
          onChange={e => update('employee', e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All Employees</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.full_name}</option>
          ))}
        </select>
      </div>

      {/* Status */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">Status</label>
        <select
          defaultValue={params.get('status') ?? ''}
          onChange={e => update('status', e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          {STATUSES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
