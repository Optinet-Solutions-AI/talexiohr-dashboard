import { createAdminClient } from '@/lib/supabase/admin'
import { format, subDays, startOfWeek, startOfMonth, startOfYear, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, eachYearOfInterval } from 'date-fns'
import { Users, ClipboardList, Building2, Home, MapPin, PlaneTakeoff } from 'lucide-react'
import DailyAttendanceChart, { type DayData } from '@/components/dashboard/DailyAttendanceChart'
import StatusDonutChart, { type StatusSlice } from '@/components/dashboard/StatusDonutChart'
import AttendanceGrid, { type GridEmployee } from '@/components/dashboard/AttendanceGrid'
import DashboardFilters from '@/components/dashboard/DashboardFilters'

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<string, string> = {
  office:      '#10b981',
  wfh:         '#3b82f6',
  remote:      '#f59e0b',
  vacation:    '#8b5cf6',
  no_clocking: '#9ca3af',
  unknown:     '#d1d5db',
  active:      '#06b6d4',
  broken:      '#ef4444',
  sick:        '#ef4444',
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
  employees: { id: string; full_name: string } | { id: string; full_name: string }[]
}

// ── Period grouping helpers ──────────────────────────────────────────────────
function groupByPeriod(recs: RecordRow[], period: string, from: string, to: string) {
  const fromDate = new Date(from + 'T00:00:00')
  const toDate = new Date(to + 'T00:00:00')

  type Bucket = { label: string; recs: RecordRow[] }
  const buckets: Bucket[] = []

  if (period === 'weekly') {
    const weeks = eachWeekOfInterval({ start: fromDate, end: toDate }, { weekStartsOn: 1 })
    for (const ws of weeks) {
      const label = `Wk ${format(ws, 'MMM d')}`
      const weekEnd = new Date(ws)
      weekEnd.setDate(weekEnd.getDate() + 6)
      const wRecs = recs.filter(r => {
        const d = new Date(r.date + 'T00:00:00')
        return d >= ws && d <= weekEnd
      })
      buckets.push({ label, recs: wRecs })
    }
  } else if (period === 'monthly') {
    const months = eachMonthOfInterval({ start: fromDate, end: toDate })
    for (const ms of months) {
      const label = format(ms, 'MMM yyyy')
      const monthEnd = new Date(ms.getFullYear(), ms.getMonth() + 1, 0)
      const mRecs = recs.filter(r => {
        const d = new Date(r.date + 'T00:00:00')
        return d >= ms && d <= monthEnd
      })
      buckets.push({ label, recs: mRecs })
    }
  } else if (period === 'yearly') {
    const years = eachYearOfInterval({ start: fromDate, end: toDate })
    for (const ys of years) {
      const label = format(ys, 'yyyy')
      const yearEnd = new Date(ys.getFullYear(), 11, 31)
      const yRecs = recs.filter(r => {
        const d = new Date(r.date + 'T00:00:00')
        return d >= ys && d <= yearEnd
      })
      buckets.push({ label, recs: yRecs })
    }
  } else {
    // daily (default)
    const days = eachDayOfInterval({ start: fromDate, end: toDate })
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd')
      const label = day.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + day.getDate()
      const dRecs = recs.filter(r => r.date === dateStr)
      buckets.push({ label, recs: dRecs })
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

  const to   = sp.to   ?? format(new Date(), 'yyyy-MM-dd')
  const from = sp.from  ?? format(subDays(new Date(), 13), 'yyyy-MM-dd')
  const period   = sp.period   ?? 'daily'
  const empFilter = sp.employee ?? ''

  // Fetch employees for filter dropdown
  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name')
    .order('last_name')

  // Build attendance query
  let query = supabase
    .from('attendance_records')
    .select(`
      date, status,
      employees!inner(id, full_name)
    `)
    .gte('date', from)
    .lte('date', to)
    .order('date')

  if (empFilter) {
    query = query.eq('employee_id', empFilter)
  }

  const { data: records } = await query

  const recs: RecordRow[] = (records ?? []) as RecordRow[]
  const emps = employees ?? []

  // ── Stat counts ──────────────────────────────────────────────────────────────
  const count = (s: string) => recs.filter(r => r.status === s).length
  const filteredEmpCount = empFilter
    ? emps.filter(e => e.id === empFilter).length
    : emps.length

  const stats = [
    { label: 'Employees',   value: filteredEmpCount,    icon: Users,       color: 'text-gray-600',    bg: 'bg-gray-50'    },
    { label: 'In Office',   value: count('office'),      icon: Building2,   color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'WFH',         value: count('wfh'),         icon: Home,        color: 'text-blue-600',    bg: 'bg-blue-50'    },
    { label: 'Remote',      value: count('remote'),      icon: MapPin,      color: 'text-amber-600',   bg: 'bg-amber-50'   },
    { label: 'On Leave',    value: count('vacation') + count('sick'), icon: PlaneTakeoff, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'No Clocking', value: count('no_clocking'), icon: ClipboardList, color: 'text-gray-400', bg: 'bg-gray-50'    },
  ]

  // ── Bar chart data grouped by period ─────────────────────────────────────────
  const buckets = groupByPeriod(recs, period, from, to)
  const chartData = bucketsToChartData(buckets)

  // ── Donut chart data ─────────────────────────────────────────────────────────
  const statusGroups = recs.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  const donutData: StatusSlice[] = Object.entries(statusGroups)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name: name === 'no_clocking' ? 'No Clocking' : name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: STATUS_COLORS[name] ?? '#e5e7eb',
    }))

  // ── Employee grid data ───────────────────────────────────────────────────────
  const dates = [...new Set(recs.map(r => r.date))].sort()
  const gridEmps = empFilter
    ? emps.filter(e => e.id === empFilter)
    : emps

  const gridEmployees: GridEmployee[] = gridEmps.map(emp => {
    const empRecords = recs.filter(r => {
      const e = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return e?.id === emp.id
    })
    return {
      name: emp.full_name,
      days: empRecords.map(r => ({ date: r.date, label: r.status, status: r.status })),
    }
  })

  const selectedEmpName = empFilter
    ? emps.find(e => e.id === empFilter)?.full_name
    : null

  const periodLabel = period === 'daily' ? 'Daily' : period === 'weekly' ? 'Weekly' : period === 'monthly' ? 'Monthly' : 'Yearly'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {selectedEmpName ? selectedEmpName : 'All employees'} · {from} to {to} · {periodLabel}
        </p>
      </div>

      {/* Filters */}
      <DashboardFilters
        employees={emps}
        defaults={{ from, to, period, employee: empFilter }}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {stats.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <div className={`${bg} w-9 h-9 rounded-lg flex items-center justify-center`}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Attendance bar chart */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{periodLabel} Attendance</h2>
          {chartData.length > 0 ? (
            <DailyAttendanceChart data={chartData} />
          ) : (
            <div className="h-[260px] flex items-center justify-center text-gray-400 text-sm">No data for this period</div>
          )}
        </div>

        {/* Status distribution donut */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Status Distribution</h2>
          {donutData.length > 0 ? (
            <StatusDonutChart data={donutData} />
          ) : (
            <div className="h-[260px] flex items-center justify-center text-gray-400 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Employee attendance grid */}
      {dates.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              Employee Attendance
              {selectedEmpName && <span className="text-gray-400 font-normal"> — {selectedEmpName}</span>}
            </h2>
          </div>
          <AttendanceGrid employees={gridEmployees} dates={dates} />
        </div>
      )}
    </div>
  )
}
