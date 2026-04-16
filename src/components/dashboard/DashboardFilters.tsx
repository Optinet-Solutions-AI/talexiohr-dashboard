'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'

const PERIODS = [
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly',  label: 'Yearly'  },
] as const

interface Employee { id: string; full_name: string }

export default function DashboardFilters({
  employees,
  defaults,
}: {
  employees: Employee[]
  defaults: { from: string; to: string; period: string; employee: string }
}) {
  const router = useRouter()
  const params = useSearchParams()

  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [period, setPeriod] = useState(defaults.period)
  const [empId, setEmpId] = useState(defaults.employee)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function apply(overrides: Partial<typeof defaults> = {}) {
    const p = new URLSearchParams()
    const f = overrides.from ?? from
    const t = overrides.to ?? to
    const pr = overrides.period ?? period
    const e = overrides.employee ?? empId
    p.set('from', f)
    p.set('to', t)
    p.set('period', pr)
    if (e) p.set('employee', e)
    router.push(`/dashboard?${p.toString()}`)
  }

  const selectedName = employees.find(e => e.id === empId)?.full_name

  const filtered = search
    ? employees.filter(e => e.full_name.toLowerCase().includes(search.toLowerCase()))
    : employees

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-end gap-3">
        {/* Date from */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">From</label>
          <input
            type="date"
            value={from}
            onChange={e => { setFrom(e.target.value); apply({ from: e.target.value }) }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Date to */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">To</label>
          <input
            type="date"
            value={to}
            onChange={e => { setTo(e.target.value); apply({ to: e.target.value }) }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Period toggle */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">View</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPeriod(p.value); apply({ period: p.value }) }}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  period === p.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Employee search */}
        <div className="flex flex-col gap-1 relative" ref={wrapperRef}>
          <label className="text-xs font-medium text-gray-500">Employee</label>
          <div className="relative">
            <div
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 cursor-pointer min-w-[200px] focus-within:ring-2 focus-within:ring-blue-500"
              onClick={() => setOpen(true)}
            >
              <Search size={14} className="text-gray-400 shrink-0" />
              {open ? (
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="flex-1 outline-none text-sm bg-transparent"
                />
              ) : (
                <span className={`flex-1 truncate ${selectedName ? 'text-gray-900' : 'text-gray-400'}`}>
                  {selectedName ?? 'All employees'}
                </span>
              )}
              {empId && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setEmpId('')
                    setSearch('')
                    apply({ employee: '' })
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {open && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-lg z-50 max-h-60 overflow-y-auto">
                <button
                  onClick={() => { setEmpId(''); setSearch(''); setOpen(false); apply({ employee: '' }) }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${!empId ? 'font-medium text-blue-600' : 'text-gray-600'}`}
                >
                  All employees
                </button>
                {filtered.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => { setEmpId(emp.id); setSearch(''); setOpen(false); apply({ employee: emp.id }) }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${empId === emp.id ? 'font-medium text-blue-600' : 'text-gray-700'}`}
                  >
                    {emp.full_name}
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
