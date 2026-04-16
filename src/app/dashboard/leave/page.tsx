import { createAdminClient } from '@/lib/supabase/admin'
import { format, subDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export default async function LeavePage() {
  const supabase = createAdminClient()
  const to   = format(new Date(), 'yyyy-MM-dd')
  const from = format(subDays(new Date(), 29), 'yyyy-MM-dd')

  const { data: records } = await supabase
    .from('attendance_records')
    .select('id, date, status, comments, hours_worked, employees!inner(id, full_name, unit)')
    .in('status', ['vacation', 'sick']).gte('date', from).lte('date', to)
    .order('date', { ascending: false })

  const { data: summary } = await supabase
    .from('attendance_records').select('status').in('status', ['vacation', 'sick']).gte('date', from).lte('date', to)

  const vacationDays = summary?.filter(r => r.status === 'vacation').length ?? 0
  const sickDays     = summary?.filter(r => r.status === 'sick').length ?? 0

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Leave</h1>
        <p className="text-xs text-slate-600 mt-0.5">Last 30 days · {from} → {to}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Vacation', value: vacationDays },
          { label: 'Sick',     value: sickDays },
          { label: 'Total',    value: vacationDays + sickDays },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-3">
            <p className="text-xl font-bold text-slate-800">{value}</p>
            <p className="text-[11px] text-slate-600 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100">
          <p className="text-xs text-slate-600">{records?.length ?? 0} record{records?.length !== 1 ? 's' : ''}</p>
        </div>

        {!records || records.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-slate-600 text-sm">No leave records</p>
            <p className="text-slate-500 text-xs mt-1">Import data via the Attendance page</p>
          </div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Employee</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Unit</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Date</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Type</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {records.map(r => {
                    const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-slate-700">{emp?.full_name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-slate-500">{emp?.unit ?? '—'}</td>
                        <td className="px-4 py-2.5 text-slate-600 font-medium">{r.date}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${r.status === 'sick' ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'}`}>
                            {r.status === 'sick' ? 'Sick' : 'Vacation'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{r.comments ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y divide-slate-100">
              {records.map(r => {
                const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
                return (
                  <div key={r.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">{emp?.full_name ?? '—'}</span>
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${r.status === 'sick' ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'}`}>
                        {r.status === 'sick' ? 'Sick' : 'Vacation'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-600">
                      <span>{r.date}</span>
                      <span>{emp?.unit ?? '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
