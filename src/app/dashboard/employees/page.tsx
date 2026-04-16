import { createAdminClient } from '@/lib/supabase/admin'
import EmployeeTable from '@/components/employees/EmployeeTable'

export const dynamic = 'force-dynamic'

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
        <p className="text-xs text-slate-600 mt-0.5">{emps.length} total</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Malta Office', value: maltaCount },
          { label: 'Remote',       value: remoteCount },
          { label: 'Unclassified', value: unclassifiedCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-3">
            <p className="text-xl font-bold text-slate-800">{value}</p>
            <p className="text-[11px] text-slate-600 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-600">{emps.length} employees</p>
          <a href="/dashboard/settings" className="text-xs text-indigo-600 hover:underline">Manage groups</a>
        </div>

        {emps.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-slate-600 text-sm">No employees yet</p>
          </div>
        ) : (
          <EmployeeTable employees={emps} />
        )}
      </div>
    </div>
  )
}
