'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { Search, X, ChevronLeft, ChevronRight } from 'lucide-react'

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'daily',   label: 'Day'   },
  { value: 'weekly',  label: 'Week'  },
  { value: 'monthly', label: 'Month' },
  { value: 'yearly',  label: 'Year'  },
]

interface Employee { id: string; full_name: string }

function fmt(d: Date) { return d.toISOString().slice(0, 10) }

function getMonday(d: Date) {
  const dt = new Date(d); const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? -6 : 1 - day)); return dt
}

function clampToToday(d: Date) {
  const t = new Date(); t.setHours(0, 0, 0, 0); return d > t ? t : d
}

function rangeForPeriod(period: Period, anchor: Date): [string, string] {
  switch (period) {
    case 'daily': return [fmt(anchor), fmt(anchor)]
    case 'weekly': { const m = getMonday(anchor); const s = new Date(m); s.setDate(s.getDate() + 6); return [fmt(m), fmt(clampToToday(s))] }
    case 'monthly': { const f = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const l = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0); return [fmt(f), fmt(clampToToday(l))] }
    case 'yearly': { const f = new Date(anchor.getFullYear(), 0, 1); const l = new Date(anchor.getFullYear(), 11, 31); return [fmt(f), fmt(clampToToday(l))] }
  }
}

function stepPeriod(period: Period, fromStr: string, dir: 1 | -1): Date {
  const d = new Date(fromStr + 'T00:00:00')
  switch (period) {
    case 'daily': d.setDate(d.getDate() + dir); break
    case 'weekly': d.setDate(d.getDate() + 7 * dir); break
    case 'monthly': d.setMonth(d.getMonth() + dir); break
    case 'yearly': d.setFullYear(d.getFullYear() + dir); break
  }
  return d
}

function rangeLabel(period: Period, from: string, to: string): string {
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  switch (period) {
    case 'daily': return f.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    case 'weekly': return `${f.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    case 'monthly': return f.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    case 'yearly': return f.getFullYear().toString()
  }
}

export default function DashboardFilters({ employees, defaults }: { employees: Employee[]; defaults: { from: string; to: string; period: string; employee: string } }) {
  const router = useRouter()
  const [period, setPeriod] = useState<Period>(defaults.period as Period)
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [empId, setEmpId] = useState(defaults.employee)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  function nav(f: string, t: string, p: Period, e: string) {
    const q = new URLSearchParams(); q.set('from', f); q.set('to', t); q.set('period', p); if (e) q.set('employee', e)
    router.push(`/dashboard?${q.toString()}`)
  }

  function changePeriod(p: Period) { const [f, t] = rangeForPeriod(p, new Date()); setPeriod(p); setFrom(f); setTo(t); nav(f, t, p, empId) }
  function step(dir: 1 | -1) {
    const anchor = stepPeriod(period, from, dir); const today = new Date(); today.setHours(0, 0, 0, 0)
    if (dir === 1 && anchor > today) return
    const [f, t] = rangeForPeriod(period, anchor); setFrom(f); setTo(t); nav(f, t, period, empId)
  }
  function changeEmp(id: string) { setEmpId(id); setSearch(''); setOpen(false); nav(from, to, period, id) }

  const canNext = (() => { const a = stepPeriod(period, from, 1); const t = new Date(); t.setHours(0, 0, 0, 0); return a <= t })()
  const selectedName = employees.find(e => e.id === empId)?.full_name
  const filtered = search ? employees.filter(e => e.full_name.toLowerCase().includes(search.toLowerCase())) : employees

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-3">
      {/* Row 1: period + nav */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-slate-200 overflow-hidden">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => changePeriod(p.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === p.value ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:text-gray-700'}`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="p-1 rounded border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50"><ChevronLeft size={14} /></button>
          <button onClick={() => step(1)} disabled={!canNext} className={`p-1 rounded border border-slate-200 ${canNext ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-50' : 'text-slate-200 cursor-not-allowed'}`}><ChevronRight size={14} /></button>
        </div>

        <span className="text-sm font-medium text-slate-700">{rangeLabel(period, from, to)}</span>
        <button onClick={() => changePeriod(period)} className="text-xs text-slate-400 hover:text-slate-600">Today</button>
      </div>

      {/* Row 2: date pickers + employee */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); nav(e.target.value, to, period, empId) }}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400" />
        <span className="text-xs text-slate-300">to</span>
        <input type="date" value={to} onChange={e => { setTo(e.target.value); nav(from, e.target.value, period, empId) }}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400" />

        <div className="flex-1" />

        {/* Employee search */}
        <div className="relative w-full sm:w-auto" ref={ref}>
          <div onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 cursor-pointer sm:min-w-[200px] hover:border-slate-300 focus-within:ring-1 focus-within:ring-slate-400">
            <Search size={12} className="text-slate-300 shrink-0" />
            {open
              ? <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="flex-1 outline-none text-xs bg-transparent" />
              : <span className={`flex-1 truncate ${selectedName ? 'text-slate-700' : 'text-slate-300'}`}>{selectedName ?? 'All employees'}</span>}
            {empId && <button onClick={e => { e.stopPropagation(); changeEmp('') }} className="text-slate-300 hover:text-slate-500"><X size={12} /></button>}
          </div>
          {open && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md border border-slate-200 shadow-md z-50 max-h-56 overflow-y-auto">
              <button onClick={() => changeEmp('')} className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${!empId ? 'font-medium text-slate-800' : 'text-slate-500'}`}>All employees</button>
              {filtered.map(emp => (
                <button key={emp.id} onClick={() => changeEmp(emp.id)} className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${empId === emp.id ? 'font-medium text-indigo-700 bg-indigo-50' : 'text-gray-600'}`}>{emp.full_name}</button>
              ))}
              {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-300 text-center">No matches</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
