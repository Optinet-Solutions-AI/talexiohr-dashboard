import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const GROUP_STYLE: Record<string, { label: string; cls: string }> = {
  office_malta: { label: 'Malta Office', cls: 'bg-slate-700 text-white' },
  remote:       { label: 'Remote',       cls: 'bg-slate-300 text-slate-700' },
  unclassified: { label: 'Unclassified', cls: 'bg-slate-100 text-slate-400' },
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
    <div className="space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Employees</h1>
        <p className="text-xs text-slate-400 mt-0.5">{emps.length} total</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Malta Office', value: maltaCount },
          { label: 'Remote',       value: remoteCount },
          { label: 'Unclassified', value: unclassifiedCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-3">
            <p className="text-xl font-bold text-slate-800">{value}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-400">{emps.length} employees</p>
          <a href="/dashboard/settings" className="text-xs text-slate-500 hover:text-slate-700">Manage groups</a>
        </div>

        {emps.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-slate-400 text-sm">No employees yet</p>
          </div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Name</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Code</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Group</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Unit</th>
                    <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Schedule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {emps.map(emp => {
                    const g = GROUP_STYLE[emp.group_type ?? 'unclassified'] ?? GROUP_STYLE.unclassified
                    return (
                      <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-slate-700">{emp.full_name}</td>
                        <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]">{emp.talexio_id ?? '—'}</td>
                        <td className="px-4 py-2.5"><span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${g.cls}`}>{g.label}</span></td>
                        <td className="px-4 py-2.5 text-slate-500">{emp.unit ?? '—'}</td>
                        <td className="px-4 py-2.5 text-slate-400">{emp.job_schedule ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y divide-slate-100">
              {emps.map(emp => {
                const g = GROUP_STYLE[emp.group_type ?? 'unclassified'] ?? GROUP_STYLE.unclassified
                return (
                  <div key={emp.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">{emp.full_name}</span>
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${g.cls}`}>{g.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <span>{emp.talexio_id ?? '—'}</span>
                      <span>{emp.unit ?? '—'}</span>
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
