'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { Search, X, ChevronLeft, ChevronRight } from 'lucide-react'

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly'

const PERIODS: { value: Period; label: string; hint: string }[] = [
  { value: 'daily',   label: 'Day',   hint: 'Single day'       },
  { value: 'weekly',  label: 'Week',  hint: 'Mon – Sun'        },
  { value: 'monthly', label: 'Month', hint: '1st – last day'   },
  { value: 'yearly',  label: 'Year',  hint: 'Jan 1 – Dec 31'  },
]

interface Employee { id: string; full_name: string }

// ── Date helpers ─────────────────────────────────────────────────────────────
function fmt(d: Date) {
  return d.toISOString().slice(0, 10)
}

function getMonday(d: Date) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday=1
  dt.setDate(dt.getDate() + diff)
  return dt
}

function getSunday(d: Date) {
  const mon = getMonday(d)
  mon.setDate(mon.getDate() + 6)
  return mon
}

function clampToToday(d: Date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d > today ? today : d
}

/** Returns the smart [from, to] for a given period anchored on a date */
function rangeForPeriod(period: Period, anchor: Date): [string, string] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  switch (period) {
    case 'daily':
      return [fmt(anchor), fmt(anchor)]
    case 'weekly': {
      const mon = getMonday(anchor)
      const sun = getSunday(anchor)
      return [fmt(mon), fmt(clampToToday(sun))]
    }
    case 'monthly': {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      return [fmt(first), fmt(clampToToday(last))]
    }
    case 'yearly': {
      const first = new Date(anchor.getFullYear(), 0, 1)
      const last = new Date(anchor.getFullYear(), 11, 31)
      return [fmt(first), fmt(clampToToday(last))]
    }
  }
}

/** Step forward or backward by one period unit */
function stepPeriod(period: Period, fromStr: string, direction: 1 | -1): Date {
  const d = new Date(fromStr + 'T00:00:00')
  switch (period) {
    case 'daily':
      d.setDate(d.getDate() + direction)
      break
    case 'weekly':
      d.setDate(d.getDate() + 7 * direction)
      break
    case 'monthly':
      d.setMonth(d.getMonth() + direction)
      break
    case 'yearly':
      d.setFullYear(d.getFullYear() + direction)
      break
  }
  return d
}

/** Human-readable label for the current range */
function rangeLabel(period: Period, from: string, to: string): string {
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
  const shortOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }

  switch (period) {
    case 'daily':
      return f.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    case 'weekly':
      return `${f.toLocaleDateString('en-GB', shortOpts)} – ${t.toLocaleDateString('en-GB', opts)}`
    case 'monthly':
      return f.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    case 'yearly':
      return f.getFullYear().toString()
    default:
      return `${from} → ${to}`
  }
}

export default function DashboardFilters({
  employees,
  defaults,
}: {
  employees: Employee[]
  defaults: { from: string; to: string; period: string; employee: string }
}) {
  const router = useRouter()

  const [period, setPeriod] = useState<Period>(defaults.period as Period)
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [empId, setEmpId] = useState(defaults.employee)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function navigate(f: string, t: string, p: Period, e: string) {
    const params = new URLSearchParams()
    params.set('from', f)
    params.set('to', t)
    params.set('period', p)
    if (e) params.set('employee', e)
    router.push(`/dashboard?${params.toString()}`)
  }

  function handlePeriodChange(p: Period) {
    const [f, t] = rangeForPeriod(p, new Date())
    setPeriod(p)
    setFrom(f)
    setTo(t)
    navigate(f, t, p, empId)
  }

  function handleStep(direction: 1 | -1) {
    const anchor = stepPeriod(period, from, direction)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Don't navigate into the future
    if (direction === 1 && anchor > today) return
    const [f, t] = rangeForPeriod(period, anchor)
    setFrom(f)
    setTo(t)
    navigate(f, t, period, empId)
  }

  function handleEmployeeChange(id: string) {
    setEmpId(id)
    setSearch('')
    setOpen(false)
    navigate(from, to, period, id)
  }

  // Check if "next" would go past today
  const canGoNext = (() => {
    const anchor = stepPeriod(period, from, 1)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return anchor <= today
  })()

  const selectedName = employees.find(e => e.id === empId)?.full_name
  const filtered = search
    ? employees.filter(e => e.full_name.toLowerCase().includes(search.toLowerCase()))
    : employees

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      {/* Row 1: Period toggle + Prev/Next + Range label */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Period toggle */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => handlePeriodChange(p.value)}
              title={p.hint}
              className={`px-4 py-2 text-xs font-semibold transition-colors ${
                period === p.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Prev / Next */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleStep(-1)}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-gray-500 hover:text-gray-700"
            title={`Previous ${period.replace('ly', '')}`}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => handleStep(1)}
            disabled={!canGoNext}
            className={`p-1.5 rounded-lg border border-gray-200 transition-colors ${
              canGoNext
                ? 'hover:bg-gray-50 text-gray-500 hover:text-gray-700'
                : 'text-gray-200 cursor-not-allowed'
            }`}
            title={canGoNext ? `Next ${period.replace('ly', '')}` : 'Already at current period'}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Range label */}
        <p className="text-sm font-medium text-gray-800">
          {rangeLabel(period, from, to)}
        </p>

        {/* Today button */}
        <button
          onClick={() => handlePeriodChange(period)}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline"
        >
          Today
        </button>

        {/* Separator */}
        <div className="h-6 w-px bg-gray-200" />

        {/* Custom date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={e => { setFrom(e.target.value); navigate(e.target.value, to, period, empId) }}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={to}
            onChange={e => { setTo(e.target.value); navigate(from, e.target.value, period, empId) }}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Spacer pushes employee search to the right */}
        <div className="flex-1" />

        {/* Employee search */}
        <div className="relative" ref={wrapperRef}>
          <div
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 cursor-pointer min-w-[220px] hover:border-gray-300 transition-colors focus-within:ring-2 focus-within:ring-blue-500"
            onClick={() => setOpen(true)}
          >
            <Search size={14} className="text-gray-400 shrink-0" />
            {open ? (
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search employees..."
                className="flex-1 outline-none text-sm bg-transparent"
              />
            ) : (
              <span className={`flex-1 truncate ${selectedName ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                {selectedName ?? 'All employees'}
              </span>
            )}
            {empId && (
              <button
                onClick={e => {
                  e.stopPropagation()
                  handleEmployeeChange('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {open && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-lg z-50 max-h-64 overflow-y-auto">
              <button
                onClick={() => handleEmployeeChange('')}
                className={`w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100 ${!empId ? 'font-medium text-blue-600' : 'text-gray-600'}`}
              >
                All employees
              </button>
              {filtered.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => handleEmployeeChange(emp.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${empId === emp.id ? 'font-medium text-blue-600 bg-blue-50' : 'text-gray-700'}`}
                >
                  {emp.full_name}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-3 text-sm text-gray-400 text-center">No matches</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
