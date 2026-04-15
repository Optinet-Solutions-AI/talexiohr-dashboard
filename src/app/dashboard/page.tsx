import { createAdminClient } from '@/lib/supabase/admin'
import { format, subDays } from 'date-fns'
import { Users, ClipboardList, Building2, Home, MapPin, PlaneTakeoff } from 'lucide-react'
import DailyAttendanceChart, { type DayData } from '@/components/dashboard/DailyAttendanceChart'
import StatusDonutChart, { type StatusSlice } from '@/components/dashboard/StatusDonutChart'
import AttendanceGrid, { type GridEmployee } from '@/components/dashboard/AttendanceGrid'

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
}

export default async function DashboardPage() {
  const supabase = createAdminClient()

  const to   = format(new Date(), 'yyyy-MM-dd')
  const from = format(subDays(new Date(), 13), 'yyyy-MM-dd')

  const [
    { data: records },
    { data: employees },
  ] = await Promise.all([
    supabase
      .from('attendance_records')
      .select(`
        date, status,
        employees!inner(id, full_name)
      `)
      .gte('date', from)
      .lte('date', to)
      .order('date'),
    supabase
      .from('employees')
      .select('id, full_name')
      .order('last_name'),
  ])

  const recs = records ?? []
  const emps = employees ?? []

  // ── Stat counts ──────────────────────────────────────────────────────────────
  const count = (s: string) => recs.filter(r => r.status === s).length
  const stats = [
    { label: 'Employees',   value: emps.length,       icon: Users,       color: 'text-gray-600',    bg: 'bg-gray-50'    },
    { label: 'In Office',   value: count('office'),    icon: Building2,   color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'WFH',         value: count('wfh'),       icon: Home,        color: 'text-blue-600',    bg: 'bg-blue-50'    },
    { label: 'Remote',      value: count('remote'),    icon: MapPin,      color: 'text-amber-600',   bg: 'bg-amber-50'   },
    { label: 'On Vacation', value: count('vacation'),  icon: PlaneTakeoff,color: 'text-purple-600',  bg: 'bg-purple-50'  },
    { label: 'No Clocking', value: count('no_clocking'),icon: ClipboardList,color:'text-gray-400',   bg: 'bg-gray-50'    },
  ]

  // ── Daily bar chart data ─────────────────────────────────────────────────────
  const dates = [...new Set(recs.map(r => r.date))].sort()
  const dayData: DayData[] = dates.map(date => {
    const dayRecs = recs.filter(r => r.date === date)
    const dt = new Date(date + 'T00:00:00')
    return {
      label:       dt.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + dt.getDate(),
      office:      dayRecs.filter(r => r.status === 'office').length,
      wfh:         dayRecs.filter(r => r.status === 'wfh').length,
      remote:      dayRecs.filter(r => r.status === 'remote').length,
      vacation:    dayRecs.filter(r => r.status === 'vacation').length,
      no_clocking: dayRecs.filter(r => r.status === 'no_clocking').length,
      unknown:     dayRecs.filter(r => r.status === 'unknown').length,
    }
  })

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
  const gridEmployees: GridEmployee[] = emps.map(emp => {
    const empRec = Array.isArray(emp) ? emp[0] : emp
    const empRecords = recs.filter(r => {
      const e = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return e?.id === empRec.id
    })
    return {
      name: empRec.full_name,
      days: empRecords.map(r => ({ date: r.date, label: r.status, status: r.status })),
    }
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Malta office · {from} → {to}
        </p>
      </div>

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
        {/* Daily attendance bar chart (wider) */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Daily Attendance</h2>
          {dayData.length > 0 ? (
            <DailyAttendanceChart data={dayData} />
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
            <h2 className="text-sm font-semibold text-gray-700">Employee Attendance</h2>
          </div>
          <AttendanceGrid employees={gridEmployees} dates={dates} />
        </div>
      )}
    </div>
  )
}
