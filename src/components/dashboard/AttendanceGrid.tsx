'use client'

import { useState } from 'react'

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  office:      { color: 'bg-indigo-600',  label: 'Office' },
  wfh:         { color: 'bg-sky-400',     label: 'WFH' },
  remote:      { color: 'bg-teal-400',    label: 'Remote' },
  vacation:    { color: 'bg-violet-400',  label: 'Leave' },
  sick:        { color: 'bg-red-400',     label: 'Sick' },
  no_clocking: { color: 'bg-zinc-400',    label: 'No Clocking' },
  unknown:     { color: 'bg-zinc-400',    label: 'Unknown' },
  active:      { color: 'bg-amber-500',   label: 'No Clock-out' },
  broken:      { color: 'bg-orange-400',  label: 'Broken Clocking' },
}

export interface GridDay {
  date: string
  label: string
  status: string
  hours?: number | null
  timeIn?: string | null
  timeOut?: string | null
  flags?: string[]
}

export interface GridEmployee {
  name: string
  days: GridDay[]
  totalHours?: number
  completedDays?: number
  avgHours?: number
}

export default function AttendanceGrid({ employees, dates }: { employees: GridEmployee[]; dates: string[] }) {
  const [tooltip, setTooltip] = useState<{ name: string; day: GridDay; date: string; x: number; y: number } | null>(null)
  const [hoverRow, setHoverRow] = useState<string | null>(null)
  const [hoverCol, setHoverCol] = useState<string | null>(null)

  const weeks = new Map<string, string[]>()
  for (const d of dates) {
    const dt = new Date(d + 'T00:00:00')
    const weekStart = new Date(dt)
    const day = weekStart.getDay()
    weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1))
    const weekKey = weekStart.toISOString().slice(0, 10)
    if (!weeks.has(weekKey)) weeks.set(weekKey, [])
    weeks.get(weekKey)!.push(d)
  }

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-white" rowSpan={2}></th>
              {[...weeks.entries()].map(([weekKey, weekDates]) => {
                const ws = new Date(weekKey + 'T00:00:00')
                return (
                  <th key={weekKey} colSpan={weekDates.length} className="text-center text-[9px] font-medium text-slate-600 pb-0 pt-2 px-0">
                    Wk {ws.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </th>
                )
              })}
              <th className="sticky right-0 z-20 bg-white border-l border-slate-200 px-2 text-[9px] font-medium text-slate-600 text-center" rowSpan={2}>
                <span className="block">Avg</span>
                <span className="block text-slate-600 font-normal">h/day</span>
              </th>
            </tr>
            <tr>
              {dates.map(d => {
                const dt = new Date(d + 'T00:00:00')
                const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
                const isColHover = hoverCol === d
                return (
                  <th key={d} className={`px-0 py-1 text-center min-w-[24px] w-[24px] transition-colors ${isWeekend ? 'opacity-40' : ''} ${isColHover ? 'bg-indigo-50' : ''}`}>
                    <span className={`block text-[9px] font-medium leading-tight ${isColHover ? 'text-indigo-600' : 'text-slate-600'}`}>
                      {dt.toLocaleDateString('en-GB', { weekday: 'narrow' })}
                    </span>
                    <span className={`block text-[9px] leading-tight ${isColHover ? 'text-indigo-600' : 'text-slate-600'}`}>
                      {dt.getDate()}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => {
              const isRowHover = hoverRow === emp.name
              return (
                <tr key={emp.name}>
                  <td className={`sticky left-0 z-10 px-3 py-1 text-xs font-medium whitespace-nowrap max-w-[140px] truncate transition-colors ${isRowHover ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-slate-700'}`}>
                    {emp.name}
                  </td>
                  {dates.map(date => {
                    const day = emp.days.find(d => d.date === date)
                    const s = day?.status ?? 'unknown'
                    const config = STATUS_CONFIG[s] ?? STATUS_CONFIG.unknown
                    const dt = new Date(date + 'T00:00:00')
                    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
                    const hasFlag = day?.flags && day.flags.length > 0
                    const isCross = isRowHover || hoverCol === date

                    return (
                      <td
                        key={date}
                        className={`px-0 py-1 text-center transition-colors ${isWeekend && !isCross ? 'opacity-40' : ''} ${isCross ? 'bg-indigo-50/50' : ''}`}
                        onMouseEnter={() => { setHoverRow(emp.name); setHoverCol(date) }}
                        onMouseLeave={() => { setHoverRow(null); setHoverCol(null) }}
                      >
                        <div
                          className={`w-[18px] h-[18px] rounded-[4px] mx-auto cursor-default ${config.color} transition-transform hover:scale-125 ${hasFlag ? 'ring-2 ring-rose-500' : ''}`}
                          onMouseEnter={e => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect()
                            setTooltip({ name: emp.name, day: day ?? { date, label: 'unknown', status: 'unknown' }, date, x: rect.left + rect.width / 2, y: rect.top - 8 })
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      </td>
                    )
                  })}
                  {/* Summary column */}
                  <td className={`sticky right-0 z-10 border-l border-slate-200 px-2 py-1 text-center min-w-[56px] transition-colors ${isRowHover ? 'bg-indigo-50' : 'bg-white'}`}>
                    {emp.completedDays != null && emp.completedDays > 0 ? (
                      <div title={`${emp.totalHours}h total / ${emp.completedDays} days`}>
                        <span className={`text-xs font-bold ${(emp.avgHours ?? 0) < 7 ? 'text-red-600' : (emp.avgHours ?? 0) < 8 ? 'text-amber-600' : 'text-slate-800'}`}>
                          {emp.avgHours?.toFixed(1)}
                        </span>
                        <span className="block text-[9px] text-slate-600">{emp.totalHours}h / {emp.completedDays}d</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-slate-100">
        {Object.entries(STATUS_CONFIG).filter(([k]) => !['unknown'].includes(k)).map(([key, { color, label }]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-[3px] ${color}`} />
            <span className="text-[10px] text-slate-600">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-[3px] bg-slate-300 ring-2 ring-rose-500" />
          <span className="text-[10px] text-red-500">Location Mismatch</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg bg-slate-800 text-white text-[11px] shadow-lg -translate-x-1/2 -translate-y-full space-y-0.5"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div>
            <span className="font-medium">{tooltip.name}</span>
            <span className="text-slate-400 ml-1.5">
              {new Date(tooltip.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
          <div className="text-slate-300">
            {(STATUS_CONFIG[tooltip.day.status] ?? STATUS_CONFIG.unknown).label}
            {tooltip.day.hours != null && <span className="ml-1.5 text-white font-medium">{tooltip.day.hours.toFixed(1)}h</span>}
          </div>
          {tooltip.day.timeIn && (
            <div className="text-slate-400 text-[10px]">
              {tooltip.day.timeIn?.slice(0, 5)} → {tooltip.day.timeOut?.slice(0, 5) ?? '—'}
            </div>
          )}
          {tooltip.day.flags && tooltip.day.flags.length > 0 && (
            <div className="text-red-300 text-[10px]">
              {tooltip.day.flags.join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
