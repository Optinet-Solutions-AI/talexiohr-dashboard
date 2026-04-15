import { createAdminClient } from '@/lib/supabase/admin'
import { Users, Building2, Globe } from 'lucide-react'

export const dynamic = 'force-dynamic'

const GROUP_STYLE: Record<string, { label: string; bg: string; text: string }> = {
  office_malta:  { label: 'Malta Office',  bg: 'bg-emerald-50', text: 'text-emerald-700' },
  remote:        { label: 'Remote',        bg: 'bg-blue-50',    text: 'text-blue-700'    },
  unclassified:  { label: 'Unclassified',  bg: 'bg-gray-100',   text: 'text-gray-500'    },
}

export default async function EmployeesPage() {
  const supabase = createAdminClient()

  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name, talexio_id, unit, group_type, job_schedule, position, created_at')
    .order('last_name')

  const emps = employees ?? []
  const maltaCount  = emps.filter(e => e.group_type === 'office_malta').length
  const remoteCount = emps.filter(e => e.group_type === 'remote').length
  const unclassifiedCount = emps.filter(e => !e.group_type || e.group_type === 'unclassified').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
        <p className="text-sm text-gray-500 mt-0.5">{emps.length} total employees</p>
      </div>

      {/* Group summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Malta Office', value: maltaCount,  icon: Building2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Remote',       value: remoteCount, icon: Globe,     color: 'text-blue-600',    bg: 'bg-blue-50'    },
          { label: 'Unclassified', value: unclassifiedCount, icon: Users, color: 'text-gray-400', bg: 'bg-gray-50'   },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            <div className={`${bg} w-10 h-10 rounded-lg flex items-center justify-center shrink-0`}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Employee table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">{emps.length} employees</p>
          <a href="/dashboard/settings" className="text-xs text-blue-600 hover:underline">
            Manage groups →
          </a>
        </div>

        {emps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="text-gray-300 mb-3" size={40} />
            <p className="text-gray-500 font-medium">No employees yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Code</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Group</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Unit</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Schedule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {emps.map(emp => {
                const g = GROUP_STYLE[emp.group_type ?? 'unclassified'] ?? GROUP_STYLE.unclassified
                return (
                  <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{emp.full_name}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{emp.talexio_id ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${g.bg} ${g.text}`}>
                        {g.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{emp.unit ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{emp.job_schedule ?? '—'}</td>
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
