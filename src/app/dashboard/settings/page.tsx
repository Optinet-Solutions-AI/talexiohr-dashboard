import { createAdminClient } from '@/lib/supabase/admin'
import EmployeeGroupTable from '@/components/settings/EmployeeGroupTable'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = createAdminClient()
  const { data: employees } = await supabase.from('employees').select('id, full_name, talexio_id, unit, group_type').order('last_name')

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Settings</h1>
        <p className="text-xs text-slate-600 mt-0.5">Employee groups and preferences</p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Group Assignment</h2>
          <p className="text-[11px] text-slate-600 mt-0.5">Malta Office = 4-day office policy. Remote = hours only.</p>
        </div>
        {employees && employees.length > 0 ? (
          <EmployeeGroupTable employees={employees} />
        ) : (
          <div className="py-16 text-center">
            <p className="text-slate-600 text-sm">No employees found</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Attendance Policy</h2>
        <ul className="space-y-1 text-xs text-slate-500">
          <li>4 office days per week</li>
          <li>Max 1 WFH Monday per month</li>
          <li>Max 1 WFH Friday per month</li>
          <li>Must book desk in advance and clock in/out</li>
        </ul>
      </div>
    </div>
  )
}
