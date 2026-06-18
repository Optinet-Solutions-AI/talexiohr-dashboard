'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import StatsFilterBar from '@/components/filters/StatsFilterBar'
import { parseFilters, type LocationGroup } from '@/lib/filters/employeeFilter'

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

export default function DashboardFilters({ employees, counts, defaults }: {
  employees: Employee[]
  counts: Record<LocationGroup, number>
  defaults: { from: string; to: string; period: string }
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [period, setPeriod] = useState<Period>(defaults.period as Period)
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)

  function nav(f: string, t: string, p: Period) {
    const cur = new URLSearchParams(params.toString())
    cur.set('from', f); cur.set('to', t); cur.set('period', p)
    router.push(`/dashboard?${cur.toString()}`)
  }
  function changePeriod(p: Period) { const [f, t] = rangeForPeriod(p, new Date()); setPeriod(p); setFrom(f); setTo(t); nav(f, t, p) }
  function step(dir: 1 | -1) {
    const anchor = stepPeriod(period, from, dir); const today = new Date(); today.setHours(0, 0, 0, 0)
    if (dir === 1 && anchor > today) return
    const [f, t] = rangeForPeriod(period, anchor); setFrom(f); setTo(t); nav(f, t, period)
  }

  const pf = parseFilters(Object.fromEntries(params))
  const canNext = (() => { const a = stepPeriod(period, from, 1); const t = new Date(); t.setHours(0, 0, 0, 0); return a <= t })()

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
          <button onClick={() => step(-1)} className="p-1 rounded border border-slate-200 text-slate-600 hover:text-slate-600 hover:bg-slate-50"><ChevronLeft size={14} /></button>
          <button onClick={() => step(1)} disabled={!canNext} className={`p-1 rounded border border-slate-200 ${canNext ? 'text-slate-600 hover:text-slate-600 hover:bg-slate-50' : 'text-slate-500 cursor-not-allowed'}`}><ChevronRight size={14} /></button>
        </div>

        <span className="text-sm font-medium text-slate-700">{rangeLabel(period, from, to)}</span>
        <button onClick={() => changePeriod(period)} className="text-xs text-slate-600 hover:text-slate-600">Today</button>
      </div>

      {/* Row 2: date pickers */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); nav(e.target.value, to, period) }}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400" />
        <span className="text-xs text-slate-500">to</span>
        <input type="date" value={to} onChange={e => { setTo(e.target.value); nav(from, e.target.value, period) }}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400" />
      </div>

      {/* Row 3: employee / location / terminated filters */}
      <StatsFilterBar
        employees={employees}
        selectedEmployees={pf.employeeIds}
        locations={pf.locations}
        counts={counts}
        includeTerminated={pf.includeTerminated}
      />
    </div>
  )
}
