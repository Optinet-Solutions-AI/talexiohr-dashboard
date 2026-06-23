import { createAdminClient } from '@/lib/supabase/admin'
import { format, startOfMonth, startOfYear, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, eachYearOfInterval } from 'date-fns'
import DailyAttendanceChart, { type DayData } from '@/components/dashboard/DailyAttendanceChart'
import StatusDonutChart, { type StatusSlice } from '@/components/dashboard/StatusDonutChart'
import AttendanceGrid, { type GridEmployee } from '@/components/dashboard/AttendanceGrid'
import DashboardFilters from '@/components/dashboard/DashboardFilters'
import { parseFilters, selectEmployees, groupCounts, type FilterableEmployee } from '@/lib/filters/employeeFilter'
import { isOfficeLocation, dayAnomalies } from '@/lib/attendance/location'

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<string, string> = {
  office:      '#4f46e5', // indigo-600
  wfh:         '#38bdf8', // sky-400
  remote:      '#2dd4bf', // teal-400
  vacation:    '#a78bfa', // violet-400
  sick:        '#f87171', // red-400
  no_clocking: '#a1a1aa', // zinc-400
  unknown:     '#a1a1aa', // zinc-400
  active:      '#f59e0b', // amber-500
  broken:      '#fb923c', // orange-400
}

interface PageProps {
  searchParams: Promise<{
    from?: string
    to?: string
    period?: string
    employees?: string
    locations?: string
    terminated?: string
  }>
}

type RecordRow = {
  date: string
  status: string
  hours_worked: number | null
  time_in: string | null
  time_out: string | null
  location_in: string | null
  lat_in: number | null
  lng_in: number | null
  location_out: string | null
  detected_timezone?: string | null
  lat_out: number | null
  lng_out: number | null
  employees: { id: string; full_name: string } | { id: string; full_name: string }[]
}


function groupByPeriod(recs: RecordRow[], period: string, from: string, to: string) {
  const fromDate = new Date(from + 'T00:00:00')
  const toDate = new Date(to + 'T00:00:00')
  type Bucket = { label: string; recs: RecordRow[] }
  const buckets: Bucket[] = []

  if (period === 'weekly') {
    const weeks = eachWeekOfInterval({ start: fromDate, end: toDate }, { weekStartsOn: 1 })
    for (const ws of weeks) {
      const label = `Wk ${format(ws, 'MMM d')}`
      const weekEnd = new Date(ws); weekEnd.setDate(weekEnd.getDate() + 6)
      buckets.push({ label, recs: recs.filter(r => { const d = new Date(r.date + 'T00:00:00'); return d >= ws && d <= weekEnd }) })
    }
  } else if (period === 'monthly') {
    for (const ms of eachMonthOfInterval({ start: fromDate, end: toDate })) {
      const monthEnd = new Date(ms.getFullYear(), ms.getMonth() + 1, 0)
      buckets.push({ label: format(ms, 'MMM yyyy'), recs: recs.filter(r => { const d = new Date(r.date + 'T00:00:00'); return d >= ms && d <= monthEnd }) })
    }
  } else if (period === 'yearly') {
    for (const ys of eachYearOfInterval({ start: fromDate, end: toDate })) {
      const yearEnd = new Date(ys.getFullYear(), 11, 31)
      buckets.push({ label: format(ys, 'yyyy'), recs: recs.filter(r => { const d = new Date(r.date + 'T00:00:00'); return d >= ys && d <= yearEnd }) })
    }
  } else {
    for (const day of eachDayOfInterval({ start: fromDate, end: toDate })) {
      const dateStr = format(day, 'yyyy-MM-dd')
      // Day number only — keeps labels compact so all of them fit
      buckets.push({
        label: String(day.getDate()),
        recs: recs.filter(r => r.date === dateStr),
      })
    }
  }
  return buckets
}

function bucketsToChartData(buckets: { label: string; recs: RecordRow[] }[]): DayData[] {
  return buckets.map(b => ({
    label: b.label,
    office:      b.recs.filter(r => r.status === 'office').length,
    wfh:         b.recs.filter(r => r.status === 'wfh').length,
    remote:      b.recs.filter(r => r.status === 'remote').length,
    vacation:    b.recs.filter(r => r.status === 'vacation' || r.status === 'sick').length,
    no_clocking: b.recs.filter(r => r.status === 'no_clocking').length,
    unknown:     b.recs.filter(r => r.status === 'unknown' || r.status === 'active' || r.status === 'broken').length,
  }))
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const supabase = createAdminClient()

  const today = format(new Date(), 'yyyy-MM-dd')
  const period = sp.period ?? 'daily'

  // Default: last 7 days (today minus 6 → today)
  const defaultFrom = (() => {
    const now = new Date()
    switch (period) {
      case 'monthly': return format(startOfMonth(now), 'yyyy-MM-dd')
      case 'yearly': return format(new Date(now.getFullYear(), 0, 1), 'yyyy-MM-dd')
      default: {
        const d = new Date(now)
        d.setDate(d.getDate() - 6) // 7 days inclusive of today
        return format(d, 'yyyy-MM-dd')
      }
    }
  })()

  const from = sp.from ?? defaultFrom
  const to   = sp.to ?? today

  const { data: employeesRaw } = await supabase
    .from('employees')
    .select('id, full_name, country, is_terminated, excluded')
    .order('last_name')
  const allEmployees = (employeesRaw ?? []) as FilterableEmployee[]

  const filters = parseFilters(sp)
  const effective = selectEmployees(allEmployees, filters)
  const effectiveIds = effective.map(e => e.id)
  const counts = groupCounts(allEmployees, filters.includeTerminated)

  const { data: records } = await supabase
    .from('attendance_records')
    .select('*, employees!inner(id, full_name)')
    .gte('date', from).lte('date', to)
    .in('employee_id', effectiveIds.length ? effectiveIds : ['__none__'])
    .order('date')

  const recs: RecordRow[] = (records ?? []) as RecordRow[]
  const emps = effective

  const count = (s: string) => recs.filter(r => r.status === s).length
  const empCount = emps.length

  // Anomaly counts derived from each record (incomplete = missing a timestamp;
  // location mismatch = clock-in office-ness differs from clock-out).
  const anomalyTotals = recs.reduce(
    (acc, r) => {
      const inOffice = isOfficeLocation(r.location_in, r.lat_in, r.lng_in)
      const outOffice = isOfficeLocation(r.location_out, r.lat_out, r.lng_out)
      const a = dayAnomalies({ timeIn: r.time_in, timeOut: r.time_out, inOffice, outOffice })
      if (a.incomplete) acc.incomplete++
      if (a.locationMismatch) acc.mismatch++
      return acc
    },
    { incomplete: 0, mismatch: 0 },
  )

  const stats = [
    { label: 'Employees',   value: empCount },
    { label: 'In Office',   value: count('office') },
    { label: 'WFH',         value: count('wfh') },
    { label: 'Remote',      value: count('remote') },
    { label: 'On Leave',    value: count('vacation') + count('sick') },
    { label: 'No Clocking', value: count('no_clocking') },
    { label: 'Incomplete',  value: anomalyTotals.incomplete },
    { label: 'Loc. Mismatch', value: anomalyTotals.mismatch },
  ]

  const buckets = groupByPeriod(recs, period, from, to)
  const chartData = bucketsToChartData(buckets)

  const statusGroups = recs.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {})
  const donutData: StatusSlice[] = Object.entries(statusGroups)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name: name === 'no_clocking' ? 'No Clocking' : name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: STATUS_COLORS[name] ?? '#c7d2fe',
    }))

  // Always show every date in the selected range, even if no records exist
  const dates = eachDayOfInterval({
    start: new Date(from + 'T00:00:00'),
    end: new Date(to + 'T00:00:00'),
  }).map(d => format(d, 'yyyy-MM-dd'))
  const gridEmps = emps
  const gridEmployees: GridEmployee[] = gridEmps.map(emp => {
    const empRecords = recs.filter(r => { const e = Array.isArray(r.employees) ? r.employees[0] : r.employees; return e?.id === emp.id })
    const days = empRecords.map(r => {
      const inOffice = isOfficeLocation(r.location_in, r.lat_in, r.lng_in)
      const outOffice = isOfficeLocation(r.location_out, r.lat_out, r.lng_out)
      const { incomplete, locationMismatch } = dayAnomalies({ timeIn: r.time_in, timeOut: r.time_out, inOffice, outOffice })
      const flags: string[] = []
      if (locationMismatch) flags.push('Location mismatch (started/ended in different places)')
      if (incomplete) flags.push(r.time_in ? 'Incomplete — no clock-out' : 'Incomplete — no clock-in')
      return { date: r.date, label: r.status, status: r.status, hours: r.hours_worked, timeIn: r.time_in, timeOut: r.time_out, flags, incomplete, locationMismatch, detectedTz: r.detected_timezone ?? null }
    })

    // Completed workdays = days with valid clock-in AND clock-out (not broken/active)
    const completedDays = days.filter(d =>
      !['broken', 'active', 'no_clocking', 'vacation', 'sick', 'unknown'].includes(d.status) &&
      d.timeIn && d.timeOut
    )
    const totalHours = completedDays.reduce((sum, d) => sum + (d.hours ?? 0), 0)

    return {
      name: emp.full_name,
      days,
      totalHours: Math.round(totalHours * 100) / 100,
      completedDays: completedDays.length,
      avgHours: completedDays.length > 0 ? Math.round((totalHours / completedDays.length) * 100) / 100 : 0,
    }
  })

  const selectedEmpName = filters.employeeIds.length === 1 ? emps.find(e => e.id === filters.employeeIds[0])?.full_name : null
  const periodLabel = period === 'daily' ? 'Daily' : period === 'weekly' ? 'Weekly' : period === 'monthly' ? 'Monthly' : 'Yearly'

  const pickable = allEmployees
    .filter(e => !e.excluded && (filters.includeTerminated || !e.is_terminated))
    .map(e => ({ id: e.id, full_name: e.full_name }))

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-xs text-slate-600 mt-0.5">Attendance overview</p>
      </div>

      <DashboardFilters employees={pickable} counts={counts} defaults={{ from, to, period }} />

      {/* Stat cards */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
        {stats.map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-3">
            <p className="text-xl font-bold text-slate-800">{value}</p>
            <p className="text-[11px] text-slate-600 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{periodLabel} Attendance</h2>
          {chartData.length > 0 ? (
            <DailyAttendanceChart data={chartData} />
          ) : (
            <div className="h-[240px] flex items-center justify-center text-slate-500 text-sm">No data</div>
          )}
        </div>
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Distribution</h2>
          {donutData.length > 0 ? (
            <StatusDonutChart data={donutData} />
          ) : (
            <div className="h-[240px] flex items-center justify-center text-slate-500 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Grid */}
      {dates.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Employee Grid
              {selectedEmpName && <span className="text-slate-500 font-normal normal-case ml-2">— {selectedEmpName}</span>}
            </h2>
          </div>
          <AttendanceGrid employees={gridEmployees} dates={dates} />
        </div>
      )}
    </div>
  )
}
