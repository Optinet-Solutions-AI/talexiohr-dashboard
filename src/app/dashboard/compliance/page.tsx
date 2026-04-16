import { createAdminClient } from '@/lib/supabase/admin'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachWeekOfInterval, eachDayOfInterval, getDay } from 'date-fns'
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Calendar } from 'lucide-react'
import ComplianceFilters from '@/components/compliance/ComplianceFilters'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ month?: string }>
}

// Policy constants
const REQUIRED_OFFICE_DAYS_PER_WEEK = 4
const MAX_WFH_MONDAYS_PER_MONTH = 1
const MAX_WFH_FRIDAYS_PER_MONTH = 1

type EmployeeRow = {
  id: string
  full_name: string
  group_type: string | null
  unit: string | null
}

type RecordRow = {
  employee_id: string
  date: string
  status: string
}

export default async function CompliancePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const supabase = createAdminClient()

  // Default to current month
  const now = new Date()
  const selectedMonth = sp.month ?? format(now, 'yyyy-MM')
  const [year, month] = selectedMonth.split('-').map(Number)
  const monthStart = startOfMonth(new Date(year, month - 1))
  const monthEnd = endOfMonth(monthStart)

  const from = format(monthStart, 'yyyy-MM-dd')
  const to = format(monthEnd, 'yyyy-MM-dd')

  // Fetch Malta Office employees only
  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name, group_type, unit')
    .eq('group_type', 'office_malta')
    .order('last_name')

  // Fetch attendance records for the month
  const { data: records } = await supabase
    .from('attendance_records')
    .select('employee_id, date, status')
    .gte('date', from)
    .lte('date', to)

  const emps: EmployeeRow[] = employees ?? []
  const recs: RecordRow[] = records ?? []

  // Get all working days (Mon-Fri) in the month
  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd > now ? now : monthEnd })
  const workingDays = allDays.filter(d => {
    const day = getDay(d)
    return day >= 1 && day <= 5 // Mon=1 to Fri=5
  })

  // Get weeks in this month
  const weeks = eachWeekOfInterval(
    { start: monthStart, end: monthEnd > now ? now : monthEnd },
    { weekStartsOn: 1 } // Monday
  )

  // Build compliance data per employee
  const complianceData = emps.map(emp => {
    const empRecs = recs.filter(r => r.employee_id === emp.id)

    // -- Weekly office day compliance --
    const weeklyBreaches: { weekStart: string; officeDays: number; required: number }[] = []

    weeks.forEach(weekStart => {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
      const weekDays = eachDayOfInterval({
        start: weekStart < monthStart ? monthStart : weekStart,
        end: weekEnd > (monthEnd > now ? now : monthEnd) ? (monthEnd > now ? now : monthEnd) : weekEnd,
      }).filter(d => {
        const day = getDay(d)
        return day >= 1 && day <= 5
      })

      // Count days with leave/sick — these don't count against the employee
      const leaveDays = weekDays.filter(d => {
        const dateStr = format(d, 'yyyy-MM-dd')
        const rec = empRecs.find(r => r.date === dateStr)
        return rec && (rec.status === 'vacation' || rec.status === 'sick')
      }).length

      const requiredDays = Math.min(REQUIRED_OFFICE_DAYS_PER_WEEK, weekDays.length - leaveDays)

      const officeDays = weekDays.filter(d => {
        const dateStr = format(d, 'yyyy-MM-dd')
        const rec = empRecs.find(r => r.date === dateStr)
        return rec && rec.status === 'office'
      }).length

      if (officeDays < requiredDays && requiredDays > 0) {
        weeklyBreaches.push({
          weekStart: format(weekStart < monthStart ? monthStart : weekStart, 'MMM d'),
          officeDays,
          required: requiredDays,
        })
      }
    })

    // -- Monthly WFH Monday count --
    const mondays = workingDays.filter(d => getDay(d) === 1)
    const wfhMondays = mondays.filter(d => {
      const dateStr = format(d, 'yyyy-MM-dd')
      const rec = empRecs.find(r => r.date === dateStr)
      return rec && (rec.status === 'wfh' || rec.status === 'remote')
    }).length

    // -- Monthly WFH Friday count --
    const fridays = workingDays.filter(d => getDay(d) === 5)
    const wfhFridays = fridays.filter(d => {
      const dateStr = format(d, 'yyyy-MM-dd')
      const rec = empRecs.find(r => r.date === dateStr)
      return rec && (rec.status === 'wfh' || rec.status === 'remote')
    }).length

    const totalOfficeDays = empRecs.filter(r => r.status === 'office').length
    const totalWfhDays = empRecs.filter(r => r.status === 'wfh' || r.status === 'remote').length
    const totalLeaveDays = empRecs.filter(r => r.status === 'vacation' || r.status === 'sick').length

    const hasWeeklyBreach = weeklyBreaches.length > 0
    const hasMondayBreach = wfhMondays > MAX_WFH_MONDAYS_PER_MONTH
    const hasFridayBreach = wfhFridays > MAX_WFH_FRIDAYS_PER_MONTH
    const isCompliant = !hasWeeklyBreach && !hasMondayBreach && !hasFridayBreach

    return {
      ...emp,
      totalOfficeDays,
      totalWfhDays,
      totalLeaveDays,
      weeklyBreaches,
      wfhMondays,
      wfhFridays,
      hasWeeklyBreach,
      hasMondayBreach,
      hasFridayBreach,
      isCompliant,
    }
  })

  const compliantCount = complianceData.filter(e => e.isCompliant).length
  const breachCount = complianceData.filter(e => !e.isCompliant).length
  const weeklyBreachCount = complianceData.filter(e => e.hasWeeklyBreach).length
  const mondayBreachCount = complianceData.filter(e => e.hasMondayBreach).length
  const fridayBreachCount = complianceData.filter(e => e.hasFridayBreach).length

  const monthLabel = format(monthStart, 'MMMM yyyy')

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Malta Office attendance policy · {monthLabel}
          </p>
        </div>
        <ComplianceFilters currentMonth={selectedMonth} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Compliant', value: compliantCount, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Breaches', value: breachCount, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: '<4 Days/Week', value: weeklyBreachCount, icon: Calendar, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Malta Office', value: emps.length, icon: ShieldCheck, color: 'text-blue-600', bg: 'bg-blue-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
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

      {/* Compliance table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">{emps.length} Malta Office employees</p>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle size={12} /> WFH Mon: {mondayBreachCount} breach{mondayBreachCount !== 1 ? 'es' : ''}
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle size={12} /> WFH Fri: {fridayBreachCount} breach{fridayBreachCount !== 1 ? 'es' : ''}
            </span>
          </div>
        </div>

        {emps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldCheck className="text-gray-300 mb-3" size={40} />
            <p className="text-gray-500 font-medium">No Malta Office employees</p>
            <p className="text-gray-400 text-sm mt-1">Assign employees to the Malta Office group in Settings</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Employee</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider text-center">Status</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider text-center">Office Days</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider text-center">WFH Days</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider text-center">Leave</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider text-center">WFH Mon</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider text-center">WFH Fri</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Breaches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {complianceData.map(emp => (
                  <tr key={emp.id} className={`hover:bg-gray-50 transition-colors ${!emp.isCompliant ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{emp.full_name}</p>
                      <p className="text-xs text-gray-400">{emp.unit ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {emp.isCompliant ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700">
                          <CheckCircle2 size={11} /> Compliant
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-50 text-red-700">
                          <XCircle size={11} /> Breach
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-gray-900">{emp.totalOfficeDays}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{emp.totalWfhDays}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{emp.totalLeaveDays}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-medium ${emp.hasMondayBreach ? 'text-red-600' : 'text-gray-600'}`}>
                        {emp.wfhMondays}/{MAX_WFH_MONDAYS_PER_MONTH}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-medium ${emp.hasFridayBreach ? 'text-red-600' : 'text-gray-600'}`}>
                        {emp.wfhFridays}/{MAX_WFH_FRIDAYS_PER_MONTH}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {emp.isCompliant ? (
                        <span className="text-xs text-gray-400">None</span>
                      ) : (
                        <div className="space-y-1">
                          {emp.weeklyBreaches.map((b, i) => (
                            <p key={i} className="text-xs text-red-600">
                              Week of {b.weekStart}: {b.officeDays}/{b.required} office days
                            </p>
                          ))}
                          {emp.hasMondayBreach && (
                            <p className="text-xs text-red-600">
                              {emp.wfhMondays} WFH Mondays (max {MAX_WFH_MONDAYS_PER_MONTH})
                            </p>
                          )}
                          {emp.hasFridayBreach && (
                            <p className="text-xs text-red-600">
                              {emp.wfhFridays} WFH Fridays (max {MAX_WFH_FRIDAYS_PER_MONTH})
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Policy reference */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Policy Rules Applied</h2>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 text-blue-500 shrink-0" />
            Must attend office <strong>{REQUIRED_OFFICE_DAYS_PER_WEEK} days per week</strong> (leave days excluded)
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 text-blue-500 shrink-0" />
            Max <strong>{MAX_WFH_MONDAYS_PER_MONTH} WFH Monday</strong> per calendar month
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 text-blue-500 shrink-0" />
            Max <strong>{MAX_WFH_FRIDAYS_PER_MONTH} WFH Friday</strong> per calendar month
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 text-blue-500 shrink-0" />
            Only <strong>Malta Office</strong> group employees are evaluated (configure in Settings)
          </li>
        </ul>
      </div>
    </div>
  )
}
