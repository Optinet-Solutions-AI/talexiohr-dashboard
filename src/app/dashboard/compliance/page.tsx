import { createAdminClient } from '@/lib/supabase/admin'
import { format, startOfMonth, endOfMonth, endOfWeek, eachWeekOfInterval, eachDayOfInterval, getDay } from 'date-fns'
import ComplianceFilters from '@/components/compliance/ComplianceFilters'

export const dynamic = 'force-dynamic'

interface PageProps { searchParams: Promise<{ month?: string }> }

const REQUIRED_OFFICE_DAYS = 4
const MAX_WFH_MONDAYS = 1
const MAX_WFH_FRIDAYS = 1

type Emp = { id: string; full_name: string; group_type: string | null; unit: string | null }
type Rec = { employee_id: string; date: string; status: string }

export default async function CompliancePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const supabase = createAdminClient()
  const now = new Date()
  const selectedMonth = sp.month ?? format(now, 'yyyy-MM')
  const [year, month] = selectedMonth.split('-').map(Number)
  const monthStart = startOfMonth(new Date(year, month - 1))
  const monthEnd = endOfMonth(monthStart)
  const from = format(monthStart, 'yyyy-MM-dd')
  const to = format(monthEnd, 'yyyy-MM-dd')

  const { data: employees } = await supabase.from('employees').select('id, full_name, group_type, unit').eq('group_type', 'office_malta').order('last_name')
  const { data: records } = await supabase.from('attendance_records').select('employee_id, date, status').gte('date', from).lte('date', to)

  const emps: Emp[] = employees ?? []
  const recs: Rec[] = records ?? []
  const cutoff = monthEnd > now ? now : monthEnd
  const workingDays = eachDayOfInterval({ start: monthStart, end: cutoff }).filter(d => { const day = getDay(d); return day >= 1 && day <= 5 })
  const weeks = eachWeekOfInterval({ start: monthStart, end: cutoff }, { weekStartsOn: 1 })

  const data = emps.map(emp => {
    const er = recs.filter(r => r.employee_id === emp.id)

    const weeklyBreaches: { week: string; got: number; need: number }[] = []
    weeks.forEach(ws => {
      const we = endOfWeek(ws, { weekStartsOn: 1 })
      const days = eachDayOfInterval({ start: ws < monthStart ? monthStart : ws, end: we > cutoff ? cutoff : we }).filter(d => getDay(d) >= 1 && getDay(d) <= 5)
      const leave = days.filter(d => { const r = er.find(x => x.date === format(d, 'yyyy-MM-dd')); return r && (r.status === 'vacation' || r.status === 'sick') }).length
      const need = Math.min(REQUIRED_OFFICE_DAYS, days.length - leave)
      const got = days.filter(d => { const r = er.find(x => x.date === format(d, 'yyyy-MM-dd')); return r && r.status === 'office' }).length
      if (got < need && need > 0) weeklyBreaches.push({ week: format(ws < monthStart ? monthStart : ws, 'MMM d'), got, need })
    })

    const wfhMon = workingDays.filter(d => getDay(d) === 1).filter(d => { const r = er.find(x => x.date === format(d, 'yyyy-MM-dd')); return r && (r.status === 'wfh' || r.status === 'remote') }).length
    const wfhFri = workingDays.filter(d => getDay(d) === 5).filter(d => { const r = er.find(x => x.date === format(d, 'yyyy-MM-dd')); return r && (r.status === 'wfh' || r.status === 'remote') }).length
    const officeDays = er.filter(r => r.status === 'office').length
    const wfhDays = er.filter(r => r.status === 'wfh' || r.status === 'remote').length
    const leaveDays = er.filter(r => r.status === 'vacation' || r.status === 'sick').length
    const monBreach = wfhMon > MAX_WFH_MONDAYS
    const friBreach = wfhFri > MAX_WFH_FRIDAYS
    const ok = weeklyBreaches.length === 0 && !monBreach && !friBreach

    return { ...emp, officeDays, wfhDays, leaveDays, weeklyBreaches, wfhMon, wfhFri, monBreach, friBreach, ok }
  })

  const compliant = data.filter(e => e.ok).length
  const breaches = data.filter(e => !e.ok).length

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Compliance</h1>
          <p className="text-xs text-slate-400 mt-0.5">Malta Office · {format(monthStart, 'MMMM yyyy')}</p>
        </div>
        <ComplianceFilters currentMonth={selectedMonth} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Compliant', value: compliant },
          { label: 'Breaches',  value: breaches },
          { label: 'Employees', value: emps.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-3">
            <p className="text-xl font-bold text-slate-800">{value}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100">
          <p className="text-xs text-slate-400">{emps.length} Malta Office employees</p>
        </div>

        {emps.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-slate-400 text-sm">No Malta Office employees</p>
            <p className="text-slate-300 text-xs mt-1">Assign groups in Settings</p>
          </div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Employee</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider text-center">Status</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider text-center">Office</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider text-center">WFH</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider text-center">Leave</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider text-center">Mon</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider text-center">Fri</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.map(e => (
                    <tr key={e.id} className={`hover:bg-slate-50/50 transition-colors ${!e.ok ? 'bg-slate-50/30' : ''}`}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-700">{e.full_name}</p>
                        <p className="text-[10px] text-slate-400">{e.unit ?? '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${e.ok ? 'bg-indigo-50 text-indigo-600' : 'bg-red-50 text-red-600'}`}>
                          {e.ok ? 'OK' : 'Breach'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center font-medium text-slate-700">{e.officeDays}</td>
                      <td className="px-4 py-2.5 text-center text-slate-500">{e.wfhDays}</td>
                      <td className="px-4 py-2.5 text-center text-slate-500">{e.leaveDays}</td>
                      <td className="px-4 py-2.5 text-center"><span className={`font-medium ${e.monBreach ? 'text-slate-800' : 'text-slate-400'}`}>{e.wfhMon}/{MAX_WFH_MONDAYS}</span></td>
                      <td className="px-4 py-2.5 text-center"><span className={`font-medium ${e.friBreach ? 'text-slate-800' : 'text-slate-400'}`}>{e.wfhFri}/{MAX_WFH_FRIDAYS}</span></td>
                      <td className="px-4 py-2.5">
                        {e.ok ? <span className="text-slate-300 text-[11px]">—</span> : (
                          <div className="space-y-0.5">
                            {e.weeklyBreaches.map((b, i) => <p key={i} className="text-[11px] text-slate-600">Wk {b.week}: {b.got}/{b.need} days</p>)}
                            {e.monBreach && <p className="text-[11px] text-slate-600">{e.wfhMon} WFH Mon (max {MAX_WFH_MONDAYS})</p>}
                            {e.friBreach && <p className="text-[11px] text-slate-600">{e.wfhFri} WFH Fri (max {MAX_WFH_FRIDAYS})</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y divide-slate-100">
              {data.map(e => (
                <div key={e.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">{e.full_name}</span>
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${e.ok ? 'bg-indigo-50 text-indigo-600' : 'bg-red-50 text-red-600'}`}>
                      {e.ok ? 'OK' : 'Breach'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span>Office: {e.officeDays}</span>
                    <span>WFH: {e.wfhDays}</span>
                    <span>Mon: {e.wfhMon}/{MAX_WFH_MONDAYS}</span>
                    <span>Fri: {e.wfhFri}/{MAX_WFH_FRIDAYS}</span>
                  </div>
                  {!e.ok && (
                    <div className="text-[11px] text-slate-500">
                      {e.weeklyBreaches.map((b, i) => <span key={i} className="mr-2">Wk {b.week}: {b.got}/{b.need}</span>)}
                      {e.monBreach && <span className="mr-2">{e.wfhMon} WFH Mon</span>}
                      {e.friBreach && <span>{e.wfhFri} WFH Fri</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Policy</h2>
        <ul className="space-y-1 text-xs text-slate-500">
          <li>{REQUIRED_OFFICE_DAYS} office days/week (leave excluded)</li>
          <li>Max {MAX_WFH_MONDAYS} WFH Monday/month</li>
          <li>Max {MAX_WFH_FRIDAYS} WFH Friday/month</li>
        </ul>
      </div>
    </div>
  )
}
