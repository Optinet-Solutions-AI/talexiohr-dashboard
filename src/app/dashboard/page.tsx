import { createAdminClient } from '@/lib/supabase/admin'
import { format, startOfMonth, startOfYear, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, eachYearOfInterval } from 'date-fns'
import DailyAttendanceChart, { type DayData } from '@/components/dashboard/DailyAttendanceChart'
import StatusDonutChart, { type StatusSlice } from '@/components/dashboard/StatusDonutChart'
import AttendanceGrid, { type GridEmployee } from '@/components/dashboard/AttendanceGrid'
import DashboardFilters from '@/components/dashboard/DashboardFilters'

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<string, string> = {
  office:      '#4f46e5', // indigo-600
  wfh:         '#818cf8', // indigo-400
  remote:      '#a5b4fc', // indigo-300
  vacation:    '#c7d2fe', // indigo-200
  sick:        '#c7d2fe',
  no_clocking: '#ddd6fe', // violet-200
  unknown:     '#ede9fe', // violet-100
  active:      '#818cf8',
  broken:      '#a5b4fc',
}

interface PageProps {
  searchParams: Promise<{
    from?: string
    to?: string
    period?: string
    employee?: string
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
  lat_out: number | null
  lng_out: number | null
  employees: { id: string; full_name: string } | { id: string; full_name: string }[]
}

// Office GPS check
const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, OFFICE_KM = 0.15
function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function isAtOffice(lat: number | null, lng: number | null) {
  return lat && lng ? gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM : false
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
      buckets.push({ label: day.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + day.getDate(), recs: recs.filter(r => r.date === dateStr) })
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
  const empFilter = sp.employee ?? ''

  const defaultFrom = (() => {
    const now = new Date()
    switch (period) {
      case 'weekly': { const d = new Date(now); const day = d.getDay(); d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); return format(d, 'yyyy-MM-dd') }
      case 'monthly': return format(startOfMonth(now), 'yyyy-MM-dd')
      case 'yearly': return format(new Date(now.getFullYear(), 0, 1), 'yyyy-MM-dd')
      default: return today
    }
  })()

  const from = sp.from ?? defaultFrom
  const to   = sp.to ?? today

  const { data: employees } = await supabase.from('employees').select('id, full_name').eq('excluded', false).order('last_name')

  let query = supabase
    .from('attendance_records')
    .select('date, status, hours_worked, time_in, time_out, location_in, lat_in, lng_in, location_out, lat_out, lng_out, employees!inner(id, full_name)')
    .gte('date', from).lte('date', to).order('date')
  if (empFilter) query = query.eq('employee_id', empFilter)
  const { data: records } = await query

  const recs: RecordRow[] = (records ?? []) as RecordRow[]
  const emps = employees ?? []

  const count = (s: string) => recs.filter(r => r.status === s).length
  const empCount = empFilter ? emps.filter(e => e.id === empFilter).length : emps.length

  // Broken clocking sub-types
  const brokenNoClockOut = recs.filter(r => (r.status === 'broken' || r.status === 'active') && r.time_in && !r.time_out).length
  const brokenAll = count('broken') + count('active')

  // Location mismatch: status is "office" but GPS/location_out is not at the office
  const locationMismatch = recs.filter(r => {
    if (r.status !== 'office') return false
    // Check if clock-out location is far from office
    if (r.lat_out && r.lng_out && !isAtOffice(r.lat_out, r.lng_out)) return true
    // Or if location_out explicitly says something other than office
    const locOut = (r.location_out ?? '').toLowerCase()
    if (locOut && !locOut.includes('office') && !locOut.includes('head office')) return true
    return false
  }).length

  const stats = [
    { label: 'Employees',   value: empCount },
    { label: 'In Office',   value: count('office') },
    { label: 'WFH',         value: count('wfh') },
    { label: 'Remote',      value: count('remote') },
    { label: 'On Leave',    value: count('vacation') + count('sick') },
    { label: 'No Clocking', value: count('no_clocking') },
    { label: 'Broken',      value: brokenAll },
    { label: 'Loc. Mismatch', value: locationMismatch },
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

  const dates = [...new Set(recs.map(r => r.date))].sort()
  const gridEmps = empFilter ? emps.filter(e => e.id === empFilter) : emps
  const gridEmployees: GridEmployee[] = gridEmps.map(emp => {
    const empRecords = recs.filter(r => { const e = Array.isArray(r.employees) ? r.employees[0] : r.employees; return e?.id === emp.id })
    const days = empRecords.map(r => {
      const flags: string[] = []
      if ((r.status === 'broken' || r.status === 'active') && r.time_in && !r.time_out) flags.push('No clock-out')
      if ((r.status === 'broken' || r.status === 'active') && (!r.time_in || r.time_out)) flags.push('Broken')
      if (r.status === 'office' && r.lat_out && r.lng_out && !isAtOffice(r.lat_out, r.lng_out)) flags.push('Clock-out location mismatch')
      if (r.status === 'office' && r.lat_in && r.lng_in && !isAtOffice(r.lat_in, r.lng_in)) flags.push('Clock-in location mismatch')
      return { date: r.date, label: r.status, status: r.status, hours: r.hours_worked, timeIn: r.time_in, timeOut: r.time_out, flags }
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

  const selectedEmpName = empFilter ? emps.find(e => e.id === empFilter)?.full_name : null
  const periodLabel = period === 'daily' ? 'Daily' : period === 'weekly' ? 'Weekly' : period === 'monthly' ? 'Monthly' : 'Yearly'

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-xs text-slate-600 mt-0.5">Attendance overview</p>
      </div>

      <DashboardFilters employees={emps} defaults={{ from, to, period, employee: empFilter }} />

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
