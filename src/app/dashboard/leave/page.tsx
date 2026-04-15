import { createAdminClient } from '@/lib/supabase/admin'
import { format, subDays } from 'date-fns'
import { CalendarDays, Stethoscope, PlaneTakeoff } from 'lucide-react'

export const dynamic = 'force-dynamic'

const TYPE_STYLE: Record<string, { bg: string; text: string; icon: React.ElementType; label: string }> = {
  vacation: { bg: 'bg-purple-50',  text: 'text-purple-700',  icon: PlaneTakeoff,  label: 'Vacation' },
  sick:     { bg: 'bg-red-50',     text: 'text-red-700',     icon: Stethoscope,   label: 'Sick'     },
}

export default async function LeavePage() {
  const supabase = createAdminClient()

  const to   = format(new Date(), 'yyyy-MM-dd')
  const from = format(subDays(new Date(), 29), 'yyyy-MM-dd')

  const { data: records } = await supabase
    .from('attendance_records')
    .select(`
      id, date, status, comments, hours_worked,
      employees!inner(id, full_name, unit)
    `)
    .in('status', ['vacation', 'sick'])
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })

  const { data: summary } = await supabase
    .from('attendance_records')
    .select('status, hours_worked')
    .in('status', ['vacation', 'sick'])
    .gte('date', from)
    .lte('date', to)

  const vacationDays = summary?.filter(r => r.status === 'vacation').length ?? 0
  const sickDays     = summary?.filter(r => r.status === 'sick').length ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Leave</h1>
        <p className="text-sm text-gray-500 mt-0.5">Last 30 days · {from} → {to}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Vacation Days', value: vacationDays, icon: PlaneTakeoff, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Sick Days',     value: sickDays,     icon: Stethoscope,  color: 'text-red-600',    bg: 'bg-red-50'    },
          { label: 'Total Absences',value: vacationDays + sickDays, icon: CalendarDays, color: 'text-gray-600', bg: 'bg-gray-50' },
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

      {/* Records table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm text-gray-500">{records?.length ?? 0} leave record{records?.length !== 1 ? 's' : ''}</p>
        </div>

        {!records || records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="text-gray-300 mb-3" size={40} />
            <p className="text-gray-500 font-medium">No leave records</p>
            <p className="text-gray-400 text-sm mt-1">Import leave data via the Attendance page</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Employee</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Unit</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map(r => {
                const emp  = Array.isArray(r.employees) ? r.employees[0] : r.employees
                const style = TYPE_STYLE[r.status] ?? TYPE_STYLE.vacation
                const Icon  = style.icon
                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{emp?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{emp?.unit ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap font-medium">{r.date}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
                        <Icon size={11} />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">{r.comments ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
